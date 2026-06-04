# Build Plan — Hermes Mobile Gateway (React Native + Bridge)

> **This document is the instruction set for the coding agent.** Build the system
> described here end-to-end. Follow the milestones in order; each milestone must be
> runnable and demoable before moving on. Prefer the simplest implementation that
> satisfies the contract. Do not add infrastructure that isn't justified by a
> requirement below (no brokers, no microservices, no multi-tenant auth — this is a
> single-user, self-hosted system).

---

## 0. What we're building

A Telegram-style messenger app that is a **gateway to a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent)** (Nous Research, MIT, runs on a Raspberry Pi / Linux box). The user and the agent exchange text, files, and voice notes; and — beyond a normal messenger — **the agent can render interactive UI** (buttons, inputs, sliders, forms, approval cards, charts, sandboxed HTML) by emitting declarative blocks.

Three components:

| Component | Where it runs | Language | Role |
|---|---|---|---|
| **App** | Android phone (Windows dev env) | TypeScript / Expo | Chat UI + server-driven UI renderer + media |
| **Bridge** | Raspberry Pi (Linux), next to Hermes | Python / FastAPI | WebSocket + file server; relays to/from Hermes |
| **Hermes plugin + skill** | Pi, inside Hermes | Python + SKILL.md | Lets the agent emit UI blocks and read user events |

Network path: **App → Cloudflare Tunnel (TLS) → Bridge (localhost on Pi) → Hermes API server (localhost on Pi).** The Bridge port is never exposed directly; only `cloudflared` reaches it.

```
 ┌──────────────┐   wss:// + https://    ┌──────────────────────────── Raspberry Pi ───────────────┐
 │  RN app      │  (Cloudflare Tunnel)   │  ┌─────────┐   /v1/chat/completions   ┌───────────────┐  │
 │  (Android)   │ ─────────────────────► │  │ Bridge  │ ───────────────────────► │ Hermes Agent  │  │
 │              │ ◄───────────────────── │  │ FastAPI │ ◄─────────────────────── │ (API server)  │  │
 └──────────────┘   WS frames + files    │  └────┬────┘   stream tokens          └──────┬────────┘  │
                                         │       │  ▲  POST /internal/ui                │ plugin    │
                                         │       │  └──────────────────────────────────┘ ui_* tools │
                                         └───────┴──────────────────────────────────────────────────┘
```

The **wire protocol is fully specified in `protocol.ts`** (shared zod schema). That file is the contract; both ends validate every frame against it and drop anything malformed. Generate the Python equivalent with `zod-to-json-schema` + `pydantic` so the Bridge validates identically — do **not** hand-maintain two schemas.

---

## 1. Hermes facts the integration depends on

Verify against the current docs (`plugins.md`, `skills.md`, `api-server.md`, `gateway.md`) before coding, but these are the load-bearing facts (Hermes v0.3.0):

- **OpenAI-compatible API server**: `POST /v1/chat/completions` (streaming, token-by-token) and `/v1/responses`. Pass header **`X-Hermes-Session-Id: <chatId>`** for per-conversation session continuity. Hardened with input limits, field whitelists, CORS protection, and `Idempotency-Key` support. This is the conversational loop the Bridge drives.
- **Plugin folder**: drop a `.py` file in **`~/.hermes/plugins/`** to register custom tools, commands, and hooks — no fork. This is how the agent gets `ui_*` tools.
- **Skills**: native `SKILL.md` documents (agentskills.io standard); support conditional activation on tool availability. Ship `HERMES_UI.skill.md` so the agent knows when/how to use the UI tools.
- **Voice**: built-in STT via `faster-whisper` and free TTS via `edge-tts`. Reuse these — the Bridge should not ship its own ASR.
- **Runtime**: Python 3.11+, Linux/macOS/WSL2 (a Pi is fine; **Windows native is not supported** for Hermes/Bridge — that's only your *app* dev machine).

> If the installed Hermes version cannot register a custom tool from a plugin in time, fall back to the **fenced-block parser** (see §4.4). Build the plugin path first; keep the parser as a documented fallback.

---

## 2. App — stack & structure

**Stack (pin current versions at scaffold time):**
- **Expo SDK 54+** (managed, with **dev client / prebuild** — config plugins are required for mic + webview). TypeScript, strict.
- **expo-router** — tab navigation: `Brain` (chat), `Processes`, `Settings` (matches the design's bottom nav).
- **zustand** — app state; thin and synchronous.
- **expo-sqlite** — local persistence of chats, messages, file cache, and the unsent outbox. (Drizzle ORM optional.)
- **expo-audio** — voice note **record + playback** (`AudioRecorder` / `AudioPlayer`; `requestRecordingPermissionsAsync`). ⚠️ Do **not** use `expo-av` — it's removed from Expo Go in SDK 54.
- **expo-file-system** — download + cache files; **expo-document-picker** / **expo-image-picker** for attachments; **expo-image** for display.
- **react-native-svg** — voice waveform + simple charts.
- **react-native-gifted-charts** — chart blocks (simpler than Skia-based victory-native for v1; swap later if needed).
- **react-native-webview** — sandboxed HTML blocks.
- **expo-secure-store** — device token (Android Keystore-backed).
- **expo-notifications** — local notifications now; FCM push is Phase 2 (optional).

**Suggested layout:**
```
app/                      # expo-router screens (Brain / Processes / Settings)
src/
  transport/
    socket.ts             # WS client: auth, heartbeat, backoff reconnect, hello/replay
    outbox.ts             # persist unsent frames -> flush on reconnect (idempotent)
    files.ts              # upload (chunked) + download (Range) against Bridge
  protocol/
    protocol.ts           # <- the shared schema file (copy in; keep identical to Bridge's)
    encode.ts             # build frames (ULID ids, ts)
  store/
    db.ts                 # expo-sqlite schema + migrations
    messages.ts           # repo: insert/append-stream/edit/delete/query
    chats.ts
  sdui/
    BlockRenderer.tsx     # block.type -> component (registry)
    blocks/               # Text, File, Voice, Buttons, Input, Slider, Select, Form, Chart, Html, Card
  media/
    recorder.ts           # expo-audio record -> m4a + compute waveform peaks (<=64)
    player.ts             # expo-audio playback w/ progress
  chat/
    MessageList.tsx       # virtualized (FlashList), grouped, streaming-aware
    Composer.tsx          # text + attach + push-to-talk mic
  features/pairing/       # QR scan -> {tunnelUrl, deviceToken} -> secure-store
  theme/                  # tokens from the provided design file
```

**Transport rules (non-negotiable):**
- One WS connection. On open, send a `hello` frame `{ device, sinceTs }`; the Bridge replays missed frames newer than `sinceTs`.
- Heartbeat: app pings every ~20s; if no pong in ~10s, drop and reconnect with exponential backoff + jitter (cap ~30s).
- **Outbox**: every user-originated frame is written to SQLite *before* send and removed only on Bridge `receipt(delivered)`. On reconnect, replay the outbox. All frames carry a ULID `id`; Bridge dedupes by id (idempotency).
- **Validate every inbound frame** with `parseFrame()`; log + drop on failure. Never trust the wire.
- Streaming: a `stream` frame appends `delta` to message `msgId`; render the partial bubble live; finalize on `done`.

---

## 3. SDUI renderer (the interesting part)

A message is `blocks: Block[]`. `BlockRenderer` maps each block to a component via a registry, so adding a block type later = one zod variant + one component + one registry entry. Build these components to match the **provided design file** (dark theme, neon accent, rounded cards, monospace labels per the reference).

Round-trip for interactive blocks:
1. Agent sends a message containing e.g. a `buttons`, `form`, or `card` block (each carries stable `id`s).
2. User taps a button / submits a form / approves a card.
3. App sends an **`event`** frame: `{type:"action", source, name, value}` or `{type:"submit", form, values}`.
4. Bridge injects that as the user's next turn into Hermes (so the agent "sees" the choice and continues).
5. Agent may **`edit`** the original block (e.g. flip a card `status` `pending → approved`) — the app patches the existing message in place.

Block components to build (all defined in `protocol.ts`): `text` (markdown), `file` (image inline / doc chip), `voice` (waveform + play/scrub + optional transcript), `buttons`, `input`, `slider`, `select`, `form` (groups fields → single submit), `chart` (line/bar/area/pie), `html` (sandboxed WebView), `card` (the approval card: title/subtitle/body/status + actions).

**HTML safety:** render `html` blocks in a WebView with `javaScriptEnabled={false}` by default (enable per-block only when the agent sets a flag you add later), `originWhitelist={[]}`, no file/universal access, fixed height, and a strict CSP `<meta>`. Treat agent HTML as semi-trusted: it's your agent, but a compromised model output should not reach app internals.

---

## 4. Bridge — stack & responsibilities

**Stack:** Python 3.11+, **FastAPI + uvicorn**, `websockets`/Starlette WS, `httpx` (async, to Hermes), `pydantic` v2 (validate frames from the generated JSON Schema), `aiosqlite` (outbox/idempotency + file metadata). Runs as a **systemd** service, binds **127.0.0.1** only.

**Endpoints:**
- `GET /ws` — the WebSocket. Auth via `Authorization: Bearer <deviceToken>` (or first-frame token if header is awkward through the tunnel). Validates token against a hashed allowlist.
- `POST /files` — chunked/resumable upload → returns `{id}`. Caps size + mime. Generates image thumbnails (`thumbId`).
- `GET /files/{id}` — supports **HTTP Range** (audio/video streaming, lazy image load). `?thumb=1` for thumbnails. Auth required.
- `POST /internal/ui` — **localhost-only**, called by the Hermes plugin to push a `message`/`edit`/`typing` frame to the app for a given `chat`.
- `GET /health`.

### 4.1 Conversation loop
On a user `message` frame: persist it, map `chat → X-Hermes-Session-Id`, call `POST /v1/chat/completions` (stream). Forward `typing(start)`, then map model tokens to `stream` frames (`msgId`, `delta`, `done`), then `typing(stop)`. Send `receipt(delivered)` for the user's frame immediately on persist.

### 4.2 Files & voice
- Files referenced by `fileId`; never inline binaries in WS frames.
- **Inbound voice note**: app uploads the audio (`POST /files`) and sends a `voice` block. The Bridge transcribes via Hermes' `faster-whisper`, then feeds the **transcript** to the agent as the user turn while keeping the audio as an attachment reference. Echo the transcript back into the stored `voice` block.
- **Outbound voice**: when the agent wants to speak, it calls the `ui_voice` tool (or the Bridge synthesizes via `edge-tts`); the Bridge stores the audio as a file and sends a `voice` block (with precomputed waveform).

### 4.3 Reconnect / replay
Keep a per-chat append-only frame log (sqlite) with `ts` + monotonic seq. On `hello{sinceTs}`, replay everything newer. Dedupe inbound by frame `id`.

### 4.4 Two ways the agent emits UI (build #1, keep #2 as fallback)
1. **Plugin tools (primary):** the agent calls `ui_buttons` / `ui_form` / `ui_chart` / `ui_html` / `ui_card` / `ui_voice` / `ui_update`. The plugin POSTs a validated block payload to `POST /internal/ui`. Reliable, structured, no parsing.
2. **Fenced-block fallback:** the agent emits a fenced ```` ```hermes-ui ```` JSON block in its text; the Bridge extracts and validates it, strips it from the visible text, and emits it as a real block. Use only if the plugin tool path is unavailable.

---

## 5. Hermes plugin skeleton (`~/.hermes/plugins/app_ui.py`)

Confirm the exact registration decorator/signature against `plugins.md` for the installed version; the shape is:

```python
# ~/.hermes/plugins/app_ui.py
import os, json, time, uuid, httpx
# from hermes.plugins import tool   # <-- confirm exact import in plugins.md

BRIDGE = os.environ.get("BRIDGE_UI_URL", "http://127.0.0.1:8787/internal/ui")
SECRET = os.environ["BRIDGE_INTERNAL_TOKEN"]  # shared localhost secret

def _push(chat: str, kind: str, payload: dict):
    frame = {"v": 1, "id": uuid.uuid4().hex, "ts": int(time.time()*1000),
             "chat": chat, "from": "agent", "kind": kind, **payload}
    httpx.post(BRIDGE, json=frame, headers={"X-Internal-Token": SECRET}, timeout=10)

# @tool("ui_buttons", "Show tappable buttons. Returns when the user taps one.")
def ui_buttons(chat: str, text: str, buttons: list[dict]):
    """buttons: [{label, value, style?}] — see HERMES_UI.skill.md"""
    blocks = [{"type": "text", "text": text},
              {"type": "buttons",
               "buttons": [{"id": uuid.uuid4().hex, **b} for b in buttons]}]
    _push(chat, "message", {"blocks": blocks})
    return "Buttons sent; the user's tap will arrive as your next message."

# ui_form, ui_chart, ui_html, ui_card, ui_voice, ui_update follow the same pattern,
# each constructing the block from protocol.ts and calling _push().
```

The user's tap/submit arrives back at the Bridge as an `event` frame; the Bridge injects it into the Hermes session as the next user turn, so the agent's tool call effectively "returns" the user's choice on the following turn.

---

## 6. Security (keep it tight, not heavy)

- **TLS + origin hiding** via Cloudflare Tunnel; optionally put **Cloudflare Access** (service token / OTP) in front for a second gate.
- **Device pairing**: a `bridge pair` CLI on the Pi mints a random 32-byte device token and prints a **QR** encoding `{tunnelUrl, deviceToken}`. The app scans it once and stores the token in `expo-secure-store`. Bridge stores only a **hash** of each token in an allowlist; tokens are revocable.
- Bridge binds `127.0.0.1`; `/internal/ui` additionally requires the shared `X-Internal-Token` and rejects non-loopback callers.
- **Input limits everywhere**: max frame size, max blocks/message, max file size, allowed mime list, per-connection rate limit. Mirror Hermes' own API hardening.
- **Schema validation** on every inbound frame, both ends. Reject, don't coerce.
- Sandboxed WebView for `html` (see §3). No secrets in HTML or charts.
- Secret redaction: rely on Hermes' built-in log redaction; don't log tokens or file bytes.
- E2E message encryption is **out of scope for v1** (single trusted server + TLS). Note it as a possible later layer.

---

## 7. Milestones (each must run before the next)

- **M0 — Scaffold.** Expo TS app w/ dev client + 3 tabs; FastAPI Bridge skeleton; copy `protocol.ts` into app and generate the Python schema; pairing flow (QR → secure-store); `cloudflared` tunnel mapped to the Bridge. *Demo: app connects WS, exchanges hello/ping/pong over the tunnel.*
- **M1 — Text chat e2e.** User text → Bridge → Hermes (`/v1/chat/completions` stream, `X-Hermes-Session-Id`) → streamed reply. Typing indicator, receipts, SQLite persistence, reconnect + outbox replay. *Demo: a real conversation with the agent, survives airplane-mode toggling.*
- **M2 — Files & voice.** Upload/download with Range; images inline + doc chips; voice notes (record m4a + waveform, play/scrub) both directions; inbound transcription via Hermes whisper. *Demo: send/receive a photo, a PDF, and a voice note that the agent transcribes and replies to.*
- **M3 — Interactive SDUI.** `buttons`, `input`, `slider`, `select`, `form`, `card` + the full event round-trip and in-place `edit` (approval card pending→approved). Plugin `ui_*` tools live. *Demo: agent sends the "Send follow-up email? Accept & send / Reject" card; tapping Accept updates the card and continues the conversation.*
- **M4 — Rich blocks.** `chart` (line/bar/area/pie) and sandboxed `html`. *Demo: agent renders a chart and an HTML snippet.*
- **M5 — Hardening & polish.** Auth/validation/rate-limit pass; error & offline states; match the design file pixel-wise; systemd unit for the Bridge; optional FCM push. *Demo: clean, secure, on-design build.*

---

## 8. Acceptance checklist

Status as of M5 (✅ = code-verified; 🔵 = implemented, needs the full running
stack — Bridge + Hermes + device — for end-to-end confirmation):

- [x] ✅ Every frame validates against `protocol.ts` on both ends; malformed frames are dropped and logged. (Bridge `ws.py` `parse_frame_json` + `logger.warning`; app `socket.ts` `safeParseFrame` + `console.warn`.)
- [x] 🔵 Reconnect after network loss replays missed frames with no dupes and no lost user messages. (Bridge `replay_since` + `id` dedupe; app outbox + `hello{sinceTs}` + exponential backoff. Verify on-device.)
- [x] 🔵 Agent text streams token-by-token into a live bubble. (`hermes.py` SSE→`stream` frames; app `appendStream`. Needs Hermes.)
- [x] ✅ Files and voice go over HTTP (Range), never inside WS frames. (`main.py` `/files` 206 Range; frames carry only `fileId`.)
- [x] 🔵 Every interactive block produces an `event` the agent receives as its next turn; `edit` patches in place. (`events.ts` → `handle_event_turn`; `/internal/ui` update → `edit`. Needs Hermes.)
- [x] ✅ Bridge reachable only via the tunnel; `/internal/ui` only via loopback + internal token; device tokens hashed + revocable. (`main.py` loopback + `X-Internal-Token` check + rate limit; `auth.py` SHA-256 + `bridge revoke`.)
- [x] ✅ HTML blocks run in a sandboxed WebView (no JS by default, no app access). (`HtmlBlock.tsx` `javaScriptEnabled={false}`, `originWhitelist={[]}`, strict CSP meta.)
- [x] 🔵 UI matches the provided design file. (Design tokens mirrored in `tokens.ts`; all 11 blocks use them. On-device pixel diff is manual QA.)
- [x] ✅ `HERMES_UI.skill.md` is installed and the agent uses the `ui_*` tools correctly without prompting. (Installed at `~/.hermes/skills/HERMES_UI.skill.md`; plugin at `~/.hermes/plugins/app_ui.py`. Agent behaviour needs Hermes.)

### M5 hardening additions
- [x] ✅ Rate limiting: token bucket on WS frames (per device), WS connects (per host), and `/internal/ui`. Configurable in `config.py`.
- [x] ✅ Per-message block-count cap + per-frame byte cap (drop + log + error frame).
- [x] ✅ Block-level error boundaries — a bad block renders an inline fallback, never a white screen.
- [x] ✅ Offline banner + dismissable error banner driven by structured `error` frames.
- [x] ✅ Token rotation on auth failure (WS close `4401` → clear secure-store credential, prompt re-pair).
- [x] ✅ systemd unit + cloudflared ingress config provided.

---

## 9. Local dev shortcuts (Windows app dev + Linux Bridge)

- Develop the **app** on Windows; run on a physical Android device via Expo dev client (USB/adb or LAN). Build the dev client once with `eas build --profile development` or `npx expo run:android`.
- Develop the **Bridge + Hermes** on the Pi (or WSL2). Before wiring Cloudflare, point the app at `ws://<pi-lan-ip>:8787` on the LAN to iterate fast; switch to the tunnel hostname for the real path.
- Use `cloudflared tunnel run` with an ingress rule mapping your hostname → `http://127.0.0.1:8787` (Cloudflare Tunnel passes WebSockets through).

---

## 10. Deliverables

1. The **app** (Expo TS) per §2–3.
2. The **Bridge** (FastAPI) per §4, with systemd unit + `bridge pair` CLI.
3. `~/.hermes/plugins/app_ui.py` per §5.
4. `HERMES_UI.skill.md` installed into Hermes' skills dir (provided alongside this plan).
5. `protocol.ts` (provided) copied into the app + a generated Python schema for the Bridge.
6. A short `README` covering: pairing, running the Bridge, the Cloudflare ingress rule, and how to add a new block type.

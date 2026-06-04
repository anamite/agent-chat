# Hermes Mobile Gateway

A Telegram-style messenger app that is a **gateway to a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent)**. The user and agent exchange text, files, and voice notes — and the agent can render **interactive UI** (buttons, inputs, sliders, forms, approval cards, charts, sandboxed HTML) using declarative blocks.

## Architecture

```
┌──────────────┐   wss:// + https://    ┌────────────────────────── Raspberry Pi ──────────────────┐
│  RN app      │  (Cloudflare Tunnel)   │  ┌─────────┐   /v1/chat/completions   ┌───────────────┐  │
│  (Android)   │ ─────────────────────► │  │ Bridge  │ ───────────────────────► │ Hermes Agent  │  │
│  Expo SDK 56 │ ◄───────────────────── │  │ FastAPI │ ◄─────────────────────── │ (API server)  │  │
└──────────────┘   WS frames + files    │  └────┬────┘   stream tokens          └──────┬────────┘  │
                                        │       │  ▲  POST /internal/ui                │ plugin    │
                                        │       │  └──────────────────────────────────┘ ui_* tools │
                                        └───────┴───────────────────────────────────────────��─────┘
```

**Three components:**
| Component | Where | Language | Role |
|-----------|-------|----------|------|
| **App** | Android phone | TypeScript / Expo SDK 56 | Chat UI + SDUI renderer + media |
| **Bridge** | Raspberry Pi (localhost) | Python / FastAPI | WebSocket hub + file server + Hermes relay |
| **Plugin + Skill** | Pi (~/.hermes/) | Python + SKILL.md | `ui_*` tools + agent guidance |

## Network Path

```
App → Cloudflare Tunnel (TLS) → Bridge (127.0.0.1:8787) → Hermes (127.0.0.1:4700)
```

The Bridge binds localhost only; `cloudflared` is the sole entry point.

---

## Build Status — Milestones (Updated 2026-06-04)

| Milestone | Status | Cost | Deliverables |
|-----------|--------|------|--------------|
| **M0 — Scaffold** | ✅ | $3.50 | Bridge skeleton, protocol.ts (386 lines), Expo app + 3 tabs, pairing flow, QA, device token auth, design tokens |
| **M1 — Text chat e2e** | ✅ | $3.24 | Hermes streaming loop (SSE→WS), typing indicator, chat history, reconnect/replay, outbox, receipts |
| **M2 — Files & Voice** | ✅ | $5.29 | Voice record/play (expo-audio), file upload/download with Range, whisper transcription, edge-tts synthesis, SDUI TextBlock/FileBlock/VoiceBlock |
| **M3 — Interactive SDUI** | ✅ | $5.29 | 9 block components (buttons, input, slider, select, form, card), event round-trip, in-place edits, Hermes plugin (9 tools), HERMES_UI.skill.md |
| **M4 — Rich blocks** | ✅ | $4.62 | ChartBlock (gifted-charts line/bar/area/pie) + HtmlBlock (WebView sandbox, JS off by default, strict CSP) |
| **M5 — Hardening** | ✅ | $6.33 | Rate limits (token bucket), frame + block-count validation, block error boundaries, offline/error banners, token rotation on auth failure, systemd unit + cloudflared config, README |
| **Verify — Audit** | ✅ | $1.66 | Full verification audit (schema drift, plugin packaging, thumbnails, /internal/ui hardening) |
| **Fixes — Audit follow-up** | ✅ | $4.38 | Removed broken duplicate plugin, HtmlBlock `allowJs`, image thumbnails, /internal/* tunnel deny |

**Total spent: $34.31**

---

## Design System

**Dark-first with lime accent** — extracted from `design/hermes-design.html`:

| Token | Color | Usage |
|-------|-------|-------|
| Canvas | `#08090A` | App background |
| Surface | `#15171A` | Cards, inputs, elevated elements |
| Border | `#2A2D33` | Hairline borders |
| Text | `#F3F4F5` | Primary text |
| Text 2 | `#969BA3` | Secondary / muted |
| **Accent** | **`#D6FF3D`** | **Primary accent + user bubbles** |
| OK | `#5CE08F` | Success / approved |
| Warn | `#F5C451` | Warning / pending |
| Fail | `#FF6B5E` | Error / rejected |

**Typography:** Geist (300–700) for body, Geist Mono for labels/timestamps/code.
**Radius:** Controls 3px, Console cards 8px, Canvas cards 16px.
**Two modes:** Console (dense, hairline, bubbleless agent) and Canvas (roomy, elevated, bubbles).

---

## File Inventory

### Bridge (`bridge/` — 14 Python files, ~2170 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `main.py` | 406 | FastAPI app — `/health`, `/ws`, `/files` (+ image thumbnails), `/files/{id}` (`?thumb=1`), `/internal/ui`; connect + internal rate limits |
| `pydantic_schema.py` | 328 | Pydantic equivalent, generated from protocol.ts |
| `hermes.py` | 307 | Hermes streaming loop, SSE parser, history builder, event injection, voice transcription, fenced-block parser |
| `db.py` | 219 | aiosqlite — frame_log, uploads (+ thumb_id), token_allowlist metadata tables |
| `ws.py` | 217 | WebSocket hub — auth, replay, ping/pong, frame + block-count validation, per-connection frame rate limit |
| `cli.py` | 128 | `bridge pair/tokens/revoke/serve/internal-token` CLI |
| `config.py` | 118 | Settings — env-based, Hermes URL, upload limits, heartbeat + rate-limit config |
| `whisper.py` | 117 | Voice transcription via faster-whisper + edge-tts synthesis |
| `auth.py` | 74 | Device token hashing (SHA-256), Bearer extraction, validation, revocation |
| `ratelimit.py` | 52 | In-memory token-bucket limiter (WS frames, connects, /internal/ui) |
| `pair.py` | 49 | Device pairing — mint 32-byte tokens, render QR codes |
| `ulid.py` | 29 | ULID generation (monotonic, Crockford base32) |
| `gen_pydantic.py` | 123 | Schema generation script |
| `protocol.ts` | 386 | Shared Zod schema — all frame kinds + 11 block types |
| `systemd/hermes-bridge.service` | — | systemd unit (loopback bind, restart-on-failure, hardening) |
| `systemd/hermes-bridge.env.example` | — | EnvironmentFile template (secrets + tunables) |
| `cloudflared/cloudflared-config.yml` | — | Cloudflare Tunnel ingress example (denies `/internal/*`) |

### Plugin + Skill (`plugin/app-ui/` — installed to `~/.hermes/plugins/app-ui/`)

The agent-side package. It is a proper Hermes plugin directory (not a loose
module), installed verbatim under `~/.hermes/plugins/app-ui/`.

| File | Lines | Purpose |
|------|-------|---------|
| `__init__.py` | 465 | 9 `ui_*` tools (buttons, input, slider, select, form, card, update, chart, html); each builds a protocol-valid frame and POSTs it to the Bridge `/internal/ui` with `X-Internal-Token`. `register(ctx)` wires the tools + skill. |
| `HERMES_UI.skill.md` | 87 | Agent guidance — when/how to use each `ui_*` tool. |
| `plugin.yaml` | 10 | Plugin manifest (name, entrypoint). |

### App (`app/` — 31 source files, ~4000 lines TypeScript)

| Directory | Files | Purpose |
|-----------|-------|---------|
| `app/(tabs)/` | 6 | expo-router — Brain (chat + offline/error banners), Processes, Settings tabs + layouts |
| `src/protocol/` | 2 | `protocol.ts` (byte-identical to bridge) + `encode.ts` (frame builders) |
| `src/transport/` | 3 | `socket.ts` (WS + heartbeat + backoff + auth-fail detection), `ingest.ts`, `files.ts` |
| `src/store/` | 2 | `db.ts` (expo-sqlite — messages, outbox), `app.ts` (zustand — pairing, typing, socket, lastError) |
| `src/sdui/` | 13 | `BlockRenderer.tsx` (registry) + `BlockErrorBoundary.tsx` + 10 block components + `events.ts` |
| `src/media/` | 2 | `recorder.ts` (expo-audio m4a + waveform), `player.ts` (play/seek/scrub + playback error) |
| `src/features/pairing/` | 1 | `pairing.ts` (expo-secure-store, QR payload parser) |
| `src/theme/` | 1 | `tokens.ts` (colors, fonts, radius, spacing, fontSize) |

### SDUI Block Components

| Component | Block Type | Interactive? |
|-----------|-----------|--------------|
| `TextBlock` | `text` | No — markdown rendering |
| `FileBlock` | `file` | No — image inline / doc chip |
| `VoiceBlock` | `voice` | Yes — play/scrub/seek |
| `ButtonsBlock` | `buttons` | Yes — tap sends action event |
| `InputBlock` | `input` | Yes — text entry submits |
| `SliderBlock` | `slider` | Yes — drag sends value |
| `SelectBlock` | `select` | Yes — pick from list |
| `FormBlock` | `form` | Yes — multi-field submit |
| `CardBlock` | `card` | Yes — approve/reject actions, status badge |
| `ChartBlock` | `chart` | No — rendered by gifted-charts |
| `HtmlBlock` | `html` | Configurable — WebView, JS off by default |

### Installed Dependencies (App)

| Package | Version | Purpose |
|---------|---------|---------|
| expo | ~56.0.8 | React Native framework |
| expo-router | ~56.2.8 | File-based routing (3 tabs) |
| expo-sqlite | ~56.0.4 | Local persistence |
| expo-audio | ~56.0.11 | Voice record + playback |
| expo-file-system | ~56.0.7 | File download + cache |
| expo-image-picker | ~56.0.15 | Photo picker |
| expo-document-picker | ~56.0.4 | File picker |
| expo-image | ~56.0.9 | Image display |
| expo-secure-store | ~56.0.4 | Token storage (Keystore) |
| react-native-svg | 15.15.4 | Voice waveform + chart SVGs |
| react-native-gifted-charts | ^1.4.77 | Chart blocks |
| react-native-webview | 13.16.1 | Sandboxed HTML blocks |
| zustand | ^5.0.14 | State management |
| zod | ^4.4.3 | Schema validation |

### Installed Dependencies (Bridge)

```
fastapi>=0.115, uvicorn[standard]>=0.32, websockets>=13, pydantic>=2.9,
pydantic-settings>=2.5, httpx>=0.27, aiosqlite>=0.20, python-multipart>=0.0.12,
qrcode[pil]>=7.4
```

---

## Wire Protocol (`protocol.ts` — 385 lines, Zod)

### Frame Envelope
```typescript
{ v: 1, id: ULID(26-char), ts: epoch-ms, chat: string, from: "user"|"agent", kind: string, ... }
```

### Frame Kinds
`hello`, `ping`, `pong`, `message` (user/agent blocks), `stream` (token deltas), `typing` (start/stop), `receipt` (delivered), `event` (action/submit), `edit` (patch blocks), `error`

### Block Types (11)
`text` (markdown), `file` (image/doc), `voice` (waveform+play), `buttons` (tap-to-choose), `input` (single text), `slider` (numeric range), `select` (pick from list), `form` (multi-field submit), `chart` (line/bar/area/pie), `html` (sandboxed WebView), `card` (approval with actions)

---

## Conversation Flow (M1)

```
1. User types "hello" → app sends message frame to Bridge WS
2. Bridge persists, sends receipt(delivered), fans out to other devices
3. Bridge builds chat history from frame_log, calls Hermes streaming API
   POST /v1/chat/completions with X-Hermes-Session-Id: <chat>
4. Bridge emits: typing(start) → stream(delta)×N → stream(done) → message(full) → typing(stop)
5. App shows animated dots during typing, live-updates bubble with deltas
```

## Event Round-Trip (M3)

```
1. Agent calls ui_card(title="Send email?", actions=[Accept/Reject])
2. Plugin POSTs to Bridge /internal/ui → Bridge broadcasts to app
3. App renders CardBlock with pending status
4. User taps "Accept" → app sends event frame {type:"action", source:cardId, name:"Accept"}
5. Bridge receives event, formats as "The user selected Accept", feeds to Hermes
6. Hermes processes, calls ui_update(msgId, blockId, patch={status:"approved"})
7. CardBlock re-renders with green "Approved" badge
```

---

## Running

### Bridge (on the Pi)

```bash
cd hermes-mobile-gateway
source .venv/bin/activate

# Set required env vars
export BRIDGE_INTERNAL_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
export BRIDGE_PUBLIC_URL="wss://your-tunnel.example.com"

# Start
python3 -m uvicorn bridge.main:app --host 127.0.0.1 --port 8787
# Or: bridge serve --host 127.0.0.1 --port 8787
```

### Pairing a Device

```bash
source .venv/bin/activate
bridge pair --label "Anand's Phone"
# Prints QR code + manual entry payload
```

### App (on dev machine, connected to Android)

```bash
cd hermes-mobile-gateway/app
npx expo start
# Scan QR with Expo Go, or: npx expo run:android
```

### Run as a systemd service (production)

```bash
# 1. Fill in secrets + tunnel hostname
cp bridge/systemd/hermes-bridge.env.example bridge/systemd/hermes-bridge.env
$EDITOR bridge/systemd/hermes-bridge.env      # set BRIDGE_INTERNAL_TOKEN, BRIDGE_PUBLIC_URL
chmod 600 bridge/systemd/hermes-bridge.env

# 2. Install + start the unit
sudo cp bridge/systemd/hermes-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-bridge
systemctl status hermes-bridge
journalctl -u hermes-bridge -f             # follow logs
```

The unit binds `127.0.0.1:8787`, restarts on failure (`RestartSec=3`), runs from
the project workdir, and reads secrets from the `EnvironmentFile`. It is hardened
with `ProtectSystem=strict` + `ProtectHome=read-only`, writing only to
`~/.hermes/bridge` (db, uploads, allowlist).

### Cloudflare Tunnel

The Bridge never exposes its port; `cloudflared` is the only public path. Use the
example ingress config (it passes WebSockets through transparently):

```bash
cloudflared tunnel login
cloudflared tunnel create hermes-bridge        # prints the <TUNNEL_UUID>

# Fill in the UUID + hostname, then install at ~/.cloudflared/config.yml
cp bridge/cloudflared/cloudflared-config.yml ~/.cloudflared/config.yml
$EDITOR ~/.cloudflared/config.yml

cloudflared tunnel route dns hermes-bridge hermes.example.com
cloudflared tunnel run hermes-bridge
# Or install it as its own service: sudo cloudflared service install
```

Set `BRIDGE_PUBLIC_URL=wss://hermes.example.com` so pairing QR codes point the
app at the tunnel.

---

## Adding a New Block Type

1. **`protocol.ts`** — Add Zod variant + register in `Block` union (both bridge and app copies)
2. **`bridge/gen_schema.ts`** — Regenerate: → `bridge/protocol.schema.json` → `bridge/pydantic_schema.py`
3. **`app/src/sdui/blocks/NewBlock.tsx`** — React Native component
4. **`app/src/sdui/BlockRenderer.tsx`** — Import + add `case "newtype"`
5. **(Optional) `plugin/app-ui/__init__.py`** — Add a `handle_*` + schema and register `ui_newtool()` if the agent should emit it (reinstall to `~/.hermes/plugins/app-ui/`)

---

## Remaining Work

### M4 — Rich Blocks ✅
- [x] `ChartBlock.tsx` — line/bar/area/pie via react-native-gifted-charts
- [x] `HtmlBlock.tsx` — sandboxed WebView with strict CSP (JS off by default)

### M5 — Hardening & Polish ✅
- [x] Systemd unit for the Bridge (`bridge/systemd/hermes-bridge.service`)
- [x] Rate limiting — token bucket on WS frames, WS connects, and `/internal/ui`
- [x] Per-message block-count cap + per-frame size cap (drop + log)
- [x] Cloudflared tunnel config (`bridge/cloudflared/cloudflared-config.yml`)
- [x] Block error boundaries (no white screen on a bad block)
- [x] Offline banner + dismissable error banner (structured error frames)
- [x] Secure-store token rotation on auth failure (WS close 4401)
- [x] Friendly errors for upload / playback / pairing failures
- [x] README final cleanup

### Needs the full running stack to verify (manual QA)
- [ ] Build + run the dev client on a physical Android device
- [ ] End-to-end reconnect/replay with airplane-mode toggling (no dupes/loss)
- [ ] Pixel diff against `design/hermes-design.html` on-device (tokens matched in code)
- [ ] Agent uses `ui_*` tools unprompted via the installed skill

---

## Environment

- **Pi:** Raspberry Pi 5, Python 3.11.15, Node v22.22.3 (at ~/.hermes/node/bin/)
- **App dev:** Expo SDK 56, TypeScript strict, Android target
- **Package managers:** uv (Python), npm (JS/TS)
- **Hermes plugin:** `~/.hermes/plugins/app-ui/` (package: `__init__.py` + `HERMES_UI.skill.md` + `plugin.yaml`)

## Claude Code Sessions

| Session | Milestone | Model | Effort | Turns | Cost | Duration |
|---------|-----------|-------|--------|-------|------|----------|
| 1 | M0 | opus | medium | 41 | $3.50 | 8 min |
| 2 | M1 | opus | medium | 41 | $3.24 | 6 min |
| 3 | M2 | opus | medium | 51 | $5.29 | 10 min |
| 4 | M3 | opus | low | 51 | $5.29 | 12 min |
| 5 | M4 | opus | low | — | $4.62 | — |
| 6 | M5 | opus | medium | — | $6.33 | — |
| 7 | Verify | opus | medium | — | $1.66 | — |
| 8 | Fixes | opus | medium | — | $4.38 | — |

**Total: 8 sessions, $34.31**

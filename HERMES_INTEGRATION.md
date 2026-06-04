# Hermes Mobile Gateway — Integration Spec & Updated Build Instructions

> Companion to `BUILD_PLAN.md`. This document is the result of reading the **actual
> Hermes Agent source** (`gateway/`, `agent/`, `tools/`, `toolsets.py`, `cron/`,
> `hermes_cli/`). It tells you **exactly where the Telegram-grade features live**, why
> your current bridge-only plan will silently lose most of them, and the precise files
> to change so your gateway inherits *every* Telegram feature — system prompts,
> confirmation dialogs, approval/clarify/model pickers, voice, files, cron delivery.
>
> Read §1 first. It changes the architecture of the whole app.

---

## 1. The decision that reframes your plan

Your `BUILD_PLAN.md` connects the app to Hermes through the **OpenAI-compatible API**
(`POST /v1/chat/completions` + a custom Bridge). That treats Hermes as a black box. **The
problem: nearly every "Telegram feature" you listed does not live in the API — it lives in
the gateway adapter layer.** If you only speak chat-completions, you get streamed text and
nothing else.

Here is where the features actually live in the repo:

| Feature you asked for | Where it lives | Reachable from `/v1/chat/completions`? |
|---|---|---|
| **System prompt per platform** ("you're on Telegram, markdown renders…") | `agent/prompt_builder.py` → `PLATFORM_HINTS` | ❌ only when a real platform/session is set |
| **Command-execution approval dialog** (Allow Once / Session / Always / Deny) | `tools/approval.py` + adapter `send_exec_approval()` | ⚠️ partial — only via `/v1/runs` SSE, not chat-completions |
| **Slash-command confirmation** (Approve Once / Always / Cancel) | gateway `_request_slash_confirm` + adapter `send_slash_confirm()` | ❌ |
| **Clarify prompt** (multiple-choice buttons or free text) | `tools/clarify_gateway.py` + adapter `send_clarify()` | ❌ |
| **Model picker / profile picker** | adapter `send_model_picker()` | ❌ |
| **Voice in/out** (whisper STT, edge-tts TTS) | gateway media pipeline + adapter `send_voice()` | ❌ |
| **Native files** (image/doc/video/animation) | adapter `send_image/document/video/animation()` | ❌ |
| **Typing indicator + mid-flight "still working" bubble** | adapter `send_typing()` / `_keep_typing()` | ❌ |
| **In-place message edit / delete (approval card flips state)** | adapter `edit_message()` / `delete_message()` | ❌ |
| **Cron / scheduled delivery to your app** | `cron/scheduler.py` `platform_map` | ❌ |
| **`send_message` tool targeting your app from other sessions** | `tools/send_message_tool.py` | ❌ |
| **Session continuity, auth allowlist, rate limits, redaction** | gateway `run.py` / `session.py` | ❌ |

**Conclusion: build your gateway as a first-class Hermes _platform adapter_, not as an
external bridge bolted onto the chat API.** The adapter is a subclass of
`BasePlatformAdapter` (`gateway/platforms/base.py`). The gateway framework then hands you —
for free — system prompts, the three confirmation primitives, voice, files, cron, the
`send_message` tool, auth, rate-limiting, and log redaction. You implement ~7 methods; you
inherit ~30 behaviors.

### What this means concretely for your three components

- The **RN app + Cloudflare Tunnel + WebSocket** design stays exactly as you planned. Good.
- The **"Bridge"** is no longer a separate process that calls the OpenAI API. Instead it
  becomes the **network transport _inside_ a Hermes platform adapter** — your adapter owns a
  WebSocket/HTTP server (the existing `gateway/platforms/api_server.py` already does this
  pattern with `aiohttp`), and `cloudflared` points at it. The adapter calls
  `self.handle_message(event)` to push inbound turns into Hermes and implements `send*()` to
  push outbound frames to the app.
- Your **`ui_*` plugin tools and SDUI blocks** still exist — but now they're the *render
  target* for the gateway's built-in primitives, not a parallel system you maintain by hand.
  An exec-approval becomes a `card` block; a clarify becomes a `buttons` block; etc. (see §4).

> **Two ways to ship the adapter** (`gateway/platforms/ADDING_A_PLATFORM.md`):
> 1. **Plugin** (recommended, zero core edits): drop a dir in `~/.hermes/plugins/` with
>    `plugin.yaml` + `adapter.py`, call `ctx.register_platform(...)` in `register(ctx)`.
>    Working examples: `plugins/platforms/irc/`, `teams/`, `google_chat/`, `line/`.
> 2. **Built-in** (core fork): `gateway/platforms/<you>.py` + the 16-point checklist below.
>
> **Use the plugin path.** It gives you everything with no merge-conflict surface against
> upstream Hermes. Fall back to built-in only if you need something the plugin hooks can't
> reach.

---

## 2. The adapter contract (what you must implement)

From `gateway/platforms/base.py`. Subclass `BasePlatformAdapter`.

### Required (gateway will not function without these)
| Method | Your gateway's job |
|---|---|
| `__init__(self, config)` | parse config; `super().__init__(config, Platform.HERMES_MOBILE)` |
| `connect() -> bool` | start the aiohttp WS/HTTP server + cloudflared-facing listener |
| `disconnect()` | stop server, cancel tasks, close sockets |
| `send(chat_id, text, ...) -> SendResult` | push a `message`/`stream` frame to the app |
| `send_typing(chat_id)` | push a `typing` frame |
| `send_image(chat_id, image_url, caption)` | push a `file` block (image) |
| `get_chat_info(chat_id) -> dict` | `{name, type, chat_id}` |

### Optional but needed for "all Telegram features" (override the base stubs)
| Method | Maps to your SDUI |
|---|---|
| `send_document / send_voice / send_video / send_animation / send_image_file` | `file` / `voice` blocks |
| `send_multiple_images` | album → multiple `file` blocks |
| `edit_message(chat_id, message_id, …)` | **`edit` frame — in-place block patch (approval card pending→approved)** |
| `delete_message(chat_id, message_id)` | `delete` frame |
| **`send_exec_approval(...)`** | **`card` block, 4 actions: Allow Once / Session / Always / Deny** |
| **`send_slash_confirm(...)`** | **`card` block, 3 actions: Approve Once / Always / Cancel** |
| **`send_clarify(...)`** | **`buttons` block (choices + "Other") OR plain text (open-ended)** |
| `send_model_picker(...)` | `select` or grouped `buttons` block |
| `send_draft(...)` | optional streaming-draft bubble |
| `_keep_typing(...)` | mid-flight "still working" bubble (override per your latency) |

### Plumbing you call (don't reimplement)
- `self.handle_message(event)` — dispatch an inbound user turn into Hermes.
- `self.build_source(...)` — construct the `SessionSource` (identity → session).
- `MessageEvent`, `MessageType`, `SendResult` — the data types.
- `cache_image_from_bytes`, `cache_audio_from_bytes`, `cache_document_from_bytes` — attachments.
- `MAX_MESSAGE_LENGTH` — set if your app caps message size.

---

## 3. The three confirmation primitives (this is your "alerts / dialogs")

All three follow the **same round-trip you already designed for interactive blocks**, so your
`event` frame protocol is correct — you just wire it to the gateway's resolver functions
instead of inventing your own.

### 3.1 Exec approval (the big one — agent wants to run a shell command/tool)
- Core: `tools/approval.py` → `register_gateway_notify(session_key, cb)` /
  `resolve_gateway_approval(session_key, choice, scope)`.
- Flow in `gateway/run.py` (~L17789): when the agent hits a gated action, the gateway calls
  your adapter's `send_exec_approval(chat_id, command, session_key, …)`.
- **You do:** render a `card` block (title "⚠️ Command Approval Required", body = the command,
  status `pending`, actions `["Allow Once","Session","Always","Deny"]`). Stash
  `approval_id → session_key`.
- **On user tap:** the `event` frame arrives at your adapter; call
  `resolve_gateway_approval(session_key, choice)` where `choice ∈ {once, session, always, deny}`.
  Then `edit` the card to `status: approved|denied` so it flips in place.
- See the reference: `gateway/platforms/telegram.py` `send_exec_approval` (L2649) builds the
  exact 4-button keyboard with `callback_data="ea:once:{id}"` etc.; `api_server.py` exposes the
  same thing over HTTP as `POST /v1/runs/{run_id}/approval` + an SSE `approval.request` event
  (L3679) with `"choices": ["once","session","always","deny"]`.

### 3.2 Slash confirm (expensive but non-destructive slash command, e.g. `/reload-mcp`)
- Core: `GatewayRunner._request_slash_confirm` (`gateway/run.py` L14393) →
  `_resolve_slash_confirm(confirm_id, choice)` where `choice ∈ {once, always, cancel}`.
- You render a 3-action `card`; tap → `_resolve_slash_confirm(...)` → `edit` the card.
- Reference: `telegram.py` `send_slash_confirm` (L2721), buttons `sc:once / sc:always / sc:cancel`.

### 3.3 Clarify (agent needs the user to disambiguate)
- Core: `tools/clarify_gateway.py` → `resolve_gateway_clarify(clarify_id, response)` +
  `mark_awaiting_text(clarify_id)`.
- Two modes (base `send_clarify` docstring, L2401):
  - **Multiple choice** → `buttons` block, one per choice + an "Other" button. Choice tap →
    `resolve_gateway_clarify(clarify_id, chosen)`. "Other" → `mark_awaiting_text(...)` and the
    next user message becomes the answer.
  - **Open-ended** → plain `text` block; the gateway's text-intercept captures the next reply.
- Reference: `telegram.py` `send_clarify` (L2769).

> **Design payoff:** all three are just `card`/`buttons` blocks + your existing `event`
> round-trip + an `edit` to flip state. Your SDUI in `BUILD_PLAN §3` already covers the
> rendering. The only new work is calling the right `resolve_*` function on tap.

---

## 4. System prompts — the feature you explicitly asked for

`agent/prompt_builder.py` holds `PLATFORM_HINTS: dict[str,str]` (L443). Each platform gets a
hint injected into the system prompt so the agent formats correctly. Examples in-tree:

- `telegram` (L454): "Standard markdown is auto-converted… **bold**, *italic*, spoilers, code
  blocks, links, ## headers. Telegram has NO table syntax…"
- `whatsapp` (L444): "do not use markdown… send media with `MEDIA:/abs/path`…"
- `api_server` (L604): "rendering layer is unknown — assume plain text, no markdown."

**Your gateway renders full SDUI (markdown, charts, HTML, cards), so write a hint that says
so.** Add an entry like:

```python
"hermes_mobile": (
    "You are on Hermes Mobile, a rich app client. GitHub-flavored markdown renders "
    "(bold, italic, lists, tables, code blocks, links). You can emit interactive UI via "
    "the ui_* tools: ui_buttons, ui_form, ui_card, ui_chart, ui_html, ui_select, ui_slider, "
    "ui_voice, ui_update. Prefer a ui_card with actions when you need the user to approve or "
    "choose. Native media: deliver files inline. Voice replies are supported."
),
```
- **Plugin path:** the registry applies your hint via the platform's `system_prompt_hint`
  (see `register_platform` kwargs in `plugins/platforms/irc/adapter.py:928`). No core edit.
- **Built-in path:** add the entry directly to `PLATFORM_HINTS`.

There is also `WSL_ENVIRONMENT_HINT` (L630) and OS-level hints — those are inherited
automatically; don't touch them.

---

## 5. Built-in integration checklist (only if you fork core instead of plugin)

Straight from `gateway/platforms/ADDING_A_PLATFORM.md` — every point is a real wire that
breaks a feature if skipped. **If you use the plugin path, the registry does almost all of
these for you; this table is your fallback / verification map.**

| # | File | Change | Feature it unlocks |
|---|---|---|---|
| 1 | `gateway/platforms/hermes_mobile.py` | the adapter (see §2) | everything |
| 2 | `gateway/config.py` | add `Platform.HERMES_MOBILE`; env loading in `_apply_env_overrides()`; update `get_connected_platforms()` | enable/discovery |
| 3 | `gateway/run.py` | `_create_adapter()` branch | adapter instantiation |
| 4 | `gateway/run.py` | `_is_user_authorized()` both maps (`*_ALLOWED_USERS`, `*_ALLOW_ALL_USERS`) | auth allowlist |
| 5 | `gateway/session.py` | extra identity fields on `SessionSource` if needed | session mapping |
| 6 | `agent/prompt_builder.py` | `PLATFORM_HINTS` entry | **system prompt (§4)** |
| 7 | `toolsets.py` | `hermes-hermes-mobile` toolset + add to `hermes-gateway` composite | tool availability |
| 8 | `cron/scheduler.py` | `platform_map` entry | **scheduled delivery to app** |
| 9 | `tools/send_message_tool.py` | `platform_map` + `_send_to_platform()` branch + standalone `_send_hermes_mobile()` | **agent-initiated push from other sessions** |
| 10 | `tools/cronjob_tools.py` | mention platform in `deliver` schema/docstring | cron UX |
| 11 | `gateway/channel_directory.py` | add to session-based discovery list | chat enumeration |
| 12 | `hermes_cli/status.py` | `platforms` dict entry | `hermes gateway status` |
| 13 | `hermes_cli/gateway.py` | `_PLATFORMS` entry (+ `_setup_*` for QR pairing) | setup wizard |
| 14 | `agent/redact.py` | regex for device tokens / identifiers | log redaction |
| 15 | docs | `README.md`, `AGENTS.md`, `website/docs/user-guide/messaging/<you>.md`, `environment-variables.md` | docs |
| 16 | `tests/gateway/test_hermes_mobile.py` | enum, config, adapter init, session round-trip, auth maps, send routing | CI |

Verification (from the doc):
```bash
python -m pytest tests/ -q
grep -rl "telegram\|whatsapp\|slack" gateway/ tools/ agent/ cron/ hermes_cli/ toolsets.py --include="*.py" | sort -u
# any file that mentions other platforms but not yours = a missed wire
```

---

## 6. What the existing `api_server.py` already gives you (don't rebuild it)

`gateway/platforms/api_server.py` (4200 lines) is itself a platform adapter that runs an
`aiohttp` server. **Read it as your scaffold** — it already solves: auth via `API_SERVER_KEY`,
CORS, request-size caps, SSE streaming, session CRUD (`/api/sessions/*`), run lifecycle
(`/v1/runs`, `/v1/runs/{id}/events` SSE, `/v1/runs/{id}/stop`), **approval over HTTP
(`POST /v1/runs/{id}/approval` + `approval.request` SSE event)**, and a machine-readable
`GET /v1/capabilities` (L1069) advertising `approval_events`, `run_events_sse`,
`X-Hermes-Session-Id`, etc.

What it **lacks** for your app and you must add in your adapter:
- a **WebSocket** (it's HTTP+SSE only) — add `web.WebSocketResponse` for your `hello`/heartbeat/replay protocol.
- **interactive blocks** (`buttons/form/card/chart/html`) — it returns plain text; you emit SDUI.
- **slash-confirm & clarify** over the wire (it only does run-approval).
- **voice/file** native handling (it advertises `audio_api: False, realtime_voice: False`).

**Recommended structure:** write your adapter as a sibling of `api_server.py`, reuse its
helpers (`_normalize_chat_content`, image-part parsing at L171–306, the run/approval scaffolding
at L3508–3800), and add the WS + SDUI layer on top. This collapses your separate "Bridge"
process into the Hermes gateway — one fewer moving part, and you inherit auth/limits/redaction.

---

## 7. Updated milestones (supersedes BUILD_PLAN §7)

- **M0 — Adapter skeleton + transport.** Plugin dir `~/.hermes/plugins/hermes_mobile/`
  (`plugin.yaml` + `adapter.py`); `register(ctx)` calls `ctx.register_platform(...)` with your
  `Platform`, system-prompt hint, env-enablement, cron var. Adapter starts an aiohttp WS server;
  `cloudflared` ingress → `127.0.0.1:<port>`. QR pairing mints + hashes a device token.
  *Demo: `hermes gateway status` shows your platform; app connects WS over the tunnel; hello/ping/pong.*
- **M1 — Text chat e2e through the gateway.** Inbound `message` frame → `self.handle_message()`
  → Hermes runs with your `PLATFORM_HINTS` system prompt → stream tokens back as `stream` frames
  via `send()`. Typing via `send_typing()`. Outbox + reconnect replay. *Demo: real streamed
  conversation; survives airplane-mode; agent formats for your rich client.*
- **M2 — Files & voice.** `send_image/document/video/animation/voice`; inbound voice uploaded then
  transcribed via Hermes whisper; outbound TTS via edge-tts → `voice` block with waveform.
  *Demo: photo, PDF, and a voice note the agent transcribes and replies to.*
- **M3 — Confirmation primitives (the headline feature).** Implement `send_exec_approval`,
  `send_slash_confirm`, `send_clarify`, `send_model_picker` as `card`/`buttons`/`select` blocks;
  wire taps to `resolve_gateway_approval` / `_resolve_slash_confirm` /
  `resolve_gateway_clarify`; `edit_message` flips card state in place. *Demo: agent asks to run a
  command → approval card → "Allow Once" → card flips to ✅ and the agent continues.*
- **M4 — Rich SDUI + agent-initiated UI.** `ui_*` plugin tools (`app_ui.py`) push `buttons/form/
  chart/html` blocks; `send_message` tool + cron can target your app. *Demo: agent renders a chart
  and a scheduled morning-briefing card.*
- **M5 — Hardening.** Reuse `api_server.py`'s caps/CORS/redaction; rate-limit WS frames; auth
  failure → WS close `4401` → re-pair; systemd + cloudflared config; tests per §5.16.

---

## 8. Acceptance additions (beyond BUILD_PLAN §8)

- [ ] Adapter registers via `register_platform()` and shows in `hermes gateway status`.
- [ ] System prompt hint is injected (verify the agent knows it's on "Hermes Mobile" and uses ui_* tools unprompted).
- [ ] **Exec approval** round-trips through `resolve_gateway_approval` and the card flips state.
- [ ] **Slash confirm** (`/reload-mcp`) and **clarify** both render + resolve through the gateway resolvers.
- [ ] Model picker works (`send_model_picker`).
- [ ] Voice both directions through Hermes whisper/edge-tts (no ASR in your code).
- [ ] `send_message` tool and a `deliver=hermes_mobile` cron job both reach the app.
- [ ] Device tokens hashed + revocable; WS reachable only via tunnel; log redaction covers tokens.

---

## 9. One-paragraph prompt for the coding agent (drop-in)

> Build **Hermes Mobile** as a **Hermes gateway _platform adapter_** (plugin path:
> `~/.hermes/plugins/hermes_mobile/` with `plugin.yaml` + `adapter.py` subclassing
> `BasePlatformAdapter` and registering via `ctx.register_platform(...)`), **not** as an
> external bridge over `/v1/chat/completions`. Use `gateway/platforms/api_server.py` as the
> scaffold for the aiohttp server, auth, CORS, size caps, SSE, run/approval handling, and
> session CRUD; add a **WebSocket** layer for the app's `hello`/heartbeat/replay/outbox
> protocol and a **server-driven-UI** block system (`text, file, voice, buttons, input,
> slider, select, form, chart, html, card`). Implement the adapter contract from
> `gateway/platforms/base.py`: required `connect/disconnect/send/send_typing/send_image/
> get_chat_info`, plus override `send_document/voice/video/animation`, `edit_message`,
> `delete_message`, and — critically — the three confirmation primitives `send_exec_approval`
> (card, 4 actions, resolves via `tools/approval.py:resolve_gateway_approval`),
> `send_slash_confirm` (card, 3 actions, resolves via
> `GatewayRunner._resolve_slash_confirm`), and `send_clarify` (buttons+Other or open text,
> resolves via `tools/clarify_gateway.py:resolve_gateway_clarify` / `mark_awaiting_text`),
> plus `send_model_picker`. Render each as a `card`/`buttons`/`select` block and flip state
> with an `edit` frame on resolution. Add a `PLATFORM_HINTS`-style system-prompt hint
> (via the registry, or `agent/prompt_builder.py` if built-in) telling the agent it's on a
> rich client that supports markdown + `ui_*` tools. Wire cron delivery
> (`cron/scheduler.py` platform_map), the `send_message` tool
> (`tools/send_message_tool.py`), a toolset (`toolsets.py` → add to `hermes-gateway`), auth
> maps and config enum (`gateway/run.py`, `gateway/config.py`), status/wizard
> (`hermes_cli/status.py`, `gateway.py`), and token redaction (`agent/redact.py`). Reuse
> Hermes' faster-whisper STT and edge-tts TTS for voice both directions — ship no ASR of your
> own. Validate every WS frame against the shared `protocol.ts`/pydantic schema on both ends;
> drop malformed frames. Device pairing mints a 32-byte token, stores only its hash
> (revocable), and the bridge binds `127.0.0.1` behind `cloudflared`. Follow the milestones
> M0–M5 in `HERMES_INTEGRATION.md §7`; each must run before the next.

---

## 10. Reference file index (read these in this order)

1. `gateway/platforms/ADDING_A_PLATFORM.md` — the integration checklist (plugin + built-in).
2. `plugins/platforms/irc/adapter.py` + `plugin.yaml` — smallest complete plugin adapter.
3. `plugins/platforms/line/` — advanced: time-window UX, `_keep_typing` override, `/stop`.
4. `gateway/platforms/base.py` — the full `BasePlatformAdapter` contract (all `send_*` stubs).
5. `gateway/platforms/api_server.py` — aiohttp server scaffold + run/approval/SSE/session CRUD.
6. `gateway/platforms/telegram.py` — reference renderings of approval/slash/clarify/model-picker.
7. `tools/approval.py`, `tools/clarify_gateway.py` — the resolver functions you must call.
8. `agent/prompt_builder.py` — `PLATFORM_HINTS`.
9. `gateway/run.py` — orchestration: `_create_adapter`, `_is_user_authorized`, `_request_slash_confirm`.
10. `cron/scheduler.py`, `tools/send_message_tool.py` — outbound/scheduled delivery wiring.

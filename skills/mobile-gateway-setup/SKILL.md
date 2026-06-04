---
name: mobile-gateway-setup
version: 1.0.0
description: >
  Set up, install, repair, or bring online the Hermes Mobile Gateway — the
  Telegram-style phone app that talks to this Hermes agent through a FastAPI
  Bridge and (optionally) a Cloudflare Tunnel. Use this whenever the user says
  things like "set up the mobile gateway", "install the hermes app bridge",
  "connect my phone to Hermes", "the gateway/app won't connect", "pair my
  device", or "get the mobile gateway working". Walks every component end to
  end (Hermes API server → Bridge → plugin/skill → tunnel → pairing → app) and
  includes a troubleshooting table for the common failures.
---

# Mobile Gateway — Setup & Repair Runbook

You are configuring the **Hermes Mobile Gateway**: a phone app (Expo/React
Native, Android) that reaches this Hermes agent through a small **FastAPI
Bridge** running next to Hermes, optionally exposed via a **Cloudflare Tunnel**.

```
Phone app ──wss/https──►  Cloudflare Tunnel ──►  Bridge (127.0.0.1:8787) ──►  Hermes API server (127.0.0.1:8642)
                                                        ▲  POST /internal/ui        │ app-ui plugin (ui_* tools)
                                                        └───────────────────────────┘
```

Components and where they live:

| Component | Location | Role |
|---|---|---|
| Hermes **API server** | this host, `127.0.0.1:8642` | the OpenAI-compatible `/v1/chat/completions` the Bridge drives |
| **Bridge** | `~/hermes-mobile-gateway/bridge`, binds `127.0.0.1:8787` | WebSocket hub + file server; relays app ↔ Hermes |
| **app-ui plugin + skills** | `~/.hermes/plugins/app-ui/`, `~/.hermes/skills/` | lets the agent emit interactive UI; tells it when to |
| **Cloudflare Tunnel** | `cloudflared` on this host | sole public entry point (TLS, origin hidden) |
| **App** | the user's Android phone | chat UI + interactive blocks |

> **Work in the project directory.** Default `~/hermes-mobile-gateway`. If it
> lives elsewhere, find it: `ls bridge/main.py app/app.json` should both exist.
> Python is `python3` (3.11+); the Bridge venv is `.venv/`. Node/npm for the app.

Do the steps **in order**. Each ends with a check; don't continue past a failed
check — jump to **Troubleshooting** at the bottom.

---

## Step 1 — Hermes API server must be running with a key

The Bridge calls Hermes' OpenAI-compatible API. Hermes **refuses to start the
API server without `API_SERVER_KEY`**, and it defaults to **port 8642**.

```bash
# 1. Make sure the api_server platform is enabled and keyed.
#    In ~/.hermes/config.yaml (or via env), the api_server platform must be on
#    and API_SERVER_KEY set. Generate a key if there isn't one:
openssl rand -hex 32          # use as API_SERVER_KEY

# 2. Confirm it answers (replace <KEY>):
curl -fsS -H "Authorization: Bearer <KEY>" http://127.0.0.1:8642/v1/models
```

**Expected:** a JSON list containing `hermes-agent`. **Note the real port** —
it is `8642` by default (env `API_SERVER_PORT`), *not* 4700. Record `<KEY>` and
the port; the Bridge needs both in Step 2.

---

## Step 2 — Configure & install the Bridge

```bash
cd ~/hermes-mobile-gateway

# Create the venv + install deps (uv preferred; pip works too).
python3 -m venv .venv && . .venv/bin/activate
pip install -e ./bridge            # installs the `bridge` CLI + deps

# Generate the shared internal token (the plugin must use the SAME value).
INTERNAL=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo "internal token: $INTERNAL"
```

Create the env file `bridge/systemd/hermes-bridge.env` (copy the `.example`):

```bash
# bridge/systemd/hermes-bridge.env   — chmod 600 after editing
BRIDGE_INTERNAL_TOKEN=<INTERNAL from above>
BRIDGE_PUBLIC_URL=wss://hermes.example.com     # your tunnel hostname (Step 5)
BRIDGE_HERMES_URL=http://127.0.0.1:8642        # <-- the REAL api-server port
BRIDGE_HERMES_KEY=<API_SERVER_KEY from Step 1> # REQUIRED or Hermes returns 401
```

> ⚠️ The committed `.example` shows `BRIDGE_HERMES_URL=http://127.0.0.1:4700`
> and omits the key. Both are wrong for a default Hermes install — set
> `8642` and `BRIDGE_HERMES_KEY`, or the agent will connect but never reply.

**Check:**
```bash
chmod 600 bridge/systemd/hermes-bridge.env
. .venv/bin/activate && set -a && . bridge/systemd/hermes-bridge.env && set +a
```

---

## Step 3 — Run the Bridge

**Foreground (dev / first run):**
```bash
bridge serve            # or: python3 -m bridge.cli serve   (binds 127.0.0.1:8787)
```

**As a service (production):**
```bash
sudo cp bridge/systemd/hermes-bridge.service /etc/systemd/system/
# Edit the unit's WorkingDirectory/User/paths if not the defaults, then:
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-bridge
journalctl -u hermes-bridge -f      # watch for "Uvicorn running on 127.0.0.1:8787"
```

**Check:**
```bash
curl -fsS http://127.0.0.1:8787/health     # -> {"ok": true, "service": "hermes-bridge", ...}
```

---

## Step 4 — Install the app-ui plugin + skills (so dialogs work)

The app's whole point is interactive UI (buttons, approval cards, forms). Two
ways the agent produces it; **Path A works with no Hermes config**, Path B is
the richer native route. Do A always; add B if you want native `ui_*` tools.

**Path A — fenced-block UI (default, zero config).** Already built into the
Bridge: it injects a system prompt teaching the agent the UI protocol
(`BRIDGE_UI_SYSTEM_PROMPT=1`, the default). Verify the pipeline:
```bash
cd ~/hermes-mobile-gateway && python3 -m bridge.test_fenced_ui
# -> "All fenced-UI checks passed."
```

**Path B — native ui_* plugin tools (optional, recommended).**
```bash
# 1. Install the plugin package.
cp -r plugin/app-ui ~/.hermes/plugins/app-ui

# 2. Make the skills visible in the agent's prompt index. The indexer ONLY
#    discovers files named SKILL.md inside a per-skill directory — flat
#    *.skill.md files are never picked up. So install as <name>/SKILL.md:
mkdir -p ~/.hermes/skills/hermes-mobile-ui \
         ~/.hermes/skills/mobile-gateway-setup \
         ~/.hermes/skills/mobile-gateway-usage
cp plugin/app-ui/HERMES_UI.skill.md      ~/.hermes/skills/hermes-mobile-ui/SKILL.md
cp skills/mobile-gateway-setup/SKILL.md  ~/.hermes/skills/mobile-gateway-setup/SKILL.md
cp skills/mobile-gateway-usage/SKILL.md  ~/.hermes/skills/mobile-gateway-usage/SKILL.md

# 3. The plugin needs the SAME internal token + the Bridge URL + default chat.
#    Put these in the Hermes agent's environment (e.g. ~/.hermes/.env or the
#    hermes service EnvironmentFile):
#      BRIDGE_INTERNAL_TOKEN=<same value as the Bridge>
#      BRIDGE_UI_URL=http://127.0.0.1:8787/internal/ui
#      BRIDGE_DEFAULT_CHAT=main

# 4. Enable the app_ui toolset for the api_server platform in ~/.hermes/config.yaml:
#      platform_toolsets:
#        api_server:
#          - hermes-api-server
#          - app_ui

# 5. Restart Hermes, then confirm:
hermes gateway status          # app-ui plugin + tools should be listed
```

> `register_skill()` from a plugin is intentionally hidden from the prompt
> index — that's why the skill is **copied into `~/.hermes/skills/`** instead.

**Check:** after restart, ask the agent to do something consequential ("draft an
email and send it"). You should get an **approval card**, not plain text. If
not, see Troubleshooting → "No dialogs".

---

## Step 5 — Cloudflare Tunnel (skip for LAN-only testing — see Step 5b)

The Bridge binds loopback only; the tunnel is the sole public path. Cloudflare
passes WebSockets through transparently.

```bash
cloudflared tunnel login
cloudflared tunnel create hermes-bridge          # prints <TUNNEL_UUID>

# Put the provided config at ~/.cloudflared/config.yml, fill UUID + hostname.
cp bridge/cloudflared/cloudflared-config.yml ~/.cloudflared/config.yml
#   edit: tunnel: <TUNNEL_UUID>, credentials-file, hostname: hermes.example.com

cloudflared tunnel route dns hermes-bridge hermes.example.com
cloudflared tunnel run hermes-bridge             # or: sudo cloudflared service install
```

> 🔒 **Critical:** the config’s first ingress rule returns 404 for `^/internal/.*`.
> Keep it. Behind cloudflared every request looks like `127.0.0.1`, so the
> Bridge can't tell local from remote — the path block is the real guard.

Set `BRIDGE_PUBLIC_URL=wss://hermes.example.com` in the Bridge env (Step 2) and
restart the Bridge so pairing QR codes carry the right hostname.

**Check:**
```bash
curl -fsS https://hermes.example.com/health     # same {"ok": true} as loopback
```

### Step 5b — LAN-only (no tunnel, fast iteration)
For testing on the same Wi-Fi: skip the tunnel, set
`BRIDGE_PUBLIC_URL=ws://<this-host-LAN-IP>:8787`, and bind the Bridge to the LAN
(`bridge serve --host 0.0.0.0`). Re-pair so the QR carries the LAN URL. Move to
the tunnel before real use — `0.0.0.0` is unencrypted and world-reachable.

---

## Step 6 — Pair the phone

```bash
bridge pair --label "my-pixel"
```
This mints a 32-byte device token, stores **only its SHA-256 hash**, and prints
a QR encoding `{tunnelUrl, deviceToken}`. In the app: **Settings → Pair**, scan
the QR. The token is shown once; the app keeps it in the Android Keystore.

Manage devices later: `bridge tokens` (list) / `bridge revoke <hash-prefix>`.

**Check:** the QR must NOT show `wss://CHANGE-ME` — if it does, `BRIDGE_PUBLIC_URL`
isn't set (Step 2/5).

---

## Step 7 — Build & run the app (Android)

The app is **Expo SDK 54** — do not bump it blindly (newer SDKs break the user's
installed Expo Go; see Troubleshooting).

```bash
cd app
npm install
npx expo start            # scan the Metro QR with Expo Go, or:
# npx expo run:android    # build a dev client (needed for mic + webview)
```

Pair (Step 6), then send "hello" — you should get a streamed-off, full-message
reply. Send a photo, a voice note, and ask for something needing approval.

---

## Final verification checklist

- [ ] `curl .../health` OK on loopback **and** through the tunnel.
- [ ] `curl -H "Authorization: Bearer <KEY>" http://127.0.0.1:8642/v1/models` OK.
- [ ] `python3 -m bridge.test_fenced_ui` passes.
- [ ] App pairs, sends/receives text.
- [ ] A consequential request yields an **approval card**; tapping Accept continues the chat.
- [ ] Photo, PDF, and voice note round-trip; voice gets transcribed.
- [ ] `/internal/*` returns 404 through the tunnel; 200 only on loopback with the token.

---

## Troubleshooting (symptom → cause → fix)

| Symptom | Cause | Fix |
|---|---|---|
| App connects, **but agent never replies** | Bridge can't reach Hermes (wrong port or missing key) | Set `BRIDGE_HERMES_URL=http://127.0.0.1:8642` and `BRIDGE_HERMES_KEY=<API_SERVER_KEY>`; restart Bridge. Verify with the curl in Step 1. |
| Bridge log: `hermes 401` | `BRIDGE_HERMES_KEY` missing/wrong | Match it to Hermes' `API_SERVER_KEY`. |
| Bridge log: `connection error` / refused | API server off or wrong port (4700 vs 8642) | Enable api_server platform; confirm `API_SERVER_PORT`. |
| **Text in, text out — no dialogs/cards** | UI prompt off, or Path B half-wired | Ensure `BRIDGE_UI_SYSTEM_PROMPT` unset/`1`; run `bridge.test_fenced_ui`; for native tools enable `app_ui` toolset + copy skill to `~/.hermes/skills/`. See `DIALOGS_SETUP.md`. |
| Card buttons do nothing | event round-trip blocked | Check Bridge log for the `event` frame; confirm the socket is `open` in the app. |
| `/internal/ui` → 401 | plugin token ≠ Bridge token | `BRIDGE_INTERNAL_TOKEN` must be identical in the Bridge env and the Hermes agent env. Compare `bridge internal-token` with the plugin's env. |
| WS won't connect through tunnel | `Authorization` header stripped on WS upgrade | Expected — the app falls back to a first-frame token. Ensure the app sends it; check the Bridge accepts (`4401` means bad token → re-pair). |
| App closes with code **4401** | device token revoked/invalid | Re-pair (`bridge pair`, scan again). The app auto-prompts re-pair. |
| App closes with **4429** | connect rate limit | Reconnect storm/probe; wait, or raise `BRIDGE_WS_CONNECT_RATE_LIMIT_PER_MIN`. |
| Expo Go: **"Incompatible SDK version"** | app SDK ≠ installed Expo Go | Keep the app on **SDK 54**; don't upgrade. `npx expo install --fix` to align packages, or build a dev client (`npx expo run:android`). |
| Crash: `NativeDatabase.prepareAsync … NullPointerException` | expo-sqlite init race / version | Ensure `getDb()` awaits `openDatabaseAsync` before any query (it does in `store/db.ts`); run `npx expo-doctor`; don't bump expo-sqlite off the SDK-54 pin. |
| Upload fails **415** | mime not in allowlist | Add it to `allowed_upload_mimes` in `bridge/config.py`. |
| Upload fails **413** | file > `BRIDGE_MAX_UPLOAD_BYTES` (50 MiB) | Raise the env var, or send a smaller file. |
| `error` banner: rate_limited | per-connection WS frame cap | Slow down, or raise `BRIDGE_WS_RATE_LIMIT_PER_MIN`. |
| QR shows `wss://CHANGE-ME` | `BRIDGE_PUBLIC_URL` unset | Set it (Step 2/5), restart Bridge, re-pair. |
| `/internal/*` reachable via tunnel | ingress block missing | Restore the `^/internal/.*` → 404 rule in `~/.cloudflared/config.yml`. |

When done, summarize to the user: the tunnel hostname, that the device is
paired, and that they can now chat + receive interactive UI. For day-to-day use,
point them at the **mobile-gateway-usage** skill.

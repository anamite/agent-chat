# Making dialogs work — interactive UI & Telegram-style approvals

This explains the fix for *"text in, text out — no dialog boxes, no proper
integration with Hermes like Telegram."* The chat transport was fine; the agent
simply never emitted any UI. There are two ways the agent can render UI (the
build plan's §4.4). **Path A now works with zero Hermes-side config.** Path B is
the "nicer" native route and needs two server-side steps.

---

## Why nothing showed up before

1. The Bridge talks to Hermes over the plain `/v1/chat/completions` API. On that
   path Hermes uses its **`api_server` platform prompt**, which literally tells
   the agent: *"assume plain text. No markdown… keep responses brief."* That
   suppresses all rich UI.
2. The `ui_*` tools were registered, but (a) Hermes only loads them if the
   **`app_ui` toolset is enabled for `api_server`** in `config.yaml`, and (b) the
   skill was registered as a *plugin skill*, which Hermes deliberately keeps
   **out of the system-prompt skill index** — so the agent never learned the
   tools existed.
3. The Bridge's fenced-block fallback (`_extract_fenced_ui`) was fully built but
   **dormant** (nothing told the agent to emit fences) and would have rejected
   the agent's output anyway, because the strict schema requires `id` fields the
   model never generates.

---

## Path A — system-prompt + fenced blocks (default, no Hermes config) ✅

Implemented in this change set:

- **`bridge/hermes.py`** now injects a system turn (`_UI_SYSTEM_PROMPT`) on every
  request that tells the agent it's on a rich mobile client, teaches it the
  ```` ```hermes-ui ```` block format, and sets the **confirmation-card
  convention** (below). This overrides the "plain text" hint.
- **`_extract_fenced_ui`** now auto-fills the `id` fields the model omits
  (`_fill_block_ids`) before validating, so cards/buttons/forms actually pass.
- **`bridge/config.py`** adds `ui_system_prompt: bool = True`
  (`BRIDGE_UI_SYSTEM_PROMPT=0` to disable).

**To activate:** just restart the Bridge. Verify the pipeline first:

```bash
cd ~/hermes-mobile-gateway
python3 -m bridge.test_fenced_ui      # should print "All fenced-UI checks passed."
sudo systemctl restart hermes-bridge  # or however you run it
```

Then ask the agent something consequential ("draft an email to Dana and send
it") — you should get an **approval card with Accept & send / Reject**. Tapping
Accept sends an `event` the agent receives as its next turn, and it continues.

---

## Path B — native `ui_*` plugin tools ("primary" per the plan)

Path A already gives you every block type. Path B lets the agent call structured
tools (`ui_card`, `ui_buttons`, …) and do true in-place card updates via
`ui_update`. It needs two things on the **Pi/Hermes** side:

### 1. Enable the `app_ui` toolset for the api_server platform

The api_server agent's toolsets come from `config.yaml` →
`platform_toolsets.api_server`. Add `app_ui` (the toolset the plugin registers
its tools under):

```yaml
platform_toolsets:
  api_server:
    - hermes-api-server   # or whatever you already have
    - app_ui
```

Confirm the plugin is installed and loaded:

```bash
ls ~/.hermes/plugins/app-ui/        # __init__.py, plugin.yaml, HERMES_UI.skill.md
hermes gateway status               # plugin/tools should appear
```

Set the env the plugin needs (must match the Bridge's internal token):

```bash
export BRIDGE_INTERNAL_TOKEN="$(hermes-bridge internal-token)"  # same value the Bridge uses
export BRIDGE_UI_URL="http://127.0.0.1:8787/internal/ui"
export BRIDGE_DEFAULT_CHAT="main"   # matches the app's DEFAULT_CHAT
```

### 2. Make the skill visible to the agent

`register_skill()` from a plugin is opt-in only and does **not** appear in the
system-prompt skill index — so install the skill into the flat skills tree so
the agent reaches for the tools unprompted:

```bash
cp ~/.hermes/plugins/app-ui/HERMES_UI.skill.md ~/.hermes/skills/HERMES_UI.skill.md
```

Restart Hermes. When `app_ui` is enabled the agent will prefer the tools; the
`_UI_SYSTEM_PROMPT` explicitly says *"if ui_* tools are available, prefer them;
otherwise use the fenced blocks"* — so the two paths never double-render.

> If you go all-in on Path B you can set `BRIDGE_UI_SYSTEM_PROMPT=0` to drop the
> injected prompt. Leaving it on is harmless and is your safety net if the
> toolset/skill wiring ever regresses.

---

## The confirmation convention (the "alerts / dialogs" you wanted)

The injected prompt instructs the agent: **before any consequential or
irreversible action** (send, delete, spend, schedule, message someone else) it
must emit a `card` with `status:"pending"` and Approve/Reject actions and then
**wait** — never act first. The user's tap returns as the agent's next turn
(`"The user selected \"approve\" …"`), and the agent then performs the action
and emits an `approved`/`rejected` card. This is the same pattern Telegram's
exec-approval buttons use, expressed through the app's `card` block.

This is an *agent-driven* approval (the agent decides to ask). It is **not** the
same as Hermes' built-in tool-execution gate (`send_exec_approval`), which lives
in the native gateway and is not exposed over `/v1/chat/completions`. If you
later want OS-level command approvals surfaced as cards too, that requires
running this as a native gateway platform adapter — see `HERMES_INTEGRATION.md`.

---

## Files changed in this fix

| File | Change |
|------|--------|
| `bridge/hermes.py` | `_UI_SYSTEM_PROMPT`, prepend it to each request, `_fill_block_ids`, id-fill in `_extract_fenced_ui` |
| `bridge/config.py` | `ui_system_prompt` toggle (`BRIDGE_UI_SYSTEM_PROMPT`) |
| `bridge/test_fenced_ui.py` | runnable verification of the fenced→blocks pipeline |
| `DIALOGS_SETUP.md` | this document |

Unchanged on purpose: the protocol (kept the evolved in-repo version), streaming
(kept OFF — full messages), the app, and the working plugin.

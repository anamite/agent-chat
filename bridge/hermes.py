"""
hermes.py — drive the Hermes conversational loop (§4.1).

On a user text message the Bridge:
  1. builds chat history from the frame log (last N messages, OpenAI format),
  2. POSTs to Hermes' OpenAI-compatible /v1/chat/completions with stream=False
     and the per-conversation `X-Hermes-Session-Id: <chat>` header,
  3. emits typing(start) -> message(full) -> typing(stop), fanning each frame
     out through the ConnectionManager.

Only the final `message` frame is persisted to the frame log, so
reconnect/replay (§4.3) yields the finished reply.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

import httpx

from .config import Settings
from .db import Database
from .ulid import new_ulid
from .whisper import TranscriptionError, transcribe

logger = __import__("logging").getLogger("bridge.hermes")

# Type alias for the broadcast sink (ws.ConnectionManager.broadcast).
from typing import Awaitable, Callable

Emit = Callable[[dict[str, Any]], Awaitable[None]]


def _now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Interactive-UI system prompt (§3 / §4.4)
# ---------------------------------------------------------------------------
#
# The Bridge talks to Hermes over the plain /v1/chat/completions API, whose
# built-in "api_server" platform hint tells the agent to reply in plain text.
# That suppresses the rich, Telegram-style UI this app is built for. We counter
# it by injecting a system turn that (a) tells the agent it is on a rich mobile
# client and (b) teaches it the fenced ```hermes-ui block protocol that the
# Bridge already parses (see _extract_fenced_ui). If the native ui_* plugin
# tools are also enabled server-side the agent may use those instead — both
# paths converge on the same blocks.
_UI_SYSTEM_PROMPT = """\
You are talking to the user through Hermes Mobile — a rich Telegram-style \
messenger app, NOT a plain-text terminal. You can render interactive UI by \
emitting a fenced code block tagged `hermes-ui` containing a JSON block (or a \
JSON array of blocks). The app renders these as real widgets after any prose \
you write; the raw JSON is never shown to the user. If `ui_*` tools are \
available to you, prefer calling them; otherwise use the fenced blocks below.

Use rich UI only when it genuinely helps — a short text reply is still the \
default. One decision per message.

CONFIRMATION (important): before doing anything consequential or hard to undo \
(sending a message/email, deleting, spending, scheduling, messaging someone \
else), DO NOT just act. First emit an approval `card` with status "pending" \
and Approve/Reject actions, then STOP and wait. On your next turn you will be \
told what the user chose; only then perform the action (and emit an updated \
card with status "approved", or acknowledge a rejection).

Block shapes (omit `id` fields — the app fills them):

Approval / status card:
```hermes-ui
{"type":"card","title":"Send follow-up email to Dana?","subtitle":"Re: Q3 renewal",
 "body":"Hi Dana — circling back on the renewal terms…","status":"pending",
 "actions":[{"label":"Reject","value":"reject","style":"danger"},
            {"label":"Accept & send","value":"approve","style":"primary"}]}
```

Tappable choices:
```hermes-ui
{"type":"buttons","buttons":[{"label":"Today","value":"today","style":"primary"},
 {"label":"Yesterday","value":"yesterday"},{"label":"This week","value":"week"}]}
```

Collect structured input (one submit):
```hermes-ui
{"type":"form","title":"New reminder","submitLabel":"Set reminder","fields":[
 {"type":"input","label":"Remind me to","placeholder":"call the bank"},
 {"type":"slider","label":"In how many hours","min":1,"max":24,"value":3},
 {"type":"select","label":"Priority","options":[{"label":"Low","value":"low"},
   {"label":"High","value":"high"}]}]}
```

Chart (kinds: line | bar | area | pie):
```hermes-ui
{"type":"chart","chartType":"bar","title":"Renewals by month",
 "labels":["Apr","May","Jun"],"series":[{"label":"2026","data":[3,5,2]}]}
```

Sandboxed HTML (no JS runs — static markup/tables only):
```hermes-ui
{"type":"html","html":"<table><tr><th>Item</th><th>Qty</th></tr>...</table>","height":240}
```

Also available: standalone `input`, `slider`, `select` blocks (same fields as \
inside a form). After you send buttons/a form/a card, your next turn begins \
with the user's choice — don't guess it, send the control and wait. Never put \
secrets, tokens, or API keys inside html/chart blocks."""


def _text_from_blocks(blocks: list[dict[str, Any]]) -> str:
    """Concatenate the text blocks of a message into a single string."""
    parts = [b.get("text", "") for b in blocks if b.get("type") == "text"]
    return "\n".join(p for p in parts if p).strip()


def _message_text(blocks: list[dict[str, Any]]) -> str:
    """
    Text the agent should "see" for a turn: text blocks plus voice transcripts.
    A voice note becomes "[voice note] <transcript>" (or a bare note if it could
    not be transcribed) so the agent knows the user spoke.
    """
    parts: list[str] = []
    for b in blocks:
        t = b.get("type")
        if t == "text" and b.get("text"):
            parts.append(b["text"])
        elif t == "voice":
            transcript = (b.get("transcript") or "").strip()
            parts.append(f"[voice note] {transcript}" if transcript else "[user sent a voice note]")
        elif t == "file":
            parts.append(f"[file: {b.get('name') or b.get('fileId')}]")
    return "\n".join(parts).strip()


async def _build_history(db: Database, settings: Settings, chat: str) -> list[dict[str, str]]:
    """Map the last N message frames to OpenAI-format chat messages."""
    frames = await db.recent_messages(chat, settings.hermes_history_limit)
    messages: list[dict[str, str]] = []
    for f in frames:
        text = _message_text(f.get("blocks", []))
        if not text:
            continue
        role = "user" if f.get("from") == "user" else "assistant"
        messages.append({"role": role, "content": text})
    return messages


def _envelope(chat: str, kind: str, **extra: Any) -> dict[str, Any]:
    return {
        "v": 1,
        "id": new_ulid(),
        "ts": _now_ms(),
        "chat": chat,
        "from": "agent",
        "kind": kind,
        **extra,
    }


async def stream_hermes_reply(
    db: Database,
    settings: Settings,
    emit: Emit,
    chat: str,
    user_msg_text: str,
) -> None:
    """
    Stream a Hermes reply for `chat` and emit frames via `emit`.

    `user_msg_text` is the latest user turn. For a normal message it is already
    in the frame log (so the built history ends with it); for an injected
    interactive event it is not, so we append it as the final user turn.
    """
    msg_id = new_ulid()
    history = await _build_history(db, settings, chat)
    last = history[-1] if history else None
    if not (last and last["role"] == "user" and last["content"] == user_msg_text):
        history.append({"role": "user", "content": user_msg_text})

    messages: list[dict[str, str]] = []
    if settings.ui_system_prompt:
        messages.append({"role": "system", "content": _UI_SYSTEM_PROMPT})
    messages.extend(history)

    payload = {
        "model": settings.hermes_model,
        "messages": messages,
        "stream": False,
    }
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Hermes-Session-Id": chat,
    }
    if settings.hermes_key:
        headers["Authorization"] = f"Bearer {settings.hermes_key}"

    await emit(_envelope(chat, "typing", state="start"))

    try:
        async with httpx.AsyncClient(timeout=settings.hermes_timeout_s) as client:
            resp = await client.post(settings.hermes_chat_url, json=payload, headers=headers)
            if resp.status_code != 200:
                body = resp.text[:500]
                await _fail(emit, chat, f"hermes {resp.status_code}: {body}")
                return
            full = resp.json()["choices"][0]["message"]["content"]
    except httpx.HTTPError as e:
        await _fail(emit, chat, f"hermes connection error: {e}")
        return
    except (KeyError, IndexError, TypeError) as e:
        await _fail(emit, chat, f"hermes unexpected response shape: {e}")
        return

    # Fenced-block fallback (§4.4): pull any ```hermes-ui JSON blocks out of the
    # text, validate them, and emit them as real blocks alongside the prose.
    visible, ui_blocks = _extract_fenced_ui(full)
    blocks: list[dict[str, Any]] = []
    if visible:
        blocks.append({"type": "text", "text": visible})
    blocks.extend(ui_blocks)
    if not blocks:
        blocks = [{"type": "text", "text": full}]

    final = _envelope(chat, "message", msgId=msg_id, blocks=blocks)
    await db.append_frame(final)
    await emit(final)

    await emit(_envelope(chat, "typing", state="stop"))


_FENCE_RE = re.compile(r"```hermes-ui\s*(.+?)```", re.DOTALL)


def _short_id() -> str:
    """A short, schema-valid id (1-64 chars) for blocks the agent left blank."""
    import uuid

    return uuid.uuid4().hex[:12]


def _fill_block_ids(block: dict[str, Any]) -> None:
    """Inject ids the strict schema requires but the agent reliably omits.

    The pydantic block schema requires ``id`` on card/buttons-items/form/fields
    and the standalone input/slider/select blocks. The model can't generate
    these, so blocks would fail validation and silently vanish. Fill any that
    are missing (idempotent — never overwrites an id the agent did supply).
    """
    t = block.get("type")
    if t in ("input", "slider", "select", "form", "card"):
        block.setdefault("id", _short_id())
    if t == "buttons":
        for b in block.get("buttons", []) or []:
            if isinstance(b, dict):
                b.setdefault("id", _short_id())
    if t == "card":
        for a in block.get("actions", []) or []:
            if isinstance(a, dict):
                a.setdefault("id", _short_id())
    if t == "form":
        for f in block.get("fields", []) or []:
            if isinstance(f, dict):
                f.setdefault("id", _short_id())


def _extract_fenced_ui(text: str) -> tuple[str, list[dict[str, Any]]]:
    """
    Extract + validate ```hermes-ui ...``` fenced blocks from `text`.

    Returns (visible_text_without_fences, [valid_block_dicts]). A fence may hold
    a single block object or a list of blocks. Invalid blocks are dropped; their
    fence is still stripped so the user never sees raw JSON.
    """
    blocks: list[dict[str, Any]] = []
    if "```hermes-ui" not in text:
        return text.strip(), blocks

    for raw in _FENCE_RE.findall(text):
        try:
            parsed = json.loads(raw.strip())
        except json.JSONDecodeError:
            logger.warning("hermes-ui fence had invalid JSON; dropping")
            continue
        candidates = parsed if isinstance(parsed, list) else [parsed]
        for cand in candidates:
            try:
                from . import pydantic_schema as ps

                if isinstance(cand, dict):
                    _fill_block_ids(cand)  # supply ids the model omits
                ps.parse_block(cand)  # validate; raises on bad shape
                blocks.append(cand)
            except Exception as e:  # noqa: BLE001
                logger.warning("dropped invalid hermes-ui block: %s", e)

    visible = _FENCE_RE.sub("", text).strip()
    return visible, blocks


def format_event_turn(event: dict[str, Any]) -> str:
    """
    Render an interactive-block event as the user's next turn so the agent
    "sees" the choice it asked for (§3 round-trip).
    """
    etype = event.get("type")
    if etype == "action":
        name = event.get("name", "")
        value = event.get("value")
        if value and value != name:
            return f'The user selected "{name}" (value: {value}).'
        return f'The user selected "{name}".'
    if etype == "submit":
        values = event.get("values", {})
        pairs = ", ".join(f"{k}: {v}" for k, v in values.items())
        return f"The user submitted the form ({pairs})."
    return "The user interacted with the interface."


async def handle_event_turn(
    db: Database,
    settings: Settings,
    emit: Emit,
    wire: dict[str, Any],
) -> None:
    """Inject an interactive event into the Hermes session as a user turn."""
    text = format_event_turn(wire.get("event", {}))
    await stream_hermes_reply(db, settings, emit, wire["chat"], text)


async def handle_user_turn(
    db: Database,
    settings: Settings,
    emit: Emit,
    wire: dict[str, Any],
) -> None:
    """
    Process a just-persisted user `message` frame: transcribe any voice notes
    (echoing the transcript back via an `edit`), then drive the Hermes reply.
    Runs in the background so the WS receive loop is never blocked.
    """
    chat = wire["chat"]
    await _transcribe_voice_blocks(db, settings, emit, wire)
    text = _message_text(wire.get("blocks", []))
    if text:
        await stream_hermes_reply(db, settings, emit, chat, text)


async def _transcribe_voice_blocks(
    db: Database,
    settings: Settings,
    emit: Emit,
    wire: dict[str, Any],
) -> None:
    """Transcribe each voice block in place; persist + emit an edit if changed."""
    blocks = wire.get("blocks", [])
    changed = False
    for b in blocks:
        if b.get("type") != "voice" or b.get("transcript"):
            continue
        upload = await db.get_upload(b.get("fileId", ""))
        if not upload:
            continue
        try:
            transcript = await transcribe(upload["path"], settings)
        except TranscriptionError as e:
            logger.warning("voice transcription failed: %s", e)
            continue
        b["transcript"] = transcript
        changed = True

    if not changed:
        return

    # Persist the enriched frame and patch the voice block in the app in place.
    await db.update_frame_payload(wire["id"], wire)
    await emit(
        _envelope(wire["chat"], "edit", msgId=wire["msgId"], blocks=blocks)
    )


async def _iter_sse_deltas(resp: httpx.Response):
    """Yield content deltas from an OpenAI-style SSE stream."""
    async for line in resp.aiter_lines():
        line = line.strip()
        if not line or not line.startswith("data:"):
            continue
        data = line[len("data:"):].strip()
        if data == "[DONE]":
            break
        try:
            obj = json.loads(data)
        except json.JSONDecodeError:
            continue
        try:
            choice = obj["choices"][0]
            # streaming uses `delta.content`; some servers send `message.content`.
            delta = choice.get("delta", {}).get("content")
            if delta is None:
                delta = choice.get("message", {}).get("content")
            if delta:
                yield delta
        except (KeyError, IndexError, TypeError):
            continue


async def _fail(emit: Emit, chat: str, message: str) -> None:
    await emit(_envelope(chat, "error", code="hermes_error", message=message[:2000]))
    await emit(_envelope(chat, "typing", state="stop"))

"""
app-ui — Hermes plugin that lets the agent render interactive UI in the
Hermes Mobile Gateway app.

Each ui_* tool builds a block payload (matching the shared wire protocol in
protocol.ts / pydantic_schema.py) and POSTs a frame to the Bridge's
localhost-only ``/internal/ui`` endpoint, authenticated with the shared
``X-Internal-Token``. The user's interaction (tap / submit) is delivered back
to the Bridge as an ``event`` frame and injected into this session as the
agent's next user turn — so a ui_* call effectively "returns" the user's choice
on the following turn.

Config (env):
  BRIDGE_UI_URL        default http://127.0.0.1:8787/internal/ui
  BRIDGE_INTERNAL_TOKEN  shared localhost secret (required)
  BRIDGE_DEFAULT_CHAT  default chat id (default "main")
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid

BRIDGE = os.environ.get("BRIDGE_UI_URL", "http://127.0.0.1:8787/internal/ui")
SECRET = os.environ.get("BRIDGE_INTERNAL_TOKEN", "")
DEFAULT_CHAT = os.environ.get("BRIDGE_DEFAULT_CHAT", "main")

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _ulid() -> str:
    """26-char ULID matching the protocol regex."""
    ts = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(10), "big")

    def enc(value: int, length: int) -> str:
        out = []
        for _ in range(length):
            out.append(_CROCKFORD[value & 0x1F])
            value >>= 5
        return "".join(reversed(out))

    return enc(ts, 10) + enc(rand, 16)


def _short_id() -> str:
    return uuid.uuid4().hex[:12]


def _post(payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BRIDGE,
        data=data,
        headers={"Content-Type": "application/json", "X-Internal-Token": SECRET},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"{e.code} {e.read().decode('utf-8', 'replace')[:200]}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": repr(e)}


def _push_message(chat: str, blocks: list[dict]) -> dict:
    """Send a message frame whose id == msgId so ui_update can target it."""
    msg_id = _ulid()
    frame = {
        "v": 1,
        "id": msg_id,
        "ts": int(time.time() * 1000),
        "chat": chat or DEFAULT_CHAT,
        "from": "agent",
        "kind": "message",
        "msgId": msg_id,
        "blocks": blocks,
    }
    res = _post(frame)
    return {"msgId": msg_id, "bridge": res}


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


def _ok(msg: str, **extra) -> str:
    return json.dumps({"success": True, "message": msg, **extra})


def handle_buttons(params, **_):
    chat = params.get("chat", DEFAULT_CHAT)
    buttons = [
        {"id": b.get("id") or _short_id(), "label": b["label"], "value": b.get("value"), "style": b.get("style")}
        for b in params.get("buttons", [])
    ]
    buttons = [{k: v for k, v in b.items() if v is not None} for b in buttons]
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append({"type": "buttons", "buttons": buttons})
    res = _push_message(chat, blocks)
    return _ok("Buttons sent; the user's tap arrives as your next message.", **res)


def handle_input(params, **_):
    chat = params.get("chat", DEFAULT_CHAT)
    block = {"type": "input", "id": params.get("id") or _short_id()}
    for k in ("label", "placeholder", "value", "multiline", "inputType"):
        if params.get(k) is not None:
            block[k] = params[k]
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Input sent; the user's entry arrives as your next message.", **res)


def handle_slider(params, **_):
    chat = params.get("chat", DEFAULT_CHAT)
    block = {
        "type": "slider",
        "id": params.get("id") or _short_id(),
        "min": params["min"],
        "max": params["max"],
    }
    for k in ("label", "step", "value"):
        if params.get(k) is not None:
            block[k] = params[k]
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Slider sent; the user's choice arrives as your next message.", **res)


def handle_select(params, **_):
    chat = params.get("chat", DEFAULT_CHAT)
    block = {
        "type": "select",
        "id": params.get("id") or _short_id(),
        "options": [{"label": o["label"], "value": o["value"]} for o in params.get("options", [])],
    }
    if params.get("label"):
        block["label"] = params["label"]
    if params.get("multi"):
        block["multiple"] = True
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Select sent; the user's choice arrives as your next message.", **res)


def handle_form(params, **_):
    chat = params.get("chat", DEFAULT_CHAT)
    fields = []
    for f in params.get("fields", []):
        field = dict(f)
        field.setdefault("id", _short_id())
        fields.append(field)
    block = {"type": "form", "id": params.get("id") or _short_id(), "fields": fields}
    if params.get("submitLabel"):
        block["submitLabel"] = params["submitLabel"]
    if params.get("title"):
        block["title"] = params["title"]
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Form sent; the user's submission arrives as your next message.", **res)


def handle_card(params, **_):
    chat = params.get("chat", DEFAULT_CHAT)
    actions = [
        {"id": a.get("id") or _short_id(), "label": a["label"], "value": a.get("value"), "style": a.get("style")}
        for a in params.get("actions", [])
    ]
    actions = [{k: v for k, v in a.items() if v is not None} for a in actions]
    block = {
        "type": "card",
        "id": params.get("id") or _short_id(),
        "title": params["title"],
        "status": params.get("status", "pending"),
    }
    for k in ("subtitle", "body"):
        if params.get(k) is not None:
            block[k] = params[k]
    if actions:
        block["actions"] = actions
    res = _push_message(chat, [block])
    return _ok(
        "Card sent; the user's action arrives as your next message. "
        "Use ui_update with this msgId + the card id to flip its status.",
        cardId=block["id"],
        **res,
    )


def handle_update(params, **_):
    chat = params.get("chat", DEFAULT_CHAT)
    res = _post(
        {
            "_action": "update",
            "chat": chat or DEFAULT_CHAT,
            "msgId": params["msgId"],
            "blockId": params["blockId"],
            "patch": params.get("patch", {}),
        }
    )
    return _ok("Block updated in place.", bridge=res)


def handle_chart(params, **_):
    """Render a line/bar/area/pie chart."""
    chat = params.get("chat", DEFAULT_CHAT)
    block = {
        "type": "chart",
        "chartType": params.get("chartType", "bar"),
        "series": params.get("series", []),
    }
    if params.get("title"):
        block["title"] = params["title"]
    if params.get("labels"):
        block["labels"] = params["labels"]
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Chart rendered.", **res)


def handle_html(params, **_):
    """Render sandboxed HTML in the app."""
    chat = params.get("chat", DEFAULT_CHAT)
    block = {"type": "html", "html": params["html"]}
    if params.get("height"):
        block["height"] = int(params["height"])
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("HTML block rendered.", **res)


def handle_stepper(params, **_):
    """Render a numeric value setter with −/+ steppers and an Apply action."""
    chat = params.get("chat", DEFAULT_CHAT)
    block = {"type": "stepper", "id": params.get("id") or _short_id(), "value": params["value"]}
    for k in ("label", "min", "max", "step", "unit", "submitLabel"):
        if params.get(k) is not None:
            block[k] = params[k]
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Stepper sent; the user's value arrives as your next message.", **res)


def handle_datetime(params, **_):
    """Render a day picker + time and a Confirm action (scheduler)."""
    chat = params.get("chat", DEFAULT_CHAT)
    days = [
        {"value": d["value"], "weekday": d["weekday"], "day": d["day"]}
        for d in params.get("days", [])
    ]
    block = {"type": "datetime", "id": params.get("id") or _short_id(), "days": days}
    for k in ("label", "selected", "time", "meridiem", "confirmLabel"):
        if params.get(k) is not None:
            block[k] = params[k]
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Scheduler sent; the user's pick arrives as your next message.", **res)


def handle_weather(params, **_):
    """Render a read-only weather card."""
    chat = params.get("chat", DEFAULT_CHAT)
    block = {"type": "weather", "location": params["location"], "temp": params["temp"]}
    for k in ("unit", "condition", "icon", "high", "low", "hourly"):
        if params.get(k) is not None:
            block[k] = params[k]
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Weather card rendered.", **res)


def handle_map(params, **_):
    """Render a location snippet with an optional Directions action."""
    chat = params.get("chat", DEFAULT_CHAT)
    block = {"type": "map", "label": params["label"]}
    for k in ("caption", "pin"):
        if params.get(k) is not None:
            block[k] = params[k]
    action = params.get("action")
    if action:
        block["action"] = {
            k: v
            for k, v in {
                "id": action.get("id") or _short_id(),
                "label": action["label"],
                "value": action.get("value"),
                "style": action.get("style"),
            }.items()
            if v is not None
        }
    blocks = []
    if params.get("text"):
        blocks.append({"type": "text", "text": params["text"]})
    blocks.append(block)
    res = _push_message(chat, blocks)
    return _ok("Map snippet rendered.", **res)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

_CHAT = {"type": "string", "description": "Chat id to render into (default 'main')."}
_TEXT = {"type": "string", "description": "Optional text shown above the widget."}


def _schemas():
    button_item = {
        "type": "object",
        "properties": {
            "label": {"type": "string"},
            "value": {"type": "string"},
            "style": {"type": "string", "enum": ["default", "primary", "danger"]},
        },
        "required": ["label"],
    }
    option_item = {
        "type": "object",
        "properties": {"label": {"type": "string"}, "value": {"type": "string"}},
        "required": ["label", "value"],
    }
    return {
        "ui_buttons": {
            "name": "ui_buttons",
            "description": "Show tappable buttons. Returns when the user taps one.",
            "parameters": {
                "type": "object",
                "properties": {"chat": _CHAT, "text": _TEXT, "buttons": {"type": "array", "items": button_item}},
                "required": ["buttons"],
            },
        },
        "ui_input": {
            "name": "ui_input",
            "description": "Ask the user for a single line (or multiline) of text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "label": {"type": "string"},
                    "placeholder": {"type": "string"},
                    "multiline": {"type": "boolean"},
                    "inputType": {"type": "string", "enum": ["text", "number", "email", "password"]},
                },
                "required": ["label"],
            },
        },
        "ui_slider": {
            "name": "ui_slider",
            "description": "Ask the user to pick a number on a range slider.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "label": {"type": "string"},
                    "min": {"type": "number"},
                    "max": {"type": "number"},
                    "step": {"type": "number"},
                    "value": {"type": "number"},
                },
                "required": ["label", "min", "max"],
            },
        },
        "ui_select": {
            "name": "ui_select",
            "description": "Ask the user to choose from a list of options.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "label": {"type": "string"},
                    "options": {"type": "array", "items": option_item},
                    "multi": {"type": "boolean"},
                },
                "required": ["options"],
            },
        },
        "ui_form": {
            "name": "ui_form",
            "description": "Render a form of input/slider/select fields with one submit button.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "title": {"type": "string"},
                    "fields": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "Each field: {type:'input'|'slider'|'select', id?, label, ...} per the protocol.",
                    },
                    "submitLabel": {"type": "string"},
                },
                "required": ["fields"],
            },
        },
        "ui_card": {
            "name": "ui_card",
            "description": "Show an approval/status card with optional action buttons (e.g. Accept & send / Reject).",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "title": {"type": "string"},
                    "subtitle": {"type": "string"},
                    "body": {"type": "string"},
                    "status": {"type": "string", "enum": ["pending", "approved", "rejected", "done", "error", "info"]},
                    "actions": {"type": "array", "items": button_item},
                },
                "required": ["title"],
            },
        },
        "ui_update": {
            "name": "ui_update",
            "description": "Patch a previously sent block in place (e.g. flip a card status pending -> approved).",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "msgId": {"type": "string", "description": "msgId returned by the ui_* call."},
                    "blockId": {"type": "string", "description": "id of the block to patch (e.g. the card id)."},
                    "patch": {"type": "object", "description": "Fields to merge into the block, e.g. {\"status\":\"approved\"}."},
                },
                "required": ["msgId", "blockId", "patch"],
            },
        },
        "ui_chart": {
            "name": "ui_chart",
            "description": "Render a line, bar, area, or pie chart. series is an array of {label?, data, color?}.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "title": {"type": "string"},
                    "chartType": {"type": "string", "enum": ["line", "bar", "area", "pie"]},
                    "labels": {"type": "array", "items": {"type": "string"}, "description": "X-axis labels (one per data point)."},
                    "series": {
                        "type": "array",
                        "description": "Each series: {label?, data: number[], color?}.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "data": {"type": "array", "items": {"type": "number"}},
                                "color": {"type": "string"},
                            },
                            "required": ["data"],
                        },
                    },
                },
                "required": ["chartType", "series"],
            },
        },
        "ui_html": {
            "name": "ui_html",
            "description": "Render sandboxed HTML in the app (JS disabled by default).",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "html": {"type": "string", "description": "HTML content to render."},
                    "height": {"type": "integer", "description": "Fixed height in pixels (default 300, max 4000)."},
                },
                "required": ["html"],
            },
        },
        "ui_stepper": {
            "name": "ui_stepper",
            "description": "Ask the user to set a number with −/+ steppers and an Apply button. Returns when applied.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "label": {"type": "string"},
                    "value": {"type": "number", "description": "Starting value."},
                    "min": {"type": "number"},
                    "max": {"type": "number"},
                    "step": {"type": "number"},
                    "unit": {"type": "string", "description": "Suffix shown after the value, e.g. '°C'."},
                    "submitLabel": {"type": "string"},
                },
                "required": ["value"],
            },
        },
        "ui_datetime": {
            "name": "ui_datetime",
            "description": "Ask the user to pick a day (from a row you supply) at a given time. Returns the chosen day on confirm.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "label": {"type": "string"},
                    "days": {
                        "type": "array",
                        "description": "Day options. Each: {value, weekday, day}, e.g. {value:'2026-06-04', weekday:'Wed', day:'4'}.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "value": {"type": "string"},
                                "weekday": {"type": "string"},
                                "day": {"type": "string"},
                            },
                            "required": ["value", "weekday", "day"],
                        },
                    },
                    "selected": {"type": "string", "description": "value of the pre-selected day."},
                    "time": {"type": "string", "description": "Display time, e.g. '09:30'."},
                    "meridiem": {"type": "string", "enum": ["AM", "PM"]},
                    "confirmLabel": {"type": "string"},
                },
                "required": ["days"],
            },
        },
        "ui_weather": {
            "name": "ui_weather",
            "description": "Render a read-only weather card with current conditions and an optional hourly strip.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "location": {"type": "string"},
                    "temp": {"type": "number"},
                    "unit": {"type": "string", "description": "Degree unit letter, e.g. 'C' or 'F'."},
                    "condition": {"type": "string"},
                    "icon": {"type": "string", "enum": ["sun", "cloud", "rain", "snow", "storm", "fog"]},
                    "high": {"type": "number"},
                    "low": {"type": "number"},
                    "hourly": {
                        "type": "array",
                        "description": "Forecast hours. Each: {time, icon?, temp}, e.g. {time:'14', icon:'sun', temp:'19°'}.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "time": {"type": "string"},
                                "icon": {"type": "string", "enum": ["sun", "cloud", "rain", "snow", "storm", "fog"]},
                                "temp": {"type": "string"},
                            },
                            "required": ["time", "temp"],
                        },
                    },
                },
                "required": ["location", "temp"],
            },
        },
        "ui_map": {
            "name": "ui_map",
            "description": "Render a location snippet (stylized map + pin) with an optional action button like Directions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat": _CHAT,
                    "text": _TEXT,
                    "label": {"type": "string", "description": "Place name shown under the map."},
                    "caption": {"type": "string", "description": "Secondary line, e.g. '0.4 mi · 8 min walk'."},
                    "pin": {"type": "string", "description": "Text inside the pin bubble."},
                    "action": button_item,
                },
                "required": ["label"],
            },
        },
    }


_HANDLERS = {
    "ui_buttons": handle_buttons,
    "ui_input": handle_input,
    "ui_slider": handle_slider,
    "ui_select": handle_select,
    "ui_form": handle_form,
    "ui_card": handle_card,
    "ui_update": handle_update,
    "ui_chart": handle_chart,
    "ui_html": handle_html,
    "ui_stepper": handle_stepper,
    "ui_datetime": handle_datetime,
    "ui_weather": handle_weather,
    "ui_map": handle_map,
}


def register(ctx):
    schemas = _schemas()
    for name, schema in schemas.items():
        ctx.register_tool(
            name=name,
            toolset="app_ui",
            schema=schema,
            handler=_HANDLERS[name],
            description=schema["description"],
        )
    # Make the agent aware of when/how to use these tools.
    try:
        from pathlib import Path

        skill = Path(__file__).parent / "HERMES_UI.skill.md"
        if skill.exists():
            ctx.register_skill("hermes_ui", str(skill))
    except Exception:  # noqa: BLE001
        pass

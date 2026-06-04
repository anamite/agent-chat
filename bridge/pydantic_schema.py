"""
pydantic_schema.py — Python equivalent of protocol.ts (the wire contract).

This is the Bridge's frame validator. It is the pydantic v2 mirror of the Zod
schema in ``protocol.ts``. The two MUST stay in lockstep: ``gen_pydantic.py``
regenerates ``protocol.schema.json`` from the Zod source and cross-checks that
this module accepts/rejects the same shapes, so drift is caught in CI rather
than at runtime.

Validate every inbound frame with :func:`parse_frame`. Reject, don't coerce.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
)

PROTOCOL_VERSION = 1

# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------

ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

ULID = Annotated[str, StringConstraints(pattern=ULID_RE.pattern)]
Timestamp = Annotated[int, Field(ge=0)]
ChatId = Annotated[str, StringConstraints(min_length=1, max_length=128)]
Sender = Literal["user", "agent"]


class _Strict(BaseModel):
    """Reject unknown fields everywhere — never trust the wire."""

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------


class TextBlock(_Strict):
    type: Literal["text"]
    text: Annotated[str, StringConstraints(max_length=32_000)]


class FileBlock(_Strict):
    type: Literal["file"]
    fileId: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    name: Annotated[str, StringConstraints(max_length=512)] | None = None
    mime: Annotated[str, StringConstraints(max_length=255)] | None = None
    size: Annotated[int, Field(ge=0)] | None = None
    thumbId: Annotated[str, StringConstraints(max_length=128)] | None = None
    width: Annotated[int, Field(gt=0)] | None = None
    height: Annotated[int, Field(gt=0)] | None = None


class VoiceBlock(_Strict):
    type: Literal["voice"]
    fileId: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    durationMs: Annotated[int, Field(ge=0)] | None = None
    peaks: Annotated[list[Annotated[float, Field(ge=0, le=1)]], Field(max_length=64)] | None = None
    transcript: Annotated[str, StringConstraints(max_length=32_000)] | None = None


ButtonStyle = Literal["default", "primary", "danger"]


class Button(_Strict):
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    label: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    value: Annotated[str, StringConstraints(max_length=2_000)] | None = None
    style: ButtonStyle | None = None


class ButtonsBlock(_Strict):
    type: Literal["buttons"]
    buttons: Annotated[list[Button], Field(min_length=1, max_length=12)]


class InputBlock(_Strict):
    type: Literal["input"]
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    label: Annotated[str, StringConstraints(max_length=200)] | None = None
    placeholder: Annotated[str, StringConstraints(max_length=200)] | None = None
    value: Annotated[str, StringConstraints(max_length=4_000)] | None = None
    multiline: bool | None = None
    inputType: Literal["text", "number", "email", "password"] | None = None


class SliderBlock(_Strict):
    type: Literal["slider"]
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    label: Annotated[str, StringConstraints(max_length=200)] | None = None
    min: float
    max: float
    step: Annotated[float, Field(gt=0)] | None = None
    value: float | None = None


class SelectOption(_Strict):
    label: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    value: Annotated[str, StringConstraints(max_length=2_000)]


class SelectBlock(_Strict):
    type: Literal["select"]
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    label: Annotated[str, StringConstraints(max_length=200)] | None = None
    options: Annotated[list[SelectOption], Field(min_length=1, max_length=50)]
    multiple: bool | None = None
    value: Union[str, list[str]] | None = None


FormField = Annotated[
    Union[InputBlock, SliderBlock, SelectBlock],
    Field(discriminator="type"),
]


class FormBlock(_Strict):
    type: Literal["form"]
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    title: Annotated[str, StringConstraints(max_length=200)] | None = None
    fields: Annotated[list[FormField], Field(min_length=1, max_length=30)]
    submitLabel: Annotated[str, StringConstraints(max_length=120)] | None = None


class ChartSeries(_Strict):
    label: Annotated[str, StringConstraints(max_length=120)] | None = None
    data: Annotated[list[float], Field(max_length=1_000)]
    color: Annotated[str, StringConstraints(max_length=32)] | None = None


class ChartBlock(_Strict):
    type: Literal["chart"]
    chartType: Literal["line", "bar", "area", "pie"]
    title: Annotated[str, StringConstraints(max_length=200)] | None = None
    labels: Annotated[list[Annotated[str, StringConstraints(max_length=120)]], Field(max_length=1_000)] | None = None
    series: Annotated[list[ChartSeries], Field(min_length=1, max_length=12)]


class HtmlBlock(_Strict):
    type: Literal["html"]
    html: Annotated[str, StringConstraints(max_length=200_000)]
    height: Annotated[int, Field(gt=0, le=4_000)] | None = None
    allowJs: bool = False


CardStatus = Literal["pending", "approved", "rejected", "done", "error", "info"]


class CardBlock(_Strict):
    type: Literal["card"]
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    title: Annotated[str, StringConstraints(max_length=200)]
    subtitle: Annotated[str, StringConstraints(max_length=200)] | None = None
    body: Annotated[str, StringConstraints(max_length=8_000)] | None = None
    status: CardStatus | None = None
    actions: Annotated[list[Button], Field(max_length=8)] | None = None


class StepperBlock(_Strict):
    type: Literal["stepper"]
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    label: Annotated[str, StringConstraints(max_length=200)] | None = None
    value: float
    min: float | None = None
    max: float | None = None
    step: Annotated[float, Field(gt=0)] | None = None
    unit: Annotated[str, StringConstraints(max_length=12)] | None = None
    submitLabel: Annotated[str, StringConstraints(max_length=120)] | None = None


class DateOption(_Strict):
    value: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    weekday: Annotated[str, StringConstraints(max_length=12)]
    day: Annotated[str, StringConstraints(max_length=8)]


class DateTimeBlock(_Strict):
    type: Literal["datetime"]
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    label: Annotated[str, StringConstraints(max_length=200)] | None = None
    days: Annotated[list[DateOption], Field(min_length=1, max_length=14)]
    selected: Annotated[str, StringConstraints(max_length=64)] | None = None
    time: Annotated[str, StringConstraints(max_length=8)] | None = None
    meridiem: Literal["AM", "PM"] | None = None
    confirmLabel: Annotated[str, StringConstraints(max_length=120)] | None = None


WeatherIcon = Literal["sun", "cloud", "rain", "snow", "storm", "fog"]


class WeatherHour(_Strict):
    time: Annotated[str, StringConstraints(max_length=8)]
    icon: WeatherIcon | None = None
    temp: Annotated[str, StringConstraints(max_length=8)]


class WeatherBlock(_Strict):
    type: Literal["weather"]
    location: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    temp: float
    unit: Annotated[str, StringConstraints(max_length=4)] | None = None
    condition: Annotated[str, StringConstraints(max_length=120)] | None = None
    icon: WeatherIcon | None = None
    high: float | None = None
    low: float | None = None
    hourly: Annotated[list[WeatherHour], Field(max_length=12)] | None = None


class MapBlock(_Strict):
    type: Literal["map"]
    label: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    caption: Annotated[str, StringConstraints(max_length=200)] | None = None
    pin: Annotated[str, StringConstraints(max_length=60)] | None = None
    action: Button | None = None


Block = Annotated[
    Union[
        TextBlock,
        FileBlock,
        VoiceBlock,
        ButtonsBlock,
        InputBlock,
        SliderBlock,
        SelectBlock,
        FormBlock,
        ChartBlock,
        HtmlBlock,
        CardBlock,
        StepperBlock,
        DateTimeBlock,
        WeatherBlock,
        MapBlock,
    ],
    Field(discriminator="type"),
]

BlockAdapter: TypeAdapter[Block] = TypeAdapter(Block)


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------


class _Frame(_Strict):
    v: Literal[1]
    id: ULID
    ts: Timestamp
    chat: ChatId
    from_: Sender = Field(alias="from")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class DeviceInfo(_Strict):
    id: Annotated[str, StringConstraints(max_length=128)]
    platform: Literal["android", "ios", "web"] | None = None
    name: Annotated[str, StringConstraints(max_length=120)] | None = None
    appVersion: Annotated[str, StringConstraints(max_length=40)] | None = None


class HelloFrame(_Frame):
    kind: Literal["hello"]
    device: DeviceInfo
    sinceTs: Timestamp | None = None


class PingFrame(_Frame):
    kind: Literal["ping"]


class PongFrame(_Frame):
    kind: Literal["pong"]


class MessageFrame(_Frame):
    kind: Literal["message"]
    msgId: ULID
    blocks: Annotated[list[Block], Field(min_length=1, max_length=50)]
    replyTo: ULID | None = None


class StreamFrame(_Frame):
    kind: Literal["stream"]
    msgId: ULID
    delta: Annotated[str, StringConstraints(max_length=32_000)] = ""
    done: bool | None = None


class TypingFrame(_Frame):
    kind: Literal["typing"]
    state: Literal["start", "stop"]


class ReceiptFrame(_Frame):
    kind: Literal["receipt"]
    msgId: ULID
    status: Literal["delivered", "read", "failed"]


class ActionEvent(_Strict):
    type: Literal["action"]
    source: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    value: Annotated[str, StringConstraints(max_length=4_000)] | None = None


class SubmitEvent(_Strict):
    type: Literal["submit"]
    form: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    values: dict[str, Union[str, float, list[str]]]


EventPayload = Annotated[Union[ActionEvent, SubmitEvent], Field(discriminator="type")]


class EventFrame(_Frame):
    kind: Literal["event"]
    msgId: ULID
    event: EventPayload


class EditFrame(_Frame):
    kind: Literal["edit"]
    msgId: ULID
    blocks: Annotated[list[Block], Field(min_length=1, max_length=50)]


class ErrorFrame(_Frame):
    kind: Literal["error"]
    code: Annotated[str, StringConstraints(max_length=64)]
    message: Annotated[str, StringConstraints(max_length=2_000)]
    ref: ULID | None = None


Frame = Annotated[
    Union[
        HelloFrame,
        PingFrame,
        PongFrame,
        MessageFrame,
        StreamFrame,
        TypingFrame,
        ReceiptFrame,
        EventFrame,
        EditFrame,
        ErrorFrame,
    ],
    Field(discriminator="kind"),
]

FrameAdapter: TypeAdapter[Frame] = TypeAdapter(Frame)


# ---------------------------------------------------------------------------
# Parsing helpers — mirror protocol.ts parseFrame / safeParseFrame.
# ---------------------------------------------------------------------------


def parse_frame(data: object) -> Frame:
    """Validate an arbitrary object into a Frame. Raises ValidationError."""
    return FrameAdapter.validate_python(data)


def parse_frame_json(text: str | bytes) -> Frame:
    """Validate a JSON string/bytes into a Frame. Raises on invalid JSON/schema."""
    return FrameAdapter.validate_json(text)


def parse_block(data: object) -> Block:
    return BlockAdapter.validate_python(data)


def frame_to_wire(frame: BaseModel) -> dict:
    """Serialize a frame model back to a wire dict (``from`` not ``from_``)."""
    return frame.model_dump(by_alias=True, exclude_none=True)

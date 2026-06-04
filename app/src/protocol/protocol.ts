/**
 * Hermes Mobile Gateway — Shared Wire Protocol
 * ============================================
 *
 * THIS FILE IS THE CONTRACT. Both ends validate every frame against it and
 * drop anything malformed. Keep `app/src/protocol/protocol.ts` byte-identical
 * to this file (it is a copy). The Python Bridge validates with the pydantic
 * equivalent generated from the JSON Schema this file exports (see
 * `bridge/gen_schema.ts` -> `bridge/protocol.schema.json` ->
 * `bridge/pydantic_schema.py`). Do NOT hand-maintain two diverging schemas.
 *
 * Protocol version: 1
 *
 * Every frame shares an envelope:
 *   { v: 1, id: ULID, ts: epoch-ms, chat: string, from: "user"|"agent", kind, ... }
 *
 * Frame kinds: hello, ping, pong, message, stream, typing, receipt, event, edit, error
 * Block types: text, file, voice, buttons, input, slider, select, form, chart, html, card
 */

import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** ULID: 26 chars, Crockford base32 (no I, L, O, U). */
export const ULID = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "must be a 26-char Crockford base32 ULID");

/** A non-negative integer epoch timestamp in milliseconds. */
export const Timestamp = z.number().int().nonnegative();

export const Sender = z.enum(["user", "agent"]);

// ---------------------------------------------------------------------------
// Blocks — the units a `message` is composed of.
// ---------------------------------------------------------------------------

export const TextBlock = z.object({
  type: z.literal("text"),
  /** Markdown. Rendered by the SDUI text block. */
  text: z.string().max(32_000),
});

export const FileBlock = z.object({
  type: z.literal("file"),
  /** Opaque id returned by POST /files. Binaries never travel inside frames. */
  fileId: z.string().min(1).max(128),
  name: z.string().max(512).optional(),
  mime: z.string().max(255).optional(),
  size: z.number().int().nonnegative().optional(),
  /** Image thumbnail file id, if the Bridge generated one. */
  thumbId: z.string().max(128).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const VoiceBlock = z.object({
  type: z.literal("voice"),
  fileId: z.string().min(1).max(128),
  /** Duration in milliseconds. */
  durationMs: z.number().int().nonnegative().optional(),
  /** Precomputed normalized waveform peaks (0..1), capped at 64 samples. */
  peaks: z.array(z.number().min(0).max(1)).max(64).optional(),
  /** STT transcript (inbound: filled by Bridge via whisper). */
  transcript: z.string().max(32_000).optional(),
});

export const ButtonStyle = z.enum(["default", "primary", "danger"]);

export const Button = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  value: z.string().max(2_000).optional(),
  style: ButtonStyle.optional(),
});

export const ButtonsBlock = z.object({
  type: z.literal("buttons"),
  buttons: z.array(Button).min(1).max(12),
});

export const InputBlock = z.object({
  type: z.literal("input"),
  id: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  placeholder: z.string().max(200).optional(),
  value: z.string().max(4_000).optional(),
  multiline: z.boolean().optional(),
  inputType: z.enum(["text", "number", "email", "password"]).optional(),
});

export const SliderBlock = z.object({
  type: z.literal("slider"),
  id: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().optional(),
  value: z.number().optional(),
});

export const SelectOption = z.object({
  label: z.string().min(1).max(200),
  value: z.string().max(2_000),
});

export const SelectBlock = z.object({
  type: z.literal("select"),
  id: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  options: z.array(SelectOption).min(1).max(50),
  multiple: z.boolean().optional(),
  value: z.union([z.string(), z.array(z.string())]).optional(),
});

/** A field that lives inside a `form` block. */
export const FormField = z.discriminatedUnion("type", [
  InputBlock,
  SliderBlock,
  SelectBlock,
]);

export const FormBlock = z.object({
  type: z.literal("form"),
  id: z.string().min(1).max(64),
  title: z.string().max(200).optional(),
  fields: z.array(FormField).min(1).max(30),
  submitLabel: z.string().max(120).optional(),
});

export const ChartSeries = z.object({
  label: z.string().max(120).optional(),
  data: z.array(z.number()).max(1_000),
  color: z.string().max(32).optional(),
});

export const ChartBlock = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["line", "bar", "area", "pie"]),
  title: z.string().max(200).optional(),
  labels: z.array(z.string().max(120)).max(1_000).optional(),
  series: z.array(ChartSeries).min(1).max(12),
});

export const HtmlBlock = z.object({
  type: z.literal("html"),
  /** Rendered in a sandboxed WebView; JS disabled by default. */
  html: z.string().max(200_000),
  height: z.number().int().positive().max(4_000).optional(),
  allowJs: z.boolean().optional(),
});

export const CardStatus = z.enum([
  "pending",
  "approved",
  "rejected",
  "done",
  "error",
  "info",
]);

export const CardBlock = z.object({
  type: z.literal("card"),
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  subtitle: z.string().max(200).optional(),
  body: z.string().max(8_000).optional(),
  status: CardStatus.optional(),
  /** Action buttons (e.g. Accept & send / Reject). */
  actions: z.array(Button).max(8).optional(),
});

export const Block = z.discriminatedUnion("type", [
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
]);

// ---------------------------------------------------------------------------
// Frame envelope + the discriminated union of frame kinds.
// ---------------------------------------------------------------------------

/** Fields shared by every frame. */
const Envelope = {
  v: z.literal(PROTOCOL_VERSION),
  id: ULID,
  ts: Timestamp,
  chat: z.string().min(1).max(128),
  from: Sender,
};

/** Device descriptor sent on connect. */
export const DeviceInfo = z.object({
  id: z.string().max(128),
  platform: z.enum(["android", "ios", "web"]).optional(),
  name: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
});

/** hello — first frame the app sends on (re)connect. Triggers replay. */
export const HelloFrame = z.object({
  ...Envelope,
  kind: z.literal("hello"),
  device: DeviceInfo,
  /** Replay every frame newer than this ts (ms). 0 = replay all. */
  sinceTs: Timestamp.optional(),
});

export const PingFrame = z.object({
  ...Envelope,
  kind: z.literal("ping"),
});

export const PongFrame = z.object({
  ...Envelope,
  kind: z.literal("pong"),
});

/** message — a full message composed of blocks (either direction). */
export const MessageFrame = z.object({
  ...Envelope,
  kind: z.literal("message"),
  /** The message id this frame establishes (stream/edit/receipt reference it). */
  msgId: ULID,
  blocks: z.array(Block).min(1).max(50),
  /** Optional id of a message this one replies to. */
  replyTo: ULID.optional(),
});

/** stream — appends a token delta to an in-flight agent message. */
export const StreamFrame = z.object({
  ...Envelope,
  kind: z.literal("stream"),
  msgId: ULID,
  /** Text delta to append. Empty string allowed on the terminal `done` frame. */
  delta: z.string().max(32_000).default(""),
  done: z.boolean().optional(),
});

/** typing — start/stop indicator. */
export const TypingFrame = z.object({
  ...Envelope,
  kind: z.literal("typing"),
  state: z.enum(["start", "stop"]),
});

/** receipt — delivery/read acknowledgement for a message id. */
export const ReceiptFrame = z.object({
  ...Envelope,
  kind: z.literal("receipt"),
  msgId: ULID,
  status: z.enum(["delivered", "read", "failed"]),
});

/** event — a user interaction with an interactive block. */
export const ActionEvent = z.object({
  type: z.literal("action"),
  /** Block id the action originated from. */
  source: z.string().min(1).max(64),
  /** Button/action name. */
  name: z.string().min(1).max(120),
  value: z.string().max(4_000).optional(),
});

export const SubmitEvent = z.object({
  type: z.literal("submit"),
  /** Form block id. */
  form: z.string().min(1).max(64),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])),
});

export const EventPayload = z.discriminatedUnion("type", [
  ActionEvent,
  SubmitEvent,
]);

export const EventFrame = z.object({
  ...Envelope,
  kind: z.literal("event"),
  /** The message whose block was interacted with. */
  msgId: ULID,
  event: EventPayload,
});

/** edit — patch an existing message's blocks in place (e.g. card status flip). */
export const EditFrame = z.object({
  ...Envelope,
  kind: z.literal("edit"),
  msgId: ULID,
  blocks: z.array(Block).min(1).max(50),
});

/** error — protocol/transport error for a chat (optionally about a frame). */
export const ErrorFrame = z.object({
  ...Envelope,
  kind: z.literal("error"),
  code: z.string().max(64),
  message: z.string().max(2_000),
  /** Frame id this error refers to, if any. */
  ref: ULID.optional(),
});

export const Frame = z.discriminatedUnion("kind", [
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
]);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ULIDType = z.infer<typeof ULID>;
export type Block = z.infer<typeof Block>;
export type TextBlock = z.infer<typeof TextBlock>;
export type FileBlock = z.infer<typeof FileBlock>;
export type VoiceBlock = z.infer<typeof VoiceBlock>;
export type ButtonsBlock = z.infer<typeof ButtonsBlock>;
export type InputBlock = z.infer<typeof InputBlock>;
export type SliderBlock = z.infer<typeof SliderBlock>;
export type SelectBlock = z.infer<typeof SelectBlock>;
export type FormBlock = z.infer<typeof FormBlock>;
export type ChartBlock = z.infer<typeof ChartBlock>;
export type HtmlBlock = z.infer<typeof HtmlBlock>;
export type CardBlock = z.infer<typeof CardBlock>;
export type Button = z.infer<typeof Button>;

export type Frame = z.infer<typeof Frame>;
export type HelloFrame = z.infer<typeof HelloFrame>;
export type PingFrame = z.infer<typeof PingFrame>;
export type PongFrame = z.infer<typeof PongFrame>;
export type MessageFrame = z.infer<typeof MessageFrame>;
export type StreamFrame = z.infer<typeof StreamFrame>;
export type TypingFrame = z.infer<typeof TypingFrame>;
export type ReceiptFrame = z.infer<typeof ReceiptFrame>;
export type EventFrame = z.infer<typeof EventFrame>;
export type EditFrame = z.infer<typeof EditFrame>;
export type ErrorFrame = z.infer<typeof ErrorFrame>;
export type EventPayload = z.infer<typeof EventPayload>;
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export type FrameKind = Frame["kind"];

// ---------------------------------------------------------------------------
// Parsing helpers — both ends MUST validate; reject, don't coerce.
// ---------------------------------------------------------------------------

/** Parse + validate an unknown value into a Frame. Throws on invalid input. */
export function parseFrame(input: unknown): Frame {
  return Frame.parse(input);
}

/** Non-throwing variant. Returns a zod SafeParseReturnType. */
export function safeParseFrame(input: unknown) {
  return Frame.safeParse(input);
}

/** Parse a JSON string into a validated Frame. Throws on invalid JSON or schema. */
export function parseFrameJSON(text: string): Frame {
  return parseFrame(JSON.parse(text));
}

/** Validate a single block. */
export function parseBlock(input: unknown): Block {
  return Block.parse(input);
}

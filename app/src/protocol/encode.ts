/**
 * encode.ts — build outbound frames with ULID ids + timestamps.
 *
 * ULID: 48-bit ms timestamp + 80 bits randomness, Crockford base32, 26 chars.
 * Monotonic within the same millisecond so ids stay strictly increasing.
 */

import {
  PROTOCOL_VERSION,
  type Block,
  type DeviceInfo,
  type EventPayload,
  type Frame,
} from "./protocol";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = 0;
let lastRandom: number[] = [];

function randomBytes(): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) out.push(Math.floor(Math.random() * 32));
  return out;
}

function encodeTime(now: number): string {
  let mod: number;
  let str = "";
  for (let i = 9; i >= 0; i--) {
    mod = now % 32;
    str = CROCKFORD[mod] + str;
    now = (now - mod) / 32;
  }
  return str;
}

/** Generate a monotonic ULID. */
export function ulid(now: number = Date.now()): string {
  if (now === lastTime) {
    // Increment the random component to preserve monotonicity within a ms.
    for (let i = 15; i >= 0; i--) {
      if (lastRandom[i] < 31) {
        lastRandom[i]++;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    lastTime = now;
    lastRandom = randomBytes();
  }
  return encodeTime(now) + lastRandom.map((n) => CROCKFORD[n]).join("");
}

type Sender = "user" | "agent";

function envelope(kind: string, chat: string, from: Sender) {
  return {
    v: PROTOCOL_VERSION,
    id: ulid(),
    ts: Date.now(),
    chat,
    from,
    kind,
  } as const;
}

export function helloFrame(
  chat: string,
  device: DeviceInfo,
  sinceTs?: number,
): Frame {
  return { ...envelope("hello", chat, "user"), device, sinceTs } as Frame;
}

export function pingFrame(chat: string): Frame {
  return { ...envelope("ping", chat, "user") } as Frame;
}

export function pongFrame(chat: string): Frame {
  return { ...envelope("pong", chat, "user") } as Frame;
}

export function messageFrame(chat: string, blocks: Block[], replyTo?: string): Frame {
  const id = ulid();
  return {
    ...envelope("message", chat, "user"),
    id,
    msgId: id,
    blocks,
    replyTo,
  } as Frame;
}

export function textMessageFrame(chat: string, text: string): Frame {
  return messageFrame(chat, [{ type: "text", text }]);
}

export function eventFrame(chat: string, msgId: string, event: EventPayload): Frame {
  return { ...envelope("event", chat, "user"), msgId, event } as Frame;
}

/** event for a single interactive action (button tap, slider/select change). */
export function actionEventFrame(
  chat: string,
  msgId: string,
  source: string,
  name: string,
  value?: string,
): Frame {
  return eventFrame(chat, msgId, { type: "action", source, name, value });
}

/** event for a form submission carrying all field values. */
export function formSubmitFrame(
  chat: string,
  msgId: string,
  formId: string,
  values: Record<string, string | number | string[]>,
): Frame {
  return eventFrame(chat, msgId, { type: "submit", form: formId, values });
}

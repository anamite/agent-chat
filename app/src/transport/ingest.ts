/**
 * ingest.ts — apply an inbound, already-validated frame to local SQLite.
 *
 * Keeps the socket layer free of storage concerns: socket validates + dedupes,
 * this module decides how each frame mutates the message store.
 */

import type { Frame } from "../protocol/protocol";
import {
  appendStream,
  setMessageStatus,
  upsertMessage,
} from "../store/db";

export async function applyFrame(frame: Frame): Promise<void> {
  switch (frame.kind) {
    case "message":
      await upsertMessage(
        frame.msgId,
        frame.chat,
        frame.from,
        frame.ts,
        frame.blocks,
        frame.from === "user" ? "delivered" : null,
        false,
      );
      break;

    case "stream":
      await appendStream(frame.msgId, frame.chat, frame.delta ?? "", !!frame.done);
      break;

    case "edit":
      // Patch the message's blocks in place (e.g. card pending -> approved).
      await upsertMessage(frame.msgId, frame.chat, frame.from, frame.ts, frame.blocks);
      break;

    case "receipt":
      await setMessageStatus(frame.msgId, frame.status);
      break;

    // typing / pong / ping / hello / error carry no persistent message state here.
    default:
      break;
  }
}

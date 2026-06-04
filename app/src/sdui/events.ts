/**
 * events.ts — helper for interactive blocks to emit event frames.
 *
 * An interactive block (buttons/form/card/…) belongs to a message (`msgId`).
 * When the user acts, we build an `event` frame referencing that message and
 * send it through the socket; the Bridge injects it as the user's next turn so
 * the agent "sees" the choice (§3 round-trip).
 */

import { useCallback } from "react";
import { useApp, DEFAULT_CHAT } from "../store/app";
import { actionEventFrame, formSubmitFrame } from "../protocol/encode";

export function useBlockEvents(msgId: string) {
  const socket = useApp((s) => s.socket);

  const sendAction = useCallback(
    (source: string, name: string, value?: string) => {
      if (!socket) return;
      void socket.send(actionEventFrame(DEFAULT_CHAT, msgId, source, name, value));
    },
    [socket, msgId],
  );

  const sendSubmit = useCallback(
    (formId: string, values: Record<string, string | number | string[]>) => {
      if (!socket) return;
      void socket.send(formSubmitFrame(DEFAULT_CHAT, msgId, formId, values));
    },
    [socket, msgId],
  );

  return { sendAction, sendSubmit };
}

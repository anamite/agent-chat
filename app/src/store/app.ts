/**
 * app.ts — global app state (zustand). Thin and synchronous.
 *
 * Holds pairing status, the live socket connection state, and a hook to wire
 * the BridgeSocket. Message persistence lives in SQLite (store/db.ts); this
 * store keeps only the in-memory view models the UI subscribes to.
 */

import { create } from "zustand";
import Constants from "expo-constants";
import { BridgeSocket, type ConnState } from "../transport/socket";
import {
  clearPairing,
  loadPairing,
  savePairing,
  type Pairing,
} from "../features/pairing/pairing";
import { clearStuckStreams, getMessages, type MessageRow } from "./db";
import { applyFrame } from "../transport/ingest";
import type { Frame } from "../protocol/protocol";

const DEFAULT_CHAT = "main";

interface AppState {
  ready: boolean;
  pairing: Pairing | null;
  connState: ConnState;
  socket: BridgeSocket | null;
  messages: MessageRow[];
  agentTyping: boolean;
  /** Last user-facing error (structured error frame or auth failure), if any. */
  lastError: string | null;

  init: () => Promise<void>;
  pair: (p: Pairing) => Promise<void>;
  unpair: () => Promise<void>;
  connect: () => void;
  disconnect: () => void;
  refreshMessages: () => Promise<void>;
  setError: (msg: string | null) => void;
}

/** Map Bridge error codes to friendly copy; fall back to the server message. */
function friendlyError(code: string, message: string): string {
  switch (code) {
    case "rate_limited":
      return "Slow down — too many messages at once.";
    case "frame_too_large":
      return "That message was too large to send.";
    case "too_many_blocks":
      return "That message had too many parts.";
    case "invalid_frame":
      return "The Bridge rejected a malformed message.";
    default:
      return message || "Something went wrong on the Bridge.";
  }
}

function deviceId(): string {
  // Stable-ish per-install id; replace with a persisted UUID in M1.
  return Constants.sessionId ?? "device-local";
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  pairing: null,
  connState: "idle",
  socket: null,
  messages: [],
  agentTyping: false,
  lastError: null,

  init: async () => {
    const pairing = await loadPairing();
    set({ pairing, ready: true });
    // Clear any messages left mid-stream from a previous session crash/disconnect.
    await clearStuckStreams();
    if (pairing) get().connect();
    await get().refreshMessages();
  },

  pair: async (p) => {
    await savePairing(p);
    set({ pairing: p });
    get().connect();
  },

  unpair: async () => {
    get().disconnect();
    await clearPairing();
    set({ pairing: null });
  },

  connect: () => {
    const { pairing, socket } = get();
    if (!pairing) return;
    socket?.close();
    // Clear streaming state before reconnecting; the Bridge replay will restore active streams.
    void clearStuckStreams();

    const s = new BridgeSocket({
      pairing,
      chat: DEFAULT_CHAT,
      deviceId: deviceId(),
      events: {
        onState: (connState) => set({ connState }),
        onFrame: (frame: Frame) => {
          // Typing is transient connection state, not persisted.
          if (frame.kind === "typing") {
            set({ agentTyping: frame.state === "start" });
            return;
          }
          // Structured error frames surface as a dismissable banner (§M5).
          if (frame.kind === "error") {
            set({ lastError: friendlyError(frame.code, frame.message) });
            return;
          }
          // A finished agent message ends the typing indicator.
          if (frame.kind === "message" && frame.from === "agent") {
            set({ agentTyping: false });
          }
          void applyFrame(frame).then(() => get().refreshMessages());
        },
        onError: (e) => console.warn("[socket]", e),
        onAuthFail: () => {
          // Token revoked/invalid: drop the stale credential and prompt re-pair.
          void get().unpair();
          set({
            lastError: "This device was unpaired by the Bridge. Pair again in Settings.",
          });
        },
      },
    });
    s.connect();
    set({ socket: s, agentTyping: false });
  },

  disconnect: () => {
    get().socket?.close();
    set({ socket: null, connState: "closed", agentTyping: false });
  },

  refreshMessages: async () => {
    const messages = await getMessages(DEFAULT_CHAT);
    set({ messages });
  },

  setError: (msg) => set({ lastError: msg }),
}));

export { DEFAULT_CHAT };

/**
 * socket.ts — single WebSocket client.
 *
 * Transport rules (§2):
 *   - One connection. On open, send `hello {device, sinceTs}`; Bridge replays
 *     frames newer than sinceTs.
 *   - Heartbeat: ping every ~20s; if no pong within ~10s, drop + reconnect
 *     with exponential backoff + jitter (cap ~30s).
 *   - Outbox: user frames persisted before send, removed on receipt(delivered);
 *     replayed on reconnect. Bridge dedupes by ULID id.
 *   - Validate EVERY inbound frame with parseFrame(); log + drop on failure.
 *
 * Token auth: sent as `Authorization: Bearer` where the platform allows custom
 * WS headers (React Native does), with a first-frame token fallback baked into
 * the hello frame for tunnels that strip headers.
 */

import { Platform } from "react-native";
import { safeParseFrame, type DeviceInfo, type Frame } from "../protocol/protocol";
import { helloFrame, pingFrame } from "../protocol/encode";
import type { Pairing } from "../features/pairing/pairing";
import {
  dequeueOutbox,
  enqueueOutbox,
  getMeta,
  getOutbox,
  setMeta,
} from "../store/db";

export type ConnState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface SocketEvents {
  onState?: (state: ConnState) => void;
  onFrame?: (frame: Frame) => void;
  onError?: (err: unknown) => void;
  /** The Bridge rejected our device token (revoked/invalid). No retry helps. */
  onAuthFail?: () => void;
}

// WS close codes the Bridge uses to reject a connection (see bridge/main.py).
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_RATE_LIMITED = 4429;

const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const LAST_TS_KEY = "lastSeenTs";

function httpToWs(url: string, path = "/ws"): string {
  // Accept ws(s):// directly, or http(s):// and upgrade the scheme.
  let u = url.trim();
  if (u.startsWith("http://")) u = "ws://" + u.slice(7);
  else if (u.startsWith("https://")) u = "wss://" + u.slice(8);
  u = u.replace(/\/+$/, "");
  return u.endsWith(path) ? u : u + path;
}

export class BridgeSocket {
  private ws: WebSocket | null = null;
  private state: ConnState = "idle";
  private pairing: Pairing;
  private device: DeviceInfo;
  private chat: string;
  private events: SocketEvents;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(opts: {
    pairing: Pairing;
    chat?: string;
    deviceId: string;
    events?: SocketEvents;
  }) {
    this.pairing = opts.pairing;
    this.chat = opts.chat ?? "main";
    this.device = {
      id: opts.deviceId,
      platform: Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web",
    };
    this.events = opts.events ?? {};
  }

  get connectionState(): ConnState {
    return this.state;
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  close(): void {
    this.stopped = true;
    this.clearTimers();
    this.setState("closed");
    this.ws?.close();
    this.ws = null;
  }

  /** Send a frame, persisting user-originated message/event frames to the outbox first. */
  async send(frame: Frame): Promise<void> {
    const needsAck = frame.kind === "message" || frame.kind === "event";
    if (needsAck) await enqueueOutbox(frame);
    this.rawSend(frame);
  }

  // --- internals ----------------------------------------------------------

  private setState(s: ConnState) {
    this.state = s;
    this.events.onState?.(s);
  }

  private rawSend(frame: Frame): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  private open(): void {
    this.setState(this.attempt === 0 ? "connecting" : "reconnecting");
    const url = httpToWs(this.pairing.tunnelUrl);

    // React Native's WebSocket accepts a headers option as a 3rd arg, which the
    // DOM lib's 2-arg WebSocket type doesn't model — construct via `any`.
    const WS = WebSocket as unknown as {
      new (url: string, protocols: undefined, options: { headers: Record<string, string> }): WebSocket;
    };
    const ws = new WS(url, undefined, {
      headers: { Authorization: `Bearer ${this.pairing.deviceToken}` },
    });
    this.ws = ws;

    ws.onopen = () => this.onOpen();
    ws.onmessage = (e) => this.onMessage(e);
    ws.onerror = (e) => this.events.onError?.(e);
    ws.onclose = (e) => this.onClose((e as { code?: number })?.code);
  }

  private async onOpen(): Promise<void> {
    this.attempt = 0;
    this.setState("open");

    const sinceTs = Number((await getMeta(LAST_TS_KEY)) ?? "0");
    const hello = helloFrame(this.chat, this.device, sinceTs) as any;
    // First-frame token fallback for tunnels that strip the Authorization header.
    hello.token = this.pairing.deviceToken;
    this.rawSend(hello);

    await this.flushOutbox();
    this.startHeartbeat();
  }

  private async flushOutbox(): Promise<void> {
    const pending = await getOutbox();
    for (const frame of pending) this.rawSend(frame);
  }

  private startHeartbeat(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      this.rawSend(pingFrame(this.chat));
      this.armPongTimeout();
    }, PING_INTERVAL_MS);
  }

  private armPongTimeout(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      // No pong in time — force a reconnect.
      this.ws?.close();
    }, PONG_TIMEOUT_MS);
  }

  private onMessage(e: WebSocketMessageEvent): void {
    let data: unknown;
    try {
      data = JSON.parse(String(e.data));
    } catch {
      return; // drop non-JSON
    }
    const parsed = safeParseFrame(data);
    if (!parsed.success) {
      // Never trust the wire: log + drop.
      console.warn("[ws] dropped invalid frame", parsed.error?.issues?.[0]);
      return;
    }
    const frame = parsed.data;
    void this.handleFrame(frame);
  }

  private async handleFrame(frame: Frame): Promise<void> {
    // Advance the replay cursor.
    await setMeta(LAST_TS_KEY, String(frame.ts));

    switch (frame.kind) {
      case "pong":
        if (this.pongTimer) clearTimeout(this.pongTimer);
        break;
      case "receipt":
        if (frame.status === "delivered" || frame.status === "read") {
          await dequeueOutbox(frame.msgId);
        }
        break;
      default:
        break;
    }
    this.events.onFrame?.(frame);
  }

  private onClose(code?: number): void {
    this.clearTimers();
    if (this.stopped) return;
    // A revoked/invalid token will keep being rejected — stop the retry loop and
    // let the app clear the stale credential (token rotation, §M5 auth).
    if (code === CLOSE_UNAUTHORIZED) {
      this.stopped = true;
      this.setState("closed");
      this.events.onAuthFail?.();
      return;
    }
    // Rate-limited: back off harder rather than hammering on the cap.
    if (code === CLOSE_RATE_LIMITED) this.attempt = Math.max(this.attempt, 4);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_CAP_MS);
    const jitter = Math.random() * 0.3 * backoff;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.open(), backoff + jitter);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

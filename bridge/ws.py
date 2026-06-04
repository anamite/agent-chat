"""
ws.py — WebSocket connection hub + frame handling.

Responsibilities (M0 subset of §2 transport rules):
  * Authenticate the connection (Bearer header or first-frame hello token).
  * Validate EVERY inbound frame against the pydantic schema; drop on failure.
  * hello -> replay frames newer than sinceTs (§4.3).
  * ping -> pong.
  * Persist frames to the append-only log; dedupe inbound by frame id.
  * Fan out outbound frames to all live connections for a chat.

M1+ will extend the message branch to drive the Hermes streaming loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict

logger = logging.getLogger("bridge.ws")

from fastapi import WebSocket
from pydantic import ValidationError

from .config import Settings, get_settings
from .db import Database
from .hermes import handle_event_turn, handle_user_turn
from . import pydantic_schema as ps
from .ratelimit import TokenBucket
from .ulid import new_ulid

# Per-connection inbound frame limiter, keyed by device hash. Module-level so it
# survives across reconnects of the same device within the process.
_settings = get_settings()
frame_limiter = TokenBucket(_settings.ws_rate_limit_per_min)


def now_ms() -> int:
    return int(time.time() * 1000)


class ConnectionManager:
    """Tracks live WebSocket connections, keyed by device hash."""

    def __init__(self) -> None:
        # device_hash -> set of sockets (a device may briefly have two during reconnect)
        self._conns: dict[str, set[WebSocket]] = defaultdict(set)

    async def register(self, device: str, ws: WebSocket) -> None:
        self._conns[device].add(ws)

    def unregister(self, device: str, ws: WebSocket) -> None:
        self._conns[device].discard(ws)
        if not self._conns[device]:
            self._conns.pop(device, None)

    @property
    def sockets(self) -> list[WebSocket]:
        out: list[WebSocket] = []
        for group in self._conns.values():
            out.extend(group)
        return out

    async def broadcast(self, frame: dict, exclude: WebSocket | None = None) -> None:
        """Send a frame dict to every connected socket (single-user system).

        `exclude` skips one socket — used so the sender of a user message isn't
        echoed its own frame back (it already has it locally).
        """
        text = json.dumps(frame, separators=(",", ":"))
        dead: list[tuple[str, WebSocket]] = []
        for device, group in list(self._conns.items()):
            for ws in list(group):
                if ws is exclude:
                    continue
                try:
                    await ws.send_text(text)
                except Exception:
                    dead.append((device, ws))
        for device, ws in dead:
            self.unregister(device, ws)


class WSHandler:
    """Per-connection frame loop. One instance per accepted socket."""

    def __init__(
        self,
        ws: WebSocket,
        device: str,
        db: Database,
        manager: ConnectionManager,
        settings: Settings,
    ):
        self.ws = ws
        self.device = device
        self.db = db
        self.manager = manager
        self.settings = settings
        self._tasks: set[asyncio.Task] = set()

    async def run(self) -> None:
        await self.manager.register(self.device, self.ws)
        try:
            while True:
                raw = await self.ws.receive_text()
                await self._handle_raw(raw)
        finally:
            self.manager.unregister(self.device, self.ws)

    async def _handle_raw(self, raw: str) -> None:
        # Per-connection rate limit (token bucket). Drop floods before any work.
        if not frame_limiter.allow(self.device):
            logger.warning("rate-limited device %s…", self.device[:12])
            await self._send_error("rate_limited", "too many frames; slow down")
            return
        # Size guard before parsing.
        if len(raw.encode("utf-8")) > self.settings.max_frame_bytes:
            logger.warning("oversized frame from %s…", self.device[:12])
            await self._send_error("frame_too_large", "frame exceeds max size")
            return
        try:
            frame = ps.parse_frame_json(raw)
        except (ValidationError, json.JSONDecodeError, ValueError) as e:
            # Never trust the wire: log + drop malformed frames.
            logger.warning("dropped invalid frame from %s…: %s", self.device[:12], e)
            await self._send_error("invalid_frame", "frame failed schema validation")
            return
        await self._dispatch(frame)

    async def _dispatch(self, frame: ps.BaseModel) -> None:
        kind = frame.kind  # type: ignore[attr-defined]
        wire = ps.frame_to_wire(frame)

        if kind == "ping":
            await self._send(self._envelope("pong", wire["chat"]))
            return

        if kind == "hello":
            await self._replay(wire["chat"], frame.sinceTs or 0)  # type: ignore[attr-defined]
            return

        if kind == "pong":
            return  # liveness only

        # Block-count cap (mirror Hermes' input hardening, §6).
        if kind in ("message", "edit"):
            blocks = wire.get("blocks") or []
            if len(blocks) > self.settings.max_blocks_per_message:
                logger.warning("too many blocks (%d) from %s…", len(blocks), self.device[:12])
                await self._send_error("too_many_blocks", "message exceeds block limit")
                return

        # Persist + dedupe everything else (message/event/edit/receipt/typing/...).
        inserted = await self.db.append_frame(wire)
        if not inserted:
            return  # duplicate id — idempotent drop

        if kind == "message" and wire.get("from") == "user":
            # Acknowledge immediately (§4.1), fan out to OTHER devices only
            # (this socket already has its own message locally), then drive the
            # Hermes turn in the background (voice transcription + streaming).
            await self._send(self._receipt(wire["chat"], wire["msgId"]))
            await self.manager.broadcast(wire, exclude=self.ws)
            self._spawn(
                handle_user_turn(self.db, self.settings, self.manager.broadcast, wire)
            )
            return

        if kind == "event":
            # Interactive-block events: ack, fan out, then inject into the
            # Hermes session as the user's next turn (§3 round-trip).
            await self._send(self._receipt(wire["chat"], wire["msgId"]))
            await self.manager.broadcast(wire, exclude=self.ws)
            self._spawn(
                handle_event_turn(self.db, self.settings, self.manager.broadcast, wire)
            )
            return

        # Any other agent-origin frame arriving over the socket: fan out as-is.
        await self.manager.broadcast(wire)

    def _spawn(self, coro) -> None:
        """Run a coroutine in the background without blocking the receive loop."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _replay(self, chat: str, since_ts: int) -> None:
        frames = await self.db.replay_since(chat, since_ts)
        for f in frames:
            await self._send(f)

    # --- frame builders --------------------------------------------------

    def _envelope(self, kind: str, chat: str, **extra) -> dict:
        return {
            "v": ps.PROTOCOL_VERSION,
            "id": new_ulid(),
            "ts": now_ms(),
            "chat": chat,
            "from": "agent",
            "kind": kind,
            **extra,
        }

    def _receipt(self, chat: str, msg_id: str) -> dict:
        return self._envelope("receipt", chat, msgId=msg_id, status="delivered")

    async def _send(self, frame: dict) -> None:
        await self.ws.send_text(json.dumps(frame, separators=(",", ":")))

    async def _send_error(self, code: str, message: str) -> None:
        await self._send(self._envelope("error", "system", code=code, message=message))

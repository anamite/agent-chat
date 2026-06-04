"""
db.py — aiosqlite persistence for the Bridge.

Tables
------
frame_log      append-only per-chat frame log for reconnect/replay (§4.3).
               (chat, seq) is monotonic; ``id`` dedupes inbound by frame id.
uploads        file metadata for POST /files / GET /files/{id}.
token_allowlist  SHA-256 hashes of issued device tokens (revocable).

The frame *payload* is stored as JSON text; binaries never live here (files go
to the uploads dir, referenced by fileId).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS frame_log (
    rowid    INTEGER PRIMARY KEY AUTOINCREMENT,
    id       TEXT    NOT NULL,              -- frame ULID (dedupe key)
    chat     TEXT    NOT NULL,
    ts       INTEGER NOT NULL,              -- epoch ms
    seq      INTEGER NOT NULL,              -- monotonic per chat
    kind     TEXT    NOT NULL,
    sender   TEXT    NOT NULL,              -- 'user' | 'agent'
    payload  TEXT    NOT NULL               -- full frame as JSON
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_frame_id ON frame_log(id);
CREATE INDEX IF NOT EXISTS idx_frame_chat_ts ON frame_log(chat, ts);
CREATE INDEX IF NOT EXISTS idx_frame_chat_seq ON frame_log(chat, seq);

CREATE TABLE IF NOT EXISTS uploads (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    mime       TEXT,
    size       INTEGER NOT NULL,
    path       TEXT NOT NULL,
    thumb_id   TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS token_allowlist (
    token_hash TEXT PRIMARY KEY,
    label      TEXT,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER
);
"""


def _now_ms() -> int:
    return int(time.time() * 1000)


class Database:
    def __init__(self, path: Path):
        self.path = path
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        # busy_timeout FIRST: the systemd service and one-shot CLI commands
        # (e.g. `pair`) open the same file, so a write can briefly collide with
        # the service's write lock. Without this, SQLite raises "database is
        # locked" immediately; with it, the writer waits up to 5s for the lock.
        await self._conn.execute("PRAGMA busy_timeout=5000;")
        await self._conn.execute("PRAGMA journal_mode=WAL;")
        await self._conn.execute("PRAGMA foreign_keys=ON;")
        await self._conn.executescript(SCHEMA)
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database not connected; call connect() first.")
        return self._conn

    # --- frame log -------------------------------------------------------

    async def append_frame(self, frame: dict[str, Any]) -> bool:
        """
        Append a frame to its chat log. Returns False if the frame id was
        already stored (idempotent dedupe), True on insert.
        """
        chat = frame["chat"]
        cur = await self.conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM frame_log WHERE chat = ?",
            (chat,),
        )
        row = await cur.fetchone()
        seq = row["next"]
        try:
            await self.conn.execute(
                """INSERT INTO frame_log (id, chat, ts, seq, kind, sender, payload)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    frame["id"],
                    chat,
                    frame["ts"],
                    seq,
                    frame["kind"],
                    frame.get("from", "agent"),
                    json.dumps(frame, separators=(",", ":")),
                ),
            )
            await self.conn.commit()
            return True
        except aiosqlite.IntegrityError:
            # Duplicate frame id — already logged.
            return False

    async def update_frame_payload(self, frame_id: str, frame: dict[str, Any]) -> None:
        """Rewrite a logged frame's payload in place (e.g. add a voice transcript)."""
        await self.conn.execute(
            "UPDATE frame_log SET payload = ? WHERE id = ?",
            (json.dumps(frame, separators=(",", ":")), frame_id),
        )
        await self.conn.commit()

    async def replay_since(self, chat: str, since_ts: int) -> list[dict[str, Any]]:
        """Return all frames in a chat strictly newer than since_ts, in order."""
        cur = await self.conn.execute(
            "SELECT payload FROM frame_log WHERE chat = ? AND ts > ? ORDER BY seq ASC",
            (chat, since_ts),
        )
        rows = await cur.fetchall()
        return [json.loads(r["payload"]) for r in rows]

    async def recent_messages(self, chat: str, limit: int) -> list[dict[str, Any]]:
        """Return the last `limit` message frames for a chat, oldest-first."""
        cur = await self.conn.execute(
            """SELECT payload FROM frame_log
               WHERE chat = ? AND kind = 'message'
               ORDER BY seq DESC LIMIT ?""",
            (chat, limit),
        )
        rows = await cur.fetchall()
        return [json.loads(r["payload"]) for r in reversed(rows)]

    async def get_frame_by_id(self, frame_id: str) -> dict[str, Any] | None:
        """Return a logged frame payload by its frame id, or None."""
        cur = await self.conn.execute(
            "SELECT payload FROM frame_log WHERE id = ?", (frame_id,)
        )
        row = await cur.fetchone()
        return json.loads(row["payload"]) if row else None

    async def has_frame(self, frame_id: str) -> bool:
        cur = await self.conn.execute(
            "SELECT 1 FROM frame_log WHERE id = ? LIMIT 1", (frame_id,)
        )
        return await cur.fetchone() is not None

    # --- uploads ---------------------------------------------------------

    async def add_upload(
        self,
        file_id: str,
        name: str | None,
        mime: str | None,
        size: int,
        path: str,
        thumb_id: str | None = None,
    ) -> None:
        await self.conn.execute(
            """INSERT INTO uploads (id, name, mime, size, path, thumb_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (file_id, name, mime, size, path, thumb_id, _now_ms()),
        )
        await self.conn.commit()

    async def get_upload(self, file_id: str) -> dict[str, Any] | None:
        cur = await self.conn.execute(
            "SELECT * FROM uploads WHERE id = ?", (file_id,)
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    # --- token allowlist -------------------------------------------------

    async def add_token_hash(self, token_hash: str, label: str | None = None) -> None:
        await self.conn.execute(
            """INSERT OR IGNORE INTO token_allowlist (token_hash, label, created_at)
               VALUES (?, ?, ?)""",
            (token_hash, label, _now_ms()),
        )
        await self.conn.commit()

    async def list_token_hashes(self) -> list[str]:
        cur = await self.conn.execute("SELECT token_hash FROM token_allowlist")
        return [r["token_hash"] for r in await cur.fetchall()]

    async def list_tokens(self) -> list[dict[str, Any]]:
        cur = await self.conn.execute(
            "SELECT token_hash, label, created_at, last_seen FROM token_allowlist ORDER BY created_at"
        )
        return [dict(r) for r in await cur.fetchall()]

    async def revoke_token_hash(self, token_hash: str) -> bool:
        cur = await self.conn.execute(
            "DELETE FROM token_allowlist WHERE token_hash = ?", (token_hash,)
        )
        await self.conn.commit()
        return cur.rowcount > 0

    async def touch_token(self, token_hash: str) -> None:
        await self.conn.execute(
            "UPDATE token_allowlist SET last_seen = ? WHERE token_hash = ?",
            (_now_ms(), token_hash),
        )
        await self.conn.commit()

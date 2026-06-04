/**
 * db.ts — local persistence (expo-sqlite).
 *
 * Tables
 * ------
 * chats     : known conversations.
 * messages  : one row per message (blocks stored as JSON); streaming appends
 *             into `text` / patches `blocks`.
 * outbox    : user-originated frames written BEFORE send, removed on receipt
 *             (delivered). Replayed on reconnect. Idempotent by frame id.
 *
 * Schema mirrors the Bridge's frame_log responsibilities on the client side.
 */

import * as SQLite from "expo-sqlite";
import type { Block, Frame } from "../protocol/protocol";

const DB_NAME = "hermes.db";

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  msg_id      TEXT PRIMARY KEY,
  chat        TEXT NOT NULL,
  sender      TEXT NOT NULL,            -- 'user' | 'agent'
  ts          INTEGER NOT NULL,
  blocks      TEXT NOT NULL,            -- JSON Block[]
  status      TEXT,                     -- 'sending'|'delivered'|'read'|'failed'
  streaming   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat, ts);

CREATE TABLE IF NOT EXISTS outbox (
  frame_id    TEXT PRIMARY KEY,
  chat        TEXT NOT NULL,
  payload     TEXT NOT NULL,            -- JSON Frame
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key         TEXT PRIMARY KEY,
  value       TEXT
);
`;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;
  _initPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
    await db.execAsync(SCHEMA);
    _db = db;
    return db;
  });
  return _initPromise;
}

// --- messages --------------------------------------------------------------

export interface MessageRow {
  msg_id: string;
  chat: string;
  sender: "user" | "agent";
  ts: number;
  blocks: Block[];
  status: string | null;
  streaming: boolean;
}

export async function upsertMessage(
  msgId: string,
  chat: string,
  sender: "user" | "agent",
  ts: number,
  blocks: Block[],
  status: string | null = null,
  streaming = false,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO messages (msg_id, chat, sender, ts, blocks, status, streaming)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(msg_id) DO UPDATE SET
       blocks = excluded.blocks,
       status = COALESCE(excluded.status, messages.status),
       streaming = excluded.streaming`,
    [msgId, chat, sender, ts, JSON.stringify(blocks), status, streaming ? 1 : 0],
  );
}

/** Append a streamed text delta to a (possibly new) agent message's text block. */
export async function appendStream(
  msgId: string,
  chat: string,
  delta: string,
  done: boolean,
): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ blocks: string }>(
    `SELECT blocks FROM messages WHERE msg_id = ?`,
    [msgId],
  );
  let blocks: Block[];
  if (!row) {
    blocks = [{ type: "text", text: delta }];
    await upsertMessage(msgId, chat, "agent", Date.now(), blocks, null, !done);
    return;
  }
  blocks = JSON.parse(row.blocks) as Block[];
  const first = blocks[0];
  if (first && first.type === "text") {
    first.text += delta;
  } else {
    blocks.unshift({ type: "text", text: delta });
  }
  await db.runAsync(
    `UPDATE messages SET blocks = ?, streaming = ? WHERE msg_id = ?`,
    [JSON.stringify(blocks), done ? 0 : 1, msgId],
  );
}

/** Clear the streaming flag on any messages left mid-stream (e.g. after a disconnect). */
export async function clearStuckStreams(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE messages SET streaming = 0 WHERE streaming = 1`);
}

export async function setMessageStatus(msgId: string, status: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE messages SET status = ? WHERE msg_id = ?`, [status, msgId]);
}

export async function getMessages(chat: string, limit = 200): Promise<MessageRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM messages WHERE chat = ? ORDER BY ts ASC LIMIT ?`,
    [chat, limit],
  );
  return rows.map((r) => ({
    ...r,
    blocks: JSON.parse(r.blocks) as Block[],
    streaming: !!r.streaming,
  }));
}

// --- outbox ----------------------------------------------------------------

export async function enqueueOutbox(frame: Frame): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO outbox (frame_id, chat, payload, created_at)
     VALUES (?, ?, ?, ?)`,
    [frame.id, frame.chat, JSON.stringify(frame), Date.now()],
  );
}

export async function dequeueOutbox(frameId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox WHERE frame_id = ?`, [frameId]);
}

export async function getOutbox(): Promise<Frame[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM outbox ORDER BY created_at ASC`,
  );
  return rows.map((r) => JSON.parse(r.payload) as Frame);
}

// --- meta (e.g. last-seen ts for replay) -----------------------------------

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = ?`,
    [key],
  );
  return row?.value ?? null;
}

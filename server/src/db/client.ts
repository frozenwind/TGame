import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema.js";

export type AppDatabase = SqliteRemoteDatabase<typeof schema>;

export interface OpenedDatabase {
  sqlite: DatabaseSync;
  db: AppDatabase;
  close: () => void;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,
  host_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  turn_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  adult INTEGER NOT NULL,
  category TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_code_idx ON rooms (code);
CREATE INDEX IF NOT EXISTS chat_room_idx ON chat_messages (room_id);
`;

export function openDatabase(filename: string): OpenedDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(MIGRATION);
  const db = drizzle(async (sql, params, method) => {
    const statement = sqlite.prepare(sql);
    const bound = params.map(normalize) as SQLInputValue[];
    if (method === "run") {
      statement.run(...bound);
      return { rows: [] };
    }
    if (method === "get") {
      const row = statement.get(...bound) as Record<string, unknown> | undefined;
      return { rows: (row ? Object.values(row) : undefined) as unknown as any[] };
    }
    const rows = statement.all(...bound) as Array<Record<string, unknown>>;
    return { rows: rows.map((row) => Object.values(row)) };
  }, { schema });
  return {
    sqlite,
    db: db as AppDatabase,
    close: () => sqlite.close(),
  };
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

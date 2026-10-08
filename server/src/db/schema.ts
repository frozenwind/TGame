import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const guests = sqliteTable("guests", {
  id: text("id").primaryKey(),
  nickname: text("nickname").notNull(),
  sessionToken: text("session_token").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  kind: text("kind").notNull(),
  hostId: text("host_id").notNull(),
  phase: text("phase").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
  closedAt: integer("closed_at"),
});

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  turnCount: integer("turn_count").notNull().default(0),
});

export const prompts = sqliteTable("prompts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  level: text("level").notNull(),
  adult: integer("adult", { mode: "boolean" }).notNull(),
  category: text("category").notNull(),
  text: text("text").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  playerId: text("player_id").notNull(),
  nickname: text("nickname").notNull(),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

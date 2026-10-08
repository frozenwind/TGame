import { eq } from "drizzle-orm";
import type { ChatDto, PromptDto } from "../../../shared/protocol.js";
import type { InternalRoom } from "../domain/game.js";
import type { AppDatabase } from "./client.js";
import { chatMessages, games, guests, prompts, rooms } from "./schema.js";

export interface GuestRecord {
  id: string;
  nickname: string;
  sessionToken: string;
  createdAt: number;
}

export class Repository {
  constructor(private readonly db: AppDatabase) {}

  async countPrompts(): Promise<number> {
    const rows = await this.db.select().from(prompts).all();
    return rows.length;
  }

  async insertPrompts(items: PromptDto[]): Promise<void> {
    if (items.length === 0) return;
    await this.db.insert(prompts).values(items).run();
  }

  async listPrompts(): Promise<PromptDto[]> {
    const rows = await this.db.select().from(prompts).all();
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as PromptDto["kind"],
      level: row.level as PromptDto["level"],
      adult: Boolean(row.adult),
      category: row.category,
      text: row.text,
    }));
  }

  async upsertGuest(guest: GuestRecord): Promise<void> {
    await this.db
      .insert(guests)
      .values(guest)
      .onConflictDoUpdate({
        target: guests.id,
        set: { nickname: guest.nickname, sessionToken: guest.sessionToken },
      })
      .run();
  }

  async findGuestByToken(token: string): Promise<GuestRecord | null> {
    const row = await this.db.select().from(guests).where(eq(guests.sessionToken, token)).get();
    return row ?? null;
  }

  async saveRoom(room: InternalRoom, closedAt: number | null = null): Promise<void> {
    const values = {
      id: room.id,
      code: room.code,
      kind: room.kind,
      hostId: room.hostId,
      phase: room.phase,
      snapshotJson: JSON.stringify(room),
      updatedAt: room.updatedAt,
      closedAt,
    };
    await this.db.insert(rooms).values(values).onConflictDoUpdate({ target: rooms.id, set: values }).run();
  }

  async listActiveRooms(since: number): Promise<InternalRoom[]> {
    const rows = await this.db.select().from(rooms).all();
    return rows
      .filter((row) => row.closedAt === null && row.updatedAt >= since)
      .map((row) => JSON.parse(row.snapshotJson) as InternalRoom);
  }

  async insertChat(roomId: string, message: ChatDto): Promise<void> {
    await this.db
      .insert(chatMessages)
      .values({
        id: message.id,
        roomId,
        playerId: message.playerId,
        nickname: message.nickname,
        text: message.text,
        createdAt: message.at * 1000,
      })
      .onConflictDoNothing()
      .run();
  }

  async startGame(id: string, roomId: string, startedAt: number): Promise<void> {
    await this.db
      .insert(games)
      .values({ id, roomId, startedAt, endedAt: null, turnCount: 0 })
      .onConflictDoNothing()
      .run();
  }

  async updateGame(id: string, turnCount: number, endedAt: number | null): Promise<void> {
    await this.db.update(games).set({ turnCount, endedAt }).where(eq(games.id, id)).run();
  }
}

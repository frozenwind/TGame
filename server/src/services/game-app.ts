import {
  isChoice,
  isContentLevel,
  MATCH_SIZE,
  validateNickname,
  type Choice,
  type ContentLevel,
  type GuestResponse,
  type PromptDto,
  type RoomDto,
} from "../../../shared/protocol.js";
import type { AppConfig } from "../config.js";
import { openDatabase, type OpenedDatabase } from "../db/client.js";
import { Repository } from "../db/repository.js";
import { GameError } from "../domain/errors.js";
import {
  addChat,
  addPlayer,
  allocateCode,
  choose,
  complete,
  createCustomRoom,
  createMatchRoom,
  currentPlayerId,
  expireDisconnects,
  kickPlayer,
  markConnection,
  removePlayer,
  setReady,
  setSettings,
  settle,
  skip,
  startGame,
  timeoutTurn,
  toDto,
  type InternalRoom,
} from "../domain/game.js";
import { SEED_PROMPTS } from "../domain/prompts.js";
import { Mutex } from "../mutex.js";
import { RateLimiter } from "./rate-limit.js";

interface Session {
  playerId: string;
  nickname: string;
  token: string;
}

interface QueueEntry {
  playerId: string;
  nickname: string;
  contentLevel: ContentLevel;
  allowAdult: boolean;
  at: number;
}

export type RoomPublisher = (room: RoomDto, reason: string) => void;
export type DirectPublisher = (playerId: string, event: string, payload: unknown) => void;

export class GameApp {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly codes = new Map<string, string>();
  private readonly playerRooms = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();
  private readonly tokens = new Map<string, string>();
  private readonly queue: QueueEntry[] = [];
  private readonly mutex = new Mutex();
  private readonly actions = new RateLimiter();
  private readonly chats = new RateLimiter();
  private catalog: PromptDto[] = [];
  private publisher: RoomPublisher = () => undefined;
  private directPublisher: DirectPublisher = () => undefined;
  private readonly seenBotTurns = new Set<string>();

  constructor(
    readonly config: AppConfig,
    private readonly repo: Repository,
    private readonly closeDb: () => void,
  ) {}

  static async create(config: AppConfig): Promise<GameApp> {
    const opened: OpenedDatabase = openDatabase(config.databasePath);
    const app = new GameApp(config, new Repository(opened.db), opened.close);
    await app.init();
    return app;
  }

  setPublisher(publisher: RoomPublisher): void {
    this.publisher = publisher;
  }

  setDirectPublisher(publisher: DirectPublisher): void {
    this.directPublisher = publisher;
  }

  async init(): Promise<void> {
    if ((await this.repo.countPrompts()) === 0) {
      await this.repo.insertPrompts(SEED_PROMPTS);
    }
    this.catalog = await this.repo.listPrompts();
    const restored = await this.repo.listActiveRooms(Date.now() - this.config.roomTtlMs);
    const now = Date.now();
    for (const room of restored) {
      for (const player of room.players) {
        if (!player.isBot) {
          player.connected = false;
          player.disconnectedAt ??= now;
        }
      }
      this.index(null, room);
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.closeDb();
  }

  async flush(): Promise<void> {
    await this.mutex.run(async () => {
      for (const room of this.rooms.values()) await this.repo.saveRoom(room);
    });
  }

  async login(nicknameRaw: string, sessionToken?: string): Promise<GuestResponse> {
    return this.mutex.run(async () => {
      const nickname = validateNickname(nicknameRaw);
      if (sessionToken) {
        const existing = await this.sessionByToken(sessionToken);
        if (existing) {
          existing.nickname = nickname;
          await this.repo.upsertGuest({
            id: existing.playerId,
            nickname,
            sessionToken: existing.token,
            createdAt: Date.now(),
          });
          return { playerId: existing.playerId, sessionToken: existing.token, nickname };
        }
      }
      const session: Session = {
        playerId: crypto.randomUUID(),
        nickname,
        token: crypto.randomUUID(),
      };
      this.remember(session);
      await this.repo.upsertGuest({
        id: session.playerId,
        nickname: session.nickname,
        sessionToken: session.token,
        createdAt: Date.now(),
      });
      return { playerId: session.playerId, sessionToken: session.token, nickname };
    });
  }

  async authenticate(token: string | undefined): Promise<Session | null> {
    if (!token) return null;
    return this.mutex.run(() => this.sessionByToken(token));
  }

  async createRoom(playerId: string, contentLevel: ContentLevel, allowAdult: boolean): Promise<RoomDto> {
    return this.mutex.run(async () => {
      this.consumeAction(playerId);
      const session = this.requireSession(playerId);
      this.ensureAvailable(playerId);
      const room = createCustomRoom({
        id: crypto.randomUUID(),
        code: allocateCode(new Set(this.codes.keys()), Math.random),
        host: { id: session.playerId, nickname: session.nickname },
        contentLevel,
        allowAdult,
        safetyCap: this.config.safetyCap,
        now: Date.now(),
      });
      await this.commit(null, room, "create");
      return toDto(room);
    });
  }

  async joinRoom(playerId: string, code: string): Promise<RoomDto> {
    return this.mutex.run(async () => {
      this.consumeAction(playerId);
      const session = this.requireSession(playerId);
      const room = this.roomByCode(code);
      const currentId = this.playerRooms.get(playerId);
      if (currentId && currentId !== room.id) throw new GameError("conflict", "请先离开当前房间");
      const next = addPlayer(room, { id: session.playerId, nickname: session.nickname }, Date.now());
      if (next.revision !== room.revision) await this.commit(room, next, "join");
      return toDto(next);
    });
  }

  async leaveRoom(playerId: string): Promise<void> {
    await this.mutex.run(async () => {
      const located = this.locate(playerId);
      if (!located) return;
      const next = removePlayer(located, playerId, Date.now(), this.config.turnTimeoutMs);
      if (!next) await this.closeRoom(located);
      else await this.commit(located, next, "leave");
    });
  }

  async setReady(playerId: string, ready: boolean): Promise<RoomDto> {
    return this.mutate(playerId, "ready", (room) => setReady(room, playerId, ready, Date.now()));
  }

  async setContent(playerId: string, contentLevel: ContentLevel, allowAdult: boolean): Promise<RoomDto> {
    return this.mutate(playerId, "settings", (room) =>
      setSettings(room, playerId, contentLevel, allowAdult, Date.now()),
    );
  }

  async start(playerId: string): Promise<RoomDto> {
    return this.mutate(playerId, "start", (room) =>
      startGame(room, playerId, Date.now(), Math.random, crypto.randomUUID(), this.config.turnTimeoutMs),
    );
  }

  async kick(playerId: string, targetId: string): Promise<RoomDto | null> {
    return this.mutex.run(async () => {
      this.consumeAction(playerId);
      const room = this.locate(playerId);
      if (!room) throw new GameError("not_found", "你不在房间里");
      const next = kickPlayer(room, playerId, targetId, Date.now(), this.config.turnTimeoutMs);
      this.directPublisher(targetId, "kicked", { roomId: room.id });
      if (!next) {
        await this.closeRoom(room);
        return null;
      }
      await this.commit(room, next, "kick");
      return toDto(next);
    });
  }

  async chat(playerId: string, text: string): Promise<RoomDto> {
    return this.mutex.run(async () => {
      if (!this.chats.allow(playerId, this.config.chatLimit, this.config.rateWindowMs, Date.now())) {
        throw new GameError("rate_limited", "发送太频繁，请稍后再试");
      }
      const room = this.locate(playerId);
      if (!room) throw new GameError("not_found", "你不在房间里");
      const next = addChat(room, playerId, text, Date.now(), crypto.randomUUID());
      await this.commit(room, next, "chat");
      return toDto(next);
    });
  }

  async choose(playerId: string, choice: Choice, requestId: string): Promise<RoomDto> {
    return this.mutate(playerId, "choice", (room) =>
      choose(room, playerId, choice, requestId, this.catalog, Date.now(), Math.random, this.config.turnTimeoutMs),
    );
  }

  async complete(playerId: string, requestId: string): Promise<RoomDto> {
    return this.mutate(playerId, "resolve", (room) =>
      complete(room, playerId, requestId, Date.now(), this.config.resolveWindowMs),
    );
  }

  async skip(playerId: string, requestId: string): Promise<RoomDto> {
    return this.mutate(playerId, "resolve", (room) =>
      skip(room, playerId, requestId, Date.now(), this.config.resolveWindowMs),
    );
  }

  async sync(playerId: string): Promise<RoomDto | null> {
    return this.mutex.run(async () => {
      const room = this.locate(playerId);
      return room ? toDto(room) : null;
    });
  }

  async enqueue(playerId: string, contentLevel: ContentLevel, allowAdult: boolean): Promise<{ room?: RoomDto; size: number }> {
    return this.mutex.run(async () => {
      this.consumeAction(playerId);
      const session = this.requireSession(playerId);
      if (this.playerRooms.has(playerId)) throw new GameError("conflict", "请先离开当前房间");
      if (!this.queue.some((entry) => entry.playerId === playerId)) {
        this.queue.push({ playerId, nickname: session.nickname, contentLevel, allowAdult, at: Date.now() });
      }
      const bucket = this.bucket(contentLevel, allowAdult);
      if (bucket.length >= MATCH_SIZE) {
        const group = bucket.slice(0, MATCH_SIZE);
        this.queue.splice(0, this.queue.length, ...this.queue.filter((entry) => !group.includes(entry)));
        const room = createMatchRoom({
          id: crypto.randomUUID(),
          code: allocateCode(new Set(this.codes.keys()), Math.random),
          members: group.map((entry) => ({ id: entry.playerId, nickname: entry.nickname })),
          contentLevel,
          allowAdult,
          safetyCap: this.config.safetyCap,
          now: Date.now(),
          rng: Math.random,
          gameId: crypto.randomUUID(),
          turnTimeoutMs: this.config.turnTimeoutMs,
        });
        await this.commit(null, room, "match");
        return { room: toDto(room), size: MATCH_SIZE };
      }
      for (const entry of bucket) {
        this.directPublisher(entry.playerId, "match.queued", { queued: true, size: bucket.length, needed: MATCH_SIZE });
      }
      return { size: bucket.length };
    });
  }

  async cancelMatch(playerId: string): Promise<void> {
    await this.mutex.run(async () => {
      const entry = this.queue.find((item) => item.playerId === playerId);
      if (!entry) return;
      this.queue.splice(this.queue.indexOf(entry), 1);
      const bucket = this.bucket(entry.contentLevel, entry.allowAdult);
      this.directPublisher(playerId, "match.queued", { queued: false, size: bucket.length, needed: MATCH_SIZE });
    });
  }

  async connect(playerId: string): Promise<RoomDto | null> {
    return this.mutex.run(async () => {
      const room = this.locate(playerId);
      if (!room) return null;
      const next = markConnection(room, playerId, true, Date.now());
      if (next.revision !== room.revision) await this.commit(room, next, "connection");
      return toDto(this.rooms.get(room.id) ?? next);
    });
  }

  async disconnect(playerId: string): Promise<void> {
    await this.mutex.run(async () => {
      const queued = this.queue.find((entry) => entry.playerId === playerId);
      if (queued) this.queue.splice(this.queue.indexOf(queued), 1);
      const room = this.locate(playerId);
      if (!room) return;
      const next = markConnection(room, playerId, false, Date.now());
      if (next.revision !== room.revision) await this.commit(room, next, "connection");
    });
  }

  async tick(now = Date.now()): Promise<RoomDto[]> {
    return this.mutex.run(async () => {
      const changed: RoomDto[] = [];
      for (const original of [...this.rooms.values()]) {
        let current = original;
        const timedOut = timeoutTurn(current, now, this.config.resolveWindowMs);
        if (timedOut) current = timedOut;
        const settled = settle(current, now, this.config.turnTimeoutMs);
        if (settled) current = settled;
        const expired = expireDisconnects(current, now, this.config.disconnectGraceMs, this.config.turnTimeoutMs);
        if (!expired) {
          await this.closeRoom(current);
          continue;
        }
        if (expired.revision !== original.revision) {
          const reason = timedOut ? "timeout" : settled ? "resolve" : "connection";
          await this.commit(original, expired, reason);
          changed.push(toDto(expired));
        }
      }
      this.driveBots();
      return changed;
    });
  }

  async fillBots(playerId: string, targetSize = MATCH_SIZE, start = false): Promise<RoomDto> {
    return this.mutex.run(async () => {
      if (!this.config.devTools) throw new GameError("forbidden", "开发工具已关闭");
      let room = this.locate(playerId);
      if (!room) throw new GameError("not_found", "你不在房间里");
      const target = Math.min(targetSize, room.safetyCap);
      while (room.players.length < target) {
        const botNumber = room.players.filter((player) => player.isBot).length + 1;
        room = addPlayer(room, { id: `bot:${crypto.randomUUID()}`, nickname: `机器人${botNumber}`, isBot: true }, Date.now());
        const bot = room.players[room.players.length - 1];
        if (bot) bot.ready = true;
      }
      if (start && room.phase === "lobby") {
        for (const player of room.players) player.ready = true;
        room = startGame(room, playerId, Date.now(), Math.random, crypto.randomUUID(), this.config.turnTimeoutMs);
      }
      await this.commit(this.locate(playerId) ?? room, room, start ? "start" : "join");
      this.driveBots();
      return toDto(room);
    });
  }

  async botStep(roomId: string, playerId: string): Promise<void> {
    await this.mutex.run(async () => {
      const room = this.rooms.get(roomId);
      if (!room || currentPlayerId(room) !== playerId) return;
      const requestId = `bot:${room.revision}:${playerId}`;
      if (room.phase === "choosing") {
        const choice: Choice = Math.random() < 0.5 ? "truth" : "dare";
        const next = choose(room, playerId, choice, requestId, this.catalog, Date.now(), Math.random, this.config.turnTimeoutMs);
        if (next.revision !== room.revision) await this.commit(room, next, "choice");
      } else if (room.phase === "answering") {
        const next = complete(room, playerId, requestId, Date.now(), this.config.resolveWindowMs);
        if (next.revision !== room.revision) await this.commit(room, next, "resolve");
      }
      this.driveBots();
    });
  }

  listRooms(): RoomDto[] {
    return [...this.rooms.values()].map((room) => toDto(room));
  }

  queueSize(contentLevel: ContentLevel, allowAdult: boolean): number {
    return this.bucket(contentLevel, allowAdult).length;
  }

  prompts(contentLevel?: string, allowAdult = false): PromptDto[] {
    return this.catalog.filter((prompt) => {
      if (!allowAdult && prompt.adult) return false;
      if (contentLevel && isContentLevel(contentLevel)) {
        const order = ["mild", "spicy", "wild"];
        return order.indexOf(prompt.level) <= order.indexOf(contentLevel);
      }
      return true;
    });
  }

  private async mutate(playerId: string, reason: string, change: (room: InternalRoom) => InternalRoom): Promise<RoomDto> {
    return this.mutex.run(async () => {
      if (!playerId.startsWith("bot:")) this.consumeAction(playerId);
      const room = this.locate(playerId);
      if (!room) throw new GameError("not_found", "你不在房间里");
      const next = change(room);
      if (next.revision !== room.revision) await this.commit(room, next, reason);
      return toDto(next);
    });
  }

  private async commit(previous: InternalRoom | null, next: InternalRoom, reason: string): Promise<void> {
    const before = new Set(previous?.chat.map((message) => message.id) ?? []);
    this.index(previous, next);
    await this.repo.saveRoom(next);
    for (const message of next.chat) {
      if (!before.has(message.id)) await this.repo.insertChat(next.id, message);
    }
    if (next.gameId && next.gameId !== previous?.gameId) {
      await this.repo.startGame(next.gameId, next.id, next.updatedAt);
    }
    if (next.gameId) await this.repo.updateGame(next.gameId, next.turnCount, next.phase === "lobby" ? next.updatedAt : null);
    if (previous?.gameId && previous.gameId !== next.gameId) {
      await this.repo.updateGame(previous.gameId, previous.turnCount, next.updatedAt);
    }
    const dto = toDto(next);
    this.publisher(dto, reason);
    if (this.config.enableBots) this.observeBots(dto);
  }

  private async closeRoom(room: InternalRoom): Promise<void> {
    this.index(room, null);
    await this.repo.saveRoom(room, Date.now());
    this.directPublisher("*", "closed", { roomId: room.id });
  }

  private index(previous: InternalRoom | null, next: InternalRoom | null): void {
    if (previous) {
      for (const player of previous.players) {
        if (this.playerRooms.get(player.id) === previous.id) this.playerRooms.delete(player.id);
      }
      this.codes.delete(previous.code);
      if (!next) this.rooms.delete(previous.id);
    }
    if (next) {
      this.rooms.set(next.id, next);
      this.codes.set(next.code, next.id);
      for (const player of next.players) this.playerRooms.set(player.id, next.id);
    }
  }

  private locate(playerId: string): InternalRoom | null {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }

  private roomByCode(code: string): InternalRoom {
    const roomId = this.codes.get(code.trim().toUpperCase());
    const room = roomId ? this.rooms.get(roomId) : null;
    if (!room) throw new GameError("not_found", "房间不存在或已关闭");
    return room;
  }

  private ensureAvailable(playerId: string): void {
    if (this.playerRooms.has(playerId)) throw new GameError("conflict", "请先离开当前房间");
    const queued = this.queue.find((entry) => entry.playerId === playerId);
    if (queued) this.queue.splice(this.queue.indexOf(queued), 1);
  }

  private bucket(contentLevel: ContentLevel, allowAdult: boolean): QueueEntry[] {
    return this.queue
      .filter((entry) => entry.contentLevel === contentLevel && entry.allowAdult === allowAdult)
      .sort((a, b) => a.at - b.at);
  }

  private requireSession(playerId: string): Session {
    const session = [...this.sessions.values()].find((item) => item.playerId === playerId);
    if (!session) throw new GameError("unauthorized", "登录已失效");
    return session;
  }

  private async sessionByToken(token: string): Promise<Session | null> {
    const cachedId = this.tokens.get(token);
    if (cachedId) return this.sessions.get(cachedId) ?? null;
    const row = await this.repo.findGuestByToken(token);
    if (!row) return null;
    const session = { playerId: row.id, nickname: row.nickname, token: row.sessionToken };
    this.remember(session);
    return session;
  }

  private remember(session: Session): void {
    this.sessions.set(session.playerId, session);
    this.tokens.set(session.token, session.playerId);
  }

  private consumeAction(playerId: string): void {
    if (playerId.startsWith("bot:")) return;
    if (!this.actions.allow(playerId, this.config.actionLimit, this.config.rateWindowMs, Date.now())) {
      throw new GameError("rate_limited", "操作太频繁，请稍后再试");
    }
  }

  private observeBots(room: RoomDto): void {
    if (!room.currentPlayerId) return;
    const current = room.players.find((player) => player.id === room.currentPlayerId);
    if (!current?.isBot || (room.phase !== "choosing" && room.phase !== "answering")) return;
    const key = `${room.id}:${room.revision}`;
    if (this.seenBotTurns.has(key)) return;
    this.seenBotTurns.add(key);
    const roomId = room.id;
    const playerId = current.id;
    setTimeout(() => {
      void this.botStep(roomId, playerId);
    }, 300);
  }

  private driveBots(): void {
    if (!this.config.enableBots) return;
    for (const room of this.rooms.values()) this.observeBots(toDto(room));
  }
}

export function parseLevel(value: unknown, fallback: ContentLevel = "mild"): ContentLevel {
  return isContentLevel(value) ? value : fallback;
}

export function parseChoice(value: unknown): Choice {
  if (!isChoice(value)) throw new GameError("bad_request", "请选择真心话或大冒险");
  return value;
}

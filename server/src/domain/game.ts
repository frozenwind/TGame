import {
  makeRoomCode,
  type ChatDto,
  type Choice,
  type ContentLevel,
  type Outcome,
  type PlayerDto,
  type PromptDto,
  type ResolutionDto,
  type RoomDto,
  type RoomKind,
} from "../../../shared/protocol.js";
import { GameError } from "./errors.js";
import { drawPrompt } from "./prompts.js";

export const RECENT_PROMPT_LIMIT = 12;
export const CHAT_LIMIT = 50;
export const REQUEST_LIMIT = 30;

export interface InternalPlayer {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  skipsRemaining: number;
  isBot: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
}

export interface InternalRoom {
  id: string;
  code: string;
  kind: RoomKind;
  hostId: string;
  contentLevel: ContentLevel;
  allowAdult: boolean;
  phase: RoomDto["phase"];
  players: InternalPlayer[];
  revision: number;
  turnOrder: string[];
  turnIndex: number;
  currentChoice: Choice | null;
  currentPrompt: PromptDto | null;
  lastResolution: ResolutionDto | null;
  recentPromptIds: string[];
  safetyCap: number;
  createdAt: number;
  updatedAt: number;
  chat: ChatDto[];
  processed: Record<string, string[]>;
  turnDeadline: number | null;
  gameId: string | null;
  turnCount: number;
}

export interface PersistedRoom extends InternalRoom {
  closedAt: number | null;
}

export function createCustomRoom(input: {
  id: string;
  code: string;
  host: { id: string; nickname: string };
  contentLevel: ContentLevel;
  allowAdult: boolean;
  safetyCap: number;
  now: number;
}): InternalRoom {
  const room = emptyRoom({
    id: input.id,
    code: input.code,
    kind: "custom",
    hostId: input.host.id,
    contentLevel: input.contentLevel,
    allowAdult: input.allowAdult,
    safetyCap: input.safetyCap,
    now: input.now,
  });
  room.players.push(playerFrom(input.host.id, input.host.nickname, input.now, true, false));
  room.chat.push(systemChat(`${input.host.nickname} 创建了房间`, input.now));
  return room;
}

export function createMatchRoom(input: {
  id: string;
  code: string;
  members: Array<{ id: string; nickname: string }>;
  contentLevel: ContentLevel;
  allowAdult: boolean;
  safetyCap: number;
  now: number;
  rng: () => number;
  gameId: string;
  turnTimeoutMs: number;
}): InternalRoom {
  if (input.members.length < 2) {
    throw new GameError("insufficient_players", "匹配人数不足");
  }
  const host = input.members[0];
  if (!host) throw new GameError("insufficient_players", "匹配人数不足");
  const room = emptyRoom({
    id: input.id,
    code: input.code,
    kind: "match",
    hostId: host.id,
    contentLevel: input.contentLevel,
    allowAdult: input.allowAdult,
    safetyCap: input.safetyCap,
    now: input.now,
  });
  room.players = input.members.map((member, index) =>
    playerFrom(member.id, member.nickname, input.now + index, true, false),
  );
  beginGame(room, input.now, input.rng, input.gameId, input.turnTimeoutMs);
  room.chat.push(systemChat("4 人匹配成功，游戏开始", input.now));
  return room;
}

export function addPlayer(
  room: InternalRoom,
  member: { id: string; nickname: string; isBot?: boolean },
  now: number,
): InternalRoom {
  const next = clone(room);
  const existing = next.players.find((player) => player.id === member.id);
  if (existing) {
    if (existing.connected && existing.disconnectedAt === null && existing.nickname === member.nickname) {
      return next;
    }
    const rejoined = !existing.connected;
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.nickname = member.nickname;
    if (rejoined) next.chat.push(systemChat(`${member.nickname} 重新连接`, now));
    touch(next, now);
    return next;
  }
  if (next.kind === "match") {
    throw new GameError("forbidden", "匹配房间不能中途加入");
  }
  if (next.players.length >= next.safetyCap) {
    throw new GameError("room_full", "房间已达到安全人数上限");
  }
  const bot = member.isBot ?? false;
  next.players.push(playerFrom(member.id, member.nickname, now, bot, bot));
  if (next.phase !== "lobby") {
    next.turnOrder.push(member.id);
    next.players[next.players.length - 1]!.skipsRemaining = 1;
  }
  next.chat.push(systemChat(`${member.nickname} 加入了房间`, now));
  touch(next, now);
  return next;
}

export function setReady(room: InternalRoom, playerId: string, ready: boolean, now: number): InternalRoom {
  const next = clone(room);
  if (next.phase !== "lobby") throw new GameError("wrong_phase", "游戏已经开始");
  const player = requirePlayer(next, playerId);
  player.ready = ready;
  touch(next, now);
  return next;
}

export function setSettings(
  room: InternalRoom,
  playerId: string,
  contentLevel: ContentLevel,
  allowAdult: boolean,
  now: number,
): InternalRoom {
  const next = clone(room);
  if (playerId !== next.hostId) throw new GameError("forbidden", "只有房主可以修改设置");
  if (next.phase !== "lobby") throw new GameError("wrong_phase", "游戏开始后不能修改设置");
  next.contentLevel = contentLevel;
  next.allowAdult = allowAdult;
  touch(next, now);
  return next;
}

export function startGame(
  room: InternalRoom,
  playerId: string,
  now: number,
  rng: () => number,
  gameId: string,
  turnTimeoutMs: number,
): InternalRoom {
  const next = clone(room);
  if (next.phase !== "lobby") throw new GameError("wrong_phase", "游戏已经开始");
  if (next.kind === "custom" && playerId !== next.hostId) {
    throw new GameError("forbidden", "只有房主可以开始游戏");
  }
  if (next.players.length < 2) throw new GameError("insufficient_players", "至少需要 2 名玩家");
  if (next.players.some((player) => !player.ready)) {
    throw new GameError("not_ready", "还有玩家没有准备");
  }
  beginGame(next, now, rng, gameId, turnTimeoutMs);
  next.chat.push(systemChat("游戏开始", now));
  return next;
}

export function choose(
  room: InternalRoom,
  playerId: string,
  choice: Choice,
  requestId: string,
  catalog: PromptDto[],
  now: number,
  rng: () => number,
  turnTimeoutMs: number,
): InternalRoom {
  if (alreadyProcessed(room, playerId, requestId)) return clone(room);
  const next = clone(room);
  assertTurn(next, playerId, "choosing");
  let prompt: PromptDto;
  try {
    prompt = drawPrompt(catalog, choice, next.contentLevel, next.allowAdult, next.recentPromptIds, rng);
  } catch {
    throw new GameError("no_prompt", "当前设置下没有可用题目");
  }
  next.currentChoice = choice;
  next.currentPrompt = prompt;
  next.phase = "answering";
  next.turnDeadline = now + turnTimeoutMs;
  remember(next, playerId, requestId);
  touch(next, now);
  return next;
}

export function complete(
  room: InternalRoom,
  playerId: string,
  requestId: string,
  now: number,
  resolveWindowMs: number,
): InternalRoom {
  if (alreadyProcessed(room, playerId, requestId)) return clone(room);
  const next = clone(room);
  assertTurn(next, playerId, "answering");
  enterResolving(next, playerId, "completed", now, resolveWindowMs);
  remember(next, playerId, requestId);
  return next;
}

export function skip(
  room: InternalRoom,
  playerId: string,
  requestId: string,
  now: number,
  resolveWindowMs: number,
): InternalRoom {
  if (alreadyProcessed(room, playerId, requestId)) return clone(room);
  const next = clone(room);
  if (next.phase !== "choosing" && next.phase !== "answering") {
    throw new GameError("wrong_phase", "当前不能跳过");
  }
  assertCurrent(next, playerId);
  const player = requirePlayer(next, playerId);
  if (player.skipsRemaining <= 0) throw new GameError("already_used", "本局跳过次数已用完");
  player.skipsRemaining -= 1;
  enterResolving(next, playerId, "skipped", now, resolveWindowMs);
  remember(next, playerId, requestId);
  return next;
}

export function timeoutTurn(room: InternalRoom, now: number, resolveWindowMs: number): InternalRoom | null {
  if (room.turnDeadline === null || now < room.turnDeadline) return null;
  if (room.phase !== "choosing" && room.phase !== "answering") return null;
  const playerId = currentPlayerId(room);
  if (!playerId) return null;
  const next = clone(room);
  next.chat.push(systemChat("当前玩家超时，自动跳过", now));
  enterResolving(next, playerId, "skipped", now, resolveWindowMs);
  return next;
}

export function settle(room: InternalRoom, now: number, turnTimeoutMs: number): InternalRoom | null {
  if (room.phase !== "resolving") return null;
  if (room.turnDeadline !== null && now < room.turnDeadline) return null;
  const next = clone(room);
  if (next.turnOrder.length > 0) {
    next.turnIndex = (next.turnIndex + 1) % next.turnOrder.length;
  }
  next.currentChoice = null;
  next.currentPrompt = null;
  next.phase = "choosing";
  next.turnDeadline = now + turnTimeoutMs;
  touch(next, now);
  return next;
}

export function markConnection(room: InternalRoom, playerId: string, connected: boolean, now: number): InternalRoom {
  const next = clone(room);
  const player = requirePlayer(next, playerId);
  if (player.connected === connected && (connected || player.disconnectedAt !== null)) {
    return next;
  }
  player.connected = connected;
  player.disconnectedAt = connected ? null : now;
  if (!connected && currentPlayerId(next) === playerId && next.turnDeadline !== null) {
    next.turnDeadline = Math.min(next.turnDeadline, now + 15_000);
  }
  touch(next, now);
  return next;
}

export function removePlayer(room: InternalRoom, playerId: string, now: number, turnTimeoutMs: number): InternalRoom | null {
  const next = clone(room);
  const index = next.players.findIndex((player) => player.id === playerId);
  if (index < 0) return next;
  const [removed] = next.players.splice(index, 1);
  if (!removed) return next;
  const orderIndex = next.turnOrder.indexOf(playerId);
  const wasCurrent = orderIndex >= 0 && orderIndex === next.turnIndex && next.phase !== "lobby";
  if (orderIndex >= 0) {
    next.turnOrder.splice(orderIndex, 1);
    if (orderIndex < next.turnIndex) next.turnIndex -= 1;
  }
  if (next.turnIndex >= next.turnOrder.length) next.turnIndex = 0;
  next.chat.push(systemChat(`${removed.nickname} 离开了房间`, now));
  if (next.players.length === 0) return null;
  if (next.hostId === playerId) {
    const oldest = [...next.players].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (oldest) {
      next.hostId = oldest.id;
      next.chat.push(systemChat(`${oldest.nickname} 成为房主`, now));
    }
  }
  if (next.players.length < 2 && next.phase !== "lobby") {
    returnToLobby(next, now, "人数不足，已返回房间");
    return next;
  }
  if (wasCurrent && next.phase !== "lobby") {
    next.currentChoice = null;
    next.currentPrompt = null;
    next.phase = "choosing";
    next.turnDeadline = now + turnTimeoutMs;
    if (next.turnOrder.length === 0) returnToLobby(next, now, "人数不足，已返回房间");
  }
  touch(next, now);
  return next;
}

export function kickPlayer(
  room: InternalRoom,
  hostId: string,
  targetId: string,
  now: number,
  turnTimeoutMs: number,
): InternalRoom | null {
  if (hostId !== room.hostId) throw new GameError("forbidden", "只有房主可以踢人");
  if (hostId === targetId) throw new GameError("bad_request", "房主不能踢出自己");
  if (!room.players.some((player) => player.id === targetId)) {
    throw new GameError("not_found", "玩家不在房间里");
  }
  return removePlayer(room, targetId, now, turnTimeoutMs);
}

export function addChat(room: InternalRoom, playerId: string, text: string, now: number, messageId: string): InternalRoom {
  const next = clone(room);
  const player = requirePlayer(next, playerId);
  const cleaned = text.trim();
  if (cleaned.length < 1 || cleaned.length > 200) {
    throw new GameError("bad_request", "聊天内容需要 1 到 200 个字符");
  }
  next.chat.push({
    id: messageId,
    playerId,
    nickname: player.nickname,
    text: cleaned,
    at: Math.floor(now / 1000),
  });
  if (next.chat.length > CHAT_LIMIT) next.chat.splice(0, next.chat.length - CHAT_LIMIT);
  touch(next, now);
  return next;
}

export function expireDisconnects(room: InternalRoom, now: number, graceMs: number, turnTimeoutMs: number): InternalRoom | null {
  let current: InternalRoom | null = room;
  const expired = room.players.filter(
    (player) => !player.isBot && player.disconnectedAt !== null && now - player.disconnectedAt >= graceMs,
  );
  for (const player of expired) {
    if (!current) break;
    current = removePlayer(current, player.id, now, turnTimeoutMs);
  }
  return current;
}

export function toDto(room: InternalRoom): RoomDto {
  return {
    id: room.id,
    code: room.code,
    kind: room.kind,
    hostId: room.hostId,
    contentLevel: room.contentLevel,
    allowAdult: room.allowAdult,
    phase: room.phase,
    players: room.players.map((player) => toPlayerDto(room, player)),
    revision: room.revision,
    turnOrder: [...room.turnOrder],
    turnIndex: room.turnIndex,
    currentPlayerId: room.phase === "lobby" ? null : currentPlayerId(room),
    currentChoice: room.currentChoice,
    currentPrompt: room.currentPrompt,
    lastResolution: room.lastResolution,
    safetyCap: room.safetyCap,
    createdAt: Math.floor(room.createdAt / 1000),
    chat: room.chat.map((message) => ({ ...message })),
  };
}

export function currentPlayerId(room: Pick<InternalRoom, "turnOrder" | "turnIndex">): string | null {
  return room.turnOrder[room.turnIndex] ?? null;
}

export function allocateCode(existing: Set<string>, rng: () => number): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = makeRoomCode(rng);
    if (!existing.has(code)) return code;
  }
  throw new GameError("conflict", "房间码暂时不足，请重试");
}

function beginGame(room: InternalRoom, now: number, rng: () => number, gameId: string, turnTimeoutMs = 20_000): void {
  for (const player of room.players) player.skipsRemaining = 1;
  room.turnOrder = shuffle(room.players.map((player) => player.id), rng);
  room.turnIndex = 0;
  room.phase = "choosing";
  room.currentChoice = null;
  room.currentPrompt = null;
  room.turnDeadline = now + turnTimeoutMs;
  room.gameId = gameId;
  room.turnCount = 0;
  touch(room, now);
}

function enterResolving(
  room: InternalRoom,
  playerId: string,
  outcome: Outcome,
  now: number,
  resolveWindowMs: number,
): void {
  const player = requirePlayer(room, playerId);
  room.lastResolution = {
    playerId,
    nickname: player.nickname,
    choice: room.currentChoice,
    prompt: room.currentPrompt,
    outcome,
    at: Math.floor(now / 1000),
  };
  if (room.currentPrompt) {
    room.recentPromptIds.push(room.currentPrompt.id);
    if (room.recentPromptIds.length > RECENT_PROMPT_LIMIT) {
      room.recentPromptIds.splice(0, room.recentPromptIds.length - RECENT_PROMPT_LIMIT);
    }
  }
  room.turnCount += 1;
  room.phase = "resolving";
  room.turnDeadline = now + resolveWindowMs;
  touch(room, now);
}

function returnToLobby(room: InternalRoom, now: number, notice: string): void {
  room.phase = "lobby";
  room.turnOrder = [];
  room.turnIndex = 0;
  room.currentChoice = null;
  room.currentPrompt = null;
  room.turnDeadline = null;
  room.gameId = null;
  for (const player of room.players) {
    player.ready = player.id === room.hostId;
    player.skipsRemaining = 1;
  }
  room.chat.push(systemChat(notice, now));
  touch(room, now);
}

function assertTurn(room: InternalRoom, playerId: string, phase: "choosing" | "answering"): void {
  if (room.phase !== phase) throw new GameError("wrong_phase", "当前阶段不能执行这个操作");
  assertCurrent(room, playerId);
}

function assertCurrent(room: InternalRoom, playerId: string): void {
  if (currentPlayerId(room) !== playerId) throw new GameError("not_your_turn", "还没轮到你");
}

function requirePlayer(room: InternalRoom, playerId: string): InternalPlayer {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) throw new GameError("not_found", "玩家不在房间里");
  return player;
}

function alreadyProcessed(room: InternalRoom, playerId: string, requestId: string): boolean {
  return (room.processed[playerId] ?? []).includes(requestId);
}

function remember(room: InternalRoom, playerId: string, requestId: string): void {
  const list = room.processed[playerId] ?? [];
  list.push(requestId);
  if (list.length > REQUEST_LIMIT) list.splice(0, list.length - REQUEST_LIMIT);
  room.processed[playerId] = list;
}

function touch(room: InternalRoom, now: number): void {
  room.updatedAt = now;
  room.revision += 1;
}

function playerFrom(id: string, nickname: string, now: number, ready: boolean, isBot: boolean): InternalPlayer {
  return {
    id,
    nickname,
    ready,
    connected: true,
    skipsRemaining: 1,
    isBot,
    joinedAt: now,
    disconnectedAt: null,
  };
}

function emptyRoom(input: {
  id: string;
  code: string;
  kind: RoomKind;
  hostId: string;
  contentLevel: ContentLevel;
  allowAdult: boolean;
  safetyCap: number;
  now: number;
}): InternalRoom {
  return {
    id: input.id,
    code: input.code,
    kind: input.kind,
    hostId: input.hostId,
    contentLevel: input.contentLevel,
    allowAdult: input.allowAdult,
    phase: "lobby",
    players: [],
    revision: 0,
    turnOrder: [],
    turnIndex: 0,
    currentChoice: null,
    currentPrompt: null,
    lastResolution: null,
    recentPromptIds: [],
    safetyCap: input.safetyCap,
    createdAt: input.now,
    updatedAt: input.now,
    chat: [],
    processed: {},
    turnDeadline: null,
    gameId: null,
    turnCount: 0,
  };
}

function toPlayerDto(room: InternalRoom, player: InternalPlayer): PlayerDto {
  return {
    id: player.id,
    nickname: player.nickname,
    ready: player.ready,
    connected: player.connected,
    skipsRemaining: player.skipsRemaining,
    isHost: player.id === room.hostId,
    isBot: player.isBot,
  };
}

function systemChat(text: string, now: number): ChatDto {
  return {
    id: crypto.randomUUID(),
    playerId: "system",
    nickname: "系统",
    text,
    at: Math.floor(now / 1000),
  };
}

function shuffle<T>(values: T[], rng: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.floor(rng() * (index + 1)));
    const current = copy[index];
    copy[index] = copy[swap] as T;
    copy[swap] = current as T;
  }
  return copy;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

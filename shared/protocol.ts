export const PROTOCOL_VERSION = 1;
export const MATCH_SIZE = 4;
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const CONTENT_LEVELS = ["mild", "spicy", "wild"] as const;
export const ROOM_KINDS = ["custom", "match"] as const;
export const PHASES = ["lobby", "choosing", "answering", "resolving"] as const;
export const CHOICES = ["truth", "dare"] as const;
export const OUTCOMES = ["completed", "skipped"] as const;

export type ContentLevel = (typeof CONTENT_LEVELS)[number];
export type RoomKind = (typeof ROOM_KINDS)[number];
export type Phase = (typeof PHASES)[number];
export type Choice = (typeof CHOICES)[number];
export type Outcome = (typeof OUTCOMES)[number];

export const ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "not_found",
  "forbidden",
  "conflict",
  "rate_limited",
  "room_full",
  "wrong_phase",
  "not_your_turn",
  "already_used",
  "nickname_rejected",
  "insufficient_players",
  "not_ready",
  "no_prompt",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const CLIENT_EVENTS = {
  roomCreate: "room.create",
  roomJoin: "room.join",
  roomLeave: "room.leave",
  roomReady: "room.ready",
  roomStart: "room.start",
  roomKick: "room.kick",
  roomSettings: "room.settings",
  roomSync: "room.sync",
  matchEnqueue: "match.enqueue",
  matchCancel: "match.cancel",
  chatSend: "chat.send",
  gameChoose: "game.choose",
  gameComplete: "game.complete",
  gameSkip: "game.skip",
} as const;

export const SERVER_EVENTS = {
  roomState: "room.state",
  matchQueued: "match.queued",
  matchFound: "match.found",
  kicked: "kicked",
  gameError: "game.error",
} as const;

export interface PromptDto {
  id: string;
  kind: Choice;
  level: ContentLevel;
  adult: boolean;
  category: string;
  text: string;
}

export interface PlayerDto {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  skipsRemaining: number;
  isHost: boolean;
  isBot: boolean;
}

export interface ChatDto {
  id: string;
  playerId: string;
  nickname: string;
  text: string;
  at: number;
}

export interface ResolutionDto {
  playerId: string;
  nickname: string;
  choice: Choice | null;
  prompt: PromptDto | null;
  outcome: Outcome;
  at: number;
}

export interface RoomDto {
  id: string;
  code: string;
  kind: RoomKind;
  hostId: string;
  contentLevel: ContentLevel;
  allowAdult: boolean;
  phase: Phase;
  players: PlayerDto[];
  revision: number;
  turnOrder: string[];
  turnIndex: number;
  currentPlayerId: string | null;
  currentChoice: Choice | null;
  currentPrompt: PromptDto | null;
  lastResolution: ResolutionDto | null;
  safetyCap: number;
  createdAt: number;
  chat: ChatDto[];
}

export interface StateEvent {
  revision: number;
  reason: string;
  room: RoomDto;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
}

export interface MatchStatus {
  queued: boolean;
  size: number;
  needed: number;
}

export interface Ack {
  ok: boolean;
  error?: ApiError;
  snapshot?: RoomDto;
  match?: MatchStatus;
}

export interface GuestResponse {
  playerId: string;
  sessionToken: string;
  nickname: string;
}

const BLOCKED_NICKNAMES = ["admin", "system", "null", "管理员", "系统", "客服"];

export function validateNickname(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new NicknameError("昵称需要 2 到 12 个字符");
  }
  const nickname = raw.trim();
  if (nickname.length < 2 || nickname.length > 12) {
    throw new NicknameError("昵称需要 2 到 12 个字符");
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(nickname)) {
    throw new NicknameError("昵称只能包含字母、数字、中文、下划线或短横线");
  }
  const lowered = nickname.toLowerCase();
  if (BLOCKED_NICKNAMES.some((word) => lowered.includes(word.toLowerCase()))) {
    throw new NicknameError("这个昵称不可用");
  }
  return nickname;
}

export class NicknameError extends Error {
  readonly code = "nickname_rejected" as const;
  constructor(message: string) {
    super(message);
  }
}

export function isContentLevel(value: unknown): value is ContentLevel {
  return typeof value === "string" && CONTENT_LEVELS.includes(value as ContentLevel);
}

export function isChoice(value: unknown): value is Choice {
  return value === "truth" || value === "dare";
}

export function makeRoomCode(rng: () => number = Math.random): string {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const pick = Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(rng() * ROOM_CODE_ALPHABET.length));
    code += ROOM_CODE_ALPHABET[pick];
  }
  return code;
}

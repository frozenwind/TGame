import { describe, expect, it } from "vitest";
import { makeRoomCode, ROOM_CODE_ALPHABET, validateNickname, NicknameError } from "../../shared/protocol.js";
import {
  addPlayer,
  choose,
  complete,
  createCustomRoom,
  currentPlayerId,
  kickPlayer,
  removePlayer,
  setReady,
  settle,
  skip,
  startGame,
  timeoutTurn,
} from "../src/domain/game.js";
import { drawPrompt, eligiblePrompts, SEED_PROMPTS } from "../src/domain/prompts.js";
import { GameError } from "../src/domain/errors.js";

const now = 1_700_000_000_000;
const timeout = 20_000;
const resolveWindow = 1_000;

function rngFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function twoPlayerRoom() {
  let room = createCustomRoom({
    id: "room-1",
    code: "ABCDEF",
    host: { id: "host", nickname: "房主" },
    contentLevel: "wild",
    allowAdult: false,
    safetyCap: 8,
    now,
  });
  room = addPlayer(room, { id: "guest", nickname: "客人" }, now + 1);
  room = setReady(room, "guest", true, now + 2);
  return startGame(room, "host", now + 3, rngFrom(1), "game-1", timeout);
}

describe("昵称与房间码", () => {
  it("接受中文昵称并拒绝过短或保留词", () => {
    expect(validateNickname("  小明  ")).toBe("小明");
    expect(() => validateNickname("a")).toThrow(NicknameError);
    expect(() => validateNickname("管理员")).toThrow(NicknameError);
  });

  it("生成不含易混字符的 6 位房间码", () => {
    const codes = new Set<string>();
    for (let index = 0; index < 200; index += 1) codes.add(makeRoomCode(rngFrom(index + 3)));
    expect(codes.size).toBeGreaterThan(150);
    for (const code of codes) {
      expect(code).toHaveLength(6);
      expect([...code].every((char) => ROOM_CODE_ALPHABET.includes(char))).toBe(true);
    }
  });
});

describe("对局状态机", () => {
  it("只有全员准备后房主才能开始", () => {
    let room = createCustomRoom({
      id: "room",
      code: "ABCDEF",
      host: { id: "host", nickname: "房主" },
      contentLevel: "mild",
      allowAdult: false,
      safetyCap: 8,
      now,
    });
    room = addPlayer(room, { id: "guest", nickname: "客人" }, now);
    expect(() => startGame(room, "guest", now, Math.random, "game", timeout)).toThrow(GameError);
    expect(() => startGame(room, "host", now, Math.random, "game", timeout)).toThrowError(/准备/);
    room = setReady(room, "guest", true, now);
    const started = startGame(room, "host", now, rngFrom(2), "game", timeout);
    expect(started.phase).toBe("choosing");
    expect(started.turnOrder).toHaveLength(2);
    expect(started.players.every((player) => player.skipsRemaining === 1)).toBe(true);
  });

  it("抽题、完成、跳过、幂等和超时", () => {
    let room = twoPlayerRoom();
    const actor = currentPlayerId(room);
    expect(actor).toBeTruthy();
    if (!actor) return;
    const other = actor === "host" ? "guest" : "host";
    expect(() => choose(room, other, "truth", "req-x", SEED_PROMPTS, now, Math.random, timeout)).toThrowError(/轮到/);
    const chosen = choose(room, actor, "truth", "req-1", SEED_PROMPTS, now, rngFrom(4), timeout);
    const duplicate = choose(chosen, actor, "dare", "req-1", SEED_PROMPTS, now, rngFrom(4), timeout);
    expect(duplicate.revision).toBe(chosen.revision);
    expect(duplicate.currentPrompt?.id).toBe(chosen.currentPrompt?.id);
    expect(chosen.phase).toBe("answering");

    const resolved = complete(chosen, actor, "req-2", now + 10, resolveWindow);
    expect(resolved.phase).toBe("resolving");
    expect(resolved.lastResolution?.outcome).toBe("completed");
    const again = complete(resolved, actor, "req-2", now + 10, resolveWindow);
    expect(again.revision).toBe(resolved.revision);
    const next = settle(resolved, now + 10 + resolveWindow, timeout);
    expect(next?.phase).toBe("choosing");
    expect(currentPlayerId(next!)).not.toBe(actor);

    const skipped = skip(next!, currentPlayerId(next!)!, "req-3", now + 20, resolveWindow);
    const skipper = skipped.players.find((player) => player.id === currentPlayerId(next!));
    expect(skipper?.skipsRemaining).toBe(0);
    expect(() => skip(skipped, currentPlayerId(next!)!, "req-4", now + 21, resolveWindow)).toThrow(GameError);

    let fresh = twoPlayerRoom();
    fresh.turnDeadline = now - 1;
    const timed = timeoutTurn(fresh, now, resolveWindow);
    expect(timed?.phase).toBe("resolving");
    expect(timed?.lastResolution?.outcome).toBe("skipped");
    expect(timed?.players.every((player) => player.skipsRemaining === 1)).toBe(true);
  });

  it("题目按等级过滤并避开最近题目", () => {
    const mild = eligiblePrompts(SEED_PROMPTS, "truth", "mild", true, []);
    expect(mild.every((prompt) => prompt.level === "mild" && prompt.kind === "truth")).toBe(true);
    const hidden = eligiblePrompts(SEED_PROMPTS, "truth", "mild", false, []);
    expect(hidden.some((prompt) => prompt.adult)).toBe(false);
    const first = drawPrompt(SEED_PROMPTS, "truth", "wild", false, [], rngFrom(9));
    const second = drawPrompt(SEED_PROMPTS, "truth", "wild", false, [first.id], rngFrom(9));
    expect(second.id).not.toBe(first.id);
    const only = SEED_PROMPTS.filter((prompt) => prompt.kind === "truth" && !prompt.adult).slice(0, 1);
    const repeated = drawPrompt(only, "truth", "wild", false, [only[0]!.id], () => 0);
    expect(repeated.id).toBe(only[0]!.id);
  });

  it("房主离开后转移房主，踢人需要权限", () => {
    let room = createCustomRoom({
      id: "room",
      code: "ABCDEF",
      host: { id: "host", nickname: "房主" },
      contentLevel: "mild",
      allowAdult: false,
      safetyCap: 8,
      now,
    });
    room = addPlayer(room, { id: "guest", nickname: "客人" }, now + 5);
    expect(() => kickPlayer(room, "guest", "host", now, timeout)).toThrowError(/房主/);
    const kicked = kickPlayer(room, "host", "guest", now, timeout);
    expect(kicked?.players.map((player) => player.id)).toEqual(["host"]);
    room = addPlayer(room, { id: "guest", nickname: "客人" }, now + 6);
    const transferred = removePlayer(room, "host", now + 7, timeout);
    expect(transferred?.hostId).toBe("guest");
  });
});

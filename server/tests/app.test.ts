import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import { GameApp } from "../src/services/game-app.js";

const opened: GameApp[] = [];

afterEach(async () => {
  while (opened.length > 0) {
    const app = opened.pop();
    if (app) await app.close();
  }
});

async function createApp(overrides: Partial<AppConfig> = {}): Promise<GameApp> {
  const app = await GameApp.create({
    ...loadConfig({ NODE_ENV: "test", ENABLE_BOTS: "false" }),
    databasePath: ":memory:",
    silent: true,
    enableBots: false,
    devTools: true,
    actionLimit: 100,
    chatLimit: 3,
    rateWindowMs: 10_000,
    disconnectGraceMs: 1_000,
    turnTimeoutMs: 5_000,
    resolveWindowMs: 200,
    ...overrides,
  });
  opened.push(app);
  return app;
}

describe("房间、匹配与恢复", () => {
  it("四名玩家并发匹配只生成一个对局，不同尺度不会混房", async () => {
    const app = await createApp();
    const players = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((index) => app.login(`玩家${index}`)));
    await Promise.all(players.map((player) => app.enqueue(player.playerId, "mild", false)));
    const rooms = app.listRooms();
    expect(rooms).toHaveLength(2);
    expect(rooms.every((room) => room.kind === "match" && room.phase === "choosing" && room.players.length === 4)).toBe(true);
    expect(app.queueSize("mild", false)).toBe(0);

    const other = await app.login("热辣玩家");
    await app.enqueue(other.playerId, "spicy", false);
    expect(app.queueSize("spicy", false)).toBe(1);
    expect(app.listRooms()).toHaveLength(2);
  });

  it("断线超过宽限后移出房间并转移房主", async () => {
    const app = await createApp();
    const host = await app.login("房主甲");
    const guest = await app.login("玩家乙");
    await app.createRoom(host.playerId, "mild", false);
    await app.joinRoom(guest.playerId, app.listRooms()[0]!.code);
    await app.disconnect(host.playerId);
    await app.tick(Date.now() + 1_500);
    const room = app.listRooms()[0];
    expect(room?.hostId).toBe(guest.playerId);
    expect(room?.players.map((player) => player.id)).toEqual([guest.playerId]);
  });

  it("聊天频率受限", async () => {
    const app = await createApp();
    const host = await app.login("房主甲");
    const guest = await app.login("玩家乙");
    await app.createRoom(host.playerId, "mild", false);
    const code = app.listRooms()[0]!.code;
    await app.joinRoom(guest.playerId, code);
    await app.chat(guest.playerId, "一");
    await app.chat(guest.playerId, "二");
    await app.chat(guest.playerId, "三");
    await expect(app.chat(guest.playerId, "四")).rejects.toThrow(/频繁/);
  });

  it("重启后恢复未过期房间", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tod-"));
    const databasePath = path.join(directory, "app.db");
    const first = await createApp({ databasePath });
    const host = await first.login("房主甲");
    const created = await first.createRoom(host.playerId, "spicy", false);
    await first.close();
    opened.pop();
    const second = await createApp({ databasePath });
    expect(second.listRooms().map((room) => room.code)).toEqual([created.code]);
    expect(second.listRooms()[0]?.players[0]?.connected).toBe(false);
  });

  it("非房主不能开始，开发机器人可以补齐并开局", async () => {
    const app = await createApp();
    const host = await app.login("房主甲");
    const guest = await app.login("玩家乙");
    await app.createRoom(host.playerId, "mild", false);
    const code = app.listRooms()[0]!.code;
    await app.joinRoom(guest.playerId, code);
    await expect(app.start(guest.playerId)).rejects.toThrow(/房主|准备/);
    const started = await app.fillBots(host.playerId, 4, true);
    expect(started.phase).toBe("choosing");
    expect(started.players).toHaveLength(4);
    expect(started.players.some((player) => player.isBot)).toBe(true);
  });
});

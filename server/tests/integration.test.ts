import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { CLIENT_EVENTS, SERVER_EVENTS, type Ack, type RoomDto, type StateEvent } from "../../shared/protocol.js";
import { loadConfig } from "../src/config.js";
import { startServer, type RunningServer } from "../src/index.js";

const running: RunningServer[] = [];

afterEach(async () => {
  while (running.length > 0) {
    const server = running.pop();
    if (server) await server.close();
  }
});

async function boot(): Promise<RunningServer> {
  const server = await startServer({
    ...loadConfig({ NODE_ENV: "test", ENABLE_BOTS: "false" }),
    port: 0,
    host: "127.0.0.1",
    databasePath: ":memory:",
    silent: true,
    enableBots: false,
    devTools: true,
    actionLimit: 100,
    chatLimit: 20,
    turnTimeoutMs: 30_000,
    resolveWindowMs: 200,
    disconnectGraceMs: 60_000,
    tickerMs: 0,
  });
  running.push(server);
  return server;
}

function socket(url: string, token: string): Socket {
  return connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
}

function emit(client: Socket, event: string, payload: unknown = {}): Promise<Ack> {
  return new Promise((resolve, reject) => {
    client.timeout(4000).emit(event, payload, (error: Error | null, response: Ack) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function waitForState(client: Socket, predicate: (room: RoomDto) => boolean): Promise<RoomDto> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待房间状态超时")), 4000);
    const onState = (event: StateEvent) => {
      if (!predicate(event.room)) return;
      clearTimeout(timer);
      client.off(SERVER_EVENTS.roomState, onState);
      resolve(event.room);
    };
    client.on(SERVER_EVENTS.roomState, onState);
  });
}

describe("实时对局", () => {
  it("四名玩家匹配后完成一轮真心话", async () => {
    const server = await boot();
    const guests = [];
    for (let index = 1; index <= 4; index += 1) {
      const response = await fetch(`${server.url}/api/guest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: `玩家${index}` }),
      });
      guests.push(await response.json() as { playerId: string; sessionToken: string });
    }
    const clients = guests.map((guest) => socket(server.url, guest.sessionToken));
    await Promise.all(clients.map((client) => new Promise<void>((resolve) => {
    if (client.connected) resolve();
    else client.on("connect", () => resolve());
  })));
    const matched = Promise.all(clients.map((client) => waitForState(client, (room) => room.kind === "match" && room.phase === "choosing")));
    await Promise.all(clients.map((client) => emit(client, CLIENT_EVENTS.matchEnqueue, { contentLevel: "mild", allowAdult: false })));
    const rooms = await matched;
    const room = rooms[0]!;
    expect(new Set(rooms.map((item) => item.id)).size).toBe(1);
    const actor = guests.findIndex((guest) => guest.playerId === room.currentPlayerId);
    expect(actor).toBeGreaterThanOrEqual(0);
    const answering = waitForState(clients[0]!, (item) => item.phase === "answering" && item.revision > room.revision);
    const ack = await emit(clients[actor]!, CLIENT_EVENTS.gameChoose, { choice: "truth", requestId: "turn-1" });
    expect(ack.ok).toBe(true);
    const prompted = await answering;
    expect(prompted.currentPrompt?.kind).toBe("truth");
    const duplicate = await emit(clients[actor]!, CLIENT_EVENTS.gameChoose, { choice: "dare", requestId: "turn-1" });
    expect(duplicate.snapshot?.currentPrompt?.id).toBe(prompted.currentPrompt?.id);
    const resolving = waitForState(clients[1]!, (item) => item.phase === "resolving");
    const done = await emit(clients[actor]!, CLIENT_EVENTS.gameComplete, { requestId: "turn-1-done" });
    expect(done.ok).toBe(true);
    expect((await resolving).lastResolution?.outcome).toBe("completed");
    await server.game.tick(Date.now() + 1_000);
    const advanced = await waitForState(clients[2]!, (item) => item.phase === "choosing" && item.revision > prompted.revision);
    expect(advanced.currentPlayerId).not.toBe(room.currentPlayerId);
    clients.forEach((client) => client.close());
  });
});

import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { CLIENT_EVENTS, SERVER_EVENTS, type Ack, type RoomDto } from "../../shared/protocol.js";
import type { AppConfig } from "./config.js";
import { isGameError } from "./domain/errors.js";
import { GameApp, parseChoice, parseLevel } from "./services/game-app.js";

const settingsSchema = z.object({
  contentLevel: z.enum(["mild", "spicy", "wild"]).optional(),
  allowAdult: z.boolean().optional(),
});

const joinSchema = z.object({ code: z.string().min(4).max(8) });
const readySchema = z.object({ ready: z.boolean() });
const kickSchema = z.object({ playerId: z.string().min(1) });
const chatSchema = z.object({ text: z.string() });
const choiceSchema = z.object({
  choice: z.enum(["truth", "dare"]),
  requestId: z.string().min(1).max(64).optional(),
});
const requestSchema = z.object({ requestId: z.string().min(1).max(64).optional() });

interface SocketData {
  playerId: string;
  nickname: string;
}

export function attachRealtime(server: HttpServer, game: GameApp, config: AppConfig): Server {
  const origin = config.origins.includes("*") ? true : config.origins;
  const io = new Server(server, {
    cors: { origin },
    transports: ["websocket"],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });
  const sockets = new Map<string, Socket>();

  game.setPublisher((room, reason) => {
    for (const player of room.players) sockets.get(player.id)?.join(room.id);
    const payload = { revision: room.revision, reason, room };
    io.to(room.id).emit(SERVER_EVENTS.roomState, payload);
    if (reason === "match") io.to(room.id).emit(SERVER_EVENTS.matchFound, payload);
  });
  game.setDirectPublisher((playerId, event, payload) => {
    if (playerId === "*") {
      const roomId = (payload as { roomId?: string }).roomId;
      if (roomId) io.in(roomId).emit("room.closed", payload);
      return;
    }
    const socket = sockets.get(playerId);
    socket?.emit(event, payload);
    if (event === "kicked") {
      const roomId = (payload as { roomId?: string }).roomId;
      if (roomId) socket?.leave(roomId);
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const session = await game.authenticate(typeof token === "string" ? token : undefined);
      if (!session) {
        next(new Error("unauthorized"));
        return;
      }
      (socket.data as SocketData).playerId = session.playerId;
      (socket.data as SocketData).nickname = session.nickname;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;
    sockets.set(data.playerId, socket);
    void game.connect(data.playerId);

    socket.on("disconnect", () => {
      if (sockets.get(data.playerId) === socket) sockets.delete(data.playerId);
      void game.disconnect(data.playerId);
    });

    on(socket, CLIENT_EVENTS.roomCreate, async (payload) => {
      const settings = settingsSchema.parse(payload ?? {});
      return game.createRoom(data.playerId, parseLevel(settings.contentLevel), settings.allowAdult ?? false);
    });
    on(socket, CLIENT_EVENTS.roomJoin, async (payload) => {
      const body = joinSchema.parse(payload);
      return game.joinRoom(data.playerId, body.code);
    });
    on(socket, CLIENT_EVENTS.roomLeave, async () => {
      await game.leaveRoom(data.playerId);
      return null;
    });
    on(socket, CLIENT_EVENTS.roomReady, async (payload) => {
      const body = readySchema.parse(payload);
      return game.setReady(data.playerId, body.ready);
    });
    on(socket, CLIENT_EVENTS.roomStart, async () => game.start(data.playerId));
    on(socket, CLIENT_EVENTS.roomKick, async (payload) => {
      const body = kickSchema.parse(payload);
      return game.kick(data.playerId, body.playerId);
    });
    on(socket, CLIENT_EVENTS.roomSettings, async (payload) => {
      const settings = settingsSchema.parse(payload ?? {});
      return game.setContent(data.playerId, parseLevel(settings.contentLevel), settings.allowAdult ?? false);
    });
    on(socket, CLIENT_EVENTS.roomSync, async () => game.sync(data.playerId));
    on(socket, CLIENT_EVENTS.matchEnqueue, async (payload) => {
      const settings = settingsSchema.parse(payload ?? {});
      const result = await game.enqueue(data.playerId, parseLevel(settings.contentLevel), settings.allowAdult ?? false);
      return { snapshot: result.room ?? null, match: { queued: !result.room, size: result.size, needed: 4 } };
    });
    on(socket, CLIENT_EVENTS.matchCancel, async () => {
      await game.cancelMatch(data.playerId);
      return null;
    });
    on(socket, CLIENT_EVENTS.chatSend, async (payload) => {
      const body = chatSchema.parse(payload);
      return game.chat(data.playerId, body.text);
    });
    on(socket, CLIENT_EVENTS.gameChoose, async (payload) => {
      const body = choiceSchema.parse(payload);
      return game.choose(data.playerId, parseChoice(body.choice), body.requestId ?? crypto.randomUUID());
    });
    on(socket, CLIENT_EVENTS.gameComplete, async (payload) => {
      const body = requestSchema.parse(payload ?? {});
      return game.complete(data.playerId, body.requestId ?? crypto.randomUUID());
    });
    on(socket, CLIENT_EVENTS.gameSkip, async (payload) => {
      const body = requestSchema.parse(payload ?? {});
      return game.skip(data.playerId, body.requestId ?? crypto.randomUUID());
    });
  });

  return io;
}

function on(
  socket: Socket,
  event: string,
  handle: (payload: unknown) => Promise<RoomDto | MatchAck | null>,
): void {
  socket.on(event, (payload: unknown, ack?: (result: Ack) => void) => {
    void handle(payload)
      .then((result) => {
        if (typeof ack !== "function") return;
        if (result && "match" in result) {
          ack({ ok: true, snapshot: result.snapshot ?? undefined, match: result.match });
          return;
        }
        ack({ ok: true, snapshot: result ?? undefined });
      })
      .catch((error: unknown) => {
        const body = toAck(error);
        socket.emit(SERVER_EVENTS.gameError, body.error);
        if (typeof ack === "function") ack(body);
      });
  });
}

interface MatchAck {
  snapshot: RoomDto | null;
  match: NonNullable<Ack["match"]>;
}

function toAck(error: unknown): Ack {
  if (error instanceof z.ZodError) {
    return { ok: false, error: { code: "bad_request", message: "参数错误" } };
  }
  if (isGameError(error)) return { ok: false, error: { code: error.code, message: error.message } };
  return { ok: false, error: { code: "bad_request", message: "服务器错误" } };
}

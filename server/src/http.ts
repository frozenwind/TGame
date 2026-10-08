import fs from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { PROTOCOL_VERSION, type ContentLevel } from "../../shared/protocol.js";
import type { AppConfig } from "./config.js";
import { isGameError } from "./domain/errors.js";
import { NicknameError } from "../../shared/protocol.js";
import { GameApp, parseLevel } from "./services/game-app.js";

const guestSchema = z.object({
  nickname: z.string(),
  sessionToken: z.string().optional(),
});

const botSchema = z.object({
  count: z.number().int().min(1).max(16).optional(),
  start: z.boolean().optional(),
});

export function buildHttp(game: GameApp, config: AppConfig): FastifyInstance {
  const app = Fastify({ logger: config.silent ? false : { level: "info" } });
  const origin = config.origins.includes("*") ? true : config.origins;
  void app.register(cors, { origin });
  void app.register(compress, { global: true, encodings: ["br", "gzip", "deflate"] });
  fs.mkdirSync(config.publicDir, { recursive: true });
  void app.register(fastifyStatic, {
    root: path.resolve(config.publicDir),
    prefix: "/content/",
    decorateReply: false,
  });

  app.get("/health", async () => ({ ok: true, version: PROTOCOL_VERSION }));

  app.post("/api/guest", async (request, reply) => {
    const body = guestSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: { code: "bad_request", message: "参数错误" } });
    try {
      return { ok: true, ...(await game.login(body.data.nickname, body.data.sessionToken)) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/prompts", async (request) => {
    const query = request.query as { level?: string; adult?: string };
    const level = query.level ? parseLevel(query.level) : undefined;
    return { ok: true, prompts: game.prompts(level, query.adult === "true") };
  });

  app.post("/api/dev/bots", async (request, reply) => {
    if (!config.devTools) return reply.code(404).send({ ok: false, error: { code: "not_found", message: "未找到" } });
    const token = bearer(request.headers.authorization);
    const session = await game.authenticate(token);
    if (!session) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "登录已失效" } });
    const body = botSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: { code: "bad_request", message: "参数错误" } });
    try {
      const snapshot = await game.fillBots(session.playerId, body.data.count ?? 4, body.data.start ?? false);
      return { ok: true, snapshot };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  return app;
}

function bearer(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
}

function sendError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof NicknameError || isGameError(error)) {
    const code = error instanceof NicknameError ? error.code : error.code;
    const status = code === "unauthorized" ? 401 : code === "not_found" ? 404 : code === "forbidden" ? 403 : 400;
    return reply.code(status).send({ ok: false, error: { code, message: error.message } });
  }
  return reply.code(500).send({ ok: false, error: { code: "bad_request", message: "服务器错误" } });
}

export type { ContentLevel };

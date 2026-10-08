import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  publicDir: string;
  origins: string[];
  safetyCap: number;
  matchSize: number;
  disconnectGraceMs: number;
  turnTimeoutMs: number;
  resolveWindowMs: number;
  roomTtlMs: number;
  snapshotIntervalMs: number;
  devTools: boolean;
  actionLimit: number;
  chatLimit: number;
  rateWindowMs: number;
  enableBots: boolean;
  silent: boolean;
  tickerMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const origins = (env.CORS_ORIGINS ?? "*").split(",").map((item) => item.trim()).filter(Boolean);
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 8787),
    databasePath: env.DATABASE_PATH ?? path.join(serverRoot, "data", "app.db"),
    publicDir: env.PUBLIC_DIR ?? path.join(serverRoot, "public"),
    origins: origins.length > 0 ? origins : ["*"],
    safetyCap: positive(env.ROOM_SAFETY_CAP, 64),
    matchSize: 4,
    disconnectGraceMs: positive(env.DISCONNECT_GRACE_MS, 60_000),
    turnTimeoutMs: positive(env.TURN_TIMEOUT_MS, 20_000),
    resolveWindowMs: positive(env.RESOLVE_WINDOW_MS, 1_200),
    roomTtlMs: positive(env.ROOM_TTL_MS, 2 * 60 * 60 * 1000),
    snapshotIntervalMs: positive(env.SNAPSHOT_INTERVAL_MS, 5_000),
    devTools: (env.NODE_ENV ?? "development") !== "production",
    actionLimit: positive(env.ACTION_LIMIT, 20),
    chatLimit: positive(env.CHAT_LIMIT, 5),
    rateWindowMs: positive(env.RATE_WINDOW_MS, 3_000),
    enableBots: (env.ENABLE_BOTS ?? "true") !== "false",
    silent: env.NODE_ENV === "test",
    tickerMs: Number(env.TICKER_MS ?? 1000),
  };
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

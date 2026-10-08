import type { AddressInfo } from "node:net";
import { loadConfig, type AppConfig } from "./config.js";
import { buildHttp } from "./http.js";
import { attachRealtime } from "./realtime.js";
import { GameApp } from "./services/game-app.js";

export interface RunningServer {
  url: string;
  game: GameApp;
  close: () => Promise<void>;
}

export async function startServer(overrides: Partial<AppConfig> = {}): Promise<RunningServer> {
  const config = { ...loadConfig(), ...overrides };
  const game = await GameApp.create(config);
  const http = buildHttp(game, config);
  await http.ready();
  const io = attachRealtime(http.server, game, config);
  await http.listen({ host: config.host, port: config.port });
  const address = http.server.address() as AddressInfo | null;
  const port = address?.port ?? config.port;
  const ticker = config.tickerMs > 0 ? setInterval(() => {
    void game.tick();
  }, config.tickerMs) : null;
  const snapshots = setInterval(() => {
    void game.flush();
  }, config.snapshotIntervalMs);
  return {
    url: `http://127.0.0.1:${port}`,
    game,
    close: async () => {
      if (ticker) clearInterval(ticker);
      clearInterval(snapshots);
      io.close();
      await game.flush();
      await http.close();
      await game.close();
    },
  };
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("/src/index.ts") || entry?.endsWith("/dist/server/src/index.js")) {
  const running = await startServer();
  console.log(`真心话大冒险服务已启动: ${running.url}`);
  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

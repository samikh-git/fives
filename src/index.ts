import { Hono } from "hono";
import { logger } from "hono/logger";
import { playersRouter } from "./routes/players";
import { playersAdminRouter } from "./routes/players-admin";
import { gamesRouter } from "./routes/games";
import { wsRouter } from "./routes/ws";
import { deleteExpiredGames } from "./lib/cleanup";

export { GameRoom } from "./durable-objects/game-room";

export interface Env {
  DB: D1Database;
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  PLAYER_IMAGES: R2Bucket;
  CREATE_GAME_RATE_LIMITER: RateLimit;
  THESPORTSDB_API_KEY?: string;
  APP_BASE_URL: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", logger());
app.use("/ws/*", logger());

app.route("/api/players", playersRouter);
app.route("/api/admin/players", playersAdminRouter);
app.route("/api/games", gamesRouter);
app.route("/ws/games", wsRouter);

app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event, env) {
    await deleteExpiredGames(env.DB);
  },
} satisfies ExportedHandler<Env>;

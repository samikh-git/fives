import { Hono } from "hono";
import { logger } from "hono/logger";
import { playersRouter } from "./routes/players";
import { playersAdminRouter } from "./routes/players-admin";
import { gamesRouter } from "./routes/games";
import { wsRouter } from "./routes/ws";
import { deleteExpiredGames, deleteExpiredPublicPosts } from "./lib/cleanup";
import { sendVotingClosedNotifications } from "./lib/notify";
import { injectOgMeta } from "./lib/og";

export { GameRoom } from "./durable-objects/game-room";

export interface Env {
  DB: D1Database;
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  PLAYER_IMAGES: R2Bucket;
  CREATE_GAME_RATE_LIMITER: RateLimit;
  VOTE_RATE_LIMITER: RateLimit;
  COMMENT_RATE_LIMITER: RateLimit;
  THESPORTSDB_API_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_ADDRESS?: string;
  APP_BASE_URL: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", logger());
app.use("/ws/*", logger());

app.route("/api/players", playersRouter);
app.route("/api/admin/players", playersAdminRouter);
app.route("/api/games", gamesRouter);
app.route("/ws/games", wsRouter);

/**
 * These two routes exist purely so a shared link unfurls with the actual squad image
 * instead of the generic app icon - the app itself is a client-rendered SPA served from
 * one static index.html, so a link-preview crawler (or a browser, harmlessly) needs the
 * OG/Twitter tags injected server-side per game/showcase before the JS ever runs.
 */
app.get("/game/:gameId", async (c) => {
  const gameId = c.req.param("gameId");
  const assetResponse = await c.env.ASSETS.fetch(new URL("/index.html", c.req.url));

  const game = await c.env.DB.prepare("SELECT status FROM games WHERE id = ?")
    .bind(gameId)
    .first<{ status: string }>();
  if (!game || game.status !== "completed") return assetResponse;

  const origin = new URL(c.req.url).origin;
  const html = injectOgMeta(await assetResponse.text(), {
    title: "Full-time — a Fives draft is settled",
    description:
      "Two captains just went head-to-head in a live bidding draft. See the final squads, then draft your own at Fives.",
    imageUrl: `${origin}/api/games/${gameId}/share/combined.png`,
    url: `${origin}/game/${gameId}`,
  });
  return c.html(html);
});

app.get("/showcase/:slug", async (c) => {
  const slug = c.req.param("slug");
  const assetResponse = await c.env.ASSETS.fetch(new URL("/index.html", c.req.url));

  const game = await c.env.DB.prepare(
    "SELECT id FROM games WHERE public_slug = ? AND published_at IS NOT NULL",
  )
    .bind(slug)
    .first<{ id: string }>();
  if (!game) return assetResponse;

  const origin = new URL(c.req.url).origin;
  const html = injectOgMeta(await assetResponse.text(), {
    title: "Vote — which Fives squad is better?",
    description:
      "Two captains drafted a 5-a-side squad in a live bidding draft. Cast your vote, then draft your own at Fives.",
    imageUrl: `${origin}/api/games/public/${slug}/share/combined.png`,
    url: `${origin}/showcase/${slug}`,
  });
  return c.html(html);
});

app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event, env) {
    await deleteExpiredGames(env.DB);
    await deleteExpiredPublicPosts(env.DB);
    await sendVotingClosedNotifications(env.DB, env);
  },
} satisfies ExportedHandler<Env>;

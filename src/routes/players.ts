import { Hono } from "hono";
import { countPlayers, listPlayers } from "../db/queries";
import { MAX_ROSTER_PAGE_SIZE } from "../shared/constants";

interface Env {
  DB: D1Database;
  PLAYER_IMAGES: R2Bucket;
}

export const playersRouter = new Hono<{ Bindings: Env }>();

/**
 * `limit`/`offset` are both optional: omitting `limit` returns the full active roster in
 * one response (used by the game-creation flow, which needs every player to compute its
 * league/club/nation filter facets), while the admin roster page always passes both to
 * page through a potentially large roster instead of rendering it all at once.
 */
playersRouter.get("/", async (c) => {
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");

  let limit: number | undefined;
  if (limitParam !== undefined) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_ROSTER_PAGE_SIZE) {
      return c.json({ error: `limit must be an integer between 1 and ${MAX_ROSTER_PAGE_SIZE}` }, 400);
    }
  }

  let offset = 0;
  if (offsetParam !== undefined) {
    offset = Number(offsetParam);
    if (!Number.isInteger(offset) || offset < 0) {
      return c.json({ error: "offset must be a non-negative integer" }, 400);
    }
  }

  const [players, total] = await Promise.all([
    listPlayers(c.env.DB, { limit, offset }),
    countPlayers(c.env.DB),
  ]);
  return c.json({ players, total });
});

const IMAGE_KEY_PATTERN = /^players\/[0-9a-f-]+\.[a-z0-9]+$/;

playersRouter.get("/images/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!IMAGE_KEY_PATTERN.test(key)) {
    return c.notFound();
  }
  const object = await c.env.PLAYER_IMAGES.get(key);

  if (!object) {
    return c.notFound();
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
});

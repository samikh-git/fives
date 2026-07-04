import { Hono } from "hono";
import type { Position } from "../shared/types";
import {
  createPlayer,
  listPlayers,
  updatePlayer,
  archivePlayer,
  upsertPlayerByExternalId,
} from "../db/queries";
import { fetchLeagueTeams, fetchTeamPlayers, resolveApiKey } from "../lib/thesportsdb";

interface Env {
  DB: D1Database;
  PLAYER_IMAGES: R2Bucket;
  THESPORTSDB_API_KEY?: string;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const VALID_POSITIONS: Position[] = ["GK", "DEF", "MID", "ATT"];

function isValidPosition(value: unknown): value is Position {
  return typeof value === "string" && (VALID_POSITIONS as string[]).includes(value);
}

export const playersRouter = new Hono<{ Bindings: Env }>();

playersRouter.get("/", async (c) => {
  const players = await listPlayers(c.env.DB);
  return c.json(players);
});

interface PlayerRequestBody {
  name?: unknown;
  position?: unknown;
  imageUrl?: unknown;
}

function isValidImageUrl(value: unknown): value is string | null {
  return value === undefined || value === null || typeof value === "string";
}

playersRouter.post("/", async (c) => {
  const body = await c.req
    .json<PlayerRequestBody>()
    .catch((): PlayerRequestBody => ({}));

  if (typeof body.name !== "string" || body.name.trim() === "") {
    return c.json({ error: "name is required" }, 400);
  }
  if (!isValidPosition(body.position)) {
    return c.json({ error: "position must be one of GK, DEF, MID, ATT" }, 400);
  }
  if (!isValidImageUrl(body.imageUrl)) {
    return c.json({ error: "imageUrl must be a string" }, 400);
  }

  const player = await createPlayer(c.env.DB, {
    name: body.name,
    position: body.position,
    imageUrl: body.imageUrl ?? null,
  });
  return c.json(player, 201);
});

/**
 * Accepts a manually-uploaded image file, stores it in R2, and returns the URL the
 * roster form should save as the player's imageUrl. Keys are content-addressed by a
 * random id (not the player id) because the upload happens before the player exists —
 * the roster form uploads first, then submits create/update with the resulting URL.
 */
playersRouter.post("/images", async (c) => {
  const formData = await c.req.formData().catch(() => null);
  const file = formData?.get("image");

  if (!(file instanceof File)) {
    return c.json({ error: "image file is required" }, 400);
  }
  if (!file.type.startsWith("image/")) {
    return c.json({ error: "file must be an image" }, 400);
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return c.json({ error: "image must be under 5MB" }, 400);
  }

  const ext = file.type.split("/")[1]?.split("+")[0] || "bin";
  const key = `players/${crypto.randomUUID()}.${ext}`;

  await c.env.PLAYER_IMAGES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  return c.json({ url: `/api/players/images/${key}` }, 201);
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

playersRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<PlayerRequestBody>()
    .catch((): PlayerRequestBody => ({}));

  if (body.name !== undefined && typeof body.name !== "string") {
    return c.json({ error: "name must be a string" }, 400);
  }
  if (body.position !== undefined && !isValidPosition(body.position)) {
    return c.json({ error: "position must be one of GK, DEF, MID, ATT" }, 400);
  }

  const updated = await updatePlayer(c.env.DB, id, {
    name: body.name as string | undefined,
    position: body.position as Position | undefined,
  });

  if (!updated) {
    return c.json({ error: "player not found" }, 404);
  }
  return c.json(updated);
});

playersRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const archived = await archivePlayer(c.env.DB, id);

  if (!archived) {
    return c.json({ error: "player not found" }, 404);
  }
  return c.json(archived);
});

interface ImportRequestBody {
  league?: unknown;
}

/**
 * Imports a whole league from TheSportsDB in one request: looks up its teams, then each
 * team's squad, upserting every mappable player by external id so re-running is safe. The
 * free tier caps team and squad lookups at ~10 results each (see src/lib/thesportsdb.ts),
 * so a full run is at most ~11 upstream requests — well within one Worker invocation and
 * TheSportsDB's rate limit, unlike the old page-at-a-time api-football flow this replaced.
 */
playersRouter.post("/import", async (c) => {
  const body = await c.req.json<ImportRequestBody>().catch((): ImportRequestBody => ({}));

  if (typeof body.league !== "string" || body.league.trim() === "") {
    return c.json({ error: "league (TheSportsDB league name, e.g. 'English Premier League') is required" }, 400);
  }
  const league = body.league;
  const apiKey = resolveApiKey(c.env.THESPORTSDB_API_KEY);

  let teams;
  try {
    teams = await fetchLeagueTeams(apiKey, league);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "import failed" }, 502);
  }

  if (teams.length === 0) {
    return c.json({ error: `no teams found for league "${league}"` }, 404);
  }

  let created = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const team of teams) {
    let candidates;
    try {
      candidates = await fetchTeamPlayers(apiKey, team, league);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "import failed" }, 502);
    }

    for (const candidate of candidates) {
      if (!candidate.position) {
        skipped.push(candidate.name);
        continue;
      }

      const { created: wasCreated } = await upsertPlayerByExternalId(c.env.DB, {
        externalId: candidate.externalId,
        name: candidate.name,
        position: candidate.position,
        club: candidate.club,
        nation: candidate.nation,
        league: candidate.league,
        imageUrl: candidate.imageUrl,
      });

      if (wasCreated) created++;
      else updated++;
    }
  }

  return c.json({ teams: teams.length, created, updated, skipped });
});

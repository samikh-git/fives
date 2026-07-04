import { Hono } from "hono";
import type { Position } from "../shared/types";
import {
  createPlayer,
  updatePlayer,
  archivePlayer,
  upsertPlayerByExternalId,
} from "../db/queries";
import { fetchLeagueTeams, fetchTeamPlayers, resolveApiKey } from "../lib/thesportsdb";
import {
  MAX_CLUB_NAME_LENGTH,
  MAX_IMAGE_URL_LENGTH,
  MAX_LEAGUE_NAME_LENGTH,
  MAX_NATION_NAME_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
} from "../shared/constants";
import { sanitizeText } from "../shared/sanitize";

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

export const playersAdminRouter = new Hono<{ Bindings: Env }>();

interface PlayerRequestBody {
  name?: unknown;
  position?: unknown;
  club?: unknown;
  nation?: unknown;
  imageUrl?: unknown;
}

function isValidImageUrl(value: unknown): value is string | null {
  return value === undefined || value === null || typeof value === "string";
}

/**
 * Validates and sanitizes an optional free-text field (club/nation): must be a string,
 * null, or undefined; empty strings are normalized to null so blank inputs don't get
 * stored as an empty-but-non-null value.
 */
function parseOptionalText(
  value: unknown,
  fieldName: string,
  maxLength: number,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: `${fieldName} must be a string` };
  }
  const cleaned = sanitizeText(value).trim();
  if (cleaned.length > maxLength) {
    return { ok: false, error: `${fieldName} must be at most ${maxLength} characters` };
  }
  return { ok: true, value: cleaned === "" ? null : cleaned };
}

playersAdminRouter.post("/", async (c) => {
  const body = await c.req
    .json<PlayerRequestBody>()
    .catch((): PlayerRequestBody => ({}));

  if (typeof body.name !== "string" || body.name.trim() === "") {
    return c.json({ error: "name is required" }, 400);
  }
  const name = sanitizeText(body.name).trim();
  if (name.length > MAX_PLAYER_NAME_LENGTH) {
    return c.json({ error: `name must be at most ${MAX_PLAYER_NAME_LENGTH} characters` }, 400);
  }
  if (!isValidPosition(body.position)) {
    return c.json({ error: "position must be one of GK, DEF, MID, ATT" }, 400);
  }
  if (!isValidImageUrl(body.imageUrl)) {
    return c.json({ error: "imageUrl must be a string" }, 400);
  }
  if (typeof body.imageUrl === "string" && body.imageUrl.length > MAX_IMAGE_URL_LENGTH) {
    return c.json({ error: `imageUrl must be at most ${MAX_IMAGE_URL_LENGTH} characters` }, 400);
  }
  const clubResult = parseOptionalText(body.club, "club", MAX_CLUB_NAME_LENGTH);
  if (!clubResult.ok) {
    return c.json({ error: clubResult.error }, 400);
  }
  const nationResult = parseOptionalText(body.nation, "nation", MAX_NATION_NAME_LENGTH);
  if (!nationResult.ok) {
    return c.json({ error: nationResult.error }, 400);
  }

  const player = await createPlayer(c.env.DB, {
    name,
    position: body.position,
    club: clubResult.value ?? null,
    nation: nationResult.value ?? null,
    imageUrl: body.imageUrl ?? null,
  });
  return c.json(player, 201);
});

/**
 * Accepts a manually-uploaded image file, stores it in R2, and returns the URL the
 * roster form should save as the player's imageUrl. Keys are content-addressed by a
 * random id (not the player id) because the upload happens before the player exists —
 * the roster form uploads first, then submits create/update with the resulting URL.
 * The returned URL always points at the public /api/players/images/* route (served by
 * the sibling public router), since viewing an image doesn't need admin access.
 */
playersAdminRouter.post("/images", async (c) => {
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

playersAdminRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<PlayerRequestBody>()
    .catch((): PlayerRequestBody => ({}));

  if (body.name !== undefined && typeof body.name !== "string") {
    return c.json({ error: "name must be a string" }, 400);
  }
  let name: string | undefined;
  if (typeof body.name === "string") {
    name = sanitizeText(body.name).trim();
    if (name.length > MAX_PLAYER_NAME_LENGTH) {
      return c.json({ error: `name must be at most ${MAX_PLAYER_NAME_LENGTH} characters` }, 400);
    }
  }
  if (body.position !== undefined && !isValidPosition(body.position)) {
    return c.json({ error: "position must be one of GK, DEF, MID, ATT" }, 400);
  }

  const updated = await updatePlayer(c.env.DB, id, {
    name,
    position: body.position as Position | undefined,
  });

  if (!updated) {
    return c.json({ error: "player not found" }, 404);
  }
  return c.json(updated);
});

playersAdminRouter.delete("/:id", async (c) => {
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
playersAdminRouter.post("/import", async (c) => {
  const body = await c.req.json<ImportRequestBody>().catch((): ImportRequestBody => ({}));

  if (typeof body.league !== "string" || body.league.trim() === "") {
    return c.json({ error: "league (TheSportsDB league name, e.g. 'English Premier League') is required" }, 400);
  }
  const league = sanitizeText(body.league).trim();
  if (league.length > MAX_LEAGUE_NAME_LENGTH) {
    return c.json({ error: `league must be at most ${MAX_LEAGUE_NAME_LENGTH} characters` }, 400);
  }
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

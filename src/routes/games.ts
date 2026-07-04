import { Hono } from "hono";
import {
  GOALIES_IN_POOL,
  MAX_COMMENT_AUTHOR_NAME_LENGTH,
  MAX_COMMENT_TEXT_LENGTH,
  POOL_SIZE,
  PUBLIC_COMMENTS_LIMIT,
  PUBLIC_FEED_SIZE,
  PUBLIC_POST_RETENTION_MS,
} from "../shared/constants";
import type { Env } from "../index";
import type { Captain, Position, SquadEntry } from "../shared/types";
import type { GameRoom, InitParams } from "../durable-objects/game-room";
import { generateGameSlug } from "../lib/slug";
import { sanitizeText } from "../shared/sanitize";
import { containsProfanity } from "../shared/moderation";

const MAX_SLUG_ATTEMPTS = 10;

/** Two-word slugs collide occasionally; retry against the games table until one is free. */
async function allocateGameId(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = generateGameSlug();
    const existing = await db.prepare("SELECT 1 FROM games WHERE id = ?").bind(candidate).first();
    if (!existing) {
      return candidate;
    }
  }
  return crypto.randomUUID();
}

/**
 * `Env.GAME_ROOM` is declared as a bare `DurableObjectNamespace` in src/index.ts (WP0,
 * out of scope here), so its stub type doesn't know about GameRoom's RPC methods.
 * Cast locally to call `init` with proper typing without touching index.ts.
 */
function gameRoomNamespace(env: Env): DurableObjectNamespace<GameRoom> {
  return env.GAME_ROOM as unknown as DurableObjectNamespace<GameRoom>;
}

interface PlayerRow {
  id: string;
  name: string;
  position: Position;
  club: string | null;
  nation: string | null;
  image_url: string | null;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = temp;
  }
  return copy;
}

export const gamesRouter = new Hono<{ Bindings: Env }>();

interface CreateGameBody {
  selectedPlayerIds?: unknown;
  filters?: unknown;
}

interface PoolFilters {
  leagues?: string[];
  clubs?: string[];
  nations?: string[];
}

const FILTER_KEYS = ["leagues", "clubs", "nations"] as const;

function parseFilters(input: unknown): { ok: true; filters: PoolFilters } | { ok: false; error: string } {
  if (input === undefined) {
    return { ok: true, filters: {} };
  }
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "filters must be an object" };
  }

  const raw = input as Record<string, unknown>;
  const filters: PoolFilters = {};
  for (const key of FILTER_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      return { ok: false, error: `filters.${key} must be an array of strings` };
    }
    if (value.length > 0) {
      filters[key] = value;
    }
  }
  return { ok: true, filters };
}

/** Builds an ` AND league IN (?,?) AND club IN (...) ...` suffix (AND across facets, OR within one). */
function filterClause(filters: PoolFilters): { clause: string; params: string[] } {
  const columnByKey: Record<(typeof FILTER_KEYS)[number], string> = {
    leagues: "league",
    clubs: "club",
    nations: "nation",
  };

  const parts: string[] = [];
  const params: string[] = [];
  for (const key of FILTER_KEYS) {
    const values = filters[key];
    if (values && values.length > 0) {
      parts.push(`${columnByKey[key]} IN (${values.map(() => "?").join(",")})`);
      params.push(...values);
    }
  }
  return { clause: parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "", params };
}

/**
 * Picks the 10-player pool. When `selectedPlayerIds` is given (a captain hand-picked the
 * pool), it's used verbatim after validation, then shuffled for proposal order — same
 * shuffle-for-order behavior as the random draw, just skipping the draw itself. `filters`
 * (league/club/nation) only narrows the candidate set for the random draw; they're ignored
 * for a hand-picked pool since the frontend already applies them before the captain picks.
 */
async function resolvePool(
  db: D1Database,
  selectedPlayerIds: unknown,
  filters: PoolFilters,
): Promise<{ ok: true; pool: PlayerRow[] } | { ok: false; error: string }> {
  if (selectedPlayerIds !== undefined) {
    if (!Array.isArray(selectedPlayerIds) || !selectedPlayerIds.every((id) => typeof id === "string")) {
      return { ok: false, error: "selectedPlayerIds must be an array of player ids" };
    }

    const uniqueIds = [...new Set(selectedPlayerIds as string[])];
    if (uniqueIds.length !== POOL_SIZE) {
      return { ok: false, error: `selectedPlayerIds must contain exactly ${POOL_SIZE} unique player ids` };
    }

    const placeholders = uniqueIds.map(() => "?").join(",");
    const { results: rows } = await db
      .prepare(
        `SELECT id, name, position, club, nation, image_url FROM players WHERE archived_at IS NULL AND id IN (${placeholders})`,
      )
      .bind(...uniqueIds)
      .all<PlayerRow>();

    if (rows.length !== POOL_SIZE) {
      return { ok: false, error: "one or more selected players could not be found in the active roster" };
    }

    const goalies = rows.filter((p) => p.position === "GK");
    if (goalies.length !== GOALIES_IN_POOL) {
      return { ok: false, error: `Selected pool must contain exactly ${GOALIES_IN_POOL} goalkeepers` };
    }

    return { ok: true, pool: shuffle(rows) };
  }

  const { clause, params } = filterClause(filters);
  const hasFilters = clause.length > 0;
  const { results: rows } = await db
    .prepare(`SELECT id, name, position, club, nation, image_url FROM players WHERE archived_at IS NULL${clause}`)
    .bind(...params)
    .all<PlayerRow>();

  if (rows.length < POOL_SIZE) {
    return {
      ok: false,
      error: hasFilters
        ? `Fewer than ${POOL_SIZE} players match the selected filters`
        : `Roster must contain at least ${POOL_SIZE} players`,
    };
  }

  const goalies = rows.filter((p) => p.position === "GK");
  const others = rows.filter((p) => p.position !== "GK");
  if (goalies.length < GOALIES_IN_POOL) {
    return {
      ok: false,
      error: hasFilters
        ? `Fewer than ${GOALIES_IN_POOL} goalkeepers match the selected filters`
        : `Roster must contain at least ${GOALIES_IN_POOL} goalkeepers`,
    };
  }
  if (others.length < POOL_SIZE - GOALIES_IN_POOL) {
    return {
      ok: false,
      error: hasFilters
        ? `Fewer than ${POOL_SIZE - GOALIES_IN_POOL} non-goalkeepers match the selected filters`
        : `Roster must contain at least ${POOL_SIZE - GOALIES_IN_POOL} non-goalkeepers`,
    };
  }

  const chosenGoalies = shuffle(goalies).slice(0, GOALIES_IN_POOL);
  const chosenOthers = shuffle(others).slice(0, POOL_SIZE - GOALIES_IN_POOL);

  return { ok: true, pool: shuffle([...chosenGoalies, ...chosenOthers]) };
}

gamesRouter.post("/", async (c) => {
  const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.CREATE_GAME_RATE_LIMITER.limit({ key: clientIp });
  if (!success) {
    return c.json({ error: "Too many games created recently. Please try again later." }, 429);
  }

  const body = await c.req.json<CreateGameBody>().catch((): CreateGameBody => ({}));

  const filtersResult = parseFilters(body.filters);
  if (!filtersResult.ok) {
    return c.json({ error: filtersResult.error }, 400);
  }

  const poolResult = await resolvePool(c.env.DB, body.selectedPlayerIds, filtersResult.filters);
  if (!poolResult.ok) {
    return c.json({ error: poolResult.error }, 400);
  }
  const orderedPool = poolResult.pool;

  const gameId = await allocateGameId(c.env.DB);
  const captainAToken = crypto.randomUUID();
  const captainBToken = crypto.randomUUID();
  const firstBidder = Math.random() < 0.5 ? "A" : "B";
  const createdAt = Date.now();

  const statements = [
    c.env.DB.prepare(
      "INSERT INTO games (id, status, captain_a_token, captain_b_token, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(gameId, "waiting_for_captain_b", captainAToken, captainBToken, createdAt),
    ...orderedPool.map((player, index) =>
      c.env.DB.prepare(
        "INSERT INTO game_pool (game_id, player_id, proposal_order) VALUES (?, ?, ?)",
      ).bind(gameId, player.id, index),
    ),
  ];
  await c.env.DB.batch(statements);

  const initParams: InitParams = {
    gameId,
    pool: orderedPool.map((player) => ({
      playerId: player.id,
      name: player.name,
      position: player.position,
      club: player.club,
      nation: player.nation,
      imageUrl: player.image_url,
    })),
    captainAToken,
    captainBToken,
    firstBidder,
  };

  const gameRoom = gameRoomNamespace(c.env);
  const stub = gameRoom.get(gameRoom.idFromName(gameId));
  await stub.init(initParams);

  const joinUrlForB = `${new URL(c.req.url).origin}/game/${gameId}/join?t=${captainBToken}`;

  return c.json({ gameId, captainAToken, joinUrlForB }, 201);
});

interface CompletedSquadRow {
  playerId: string;
  name: string;
  position: Position;
  club: string | null;
  nation: string | null;
  imageUrl: string | null;
  captain: "A" | "B";
  pricePaid: number;
  roundNumber: number;
}

/** The `game_players` + `players` join backing both the results JSON and the shareable squad images. */
async function fetchCompletedSquads(db: D1Database, gameId: string): Promise<CompletedSquadRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gp.player_id as playerId, p.name as name, p.position as position,
              p.club as club, p.nation as nation, p.image_url as imageUrl,
              gp.captain as captain, gp.price_paid as pricePaid, gp.round_number as roundNumber
       FROM game_players gp
       JOIN players p ON p.id = gp.player_id
       WHERE gp.game_id = ?
       ORDER BY gp.round_number ASC`,
    )
    .bind(gameId)
    .all<CompletedSquadRow>();
  return results;
}

function toSquadEntry(row: CompletedSquadRow): SquadEntry {
  return {
    playerId: row.playerId,
    name: row.name,
    position: row.position,
    club: row.club,
    nation: row.nation,
    imageUrl: row.imageUrl,
    pricePaid: row.pricePaid,
    roundNumber: row.roundNumber,
  };
}

// Registered before the single-segment "/:id" route below: Hono matches route
// definitions in registration order, so "/public" (the showcase feed) must come
// first or "/:id" would swallow it with id="public" and 404 on a nonexistent game.
gamesRouter.get("/public", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, public_slug, published_at, voting_closes_at FROM games
     WHERE published_at IS NOT NULL
     ORDER BY published_at DESC
     LIMIT ?`,
  )
    .bind(PUBLIC_FEED_SIZE)
    .all<{ id: string; public_slug: string; published_at: number; voting_closes_at: number }>();

  const games = await Promise.all(
    results.map(async (row) => ({
      gameId: row.id,
      publicSlug: row.public_slug,
      votingClosesAt: row.voting_closes_at,
      expiresAt: row.published_at + PUBLIC_POST_RETENTION_MS,
      tallies: await fetchVoteTallies(c.env.DB, row.id),
    })),
  );

  return c.json({ games });
});

gamesRouter.get("/:id", async (c) => {
  const gameId = c.req.param("id");

  const game = await c.env.DB.prepare(
    "SELECT id, status, created_at, started_at, completed_at FROM games WHERE id = ?",
  )
    .bind(gameId)
    .first<{
      id: string;
      status: string;
      created_at: number;
      started_at: number | null;
      completed_at: number | null;
    }>();

  if (!game) {
    return c.json({ error: "Game not found" }, 404);
  }

  if (game.status !== "completed") {
    return c.json({
      gameId: game.id,
      status: game.status,
      createdAt: game.created_at,
      startedAt: game.started_at,
      completedAt: game.completed_at,
      result: null,
    });
  }

  const resultRows = await fetchCompletedSquads(c.env.DB, gameId);

  return c.json({
    gameId: game.id,
    status: game.status,
    createdAt: game.created_at,
    startedAt: game.started_at,
    completedAt: game.completed_at,
    result: {
      squads: {
        A: resultRows.filter((r) => r.captain === "A"),
        B: resultRows.filter((r) => r.captain === "B"),
      },
    },
  });
});

async function fetchCompletedGameStatus(db: D1Database, gameId: string): Promise<string | null> {
  const game = await db.prepare("SELECT status FROM games WHERE id = ?").bind(gameId).first<{ status: string }>();
  return game?.status ?? null;
}

gamesRouter.get("/:id/share/:captain{[AB]\\.png}", async (c) => {
  const gameId = c.req.param("id");
  const captain = c.req.param("captain").slice(0, 1) as Captain;

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(c.req.url);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const status = await fetchCompletedGameStatus(c.env.DB, gameId);
  if (status === null) return c.json({ error: "Game not found" }, 404);
  if (status !== "completed") return c.json({ error: "Game is not completed yet" }, 404);

  const resultRows = await fetchCompletedSquads(c.env.DB, gameId);
  const squad = resultRows.filter((r) => r.captain === captain).map(toSquadEntry);
  // Dynamically imported so satori/resvg (and their dependency chain) are only loaded when a
  // share image is actually requested, rather than at Worker startup for every request.
  const { renderSoloSquadPng } = await import("../lib/squad-image");
  const png = await renderSoloSquadPng(squad, captain, null);

  const response = new Response(png, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

gamesRouter.get("/:id/share/combined.png", async (c) => {
  const gameId = c.req.param("id");

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(c.req.url);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const status = await fetchCompletedGameStatus(c.env.DB, gameId);
  if (status === null) return c.json({ error: "Game not found" }, 404);
  if (status !== "completed") return c.json({ error: "Game is not completed yet" }, 404);

  const resultRows = await fetchCompletedSquads(c.env.DB, gameId);
  const squadA = resultRows.filter((r) => r.captain === "A").map(toSquadEntry);
  const squadB = resultRows.filter((r) => r.captain === "B").map(toSquadEntry);
  const { renderCombinedSquadPng } = await import("../lib/squad-image");
  const png = await renderCombinedSquadPng(squadA, squadB, { A: null, B: null });

  const response = new Response(png, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

interface PublishedGameRow {
  id: string;
  published_at: number;
  voting_closes_at: number;
}

/** Looks up a published, not-yet-expired game by its public_slug. Games whose publish state has been cleared by the expiry sweep are indistinguishable from unknown slugs. */
async function fetchPublishedGame(db: D1Database, slug: string): Promise<PublishedGameRow | null> {
  const row = await db
    .prepare(
      "SELECT id, published_at, voting_closes_at FROM games WHERE public_slug = ? AND published_at IS NOT NULL",
    )
    .bind(slug)
    .first<PublishedGameRow>();
  return row ?? null;
}

async function fetchVoteTallies(db: D1Database, gameId: string): Promise<{ A: number; B: number }> {
  const { results } = await db
    .prepare("SELECT choice, COUNT(*) as count FROM game_votes WHERE game_id = ? GROUP BY choice")
    .bind(gameId)
    .all<{ choice: Captain; count: number }>();
  const tallies = { A: 0, B: 0 };
  for (const row of results) tallies[row.choice] = row.count;
  return tallies;
}

gamesRouter.get("/public/:slug", async (c) => {
  const slug = c.req.param("slug");
  const game = await fetchPublishedGame(c.env.DB, slug);
  if (!game) return c.json({ error: "Not found" }, 404);

  const resultRows = await fetchCompletedSquads(c.env.DB, game.id);
  const tallies = await fetchVoteTallies(c.env.DB, game.id);

  return c.json({
    gameId: game.id,
    squads: {
      A: resultRows.filter((r) => r.captain === "A").map(toSquadEntry),
      B: resultRows.filter((r) => r.captain === "B").map(toSquadEntry),
    },
    votingClosesAt: game.voting_closes_at,
    expiresAt: game.published_at + PUBLIC_POST_RETENTION_MS,
    tallies,
  });
});

interface VoteBody {
  choice?: unknown;
  voterId?: unknown;
}

gamesRouter.post("/public/:slug/vote", async (c) => {
  const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.VOTE_RATE_LIMITER.limit({ key: clientIp });
  if (!success) {
    return c.json({ error: "Too many votes recently. Please try again later." }, 429);
  }

  const slug = c.req.param("slug");
  const game = await fetchPublishedGame(c.env.DB, slug);
  if (!game) return c.json({ error: "Not found" }, 404);
  if (Date.now() > game.voting_closes_at) {
    return c.json({ error: "Voting has closed for this game" }, 410);
  }

  const body = await c.req.json<VoteBody>().catch((): VoteBody => ({}));
  if (
    (body.choice !== "A" && body.choice !== "B") ||
    typeof body.voterId !== "string" ||
    !body.voterId
  ) {
    return c.json({ error: "choice must be 'A' or 'B' and voterId is required" }, 400);
  }

  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO game_votes (game_id, voter_id, choice, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(game.id, body.voterId, body.choice, Date.now())
    .run();

  const tallies = await fetchVoteTallies(c.env.DB, game.id);
  return c.json({ tallies });
});

interface CommentRow {
  id: string;
  author_name: string | null;
  text: string;
  created_at: number;
}

interface PublicComment {
  id: string;
  authorName: string | null;
  text: string;
  createdAt: number;
}

function toPublicComment(row: CommentRow): PublicComment {
  return { id: row.id, authorName: row.author_name, text: row.text, createdAt: row.created_at };
}

async function fetchComments(db: D1Database, gameId: string): Promise<PublicComment[]> {
  const { results } = await db
    .prepare(
      "SELECT id, author_name, text, created_at FROM game_comments WHERE game_id = ? ORDER BY created_at ASC LIMIT ?",
    )
    .bind(gameId, PUBLIC_COMMENTS_LIMIT)
    .all<CommentRow>();
  return results.map(toPublicComment);
}

gamesRouter.get("/public/:slug/comments", async (c) => {
  const slug = c.req.param("slug");
  const game = await fetchPublishedGame(c.env.DB, slug);
  if (!game) return c.json({ error: "Not found" }, 404);

  const comments = await fetchComments(c.env.DB, game.id);
  return c.json({ comments });
});

interface CommentBody {
  authorName?: unknown;
  anonymous?: unknown;
  text?: unknown;
}

/**
 * Mirrors sendChatMessage's validation (sanitize -> trim -> length cap -> profanity check)
 * so free text on the public showcase page is held to the same bar as in-game chat.
 * A commenter must either pick a non-empty, non-profane username or explicitly go
 * anonymous - there is no "empty name" fallback like the captain-name path uses, since
 * this is a one-shot form submission with a round trip to surface the error on.
 */
function parseComment(body: CommentBody): { ok: true; authorName: string | null; text: string } | { ok: false; error: string } {
  const anonymous = body.anonymous === true;

  let authorName: string | null = null;
  if (!anonymous) {
    if (typeof body.authorName !== "string") {
      return { ok: false, error: "authorName is required unless posting anonymously" };
    }
    const cleanedName = sanitizeText(body.authorName).trim().slice(0, MAX_COMMENT_AUTHOR_NAME_LENGTH);
    if (!cleanedName) {
      return { ok: false, error: "authorName is required unless posting anonymously" };
    }
    if (containsProfanity(cleanedName)) {
      return { ok: false, error: "Username flagged as inappropriate" };
    }
    authorName = cleanedName;
  }

  if (typeof body.text !== "string") {
    return { ok: false, error: "text is required" };
  }
  const cleanedText = sanitizeText(body.text).trim().slice(0, MAX_COMMENT_TEXT_LENGTH);
  if (!cleanedText) {
    return { ok: false, error: "Comment cannot be empty" };
  }
  if (containsProfanity(cleanedText)) {
    return { ok: false, error: "Comment flagged as inappropriate" };
  }

  return { ok: true, authorName, text: cleanedText };
}

gamesRouter.post("/public/:slug/comments", async (c) => {
  const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.COMMENT_RATE_LIMITER.limit({ key: clientIp });
  if (!success) {
    return c.json({ error: "Too many comments recently. Please try again later." }, 429);
  }

  const slug = c.req.param("slug");
  const game = await fetchPublishedGame(c.env.DB, slug);
  if (!game) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<CommentBody>().catch((): CommentBody => ({}));
  const parsed = parseComment(body);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }

  const comment: PublicComment = {
    id: crypto.randomUUID(),
    authorName: parsed.authorName,
    text: parsed.text,
    createdAt: Date.now(),
  };

  await c.env.DB.prepare(
    "INSERT INTO game_comments (id, game_id, author_name, text, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(comment.id, game.id, comment.authorName, comment.text, comment.createdAt)
    .run();

  return c.json({ comment }, 201);
});

gamesRouter.get("/public/:slug/share/combined.png", async (c) => {
  const slug = c.req.param("slug");

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(c.req.url);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const game = await fetchPublishedGame(c.env.DB, slug);
  if (!game) return c.json({ error: "Not found" }, 404);

  const resultRows = await fetchCompletedSquads(c.env.DB, game.id);
  const squadA = resultRows.filter((r) => r.captain === "A").map(toSquadEntry);
  const squadB = resultRows.filter((r) => r.captain === "B").map(toSquadEntry);
  const { renderCombinedSquadPng } = await import("../lib/squad-image");
  const png = await renderCombinedSquadPng(squadA, squadB, { A: null, B: null });

  const response = new Response(png, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

import { Hono } from "hono";
import { MIN_GOALIES_IN_POOL, POOL_SIZE } from "../shared/constants";
import type { Env } from "../index";
import type { Position } from "../shared/types";
import type { GameRoom, InitParams } from "../durable-objects/game-room";
import { generateGameSlug } from "../lib/slug";

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
}

/**
 * Picks the 10-player pool. When `selectedPlayerIds` is given (a captain hand-picked the
 * pool), it's used verbatim after validation, then shuffled for proposal order — same
 * shuffle-for-order behavior as the random draw, just skipping the draw itself.
 */
async function resolvePool(
  db: D1Database,
  selectedPlayerIds: unknown,
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
    if (goalies.length < MIN_GOALIES_IN_POOL) {
      return { ok: false, error: `Selected pool must contain at least ${MIN_GOALIES_IN_POOL} goalkeepers` };
    }

    return { ok: true, pool: shuffle(rows) };
  }

  const { results: rows } = await db
    .prepare("SELECT id, name, position, club, nation, image_url FROM players WHERE archived_at IS NULL")
    .all<PlayerRow>();

  if (rows.length < POOL_SIZE) {
    return { ok: false, error: `Roster must contain at least ${POOL_SIZE} players` };
  }

  const goalies = rows.filter((p) => p.position === "GK");
  const others = rows.filter((p) => p.position !== "GK");
  if (goalies.length < MIN_GOALIES_IN_POOL) {
    return { ok: false, error: `Roster must contain at least ${MIN_GOALIES_IN_POOL} goalkeepers` };
  }

  const shuffledGoalies = shuffle(goalies);
  const chosenGoalies = shuffledGoalies.slice(0, MIN_GOALIES_IN_POOL);
  const remainingCandidates = shuffle([...others, ...shuffledGoalies.slice(MIN_GOALIES_IN_POOL)]);
  const chosenOthers = remainingCandidates.slice(0, POOL_SIZE - MIN_GOALIES_IN_POOL);

  return { ok: true, pool: shuffle([...chosenGoalies, ...chosenOthers]) };
}

gamesRouter.post("/", async (c) => {
  const body = await c.req.json<CreateGameBody>().catch((): CreateGameBody => ({}));

  const poolResult = await resolvePool(c.env.DB, body.selectedPlayerIds);
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

  const joinUrlForB = `${c.env.APP_BASE_URL}/game/${gameId}/join?t=${captainBToken}`;

  return c.json({ gameId, captainAToken, joinUrlForB }, 201);
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

  const { results: resultRows } = await c.env.DB.prepare(
    `SELECT gp.player_id as playerId, p.name as name, p.position as position,
            p.club as club, p.nation as nation, p.image_url as imageUrl,
            gp.captain as captain, gp.price_paid as pricePaid, gp.round_number as roundNumber
     FROM game_players gp
     JOIN players p ON p.id = gp.player_id
     WHERE gp.game_id = ?
     ORDER BY gp.round_number ASC`,
  )
    .bind(gameId)
    .all<{
      playerId: string;
      name: string;
      position: Position;
      club: string | null;
      nation: string | null;
      imageUrl: string | null;
      captain: "A" | "B";
      pricePaid: number;
      roundNumber: number;
    }>();

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

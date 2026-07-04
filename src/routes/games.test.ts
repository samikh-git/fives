import { describe, expect, it, beforeAll } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import schema from "../db/schema.sql?raw";
import { gamesRouter } from "./games";
import { GameRoom } from "../durable-objects/game-room";
import { MIN_BID_INCREMENT } from "../shared/constants";
import type { Position } from "../shared/types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    GAME_ROOM: DurableObjectNamespace<GameRoom>;
    CREATE_GAME_RATE_LIMITER: RateLimit;
  }
}

beforeAll(async () => {
  const statements = (schema as string)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

// The create-game rate limiter is keyed by CF-Connecting-IP; give each POST its own
// IP so tests exercising pool/validation logic don't trip the unrelated rate limit
// (which is exercised deliberately in its own test below).
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

async function postCreateGame(body?: unknown, ip: string = freshIp()): Promise<Response> {
  const init: RequestInit = { method: "POST", headers: { "CF-Connecting-IP": ip } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return gamesRouter.request("/", init, env);
}

async function seedPlayers(prefix: string, positions: Position[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const id = `${prefix}-${i}`;
    await env.DB.prepare(
      "INSERT INTO players (id, name, position, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(id, `${prefix} Player ${i}`, positions[i], Date.now())
      .run();
    ids.push(id);
  }
  return ids;
}

async function seedPlayersWithLeague(
  prefix: string,
  entries: { position: Position; league: string }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const id = `${prefix}-${i}`;
    const entry = entries[i]!;
    await env.DB.prepare(
      "INSERT INTO players (id, name, position, league, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(id, `${prefix} Player ${i}`, entry.position, entry.league, Date.now())
      .run();
    ids.push(id);
  }
  return ids;
}

describe("POST /games", () => {
  it("rejects when the roster has fewer than MIN_GOALIES_IN_POOL goalkeepers", async () => {
    await seedPlayers(
      "onegk",
      ["GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"],
    );

    const res = await postCreateGame();

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/goalkeeper/i);
  });

  it("rejects when the roster has fewer than POOL_SIZE players", async () => {
    await seedPlayers("toofew", ["GK", "GK", "DEF"]);

    const res = await postCreateGame();

    expect(res.status).toBe(400);
  });

  it("creates a game with a randomly drawn pool: writes D1 rows, mints tokens, and initializes the GameRoom DO", async () => {
    const ids = await seedPlayers(
      "create",
      ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"],
    );

    const res = await postCreateGame();

    expect(res.status).toBe(201);
    const body = await res.json<{ gameId: string; captainAToken: string; joinUrlForB: string }>();
    expect(body.gameId).toBeTruthy();
    expect(body.captainAToken).toBeTruthy();
    expect(body.joinUrlForB).toContain(body.gameId);

    const gameRow = await env.DB.prepare("SELECT * FROM games WHERE id = ?")
      .bind(body.gameId)
      .first<{ status: string; captain_a_token: string; captain_b_token: string }>();
    expect(gameRow?.status).toBe("waiting_for_captain_b");
    expect(gameRow?.captain_a_token).toBe(body.captainAToken);
    expect(gameRow?.captain_b_token).toBeTruthy();

    const poolRows = await env.DB.prepare("SELECT * FROM game_pool WHERE game_id = ?")
      .bind(body.gameId)
      .all<{ player_id: string }>();
    expect(poolRows.results).toHaveLength(10);
    expect(new Set(poolRows.results.map((r) => r.player_id))).toEqual(new Set(ids));

    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(body.gameId));
    const state = await stub.getState();
    expect(state?.pool).toHaveLength(10);
    expect(state?.phase).toBe("waiting_for_captain_b");
  });

  it("draws different random pools across multiple games from a larger roster", async () => {
    await seedPlayers("big", [
      "GK",
      "GK",
      "GK",
      "DEF",
      "DEF",
      "DEF",
      "DEF",
      "MID",
      "MID",
      "MID",
      "MID",
      "ATT",
      "ATT",
      "ATT",
      "ATT",
    ]);

    const poolIdSets: Set<string>[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await postCreateGame();
      expect(res.status).toBe(201);
      const { gameId } = await res.json<{ gameId: string }>();
      const poolRows = await env.DB.prepare("SELECT player_id FROM game_pool WHERE game_id = ?")
        .bind(gameId)
        .all<{ player_id: string }>();
      poolIdSets.push(new Set(poolRows.results.map((r) => r.player_id)));
    }

    const allIdentical = poolIdSets.every(
      (set) => set.size === poolIdSets[0]!.size && [...set].every((id) => poolIdSets[0]!.has(id)),
    );
    expect(allIdentical).toBe(false);
  });

  it("creates a game from a hand-picked pool when selectedPlayerIds is given", async () => {
    const ids = await seedPlayers(
      "manual",
      ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"],
    );
    const chosen = ids.slice(0, 10);

    const res = await postCreateGame({ selectedPlayerIds: chosen });

    expect(res.status).toBe(201);
    const { gameId } = await res.json<{ gameId: string }>();

    const poolRows = await env.DB.prepare("SELECT player_id FROM game_pool WHERE game_id = ?")
      .bind(gameId)
      .all<{ player_id: string }>();
    expect(new Set(poolRows.results.map((r) => r.player_id))).toEqual(new Set(chosen));
  });

  it("rejects selectedPlayerIds that isn't exactly POOL_SIZE unique ids", async () => {
    const ids = await seedPlayers(
      "manualtoofew",
      ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"],
    );

    const res = await postCreateGame({ selectedPlayerIds: ids.slice(0, 9) });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/exactly 10/i);
  });

  it("rejects a hand-picked pool with fewer than MIN_GOALIES_IN_POOL goalkeepers", async () => {
    const ids = await seedPlayers(
      "manualonegk",
      ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"],
    );

    const res = await postCreateGame({ selectedPlayerIds: ids });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/goalkeeper/i);
  });

  it("rate-limits repeated game creation from the same client", async () => {
    await seedPlayers(
      "ratelimited",
      ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"],
    );

    const clientIp = "203.0.113.5";

    for (let i = 0; i < 5; i++) {
      const res = await postCreateGame(undefined, clientIp);
      expect(res.status).toBe(201);
    }

    const blocked = await postCreateGame(undefined, clientIp);
    expect(blocked.status).toBe(429);

    const otherClient = await postCreateGame(undefined, "203.0.113.9");
    expect(otherClient.status).toBe(201);
  });

  it("rejects selectedPlayerIds referencing an archived or unknown player", async () => {
    const ids = await seedPlayers(
      "manualarchived",
      ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"],
    );
    await env.DB.prepare("UPDATE players SET archived_at = ? WHERE id = ?")
      .bind(Date.now(), ids[0])
      .run();

    const res = await postCreateGame({ selectedPlayerIds: ids });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/could not be found/i);
  });

  it("restricts the random draw to players matching the given league filter", async () => {
    const premIds = await seedPlayersWithLeague("premfilter", [
      { position: "GK", league: "Premier League" },
      { position: "GK", league: "Premier League" },
      { position: "DEF", league: "Premier League" },
      { position: "DEF", league: "Premier League" },
      { position: "DEF", league: "Premier League" },
      { position: "MID", league: "Premier League" },
      { position: "MID", league: "Premier League" },
      { position: "MID", league: "Premier League" },
      { position: "ATT", league: "Premier League" },
      { position: "ATT", league: "Premier League" },
    ]);
    await seedPlayersWithLeague("ligafilter", [
      { position: "GK", league: "La Liga" },
      { position: "GK", league: "La Liga" },
      { position: "DEF", league: "La Liga" },
    ]);

    const res = await postCreateGame({ filters: { leagues: ["Premier League"] } });

    expect(res.status).toBe(201);
    const { gameId } = await res.json<{ gameId: string }>();

    const poolRows = await env.DB.prepare("SELECT player_id FROM game_pool WHERE game_id = ?")
      .bind(gameId)
      .all<{ player_id: string }>();
    expect(new Set(poolRows.results.map((r) => r.player_id))).toEqual(new Set(premIds));
  });

  it("rejects when fewer than POOL_SIZE players match the given filters", async () => {
    await seedPlayersWithLeague("toofewfilter", [
      { position: "GK", league: "La Liga" },
      { position: "GK", league: "La Liga" },
      { position: "DEF", league: "La Liga" },
    ]);

    const res = await postCreateGame({ filters: { leagues: ["La Liga"] } });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/filters/i);
  });

  it("rejects a non-array filters value", async () => {
    const res = await postCreateGame({ filters: { leagues: "Premier League" } });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/leagues must be an array/i);
  });
});

describe("GET /games/:id", () => {
  it("returns metadata with a null result before the game is completed", async () => {
    await seedPlayers(
      "getpending",
      ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"],
    );

    const createRes = await postCreateGame();
    const { gameId } = await createRes.json<{ gameId: string }>();

    const res = await gamesRouter.request(`/${gameId}`, {}, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; result: unknown }>();
    expect(body.status).toBe("waiting_for_captain_b");
    expect(body.result).toBeNull();
  });

  it("returns 404 for an unknown game id", async () => {
    const res = await gamesRouter.request("/does-not-exist", {}, env);
    expect(res.status).toBe(404);
  });

  it("returns the final squads once the game has completed, readable with no live DO/socket", async () => {
    await seedPlayers(
      "getcompleted",
      ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"],
    );

    const createRes = await postCreateGame();
    const { gameId } = await createRes.json<{ gameId: string }>();

    // Drive the DO directly to completion (bypassing WebSocket) rather than
    // re-testing bidding logic, which is covered exhaustively in game-room.test.ts.
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));
    await stub.handleCaptainConnected("A");
    await stub.handleCaptainConnected("B");

    for (let i = 0; i < 10; i++) {
      const proposed = await stub.proposeNextPlayer();
      if (!proposed.ok) throw new Error("expected ok");
      const firstBidder = proposed.state.round!.firstBidder;
      const other = firstBidder === "A" ? "B" : "A";
      await stub.placeBid(firstBidder, MIN_BID_INCREMENT);
      await stub.pass(other);
    }

    const res = await gamesRouter.request(`/${gameId}`, {}, env);
    expect(res.status).toBe(200);
    const body = await res.json<{
      status: string;
      result: { squads: { A: unknown[]; B: unknown[] } } | null;
    }>();

    expect(body.status).toBe("completed");
    expect(body.result?.squads.A).toHaveLength(5);
    expect(body.result?.squads.B).toHaveLength(5);
  });
});

import { describe, expect, it, beforeAll } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import schema from "../db/schema.sql?raw";
import { gamesRouter } from "./games";
import { GameRoom } from "../durable-objects/game-room";
import { MIN_BID_INCREMENT, PUBLISH_VOTING_WINDOW_MS } from "../shared/constants";
import type { Position } from "../shared/types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    GAME_ROOM: DurableObjectNamespace<GameRoom>;
    CREATE_GAME_RATE_LIMITER: RateLimit;
    VOTE_RATE_LIMITER: RateLimit;
    COMMENT_RATE_LIMITER: RateLimit;
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
  it("rejects when the roster has fewer than GOALIES_IN_POOL goalkeepers", async () => {
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

  it("never draws more than GOALIES_IN_POOL goalkeepers even when the roster has more available", async () => {
    await seedPlayers("threegk", [
      "GK",
      "GK",
      "GK",
      "DEF",
      "DEF",
      "DEF",
      "MID",
      "MID",
      "MID",
      "ATT",
      "ATT",
    ]);

    for (let i = 0; i < 10; i++) {
      const res = await postCreateGame();
      expect(res.status).toBe(201);
      const { gameId } = await res.json<{ gameId: string }>();
      const poolRows = await env.DB.prepare(
        "SELECT p.position FROM game_pool gp JOIN players p ON p.id = gp.player_id WHERE gp.game_id = ?",
      )
        .bind(gameId)
        .all<{ position: string }>();
      const goalieCount = poolRows.results.filter((r) => r.position === "GK").length;
      expect(goalieCount).toBe(2);
    }
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

  it("rejects a hand-picked pool with fewer than GOALIES_IN_POOL goalkeepers", async () => {
    const ids = await seedPlayers(
      "manualonegk",
      ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"],
    );

    const res = await postCreateGame({ selectedPlayerIds: ids });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/goalkeeper/i);
  });

  it("rejects a hand-picked pool with more than GOALIES_IN_POOL goalkeepers", async () => {
    const ids = await seedPlayers(
      "manualfourgk",
      ["GK", "GK", "GK", "GK", "DEF", "DEF", "MID", "MID", "ATT", "ATT"],
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

    // One captain reaches SQUAD_SIZE after 9 rounds (see the equivalent full-game test in
    // game-room.test.ts), auto-awarding the 10th player rather than playing out a round.
    let phase: string | undefined;
    for (let i = 0; i < 10 && phase !== "completed"; i++) {
      const proposed = await stub.proposeNextPlayer();
      if (!proposed.ok) throw new Error("expected ok");
      const firstBidder = proposed.state.round!.firstBidder;
      const other = firstBidder === "A" ? "B" : "A";
      await stub.placeBid(firstBidder, MIN_BID_INCREMENT);
      const passed = await stub.pass(other);
      if (!passed.ok) throw new Error("expected ok");
      phase = passed.state.phase;
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

/** Creates, completes, and (unless skipPublish) publishes a game, driving the DO directly. */
async function completeAndPublishGame(
  prefix: string,
  options?: { skipPublish?: boolean; notifyEmailA?: string; notifyEmailB?: string },
): Promise<string> {
  await seedPlayers(prefix, ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"]);
  const createRes = await postCreateGame();
  const { gameId } = await createRes.json<{ gameId: string }>();

  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));
  await stub.handleCaptainConnected("A");
  await stub.handleCaptainConnected("B");

  let phase: string | undefined;
  for (let i = 0; i < 10 && phase !== "completed"; i++) {
    const proposed = await stub.proposeNextPlayer();
    if (!proposed.ok) throw new Error("expected ok");
    const firstBidder = proposed.state.round!.firstBidder;
    const other = firstBidder === "A" ? "B" : "A";
    await stub.placeBid(firstBidder, MIN_BID_INCREMENT);
    const passed = await stub.pass(other);
    if (!passed.ok) throw new Error("expected ok");
    phase = passed.state.phase;
  }

  if (!options?.skipPublish) {
    await stub.requestPublish("A", options?.notifyEmailA ?? null);
    await stub.requestPublish("B", options?.notifyEmailB ?? null);
  }

  return gameId;
}

async function publicSlugFor(gameId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT public_slug FROM games WHERE id = ?").bind(gameId).first<{
    public_slug: string;
  }>();
  return row!.public_slug;
}

describe("GET /games/public (feed)", () => {
  it("returns an empty list when there are no published games", async () => {
    const res = await gamesRouter.request("/public", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ games: unknown[] }>();
    expect(body.games).toEqual([]);
  });

  it("excludes completed-but-unpublished games", async () => {
    await completeAndPublishGame("feedunpub", { skipPublish: true });
    const res = await gamesRouter.request("/public", {}, env);
    const body = await res.json<{ games: { gameId: string }[] }>();
    expect(body.games.find((g) => g.gameId.startsWith("feedunpub"))).toBeUndefined();
  });

  it("lists published games newest-first with slug, voting window, and tallies", async () => {
    const firstId = await completeAndPublishGame("feedfirst");
    // Ensure a distinct published_at ordering between the two games.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondId = await completeAndPublishGame("feedsecond");

    const res = await gamesRouter.request("/public", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json<{
      games: {
        gameId: string;
        publicSlug: string;
        votingClosesAt: number;
        expiresAt: number;
        tallies: { A: number; B: number };
      }[];
    }>();

    const ids = body.games.map((g) => g.gameId);
    expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId));

    const entry = body.games.find((g) => g.gameId === firstId)!;
    expect(entry.publicSlug).toBe(await publicSlugFor(firstId));
    expect(entry.tallies).toEqual({ A: 0, B: 0 });
    expect(entry.expiresAt).toBeGreaterThan(entry.votingClosesAt);
  });
});

describe("GET /games/public/:slug", () => {
  it("returns 404 for an unknown slug", async () => {
    const res = await gamesRouter.request("/public/does-not-exist", {}, env);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a completed-but-unpublished game (no public_slug set)", async () => {
    await completeAndPublishGame("pubunpub", { skipPublish: true });
    const res = await gamesRouter.request("/public/whatever-slug", {}, env);
    expect(res.status).toBe(404);
  });

  it("returns squads, voting window, and zeroed tallies for a freshly published game", async () => {
    const gameId = await completeAndPublishGame("pubfresh");
    const row = await env.DB.prepare("SELECT public_slug, voting_closes_at FROM games WHERE id = ?")
      .bind(gameId)
      .first<{ public_slug: string; voting_closes_at: number }>();

    const res = await gamesRouter.request(`/public/${row!.public_slug}`, {}, env);
    expect(res.status).toBe(200);
    const body = await res.json<{
      gameId: string;
      squads: { A: unknown[]; B: unknown[] };
      votingClosesAt: number;
      expiresAt: number;
      tallies: { A: number; B: number };
    }>();
    expect(body.gameId).toBe(gameId);
    expect(body.squads.A).toHaveLength(5);
    expect(body.squads.B).toHaveLength(5);
    expect(body.votingClosesAt).toBe(row!.voting_closes_at);
    expect(body.expiresAt).toBeGreaterThan(row!.voting_closes_at);
    expect(body.tallies).toEqual({ A: 0, B: 0 });
  });
});

describe("POST /games/public/:slug/vote", () => {
  it("returns 404 voting on an unpublished/unknown slug", async () => {
    const res = await gamesRouter.request(
      "/public/does-not-exist/vote",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ choice: "A", voterId: "voter-1" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("records a vote and returns updated tallies", async () => {
    const gameId = await completeAndPublishGame("pubvote");
    const slug = await publicSlugFor(gameId);

    const res = await gamesRouter.request(
      `/public/${slug}/vote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ choice: "A", voterId: "voter-1" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ tallies: { A: number; B: number } }>();
    expect(body.tallies).toEqual({ A: 1, B: 0 });
  });

  it("ignores a duplicate vote from the same voterId (no double-count)", async () => {
    const gameId = await completeAndPublishGame("pubvotedup");
    const slug = await publicSlugFor(gameId);
    const ip = freshIp();
    const cast = (choice: string) =>
      gamesRouter.request(
        `/public/${slug}/vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
          body: JSON.stringify({ choice, voterId: "voter-dup" }),
        },
        env,
      );

    await cast("A");
    const res = await cast("B");
    expect(res.status).toBe(200);
    const body = await res.json<{ tallies: { A: number; B: number } }>();
    expect(body.tallies).toEqual({ A: 1, B: 0 });
  });

  it("rejects an invalid choice", async () => {
    const gameId = await completeAndPublishGame("pubvotebad");
    const slug = await publicSlugFor(gameId);

    const res = await gamesRouter.request(
      `/public/${slug}/vote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ choice: "C", voterId: "voter-1" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a vote once the voting window has closed", async () => {
    const gameId = await completeAndPublishGame("pubvoteclosed");
    const slug = await publicSlugFor(gameId);
    await env.DB.prepare("UPDATE games SET voting_closes_at = ? WHERE id = ?")
      .bind(Date.now() - 1000, gameId)
      .run();

    const res = await gamesRouter.request(
      `/public/${slug}/vote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ choice: "A", voterId: "voter-1" }),
      },
      env,
    );
    expect(res.status).toBe(410);
  });

  it("rate-limits repeated votes from the same client IP", async () => {
    const gameId = await completeAndPublishGame("pubvoteratelimited");
    const slug = await publicSlugFor(gameId);
    const ip = "198.51.100.7";

    for (let i = 0; i < 10; i++) {
      const res = await gamesRouter.request(
        `/public/${slug}/vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
          body: JSON.stringify({ choice: "A", voterId: `voter-${i}` }),
        },
        env,
      );
      expect(res.status).toBe(200);
    }

    const blocked = await gamesRouter.request(
      `/public/${slug}/vote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ choice: "A", voterId: "voter-blocked" }),
      },
      env,
    );
    expect(blocked.status).toBe(429);
  });
});

describe("GET /games/public/:slug/comments", () => {
  it("returns 404 for an unpublished slug", async () => {
    const res = await gamesRouter.request("/public/does-not-exist/comments", {}, env);
    expect(res.status).toBe(404);
  });

  it("returns comments in chronological order", async () => {
    const gameId = await completeAndPublishGame("pubcommentslist");
    const slug = await publicSlugFor(gameId);

    await gamesRouter.request(
      `/public/${slug}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ authorName: "Alice", anonymous: false, text: "Great squad!" }),
      },
      env,
    );
    await gamesRouter.request(
      `/public/${slug}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ anonymous: true, text: "Second comment" }),
      },
      env,
    );

    const res = await gamesRouter.request(`/public/${slug}/comments`, {}, env);
    expect(res.status).toBe(200);
    const { comments } = await res.json<{ comments: { authorName: string | null; text: string }[] }>();
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ authorName: "Alice", text: "Great squad!" });
    expect(comments[1]).toMatchObject({ authorName: null, text: "Second comment" });
  });
});

describe("POST /games/public/:slug/comments", () => {
  it("returns 404 for an unpublished slug", async () => {
    const res = await gamesRouter.request(
      "/public/does-not-exist/comments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anonymous: true, text: "hello" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("posts an anonymous comment", async () => {
    const gameId = await completeAndPublishGame("pubcommentanon");
    const slug = await publicSlugFor(gameId);

    const res = await gamesRouter.request(
      `/public/${slug}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ anonymous: true, text: "Nice work" }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const { comment } = await res.json<{ comment: { authorName: string | null; text: string } }>();
    expect(comment.authorName).toBeNull();
    expect(comment.text).toBe("Nice work");
  });

  it("posts a named comment", async () => {
    const gameId = await completeAndPublishGame("pubcommentnamed");
    const slug = await publicSlugFor(gameId);

    const res = await gamesRouter.request(
      `/public/${slug}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ authorName: "Bob", anonymous: false, text: "Nice work" }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const { comment } = await res.json<{ comment: { authorName: string | null; text: string } }>();
    expect(comment.authorName).toBe("Bob");
  });

  it("rejects a non-anonymous comment with no username", async () => {
    const gameId = await completeAndPublishGame("pubcommentnoname");
    const slug = await publicSlugFor(gameId);

    const res = await gamesRouter.request(
      `/public/${slug}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ anonymous: false, text: "Nice work" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an empty comment", async () => {
    const gameId = await completeAndPublishGame("pubcommentempty");
    const slug = await publicSlugFor(gameId);

    const res = await gamesRouter.request(
      `/public/${slug}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ anonymous: true, text: "   " }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a profane comment", async () => {
    const gameId = await completeAndPublishGame("pubcommentprofane");
    const slug = await publicSlugFor(gameId);

    const res = await gamesRouter.request(
      `/public/${slug}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ anonymous: true, text: "you fucking idiot" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rate-limits repeated comments from the same client IP", async () => {
    const gameId = await completeAndPublishGame("pubcommentratelimited");
    const slug = await publicSlugFor(gameId);
    const ip = "198.51.100.8";

    for (let i = 0; i < 10; i++) {
      const res = await gamesRouter.request(
        `/public/${slug}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
          body: JSON.stringify({ anonymous: true, text: `comment ${i}` }),
        },
        env,
      );
      expect(res.status).toBe(201);
    }

    const blocked = await gamesRouter.request(
      `/public/${slug}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ anonymous: true, text: "blocked comment" }),
      },
      env,
    );
    expect(blocked.status).toBe(429);
  });
});

describe("GET /games/public/:slug/share/combined.png", () => {
  // The happy path (actually rendering a PNG via satori/resvg) isn't exercised here: that
  // dependency chain doesn't load under vitest-pool-workers' CJS/ESM shim in this repo's test
  // environment - the same reason the pre-existing /:id/share/*.png routes have no tests of
  // their own. This route reuses fetchPublishedGame/fetchCompletedSquads/renderCombinedSquadPng
  // exactly as the private routes do, so the 404 path below is what's actually new to verify.
  it("returns 404 for an unpublished slug", async () => {
    const res = await gamesRouter.request("/public/does-not-exist/share/combined.png", {}, env);
    expect(res.status).toBe(404);
  });
});

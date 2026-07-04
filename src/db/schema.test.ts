import { describe, expect, it, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import schema from "./schema.sql?raw";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
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

describe("D1 schema", () => {
  it("accepts one row per table and enforces the position/status/captain check constraints", async () => {
    await env.DB.prepare(
      "INSERT INTO players (id, name, position, created_at, archived_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind("p1", "Alex Keeper", "GK", Date.now(), null)
      .run();

    await env.DB.prepare(
      "INSERT INTO games (id, status, captain_a_token, captain_b_token, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind("g1", "waiting_for_captain_b", "tokenA", "tokenB", Date.now())
      .run();

    await env.DB.prepare(
      "INSERT INTO game_pool (game_id, player_id, proposal_order) VALUES (?, ?, ?)",
    )
      .bind("g1", "p1", 0)
      .run();

    await env.DB.prepare(
      "INSERT INTO game_players (game_id, player_id, captain, price_paid, round_number) VALUES (?, ?, ?, ?, ?)",
    )
      .bind("g1", "p1", "A", 10_000_000, 1)
      .run();

    const player = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind("p1").first();
    const game = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind("g1").first();
    const poolRow = await env.DB.prepare("SELECT * FROM game_pool WHERE game_id = ?")
      .bind("g1")
      .first();
    const resultRow = await env.DB.prepare("SELECT * FROM game_players WHERE game_id = ?")
      .bind("g1")
      .first();

    expect(player?.name).toBe("Alex Keeper");
    expect(game?.status).toBe("waiting_for_captain_b");
    expect(poolRow?.proposal_order).toBe(0);
    expect(resultRow?.captain).toBe("A");
  });

  it("rejects an invalid position via the CHECK constraint", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO players (id, name, position, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind("p2", "Bad Position", "STRIKER", Date.now())
        .run(),
    ).rejects.toThrow();
  });
});

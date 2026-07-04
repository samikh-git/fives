import { describe, expect, it, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import schema from "../db/schema.sql?raw";
import { deleteExpiredPublicPosts } from "./cleanup";
import { PUBLIC_POST_RETENTION_MS } from "../shared/constants";

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

async function insertPublishedGame(id: string, publishedAt: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO games (id, status, captain_a_token, created_at, completed_at, published_at, public_slug, voting_closes_at)
     VALUES (?, 'completed', 'tok', ?, ?, ?, ?, ?)`,
  )
    .bind(id, publishedAt, publishedAt, publishedAt, `${id}-slug`, publishedAt + 1000)
    .run();
  await env.DB.prepare(
    "INSERT INTO game_votes (game_id, voter_id, choice, created_at) VALUES (?, 'voter-1', 'A', ?)",
  )
    .bind(id, publishedAt)
    .run();
  await env.DB.prepare(
    "INSERT INTO game_comments (id, game_id, author_name, text, created_at) VALUES (?, ?, 'Fan', 'Nice squad!', ?)",
  )
    .bind(`${id}-comment`, id, publishedAt)
    .run();
}

describe("deleteExpiredPublicPosts", () => {
  it("returns 0 and changes nothing when there are no published games", async () => {
    const count = await deleteExpiredPublicPosts(env.DB, Date.now());
    expect(count).toBe(0);
  });

  it("leaves a recently-published game untouched", async () => {
    const now = Date.now();
    await insertPublishedGame("cleanup-recent", now - 1000);

    const count = await deleteExpiredPublicPosts(env.DB, now);
    expect(count).toBe(0);

    const row = await env.DB.prepare("SELECT public_slug FROM games WHERE id = ?")
      .bind("cleanup-recent")
      .first<{ public_slug: string | null }>();
    expect(row?.public_slug).toBe("cleanup-recent-slug");
  });

  it("clears published_at/public_slug/voting_closes_at and deletes votes for a game past retention, without touching status/completed_at", async () => {
    const now = Date.now();
    const publishedAt = now - PUBLIC_POST_RETENTION_MS - 1000;
    await insertPublishedGame("cleanup-expired", publishedAt);

    const count = await deleteExpiredPublicPosts(env.DB, now);
    expect(count).toBe(1);

    const row = await env.DB.prepare(
      "SELECT status, completed_at, published_at, public_slug, voting_closes_at FROM games WHERE id = ?",
    )
      .bind("cleanup-expired")
      .first<{
        status: string;
        completed_at: number;
        published_at: number | null;
        public_slug: string | null;
        voting_closes_at: number | null;
      }>();
    expect(row?.status).toBe("completed");
    expect(row?.completed_at).toBe(publishedAt);
    expect(row?.published_at).toBeNull();
    expect(row?.public_slug).toBeNull();
    expect(row?.voting_closes_at).toBeNull();

    const votes = await env.DB.prepare("SELECT * FROM game_votes WHERE game_id = ?")
      .bind("cleanup-expired")
      .all();
    expect(votes.results).toHaveLength(0);

    const comments = await env.DB.prepare("SELECT * FROM game_comments WHERE game_id = ?")
      .bind("cleanup-expired")
      .all();
    expect(comments.results).toHaveLength(0);
  });
});

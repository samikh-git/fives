import { ABANDONED_GAME_RETENTION_MS } from "../shared/constants";

/**
 * Purges abandoned games (and their game_pool rows) whose created_at is older than the
 * retention window. Completed games are never purged here — they're kept indefinitely
 * as the historical record (see game_players / the reserved published_at/public_slug columns).
 */
export async function deleteExpiredGames(db: D1Database, now: number = Date.now()): Promise<number> {
  const cutoff = now - ABANDONED_GAME_RETENTION_MS;
  const { results } = await db
    .prepare("SELECT id FROM games WHERE created_at < ? AND status != 'completed'")
    .bind(cutoff)
    .all<{ id: string }>();

  if (results.length === 0) return 0;

  const ids = results.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  await db.batch([
    db.prepare(`DELETE FROM game_pool WHERE game_id IN (${placeholders})`).bind(...ids),
    db.prepare(`DELETE FROM games WHERE id IN (${placeholders})`).bind(...ids),
  ]);

  return ids.length;
}

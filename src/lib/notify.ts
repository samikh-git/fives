import type { Env } from "../index";
import type { Captain } from "../shared/types";

type NotifyEnv = Pick<Env, "RESEND_API_KEY" | "RESEND_FROM_ADDRESS" | "APP_BASE_URL">;

interface ClosedGameRow {
  id: string;
  public_slug: string;
  captain_a_notify_email: string | null;
  captain_b_notify_email: string | null;
}

async function fetchTallies(db: D1Database, gameId: string): Promise<{ A: number; B: number }> {
  const { results } = await db
    .prepare("SELECT choice, COUNT(*) as count FROM game_votes WHERE game_id = ? GROUP BY choice")
    .bind(gameId)
    .all<{ choice: Captain; count: number }>();
  const tallies = { A: 0, B: 0 };
  for (const row of results) tallies[row.choice] = row.count;
  return tallies;
}

async function sendResendEmail(env: NotifyEnv, to: string, subject: string, text: string): Promise<void> {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.RESEND_FROM_ADDRESS, to: [to], subject, text }),
  });
}

/**
 * Emails each opted-in captain once their public voting page's window has closed, then
 * stamps voting_closed_notified_at so a game is never notified twice. Called from the
 * scheduled sweep alongside the cleanup jobs - see src/index.ts's `scheduled` handler.
 */
export async function sendVotingClosedNotifications(
  db: D1Database,
  env: NotifyEnv,
  now: number = Date.now(),
): Promise<number> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_ADDRESS) return 0;

  const { results } = await db
    .prepare(
      `SELECT id, public_slug, captain_a_notify_email, captain_b_notify_email FROM games
       WHERE voting_closes_at IS NOT NULL AND voting_closes_at < ? AND voting_closed_notified_at IS NULL
         AND (captain_a_notify_email IS NOT NULL OR captain_b_notify_email IS NOT NULL)`,
    )
    .bind(now)
    .all<ClosedGameRow>();

  for (const game of results) {
    const tallies = await fetchTallies(db, game.id);
    const link = `${env.APP_BASE_URL}/showcase/${game.public_slug}`;
    const subject = "Voting closed on your Fives squad";
    const text = `Final tally: Squad A ${tallies.A} - Squad B ${tallies.B}\n\nView the result: ${link}`;

    const recipients = [game.captain_a_notify_email, game.captain_b_notify_email].filter(
      (email): email is string => Boolean(email),
    );
    for (const email of recipients) {
      await sendResendEmail(env, email, subject, text);
    }

    await db.prepare("UPDATE games SET voting_closed_notified_at = ? WHERE id = ?").bind(now, game.id).run();
  }

  return results.length;
}

/**
 * A lightweight, per-browser "how many times have we drafted together" counter, keyed by
 * the opponent's display name. Fives has no accounts and no automatic win condition (the
 * only notion of "who's better" is the optional public vote), so this deliberately tracks
 * games played rather than a fabricated win/loss record.
 */
export interface RivalryRecord {
  played: number;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function rivalryKey(opponentName: string): string {
  return `fives:rivalry:${normalize(opponentName)}`;
}

function countedKey(gameId: string): string {
  return `fives:rivalry-counted:${gameId}`;
}

export function getRivalry(opponentName: string | null): RivalryRecord {
  if (!opponentName || !normalize(opponentName)) return { played: 0 };
  const raw = localStorage.getItem(rivalryKey(opponentName));
  if (!raw) return { played: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<RivalryRecord>;
    return { played: typeof parsed.played === "number" ? parsed.played : 0 };
  } catch {
    return { played: 0 };
  }
}

/** Idempotent per gameId: safe to call on every render/reconnect of a completed game. */
export function recordGamePlayedOnce(gameId: string, opponentName: string | null): RivalryRecord {
  if (!opponentName || !normalize(opponentName)) return { played: 0 };

  if (localStorage.getItem(countedKey(gameId))) {
    return getRivalry(opponentName);
  }
  localStorage.setItem(countedKey(gameId), "1");

  const next: RivalryRecord = { played: getRivalry(opponentName).played + 1 };
  localStorage.setItem(rivalryKey(opponentName), JSON.stringify(next));
  return next;
}

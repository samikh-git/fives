import type { Captain } from "../../../src/shared/types";

export interface CaptainSession {
  token: string;
  role: Captain;
  joinUrlForB?: string;
  name?: string;
}

function storageKey(gameId: string): string {
  return `fives:captain-session:${gameId}`;
}

export function saveCaptainSession(
  gameId: string,
  token: string,
  role: Captain,
  joinUrlForB?: string,
  name?: string,
): void {
  localStorage.setItem(storageKey(gameId), JSON.stringify({ token, role, joinUrlForB, name }));
}

export function getCaptainSession(gameId: string): CaptainSession | null {
  const raw = localStorage.getItem(storageKey(gameId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CaptainSession>;
    if (
      parsed &&
      typeof parsed.token === "string" &&
      (parsed.role === "A" || parsed.role === "B")
    ) {
      return {
        token: parsed.token,
        role: parsed.role,
        joinUrlForB: typeof parsed.joinUrlForB === "string" ? parsed.joinUrlForB : undefined,
        name: typeof parsed.name === "string" ? parsed.name : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

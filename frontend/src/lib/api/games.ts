import type { Captain, Position } from "../../../../src/shared/types";

const BASE_URL = "/api/games";

export interface CreateGameResponse {
  gameId: string;
  captainAToken: string;
  joinUrlForB: string;
}

export interface GameResultEntry {
  playerId: string;
  name: string;
  position: Position;
  captain: Captain;
  pricePaid: number;
  roundNumber: number;
}

export interface GameSummary {
  gameId: string;
  status: "waiting_for_captain_b" | "in_progress" | "completed";
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  result: { squads: Record<Captain, GameResultEntry[]> } | null;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function createGame(selectedPlayerIds?: string[]): Promise<CreateGameResponse> {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: selectedPlayerIds ? { "Content-Type": "application/json" } : undefined,
    body: selectedPlayerIds ? JSON.stringify({ selectedPlayerIds }) : undefined,
  });
  return parseJsonResponse<CreateGameResponse>(res);
}

export async function getGame(gameId: string): Promise<GameSummary> {
  const res = await fetch(`${BASE_URL}/${gameId}`);
  return parseJsonResponse<GameSummary>(res);
}

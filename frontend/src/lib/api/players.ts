import type { Player, Position } from "../../../../src/shared/types";

const BASE_URL = "/api/players";
const ADMIN_BASE_URL = "/api/admin/players";

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

export interface PlayersPage {
  players: Player[];
  total: number;
}

export async function listPlayers(options?: { limit?: number; offset?: number }): Promise<PlayersPage> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.offset !== undefined) params.set("offset", String(options.offset));
  const query = params.toString();
  const res = await fetch(query ? `${BASE_URL}?${query}` : BASE_URL);
  return parseJsonResponse<PlayersPage>(res);
}

export async function createPlayer(input: {
  name: string;
  position: Position;
  club?: string | null;
  nation?: string | null;
  imageUrl?: string | null;
}): Promise<Player> {
  const res = await fetch(ADMIN_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonResponse<Player>(res);
}

export async function uploadPlayerImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`${ADMIN_BASE_URL}/images`, { method: "POST", body: formData });
  return parseJsonResponse<{ url: string }>(res);
}

export async function updatePlayer(
  id: string,
  input: { name?: string; position?: Position },
): Promise<Player> {
  const res = await fetch(`${ADMIN_BASE_URL}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonResponse<Player>(res);
}

export async function archivePlayer(id: string): Promise<Player> {
  const res = await fetch(`${ADMIN_BASE_URL}/${id}`, { method: "DELETE" });
  return parseJsonResponse<Player>(res);
}

import type { Player, Position } from "../../../../src/shared/types";

const BASE_URL = "/api/players";

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

export async function listPlayers(): Promise<Player[]> {
  const res = await fetch(BASE_URL);
  return parseJsonResponse<Player[]>(res);
}

export async function createPlayer(input: {
  name: string;
  position: Position;
  imageUrl?: string | null;
}): Promise<Player> {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonResponse<Player>(res);
}

export async function uploadPlayerImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`${BASE_URL}/images`, { method: "POST", body: formData });
  return parseJsonResponse<{ url: string }>(res);
}

export async function updatePlayer(
  id: string,
  input: { name?: string; position?: Position },
): Promise<Player> {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonResponse<Player>(res);
}

export async function archivePlayer(id: string): Promise<Player> {
  const res = await fetch(`${BASE_URL}/${id}`, { method: "DELETE" });
  return parseJsonResponse<Player>(res);
}

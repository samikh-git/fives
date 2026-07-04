import type { Captain, Position, SquadEntry } from "../../../../src/shared/types";

const BASE_URL = "/api/games";

export interface CreateGameResponse {
  gameId: string;
  captainAToken: string;
  joinUrlForB: string;
}

export interface PoolFilters {
  leagues?: string[];
  clubs?: string[];
  nations?: string[];
}

export interface CreateGameOptions {
  selectedPlayerIds?: string[];
  filters?: PoolFilters;
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

export async function createGame(options?: CreateGameOptions): Promise<CreateGameResponse> {
  const hasBody = !!(options?.selectedPlayerIds || options?.filters);
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options) : undefined,
  });
  return parseJsonResponse<CreateGameResponse>(res);
}

export async function getGame(gameId: string): Promise<GameSummary> {
  const res = await fetch(`${BASE_URL}/${gameId}`);
  return parseJsonResponse<GameSummary>(res);
}

export interface PublicGameSummary {
  gameId: string;
  squads: Record<Captain, SquadEntry[]>;
  votingClosesAt: number;
  expiresAt: number;
  tallies: Record<Captain, number>;
}

export async function getPublicGame(slug: string): Promise<PublicGameSummary> {
  const res = await fetch(`${BASE_URL}/public/${slug}`);
  return parseJsonResponse<PublicGameSummary>(res);
}

export async function voteOnPublicGame(
  slug: string,
  choice: Captain,
  voterId: string,
): Promise<{ tallies: Record<Captain, number> }> {
  const res = await fetch(`${BASE_URL}/public/${slug}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice, voterId }),
  });
  return parseJsonResponse<{ tallies: Record<Captain, number> }>(res);
}

export interface PublicFeedEntry {
  gameId: string;
  publicSlug: string;
  votingClosesAt: number;
  expiresAt: number;
  tallies: Record<Captain, number>;
}

export async function getPublicGamesFeed(): Promise<PublicFeedEntry[]> {
  const res = await fetch(`${BASE_URL}/public`);
  const body = await parseJsonResponse<{ games: PublicFeedEntry[] }>(res);
  return body.games;
}

export interface PublicComment {
  id: string;
  authorName: string | null;
  text: string;
  createdAt: number;
}

export async function getComments(slug: string): Promise<PublicComment[]> {
  const res = await fetch(`${BASE_URL}/public/${slug}/comments`);
  const body = await parseJsonResponse<{ comments: PublicComment[] }>(res);
  return body.comments;
}

export interface PostCommentOptions {
  text: string;
  authorName: string | null;
}

export async function postComment(slug: string, options: PostCommentOptions): Promise<PublicComment> {
  const res = await fetch(`${BASE_URL}/public/${slug}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: options.text,
      anonymous: options.authorName === null,
      authorName: options.authorName ?? undefined,
    }),
  });
  const body = await parseJsonResponse<{ comment: PublicComment }>(res);
  return body.comment;
}

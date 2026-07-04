import type { Position } from "../shared/types";

const API_BASE_URL = "https://www.thesportsdb.com/api/v1/json";
const FREE_API_KEY = "123";

/**
 * Order matters: "Defensive Midfield" and "Attacking Midfield" both contain a defender/
 * attacker keyword as a substring ("Defen", "Attack"), so the midfield check must run
 * before either, or those roles get misclassified as DEF/ATT instead of MID.
 */
const POSITION_KEYWORDS: Array<{ match: RegExp; position: Position }> = [
  { match: /goalkeeper/i, position: "GK" },
  { match: /midfield/i, position: "MID" },
  { match: /back|defen/i, position: "DEF" },
  { match: /wing|forward|striker|attack/i, position: "ATT" },
];

/** Returns null for non-playing roles (coaches, managers, etc.) or unrecognized strings. */
export function mapSportsDbPosition(position: string | null | undefined): Position | null {
  if (!position) return null;
  const found = POSITION_KEYWORDS.find(({ match }) => match.test(position));
  return found?.position ?? null;
}

interface SportsDbTeam {
  idTeam: string;
  strTeam: string;
}

interface SportsDbPlayer {
  idPlayer: string;
  strPlayer: string;
  strTeam: string;
  strNationality: string | null;
  strPosition: string | null;
  strCutout: string | null;
  strThumb: string | null;
}

export interface LeagueTeam {
  externalId: string;
  name: string;
}

export interface ImportedPlayerCandidate {
  externalId: string;
  name: string;
  position: Position | null;
  club: string;
  nation: string | null;
  league: string;
  imageUrl: string | null;
}

async function getJson<T>(apiKey: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE_URL}/${apiKey}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`thesportsdb request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/**
 * Free-tier `search_all_teams.php` silently caps results at 10 teams (alphabetical),
 * unlike the `lookup_all_teams.php?id=<leagueId>` variant, which returns more results but
 * mixes in stale/wrong-season teams — verified by spot-checking both against the real API.
 * Named lookup is the one worth trusting.
 */
export async function fetchLeagueTeams(apiKey: string, league: string): Promise<LeagueTeam[]> {
  const data = await getJson<{ teams: SportsDbTeam[] | null }>(apiKey, "search_all_teams.php", {
    l: league,
  });
  return (data.teams ?? []).map((team) => ({ externalId: team.idTeam, name: team.strTeam }));
}

/** Free-tier `lookup_all_players.php` silently caps results at 10 players per team (alphabetical by first name). */
export async function fetchTeamPlayers(
  apiKey: string,
  team: LeagueTeam,
  league: string,
): Promise<ImportedPlayerCandidate[]> {
  const data = await getJson<{ player: SportsDbPlayer[] | null }>(apiKey, "lookup_all_players.php", {
    id: team.externalId,
  });

  return (data.player ?? []).map((player): ImportedPlayerCandidate => ({
    externalId: player.idPlayer,
    name: player.strPlayer,
    position: mapSportsDbPosition(player.strPosition),
    club: player.strTeam || team.name,
    nation: player.strNationality,
    league,
    imageUrl: player.strCutout || player.strThumb || null,
  }));
}

export function resolveApiKey(configuredKey: string | undefined): string {
  return configuredKey && configuredKey.trim() !== "" ? configuredKey : FREE_API_KEY;
}

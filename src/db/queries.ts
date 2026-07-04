import type { Player, Position } from "../shared/types";

interface PlayerRow {
  id: string;
  name: string;
  position: Position;
  club: string | null;
  nation: string | null;
  league: string | null;
  image_url: string | null;
  external_id: string | null;
  created_at: number;
  archived_at: number | null;
}

function rowToPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    club: row.club,
    nation: row.nation,
    league: row.league,
    imageUrl: row.image_url,
    externalId: row.external_id,
    archivedAt: row.archived_at,
  };
}

export async function createPlayer(
  db: D1Database,
  input: {
    name: string;
    position: Position;
    club?: string | null;
    nation?: string | null;
    league?: string | null;
    imageUrl?: string | null;
    externalId?: string | null;
  },
): Promise<Player> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const club = input.club ?? null;
  const nation = input.nation ?? null;
  const league = input.league ?? null;
  const imageUrl = input.imageUrl ?? null;
  const externalId = input.externalId ?? null;

  await db
    .prepare(
      "INSERT INTO players (id, name, position, club, nation, league, image_url, external_id, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, input.name, input.position, club, nation, league, imageUrl, externalId, createdAt, null)
    .run();

  return {
    id,
    name: input.name,
    position: input.position,
    club,
    nation,
    league,
    imageUrl,
    externalId,
    archivedAt: null,
  };
}

/**
 * Insert-or-update keyed on external_id (the source API's player id), so re-running an
 * import is safe: existing players get their club/league/nation/image refreshed instead of
 * being duplicated.
 */
export async function upsertPlayerByExternalId(
  db: D1Database,
  input: {
    externalId: string;
    name: string;
    position: Position;
    club: string | null;
    nation: string | null;
    league: string | null;
    imageUrl: string | null;
  },
): Promise<{ player: Player; created: boolean }> {
  const existing = await db
    .prepare("SELECT * FROM players WHERE external_id = ?")
    .bind(input.externalId)
    .first<PlayerRow>();

  if (existing) {
    await db
      .prepare(
        "UPDATE players SET name = ?, position = ?, club = ?, nation = ?, league = ?, image_url = ? WHERE id = ?",
      )
      .bind(input.name, input.position, input.club, input.nation, input.league, input.imageUrl, existing.id)
      .run();

    return {
      created: false,
      player: rowToPlayer({
        ...existing,
        name: input.name,
        position: input.position,
        club: input.club,
        nation: input.nation,
        league: input.league,
        image_url: input.imageUrl,
      }),
    };
  }

  const player = await createPlayer(db, {
    name: input.name,
    position: input.position,
    club: input.club,
    nation: input.nation,
    league: input.league,
    imageUrl: input.imageUrl,
    externalId: input.externalId,
  });
  return { created: true, player };
}

export async function listPlayers(
  db: D1Database,
  options?: { includeArchived?: boolean },
): Promise<Player[]> {
  const query = options?.includeArchived
    ? "SELECT * FROM players ORDER BY created_at ASC"
    : "SELECT * FROM players WHERE archived_at IS NULL ORDER BY created_at ASC";

  const { results } = await db.prepare(query).all<PlayerRow>();
  return results.map(rowToPlayer);
}

export async function getPlayerById(db: D1Database, id: string): Promise<Player | null> {
  const row = await db.prepare("SELECT * FROM players WHERE id = ?").bind(id).first<PlayerRow>();
  return row ? rowToPlayer(row) : null;
}

export async function updatePlayer(
  db: D1Database,
  id: string,
  input: {
    name?: string;
    position?: Position;
    club?: string | null;
    nation?: string | null;
    league?: string | null;
    imageUrl?: string | null;
  },
): Promise<Player | null> {
  const existing = await getPlayerById(db, id);
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const position = input.position ?? existing.position;
  const club = input.club !== undefined ? input.club : existing.club;
  const nation = input.nation !== undefined ? input.nation : existing.nation;
  const league = input.league !== undefined ? input.league : existing.league;
  const imageUrl = input.imageUrl !== undefined ? input.imageUrl : existing.imageUrl;

  await db
    .prepare(
      "UPDATE players SET name = ?, position = ?, club = ?, nation = ?, league = ?, image_url = ? WHERE id = ?",
    )
    .bind(name, position, club, nation, league, imageUrl, id)
    .run();

  return { ...existing, name, position, club, nation, league, imageUrl };
}

export async function archivePlayer(db: D1Database, id: string): Promise<Player | null> {
  const existing = await getPlayerById(db, id);
  if (!existing) return null;

  const archivedAt = Date.now();
  await db.prepare("UPDATE players SET archived_at = ? WHERE id = ?").bind(archivedAt, id).run();

  return { ...existing, archivedAt };
}

import type { Position, SquadEntry } from "./types";

export interface PlacedPlayer {
  entry: SquadEntry;
  xPct: number;
  yPct: number;
}

const ROW_ORDER: Position[] = ["GK", "DEF", "MID", "ATT"];

/** Centers `n` markers evenly across the row's width, with margin on both ends. */
export function layoutRow(entries: SquadEntry[], yPct: number): PlacedPlayer[] {
  const n = entries.length;
  return entries.map((entry, i) => ({
    entry,
    xPct: (i + 1) / (n + 1),
    yPct,
  }));
}

/**
 * Groups a squad by position (GK, DEF, MID, ATT) and lays each group out as a row at the
 * y-coordinate the caller supplies for that position. Handles any 0-5 split across positions -
 * squads aren't drafted to a fixed formation, so a row with zero players is simply omitted.
 */
export function layoutFormation(squad: SquadEntry[], rowYPct: Record<Position, number>): PlacedPlayer[] {
  const placed: PlacedPlayer[] = [];
  for (const position of ROW_ORDER) {
    const rowEntries = squad.filter((entry) => entry.position === position);
    if (rowEntries.length === 0) continue;
    placed.push(...layoutRow(rowEntries, rowYPct[position]));
  }
  return placed;
}

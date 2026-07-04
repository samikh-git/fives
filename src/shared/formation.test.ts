import { describe, it, expect } from "vitest";
import { layoutRow, layoutFormation } from "./formation";
import type { Position, SquadEntry } from "./types";

function makeEntry(id: string, position: Position): SquadEntry {
  return {
    playerId: id,
    name: id,
    position,
    club: null,
    nation: null,
    imageUrl: null,
    pricePaid: 1_000_000,
    roundNumber: 1,
  };
}

describe("layoutRow", () => {
  it("returns an empty array for zero entries", () => {
    expect(layoutRow([], 0.5)).toEqual([]);
  });

  it("centers a single entry", () => {
    const [placed] = layoutRow([makeEntry("a", "GK")], 0.5);
    expect(placed!.xPct).toBeCloseTo(0.5);
    expect(placed!.yPct).toBe(0.5);
  });

  it("evenly spaces multiple entries with no crowding at the edges", () => {
    const entries = [makeEntry("a", "DEF"), makeEntry("b", "DEF"), makeEntry("c", "DEF")];
    const placed = layoutRow(entries, 0.7);
    const xs = placed.map((p) => p.xPct);
    expect(xs).toEqual([0.25, 0.5, 0.75]);
    for (const x of xs) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("handles all 5 squad slots in one row without NaN or out-of-range values", () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`p${i}`, "MID"));
    const placed = layoutRow(entries, 0.3);
    for (const p of placed) {
      expect(Number.isNaN(p.xPct)).toBe(false);
      expect(p.xPct).toBeGreaterThan(0);
      expect(p.xPct).toBeLessThan(1);
    }
  });
});

describe("layoutFormation", () => {
  const rowYPct: Record<Position, number> = { GK: 0.9, DEF: 0.7, MID: 0.5, ATT: 0.3 };

  it("groups by position in GK, DEF, MID, ATT order regardless of input order", () => {
    const squad = [
      makeEntry("att1", "ATT"),
      makeEntry("gk1", "GK"),
      makeEntry("mid1", "MID"),
      makeEntry("def1", "DEF"),
    ];
    const placed = layoutFormation(squad, rowYPct);
    expect(placed.map((p) => p.entry.playerId)).toEqual(["gk1", "def1", "mid1", "att1"]);
    expect(placed.map((p) => p.yPct)).toEqual([0.9, 0.7, 0.5, 0.3]);
  });

  it("omits rows with zero players instead of producing empty gaps", () => {
    const squad = [makeEntry("gk1", "GK"), makeEntry("def1", "DEF"), makeEntry("def2", "DEF")];
    const placed = layoutFormation(squad, rowYPct);
    expect(placed.map((p) => p.entry.position)).toEqual(["GK", "DEF", "DEF"]);
  });

  it("handles a lopsided distribution (e.g. 0 GK, 5 DEF)", () => {
    const squad = Array.from({ length: 5 }, (_, i) => makeEntry(`def${i}`, "DEF"));
    const placed = layoutFormation(squad, rowYPct);
    expect(placed).toHaveLength(5);
    expect(placed.every((p) => p.entry.position === "DEF")).toBe(true);
    expect(placed.every((p) => p.yPct === 0.7)).toBe(true);
  });
});

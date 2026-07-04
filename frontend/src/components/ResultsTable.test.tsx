import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultsTable } from "./ResultsTable";
import type { Captain, SquadEntry } from "../../../src/shared/types";

const squads: Record<Captain, SquadEntry[]> = {
  A: [
    {
      playerId: "p1",
      name: "Alex Keeper",
      position: "GK",
      club: null,
      nation: null,
      imageUrl: null,
      pricePaid: 20_000_000,
      roundNumber: 1,
    },
    {
      playerId: "p2",
      name: "Sam Back",
      position: "DEF",
      club: null,
      nation: null,
      imageUrl: null,
      pricePaid: 10_000_000,
      roundNumber: 2,
    },
  ],
  B: [
    {
      playerId: "p3",
      name: "Jo Mid",
      position: "MID",
      club: null,
      nation: null,
      imageUrl: null,
      pricePaid: 30_000_000,
      roundNumber: 1,
    },
  ],
};

describe("ResultsTable", () => {
  it("shows both captains' squads with per-player prices and a total-spend row", () => {
    render(<ResultsTable squads={squads} />);

    expect(screen.getByText("Alex Keeper")).toBeInTheDocument();
    expect(screen.getByText("Sam Back")).toBeInTheDocument();
    expect(screen.getByText("Jo Mid")).toBeInTheDocument();

    // Totals: A spent 30,000,000; B spent 30,000,000
    const totals = screen.getAllByText(/30,000,000/);
    expect(totals.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/total/i).length).toBe(2);
  });
});

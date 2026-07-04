import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SquadPanel } from "./SquadPanel";
import type { SquadEntry } from "../../../src/shared/types";

const squad: SquadEntry[] = [
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
    pricePaid: 15_000_000,
    roundNumber: 2,
  },
];

describe("SquadPanel", () => {
  it("lists the captain's won players with prices", () => {
    render(<SquadPanel captain="B" squad={squad} />);

    expect(screen.getByText(/captain b/i)).toBeInTheDocument();
    expect(screen.getByText("Alex Keeper")).toBeInTheDocument();
    expect(screen.getByText("20,000,000")).toBeInTheDocument();
    expect(screen.getByText("Sam Back")).toBeInTheDocument();
    expect(screen.getByText("15,000,000")).toBeInTheDocument();
  });

  it("renders with no players won yet", () => {
    render(<SquadPanel captain="A" squad={[]} />);

    expect(screen.getByText(/captain a/i)).toBeInTheDocument();
  });
});

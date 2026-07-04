import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerCard } from "./PlayerCard";

describe("PlayerCard", () => {
  it("shows the player's name and position", () => {
    render(<PlayerCard name="Alex Keeper" position="GK" />);

    expect(screen.getByText("Alex Keeper")).toBeInTheDocument();
    expect(screen.getByText("GK")).toBeInTheDocument();
  });
});

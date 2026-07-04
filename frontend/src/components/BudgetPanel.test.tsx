import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetPanel } from "./BudgetPanel";

describe("BudgetPanel", () => {
  it("shows the captain's remaining budget and squad slots filled", () => {
    render(<BudgetPanel captain="A" budget={125_000_000} squadCount={3} />);

    expect(screen.getByText(/captain a/i)).toBeInTheDocument();
    expect(screen.getByText("125,000,000")).toBeInTheDocument();
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });
});

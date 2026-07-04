import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { JoinGamePage } from "./JoinGamePage";
import { getCaptainSession } from "../lib/session";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/game/:gameId/join" element={<JoinGamePage />} />
        <Route path="/game/:gameId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("JoinGamePage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores the captain-B session (with a chosen name) and navigates to the game room, stripping the token", async () => {
    renderAt("/game/game-1/join?t=token-b");

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Jamie" } });
    fireEvent.click(screen.getByRole("button", { name: /join game/i }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/game/game-1");
    });

    expect(screen.getByTestId("location")).not.toHaveTextContent("token-b");
    expect(getCaptainSession("game-1")).toEqual({ token: "token-b", role: "B", name: "Jamie" });
  });

  it("shows an invalid-link state when there is no token", async () => {
    renderAt("/game/game-1/join");

    expect(await screen.findByText(/invalid/i)).toBeInTheDocument();
    expect(getCaptainSession("game-1")).toBeNull();
  });
});

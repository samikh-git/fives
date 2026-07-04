import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CreateGamePage } from "./CreateGamePage";
import * as gamesApi from "../lib/api/games";
import * as playersApi from "../lib/api/players";
import * as session from "../lib/session";
import type { Player } from "../../../src/shared/types";

vi.mock("../lib/api/games");
vi.mock("../lib/api/players");

const mockedGamesApi = vi.mocked(gamesApi);
const mockedPlayersApi = vi.mocked(playersApi);

function makePlayers(): Player[] {
  const players: Player[] = [];
  for (let i = 1; i <= 9; i++) {
    players.push({
      id: `f${i}`,
      name: `Field Player ${i}`,
      position: "MID",
      club: null,
      nation: null,
      league: null,
      imageUrl: null,
      externalId: null,
      archivedAt: null,
    });
  }
  players.push({ id: "g1", name: "Goalie 1", position: "GK", club: null, nation: null, league: null, imageUrl: null, externalId: null, archivedAt: null });
  players.push({ id: "g2", name: "Goalie 2", position: "GK", club: null, nation: null, league: null, imageUrl: null, externalId: null, archivedAt: null });
  return players;
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mockedGamesApi.createGame.mockResolvedValue({
    gameId: "game-1",
    captainAToken: "token-a",
    joinUrlForB: "https://example.com/game/game-1/join?t=token-b",
  });
  mockedPlayersApi.listPlayers.mockResolvedValue(makePlayers());
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/games/new"]}>
      <Routes>
        <Route path="/games/new" element={<CreateGamePage />} />
        <Route path="/game/:gameId" element={<p>Game room</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CreateGamePage", () => {
  it("creates a game with a server-selected random pool, stores the captain-A session, and navigates to the game room", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /create game/i }));

    await waitFor(() => {
      expect(mockedGamesApi.createGame).toHaveBeenCalledTimes(1);
    });
    expect(mockedGamesApi.createGame).toHaveBeenCalledWith();

    await screen.findByText("Game room");

    expect(session.getCaptainSession("game-1")).toEqual({
      token: "token-a",
      role: "A",
      joinUrlForB: "https://example.com/game/game-1/join?t=token-b",
    });
  });

  it("shows an error message when creation fails", async () => {
    mockedGamesApi.createGame.mockRejectedValue(new Error("Roster must contain at least 10 players"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /create game/i }));

    await screen.findByText(/Roster must contain at least 10 players/i);
  });

  it("disables Create game in manual mode until exactly 10 players (with enough goalkeepers) are picked", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("radio", { name: /choose players/i }));
    await screen.findByText("Field Player 1");

    const createButton = screen.getByRole("button", { name: /create game/i });
    expect(createButton).toBeDisabled();

    for (let i = 1; i <= 8; i++) {
      fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`Field Player ${i}$`) }));
    }
    fireEvent.click(screen.getByRole("checkbox", { name: /Goalie 1/ }));
    expect(createButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /Goalie 2/ }));
    expect(createButton).not.toBeDisabled();
  });

  it("submits the hand-picked player ids when in manual mode", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("radio", { name: /choose players/i }));
    await screen.findByText("Field Player 1");

    for (let i = 1; i <= 8; i++) {
      fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`Field Player ${i}$`) }));
    }
    fireEvent.click(screen.getByRole("checkbox", { name: /Goalie 1/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Goalie 2/ }));

    fireEvent.click(screen.getByRole("button", { name: /create game/i }));

    await waitFor(() => {
      expect(mockedGamesApi.createGame).toHaveBeenCalledTimes(1);
    });
    const [selectedIds] = mockedGamesApi.createGame.mock.calls[0]!;
    expect(new Set(selectedIds)).toEqual(
      new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "g1", "g2"]),
    );
  });
});

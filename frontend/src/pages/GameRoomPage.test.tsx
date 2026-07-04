import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameRoomPage } from "./GameRoomPage";
import * as sessionLib from "../lib/session";
import * as useGameSocketHook from "../hooks/useGameSocket";
import type { GameState } from "../../../src/shared/types";

vi.mock("../hooks/useGameSocket");

const mockedUseGameSocket = vi.mocked(useGameSocketHook.useGameSocket);

const baseState: GameState = {
  gameId: "game-1",
  phase: "waiting_for_captain_b",
  captainAConnected: true,
  captainBConnected: false,
  captainNames: { A: null, B: null },
  pool: [],
  nextProposalIndex: 0,
  budgets: { A: 250_000_000, B: 250_000_000 },
  squadCounts: { A: 0, B: 0 },
  squads: { A: [], B: [] },
  lastRoundFirstBidder: null,
  round: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/game/game-1"]}>
      <Routes>
        <Route path="/game/:gameId" element={<GameRoomPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mockedUseGameSocket.mockReturnValue({
    state: null,
    error: null,
    connected: true,
    proposeNextPlayer: vi.fn(),
    placeBid: vi.fn(),
    pass: vi.fn(),
    chatMessages: [],
    sendChat: vi.fn(),
    dismissError: vi.fn(),
  });
});

describe("GameRoomPage", () => {
  it("shows an invalid-link state when there is no stored session for this game", () => {
    renderPage();

    expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
  });

  it("renders the lobby view while waiting for captain B to join", () => {
    sessionLib.saveCaptainSession("game-1", "token-a", "A");
    mockedUseGameSocket.mockReturnValue({
      state: { ...baseState, phase: "waiting_for_captain_b" },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      dismissError: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/waiting for captain b/i)).toBeInTheDocument();
  });

  it("shows the join link for captain A while waiting for captain B", () => {
    sessionLib.saveCaptainSession(
      "game-1",
      "token-a",
      "A",
      "https://example.com/game/game-1/join?t=token-b",
    );
    mockedUseGameSocket.mockReturnValue({
      state: { ...baseState, phase: "waiting_for_captain_b" },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      dismissError: vi.fn(),
    });

    renderPage();

    expect(screen.getByLabelText(/join link/i)).toHaveValue(
      "https://example.com/game/game-1/join?t=token-b",
    );
  });

  it("renders the bidding view for an active round when phase is in_progress", () => {
    sessionLib.saveCaptainSession("game-1", "token-a", "A");
    mockedUseGameSocket.mockReturnValue({
      state: {
        ...baseState,
        phase: "in_progress",
        round: {
          roundNumber: 1,
          playerId: "p1",
          name: "Alex Keeper",
          position: "GK",
          club: null,
          nation: null,
          imageUrl: null,
          firstBidder: "A",
          turn: "A",
          currentBid: null,
          currentBidder: null,
          subphase: "awaiting_opening_bid",
        },
      },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      dismissError: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Alex Keeper")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /place bid/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pass$/i })).toBeInTheDocument();
  });

  it("renders the results table when the game is completed", () => {
    sessionLib.saveCaptainSession("game-1", "token-a", "A");
    mockedUseGameSocket.mockReturnValue({
      state: {
        ...baseState,
        phase: "completed",
        squads: {
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
          ],
          B: [],
        },
      },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      dismissError: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Alex Keeper")).toBeInTheDocument();
    expect(screen.getAllByText(/total/i).length).toBe(2);
  });
});

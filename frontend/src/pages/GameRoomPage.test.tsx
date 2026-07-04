import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameRoomPage } from "./GameRoomPage";
import * as sessionLib from "../lib/session";
import * as useGameSocketHook from "../hooks/useGameSocket";
import * as gamesApi from "../lib/api/games";
import type { GameState } from "../../../src/shared/types";

vi.mock("../hooks/useGameSocket");
vi.mock("../lib/api/games");

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
  publishConsent: { A: false, B: false },
  publicSlug: null,
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
    requestPublish: vi.fn(),
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
      requestPublish: vi.fn(),
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
      requestPublish: vi.fn(),
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
      requestPublish: vi.fn(),
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
      requestPublish: vi.fn(),
      dismissError: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Alex Keeper")).toBeInTheDocument();
    expect(screen.getAllByText(/total/i).length).toBe(2);
  });

  it("shows a publish button when completed and not yet published", () => {
    sessionLib.saveCaptainSession("game-1", "token-a", "A");
    const requestPublish = vi.fn();
    mockedUseGameSocket.mockReturnValue({
      state: { ...baseState, phase: "completed" },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      requestPublish,
      dismissError: vi.fn(),
    });

    renderPage();

    const button = screen.getByRole("button", { name: /publish for public voting/i });
    button.click();
    expect(requestPublish).toHaveBeenCalledWith(undefined);
  });

  it("shows a waiting message once my captain has consented but the other hasn't", () => {
    sessionLib.saveCaptainSession("game-1", "token-a", "A");
    mockedUseGameSocket.mockReturnValue({
      state: { ...baseState, phase: "completed", publishConsent: { A: true, B: false } },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      requestPublish: vi.fn(),
      dismissError: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/waiting for .*to agree/i)).toBeInTheDocument();
  });

  it("shows the public showcase link once both captains have published", () => {
    sessionLib.saveCaptainSession("game-1", "token-a", "A");
    mockedUseGameSocket.mockReturnValue({
      state: {
        ...baseState,
        phase: "completed",
        publishConsent: { A: true, B: true },
        publicSlug: "swift-otter",
      },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      requestPublish: vi.fn(),
      dismissError: vi.fn(),
    });

    renderPage();

    expect(screen.getByDisplayValue(/\/showcase\/swift-otter$/)).toBeInTheDocument();
  });

  it("creates a new game and navigates to it when the rematch button is clicked", async () => {
    sessionLib.saveCaptainSession("game-1", "token-a", "A");
    vi.mocked(gamesApi.createGame).mockResolvedValue({
      gameId: "game-2",
      captainAToken: "token-a2",
      joinUrlForB: "https://example.com/game/game-2/join?t=token-b2",
    });
    mockedUseGameSocket.mockReturnValue({
      state: { ...baseState, phase: "completed" },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      requestPublish: vi.fn(),
      dismissError: vi.fn(),
    });

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /rematch/i }));

    await waitFor(() => expect(gamesApi.createGame).toHaveBeenCalled());
    await waitFor(() => expect(sessionLib.getCaptainSession("game-2")?.token).toBe("token-a2"));
  });

  it("shows a rivalry line once this is not the first draft with the same co-captain", () => {
    sessionLib.saveCaptainSession("game-1", "token-a", "A");
    mockedUseGameSocket.mockReturnValue({
      state: { ...baseState, phase: "completed", captainNames: { A: "Sami", B: "Alex" } },
      error: null,
      connected: true,
      proposeNextPlayer: vi.fn(),
      placeBid: vi.fn(),
      pass: vi.fn(),
      chatMessages: [],
      sendChat: vi.fn(),
      requestPublish: vi.fn(),
      dismissError: vi.fn(),
    });
    localStorage.setItem("fives:rivalry:alex", JSON.stringify({ played: 2 }));

    renderPage();

    expect(screen.getByText(/draft #3 between you and alex/i)).toBeInTheDocument();
  });
});

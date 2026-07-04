import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PublicSquadPage } from "./PublicSquadPage";
import * as gamesApi from "../lib/api/games";
import * as voterLib from "../lib/voter";
import type { PublicGameSummary } from "../lib/api/games";

vi.mock("../lib/api/games");
vi.mock("../lib/voter");

const mockedGetPublicGame = vi.mocked(gamesApi.getPublicGame);
const mockedVoteOnPublicGame = vi.mocked(gamesApi.voteOnPublicGame);
const mockedGetVoterId = vi.mocked(voterLib.getVoterId);
const mockedHasVoted = vi.mocked(voterLib.hasVoted);
const mockedMarkVoted = vi.mocked(voterLib.markVoted);

function renderPage(slug = "swift-otter") {
  return render(
    <MemoryRouter initialEntries={[`/showcase/${slug}`]}>
      <Routes>
        <Route path="/showcase/:slug" element={<PublicSquadPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseSummary: PublicGameSummary = {
  gameId: "game-1",
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
  votingClosesAt: Date.now() + 60 * 60 * 1000,
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  tallies: { A: 0, B: 0 },
};

beforeEach(() => {
  vi.resetAllMocks();
  mockedGetVoterId.mockReturnValue("voter-1");
  mockedHasVoted.mockReturnValue(false);
});

describe("PublicSquadPage", () => {
  it("shows a loading state before data arrives", () => {
    mockedGetPublicGame.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an unavailable message when the game can't be found", async () => {
    mockedGetPublicGame.mockRejectedValue(new Error("Not found"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/isn't available/i)).toBeInTheDocument());
  });

  it("renders both squads and vote buttons once loaded", async () => {
    mockedGetPublicGame.mockResolvedValue(baseSummary);
    renderPage();

    await waitFor(() => expect(screen.getByText("Alex Keeper")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^vote squad a$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^vote squad b$/i })).toBeInTheDocument();
  });

  it("casts a vote, disables further voting, and shows updated tallies", async () => {
    mockedGetPublicGame.mockResolvedValue(baseSummary);
    mockedVoteOnPublicGame.mockResolvedValue({ tallies: { A: 1, B: 0 } });
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /^vote squad a$/i })).toBeInTheDocument());
    await act(async () => {
      screen.getByRole("button", { name: /^vote squad a$/i }).click();
    });

    expect(mockedVoteOnPublicGame).toHaveBeenCalledWith("swift-otter", "A", "voter-1");
    expect(mockedMarkVoted).toHaveBeenCalledWith("swift-otter");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^vote squad a$/i })).not.toBeInTheDocument();
    });
  });

  it("disables voting and shows results when this browser has already voted", async () => {
    mockedGetPublicGame.mockResolvedValue(baseSummary);
    mockedHasVoted.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByText("Alex Keeper")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^vote squad a$/i })).not.toBeInTheDocument();
  });

  it("disables voting once the voting window has closed", async () => {
    mockedGetPublicGame.mockResolvedValue({
      ...baseSummary,
      votingClosesAt: Date.now() - 1000,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Alex Keeper")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^vote squad a$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/voting.*closed/i)).toBeInTheDocument();
  });
});

import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PublicFeedPage } from "./PublicFeedPage";
import * as gamesApi from "../lib/api/games";
import * as voterLib from "../lib/voter";
import type { PublicFeedEntry } from "../lib/api/games";

vi.mock("../lib/api/games");
vi.mock("../lib/voter");

const mockedGetPublicGamesFeed = vi.mocked(gamesApi.getPublicGamesFeed);
const mockedVoteOnPublicGame = vi.mocked(gamesApi.voteOnPublicGame);
const mockedGetComments = vi.mocked(gamesApi.getComments);
const mockedGetVoterId = vi.mocked(voterLib.getVoterId);
const mockedHasVoted = vi.mocked(voterLib.hasVoted);
const mockedMarkVoted = vi.mocked(voterLib.markVoted);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/showcase"]}>
      <PublicFeedPage />
    </MemoryRouter>,
  );
}

const entries: PublicFeedEntry[] = [
  {
    gameId: "game-1",
    publicSlug: "swift-otter",
    votingClosesAt: Date.now() + 60 * 60 * 1000,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    tallies: { A: 3, B: 1 },
  },
  {
    gameId: "game-2",
    publicSlug: "brave-fox",
    votingClosesAt: Date.now() - 1000,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    tallies: { A: 0, B: 0 },
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  mockedGetVoterId.mockReturnValue("voter-1");
  mockedHasVoted.mockReturnValue(false);
  mockedGetComments.mockResolvedValue([]);
});

describe("PublicFeedPage", () => {
  it("shows a loading state before data arrives", () => {
    mockedGetPublicGamesFeed.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an empty state when no games are published", async () => {
    mockedGetPublicGamesFeed.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/no.*published/i)).toBeInTheDocument());
  });

  it("shows only the first matchup's image and vote buttons directly, no link required", async () => {
    mockedGetPublicGamesFeed.mockResolvedValue(entries);
    renderPage();

    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/games/public/swift-otter/share/combined.png",
    );
    expect(screen.getByRole("button", { name: /^vote squad a$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^vote squad b$/i })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("disables the previous arrow on the first matchup and the next arrow on the last", async () => {
    mockedGetPublicGamesFeed.mockResolvedValue(entries);
    renderPage();

    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });

  it("navigates to the next/previous matchup via the arrow buttons", async () => {
    mockedGetPublicGamesFeed.mockResolvedValue(entries);
    renderPage();

    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    await act(async () => {
      screen.getByRole("button", { name: /next/i }).click();
    });

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/games/public/brave-fox/share/combined.png",
    );
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /previous/i })).not.toBeDisabled();

    await act(async () => {
      screen.getByRole("button", { name: /previous/i }).click();
    });
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/games/public/swift-otter/share/combined.png",
    );
  });

  it("casts a vote directly from the feed and disables further voting on that matchup", async () => {
    mockedGetPublicGamesFeed.mockResolvedValue(entries);
    mockedVoteOnPublicGame.mockResolvedValue({ tallies: { A: 4, B: 1 } });
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /^vote squad a$/i })).toBeInTheDocument());

    await act(async () => {
      screen.getByRole("button", { name: /^vote squad a$/i }).click();
    });

    expect(mockedVoteOnPublicGame).toHaveBeenCalledWith("swift-otter", "A", "voter-1");
    expect(mockedMarkVoted).toHaveBeenCalledWith("swift-otter");
    expect(screen.queryByRole("button", { name: /^vote squad a$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/4.*1|1.*4/)).toBeInTheDocument();
  });

  it("shows no vote buttons for a matchup whose voting window has closed", async () => {
    mockedGetPublicGamesFeed.mockResolvedValue(entries);
    renderPage();

    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    await act(async () => {
      screen.getByRole("button", { name: /next/i }).click();
    });

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/games/public/brave-fox/share/combined.png",
    );
    expect(screen.queryByRole("button", { name: /^vote squad a$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/voting.*closed/i)).toBeInTheDocument();
  });

  it("shows comments scoped to the currently-viewed matchup and refetches when navigating", async () => {
    mockedGetPublicGamesFeed.mockResolvedValue(entries);
    mockedGetComments.mockImplementation((slug) =>
      Promise.resolve(
        slug === "swift-otter"
          ? [{ id: "c1", authorName: "Alice", text: "Squad A comment", createdAt: 1 }]
          : [{ id: "c2", authorName: "Bob", text: "Squad B comment", createdAt: 2 }],
      ),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("Squad A comment")).toBeInTheDocument());
    expect(mockedGetComments).toHaveBeenCalledWith("swift-otter");

    await act(async () => {
      screen.getByRole("button", { name: /next/i }).click();
    });

    await waitFor(() => expect(screen.getByText("Squad B comment")).toBeInTheDocument());
    expect(mockedGetComments).toHaveBeenCalledWith("brave-fox");
    expect(screen.queryByText("Squad A comment")).not.toBeInTheDocument();
  });
});

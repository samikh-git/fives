import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGame,
  getComments,
  getGame,
  getPublicGame,
  getPublicGamesFeed,
  postComment,
  voteOnPublicGame,
} from "./games";
import type { GameSummary, PublicComment, PublicFeedEntry, PublicGameSummary } from "./games";

describe("games api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to create a game and returns the created game info", async () => {
    const responseBody = {
      gameId: "game-1",
      captainAToken: "token-a",
      joinUrlForB: "https://example.com/game/game-1/join?t=token-b",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createGame();

    expect(fetchMock).toHaveBeenCalledWith("/api/games", { method: "POST" });
    expect(result).toEqual(responseBody);
  });

  it("posts selectedPlayerIds as a JSON body when creating a hand-picked game", async () => {
    const responseBody = {
      gameId: "game-1",
      captainAToken: "token-a",
      joinUrlForB: "https://example.com/game/game-1/join?t=token-b",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createGame({ selectedPlayerIds: ["p1", "p2"] });

    expect(fetchMock).toHaveBeenCalledWith("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedPlayerIds: ["p1", "p2"] }),
    });
  });

  it("posts filters as a JSON body when creating a filtered random pool", async () => {
    const responseBody = {
      gameId: "game-1",
      captainAToken: "token-a",
      joinUrlForB: "https://example.com/game/game-1/join?t=token-b",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createGame({ filters: { leagues: ["Premier League"] } });

    expect(fetchMock).toHaveBeenCalledWith("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: { leagues: ["Premier League"] } }),
    });
  });

  it("throws with the server error message when creation fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "not enough players in roster" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGame()).rejects.toThrow("not enough players in roster");
  });

  it("fetches a game summary by id", async () => {
    const summary: GameSummary = {
      gameId: "game-1",
      status: "in_progress",
      createdAt: 1,
      startedAt: 2,
      completedAt: null,
      result: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(summary),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getGame("game-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/games/game-1");
    expect(result).toEqual(summary);
  });

  it("fetches a published game's public showcase data by slug", async () => {
    const summary: PublicGameSummary = {
      gameId: "game-1",
      squads: { A: [], B: [] },
      votingClosesAt: 1000,
      expiresAt: 2000,
      tallies: { A: 0, B: 0 },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(summary),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPublicGame("swift-otter");

    expect(fetchMock).toHaveBeenCalledWith("/api/games/public/swift-otter");
    expect(result).toEqual(summary);
  });

  it("throws with the server error message when the public game is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPublicGame("does-not-exist")).rejects.toThrow("Not found");
  });

  it("posts a vote and returns updated tallies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tallies: { A: 2, B: 1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await voteOnPublicGame("swift-otter", "A", "voter-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/games/public/swift-otter/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "A", voterId: "voter-1" }),
    });
    expect(result).toEqual({ tallies: { A: 2, B: 1 } });
  });

  it("throws with the server error message when voting fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: () => Promise.resolve({ error: "Voting has closed for this game" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(voteOnPublicGame("swift-otter", "A", "voter-1")).rejects.toThrow(
      "Voting has closed for this game",
    );
  });

  it("fetches the public showcase feed", async () => {
    const entries: PublicFeedEntry[] = [
      {
        gameId: "game-1",
        publicSlug: "swift-otter",
        votingClosesAt: 1000,
        expiresAt: 2000,
        tallies: { A: 3, B: 1 },
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ games: entries }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPublicGamesFeed();

    expect(fetchMock).toHaveBeenCalledWith("/api/games/public");
    expect(result).toEqual(entries);
  });

  it("fetches comments for a published game", async () => {
    const comments: PublicComment[] = [
      { id: "c1", authorName: "Alice", text: "Great squad!", createdAt: 1000 },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ comments }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getComments("swift-otter");

    expect(fetchMock).toHaveBeenCalledWith("/api/games/public/swift-otter/comments");
    expect(result).toEqual(comments);
  });

  it("posts a named comment", async () => {
    const comment: PublicComment = { id: "c1", authorName: "Alice", text: "Great squad!", createdAt: 1000 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ comment }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postComment("swift-otter", { text: "Great squad!", authorName: "Alice" });

    expect(fetchMock).toHaveBeenCalledWith("/api/games/public/swift-otter/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Great squad!", anonymous: false, authorName: "Alice" }),
    });
    expect(result).toEqual(comment);
  });

  it("posts an anonymous comment without an authorName", async () => {
    const comment: PublicComment = { id: "c1", authorName: null, text: "Nice", createdAt: 1000 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ comment }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await postComment("swift-otter", { text: "Nice", authorName: null });

    expect(fetchMock).toHaveBeenCalledWith("/api/games/public/swift-otter/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Nice", anonymous: true, authorName: undefined }),
    });
  });

  it("throws with the server error message when posting a comment fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Comment cannot be empty" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(postComment("swift-otter", { text: "", authorName: null })).rejects.toThrow(
      "Comment cannot be empty",
    );
  });
});

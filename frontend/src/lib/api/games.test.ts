import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGame, getGame } from "./games";
import type { GameSummary } from "./games";

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

    await createGame(["p1", "p2"]);

    expect(fetchMock).toHaveBeenCalledWith("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedPlayerIds: ["p1", "p2"] }),
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
});

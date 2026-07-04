import { beforeEach, describe, expect, it } from "vitest";
import { getRivalry, recordGamePlayedOnce } from "./rivalry";

beforeEach(() => {
  localStorage.clear();
});

describe("rivalry", () => {
  it("starts at zero for an opponent never played before", () => {
    expect(getRivalry("Alex")).toEqual({ played: 0 });
  });

  it("returns zero when there is no opponent name", () => {
    expect(getRivalry(null)).toEqual({ played: 0 });
    expect(recordGamePlayedOnce("game-1", null)).toEqual({ played: 0 });
  });

  it("increments the count on first record for a game", () => {
    const result = recordGamePlayedOnce("game-1", "Alex");
    expect(result).toEqual({ played: 1 });
    expect(getRivalry("Alex")).toEqual({ played: 1 });
  });

  it("is idempotent per gameId: replays/reconnects don't double-count", () => {
    recordGamePlayedOnce("game-1", "Alex");
    recordGamePlayedOnce("game-1", "Alex");
    recordGamePlayedOnce("game-1", "Alex");

    expect(getRivalry("Alex")).toEqual({ played: 1 });
  });

  it("accumulates across different games with the same opponent", () => {
    recordGamePlayedOnce("game-1", "Alex");
    recordGamePlayedOnce("game-2", "Alex");

    expect(getRivalry("Alex")).toEqual({ played: 2 });
  });

  it("matches opponent names case-insensitively and trims whitespace", () => {
    recordGamePlayedOnce("game-1", "Alex");
    expect(getRivalry("  alex  ")).toEqual({ played: 1 });
  });

  it("tracks different opponents independently", () => {
    recordGamePlayedOnce("game-1", "Alex");
    recordGamePlayedOnce("game-2", "Sam");

    expect(getRivalry("Alex")).toEqual({ played: 1 });
    expect(getRivalry("Sam")).toEqual({ played: 1 });
  });
});

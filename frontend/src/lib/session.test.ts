import { beforeEach, describe, expect, it } from "vitest";
import { getCaptainSession, saveCaptainSession } from "./session";

describe("session", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a saved captain session", () => {
    saveCaptainSession("game-1", "token-abc", "A");

    expect(getCaptainSession("game-1")).toEqual({ token: "token-abc", role: "A" });
  });

  it("returns null when there is no session for the given gameId", () => {
    expect(getCaptainSession("unknown-game")).toBeNull();
  });

  it("keeps sessions for different gameIds independent", () => {
    saveCaptainSession("game-1", "token-a", "A");
    saveCaptainSession("game-2", "token-b", "B");

    expect(getCaptainSession("game-1")).toEqual({ token: "token-a", role: "A" });
    expect(getCaptainSession("game-2")).toEqual({ token: "token-b", role: "B" });
  });
});

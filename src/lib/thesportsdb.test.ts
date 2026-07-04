import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchLeagueTeams, fetchTeamPlayers, mapSportsDbPosition, resolveApiKey } from "./thesportsdb";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapSportsDbPosition", () => {
  it("maps TheSportsDB's free-text position strings to our Position enum", () => {
    expect(mapSportsDbPosition("Goalkeeper")).toBe("GK");
    expect(mapSportsDbPosition("Right-Back")).toBe("DEF");
    expect(mapSportsDbPosition("Centre-Back")).toBe("DEF");
    expect(mapSportsDbPosition("Defensive Midfield")).toBe("MID");
    expect(mapSportsDbPosition("Attacking Midfield")).toBe("MID");
    expect(mapSportsDbPosition("Right Winger")).toBe("ATT");
    expect(mapSportsDbPosition("Striker")).toBe("ATT");
  });

  it("returns null for non-playing roles or unrecognized strings", () => {
    expect(mapSportsDbPosition("Assistant Coach")).toBeNull();
    expect(mapSportsDbPosition("Manager")).toBeNull();
    expect(mapSportsDbPosition(null)).toBeNull();
    expect(mapSportsDbPosition(undefined)).toBeNull();
  });
});

describe("resolveApiKey", () => {
  it("falls back to the free-tier key when none is configured", () => {
    expect(resolveApiKey(undefined)).toBe("123");
    expect(resolveApiKey("")).toBe("123");
  });

  it("uses a configured key when present", () => {
    expect(resolveApiKey("my-premium-key")).toBe("my-premium-key");
  });
});

describe("fetchLeagueTeams", () => {
  it("maps the teams response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ teams: [{ idTeam: "133604", strTeam: "Arsenal" }] }),
          { status: 200 },
        ),
      ),
    );

    const teams = await fetchLeagueTeams("123", "English Premier League");
    expect(teams).toEqual([{ externalId: "133604", name: "Arsenal" }]);
  });

  it("returns an empty array when the league has no teams", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ teams: null }), { status: 200 })));

    const teams = await fetchLeagueTeams("123", "Not A Real League");
    expect(teams).toEqual([]);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));

    await expect(fetchLeagueTeams("123", "English Premier League")).rejects.toThrow(/thesportsdb request failed/);
  });
});

describe("fetchTeamPlayers", () => {
  it("maps players, preferring strCutout over strThumb for the image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            player: [
              {
                idPlayer: "1",
                strPlayer: "David Raya",
                strTeam: "Arsenal",
                strNationality: "Spain",
                strPosition: "Goalkeeper",
                strCutout: "https://example.com/cutout.png",
                strThumb: "https://example.com/thumb.jpg",
              },
              {
                idPlayer: "2",
                strPlayer: "Some Coach",
                strTeam: "Arsenal",
                strNationality: "England",
                strPosition: "Assistant Coach",
                strCutout: null,
                strThumb: "https://example.com/coach-thumb.jpg",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const players = await fetchTeamPlayers("123", { externalId: "133604", name: "Arsenal" }, "English Premier League");

    expect(players).toEqual([
      {
        externalId: "1",
        name: "David Raya",
        position: "GK",
        club: "Arsenal",
        nation: "Spain",
        league: "English Premier League",
        imageUrl: "https://example.com/cutout.png",
      },
      {
        externalId: "2",
        name: "Some Coach",
        position: null,
        club: "Arsenal",
        nation: "England",
        league: "English Premier League",
        imageUrl: "https://example.com/coach-thumb.jpg",
      },
    ]);
  });
});

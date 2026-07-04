import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import schema from "../db/schema.sql?raw";
import { playersRouter } from "./players";
import { getPlayerById } from "../db/queries";
import type { Player } from "../shared/types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    PLAYER_IMAGES: R2Bucket;
  }
}

beforeAll(async () => {
  const statements = (schema as string)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

describe("playersRouter", () => {
  it("creates a player then returns it from the list", async () => {
    const createRes = await playersRouter.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alex Keeper", position: "GK" }),
      },
      env,
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Player;
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Alex Keeper");
    expect(created.position).toBe("GK");
    expect(created.archivedAt).toBeNull();

    const listRes = await playersRouter.request("/", {}, env);
    expect(listRes.status).toBe(200);
    const players = (await listRes.json()) as Player[];
    expect(players.some((p) => p.id === created.id)).toBe(true);
  });

  it("edits a player's name and position", async () => {
    const createRes = await playersRouter.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Old Name", position: "DEF" }),
      },
      env,
    );
    const created = (await createRes.json()) as Player;

    const patchRes = await playersRouter.request(
      `/${created.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name", position: "MID" }),
      },
      env,
    );
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as Player;
    expect(updated.name).toBe("New Name");
    expect(updated.position).toBe("MID");
  });

  it("soft-deletes a player: disappears from the default list but is still findable by id", async () => {
    const createRes = await playersRouter.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "To Archive", position: "ATT" }),
      },
      env,
    );
    const created = (await createRes.json()) as Player;

    const deleteRes = await playersRouter.request(`/${created.id}`, { method: "DELETE" }, env);
    expect(deleteRes.status).toBe(200);

    const listRes = await playersRouter.request("/", {}, env);
    const players = (await listRes.json()) as Player[];
    expect(players.some((p) => p.id === created.id)).toBe(false);

    const stillThere = await getPlayerById(env.DB, created.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.archivedAt).not.toBeNull();
  });

  it("rejects an invalid position with a 400", async () => {
    const res = await playersRouter.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bad Position", position: "STRIKER" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  describe("POST /import", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubSportsDbFetch(teamPlayers: Record<string, unknown[]>) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((input: URL | string) => {
          const url = String(input);
          if (url.includes("search_all_teams.php")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  teams: Object.keys(teamPlayers).map((teamId) => ({ idTeam: teamId, strTeam: `Team ${teamId}` })),
                }),
                { status: 200 },
              ),
            );
          }
          if (url.includes("lookup_all_players.php")) {
            const teamId = new URL(url).searchParams.get("id") as string;
            return Promise.resolve(
              new Response(JSON.stringify({ player: teamPlayers[teamId] ?? [] }), { status: 200 }),
            );
          }
          throw new Error(`unexpected fetch: ${url}`);
        }),
      );
    }

    it("imports a league from TheSportsDB, tagged with club/nation/league/image", async () => {
      stubSportsDbFetch({
        "1": [
          {
            idPlayer: "999",
            strPlayer: "Test Striker",
            strTeam: "Team 1",
            strNationality: "England",
            strPosition: "Striker",
            strCutout: "https://example.com/cutout.png",
            strThumb: null,
          },
          {
            idPlayer: "998",
            strPlayer: "Test Coach",
            strTeam: "Team 1",
            strNationality: "England",
            strPosition: "Assistant Coach",
            strCutout: null,
            strThumb: null,
          },
        ],
      });

      const res = await playersRouter.request(
        "/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ league: "Premier League" }),
        },
        env,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { teams: number; created: number; updated: number; skipped: string[] };
      expect(body.teams).toBe(1);
      expect(body.created).toBe(1);
      expect(body.updated).toBe(0);
      expect(body.skipped).toEqual(["Test Coach"]);

      const listRes = await playersRouter.request("/", {}, env);
      const players = (await listRes.json()) as Player[];
      const imported = players.find((p) => p.name === "Test Striker");
      expect(imported).toMatchObject({
        position: "ATT",
        club: "Team 1",
        nation: "England",
        league: "Premier League",
        imageUrl: "https://example.com/cutout.png",
      });
    });

    it("re-running an import updates the existing player instead of duplicating", async () => {
      stubSportsDbFetch({
        "2": [
          {
            idPlayer: "997",
            strPlayer: "Transferred Player",
            strTeam: "Old Club",
            strNationality: "Spain",
            strPosition: "Midfielder",
            strCutout: null,
            strThumb: null,
          },
        ],
      });

      const importOnce = () =>
        playersRouter.request(
          "/import",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ league: "Premier League" }),
          },
          env,
        );

      const first = await importOnce();
      expect(((await first.json()) as { created: number }).created).toBe(1);

      stubSportsDbFetch({
        "2": [
          {
            idPlayer: "997",
            strPlayer: "Transferred Player",
            strTeam: "New Club",
            strNationality: "Spain",
            strPosition: "Midfielder",
            strCutout: null,
            strThumb: null,
          },
        ],
      });

      const second = await importOnce();
      const secondBody = (await second.json()) as { created: number; updated: number };
      expect(secondBody.created).toBe(0);
      expect(secondBody.updated).toBe(1);

      const listRes = await playersRouter.request("/", {}, env);
      const players = (await listRes.json()) as Player[];
      const matches = players.filter((p) => p.name === "Transferred Player");
      expect(matches).toHaveLength(1);
      expect(matches[0]?.club).toBe("New Club");
    });

    it("rejects a missing league with a 400", async () => {
      const res = await playersRouter.request(
        "/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        env,
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 when the league has no teams", async () => {
      stubSportsDbFetch({});

      const res = await playersRouter.request(
        "/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ league: "Not A Real League" }),
        },
        env,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("image upload", () => {
    it("uploads an image and serves it back from the returned url", async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], "photo.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("image", file);

      const uploadRes = await playersRouter.request("/images", { method: "POST", body: formData }, env);
      expect(uploadRes.status).toBe(201);
      const { url } = (await uploadRes.json()) as { url: string };
      expect(url).toMatch(/^\/api\/players\/images\/players\/.+\.png$/);

      const path = url.replace("/api/players", "");
      const getRes = await playersRouter.request(path, {}, env);
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("content-type")).toBe("image/png");
      const bytes = new Uint8Array(await getRes.arrayBuffer());
      expect([...bytes]).toEqual([1, 2, 3, 4]);
    });

    it("rejects a non-image file", async () => {
      const file = new File(["hello"], "notes.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("image", file);

      const res = await playersRouter.request("/images", { method: "POST", body: formData }, env);
      expect(res.status).toBe(400);
    });

    it("404s for an unknown image key", async () => {
      const res = await playersRouter.request("/images/players/does-not-exist.png", {}, env);
      expect(res.status).toBe(404);
    });

    it("creates a player with a manually supplied imageUrl", async () => {
      const res = await playersRouter.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Manual Photo", position: "DEF", imageUrl: "/api/players/images/players/x.png" }),
        },
        env,
      );
      expect(res.status).toBe(201);
      const created = (await res.json()) as Player;
      expect(created.imageUrl).toBe("/api/players/images/players/x.png");
    });
  });
});

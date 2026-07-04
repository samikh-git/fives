import { describe, expect, it, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import schema from "./schema.sql?raw";
import { createPlayer, listPlayers, getPlayerById, updatePlayer, archivePlayer } from "./queries";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
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

describe("player queries", () => {
  it("createPlayer inserts a player with a generated id and no archivedAt", async () => {
    const player = await createPlayer(env.DB, { name: "Alex Keeper", position: "GK" });

    expect(player.id).toBeTruthy();
    expect(player.name).toBe("Alex Keeper");
    expect(player.position).toBe("GK");
    expect(player.archivedAt).toBeNull();

    const fetched = await getPlayerById(env.DB, player.id);
    expect(fetched).toEqual(player);
  });

  it("listPlayers only returns non-archived players by default", async () => {
    const active = await createPlayer(env.DB, { name: "Active Defender", position: "DEF" });
    const toArchive = await createPlayer(env.DB, { name: "Retired Midfielder", position: "MID" });
    await archivePlayer(env.DB, toArchive.id);

    const listed = await listPlayers(env.DB);
    const ids = listed.map((p) => p.id);

    expect(ids).toContain(active.id);
    expect(ids).not.toContain(toArchive.id);
  });

  it("updatePlayer changes name and position", async () => {
    const player = await createPlayer(env.DB, { name: "Old Name", position: "ATT" });
    const updated = await updatePlayer(env.DB, player.id, { name: "New Name", position: "MID" });

    expect(updated?.name).toBe("New Name");
    expect(updated?.position).toBe("MID");

    const fetched = await getPlayerById(env.DB, player.id);
    expect(fetched?.name).toBe("New Name");
    expect(fetched?.position).toBe("MID");
  });

  it("archivePlayer sets archivedAt but the player is still fetchable by id", async () => {
    const player = await createPlayer(env.DB, { name: "To Archive", position: "GK" });
    const archived = await archivePlayer(env.DB, player.id);

    expect(archived?.archivedAt).not.toBeNull();

    const fetched = await getPlayerById(env.DB, player.id);
    expect(fetched?.archivedAt).not.toBeNull();
  });

  it("getPlayerById returns null for an unknown id", async () => {
    const fetched = await getPlayerById(env.DB, "does-not-exist");
    expect(fetched).toBeNull();
  });
});

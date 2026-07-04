import { describe, expect, it, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import schema from "../db/schema.sql?raw";
import { playersRouter } from "./players";
import { playersAdminRouter } from "./players-admin";
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
  it("lists players created via the admin router", async () => {
    const createRes = await playersAdminRouter.request(
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

    const listRes = await playersRouter.request("/", {}, env);
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as { players: Player[]; total: number };
    expect(body.players.some((p) => p.id === created.id)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  describe("pagination", () => {
    it("pages results with limit/offset and reports the total count", async () => {
      for (let i = 0; i < 5; i++) {
        await playersAdminRouter.request(
          "/",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `Pagination Player ${i}`, position: "MID" }),
          },
          env,
        );
      }

      const firstRes = await playersRouter.request("/?limit=2&offset=0", {}, env);
      const firstBody = (await firstRes.json()) as { players: Player[]; total: number };
      expect(firstBody.players).toHaveLength(2);

      const secondRes = await playersRouter.request("/?limit=2&offset=2", {}, env);
      const secondBody = (await secondRes.json()) as { players: Player[]; total: number };
      expect(secondBody.players).toHaveLength(2);

      expect(firstBody.players.map((p) => p.id)).not.toEqual(secondBody.players.map((p) => p.id));
      expect(firstBody.total).toBe(secondBody.total);
    });

    it("rejects an out-of-range limit with a 400", async () => {
      const res = await playersRouter.request("/?limit=0", {}, env);
      expect(res.status).toBe(400);
    });

    it("rejects a negative offset with a 400", async () => {
      const res = await playersRouter.request("/?offset=-1", {}, env);
      expect(res.status).toBe(400);
    });
  });

  describe("image serving", () => {
    it("serves an image uploaded via the admin router", async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], "photo.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("image", file);

      const uploadRes = await playersAdminRouter.request("/images", { method: "POST", body: formData }, env);
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

    it("404s for an unknown image key", async () => {
      const res = await playersRouter.request("/images/players/does-not-exist.png", {}, env);
      expect(res.status).toBe(404);
    });
  });
});

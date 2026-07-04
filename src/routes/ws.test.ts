import { describe, expect, it, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import schema from "../db/schema.sql?raw";
import { wsRouter } from "./ws";
import { GameRoom, type InitParams } from "../durable-objects/game-room";
import type { Position } from "../shared/types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    GAME_ROOM: DurableObjectNamespace<GameRoom>;
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

function buildInitParams(gameId: string): InitParams {
  const positions: Position[] = ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"];
  return {
    gameId,
    pool: positions.map((position, i) => ({
      playerId: `p${i}`,
      name: `Player ${i}`,
      position,
      club: null,
      nation: null,
      imageUrl: null,
    })),
    captainAToken: "token-a",
    captainBToken: "token-b",
    firstBidder: "A",
  };
}

describe("GET /ws/:id", () => {
  it("forwards the upgrade request through to the GameRoom DO for a valid token", async () => {
    const gameId = `ws-game-${Math.random()}`;
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));
    await stub.init(buildInitParams(gameId));

    const res = await wsRouter.request(
      `/${gameId}?token=token-a`,
      { headers: { Upgrade: "websocket" } },
      env,
    );

    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
  });
});

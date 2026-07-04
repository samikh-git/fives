import { Hono } from "hono";
import type { Env } from "../index";

/**
 * Forwards WebSocket upgrade requests straight through to the game's GameRoom DO.
 * The DO's own `fetch()` handles the Upgrade handshake, validates the `?token=`
 * query param against the captain tokens it was initialized with, and (via the
 * Hibernation API) accepts the socket itself. This router does no game logic.
 */
export const wsRouter = new Hono<{ Bindings: Env }>();

wsRouter.get("/:id", async (c) => {
  const gameId = c.req.param("id");
  const stub = c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(gameId));
  return stub.fetch(c.req.raw);
});

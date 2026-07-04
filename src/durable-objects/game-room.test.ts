import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import schema from "../db/schema.sql?raw";
import { GameRoom, type InitParams, type InitPoolEntry } from "./game-room";
import { MIN_BID_INCREMENT, STARTING_BUDGET } from "../shared/constants";
import type { Captain, Position } from "../shared/types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    GAME_ROOM: DurableObjectNamespace<GameRoom>;
  }
}

function buildPool(): InitPoolEntry[] {
  const positions: Position[] = ["GK", "GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"];
  return positions.map((position, i) => ({
    playerId: `p${i}`,
    name: `Player ${i}`,
    position,
    club: null,
    nation: null,
    imageUrl: null,
  }));
}

function makeInitParams(overrides?: Partial<InitParams>): InitParams {
  return {
    gameId: "game-1",
    pool: buildPool(),
    captainAToken: "token-a",
    captainBToken: "token-b",
    firstBidder: "A",
    ...overrides,
  };
}

async function insertPlayersAndGame(gameId: string, pool: InitPoolEntry[]) {
  for (const entry of pool) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO players (id, name, position, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(entry.playerId, entry.name, entry.position, Date.now())
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO games (id, status, captain_a_token, captain_b_token, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(gameId, "in_progress", "token-a", "token-b", Date.now())
    .run();
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

let counter = 0;
function freshStub() {
  counter += 1;
  const id = env.GAME_ROOM.idFromName(`room-${counter}-${Math.random()}`);
  return env.GAME_ROOM.get(id);
}

describe("GameRoom.init", () => {
  it("sets up pool, budgets, phase and firstBidder from the given params", async () => {
    const stub = freshStub();
    const state = await stub.init(makeInitParams());

    expect(state.phase).toBe("waiting_for_captain_b");
    expect(state.pool).toHaveLength(10);
    expect(state.pool.map((p) => p.proposalOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(state.pool.every((p) => p.status === "pending")).toBe(true);
    expect(state.budgets).toEqual({ A: STARTING_BUDGET, B: STARTING_BUDGET });
    expect(state.squadCounts).toEqual({ A: 0, B: 0 });
    expect(state.squads).toEqual({ A: [], B: [] });
    expect(state.lastRoundFirstBidder).toBeNull();
    expect(state.round).toBeNull();
    expect(state.captainAConnected).toBe(false);
    expect(state.captainBConnected).toBe(false);
  });
});

describe("GameRoom.setCaptainName", () => {
  it("sets one captain's name without affecting the other's", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const state = await stub.setCaptainName("A", "Jamie");
    expect(state.captainNames).toEqual({ A: "Jamie", B: null });

    const state2 = await stub.setCaptainName("B", "Alex");
    expect(state2.captainNames).toEqual({ A: "Jamie", B: "Alex" });
  });

  it("strips markup, trims, and truncates an overlong name", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const overlong = "<b>Jamie</b>" + " the Great".repeat(10);
    const state = await stub.setCaptainName("A", overlong);
    expect(state.captainNames.A).not.toBeNull();
    expect(state.captainNames.A).not.toContain("<");
    expect(state.captainNames.A!.length).toBeLessThanOrEqual(40);
  });

  it("ignores a profane name, leaving the captain unnamed", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const state = await stub.setCaptainName("A", "you are a bitch");
    expect(state.captainNames.A).toBeNull();
  });

  it("ignores a blank/whitespace-only name", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const state = await stub.setCaptainName("A", "   ");
    expect(state.captainNames.A).toBeNull();
  });
});

describe("GameRoom.handleCaptainConnected", () => {
  it("does not start the game when only captain A connects", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const state = await stub.handleCaptainConnected("A");
    expect(state.phase).toBe("waiting_for_captain_b");
    expect(state.captainAConnected).toBe(true);
    expect(state.captainBConnected).toBe(false);
  });

  it("transitions to in_progress only once both captains have connected", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    await stub.handleCaptainConnected("A");
    const state = await stub.handleCaptainConnected("B");

    expect(state.phase).toBe("in_progress");
    expect(state.captainAConnected).toBe(true);
    expect(state.captainBConnected).toBe(true);
  });
});

describe("GameRoom.proposeNextPlayer", () => {
  async function startedStub() {
    const stub = freshStub();
    await stub.init(makeInitParams());
    await stub.handleCaptainConnected("A");
    await stub.handleCaptainConnected("B");
    return stub;
  }

  it("proposes pool entries in proposalOrder and alternates firstBidder across rounds", async () => {
    const stub = await startedStub();

    const r1 = await stub.proposeNextPlayer();
    if (!r1.ok) throw new Error("expected ok");
    expect(r1.state.round?.roundNumber).toBe(1);
    expect(r1.state.round?.playerId).toBe("p0");
    expect(r1.state.round?.firstBidder).toBe("A");
    expect(r1.state.round?.turn).toBe("A");
    expect(r1.state.round?.subphase).toBe("awaiting_opening_bid");

    await stub.placeBid("A", MIN_BID_INCREMENT);
    await stub.pass("B");

    const r2 = await stub.proposeNextPlayer();
    if (!r2.ok) throw new Error("expected ok");
    expect(r2.state.round?.playerId).toBe("p1");
    expect(r2.state.round?.firstBidder).toBe("B");

    await stub.placeBid("B", MIN_BID_INCREMENT);
    await stub.pass("A");

    const r3 = await stub.proposeNextPlayer();
    if (!r3.ok) throw new Error("expected ok");
    expect(r3.state.round?.playerId).toBe("p2");
    expect(r3.state.round?.firstBidder).toBe("A");
  });

  it("refuses to propose a new round while one is already active", async () => {
    const stub = await startedStub();
    await stub.proposeNextPlayer();

    const result = await stub.proposeNextPlayer();
    expect(result).toMatchObject({ ok: false, code: "WRONG_SUBPHASE" });
  });
});

describe("GameRoom.placeBid", () => {
  async function stubWithOpenRound() {
    const stub = freshStub();
    await stub.init(makeInitParams());
    await stub.handleCaptainConnected("A");
    await stub.handleCaptainConnected("B");
    await stub.proposeNextPlayer();
    return stub;
  }

  it("rejects a bid from the captain who is not on turn", async () => {
    const stub = await stubWithOpenRound();
    const result = await stub.placeBid("B", MIN_BID_INCREMENT);
    expect(result).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
  });

  it("rejects an opening bid that is not a multiple of the increment", async () => {
    const stub = await stubWithOpenRound();
    const result = await stub.placeBid("A", MIN_BID_INCREMENT + 1);
    expect(result).toMatchObject({ ok: false, code: "NOT_A_MULTIPLE_OF_INCREMENT" });
  });

  it("rejects a bid below the minimum increment floor", async () => {
    const stub = await stubWithOpenRound();
    const result = await stub.placeBid("A", 0);
    expect(result).toMatchObject({ ok: false, code: "BELOW_MIN_INCREMENT" });
  });

  it("rejects a bid exceeding the reserve-rule cap", async () => {
    const stub = await stubWithOpenRound();
    const wayTooMuch = STARTING_BUDGET; // leaves no room for 4 remaining slots
    const result = await stub.placeBid("A", wayTooMuch);
    expect(result).toMatchObject({ ok: false, code: "BID_EXCEEDS_RESERVE" });
  });

  it("accepts a legal opening bid, updates currentBid/currentBidder and flips turn", async () => {
    const stub = await stubWithOpenRound();
    const result = await stub.placeBid("A", MIN_BID_INCREMENT);
    if (!result.ok) throw new Error("expected ok");

    expect(result.state.round?.currentBid).toBe(MIN_BID_INCREMENT);
    expect(result.state.round?.currentBidder).toBe("A");
    expect(result.state.round?.turn).toBe("B");
    expect(result.state.round?.subphase).toBe("awaiting_response");
  });

  it("rejects a response bid that does not beat the current bid by a full increment", async () => {
    const stub = await stubWithOpenRound();
    await stub.placeBid("A", MIN_BID_INCREMENT);
    const result = await stub.placeBid("B", MIN_BID_INCREMENT + 1);
    expect(result).toMatchObject({ ok: false, code: "NOT_A_MULTIPLE_OF_INCREMENT" });
  });

  it("accepts a legal raise and flips turn back", async () => {
    const stub = await stubWithOpenRound();
    await stub.placeBid("A", MIN_BID_INCREMENT);
    const result = await stub.placeBid("B", MIN_BID_INCREMENT * 2);
    if (!result.ok) throw new Error("expected ok");

    expect(result.state.round?.currentBid).toBe(MIN_BID_INCREMENT * 2);
    expect(result.state.round?.currentBidder).toBe("B");
    expect(result.state.round?.turn).toBe("A");
  });
});

describe("GameRoom.pass", () => {
  async function stubWithOpenRound() {
    const stub = freshStub();
    await stub.init(makeInitParams());
    await stub.handleCaptainConnected("A");
    await stub.handleCaptainConnected("B");
    await stub.proposeNextPlayer();
    return stub;
  }

  it("rejects a pass during awaiting_opening_bid", async () => {
    const stub = await stubWithOpenRound();
    const result = await stub.pass("A");
    expect(result).toMatchObject({ ok: false, code: "PASS_NOT_ALLOWED_BEFORE_OPENING_BID" });
  });

  it("rejects a pass from the captain not on turn", async () => {
    const stub = await stubWithOpenRound();
    await stub.placeBid("A", MIN_BID_INCREMENT);
    const result = await stub.pass("A");
    expect(result).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
  });

  it("settles the round: winner gets the player at currentBid, budgets/squads update, round clears", async () => {
    const stub = await stubWithOpenRound();
    await stub.placeBid("A", MIN_BID_INCREMENT);
    await stub.placeBid("B", MIN_BID_INCREMENT * 2);

    const result = await stub.pass("A");
    if (!result.ok) throw new Error("expected ok");
    const state = result.state;

    expect(state.round).toBeNull();
    expect(state.budgets.B).toBe(STARTING_BUDGET - MIN_BID_INCREMENT * 2);
    expect(state.squadCounts.B).toBe(1);
    expect(state.squads.B).toHaveLength(1);
    expect(state.squads.B[0]).toMatchObject({ playerId: "p0", pricePaid: MIN_BID_INCREMENT * 2 });
    expect(state.pool.find((p) => p.playerId === "p0")?.status).toBe("sold");
    expect(state.lastRoundFirstBidder).toBe("A");
  });
});

describe("GameRoom full game completion", () => {
  it("plays all 10 rounds, reaches a 5-5 split, marks completed, and writes final results to D1", async () => {
    const gameId = `game-completion-${Math.random()}`;
    const pool = buildPool();
    await insertPlayersAndGame(gameId, pool);

    const stub = freshStub();
    await stub.init(makeInitParams({ gameId, pool }));
    await stub.handleCaptainConnected("A");
    await stub.handleCaptainConnected("B");

    // Every round's winner is always its firstBidder, and firstBidder alternates each
    // round, so one captain reaches SQUAD_SIZE after 9 rounds (5 wins to 4) - the 10th
    // player is auto-awarded to the other captain rather than played out as a round.
    let finalState = await stub.getState();
    for (let i = 0; i < 10 && finalState?.phase !== "completed"; i++) {
      const proposed = await stub.proposeNextPlayer();
      if (!proposed.ok) throw new Error("expected ok");
      const firstBidder = proposed.state.round!.firstBidder as Captain;
      const other = firstBidder === "A" ? "B" : "A";

      await stub.placeBid(firstBidder, MIN_BID_INCREMENT);
      const passed = await stub.pass(other);
      if (!passed.ok) throw new Error("expected ok");
      finalState = passed.state;
    }

    expect(finalState?.phase).toBe("completed");
    expect(finalState?.squadCounts).toEqual({ A: 5, B: 5 });

    const autoAwarded = (["A", "B"] as Captain[])
      .flatMap((captain) => finalState!.squads[captain])
      .find((entry) => entry.pricePaid === 0);
    expect(autoAwarded).toBeDefined();

    const gameRow = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(gameId).first<{
      status: string;
      completed_at: number | null;
    }>();
    expect(gameRow?.status).toBe("completed");
    expect(gameRow?.completed_at).not.toBeNull();

    const resultRows = await env.DB.prepare(
      "SELECT * FROM game_players WHERE game_id = ? ORDER BY round_number",
    )
      .bind(gameId)
      .all<{ player_id: string; captain: Captain; price_paid: number; round_number: number }>();

    expect(resultRows.results).toHaveLength(10);

    // The D1 rows must exactly match the DO's own final squad state.
    const expectedRows = (["A", "B"] as Captain[]).flatMap((captain) =>
      finalState!.squads[captain].map((entry) => ({
        game_id: gameId,
        player_id: entry.playerId,
        captain,
        price_paid: entry.pricePaid,
        round_number: entry.roundNumber,
      })),
    );
    const sortByRound = <T extends { round_number: number }>(rows: T[]) =>
      [...rows].sort((a, b) => a.round_number - b.round_number);

    expect(sortByRound(resultRows.results)).toEqual(sortByRound(expectedRows));
  });
});

describe("GameRoom persistence / hibernation safety", () => {
  it("persists state via sql.exec such that a fresh getState() call reflects the latest write", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());
    await stub.handleCaptainConnected("A");
    await stub.handleCaptainConnected("B");
    await stub.proposeNextPlayer();
    await stub.placeBid("A", MIN_BID_INCREMENT);

    // Read back directly from the DO's own SQLite storage, independent of any
    // in-memory field, proving the write was durable.
    await runInDurableObject(stub, async (instance, state) => {
      const rows = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM state WHERE id = 0")
        .toArray();
      expect(rows).toHaveLength(1);
      const persisted = JSON.parse(rows[0]!.data);
      expect(persisted.round.currentBid).toBe(MIN_BID_INCREMENT);
      expect(persisted.round.currentBidder).toBe("A");
    });

    // A brand new call against the same stub (simulating a reload) reads the same data.
    const reloaded = await stub.getState();
    expect(reloaded?.round?.currentBid).toBe(MIN_BID_INCREMENT);
    expect(reloaded?.round?.currentBidder).toBe("A");
  });
});

describe("GameRoom WebSocket wiring (smoke test)", () => {
  it("upgrades a WS connection with a valid token and broadcasts state on join", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const resp = await stub.fetch("https://example.com/ws?token=token-a", {
      headers: { Upgrade: "websocket" },
    });

    expect(resp.status).toBe(101);
    const client = resp.webSocket;
    expect(client).toBeTruthy();
    client!.accept();

    const received: unknown[] = [];
    await new Promise<void>((resolve) => {
      client!.addEventListener("message", (event: MessageEvent) => {
        received.push(JSON.parse(event.data as string));
        resolve();
      });
    });

    expect(received.length).toBeGreaterThan(0);

    const state = await stub.getState();
    expect(state?.captainAConnected).toBe(true);
  });

  it("records a captain's display name from the ?name= query param on connect", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const resp = await stub.fetch("https://example.com/ws?token=token-a&name=Jamie", {
      headers: { Upgrade: "websocket" },
    });
    resp.webSocket!.accept();

    const state = await stub.getState();
    expect(state?.captainNames).toEqual({ A: "Jamie", B: null });
  });

  // A live fetch()-upgrade attempt with a bad token is exercised as an actual HTTP
  // round trip in routes/ws.test.ts instead of here: returning a non-101 response to
  // a request carrying an `Upgrade: websocket` header trips a known isolated-storage
  // bookkeeping bug in `@cloudflare/vitest-pool-workers` when done from a direct
  // `stub.fetch()` call in a unit test. `getCaptainForToken` is the unit actually
  // responsible for the auth decision, so we cover it directly here instead.
  it("resolves no captain for an unrecognized token", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    expect(await stub.getCaptainForToken("not-a-real-token")).toBeNull();
    expect(await stub.getCaptainForToken("token-a")).toBe("A");
    expect(await stub.getCaptainForToken("token-b")).toBe("B");
  });
});

describe("GameRoom.sendChatMessage", () => {
  it("appends a trimmed chat entry authored by the given captain", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const result = await stub.sendChatMessage("A", "  hello there  ");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.captain).toBe("A");
    expect(result.state.text).toBe("hello there");
    expect(typeof result.state.id).toBe("string");
    expect(typeof result.state.ts).toBe("number");
  });

  it("rejects an empty or whitespace-only message", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const result = await stub.sendChatMessage("A", "   ");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("EMPTY_CHAT_MESSAGE");
  });

  it("sanitizes HTML out of the message before storing it", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const result = await stub.sendChatMessage("A", "<script>alert(1)</script>hi");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.text).toBe("alert(1)hi");
  });

  it("rejects a message that is only HTML tags once sanitized", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const result = await stub.sendChatMessage("A", "<b></b>");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("EMPTY_CHAT_MESSAGE");
  });

  it("rejects a message flagged as inappropriate", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const result = await stub.sendChatMessage("A", "you are a bitch");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INAPPROPRIATE_CHAT_MESSAGE");
  });

  it("truncates messages beyond the max length", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    const result = await stub.sendChatMessage("B", "x".repeat(600));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.text).toHaveLength(500);
  });

  it("caps stored chat history at 200 entries, dropping the oldest first", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    for (let i = 0; i < 201; i++) {
      await stub.sendChatMessage("A", `message ${i}`);
    }

    await runInDurableObject(stub, async (instance, state) => {
      const rows = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM state WHERE id = 0")
        .toArray();
      const persisted = JSON.parse(rows[0]!.data);
      expect(persisted.chatMessages).toHaveLength(200);
      expect(persisted.chatMessages[0].text).toBe("message 1");
      expect(persisted.chatMessages[199].text).toBe("message 200");
    });
  });
});

describe("GameRoom WebSocket chat wiring", () => {
  it("broadcasts chat_message to connected sockets and sends chat_history to a new connection", async () => {
    const stub = freshStub();
    await stub.init(makeInitParams());

    await stub.sendChatMessage("A", "earlier message");

    const resp = await stub.fetch("https://example.com/ws?token=token-b", {
      headers: { Upgrade: "websocket" },
    });
    const client = resp.webSocket!;
    client.accept();

    const messages: unknown[] = [];
    await new Promise<void>((resolve) => {
      client.addEventListener("message", (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string));
        if (messages.some((m) => (m as { type: string }).type === "chat_history")) resolve();
      });
    });

    const history = messages.find((m) => (m as { type: string }).type === "chat_history") as
      | { type: "chat_history"; entries: Array<{ text: string }> }
      | undefined;
    expect(history?.entries).toHaveLength(1);
    expect(history?.entries[0]?.text).toBe("earlier message");
  });
});

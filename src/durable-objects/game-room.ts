import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";
import {
  MAX_CAPTAIN_NAME_LENGTH,
  MAX_CHAT_MESSAGE_LENGTH,
  MIN_BID_INCREMENT,
  POOL_SIZE,
  SQUAD_SIZE,
  STARTING_BUDGET,
} from "../shared/constants";
import { computeMaxLegalBid, isLegalBid } from "../shared/rules";
import { sanitizeText } from "../shared/sanitize";
import { containsProfanity } from "../shared/moderation";
import type {
  Captain,
  GameState,
  Phase,
  Position,
  PoolEntry,
  RoundState,
  SquadEntry,
} from "../shared/types";
import { PING_PAYLOAD, PONG_PAYLOAD } from "../shared/protocol";
import type { ChatEntry, ClientMessage, ErrorCode } from "../shared/protocol";

/** Chat history is capped per game to bound the size of the persisted state blob. */
const MAX_CHAT_HISTORY = 200;

/**
 * Cleans a captain-supplied display name: strips markup/control characters, enforces
 * the max length, and drops names that are empty or flagged as profane (falling back
 * to the default "Captain A/B" label) rather than rejecting the connection outright -
 * there's no client round-trip to surface an error to at WebSocket-upgrade time.
 */
function sanitizeCaptainName(raw: string): string | null {
  const cleaned = sanitizeText(raw).trim().slice(0, MAX_CAPTAIN_NAME_LENGTH);
  if (!cleaned || containsProfanity(cleaned)) return null;
  return cleaned;
}

/**
 * Result of a state-mutating action. Actions report illegal moves by returning
 * `{ ok: false, code, message }` rather than throwing: thrown errors that cross the
 * Durable Object RPC boundary (stub method calls) confuse
 * `@cloudflare/vitest-pool-workers`'s isolated-storage bookkeeping in tests, and in
 * production would otherwise risk the request-handling exception paths DOs apply to
 * uncaught exceptions. A typed result keeps illegal-move handling ordinary control
 * flow for both callers and tests.
 */
export type ActionResult<T> = { ok: true; state: T } | { ok: false; code: ErrorCode; message: string };

function err(code: ErrorCode, message: string): ActionResult<never> {
  return { ok: false, code, message };
}

function ok<T>(state: T): ActionResult<T> {
  return { ok: true, state };
}

export interface InitPoolEntry {
  playerId: string;
  name: string;
  position: Position;
  club: string | null;
  nation: string | null;
  imageUrl: string | null;
}

export interface InitParams {
  gameId: string;
  pool: InitPoolEntry[];
  captainAToken: string;
  captainBToken: string;
  firstBidder: Captain;
}

/**
 * Full internal state persisted to the DO's own SQLite storage. A superset of the
 * public `GameState` broadcast to clients: it also carries the captain tokens (used
 * to authenticate incoming WebSocket connections) and the arbitrarily-chosen first
 * round's first bidder (round 1 has no "last round" to alternate from).
 */
interface InternalState {
  gameId: string;
  phase: Phase;
  captainAToken: string;
  captainBToken: string;
  captainAConnected: boolean;
  captainBConnected: boolean;
  captainNames: Record<Captain, string | null>;

  pool: PoolEntry[];
  nextProposalIndex: number;

  budgets: Record<Captain, number>;
  squadCounts: Record<Captain, number>;
  squads: Record<Captain, SquadEntry[]>;

  /** Decided once at game creation; used only to seed round 1's first bidder. */
  firstRoundFirstBidder: Captain;
  lastRoundFirstBidder: Captain | null;
  round: RoundState | null;

  /** Not part of the public GameState: chat is a side channel, broadcast/replayed separately. */
  chatMessages: ChatEntry[];
}

function otherCaptain(captain: Captain): Captain {
  return captain === "A" ? "B" : "A";
}

function toPublicState(state: InternalState): GameState {
  return {
    gameId: state.gameId,
    phase: state.phase,
    captainAConnected: state.captainAConnected,
    captainBConnected: state.captainBConnected,
    captainNames: state.captainNames,
    pool: state.pool,
    nextProposalIndex: state.nextProposalIndex,
    budgets: state.budgets,
    squadCounts: state.squadCounts,
    squads: state.squads,
    lastRoundFirstBidder: state.lastRoundFirstBidder,
    round: state.round,
  };
}

/**
 * The full game engine for one 2-captain draft. Core logic lives in plain methods
 * (init/handleCaptainConnected/proposeNextPlayer/placeBid/pass/getState) that are
 * callable both directly (RPC from routes, or `runInDurableObject` in tests) and
 * from the thin WebSocket layer below. Every mutation persists synchronously to the
 * DO's own SQLite storage (`this.ctx.storage.sql.exec`) with no async gap, so a
 * hibernation evict-and-reload cycle reconstructs identical state.
 */
export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 0), data TEXT NOT NULL)",
    );
    // Client heartbeat pings are answered by the platform directly, without
    // waking this (possibly hibernated) DO or reaching webSocketMessage.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_PAYLOAD, PONG_PAYLOAD));
  }

  // ---- persistence ----

  private loadState(): InternalState | null {
    const rows = this.ctx.storage.sql
      .exec<{ data: string }>("SELECT data FROM state WHERE id = 0")
      .toArray();
    const row = rows[0];
    if (!row) return null;
    return JSON.parse(row.data) as InternalState;
  }

  private saveState(state: InternalState): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO state (id, data) VALUES (0, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      JSON.stringify(state),
    );
  }

  private requireState(): InternalState {
    const state = this.loadState();
    if (!state) throw new Error("GameRoom has not been initialized yet");
    return state;
  }

  // ---- core game logic ----

  async init(params: InitParams): Promise<GameState> {
    if (params.pool.length !== POOL_SIZE) {
      throw new Error(`pool must have exactly ${POOL_SIZE} entries`);
    }

    const state: InternalState = {
      gameId: params.gameId,
      phase: "waiting_for_captain_b",
      captainAToken: params.captainAToken,
      captainBToken: params.captainBToken,
      captainAConnected: false,
      captainBConnected: false,
      captainNames: { A: null, B: null },
      pool: params.pool.map((entry, index) => ({
        playerId: entry.playerId,
        name: entry.name,
        position: entry.position,
        club: entry.club,
        nation: entry.nation,
        imageUrl: entry.imageUrl,
        proposalOrder: index,
        status: "pending" as const,
      })),
      nextProposalIndex: 0,
      budgets: { A: STARTING_BUDGET, B: STARTING_BUDGET },
      squadCounts: { A: 0, B: 0 },
      squads: { A: [], B: [] },
      firstRoundFirstBidder: params.firstBidder,
      lastRoundFirstBidder: null,
      round: null,
      chatMessages: [],
    };

    this.saveState(state);
    return toPublicState(state);
  }

  async handleCaptainConnected(captain: Captain): Promise<GameState> {
    const state = this.requireState();
    if (captain === "A") state.captainAConnected = true;
    else state.captainBConnected = true;

    if (
      state.captainAConnected &&
      state.captainBConnected &&
      state.phase === "waiting_for_captain_b"
    ) {
      state.phase = "in_progress";
      await this.env.DB.prepare("UPDATE games SET status = ?, started_at = ? WHERE id = ?")
        .bind("in_progress", Date.now(), state.gameId)
        .run();
    }

    this.saveState(state);
    return toPublicState(state);
  }

  /** Sets a captain's display name, shown in place of "Captain A/B" once populated. */
  async setCaptainName(captain: Captain, name: string): Promise<GameState> {
    const state = this.requireState();
    const cleaned = sanitizeCaptainName(name);
    if (cleaned) state.captainNames[captain] = cleaned;
    this.saveState(state);
    return toPublicState(state);
  }

  async getState(): Promise<GameState | null> {
    const state = this.loadState();
    return state ? toPublicState(state) : null;
  }

  /** Resolves a WS connection's captain identity from the query-string token, without exposing tokens elsewhere. */
  async getCaptainForToken(token: string): Promise<Captain | null> {
    const state = this.loadState();
    if (!state) return null;
    if (token === state.captainAToken) return "A";
    if (token === state.captainBToken) return "B";
    return null;
  }

  async proposeNextPlayer(): Promise<ActionResult<GameState>> {
    const state = this.requireState();

    if (state.phase !== "in_progress") {
      return err("NO_ACTIVE_ROUND", "Game is not in progress");
    }
    if (state.round !== null) {
      return err("WRONG_SUBPHASE", "A round is already in progress");
    }
    if (state.nextProposalIndex >= state.pool.length) {
      return err("NO_ACTIVE_ROUND", "No more players left to propose");
    }

    const entry = state.pool[state.nextProposalIndex];
    if (!entry) {
      return err("NO_ACTIVE_ROUND", "No more players left to propose");
    }
    const firstBidder =
      state.lastRoundFirstBidder === null
        ? state.firstRoundFirstBidder
        : otherCaptain(state.lastRoundFirstBidder);

    state.round = {
      roundNumber: state.nextProposalIndex + 1,
      playerId: entry.playerId,
      name: entry.name,
      position: entry.position,
      club: entry.club,
      nation: entry.nation,
      imageUrl: entry.imageUrl,
      firstBidder,
      turn: firstBidder,
      currentBid: null,
      currentBidder: null,
      subphase: "awaiting_opening_bid",
    };
    state.nextProposalIndex += 1;

    this.saveState(state);
    return ok(toPublicState(state));
  }

  async placeBid(captain: Captain, amount: number): Promise<ActionResult<GameState>> {
    const state = this.requireState();
    const round = state.round;
    if (!round) return err("NO_ACTIVE_ROUND", "No active round");
    if (round.turn !== captain) {
      return err("NOT_YOUR_TURN", "It is not your turn to bid");
    }

    const legal = isLegalBid({
      amount,
      currentBid: round.currentBid,
      budget: state.budgets[captain],
      squadCount: state.squadCounts[captain],
    });

    if (!legal) {
      if (amount % MIN_BID_INCREMENT !== 0) {
        return err(
          "NOT_A_MULTIPLE_OF_INCREMENT",
          `Bid must be a multiple of ${MIN_BID_INCREMENT}`,
        );
      }
      const maxLegal = computeMaxLegalBid(state.budgets[captain], state.squadCounts[captain]);
      if (amount > maxLegal) {
        return err(
          "BID_EXCEEDS_RESERVE",
          `Bid exceeds the maximum legal bid of ${maxLegal}`,
        );
      }
      return err(
        "BELOW_MIN_INCREMENT",
        "Bid does not beat the current bid by at least one increment",
      );
    }

    round.currentBid = amount;
    round.currentBidder = captain;
    round.subphase = "awaiting_response";
    round.turn = otherCaptain(captain);

    this.saveState(state);
    return ok(toPublicState(state));
  }

  async pass(captain: Captain): Promise<ActionResult<GameState>> {
    const state = this.requireState();
    const round = state.round;
    if (!round) return err("NO_ACTIVE_ROUND", "No active round");
    if (round.turn !== captain) {
      return err("NOT_YOUR_TURN", "It is not your turn");
    }
    if (round.subphase === "awaiting_opening_bid") {
      return err(
        "PASS_NOT_ALLOWED_BEFORE_OPENING_BID",
        "The first bidder must place an opening bid before anyone may pass",
      );
    }

    const winner = round.currentBidder as Captain;
    const price = round.currentBid as number;

    state.budgets[winner] -= price;
    state.squadCounts[winner] += 1;
    state.squads[winner].push({
      playerId: round.playerId,
      name: round.name,
      position: round.position,
      club: round.club,
      nation: round.nation,
      imageUrl: round.imageUrl,
      pricePaid: price,
      roundNumber: round.roundNumber,
    });

    const poolEntry = state.pool.find((p) => p.playerId === round.playerId);
    if (poolEntry) poolEntry.status = "sold";

    state.lastRoundFirstBidder = round.firstBidder;
    state.round = null;

    const completed = state.squadCounts.A === SQUAD_SIZE && state.squadCounts.B === SQUAD_SIZE;
    if (completed) state.phase = "completed";

    this.saveState(state);

    if (completed) {
      await this.persistFinalResultToD1(state);
    }

    return ok(toPublicState(state));
  }

  async sendChatMessage(captain: Captain, text: string): Promise<ActionResult<ChatEntry>> {
    const state = this.requireState();
    const trimmed = sanitizeText(text).trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
    if (!trimmed) {
      return err("EMPTY_CHAT_MESSAGE", "Chat message cannot be empty");
    }
    if (containsProfanity(trimmed)) {
      return err("INAPPROPRIATE_CHAT_MESSAGE", "Message flagged as inappropriate");
    }

    const entry: ChatEntry = {
      id: crypto.randomUUID(),
      captain,
      text: trimmed,
      ts: Date.now(),
    };

    state.chatMessages.push(entry);
    if (state.chatMessages.length > MAX_CHAT_HISTORY) {
      state.chatMessages.shift();
    }

    this.saveState(state);
    return ok(entry);
  }

  private async persistFinalResultToD1(state: InternalState): Promise<void> {
    const completedAt = Date.now();
    const statements = [
      this.env.DB.prepare("UPDATE games SET status = ?, completed_at = ? WHERE id = ?").bind(
        "completed",
        completedAt,
        state.gameId,
      ),
    ];

    for (const captain of ["A", "B"] as Captain[]) {
      for (const entry of state.squads[captain]) {
        statements.push(
          this.env.DB.prepare(
            "INSERT INTO game_players (game_id, player_id, captain, price_paid, round_number) VALUES (?, ?, ?, ?, ?)",
          ).bind(state.gameId, entry.playerId, captain, entry.pricePaid, entry.roundNumber),
        );
      }
    }

    await this.env.DB.batch(statements);
  }

  // ---- WebSocket layer (thin: delegates to the methods above) ----

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const rawName = url.searchParams.get("name");
    const name = rawName ? sanitizeCaptainName(rawName) : null;
    const state = this.loadState();
    if (!state) {
      return new Response("game not initialized", { status: 404 });
    }

    let captain: Captain | null = null;
    if (token === state.captainAToken) captain = "A";
    else if (token === state.captainBToken) captain = "B";
    if (!captain) {
      return new Response("invalid token", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.serializeAttachment({ captain });
    this.ctx.acceptWebSocket(server, [captain]);

    const wasInProgress = state.phase === "in_progress";
    if (captain === "A") state.captainAConnected = true;
    else state.captainBConnected = true;
    if (name) state.captainNames[captain] = name;
    if (
      state.captainAConnected &&
      state.captainBConnected &&
      state.phase === "waiting_for_captain_b"
    ) {
      state.phase = "in_progress";
    }
    this.saveState(state);

    this.broadcast({ type: "captain_joined", captain });
    if (!wasInProgress && state.phase === "in_progress") {
      this.broadcast({ type: "game_started" });
    }
    this.broadcast({ type: "state_snapshot", state: toPublicState(state) });
    server.send(JSON.stringify({ type: "chat_history", entries: state.chatMessages }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as { captain: Captain } | null;
    if (!attachment) return;
    const { captain } = attachment;

    let parsed: ClientMessage;
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      parsed = JSON.parse(text) as ClientMessage;
    } catch {
      this.sendError(ws, "NO_ACTIVE_ROUND", "Malformed message");
      return;
    }

    switch (parsed.type) {
      case "join": {
        const state = this.requireState();
        this.broadcast({ type: "state_snapshot", state: toPublicState(state) });
        break;
      }
      case "propose_next_player": {
        const result = await this.proposeNextPlayer();
        if (!result.ok) {
          this.sendError(ws, result.code, result.message);
          break;
        }
        if (result.state.round) {
          this.broadcast({
            type: "round_started",
            roundNumber: result.state.round.roundNumber,
            playerId: result.state.round.playerId,
            name: result.state.round.name,
            position: result.state.round.position,
            firstBidder: result.state.round.firstBidder,
          });
        }
        this.broadcast({ type: "state_snapshot", state: result.state });
        break;
      }
      case "place_bid": {
        const result = await this.placeBid(captain, parsed.amount);
        if (!result.ok) {
          this.sendError(ws, result.code, result.message);
          break;
        }
        this.broadcast({ type: "bid_placed", captain, amount: parsed.amount });
        this.broadcast({ type: "state_snapshot", state: result.state });
        break;
      }
      case "pass": {
        const before = this.requireState();
        const settledRound = before.round;
        const result = await this.pass(captain);
        if (!result.ok) {
          this.sendError(ws, result.code, result.message);
          break;
        }
        if (settledRound) {
          this.broadcast({
            type: "round_settled",
            playerId: settledRound.playerId,
            winner: settledRound.currentBidder as Captain,
            price: settledRound.currentBid as number,
          });
        }
        if (result.state.phase === "completed") {
          this.broadcast({ type: "game_completed", squads: result.state.squads });
        }
        this.broadcast({ type: "state_snapshot", state: result.state });
        break;
      }
      case "send_chat": {
        const result = await this.sendChatMessage(captain, parsed.text);
        if (!result.ok) {
          this.sendError(ws, result.code, result.message);
          break;
        }
        this.broadcast({ type: "chat_message", entry: result.state });
        break;
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    // Hibernation handles cleanup of the socket itself; connected-flags are left as-is
    // since a captain reconnecting (e.g. page refresh) should not reset game phase.
  }

  private broadcast(message: object): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(payload);
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
    ws.send(JSON.stringify({ type: "error", code, message }));
  }
}

import type { Captain, GameState, Position } from "./types";

// ---- Client -> DO ----

export interface JoinMessage {
  type: "join";
}

export interface ProposeNextPlayerMessage {
  type: "propose_next_player";
}

export interface PlaceBidMessage {
  type: "place_bid";
  amount: number;
}

export interface PassMessage {
  type: "pass";
}

export interface SendChatMessage {
  type: "send_chat";
  text: string;
}

export interface RequestPublishMessage {
  type: "request_publish";
  notifyEmail?: string;
}

export type ClientMessage =
  | JoinMessage
  | ProposeNextPlayerMessage
  | PlaceBidMessage
  | PassMessage
  | SendChatMessage
  | RequestPublishMessage;

/**
 * Fixed-string heartbeat payloads matched by the DO's `setWebSocketAutoResponse`
 * pairing (see game-room.ts) - the platform replies to a matching ping frame
 * without waking a hibernated DO, so these must stay exact string literals
 * rather than ClientMessage/ServerMessage union members with variable fields.
 */
export const PING_PAYLOAD = '{"type":"ping"}';
export const PONG_PAYLOAD = '{"type":"pong"}';

/** One chat message, as stored by the DO and displayed by clients. */
export interface ChatEntry {
  id: string;
  captain: Captain;
  text: string;
  ts: number;
}

// ---- DO -> Client ----

export interface StateSnapshotMessage {
  type: "state_snapshot";
  state: GameState;
}

export interface CaptainJoinedMessage {
  type: "captain_joined";
  captain: Captain;
}

export interface GameStartedMessage {
  type: "game_started";
}

export interface RoundStartedMessage {
  type: "round_started";
  roundNumber: number;
  playerId: string;
  name: string;
  position: Position;
  firstBidder: Captain;
}

export interface BidPlacedMessage {
  type: "bid_placed";
  captain: Captain;
  amount: number;
}

export interface RoundSettledMessage {
  type: "round_settled";
  playerId: string;
  winner: Captain;
  price: number;
}

export interface GameCompletedMessage {
  type: "game_completed";
  squads: GameState["squads"];
}

/** Broadcast to all connections whenever a captain sends a chat message. */
export interface ChatMessageMessage {
  type: "chat_message";
  entry: ChatEntry;
}

/** Sent once to a connection right after it opens, replaying prior chat history. */
export interface ChatHistoryMessage {
  type: "chat_history";
  entries: ChatEntry[];
}

export type ErrorCode =
  | "NOT_YOUR_TURN"
  | "WRONG_SUBPHASE"
  | "BELOW_MIN_INCREMENT"
  | "NOT_A_MULTIPLE_OF_INCREMENT"
  | "BID_EXCEEDS_RESERVE"
  | "PASS_NOT_ALLOWED_BEFORE_OPENING_BID"
  | "NO_ACTIVE_ROUND"
  | "INVALID_TOKEN"
  | "EMPTY_CHAT_MESSAGE"
  | "INAPPROPRIATE_CHAT_MESSAGE"
  | "GAME_NOT_COMPLETED";

export interface ErrorMessage {
  type: "error";
  code: ErrorCode;
  message: string;
}

export type ServerMessage =
  | StateSnapshotMessage
  | CaptainJoinedMessage
  | GameStartedMessage
  | RoundStartedMessage
  | BidPlacedMessage
  | RoundSettledMessage
  | GameCompletedMessage
  | ChatMessageMessage
  | ChatHistoryMessage
  | ErrorMessage;

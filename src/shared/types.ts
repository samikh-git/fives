export type Position = "GK" | "DEF" | "MID" | "ATT";

export interface Player {
  id: string;
  name: string;
  position: Position;
  club: string | null;
  nation: string | null;
  league: string | null;
  imageUrl: string | null;
  externalId: string | null;
  archivedAt: number | null;
}

export type Captain = "A" | "B";

export type Phase = "waiting_for_captain_b" | "in_progress" | "completed";

export interface PoolEntry {
  playerId: string;
  name: string;
  position: Position;
  club: string | null;
  nation: string | null;
  imageUrl: string | null;
  proposalOrder: number;
  status: "pending" | "sold";
}

export interface SquadEntry {
  playerId: string;
  name: string;
  position: Position;
  club: string | null;
  nation: string | null;
  imageUrl: string | null;
  pricePaid: number;
  roundNumber: number;
}

export type RoundSubphase = "awaiting_opening_bid" | "awaiting_response";

export interface RoundState {
  roundNumber: number;
  playerId: string;
  name: string;
  position: Position;
  club: string | null;
  nation: string | null;
  imageUrl: string | null;
  firstBidder: Captain;
  turn: Captain;
  currentBid: number | null;
  currentBidder: Captain | null;
  subphase: RoundSubphase;
}

/** Full game state as broadcast to clients. Captain tokens are never included. */
export interface GameState {
  gameId: string;
  phase: Phase;
  captainAConnected: boolean;
  captainBConnected: boolean;
  captainNames: Record<Captain, string | null>;

  pool: PoolEntry[];
  nextProposalIndex: number;

  budgets: Record<Captain, number>;
  squadCounts: Record<Captain, number>;
  squads: Record<Captain, SquadEntry[]>;

  lastRoundFirstBidder: Captain | null;
  round: RoundState | null;
}

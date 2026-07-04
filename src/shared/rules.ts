import { MIN_BID_INCREMENT, SQUAD_SIZE } from "./constants";

/** Budget reserved for the minimum increment on each slot still needed after the current player. */
export function computeReserve(squadCountBeforeThisPlayer: number): number {
  const slotsRemainingAfterThisPlayer = SQUAD_SIZE - squadCountBeforeThisPlayer - 1;
  return slotsRemainingAfterThisPlayer * MIN_BID_INCREMENT;
}

/** The highest bid a captain may legally place on the current player, given their remaining budget and slots filled so far. */
export function computeMaxLegalBid(budget: number, squadCountBeforeThisPlayer: number): number {
  return budget - computeReserve(squadCountBeforeThisPlayer);
}

export interface BidCheck {
  amount: number;
  currentBid: number | null;
  budget: number;
  squadCount: number;
}

/** Full legality check for a proposed bid: increment rules + the reserve-rule cap. */
export function isLegalBid({ amount, currentBid, budget, squadCount }: BidCheck): boolean {
  if (amount % MIN_BID_INCREMENT !== 0) return false;

  const floor = currentBid === null ? MIN_BID_INCREMENT : currentBid + MIN_BID_INCREMENT;
  if (amount < floor) return false;

  return amount <= computeMaxLegalBid(budget, squadCount);
}

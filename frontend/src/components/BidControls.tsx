import { useEffect, useState } from "react";
import { MIN_BID_INCREMENT } from "../../../src/shared/constants";
import type { RoundSubphase } from "../../../src/shared/types";

export interface BidControlsProps {
  currentBid: number | null;
  subphase: RoundSubphase;
  isMyTurn: boolean;
  isFirstBidder: boolean;
  maxLegalBid: number;
  onBid: (amount: number) => void;
  onPass: () => void;
}

export function BidControls({
  currentBid,
  subphase,
  isMyTurn,
  isFirstBidder,
  maxLegalBid,
  onBid,
  onPass,
}: BidControlsProps) {
  const floor = currentBid === null ? MIN_BID_INCREMENT : currentBid + MIN_BID_INCREMENT;
  const clampedDefault = Math.min(Math.max(floor, 0), Math.max(maxLegalBid, 0));
  const [amount, setAmount] = useState(clampedDefault);

  // Keep the stepper's value in bounds whenever the round context changes
  // (new player proposed, opponent responded with a new currentBid, etc).
  useEffect(() => {
    setAmount(Math.min(Math.max(floor, 0), Math.max(maxLegalBid, 0)));
  }, [floor, maxLegalBid]);

  // The "first bidder must open the bidding" rule: passing isn't allowed
  // before an opening bid exists if you are the one obligated to open it.
  const passDisabled = !isMyTurn || (subphase === "awaiting_opening_bid" && isFirstBidder);

  const canIncrement = isMyTurn && amount + MIN_BID_INCREMENT <= maxLegalBid;
  const canDecrement = isMyTurn && amount - MIN_BID_INCREMENT >= floor;
  const bidIsValid = amount >= floor && amount <= maxLegalBid;
  const bidDisabled = !isMyTurn || !bidIsValid;

  return (
    <div className="bid-controls">
      <div className="bid-controls__stepper">
        <button
          type="button"
          aria-label="Decrease bid"
          onClick={() => setAmount((a) => Math.max(floor, a - MIN_BID_INCREMENT))}
          disabled={!canDecrement}
        >
          −
        </button>
        <span data-testid="bid-amount">{amount.toLocaleString()}</span>
        <button
          type="button"
          aria-label="Increase bid"
          onClick={() => setAmount((a) => Math.min(maxLegalBid, a + MIN_BID_INCREMENT))}
          disabled={!canIncrement}
        >
          +
        </button>
      </div>
      <button className="btn btn--primary" type="button" onClick={() => onBid(amount)} disabled={bidDisabled}>
        Place bid
      </button>
      <button className="btn btn--ghost" type="button" onClick={onPass} disabled={passDisabled}>
        Pass
      </button>
    </div>
  );
}

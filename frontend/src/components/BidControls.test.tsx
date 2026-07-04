import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BidControls } from "./BidControls";
import { MIN_BID_INCREMENT } from "../../../src/shared/constants";

describe("BidControls", () => {
  it("disables Pass when it's the first bidder's turn during the opening-bid subphase", () => {
    render(
      <BidControls
        currentBid={null}
        subphase="awaiting_opening_bid"
        isMyTurn
        isFirstBidder
        maxLegalBid={100_000_000}
        onBid={vi.fn()}
        onPass={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /pass/i })).toBeDisabled();
  });

  it("allows Pass once past the opening bid, or when responding (not first bidder)", () => {
    render(
      <BidControls
        currentBid={10_000_000}
        subphase="awaiting_response"
        isMyTurn
        isFirstBidder
        maxLegalBid={100_000_000}
        onBid={vi.fn()}
        onPass={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /pass/i })).toBeEnabled();
  });

  it("does not allow submitting a bid above maxLegalBid", () => {
    const onBid = vi.fn();
    render(
      <BidControls
        currentBid={null}
        subphase="awaiting_opening_bid"
        isMyTurn
        isFirstBidder
        maxLegalBid={MIN_BID_INCREMENT}
        onBid={onBid}
        onPass={vi.fn()}
      />,
    );

    // Increment button should be disabled since one more step would exceed maxLegalBid
    expect(screen.getByRole("button", { name: /increase bid/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /place bid/i }));
    expect(onBid).toHaveBeenCalledWith(MIN_BID_INCREMENT);
  });

  it("does not allow submitting below the required floor (current bid + one increment)", () => {
    render(
      <BidControls
        currentBid={10_000_000}
        subphase="awaiting_response"
        isMyTurn
        isFirstBidder={false}
        maxLegalBid={100_000_000}
        onBid={vi.fn()}
        onPass={vi.fn()}
      />,
    );

    expect(screen.getByTestId("bid-amount")).toHaveTextContent(
      (10_000_000 + MIN_BID_INCREMENT).toLocaleString(),
    );
    expect(screen.getByRole("button", { name: /decrease bid/i })).toBeDisabled();
  });

  it("disables all buttons entirely when it is not the captain's turn", () => {
    render(
      <BidControls
        currentBid={10_000_000}
        subphase="awaiting_response"
        isMyTurn={false}
        isFirstBidder={false}
        maxLegalBid={100_000_000}
        onBid={vi.fn()}
        onPass={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /place bid/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^pass$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /increase bid/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /decrease bid/i })).toBeDisabled();
  });
});

import { describe, expect, it } from "vitest";
import { computeMaxLegalBid, computeReserve, isLegalBid } from "./rules";
import { MIN_BID_INCREMENT, SQUAD_SIZE, STARTING_BUDGET } from "./constants";

describe("computeReserve", () => {
  it("reserves one increment per remaining slot after the current player", () => {
    // 0 players won yet, bidding on the 1st -> 4 slots remain after this one
    expect(computeReserve(0)).toBe(4 * MIN_BID_INCREMENT);
    // 2 players won, bidding on the 3rd -> 2 slots remain after this one
    expect(computeReserve(2)).toBe(2 * MIN_BID_INCREMENT);
    // 4 players won, bidding on the 5th (last) -> 0 slots remain after this one
    expect(computeReserve(4)).toBe(0);
  });
});

describe("computeMaxLegalBid", () => {
  it("subtracts the reserve from the full budget when no slots are filled", () => {
    expect(computeMaxLegalBid(STARTING_BUDGET, 0)).toBe(
      STARTING_BUDGET - 4 * MIN_BID_INCREMENT,
    );
  });

  it("allows the full remaining budget on the last slot (no reserve needed)", () => {
    const remainingBudget = 30_000_000;
    expect(computeMaxLegalBid(remainingBudget, SQUAD_SIZE - 1)).toBe(remainingBudget);
  });

  it("never returns a negative cap even if budget is below the reserve", () => {
    expect(computeMaxLegalBid(1_000_000, 0)).toBe(1_000_000 - 4 * MIN_BID_INCREMENT);
  });
});

describe("isLegalBid", () => {
  it("rejects an opening bid below the minimum increment", () => {
    expect(
      isLegalBid({
        amount: MIN_BID_INCREMENT - 1,
        currentBid: null,
        budget: STARTING_BUDGET,
        squadCount: 0,
      }),
    ).toBe(false);
  });

  it("accepts an opening bid exactly at the minimum increment", () => {
    expect(
      isLegalBid({
        amount: MIN_BID_INCREMENT,
        currentBid: null,
        budget: STARTING_BUDGET,
        squadCount: 0,
      }),
    ).toBe(true);
  });

  it("rejects a response bid that doesn't beat the current bid by a full increment", () => {
    expect(
      isLegalBid({
        amount: 10_000_000 + 1,
        currentBid: 10_000_000,
        budget: STARTING_BUDGET,
        squadCount: 0,
      }),
    ).toBe(false);
  });

  it("accepts a response bid exactly one increment above the current bid", () => {
    expect(
      isLegalBid({
        amount: 10_000_000 + MIN_BID_INCREMENT,
        currentBid: 10_000_000,
        budget: STARTING_BUDGET,
        squadCount: 0,
      }),
    ).toBe(true);
  });

  it("rejects a bid exceeding the reserve-rule cap", () => {
    const maxLegal = computeMaxLegalBid(STARTING_BUDGET, 2);
    expect(
      isLegalBid({
        amount: maxLegal + MIN_BID_INCREMENT,
        currentBid: null,
        budget: STARTING_BUDGET,
        squadCount: 2,
      }),
    ).toBe(false);
  });

  it("accepts a bid exactly at the reserve-rule cap", () => {
    const maxLegal = computeMaxLegalBid(STARTING_BUDGET, 2);
    expect(
      isLegalBid({
        amount: maxLegal,
        currentBid: null,
        budget: STARTING_BUDGET,
        squadCount: 2,
      }),
    ).toBe(true);
  });

  it("rejects a non-multiple of the minimum increment", () => {
    expect(
      isLegalBid({
        amount: MIN_BID_INCREMENT + 1,
        currentBid: null,
        budget: STARTING_BUDGET,
        squadCount: 0,
      }),
    ).toBe(false);
  });
});

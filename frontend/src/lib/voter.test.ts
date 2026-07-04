import { beforeEach, describe, expect, it } from "vitest";
import { getVoterId, hasVoted, markVoted } from "./voter";

beforeEach(() => {
  localStorage.clear();
});

describe("getVoterId", () => {
  it("generates and persists a voter id on first call", () => {
    const id = getVoterId();
    expect(id).toBeTruthy();
    expect(localStorage.getItem("fives:voter-id")).toBe(id);
  });

  it("returns the same id on subsequent calls", () => {
    const first = getVoterId();
    const second = getVoterId();
    expect(second).toBe(first);
  });
});

describe("hasVoted / markVoted", () => {
  it("reports not voted before markVoted is called for a given slug", () => {
    expect(hasVoted("swift-otter")).toBe(false);
  });

  it("reports voted after markVoted, scoped to that slug only", () => {
    markVoted("swift-otter");
    expect(hasVoted("swift-otter")).toBe(true);
    expect(hasVoted("other-slug")).toBe(false);
  });
});

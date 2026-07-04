import { describe, expect, it } from "vitest";
import { containsProfanity } from "./moderation";

describe("containsProfanity", () => {
  it("flags common profanity", () => {
    expect(containsProfanity("you are a bitch")).toBe(true);
  });

  it("flags leetspeak/character-substitution variants", () => {
    expect(containsProfanity("sh1t happens")).toBe(true);
  });

  it("does not flag ordinary chat", () => {
    expect(containsProfanity("gg, good luck!")).toBe(false);
    expect(containsProfanity("nice bid, well played")).toBe(false);
  });
});

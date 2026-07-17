import { describe, expect, it } from "vitest";
import {
  FAST_SKIP_DWELL_MS,
  implicitReactionFromEngagement,
  implicitWeightForReaction,
} from "./engagement-signals.js";

describe("implicitReactionFromEngagement", () => {
  it("returns down for fast skip without vote", () => {
    expect(
      implicitReactionFromEngagement({
        malId: 1,
        dwellMs: FAST_SKIP_DWELL_MS - 1,
        skipped: true,
      }),
    ).toBe("down");
  });

  it("returns up for long dwell before thumbs up", () => {
    expect(
      implicitReactionFromEngagement({
        malId: 1,
        dwellMs: 9_000,
        skipped: false,
        reaction: "up",
      }),
    ).toBe("up");
  });

  it("returns null when signal is ambiguous", () => {
    expect(
      implicitReactionFromEngagement({
        malId: 1,
        dwellMs: 5_000,
        skipped: false,
        reaction: "up",
      }),
    ).toBeNull();
  });
});

describe("implicitWeightForReaction", () => {
  it("uses weaker magnitudes than binary votes", () => {
    expect(Math.abs(implicitWeightForReaction("up"))).toBeLessThan(1);
    expect(Math.abs(implicitWeightForReaction("down"))).toBeLessThan(1);
  });
});

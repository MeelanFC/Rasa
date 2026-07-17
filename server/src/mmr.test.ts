import { describe, expect, it } from "vitest";
import { pickWithMmr } from "./mmr.js";

describe("MMR pick", () => {
  it("avoids candidates that overlap recently served features", () => {
    const ranked = [
      { features: ["Action", "Shounen"], malId: 1 },
      { features: ["Romance", "Drama"], malId: 2 },
    ];
    const recent = new Set(["Action", "Shounen"]);

    const pick = pickWithMmr(ranked, recent, () => 0, 0.5, 2);
    expect(pick?.malId).toBe(2);
  });
});

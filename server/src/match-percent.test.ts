import { describe, it, expect } from "vitest";
import { calibrateMatchPercent, type PoolScoreReference } from "./match-percent.js";

const pool: PoolScoreReference = { median: 0.01, max: 0.16 };

describe("calibrateMatchPercent (relative match strength)", () => {
  it("maps the best candidate in the pool to the top of the band", () => {
    expect(calibrateMatchPercent(pool.max, pool, true, 0)).toBe(97);
  });

  it("maps the median candidate to the floor of the band", () => {
    expect(calibrateMatchPercent(pool.median, pool, true, 0)).toBe(55);
  });

  it("is monotonic: a higher raw score always reads as a higher percent", () => {
    const low = calibrateMatchPercent(0.04, pool, true, 0);
    const mid = calibrateMatchPercent(0.08, pool, true, 0);
    const high = calibrateMatchPercent(0.13, pool, true, 0);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("spreads surfaced picks across a legible range instead of a 14-point sliver", () => {
    const top = calibrateMatchPercent(0.16, pool, true, 0);
    const weakest = calibrateMatchPercent(0.02, pool, true, 0);
    expect(top - weakest).toBeGreaterThan(30);
  });

  it("pushes below-median candidates under the floor toward the display minimum", () => {
    const belowMedian = calibrateMatchPercent(-0.05, pool, true, 0);
    expect(belowMedian).toBeLessThan(55);
    expect(belowMedian).toBeGreaterThanOrEqual(15);
  });

  it("never returns a value outside the display bounds", () => {
    expect(calibrateMatchPercent(99, pool, true, 0)).toBeLessThanOrEqual(99);
    expect(calibrateMatchPercent(-99, pool, true, 0)).toBeGreaterThanOrEqual(15);
  });

  it("falls back to a stable mid read when the pool scores are indistinguishable", () => {
    const flatPool: PoolScoreReference = { median: 0.05, max: 0.05 };
    const percent = calibrateMatchPercent(0.05, flatPool, true, 0);
    expect(percent).toBeGreaterThanOrEqual(55);
    expect(percent).toBeLessThanOrEqual(97);
  });

  it("uses a popularity-based gradient during cold start (useMl=false)", () => {
    const obscure = calibrateMatchPercent(0, pool, false, 0);
    const popular = calibrateMatchPercent(0, pool, false, 1);
    expect(obscure).toBe(35);
    expect(popular).toBeLessThanOrEqual(75);
    expect(popular).toBeGreaterThan(obscure);
  });
});

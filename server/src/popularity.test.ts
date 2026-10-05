import { describe, expect, it } from "vitest";
import { popularityScore } from "./popularity.js";

describe("popularityScore", () => {
  it("treats a MAL rank as 'lower is more popular' for anime", () => {
    expect(popularityScore("anime", 1)).toBeGreaterThan(popularityScore("anime", 100));
    expect(popularityScore("anime", 100)).toBeGreaterThan(popularityScore("anime", 5_000));
    expect(popularityScore("anime", 1)).toBe(1);
    // The "no rank" sentinel the ingesters store.
    expect(popularityScore("anime", 999_999)).toBe(0);
  });

  it("treats TMDB scores and MangaDex followers as 'higher is more popular'", () => {
    expect(popularityScore("movie", 1_500)).toBeGreaterThan(popularityScore("movie", 20));
    expect(popularityScore("tv", 1_500)).toBeGreaterThan(popularityScore("tv", 20));
    expect(popularityScore("manhwa", 120_000)).toBeGreaterThan(popularityScore("manhwa", 800));
  });

  it("stays within 0..1 and maps missing or zero values to 0", () => {
    const samples = [
      ["anime", 1],
      ["movie", 10_000_000],
      ["manhwa", 1e9],
      ["tv", 0.5],
    ] as const;
    for (const [type, raw] of samples) {
      const score = popularityScore(type, raw);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    expect(popularityScore("anime", null)).toBe(0);
    expect(popularityScore("movie", undefined)).toBe(0);
    expect(popularityScore("manhwa", 0)).toBe(0);
  });

  it("puts a mainstream title of one source above a fringe title of another", () => {
    // A top-10 anime vs a TMDB title almost nobody has rated.
    expect(popularityScore("anime", 10)).toBeGreaterThan(popularityScore("movie", 5));
    // A blockbuster vs an anime ranked 20,000th.
    expect(popularityScore("movie", 2_000)).toBeGreaterThan(popularityScore("anime", 20_000));
  });
});

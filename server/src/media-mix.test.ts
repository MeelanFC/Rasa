import { describe, expect, it } from "vitest";
import {
  allocateMediaQuotas,
  mediaTypeDeckShares,
  mediaTypeUpShares,
  pickMediaTypeWeighted,
} from "./media-mix.js";

describe("mediaTypeUpShares", () => {
  it("normalizes counts into shares", () => {
    const shares = mediaTypeUpShares({ anime: 117, movie: 100, tv: 42 });
    expect(shares.anime).toBeCloseTo(117 / 259);
    expect(shares.movie).toBeCloseTo(100 / 259);
    expect(shares.tv).toBeCloseTo(42 / 259);
  });

  it("drops zero-count types and returns {} with no ups", () => {
    expect(mediaTypeUpShares({ anime: 0, movie: 0 })).toEqual({});
    expect(Object.keys(mediaTypeUpShares({ anime: 5, manhwa: 0 }))).toEqual(["anime"]);
  });
});

describe("allocateMediaQuotas", () => {
  it("splits slots proportionally to shares", () => {
    const quotas = allocateMediaQuotas(
      { anime: 0.45, movie: 0.39, tv: 0.16 },
      19,
      { anime: 500, movie: 500, tv: 500 },
    );
    expect(quotas.anime! + quotas.movie! + quotas.tv!).toBe(19);
    // A single loud cluster can no longer take the whole grid.
    expect(quotas.anime).toBeGreaterThanOrEqual(8);
    expect(quotas.movie).toBeGreaterThanOrEqual(6);
    expect(quotas.tv).toBeGreaterThanOrEqual(2);
  });

  it("caps by availability and redistributes to types with spare candidates", () => {
    const quotas = allocateMediaQuotas(
      { anime: 0.5, movie: 0.5 },
      10,
      { anime: 2, movie: 100 },
    );
    expect(quotas.anime).toBe(2);
    expect(quotas.movie).toBe(8);
  });

  it("ignores types with no candidates and returns {} when nothing available", () => {
    const quotas = allocateMediaQuotas({ anime: 1 }, 5, { anime: 0 });
    expect(quotas).toEqual({});
  });

  it("stops when every type is exhausted even if total is not reached", () => {
    const quotas = allocateMediaQuotas(
      { anime: 0.6, movie: 0.4 },
      50,
      { anime: 3, movie: 4 },
    );
    expect(quotas.anime).toBe(3);
    expect(quotas.movie).toBe(4);
  });
});

describe("pickMediaTypeWeighted", () => {
  it("picks proportionally to shares", () => {
    const shares = { anime: 0.8, movie: 0.2 };
    const available = new Set(["anime", "movie"]);
    expect(pickMediaTypeWeighted(shares, available, () => 0.1)).toBe("anime");
    expect(pickMediaTypeWeighted(shares, available, () => 0.95)).toBe("movie");
  });

  it("skips unavailable types and returns null when none match", () => {
    expect(
      pickMediaTypeWeighted({ anime: 1 }, new Set(["movie"])),
    ).toBeNull();
    expect(
      pickMediaTypeWeighted({ anime: 0.5, movie: 0.5 }, new Set(["movie"]), () => 0.99),
    ).toBe("movie");
  });
});

describe("mediaTypeDeckShares", () => {
  it("gives every available type a share, including ones with no swipes yet", () => {
    const shares = mediaTypeDeckShares(
      { anime: { positive: 1, negative: 0 } },
      ["anime", "movie", "tv"],
    );
    expect(Object.keys(shares).sort()).toEqual(["anime", "movie", "tv"]);
    expect(shares.movie).toBeGreaterThan(0);
    expect(shares.anime).toBeGreaterThan(shares.movie!);
    const total = Object.values(shares).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
  });

  it("fades a type the user keeps passing on without ever dropping it", () => {
    const shares = mediaTypeDeckShares(
      { anime: { positive: 12, negative: 4 }, manhwa: { positive: 0, negative: 20 } },
      ["anime", "manhwa"],
    );
    expect(shares.manhwa).toBeGreaterThan(0);
    expect(shares.manhwa).toBeLessThan(0.1);
  });

  it("ranks by yes-rate, not volume: a type shown less but liked more often leads", () => {
    const shares = mediaTypeDeckShares(
      { anime: { positive: 30, negative: 70 }, movie: { positive: 6, negative: 2 } },
      ["anime", "movie"],
    );
    expect(shares.movie).toBeGreaterThan(shares.anime!);
  });

  it("ignores tallies for types with no candidates and returns {} when nothing is available", () => {
    const shares = mediaTypeDeckShares(
      { anime: { positive: 5, negative: 0 }, tv: { positive: 9, negative: 0 } },
      ["anime"],
    );
    expect(Object.keys(shares)).toEqual(["anime"]);
    expect(shares.anime).toBeCloseTo(1);
    expect(mediaTypeDeckShares({}, [])).toEqual({});
  });
});

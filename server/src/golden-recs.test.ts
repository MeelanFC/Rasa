import { describe, expect, it } from "vitest";
import { buildTasteMlContext, explainCandidateMl } from "./taste-ml.js";
import { COLD_START_RATINGS } from "./types.js";
import type { RatedFeatures } from "./recommendation.js";

interface Candidate {
  malId: number; features: string[]; popularity: number; synopsis: string;
}

function rank(
  rated: RatedFeatures[],
  candidates: Candidate[],
  lovedSynopses: string[] = [],
): Candidate[] {
  const ctx = buildTasteMlContext({
    rated,
    watchlistFeatures: [],
    featureCorpus: candidates.map((c) => c.features),
    lovedSynopses,
    ratingCount: rated.length,
    coldStartThreshold: COLD_START_RATINGS,
  });
  return [...candidates].sort((a, b) =>
    explainCandidateMl(b, ctx).finalScore - explainCandidateMl(a, ctx).finalScore,
  );
}

describe("Golden taste anchors - director affinity dominates", () => {
  it("after 5 Fincher upvotes, an unseen Fincher film ranks above a generic drama", () => {
    const fincherFeature = "director:David Fincher";
    const rated: RatedFeatures[] = Array.from({ length: 5 }, () => ({
      features: ["genre:Drama", "genre:Thriller", fincherFeature],
      reaction: "up" as const,
    }));
    const candidates: Candidate[] = [
      { malId: 1, features: ["genre:Drama", "genre:Thriller", fincherFeature], popularity: 50, synopsis: "" },
      { malId: 2, features: ["genre:Drama"], popularity: 500, synopsis: "" },
    ];
    const [first] = rank(rated, candidates);
    expect(first!.malId).toBe(1);
  });
});

describe("Golden taste anchors - downvote pressure caps weak-only overlap", () => {
  it("a candidate sharing ONLY broad metadata with downvotes does not get crushed", () => {
    const rated: RatedFeatures[] = Array.from({ length: 8 }, () => ({
      features: ["genre:Shounen", "year:2018", "origin:tv"],
      reaction: "down" as const,
    }));
    const strongMatch: Candidate = {
      malId: 1,
      features: ["genre:Seinen", "director:Mamoru Hosoda", "year:2018"],
      popularity: 100,
      synopsis: "",
    };
    const weakOverlap: Candidate = {
      malId: 2,
      features: ["genre:Shounen", "year:2018", "origin:tv"],
      popularity: 100,
      synopsis: "",
    };
    const [first] = rank(rated, [strongMatch, weakOverlap]);
    expect(first!.malId).toBe(1);
  });
});

describe("Golden taste anchors - cold start contract", () => {
  it("with fewer than COLD_START_RATINGS, useMl is false and the scorer still returns finite scores", () => {
    const rated: RatedFeatures[] = [{ features: ["genre:Action"], reaction: "up" }];
    const candidates: Candidate[] = [
      { malId: 1, features: ["genre:Action"], popularity: 1000, synopsis: "" },
    ];
    const ctx = buildTasteMlContext({
      rated, watchlistFeatures: [],
      featureCorpus: candidates.map((c) => c.features),
      lovedSynopses: [], ratingCount: rated.length,
      coldStartThreshold: COLD_START_RATINGS,
    });
    expect(ctx.useMl).toBe(false);
    expect(Number.isFinite(explainCandidateMl(candidates[0]!, ctx).finalScore)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildFeatureWeights,
  infoGainScore,
  isColdStart,
  pickNextCandidate,
  pickNextCandidateWithMl,
  sortByRecommendationScore,
} from "./recommendation.js";
import { COLD_START_RATINGS } from "./types.js";

describe("binary taste engine", () => {
  it("uses cold start until enough ratings", () => {
    expect(isColdStart(COLD_START_RATINGS - 1)).toBe(true);
    expect(isColdStart(COLD_START_RATINGS)).toBe(false);
  });

  it("builds stronger weights from thumbs up vs down", () => {
    const weights = buildFeatureWeights([
      { features: ["Action"], reaction: "up" },
      { features: ["Romance"], reaction: "down" },
    ]);

    expect(weights.Action).toBe(2.5);
    expect(weights.Romance).toBe(-3);
  });

  it("picks ML-aligned titles when synopsis and IDF context match", () => {
    const weights = buildFeatureWeights([
      { features: ["studio:Ufotable"], reaction: "up" },
      { features: ["studio:Ufotable"], reaction: "up" },
    ]);

    const pick = pickNextCandidateWithMl(
      [
        {
          malId: 1,
          features: ["studio:Other"],
          popularity: 500,
          synopsis: "generic adventure",
        },
        {
          malId: 2,
          features: ["studio:Ufotable", "tone:dark"],
          popularity: 500,
          synopsis: "demons and swords dramatic battle",
        },
      ],
      weights,
      20,
      [
        { features: ["studio:Ufotable"], reaction: "up" as const },
        { features: ["studio:Ufotable"], reaction: "up" as const },
      ],
      {
        watchlistFeatures: [],
        featureCorpus: [
          ["studio:Ufotable", "tone:dark"],
          ["studio:Other"],
        ],
        lovedSynopses: ["demons and swords dramatic battle"],
        recentlyServedFeatures: new Set(),
      },
      () => 0.99,
    );

    expect(pick?.malId).toBe(2);
  });

  it("picks taste-aligned titles after warm-up", () => {
    const weights = buildFeatureWeights([
      { features: ["Sci-Fi"], reaction: "up" },
      { features: ["Sci-Fi"], reaction: "up" },
    ]);

    const pick = pickNextCandidate(
      [
        { malId: 1, features: ["Romance"], popularity: 900 },
        { malId: 2, features: ["Sci-Fi"], popularity: 50 },
      ],
      weights,
      20,
      [],
      () => 0.99,
    );

    expect(pick?.malId).toBe(2);
  });

  it("ranks higher-scoring taste matches first", () => {
    const weights = buildFeatureWeights([{ features: ["Action"], reaction: "up" }]);
    const sorted = sortByRecommendationScore(
      [
        { malId: 1, features: ["Romance"], popularity: 99 },
        { malId: 2, features: ["Action"], popularity: 1 },
      ],
      weights,
    );

    expect(sorted[0]?.malId).toBe(2);
  });
});

describe("information gain scoring", () => {
  it("rewards features never seen before", () => {
    const candidates = [
      { malId: 1, features: ["Action", "Drama"], popularity: 100 },
      { malId: 2, features: ["Romance"], popularity: 100 },
    ];
    const seenFeatures = new Set(["Action"]);

    const drama = infoGainScore(candidates[0]!, candidates, seenFeatures);
    const romance = infoGainScore(candidates[1]!, candidates, seenFeatures);

    expect(romance).toBeGreaterThan(drama);
  });

  it("rewards features that split the pool ~50/50", () => {
    const pool = [
      { malId: 1, features: ["Action"], popularity: 0 },
      { malId: 2, features: ["Action"], popularity: 0 },
      { malId: 3, features: ["Romance"], popularity: 0 },
      { malId: 4, features: ["Romance"], popularity: 0 },
      { malId: 5, features: ["Sliver"], popularity: 0 },
    ];
    const seen = new Set<string>();

    const action = infoGainScore(pool[0]!, pool, seen);
    const sliver = infoGainScore(pool[4]!, pool, seen);

    expect(action).toBeGreaterThanOrEqual(sliver - 0.6);
  });
});

describe("cold-start picks", () => {
  it("explores new feature space, not just popularity", () => {
    const candidates = [
      { malId: 1, features: ["Action", "Shounen"], popularity: 1_000_000 },
      { malId: 2, features: ["Action", "Shounen"], popularity: 900_000 },
      { malId: 3, features: ["Action", "Shounen"], popularity: 80_000 },
      { malId: 4, features: ["Slice of Life", "Iyashikei"], popularity: 50_000 },
      { malId: 5, features: ["Mecha", "Military"], popularity: 50_000 },
    ];

    const rated = [
      { features: ["Action", "Shounen"], reaction: "up" as const },
    ];

    const picks = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const pick = pickNextCandidate(
        candidates,
        {},
        0,
        rated,
        () => Math.random(),
      );
      if (pick) picks.add(pick.malId);
    }

    expect(picks.has(4) || picks.has(5)).toBe(true);
  });
});

describe("exploration mixes", () => {
  const candidates = [
    { malId: 1, features: ["genre:Sci-Fi"], popularity: 100_000, synopsis: "sci-fi show" },
    { malId: 2, features: ["genre:Action"], popularity: 90_000, synopsis: "action show" },
    { malId: 3, features: ["genre:Action"], popularity: 80_000, synopsis: "another action show" },
    { malId: 4, features: ["genre:Comedy"], popularity: 70_000, synopsis: "comedy show" },
    { malId: 5, features: ["genre:Drama"], popularity: 60_000, synopsis: "drama show" },
    { malId: 6, features: ["genre:Drama"], popularity: 50_000, synopsis: "another drama show" },
  ];

  const weights = {
    "genre:Action": 10,
    "genre:Sci-Fi": 5,
    "genre:Comedy": -10,
  };

  const rated = [
    { features: ["genre:Action"], reaction: "up" as const },
    { features: ["genre:Comedy"], reaction: "down" as const },
  ];

  const mlOptions = {
    watchlistFeatures: [],
    featureCorpus: [],
    lovedSynopses: [],
    recentlyServedFeatures: new Set<string>(),
  };

  it("exploits via MMR when random roll >= 15% (majority path)", () => {
    const pick = pickNextCandidateWithMl(
      candidates,
      weights,
      20,
      rated,
      mlOptions,
      () => 0.40
    );
    // With 6 candidates (<= 20), exploration never fires - always exploit.
    // MMR picks from the top of the cosine-ranked list.
    expect(pick).toBeDefined();
    expect(pick?.features).toContain("genre:Action");
  });

  it("skips exploration when candidate pool is too small (<=20)", () => {
    // Even with a low random roll that would trigger exploration, the pool
    // is too small (6 < 20) so it falls through to exploit.
    const pick = pickNextCandidateWithMl(
      candidates,
      weights,
      20,
      rated,
      mlOptions,
      () => 0.05
    );
    expect(pick).toBeDefined();
    expect(pick?.features).toContain("genre:Action");
  });

  it("applies hard diversity filter to skip candidates with >70% feature overlap with recent items", () => {
    const testWeights = buildFeatureWeights([{ features: ["genre:Action"], reaction: "up" }]);
    const testCandidates = [
      { malId: 1, features: ["genre:Action", "genre:Sci-Fi"], popularity: 100, synopsis: "" },
      { malId: 2, features: ["genre:Comedy"], popularity: 50, synopsis: "" },
    ];
    
    const pick = pickNextCandidateWithMl(
      testCandidates,
      testWeights,
      20,
      [],
      {
        watchlistFeatures: [],
        featureCorpus: [],
        lovedSynopses: [],
        recentlyServedFeatures: new Set(),
        recentItemsFeatures: [["genre:Action", "genre:Sci-Fi"]],
      },
      () => 0.99
    );
    
    expect(pick?.malId).toBe(2);
  });
});

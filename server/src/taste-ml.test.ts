import { describe, expect, it } from "vitest";
import { registerGraphNeighbors, resetTasteGraphForTests } from "./taste-graph.js";
import { buildTasteMlContext, scoreCandidateMl, explainCandidateMl, NEGATIVE_PENALTY_SCALE } from "./taste-ml.js";

describe("taste ML scoring", () => {
  it("prefers candidates similar to positive profile over negatives", () => {
    resetTasteGraphForTests();
    const ctx = buildTasteMlContext({
      rated: [
        { features: ["studio:Kyoto Animation", "tone:wholesome"], reaction: "up" },
        { features: ["studio:Madhouse", "tone:dark"], reaction: "down" },
      ],
      watchlistFeatures: [],
      featureCorpus: [
        ["studio:Kyoto Animation", "tone:wholesome"],
        ["studio:Madhouse", "tone:dark"],
        ["studio:Kyoto Animation", "tone:comedic"],
      ],
      lovedSynopses: ["heartwarming school club slice of life"],
      ratingCount: 12,
      coldStartThreshold: 8,
    });

    const linear = (features: string[]) =>
      features.includes("studio:Kyoto Animation") ? 2 : -1;

    const wholesome = scoreCandidateMl(
      {
        malId: 1,
        features: ["studio:Kyoto Animation", "tone:wholesome"],
        popularity: 100,
        synopsis: "heartwarming school club everyday life",
      },
      ctx,
      linear,
    );

    const dark = scoreCandidateMl(
      {
        malId: 2,
        features: ["studio:Madhouse", "tone:dark"],
        popularity: 500_000,
        synopsis: "brutal revenge tragedy murder",
      },
      ctx,
      linear,
    );

    expect(wholesome).toBeGreaterThan(dark);
  });

  it("boosts graph neighbors of loved titles", () => {
    resetTasteGraphForTests();
    registerGraphNeighbors(99, [42, 43], 1);

    const ctx = buildTasteMlContext({
      rated: [{ features: ["genre:Action"], reaction: "up" }],
      watchlistFeatures: [],
      featureCorpus: [["genre:Action"]],
      lovedSynopses: [],
      ratingCount: 10,
      coldStartThreshold: 8,
    });

    const neighbor = scoreCandidateMl(
      {
        malId: 42,
        features: ["genre:Romance"],
        popularity: 1,
        synopsis: "unrelated",
      },
      ctx,
      () => 0,
    );

    const stranger = scoreCandidateMl(
      {
        malId: 7,
        features: ["genre:Romance"],
        popularity: 1,
        synopsis: "unrelated",
      },
      ctx,
      () => 0,
    );

    expect(neighbor).toBeGreaterThan(stranger);
  });

  it("caps score for candidates matching only weak features", () => {
    resetTasteGraphForTests();
    const ctx = buildTasteMlContext({
      rated: [
        { features: ["genre:Drama", "year:2023", "mc:male", "theme:Action"], reaction: "up" }
      ],
      watchlistFeatures: [],
      featureCorpus: [
        ["genre:Drama", "year:2023", "mc:male", "origin:KR"],
        ["genre:Drama", "year:2023", "mc:male", "theme:Action"]
      ],
      lovedSynopses: [],
      ratingCount: 10,
      coldStartThreshold: 5,
    });

    // Candidate with only weak matches
    const weakMatch = scoreCandidateMl(
      {
        malId: 1,
        features: ["genre:Drama", "year:2023", "mc:male", "origin:KR"],
        popularity: 1,
        synopsis: "No synopsis overlap"
      },
      ctx,
      () => 0
    );

    // Candidate with a strong match (e.g. theme:Action)
    const strongMatch = scoreCandidateMl(
      {
        malId: 2,
        features: ["genre:Drama", "theme:Action"],
        popularity: 1,
        synopsis: "No synopsis overlap"
      },
      ctx,
      () => 0
    );

    expect(strongMatch).toBeGreaterThan(weakMatch);
  });

  it("Salaar vs Twinkling Watermelon regression: does not rank high on weak matches only", () => {
    resetTasteGraphForTests();
    const ctx = buildTasteMlContext({
      rated: [
        { features: ["theme:Action", "tone:violent", "genre:Action", "mc:male", "year:2023"], reaction: "up" }
      ],
      watchlistFeatures: [],
      featureCorpus: [
        ["theme:Action", "tone:violent", "genre:Action", "mc:male", "year:2023"],
        ["genre:Drama", "mc:male", "year:2023", "theme:Romance"]
      ],
      lovedSynopses: ["Salaar is a high octane action thriller with intense violence"],
      ratingCount: 10,
      coldStartThreshold: 5,
    });

    const watermelon = scoreCandidateMl(
      {
        malId: 100,
        features: ["genre:Drama", "mc:male", "year:2023", "theme:Romance"],
        popularity: 10,
        synopsis: "A time traveling schoolboy forms a band and falls in love"
      },
      ctx,
      () => 0
    );

    const otherAction = scoreCandidateMl(
      {
        malId: 101,
        features: ["theme:Action", "tone:violent"],
        popularity: 10,
        synopsis: "A rogue mercenary hunts down gang members in a violent shootout"
      },
      ctx,
      () => 0
    );

    expect(otherAction).toBeGreaterThan(watermelon);
  });

  it("explanation finalScore equals scoreCandidateMl for weak-only candidates", () => {
    resetTasteGraphForTests();
    const ctx = buildTasteMlContext({
      rated: [
        { features: ["genre:Drama", "year:2023", "mc:male", "theme:Action"], reaction: "up" },
      ],
      watchlistFeatures: [],
      featureCorpus: [
        ["genre:Drama", "year:2023", "mc:male", "origin:KR"],
        ["genre:Drama", "year:2023", "mc:male", "theme:Action"],
      ],
      lovedSynopses: [],
      ratingCount: 10,
      coldStartThreshold: 5,
    });

    // Overlaps the profile only on weak metadata (genre/year/mc).
    const candidate = {
      malId: 1,
      features: ["genre:Drama", "year:2023", "mc:male", "origin:KR"],
      popularity: 1,
      synopsis: "No synopsis overlap",
    };

    const explanation = explainCandidateMl(candidate, ctx);
    const rankingScore = scoreCandidateMl(candidate, ctx, () => 0);

    // The explained/logged score IS the ranking score - no recompute drift.
    expect(explanation.finalScore).toBe(rankingScore);
    expect(explanation.weakOnlyMatch).toBe(true);
    expect(explanation.matchedStrongFeatures).toEqual([]);
    // Weak-feature ceiling caps the core at 0.05 or lower.
    expect(explanation.cappedCoreScore).toBeLessThanOrEqual(0.05);
  });

  it("explanation finalScore equals scoreCandidateMl for strong-match candidates", () => {
    resetTasteGraphForTests();
    const ctx = buildTasteMlContext({
      rated: [
        { features: ["theme:Action", "tone:violent", "genre:Action"], reaction: "up" },
      ],
      watchlistFeatures: [],
      featureCorpus: [
        ["theme:Action", "tone:violent", "genre:Action"],
        ["genre:Drama", "theme:Romance"],
      ],
      lovedSynopses: [],
      ratingCount: 10,
      coldStartThreshold: 5,
    });

    const candidate = {
      malId: 2,
      features: ["theme:Action", "tone:violent"],
      popularity: 10,
      synopsis: "a violent action shootout",
    };

    const explanation = explainCandidateMl(candidate, ctx);

    expect(explanation.finalScore).toBe(scoreCandidateMl(candidate, ctx, () => 0));
    expect(explanation.weakOnlyMatch).toBe(false);
    expect(explanation.matchedStrongFeatures).toContain("theme:Action");
    // No weak-only cap applies, so capped core equals the raw core.
    expect(explanation.cappedCoreScore).toBe(explanation.coreScore);
  });

  it("caps the negative penalty when a candidate only shares weak metadata with dislikes", () => {
    resetTasteGraphForTests();
    const ctx = buildTasteMlContext({
      rated: [
        { features: ["theme:Mecha", "tone:epic"], reaction: "up" },
        { features: ["genre:Action", "score-tier:high", "origin:tv", "year:2016"], reaction: "down" },
        { features: ["genre:Action", "score-tier:high", "origin:tv", "year:2017"], reaction: "down" },
        { features: ["genre:Action", "score-tier:high", "origin:tv", "year:2018"], reaction: "down" },
      ],
      watchlistFeatures: [],
      featureCorpus: [
        ["theme:Mecha", "tone:epic"],
        ["genre:Action", "score-tier:high", "origin:tv", "year:2016"],
        ["genre:Action", "score-tier:high", "origin:tv", "year:2017"],
        ["genre:Action", "score-tier:high", "origin:tv", "year:2018"],
        ["theme:Mecha", "genre:Action", "score-tier:high"],
      ],
      lovedSynopses: [],
      ratingCount: 10,
      coldStartThreshold: 5,
    });

    // Strong positive match (theme:Mecha), but the candidate's only overlap with the
    // negative profile is broad metadata (genre:Action, score-tier:high).
    const candidate = {
      malId: 1,
      features: ["theme:Mecha", "genre:Action", "score-tier:high"],
      popularity: 1,
      synopsis: "no synopsis overlap",
    };
    const exp = explainCandidateMl(candidate, ctx);

    expect(exp.weakOnlyMatch).toBe(false); // theme:Mecha is a real positive match
    expect(exp.weakOnlyNegative).toBe(true); // negatives are only broad metadata
    expect(exp.negativeSimilarity).toBeGreaterThan(0.05); // raw overlap with dislikes is high...
    // ...but the negative actually applied to the score is capped at the weak ceiling.
    const effectiveNegative = (exp.positiveSimilarity - exp.coreScore) / NEGATIVE_PENALTY_SCALE;
    expect(effectiveNegative).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});

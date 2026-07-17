import { categoryWeightForFeature } from "./feature-category.js";
import { downReasonCategoryBoost, downReasonFeature } from "./downvote-reason.js";
import { implicitWeightForReaction } from "./engagement-signals.js";
import { pickWithMmr } from "./mmr.js";
import {
  buildTasteMlContext,
  rankByMlScore,
  type TasteMlContext,
} from "./taste-ml.js";
import type { TasteModel } from "./taste-model.js";
import type { DownvoteReason, FeatureWeights, Reaction } from "./types.js";
import { COLD_START_RATINGS, REACTION_WEIGHTS } from "./types.js";

export interface RatedFeatures {
  features: string[];
  reaction: Reaction;
  downReason?: DownvoteReason | null;
  /** When set, uses implicit weights instead of REACTION_WEIGHTS (dwell/skip). */
  implicitWeight?: number;
}

export interface CandidateAnime {
  malId: number;
  features: string[];
  popularity: number;
}

const EXPLORATION_RATE = 0.15;
const POPULARITY_NORMALIZER = 2_000_000;

export function parseFeatureTags(
  genresJson: string,
  themesJson: string,
  demographicsJson: string,
): string[] {
  const parse = (raw: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      return [];
    }
  };

  return [...parse(genresJson), ...parse(themesJson), ...parse(demographicsJson)];
}

export function scoreFeatures(features: string[], weights: FeatureWeights): number {
  return features.reduce((sum, feature) => {
    const delta = weights[feature] ?? 0;
    if (delta === 0) {
      return sum;
    }
    return sum + delta * categoryWeightForFeature(feature);
  }, 0);
}

export function buildFeatureWeights(ratings: RatedFeatures[]): FeatureWeights {
  const weights: FeatureWeights = {};
  for (const { features, reaction, downReason, implicitWeight } of ratings) {
    const delta =
      implicitWeight !== undefined
        ? implicitWeight
        : REACTION_WEIGHTS[reaction];

    const featureList =
      downReason && reaction === "down"
        ? [...features, downReasonFeature(downReason)]
        : features;

    for (const feature of featureList) {
      const categoryBoost =
        downReason && reaction === "down"
          ? downReasonCategoryBoost(downReason, feature)
          : 1;
      weights[feature] = (weights[feature] ?? 0) + delta * categoryBoost;
    }
  }
  return weights;
}

/** Weak taste nudges from dwell/skip signals (does not replace binary votes). */
export function ratedFeaturesFromImplicitSignal(
  features: string[],
  reaction: Reaction,
): RatedFeatures {
  return {
    features,
    reaction,
    implicitWeight: implicitWeightForReaction(reaction),
  };
}

export function sortByRecommendationScore<T extends CandidateAnime>(
  candidates: T[],
  weights: FeatureWeights,
): T[] {
  return [...candidates].sort((a, b) => {
    const scoreDiff =
      scoreFeatures(b.features, weights) - scoreFeatures(a.features, weights);
    if (scoreDiff !== 0) return scoreDiff;
    return b.popularity - a.popularity;
  });
}

export interface ScorableCandidate extends CandidateAnime {
  synopsis: string;
}

export interface PickMlOptions {
  watchlistFeatures: string[][];
  featureCorpus: string[][];
  lovedSynopses: string[];
  recentlyServedFeatures: Set<string>;
  recentItemsFeatures?: string[][];
}

export function sortByMlTasteScore<T extends ScorableCandidate>(
  candidates: T[],
  weights: FeatureWeights,
  ratingCount: number,
  rated: RatedFeatures[],
  options: PickMlOptions,
): T[] {
  const ctx = buildPickMlContext(rated, weights, ratingCount, options);
  const ranked = rankByMlScore(candidates, ctx, (features) =>
    scoreFeatures(features, weights),
  );
  return ranked.map(({ mlScore: _mlScore, ...rest }) => rest as T);
}

function buildPickMlContext(
  rated: RatedFeatures[],
  weights: FeatureWeights,
  ratingCount: number,
  options: PickMlOptions,
): TasteMlContext {
  return buildTasteMlContext({
    rated,
    watchlistFeatures: options.watchlistFeatures,
    featureCorpus: options.featureCorpus,
    lovedSynopses: options.lovedSynopses,
    ratingCount,
    coldStartThreshold: COLD_START_RATINGS,
  });
}

export function sortCandidatesForPick<T extends ScorableCandidate>(
  candidates: T[],
  weights: FeatureWeights,
  ratingCount: number,
  rated: RatedFeatures[],
  options: PickMlOptions,
): T[] {
  if (isColdStart(ratingCount)) {
    return candidates;
  }

  const ctx = buildPickMlContext(rated, weights, ratingCount, options);
  const ranked = rankByMlScore(candidates, ctx, (features) =>
    scoreFeatures(features, weights),
  );
  return ranked.map(({ mlScore: _mlScore, ...rest }) => rest as T);
}

export function isColdStart(ratingCount: number): boolean {
  return ratingCount < COLD_START_RATINGS;
}

/**
 * Akinator-style information gain for a candidate.
 *
 * For each candidate feature we reward:
 *  - novelty: features we've never seen split the unknown-tag space wide open
 *  - balanced coverage: features covering ~half the pool maximally reduce entropy
 *
 * Popularity is folded in as a tiebreaker so we don't surface unknown niche shows
 * the user can't anchor on.
 */
export function infoGainScore<T extends CandidateAnime>(
  candidate: T,
  pool: T[],
  seenFeatures: Set<string>,
): number {
  if (candidate.features.length === 0) {
    return 0;
  }

  const poolSize = Math.max(1, pool.length);
  let gain = 0;

  for (const feature of candidate.features) {
    const coverage =
      pool.filter((c) => c.features.includes(feature)).length / poolSize;
    const splitScore = 1 - Math.abs(coverage - 0.5) * 2;
    const novelty = seenFeatures.has(feature) ? 0 : 0.6;
    gain += splitScore + novelty;
  }

  const normalized = gain / candidate.features.length;
  const popularityBoost = Math.min(candidate.popularity, POPULARITY_NORMALIZER) /
    POPULARITY_NORMALIZER;

  return normalized + popularityBoost * 0.15;
}

function pickByInfoGain<T extends CandidateAnime>(
  candidates: T[],
  rated: RatedFeatures[],
  random: () => number,
): T | undefined {
  if (candidates.length === 0) return undefined;

  const seenFeatures = new Set<string>();
  for (const { features } of rated) {
    for (const feature of features) seenFeatures.add(feature);
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: infoGainScore(candidate, candidates, seenFeatures),
    }))
    .sort((a, b) => b.score - a.score);

  const topN = Math.min(5, scored.length);
  const pickIndex = Math.floor(random() * topN);
  return scored[pickIndex]?.candidate ?? scored[0]?.candidate;
}

/**
 * Cold start picks for maximum learning (info gain).
 * Warm picks the best taste match; sometimes explores a high-uncertainty pick.
 */
export function pickNextCandidate<T extends CandidateAnime>(
  candidates: T[],
  weights: FeatureWeights,
  ratingCount: number,
  rated: RatedFeatures[] = [],
  random: () => number = Math.random,
): T | undefined {
  return pickNextCandidateWithMl(candidates, weights, ratingCount, rated, undefined, random);
}

export function pickNextCandidateWithMl<T extends ScorableCandidate>(
  candidates: T[],
  weights: FeatureWeights,
  ratingCount: number,
  rated: RatedFeatures[] = [],
  mlOptions: PickMlOptions | undefined,
  random: () => number = Math.random,
  tasteModel?: TasteModel | null,
): T | undefined {
  if (candidates.length === 0) return undefined;

  if (isColdStart(ratingCount)) {
    return pickByInfoGain(candidates, rated, random);
  }

  // ── Rank candidates ─────────────────────────────────────────────────────
  // Prefer the learned logistic model (calibrated P(like)) when available;
  // fall back to cosine ranker otherwise.
  let ranked: T[];
  if (tasteModel) {
    ranked = [...candidates]
      .map((c) => ({ ...c, _p: tasteModel.predict(c.features, c.synopsis) }))
      .sort((a, b) => b._p - a._p)
      .map(({ _p: _, ...rest }) => rest as T);
  } else if (mlOptions !== undefined) {
    ranked = sortCandidatesForPick(candidates, weights, ratingCount, rated, mlOptions);
  } else {
    ranked = sortByRecommendationScore(candidates, weights);
  }

  // Hard diversity filter: skip candidates that share >70% feature overlap with any of the last 5 served items.
  if (mlOptions?.recentItemsFeatures && mlOptions.recentItemsFeatures.length > 0) {
    const filtered = ranked.filter((cand) => {
      if (cand.features.length === 0) return true;
      for (const recent of mlOptions.recentItemsFeatures!) {
        if (recent.length === 0) continue;
        let intersection = 0;
        const recentSet = new Set(recent);
        for (const f of cand.features) {
          if (recentSet.has(f)) intersection++;
        }
        const overlap = intersection / Math.min(cand.features.length, recent.length);
        if (overlap > 0.7) {
          return false;
        }
      }
      return true;
    });
    if (filtered.length > 0) {
      ranked = filtered;
    }
  }

  const rand = random();

  // ε-greedy: 15% explore from the mid-tier (ranks 20–60) via info gain.
  // Unlike the old "top 15" explore, mid-tier ensures exploration is genuinely
  // different from the exploit path - you won't re-pick the #1 candidate.
  if (rand < EXPLORATION_RATE && ranked.length > 20) {
    const midTier = ranked.slice(20, Math.min(60, ranked.length));
    const explorePick = pickByInfoGain(midTier, rated, random);
    if (explorePick) {
      return explorePick;
    }
  }

  // 85% exploit: MMR-diversified pick from the top of the ranked list.
  if (mlOptions !== undefined) {
    return pickWithMmr(ranked, mlOptions.recentlyServedFeatures, random);
  }

  return ranked[0];
}

export function rankTopRecommendations<T extends CandidateAnime>(
  candidates: T[],
  weights: FeatureWeights,
  limit: number,
): T[] {
  return sortByRecommendationScore(candidates, weights).slice(0, limit);
}

export function rankTopRecommendationsMl<T extends ScorableCandidate>(
  candidates: T[],
  weights: FeatureWeights,
  ratingCount: number,
  rated: RatedFeatures[],
  options: PickMlOptions,
  limit: number,
): T[] {
  return sortCandidatesForPick(candidates, weights, ratingCount, rated, options).slice(
    0,
    limit,
  );
}

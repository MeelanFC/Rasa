import { computeIdfWeights } from "./feature-idf.js";
import { tokenizeSynopsis, maxSynopsisJaccardPretokenized } from "./synopsis-tokens.js";
import { getGraphBoostScore } from "./taste-graph.js";
import type { RatedFeatures } from "./recommendation.js";
import {
  addToVector,
  cosineSimilarity,
  emptySparseVector,
  l2Norm,
  scaleVector,
  type SparseVector,
  vectorFromFeatures,
} from "./sparse-vector.js";
import { REACTION_WEIGHTS } from "./types.js";

/** Watchlist is a softer positive than thumbs-up (intent without commitment). */
export const WATCHLIST_TASTE_WEIGHT = 1.15;

export const SYNOPSIS_BOOST_MAX = 0.32;
export const GRAPH_BOOST_MAX = 0.15;
export const NEGATIVE_PENALTY_SCALE = 1.0;
export const POPULARITY_PRIOR_MAX = 0.08;
export const POPULARITY_NORMALIZER = 2_000_000;

/** Ceiling applied to a weak-only match (positive or negative): generic metadata
 *  overlap can't drive - or suppress - a score by more than this. */
const WEAK_MATCH_CEILING = 0.05;

/** Broad metadata features that, matched on their own, don't justify a strong
 *  match - they're common to most popular titles, so they're catalog noise, not
 *  taste. A candidate overlapping ONLY these (positive OR negative) has that side's
 *  contribution capped at WEAK_MATCH_CEILING - see explainCandidateMl(). Note: ALL
 *  genres are weak here; the broad-vs-distinctive genre split is a deliberate non-goal. */
const WEAK_FEATURE_PREFIXES = [
  "year:",
  "mc:",
  "origin:",
  "format:",
  "status:",
  "rating:",
  "genre:",
  // Broad catalog metadata - almost every popular title shares these.
  "relation:",
  "producer:",
  "licensor:",
  "rank:",
  "score-tier:",
  "source:",
  "season:",
] as const;

export function isWeakFeature(feature: string): boolean {
  return WEAK_FEATURE_PREFIXES.some((prefix) => feature.startsWith(prefix));
}

export interface MlScoredCandidate {
  malId: number;
  features: string[];
  popularity: number;
  synopsis: string;
  mlScore: number;
}

export interface TasteMlContext {
  positiveProfile: SparseVector;
  negativeProfile: SparseVector;
  lovedSynopsesTokens: string[][];
  idf: Map<string, number>;
  useMl: boolean;
}

export function buildTasteMlContext(options: {
  rated: RatedFeatures[];
  watchlistFeatures: string[][];
  featureCorpus: string[][];
  lovedSynopses: string[];
  ratingCount: number;
  coldStartThreshold: number;
}): TasteMlContext {
  const idf = computeIdfWeights(options.featureCorpus);
  const positiveProfile = emptySparseVector();
  const negativeProfile = emptySparseVector();

  for (const { features, reaction } of options.rated) {
    const vec = vectorFromFeatures(features, idf);
    const scale = REACTION_WEIGHTS[reaction];
    if (scale > 0) {
      addToVector(positiveProfile, vec, scale);
    } else {
      addToVector(negativeProfile, vec, Math.abs(scale));
    }
  }

  for (const features of options.watchlistFeatures) {
    const vec = vectorFromFeatures(features, idf);
    addToVector(positiveProfile, vec, WATCHLIST_TASTE_WEIGHT);
  }

  const useMl = options.ratingCount >= options.coldStartThreshold;

  const lovedSynopsesTokens = options.lovedSynopses.map((synopsis) =>
    tokenizeSynopsis(synopsis),
  );

  return {
    positiveProfile,
    negativeProfile,
    lovedSynopsesTokens,
    idf,
    useMl,
  };
}

export interface CandidateScoreExplanation {
  /** Composite score used for ranking - identical to scoreCandidateMl()'s warm-path output. */
  finalScore: number;
  /** positiveSim minus the (weak-capped) negative term, before the weak-positive cap or -1 floor. */
  coreScore: number;
  /** coreScore after the weak-only-positive ceiling (<= WEAK_MATCH_CEILING when weakOnlyMatch), before the -1 floor. */
  cappedCoreScore: number;
  /** True when the candidate matched no strong (non-weak) positive feature. */
  weakOnlyMatch: boolean;
  /** True when the candidate's overlap with the negative profile is only weak metadata. */
  weakOnlyNegative: boolean;
  positiveSimilarity: number;
  negativeSimilarity: number;
  synopsisBoost: number;
  graphBoost: number;
  popularityPrior: number;
  /** Matched positive features, strongest first (excludes weak metadata). */
  matchedStrongFeatures: string[];
  /** Matched positive features that are only weak metadata, strongest first. */
  matchedWeakFeatures: string[];
  /** Features that hit the negative profile, strongest first. */
  penalizedFeatures: string[];
}

/**
 * Single source of truth for warm-profile scoring. Returns the full breakdown so
 * ranking (scoreCandidateMl) and observability (debug logs) compute the same math,
 * weak-feature ceiling included - they can no longer drift.
 */
export function explainCandidateMl(
  candidate: {
    malId: number;
    features: string[];
    popularity: number;
    synopsis: string;
  },
  ctx: TasteMlContext,
): CandidateScoreExplanation {
  const candidateVec = vectorFromFeatures(candidate.features, ctx.idf);
  const positiveSimilarity = cosineSimilarity(ctx.positiveProfile, candidateVec);

  // Cap the negative profile's effective norm so 500+ downvotes can't create a
  // wall of noise that penalizes everything. The cap lets the negative profile
  // be at most as "loud" as the positive one.
  const posNorm = l2Norm(ctx.positiveProfile);
  const negNorm = l2Norm(ctx.negativeProfile);
  const effectiveNegProfile = (negNorm > 0 && posNorm > 0 && negNorm > posNorm)
    ? scaleVector(ctx.negativeProfile, posNorm / negNorm)
    : ctx.negativeProfile;
  const negativeSimilarity = cosineSimilarity(effectiveNegProfile, candidateVec);

  const matchedStrong: Array<{ feature: string; weight: number }> = [];
  const matchedWeak: Array<{ feature: string; weight: number }> = [];
  const penalized: Array<{ feature: string; weight: number }> = [];
  let hasStrongNegative = false;
  for (const feature of candidate.features) {
    const weak = isWeakFeature(feature);
    const posVal = ctx.positiveProfile.get(feature) ?? 0;
    if (posVal > 0) {
      if (weak) {
        matchedWeak.push({ feature, weight: posVal });
      } else {
        matchedStrong.push({ feature, weight: posVal });
      }
    }
    const negVal = ctx.negativeProfile.get(feature) ?? 0;
    if (negVal > 0) {
      penalized.push({ feature, weight: negVal });
      if (!weak) hasStrongNegative = true;
    }
  }
  const weakOnlyMatch = matchedStrong.length === 0;
  const weakOnlyNegative = penalized.length > 0 && !hasStrongNegative;

  // Symmetric weak-feature ceilings so broad catalog metadata can neither fake a
  // strong match nor suppress at full strength.
  //  - weak-only NEGATIVE overlap (e.g. candidate merely shares origin:tv /
  //    score-tier:high with downvoted titles): cap how hard the negative can bite.
  const effectiveNegative = weakOnlyNegative
    ? Math.min(negativeSimilarity, WEAK_MATCH_CEILING)
    : negativeSimilarity;
  const coreScore = positiveSimilarity - effectiveNegative * NEGATIVE_PENALTY_SCALE;
  //  - weak-only POSITIVE overlap (e.g. genre:Drama + mc:male + year:2023): cap the
  //    core so generic metadata can't masquerade as a strong match.
  const cappedCoreScore = weakOnlyMatch ? Math.min(WEAK_MATCH_CEILING, coreScore) : coreScore;
  // Floor the core: downvote-heavy profiles drive negativeSim high enough to run
  // the score to -2+, which destroys ranking semantics.
  const flooredCore = Math.max(-1, cappedCoreScore);

  const synopsisBoost =
    maxSynopsisJaccardPretokenized(candidate.synopsis, ctx.lovedSynopsesTokens) * SYNOPSIS_BOOST_MAX;
  const graphBoost = Math.min(GRAPH_BOOST_MAX, getGraphBoostScore(candidate.malId));
  const popularityPrior =
    (Math.min(candidate.popularity, POPULARITY_NORMALIZER) / POPULARITY_NORMALIZER) *
    POPULARITY_PRIOR_MAX;

  const finalScore = flooredCore + synopsisBoost + graphBoost + popularityPrior;

  const byWeightDesc = (a: { weight: number }, b: { weight: number }) => b.weight - a.weight;
  return {
    finalScore,
    coreScore,
    cappedCoreScore,
    weakOnlyMatch,
    weakOnlyNegative,
    positiveSimilarity,
    negativeSimilarity,
    synopsisBoost,
    graphBoost,
    popularityPrior,
    matchedStrongFeatures: matchedStrong.sort(byWeightDesc).map((m) => m.feature),
    matchedWeakFeatures: matchedWeak.sort(byWeightDesc).map((m) => m.feature),
    penalizedFeatures: penalized.sort(byWeightDesc).map((m) => m.feature),
  };
}

export function scoreCandidateMl(
  candidate: {
    malId: number;
    features: string[];
    popularity: number;
    synopsis: string;
  },
  ctx: TasteMlContext,
  linearFallback: (features: string[]) => number,
): number {
  if (!ctx.useMl) {
    return linearFallback(candidate.features);
  }
  return explainCandidateMl(candidate, ctx).finalScore;
}

export function rankByMlScore<T extends {
  malId: number;
  features: string[];
  popularity: number;
  synopsis: string;
}>(
  candidates: T[],
  ctx: TasteMlContext,
  linearFallback: (features: string[]) => number,
): Array<T & { mlScore: number }> {
  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      mlScore: scoreCandidateMl(candidate, ctx, linearFallback),
    }))
    .sort((a, b) => {
      if (b.mlScore !== a.mlScore) {
        return b.mlScore - a.mlScore;
      }
      return b.popularity - a.popularity;
    });
}

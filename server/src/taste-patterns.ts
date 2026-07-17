import { categoryWeightForFeature, scoringFeatures } from "./feature-category.js";
import type { Reaction } from "./types.js";

export interface RatedFeatureRow {
  features: string[];
  reaction: Reaction;
}

export interface TastePatternFeature {
  name: string;
  upCount: number;
  downCount: number;
  upRate: number;
  contrast: number;
  weight: number;
}

export interface TastePatternsResult {
  minSample: number;
  upLeaning: TastePatternFeature[];
  downLeaning: TastePatternFeature[];
}

const DEFAULT_MIN_SAMPLE = 2;

interface FeatureCounts {
  up: number;
  down: number;
}

function accumulateCounts(
  ratings: RatedFeatureRow[],
): Map<string, FeatureCounts> {
  const counts = new Map<string, FeatureCounts>();

  for (const { features, reaction } of ratings) {
    const unique = new Set(scoringFeatures(features));
    for (const feature of unique) {
      const row = counts.get(feature) ?? { up: 0, down: 0 };
      if (reaction === "up") {
        row.up += 1;
      } else if (reaction === "down") {
        row.down += 1;
      }
      counts.set(feature, row);
    }
  }

  return counts;
}

function patternFromCounts(
  name: string,
  counts: FeatureCounts,
): TastePatternFeature {
  const total = counts.up + counts.down;
  const upRate = total > 0 ? counts.up / total : 0;
  const contrast = counts.up - counts.down;
  // Weight blends proportional lean (upRate − 0.5) with sample size (sqrt(total)).
  // Old formula was just `contrast * categoryWeight` - that ranks 5-of-5 ups (contrast 5)
  // identically to 50-of-95 ups (contrast 5), even though the first is a much stronger trend.
  // sqrt(total) gives diminishing-returns credit to well-sampled features without letting
  // ubiquitous low-lean features dominate.
  const proportionalLean = (upRate - 0.5) * 2; // [-1, 1]
  const sampleStrength = Math.sqrt(total);
  return {
    name,
    upCount: counts.up,
    downCount: counts.down,
    upRate,
    contrast,
    weight: proportionalLean * sampleStrength * categoryWeightForFeature(name),
  };
}

/**
 * Contrasts features that appear on thumbs-up vs thumbs-down titles.
 * upRate = ups / (ups + downs) per feature; requires min sample on both sides combined.
 */
export function computeTastePatterns(
  ratings: RatedFeatureRow[],
  options?: { minSample?: number; limit?: number },
): TastePatternsResult {
  const minSample = options?.minSample ?? DEFAULT_MIN_SAMPLE;
  const limit = options?.limit ?? 12;
  const counts = accumulateCounts(ratings);

  const patterns: TastePatternFeature[] = [];
  for (const [name, row] of counts) {
    const total = row.up + row.down;
    if (total < minSample) {
      continue;
    }
    patterns.push(patternFromCounts(name, row));
  }

  const upLeaning = [...patterns]
    .filter((p) => p.contrast > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);

  const downLeaning = [...patterns]
    .filter((p) => p.contrast < 0)
    .sort((a, b) => a.weight - b.weight)
    .slice(0, limit);

  return { minSample, upLeaning, downLeaning };
}

/**
 * Maximal Marginal Relevance: re-rank top candidates for diversity vs recent picks.
 */
export interface MmrCandidate {
  features: string[];
}

/**
 * Select K diverse items from a pre-sorted ranked list.
 *
 * Greedy MMR: at each step, pick the candidate that maximizes
 * `lambda * relevance - (1 - lambda) * redundancy` where redundancy is the
 * feature-overlap ratio with already-selected items. The first item is always
 * the top-ranked one (full relevance, no redundancy).
 *
 * Used by Profile recommendations so the grid doesn't collapse into 16 shows
 * from the same tag cluster.
 */
export function selectKDiverse<T extends MmrCandidate>(
  ranked: T[],
  k: number,
  lambda = 0.6,
): T[] {
  if (ranked.length <= k) return [...ranked];
  if (k <= 0) return [];

  const top = ranked[0];
  if (!top) return [];

  const selected: T[] = [top];
  const usedFeatures = new Set<string>(top.features);
  const remaining = ranked.slice(1);

  // Only consider top 3*k of remaining each iteration; keeps relevance high
  // and bounds the cost to O(k * 3k) feature comparisons.
  const considerLimit = Math.min(remaining.length, k * 3);

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;
    const limit = Math.min(remaining.length, considerLimit);

    for (let i = 0; i < limit; i += 1) {
      const cand = remaining[i];
      if (!cand) continue;

      const relevance = 1 - i / Math.max(1, limit);

      let overlap = 0;
      for (const f of cand.features) {
        if (usedFeatures.has(f)) overlap += 1;
      }
      const redundancy =
        cand.features.length > 0 ? overlap / cand.features.length : 0;

      const mmr = lambda * relevance - (1 - lambda) * redundancy;

      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;
    const picked = remaining.splice(bestIdx, 1)[0];
    if (!picked) break;
    selected.push(picked);
    for (const f of picked.features) usedFeatures.add(f);
  }

  return selected;
}

export function pickWithMmr<T extends MmrCandidate>(
  ranked: T[],
  recentlyServedFeatures: Set<string>,
  random: () => number,
  lambda = 0.5,
  poolSize = 25,
): T | undefined {
  if (ranked.length === 0) {
    return undefined;
  }

  if (recentlyServedFeatures.size === 0) {
    return ranked[0];
  }

  const pool = ranked.slice(0, Math.min(poolSize, ranked.length));
  let best: T | undefined;
  let bestMmr = -Infinity;

  for (let index = 0; index < pool.length; index += 1) {
    const candidate = pool[index];
    if (!candidate) {
      continue;
    }

    const relevance = 1 - index / Math.max(1, pool.length);
    let maxOverlap = 0;

    for (const feature of candidate.features) {
      if (recentlyServedFeatures.has(feature)) {
        maxOverlap += 1;
      }
    }

    const overlapRatio =
      candidate.features.length > 0 ? maxOverlap / candidate.features.length : 0;
    const redundancy = overlapRatio >= 1 ? 1 : overlapRatio;
    const mmr = lambda * relevance - (1 - lambda) * redundancy;

    if (mmr > bestMmr) {
      bestMmr = mmr;
      best = candidate;
    }
  }

  return best ?? pool[0];
}

/**
 * Media-mix quotas: recommendations are composed per media type in proportion
 * to the user's own upvote mix, instead of ranked globally. A burst of coherent
 * likes in one cluster (e.g. 20 Bollywood comedies seeded in one day) makes a
 * global ranker fill the entire grid with that cluster; quotas keep the grid
 * shaped like the user's actual taste (e.g. 45% anime / 39% film / 16% TV)
 * while the model still picks the best titles WITHIN each slice.
 */

/** Normalizes per-type upvote counts into shares. Types with zero ups get 0. */
export function mediaTypeUpShares(
  upCounts: Record<string, number>,
): Record<string, number> {
  const entries = Object.entries(upCounts).filter(([, n]) => n > 0);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return {};
  return Object.fromEntries(entries.map(([type, n]) => [type, n / total]));
}

/**
 * Splits `total` slots across media types by share, capped by availability.
 * Remainder goes to the largest fractional parts; slots a type can't fill
 * (not enough candidates) are redistributed to types with spare candidates.
 */
export function allocateMediaQuotas(
  shares: Record<string, number>,
  total: number,
  availableByType: Record<string, number>,
): Record<string, number> {
  const types = Object.keys(shares).filter((t) => (availableByType[t] ?? 0) > 0);
  if (types.length === 0) return {};

  const shareSum = types.reduce((sum, t) => sum + shares[t]!, 0);
  const raw = types.map((t) => ({
    type: t,
    exact: (shares[t]! / shareSum) * total,
  }));

  const quotas: Record<string, number> = {};
  for (const { type, exact } of raw) {
    quotas[type] = Math.min(Math.floor(exact), availableByType[type] ?? 0);
  }

  let used = Object.values(quotas).reduce((a, b) => a + b, 0);
  // Hand out remaining slots by largest fractional part, then by share, to
  // types that still have candidates left.
  const byPriority = [...raw].sort(
    (a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || b.exact - a.exact,
  );
  let guard = 0;
  while (used < total && guard < 1000) {
    guard += 1;
    let assigned = false;
    for (const { type } of byPriority) {
      if (used >= total) break;
      if ((quotas[type] ?? 0) < (availableByType[type] ?? 0)) {
        quotas[type] = (quotas[type] ?? 0) + 1;
        used += 1;
        assigned = true;
      }
    }
    if (!assigned) break; // every type exhausted
  }
  return quotas;
}

/**
 * Picks a media type at random, weighted by share (used by the Discover
 * picker so the swipe feed mixes types like the user's taste does).
 */
export function pickMediaTypeWeighted(
  shares: Record<string, number>,
  availableTypes: Set<string>,
  random: () => number = Math.random,
): string | null {
  const entries = Object.entries(shares).filter(([t, s]) => s > 0 && availableTypes.has(t));
  if (entries.length === 0) return null;
  const sum = entries.reduce((acc, [, s]) => acc + s, 0);
  let roll = random() * sum;
  for (const [type, share] of entries) {
    roll -= share;
    if (roll <= 0) return type;
  }
  return entries[entries.length - 1]![0];
}

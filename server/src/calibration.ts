export interface ScoredLabel {
  score: number;
  label: 0 | 1;
}

export function expectedCalibrationError(items: ScoredLabel[], bins = 10): number {
  if (items.length === 0) return 0;
  const buckets: ScoredLabel[][] = Array.from({ length: bins }, () => []);
  for (const item of items) {
    const clamped = Math.min(0.9999999, Math.max(0, item.score));
    const idx = Math.floor(clamped * bins);
    buckets[idx]!.push(item);
  }
  const n = items.length;
  let ece = 0;
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const avgScore = bucket.reduce((s, b) => s + b.score, 0) / bucket.length;
    const empirical = bucket.reduce((s, b) => s + b.label, 0) / bucket.length;
    ece += (bucket.length / n) * Math.abs(avgScore - empirical);
  }
  return ece;
}

export function calibrationTable(items: ScoredLabel[], bins = 10): Array<{
  bin: number; n: number; avgScore: number; empirical: number;
}> {
  const buckets: ScoredLabel[][] = Array.from({ length: bins }, () => []);
  for (const item of items) {
    const clamped = Math.min(0.9999999, Math.max(0, item.score));
    buckets[Math.floor(clamped * bins)]!.push(item);
  }
  return buckets.map((bucket, bin) => ({
    bin,
    n: bucket.length,
    avgScore: bucket.length ? bucket.reduce((s, b) => s + b.score, 0) / bucket.length : 0,
    empirical: bucket.length ? bucket.reduce((s, b) => s + b.label, 0) / bucket.length : 0,
  }));
}

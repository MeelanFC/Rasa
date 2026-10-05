/**
 * Maps a candidate's raw ML score to the displayed "match %".
 *
 * The raw ML score is cosine-similarity based, so it is structurally small: a
 * single title scored against a blended taste profile tops out near ~0.2 no
 * matter how good the match. A fixed sigmoid therefore squashed every surfaced
 * pick into a narrow ~55–70% band - the "everything is 64%" problem.
 *
 * Instead we show RELATIVE match strength: where a candidate's score sits between
 * the median candidate and the best candidate in the same pool, stretched across
 * a legible band. The pool's best pick reads near the ceiling; weaker (but still
 * surfaced) picks trail off; below-median candidates fall under the floor.
 * Ranking is unaffected - this only changes the number shown.
 */
export interface PoolScoreReference {
  /** Median raw score across the full candidate pool. */
  median: number;
  /** Best (max) raw score across the full candidate pool. */
  max: number;
}

const RELATIVE_FLOOR = 55;
const RELATIVE_CEILING = 97;
const DISPLAY_MIN = 15;
const DISPLAY_MAX = 99;
const COLD_START_MAX = 75;

export function calibrateMatchPercent(
  mlScore: number,
  pool: PoolScoreReference,
  useMl: boolean,
  popularityScore: number,
): number {
  if (!useMl) {
    // Cold start: weak taste signal, lean on popularity (the unified 0..1 score
    // from popularity.ts) for a gentle 35..75 gradient.
    const known = Math.max(0, Math.min(1, popularityScore));
    return clamp(Math.round(35 + 40 * known), DISPLAY_MIN, COLD_START_MAX);
  }

  const range = pool.max - pool.median;
  if (range < 1e-6) {
    // Pool scores are indistinguishable - nothing meaningful to spread.
    return Math.round((RELATIVE_FLOOR + RELATIVE_CEILING) / 2);
  }

  const t = (mlScore - pool.median) / range;
  const percent = RELATIVE_FLOOR + (RELATIVE_CEILING - RELATIVE_FLOOR) * t;
  return clamp(Math.round(percent), DISPLAY_MIN, DISPLAY_MAX);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

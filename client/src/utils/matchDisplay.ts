/**
 * Match-percent display policy: digits only when the model is confident.
 *
 * A "47%" next to a "94%" reads as "the app thinks this is mediocre" - the
 * user skips it, it never gets rated, and that media type's signal stays weak
 * (a self-reinforcing loop). Below the confidence line we show honest words
 * instead of false precision.
 */
export const MATCH_DIGITS_THRESHOLD = 70;

export function matchDisplay(matchPercent: number): string {
  if (matchPercent >= MATCH_DIGITS_THRESHOLD) return `${matchPercent}% Match`;
  if (matchPercent >= 55) return "Good match";
  if (matchPercent >= 40) return "Worth a look";
  return "Wildcard";
}

/** Compact variant for small grid badges. */
export function matchDisplayShort(matchPercent: number): string {
  if (matchPercent >= MATCH_DIGITS_THRESHOLD) return `${matchPercent}%`;
  if (matchPercent >= 55) return "Good match";
  if (matchPercent >= 40) return "Worth a look";
  return "Wildcard";
}

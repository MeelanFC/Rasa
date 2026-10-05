/**
 * After a vote or bookmark click on a grid card, the card must not flip back
 * into its hover state until the pointer leaves it. TradingCard and
 * RecommendationGridCard sit side by side and share this one flag; it used to
 * live on `window` behind an `any` cast.
 */
let suppressed = false;

export function suppressHoverUntilLeave(): void {
  suppressed = true;
}

export function releaseHoverSuppression(): void {
  suppressed = false;
}

export function isHoverSuppressed(): boolean {
  return suppressed;
}

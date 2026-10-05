import type { DownvoteReason } from "./types.js";

/** Stored on the rated title's negative taste profile. */
export function downReasonFeature(reason: DownvoteReason): string {
  return `down-reason:${reason}`;
}

/**
 * Extra negative weight on feature prefixes when the user picked a downvote chip.
 * Kept simple: category-level nudges, not per-tag inference.
 */
export function downReasonCategoryBoost(
  reason: DownvoteReason,
  feature: string,
): number {
  const category = feature.includes(":") ? feature.slice(0, feature.indexOf(":")) : feature;

  // Boosts applied multiplicatively to a -3 delta. Previously 1.35–1.4 made a
  // single reason-tagged downvote outweigh several plain upvotes; tightened
  // to 1.15–1.20 so reasons reinforce rather than dominate.
  switch (reason) {
    case "pacing":
      return matchesCategory(category, ["episodes", "status", "alist-tag", "theme"]) ? 1.18 : 1;
    case "art":
      return matchesCategory(category, ["studio", "animator", "producer"]) ? 1.2 : 1;
    case "genre":
      return matchesCategory(category, ["genre", "theme", "demo", "alist-tag"]) ? 1.18 : 1;
    case "length":
      return matchesCategory(category, ["episodes", "format"]) ? 1.2 : 1;
    case "dropped":
      // A verdict on the whole title; no single feature category to blame.
      return 1;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

function matchesCategory(category: string, allowed: string[]): boolean {
  return allowed.includes(category);
}

import type { Reaction } from "./types.js";

/** Fast skip without a vote: weak negative on title features. */
export const FAST_SKIP_DWELL_MS = 2_000;

/** Long dwell before thumbs-up: weak positive reinforcement. */
export const LONG_DWELL_MS = 8_000;

/** Watching most of an episode (5+ min): strong implicit positive. */
export const EPISODE_WATCH_MS = 5 * 60 * 1_000;

/** Implicit signals stay weaker than binary votes. */
export const IMPLICIT_UP_WEIGHT = 0.35;
/** A skip now explicitly means "don't know it" (its own button), so it carries
 *  only a whisper of negative signal - unknown ≠ disliked. */
export const IMPLICIT_DOWN_WEIGHT = -0.1;

export interface EngagementSignalInput {
  malId: number;
  dwellMs: number;
  skipped: boolean;
  reaction?: Reaction;
}

/**
 * Converts dwell/skip into weak taste deltas for the title's feature vector.
 */
export function implicitReactionFromEngagement(
  input: EngagementSignalInput,
): Reaction | null {
  if (input.reaction) {
    if (input.reaction === "up" && input.dwellMs >= LONG_DWELL_MS) {
      return "up";
    }
    if (input.skipped && input.dwellMs < FAST_SKIP_DWELL_MS) {
      return "down";
    }
    return null;
  }

  if (input.skipped && input.dwellMs < FAST_SKIP_DWELL_MS) {
    return "down";
  }

  if (input.dwellMs >= EPISODE_WATCH_MS) {
    return "up";
  }

  return null;
}

export function implicitWeightForReaction(reaction: Reaction): number {
  return reaction === "up" ? IMPLICIT_UP_WEIGHT : IMPLICIT_DOWN_WEIGHT;
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnimeCard } from "@/types";

/** Keep outgoing card visible while the user finishes a click gesture. */
export const VOTE_INTERACTION_LOCK_MS = 250;
/** Minimum time the next card must be on screen before votes re-enable. */
export const CARD_SETTLE_MS = 300;

export type DiscoverTransitionPhase = "idle" | "frozen" | "settling";

export function useDiscoverVoteTransition() {
  const [phase, setPhase] = useState<DiscoverTransitionPhase>("idle");
  const [frozenCard, setFrozenCard] = useState<AnimeCard | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const resetTransition = useCallback(() => {
    clearTimers();
    setFrozenCard(null);
    setPhase("idle");
  }, [clearTimers]);

  const beginTransition = useCallback(
    (card: AnimeCard) => {
      clearTimers();
      setFrozenCard(card);
      setPhase("frozen");

      const revealTimer = setTimeout(() => {
        setFrozenCard(null);
        setPhase("settling");
      }, VOTE_INTERACTION_LOCK_MS);

      const idleTimer = setTimeout(() => {
        setPhase("idle");
      }, VOTE_INTERACTION_LOCK_MS + CARD_SETTLE_MS);

      timersRef.current = [revealTimer, idleTimer];
    },
    [clearTimers],
  );

  const votesLocked = phase !== "idle";

  const resolveDisplayCard = useCallback(
    (current: AnimeCard | undefined): AnimeCard | undefined => {
      if (phase === "frozen" && frozenCard) {
        return frozenCard;
      }
      return current;
    },
    [phase, frozenCard],
  );

  return {
    phase,
    votesLocked,
    beginTransition,
    resetTransition,
    resolveDisplayCard,
  };
}

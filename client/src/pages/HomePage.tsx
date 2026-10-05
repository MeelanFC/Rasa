import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNextQueue,
  submitEngagementSignal,
  submitRating,
  submitWatchlist,
} from "@/api";
import {
  DiscoverVoteBar,
  type DiscoverVotePayload,
} from "@/components/DiscoverVoteBar";
import { SwipeCard } from "@/components/SwipeCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDiscoverVoteTransition } from "@/hooks/useDiscoverVoteTransition";
import type { AnimeCard, Reaction } from "@/types";
import { dedupeByMalId, mergeDiscoverQueue } from "@/utils/mergeDiscoverQueue";

/** Votes arm this long after a new card appears. One beat of "do I actually
 *  know this?" - the cheap guard against the mindless speed-swiping that
 *  poisoned the early taste data. */
const VOTE_ARM_DELAY_MS = 600;

// Bumped when the buttons change meaning, so the hint shows once more.
const VOTE_HINT_DISMISSED_KEY = "rasa.voteHintDismissed.v2";

function safeLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    const store = window.localStorage;
    return typeof store?.getItem === "function" ? store : null;
  } catch {
    return null; // unavailable in some test/embedded environments
  }
}

export function HomePage() {
  const queryClient = useQueryClient();
  const [localQueue, setLocalQueue] = useState<AnimeCard[]>([]);
  // The card whose votes are armed. Any other card reads as disarmed, so a new
  // card needs no state reset; only the arm timer below re-enables voting.
  const [armedMalId, setArmedMalId] = useState<number | null>(null);
  const [showVoteHint, setShowVoteHint] = useState(
    () => safeLocalStorage()?.getItem(VOTE_HINT_DISMISSED_KEY) !== "1",
  );
  const { phase, votesLocked, beginTransition, resetTransition, resolveDisplayCard } =
    useDiscoverVoteTransition();

  const excludedFromDiscoverRef = useRef<Set<number>>(new Set());
  const voteGuardRef = useRef(false);
  const cardShownAtRef = useRef(0); // set when a card is shown
  const lastCardMalIdRef = useRef<number | null>(null);
  const votedMalIdRef = useRef<number | null>(null);

  const nextQuery = useQuery({
    queryKey: ["next-queue"],
    queryFn: fetchNextQueue,
    retry: (failureCount, error) => {
      if (error.message.includes("busy")) {
        return failureCount < 2;
      }
      return failureCount < 1;
    },
  });

  useEffect(() => {
    if (!nextQuery.data) return;
    const unrated = dedupeByMalId(
      nextQuery.data.filter((card) => !excludedFromDiscoverRef.current.has(card.malId)),
    );
    setLocalQueue((current) => {
      if (current.length === 0) {
        return unrated;
      }
      return mergeDiscoverQueue(unrated, current, excludedFromDiscoverRef.current);
    });
  }, [nextQuery.data]);

  const rateMutation = useMutation({
    mutationFn: ({
      malId,
      reaction,
      dwellMs,
      reason,
    }: {
      malId: number;
      reaction: Reaction;
      dwellMs: number;
      reason?: DiscoverVotePayload["reason"];
    }) => submitRating(malId, reaction, { dwellMs, reason }),
    onSuccess: (serverQueue) => {
      const dedupedServer = dedupeByMalId(serverQueue);
      queryClient.setQueryData(["next-queue"], dedupedServer);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      setLocalQueue((current) =>
        mergeDiscoverQueue(dedupedServer, current, excludedFromDiscoverRef.current),
      );
    },
  });

  const watchlistMutation = useMutation({
    mutationFn: (malId: number) => submitWatchlist(malId),
    onSuccess: (serverQueue) => {
      const dedupedServer = dedupeByMalId(serverQueue);
      queryClient.setQueryData(["next-queue"], dedupedServer);
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      setLocalQueue((current) =>
        mergeDiscoverQueue(dedupedServer, current, excludedFromDiscoverRef.current),
      );
    },
  });

  const current = localQueue[0];
  const currentMalId = current?.malId;
  const upcoming = useMemo(() => localQueue.slice(1), [localQueue]);
  const votesArmed = currentMalId !== undefined && armedMalId === currentMalId;

  useEffect(() => {
    if (currentMalId === undefined) {
      return;
    }

    const previousMalId = lastCardMalIdRef.current;
    if (
      previousMalId !== null &&
      previousMalId !== currentMalId &&
      votedMalIdRef.current !== previousMalId
    ) {
      const dwellMs = Date.now() - cardShownAtRef.current;
      void submitEngagementSignal(previousMalId, dwellMs, true).catch(() => {
        // fail soft; taste signal is optional
      });
    }

    lastCardMalIdRef.current = currentMalId;
    cardShownAtRef.current = Date.now();
    votedMalIdRef.current = null;

    const armTimer = window.setTimeout(() => setArmedMalId(currentMalId), VOTE_ARM_DELAY_MS);
    return () => window.clearTimeout(armTimer);
  }, [currentMalId]);

  useEffect(() => {
    upcoming.forEach((card) => {
      const img = new Image();
      img.src = card.imageUrl;
    });
  }, [upcoming]);

  // After an action the server may return an empty queue (refill in progress,
  // e.g. right after a restart). Poll until cards arrive instead of stranding
  // the user on a skeleton - and never roll a rated card back onto the deck.
  const {
    refetch: refetchQueue,
    isLoading: queueLoading,
    isFetching: queueFetching,
    dataUpdatedAt: queueUpdatedAt,
  } = nextQuery;
  useEffect(() => {
    if (current || queueLoading || queueFetching) return;
    const pollTimer = window.setTimeout(() => {
      void refetchQueue();
    }, 1_500);
    return () => window.clearTimeout(pollTimer);
  }, [current, queueLoading, queueFetching, queueUpdatedAt, refetchQueue]);

  const rollbackDiscoverAction = (card: AnimeCard) => {
    excludedFromDiscoverRef.current.delete(card.malId);
    setLocalQueue((queue) => {
      if (queue.some((entry) => entry.malId === card.malId)) {
        return queue;
      }
      return [card, ...queue];
    });
  };

  useEffect(() => {
    if (!votesLocked) {
      voteGuardRef.current = false;
    }
  }, [votesLocked]);

  const handleVote = ({ reaction, reason }: DiscoverVotePayload) => {
    if (!current || votesLocked || voteGuardRef.current) return;
    voteGuardRef.current = true;

    const cardSnapshot = current;
    const ratedId = current.malId;
    const dwellMs = Date.now() - cardShownAtRef.current;
    votedMalIdRef.current = ratedId;
    beginTransition(cardSnapshot);
    excludedFromDiscoverRef.current.add(ratedId);
    setLocalQueue((queue) => queue.filter((card) => card.malId !== ratedId));
    rateMutation.mutate(
      { malId: ratedId, reaction, dwellMs, reason },
      {
        onError: () => {
          votedMalIdRef.current = null;
          resetTransition();
          rollbackDiscoverAction(cardSnapshot);
          void nextQuery.refetch();
        },
      },
    );
  };

  const handleWatchlist = () => {
    if (!current || votesLocked || voteGuardRef.current) return;
    voteGuardRef.current = true;

    const cardSnapshot = current;
    const savedId = current.malId;
    beginTransition(cardSnapshot);
    excludedFromDiscoverRef.current.add(savedId);
    setLocalQueue((queue) => queue.filter((card) => card.malId !== savedId));
    watchlistMutation.mutate(savedId, {
      onError: () => {
        resetTransition();
        rollbackDiscoverAction(cardSnapshot);
        void nextQuery.refetch();
      },
    });
  };

  const displayCard = resolveDisplayCard(current);
  const cardDimmed = phase === "frozen";

  if (nextQuery.isLoading && !current) {
    return <DiscoverSkeleton />;
  }

  if (nextQuery.isError && !current) {
    return (
      <Card className="m-auto max-w-md border-destructive/40 p-6 text-center">
        <h2 className="text-lg font-semibold text-destructive">
          Could not load titles
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {nextQuery.error.message}
        </p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => void nextQuery.refetch()}
        >
          Try again
        </Button>
      </Card>
    );
  }

  if (!current) {
    const emptyMessage =
      rateMutation.error?.message ??
      nextQuery.error?.message ??
      "No new titles left to rate right now.";

    if (nextQuery.isError || rateMutation.isError) {
      return (
        <Card className="m-auto max-w-md border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">Could not load the next title</h2>
          <p className="mt-2 text-sm text-muted-foreground">{emptyMessage}</p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => {
              void nextQuery.refetch();
            }}
          >
            Try again
          </Button>
        </Card>
      );
    }

    return <DiscoverSkeleton />;
  }

  return (
    <section className="flex h-full min-h-0 flex-col animate-in fade-in duration-500">
      <div className="flex min-h-0 flex-1 items-stretch">
        {displayCard && (
          <SwipeCard
            key={displayCard.malId}
            anime={displayCard}
            dimmed={cardDimmed}
            showVoteButtons={false}
            onReact={(reaction) => handleVote({ reaction })}
          />
        )}
      </div>

      {showVoteHint && (
        <div
          className="flex items-center justify-center gap-3 border-t border-border/50 bg-accent/40 px-4 py-2 text-xs text-foreground"
          data-testid="vote-hint"
        >
          <span>
            Judge each card from its poster and synopsis: <strong>Pass</strong> or{" "}
            <strong>Would watch</strong>. Already seen it? <strong>Liked it</strong> or{" "}
            <strong>Dropped</strong>. Every tap trains your picks.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 text-xs"
            onClick={() => {
              safeLocalStorage()?.setItem(VOTE_HINT_DISMISSED_KEY, "1");
              setShowVoteHint(false);
            }}
          >
            Got it
          </Button>
        </div>
      )}
      <div
        className={`transition-opacity duration-300 ${votesArmed ? "opacity-100" : "pointer-events-none opacity-45"}`}
      >
        <DiscoverVoteBar
          disabled={votesLocked || !votesArmed}
          onVote={handleVote}
          onWatchlist={handleWatchlist}
        />
      </div>

    </section>
  );
}

function DiscoverSkeleton() {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <Skeleton className="aspect-[16/10] w-full shrink-0 rounded-none md:aspect-auto md:h-full md:w-[42%]" />
        <div className="flex flex-1 flex-col gap-3 p-6">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-10/12" />
          <div className="mt-auto flex gap-5">
            <Skeleton className="h-14 w-14 rounded-full" />
            <Skeleton className="h-14 w-14 rounded-full" />
          </div>
        </div>
      </Card>
    </section>
  );
}


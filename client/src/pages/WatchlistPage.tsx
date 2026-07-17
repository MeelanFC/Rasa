import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bookmark, Play, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { fetchWatchlist, removeFromWatchlist, submitDetailRating } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Reaction } from "@/types";

export function WatchlistPage() {
  const queryClient = useQueryClient();

  const watchlistQuery = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
  });

  const removeMutation = useMutation({
    mutationFn: removeFromWatchlist,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      void queryClient.invalidateQueries({ queryKey: ["next-queue"] });
    },
  });

  // "Watched it" verdict: the highest-quality signal the engine can get (a true
  // watched-label), and the entry graduates off the to-watch list.
  const verdictMutation = useMutation({
    mutationFn: async ({ malId, reaction }: { malId: number; reaction: Reaction }) => {
      await submitDetailRating(malId, reaction);
      await removeFromWatchlist(malId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["taste-combos"] });
      void queryClient.invalidateQueries({ queryKey: ["next-queue"] });
    },
  });

  if (watchlistQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[2/3] w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (watchlistQuery.isError) {
    return (
      <Card className="mx-auto max-w-md border-destructive/40 p-6 text-center">
        <h2 className="text-lg font-semibold text-destructive">
          Could not load watchlist
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {watchlistQuery.error.message}
        </p>
      </Card>
    );
  }

  const entries = watchlistQuery.data ?? [];

  return (
    <section className="space-y-6 pb-8">
      <header>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl">
          <Bookmark className="h-7 w-7 text-primary" />
          Watchlist
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your what-to-watch-next list. Watched something? Give it a 👍/👎 verdict.
          That teaches the engine and clears it off the list.
        </p>
      </header>

      {entries.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing saved yet. Tap the bookmark on Discover or a detail page.
          </p>
          <Button variant="outline" asChild className="mt-4">
            <Link to="/">Browse Discover</Link>
          </Button>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {entries.map((entry) => (
            <li key={entry.malId} className="group relative flex flex-col justify-between">
              <Link
                to={`/anime/${entry.malId}`}
                className="block flex-1"
                aria-label={`${entry.titleEn}, view details`}
              >
                <Card className="overflow-hidden border-border/70 transition-all hover:-translate-y-0.5 hover:border-primary/40">
                  <div className="relative aspect-[2/3] w-full bg-black">
                    <img
                      src={entry.imageUrl}
                      alt={entry.titleEn}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                    {entry.mediaType === "manhwa" && (
                      <Badge className="absolute left-1.5 top-1.5 text-[0.65rem]">
                        Manhwa
                      </Badge>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-card via-card/90 to-transparent p-2 pt-6">
                      <p className="line-clamp-2 text-xs font-semibold leading-tight">
                        {entry.titleEn}
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>

              <div className="mt-2 flex gap-1.5">
                {entry.mediaType === "manhwa" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    asChild
                    className="flex-1 text-xs gap-1 shadow-sm border border-border/40"
                  >
                    <Link to={`/anime/${entry.malId}`}>
                      Details
                    </Link>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    asChild
                    className="flex-1 text-xs gap-1 shadow-md shadow-primary/10"
                  >
                    <Link to={`/watch/${entry.malId}`}>
                      <Play className="h-3 w-3 fill-current" />
                      Watch
                    </Link>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    verdictMutation.mutate({ malId: entry.malId, reaction: "up" })
                  }
                  disabled={verdictMutation.isPending}
                  className="px-2 border-success/40 text-success hover:bg-success/15 transition-colors"
                  aria-label={`Watched ${entry.titleEn}: loved it`}
                  title="Watched it: loved it"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    verdictMutation.mutate({ malId: entry.malId, reaction: "down" })
                  }
                  disabled={verdictMutation.isPending}
                  className="px-2 border-destructive/40 text-destructive hover:bg-destructive/15 transition-colors"
                  aria-label={`Watched ${entry.titleEn}: not for me`}
                  title="Watched it: not for me"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeMutation.mutate(entry.malId)}
                  disabled={removeMutation.isPending}
                  className="px-2 border-border hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label="Remove from watchlist without a verdict"
                  title="Remove without a verdict"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {removeMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {removeMutation.error.message}
        </p>
      )}
    </section>
  );
}

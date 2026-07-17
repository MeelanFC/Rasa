import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { fetchProfile } from "@/api";
import { RecommendationGridCard } from "@/components/RecommendationGridCard";
import { TasteEnginePanel } from "@/components/TasteEnginePanel";
import { TasteRules } from "@/components/TasteRules";
import { TradingCard } from "@/components/TradingCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ProfilePage() {
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: fetchProfile,
  });

  if (profileQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid max-w-3xl grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (profileQuery.isError) {
    return (
      <Card className="mx-auto max-w-md border-destructive/40 p-6 text-center">
        <h2 className="text-lg font-semibold text-destructive">
          Profile unavailable
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {profileQuery.error.message}
        </p>
      </Card>
    );
  }

  if (!profileQuery.data) return null;

  // Cold start: with zero votes there is no taste to show. Point to Discover
  // instead of rendering an empty lineup.
  if (profileQuery.data.totalRatings === 0) {
    return (
      <Card className="mx-auto mt-10 max-w-md border-dashed p-8 text-center">
        <h2 className="text-lg font-semibold">No taste profile yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your lineup appears here after your first few votes. Head to Discover
          and start swiping. The engine learns from every tap.
        </p>
        <Button asChild className="mt-4">
          <Link to="/">Start swiping</Link>
        </Button>
      </Card>
    );
  }

  const {
    topPicks,
    recommendations,
    history,
    reactionCounts,
    totalRatings,
    taste,
    enginePhase,
    catalogStats,
  } = profileQuery.data;

  return (
    <section className="space-y-8 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Your lineup
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalRatings} {totalRatings === 1 ? "vote" : "votes"} ·{" "}
            {enginePhase === "learning" ? "still learning" : "personalized"} · tap
            a card for details
            {catalogStats && (
              <>
                {" "}
                · {catalogStats.unratedFranchises} franchises left to discover
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success" className="gap-1.5 py-1">
            <ThumbsUp className="h-3 w-3" />
            {reactionCounts.up}
          </Badge>
          <Badge variant="destructive" className="gap-1.5 py-1">
            <ThumbsDown className="h-3 w-3" />
            {reactionCounts.down}
          </Badge>
        </div>
      </header>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Top picks for you</h3>
        {topPicks.length === 0 ? (
          <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">
            Vote on Discover to build your lineup.
          </Card>
        ) : (
          <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
            {topPicks.map((anime, index) => (
              <TradingCard key={anime.malId} anime={anime} rank={index + 1} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Recommendations</h3>
        {recommendations.length === 0 ? (
          <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">
            Keep voting on Discover; more matches will show up here.
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {recommendations.map((anime) => (
              <RecommendationGridCard key={anime.malId} anime={anime} />
            ))}
          </div>
        )}
      </section>

      <TasteRules />

      <TasteEnginePanel taste={taste} />

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Your votes</h3>
        {history.length === 0 ? (
          <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing yet. Head to Discover and start voting.
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Most recent first
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 p-3 pt-0">
              {history.map((entry) => (
                <Link
                  key={`${entry.malId}-${entry.ratedAt}`}
                  to={`/anime/${entry.malId}`}
                  className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-accent"
                >
                  <img
                    src={entry.imageUrl}
                    alt=""
                    className="h-14 w-10 shrink-0 rounded-sm object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <h4 className="line-clamp-1 text-sm font-medium">
                      {entry.titleEn}
                    </h4>
                    <p className="line-clamp-1 text-xs italic text-muted-foreground">
                      {entry.titleRomaji}
                    </p>
                  </div>
                  {entry.reaction === "up" ? (
                    <Badge variant="success" className="gap-1.5">
                      <ThumbsUp className="h-3 w-3" />
                      Up
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1.5">
                      <ThumbsDown className="h-3 w-3" />
                      Down
                    </Badge>
                  )}
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </section>
  );
}

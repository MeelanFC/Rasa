import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { submitRating, submitWatchlist } from "@/api";
import {
  isHoverSuppressed,
  releaseHoverSuppression,
  suppressHoverUntilLeave,
} from "@/utils/hoverSuppression";
import { matchDisplayShort } from "@/utils/matchDisplay";
import type { ScoredAnime, Reaction } from "@/types";

interface RecommendationGridCardProps {
  anime: ScoredAnime;
}

export function RecommendationGridCard({ anime }: RecommendationGridCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const queryClient = useQueryClient();

  const rateMutation = useMutation({
    mutationFn: ({ malId, reaction }: { malId: number; reaction: Reaction }) =>
      submitRating(malId, reaction),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["next-queue"] });
    },
  });

  const watchlistMutation = useMutation({
    mutationFn: (malId: number) => submitWatchlist(malId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      void queryClient.invalidateQueries({ queryKey: ["next-queue"] });
    },
  });

  const handleVote = (e: React.MouseEvent, reaction: Reaction) => {
    e.preventDefault();
    e.stopPropagation();
    suppressHoverUntilLeave();
    rateMutation.mutate({ malId: anime.malId, reaction });
  };

  const handleWatchlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    suppressHoverUntilLeave();
    watchlistMutation.mutate(anime.malId);
  };

  const handleMouseEnter = () => {
    checkHoverActive();
  };

  const handleMouseMove = () => {
    checkHoverActive();
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    releaseHoverSuppression();
  };

  const checkHoverActive = () => {
    if (isHoverSuppressed()) {
      setIsHovered(false);
      return;
    }
    setIsHovered(true);
  };

  const isVoting = rateMutation.isPending || watchlistMutation.isPending;

  return (
    <Link
      to={`/anime/${anime.malId}`}
      className="group block relative"
      aria-label={`${anime.titleEn}, ${matchDisplayShort(anime.matchPercent)}`}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Card className="overflow-hidden border-border/70 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-black">
          <img
            src={anime.imageUrl}
            alt={anime.titleEn}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />

          {/* Quick Vote Overlay on Hover */}
          <div className={`absolute inset-0 bg-background/80 backdrop-blur-[3px] transition-opacity flex flex-col items-center justify-center gap-2.5 z-10 duration-200 ${isHovered ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <p className="text-foreground text-[0.6rem] font-bold tracking-wider uppercase select-none">Quick Vote</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => handleVote(e, "down")}
                disabled={isVoting}
                className="p-2 rounded-full bg-destructive/90 hover:bg-destructive text-white hover:scale-110 active:scale-95 transition-all shadow-md hover:shadow-destructive/30 border border-destructive/20 disabled:opacity-50"
                title="Pass"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => handleWatchlist(e)}
                disabled={isVoting}
                className="p-2 rounded-full bg-secondary hover:bg-muted text-white hover:scale-110 active:scale-95 transition-all shadow-md border border-border/50 disabled:opacity-50"
                title="Would watch"
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => handleVote(e, "up")}
                disabled={isVoting}
                className="p-2 rounded-full bg-success/90 hover:bg-success text-white hover:scale-110 active:scale-95 transition-all shadow-md hover:shadow-success/30 border border-success/20 disabled:opacity-50"
                title="Liked it"
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="absolute right-1.5 top-1.5">
            <Badge className="text-[0.65rem] bg-card/90 backdrop-blur-md text-foreground font-semibold border border-border/50 px-1.5 py-0.5 shadow-md">
              {matchDisplayShort(anime.matchPercent)}
            </Badge>
          </div>
          {anime.mediaType !== "anime" && (
            <div className="absolute left-1.5 top-1.5">
              <Badge variant="secondary" className="text-[0.6rem] px-1.5 py-0.5 bg-card/80 backdrop-blur-md border border-border/50 shadow-sm">
                {anime.mediaType === "tv" ? "📺" : anime.mediaType === "movie" ? "🎬" : "📖"}
              </Badge>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-card via-card/95 to-transparent p-2 pt-7">
            <p className="line-clamp-2 text-xs font-semibold leading-tight">
              {anime.titleEn}
            </p>
            {anime.tasteSignals.length > 0 && (
              <p className="mt-0.5 line-clamp-1 text-[0.6rem] text-primary/80 flex items-center gap-0.5">
                <Sparkles className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{anime.tasteSignals.join(" · ")}</span>
              </p>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

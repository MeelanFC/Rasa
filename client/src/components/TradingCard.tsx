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
import { matchDisplay } from "@/utils/matchDisplay";
import type { ScoredAnime, Reaction } from "@/types";

interface TradingCardProps {
  anime: ScoredAnime;
  rank: number;
}

export function TradingCard({ anime, rank }: TradingCardProps) {
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
      aria-label={`#${rank} ${anime.titleEn}`}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Card className="overflow-hidden border-border/70 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-black">
          <img
            src={anime.imageUrl}
            alt={anime.titleEn}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />

          {/* Quick Vote Overlay on Hover */}
          <div className={`absolute inset-0 bg-background/80 backdrop-blur-[3px] transition-opacity flex flex-col items-center justify-center gap-3 z-10 duration-200 ${isHovered ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <p className="text-foreground text-[0.65rem] font-bold tracking-wider uppercase select-none">Quick Vote</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => handleVote(e, "down")}
                disabled={isVoting}
                className="p-2.5 rounded-full bg-destructive/90 hover:bg-destructive text-white hover:scale-110 active:scale-95 transition-all shadow-md hover:shadow-destructive/30 border border-destructive/20 disabled:opacity-50"
                title="Pass"
              >
                <ThumbsDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => handleWatchlist(e)}
                disabled={isVoting}
                className="p-2.5 rounded-full bg-secondary hover:bg-muted text-white hover:scale-110 active:scale-95 transition-all shadow-md border border-border/50 disabled:opacity-50"
                title="Would watch"
              >
                <Bookmark className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => handleVote(e, "up")}
                disabled={isVoting}
                className="p-2.5 rounded-full bg-success/90 hover:bg-success text-white hover:scale-110 active:scale-95 transition-all shadow-md hover:shadow-success/30 border border-success/20 disabled:opacity-50"
                title="Liked it"
              >
                <ThumbsUp className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="absolute left-2 top-2">
            <Badge variant="warning" className="font-bold tracking-wide shadow-lg shadow-warning/20 bg-warning text-amber-950 px-2 py-0.5 border-none">
              #{rank}
            </Badge>
          </div>
          <div className="absolute right-2 top-2">
            <Badge className="bg-card/90 backdrop-blur-md text-foreground font-semibold border border-border/50 px-2 py-0.5 shadow-md">
              {matchDisplay(anime.matchPercent)}
            </Badge>
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-card via-card/90 to-transparent p-3 pt-8">
            <h3 className="line-clamp-1 text-sm font-semibold">{anime.titleEn}</h3>
            <p className="line-clamp-1 text-xs italic text-muted-foreground">
              {anime.titleRomaji}
            </p>
            {anime.tasteSignals.length > 0 && (
              <p className="mt-1 line-clamp-1 text-[0.7rem] text-primary/85 flex items-center gap-1">
                <Sparkles className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  Matches your taste:{" "}
                  <span className="font-medium">{anime.tasteSignals.join(" · ")}</span>
                </span>
              </p>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

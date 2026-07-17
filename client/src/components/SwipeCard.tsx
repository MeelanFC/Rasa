import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSynopsis } from "@/utils/formatSynopsis";
import type { AnimeCard as AnimeCardData, Reaction } from "@/types";

interface SwipeCardProps {
  anime: AnimeCardData;
  dimmed?: boolean;
  disabled?: boolean;
  onReact: (reaction: Reaction) => void;
  showVoteButtons?: boolean;
}

function chapterLabel(count: number): string {
  return count === 1 ? "1 chapter available" : `${count} chapters available`;
}

export function SwipeCard({
  anime,
  dimmed = false,
  disabled = false,
  onReact,
  showVoteButtons = true,
}: SwipeCardProps) {
  const synopsisParagraphs = formatSynopsis(anime.synopsis);
  const showChapters =
    anime.mediaType === "manhwa" && typeof anime.chapterCount === "number";

  return (
    <Card
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border-border/70 bg-card/60 backdrop-blur-xl transition-opacity duration-300 md:flex-row",
        dimmed && "pointer-events-none opacity-50",
      )}
    >
      <div className="relative isolate aspect-[16/10] w-full shrink-0 max-h-[35dvh] overflow-hidden bg-black md:aspect-auto md:max-h-none md:h-full md:w-[42%] md:min-w-[18rem]">
        <img
          src={anime.imageUrl}
          alt={anime.titleEn}
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent md:bg-gradient-to-r md:from-card/90 md:via-transparent md:to-transparent"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5 md:p-7">
        <header className="space-y-1">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            {anime.titleEn}
          </h2>
          <p className="text-sm italic text-muted-foreground md:text-base">
            {anime.titleRomaji}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {anime.mediaType === "manhwa" && (
              <Badge variant="secondary" className="text-xs">
                Manhwa · full color
              </Badge>
            )}
            {anime.mediaType === "tv" && (
              <Badge variant="secondary" className="text-xs">
                📺 TV Show
              </Badge>
            )}
            {anime.mediaType === "movie" && (
              <Badge variant="secondary" className="text-xs">
                🎬 Movie
              </Badge>
            )}
            {anime.genres.slice(0, 4).map((genre) => (
              <Badge key={genre} variant="outline" className="text-xs text-muted-foreground">
                {genre}
              </Badge>
            ))}
            {showChapters && (
              <p className="text-sm font-medium text-primary">
                {chapterLabel(anime.chapterCount as number)}
              </p>
            )}
          </div>
          {anime.cast && anime.cast.length > 0 && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground/80">Starring:</span>{" "}
              {anime.cast.join(", ")}
            </p>
          )}
        </header>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto scrollbar-thin pr-1 text-sm leading-relaxed text-foreground/85 md:text-[0.95rem]">
          {synopsisParagraphs.map((paragraph, index) => (
            <p key={index} className="mb-3 last:mb-0">
              {paragraph}
            </p>
          ))}
        </div>

        {showVoteButtons && (
          <div className="mt-5 flex shrink-0 items-center justify-center gap-5 md:justify-start">
            <Button
              type="button"
              variant="destructive"
              size="icon-lg"
              disabled={disabled}
              onClick={() => onReact("down")}
              aria-label="Thumbs down, not for me"
              className="shadow-lg shadow-destructive/30 transition-transform active:scale-95"
            >
              <ThumbsDown className="h-6 w-6" />
            </Button>
            <Button
              type="button"
              variant="success"
              size="icon-lg"
              disabled={disabled}
              onClick={() => onReact("up")}
              aria-label="Thumbs up, I'd watch this"
              className="shadow-lg shadow-success/30 transition-transform active:scale-95"
            >
              <ThumbsUp className="h-6 w-6" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}



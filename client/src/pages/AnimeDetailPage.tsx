import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Play, Star, X } from "lucide-react";
import {
  fetchAnimeDetail,
  removeFromWatchlist,
  submitDetailRating,
  submitWatchlist,
} from "@/api";
import { VoteButtons, type DetailVotePayload } from "@/components/VoteButtons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function AnimeDetailPage() {
  const { malId } = useParams();
  const parsedId = Number(malId);
  const isValidId = Number.isInteger(parsedId) && parsedId > 0;
  const queryClient = useQueryClient();
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["anime-detail", parsedId],
    queryFn: () => fetchAnimeDetail(parsedId),
    enabled: isValidId,
  });

  const voteMutation = useMutation({
    mutationFn: ({ reaction, reason }: DetailVotePayload) =>
      submitDetailRating(parsedId, reaction, { reason }),
    onSuccess: ({ detail }) => {
      queryClient.setQueryData(["anime-detail", parsedId], detail);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["next-queue"] });
    },
  });

  const watchlistMutation = useMutation({
    mutationFn: async (currentlyWatchlisted: boolean) => {
      if (currentlyWatchlisted) {
        await removeFromWatchlist(parsedId);
        const detail = await fetchAnimeDetail(parsedId);
        return { ...detail, isWatchlisted: false };
      }
      await submitWatchlist(parsedId);
      const detail = await fetchAnimeDetail(parsedId);
      return { ...detail, isWatchlisted: true };
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(["anime-detail", parsedId], detail);
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      void queryClient.invalidateQueries({ queryKey: ["next-queue"] });
    },
  });

  if (!isValidId) {
    return (
      <Card className="mx-auto max-w-md border-destructive/40 p-6 text-center">
        <h2 className="text-lg font-semibold text-destructive">
          Invalid anime id
        </h2>
        <Button variant="outline" asChild className="mt-4">
          <Link to="/profile">Back to profile</Link>
        </Button>
      </Card>
    );
  }

  if (detailQuery.isLoading) {
    return <DetailSkeleton />;
  }

  if (detailQuery.isError) {
    return (
      <Card className="mx-auto max-w-md border-destructive/40 p-6 text-center">
        <h2 className="text-lg font-semibold text-destructive">
          Could not load anime
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {detailQuery.error.message}
        </p>
        <Button variant="outline" asChild className="mt-4">
          <Link to="/profile">Back to profile</Link>
        </Button>
      </Card>
    );
  }

  if (!detailQuery.data) return null;
  const anime = detailQuery.data;

  return (
    <section className="space-y-8 pb-12">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/profile">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </Button>

      <header className="grid gap-6 md:grid-cols-[minmax(220px,260px)_1fr]">
        <Card className="overflow-hidden">
          <div className="aspect-[2/3] w-full bg-black">
            <img
              src={anime.imageUrl}
              alt={anime.titleEn}
              className="h-full w-full object-cover"
            />
          </div>
        </Card>
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              {anime.titleEn}
            </h1>
            <p className="mt-1 text-base italic text-muted-foreground">
              {anime.titleRomaji}
            </p>
          </div>

          <VoteButtons
            userReaction={anime.userReaction}
            isWatchlisted={anime.isWatchlisted}
            disabled={voteMutation.isPending || watchlistMutation.isPending}
            onVote={(payload) => voteMutation.mutate(payload)}
            onWatchlistToggle={() =>
              watchlistMutation.mutate(anime.isWatchlisted)
            }
          />

          {(voteMutation.isError || watchlistMutation.isError) && (
            <p className="text-sm text-destructive" role="alert">
              {(voteMutation.error ?? watchlistMutation.error)?.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {anime.score !== null && (
              <Badge variant="warning" className="gap-1.5 py-1">
                <Star className="h-3 w-3" />
                {anime.score.toFixed(2)}
              </Badge>
            )}
            {anime.rank !== null && (
              <Badge variant="secondary" className="py-1">
                Rank #{anime.rank}
              </Badge>
            )}
            {anime.popularity !== null && (
              <Badge variant="secondary" className="py-1">
                Popularity #{anime.popularity}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {anime.genres.map((tag) => (
              <Badge key={`g-${tag}`}>{tag}</Badge>
            ))}
            {anime.themes.map((tag) => (
              <Badge key={`t-${tag}`} variant="outline">
                {tag}
              </Badge>
            ))}
            {anime.demographics.map((tag) => (
              <Badge key={`d-${tag}`} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {anime.malUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={anime.malUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  {anime.mediaType === "manhwa"
                    ? "MangaDex"
                    : anime.mediaType === "tv" || anime.mediaType === "movie"
                      ? "TMDB"
                      : "MyAnimeList"}
                </a>
              </Button>
            )}
            {anime.mediaType !== "manhwa" && anime.mediaType !== "tv" && anime.mediaType !== "movie" && (
              <Button variant="default" size="sm" asChild className="gap-2 shadow-lg shadow-primary/20">
                <Link to={`/watch/${parsedId}`}>
                  <Play className="h-4 w-4 fill-primary-foreground/30" />
                  Watch
                </Link>
              </Button>
            )}
            {anime.trailerUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPlayerOpen(true)}
                className="gap-2 border-primary/50 text-primary hover:bg-primary/10 shadow-lg shadow-primary/5"
              >
                <Play className="h-4 w-4 fill-primary/20" />
                Trailer
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader>
            <CardTitle>Synopsis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-foreground/85">
            <p>{anime.synopsis}</p>
            {anime.background && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  Background
                </h3>
                <p>{anime.background}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Facts</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Fact label="Status" value={anime.status} />
              <Fact label="Aired" value={anime.aired} />
              <Fact label="Episodes" value={anime.episodes} />
              <Fact label="Duration" value={anime.duration} />
              <Fact label="Rating" value={anime.ageRating} />
              <Fact label="Source" value={anime.source} />
              <Fact
                label={
                  anime.mediaType === "tv" || anime.mediaType === "movie"
                    ? "Cast"
                    : "Studios"
                }
                value={anime.studios.join(", ") || null}
              />
              {(anime.mediaType === "tv" || anime.mediaType === "movie") && (
                <Fact
                  label="Watch On"
                  value={anime.producers.join(", ") || null}
                />
              )}
              <Fact
                label="Members"
                value={anime.members?.toLocaleString() ?? null}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      {anime.mediaType !== "tv" && anime.mediaType !== "movie" && (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Characters</h2>
        {anime.characters.length === 0 ? (
          <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
            No character data from Jikan.
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {anime.characters.map((character) => (
              <li key={character.malId}>
                <Card className="flex h-full overflow-hidden">
                  {character.imageUrl ? (
                    <img
                      src={character.imageUrl}
                      alt={character.name}
                      className="h-24 w-20 shrink-0 object-cover"
                    />
                  ) : (
                    <div className="h-24 w-20 shrink-0 bg-muted" />
                  )}
                  <div className="flex flex-col justify-center p-3 text-sm">
                    <p className="line-clamp-1 font-medium">{character.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {character.role}
                    </p>
                    {character.voiceActor && (
                      <p className="line-clamp-1 text-xs italic text-muted-foreground">
                        {character.voiceActor}
                      </p>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {anime.mediaType !== "tv" && anime.mediaType !== "movie" && (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Jikan also recommends</h2>
        {anime.recommendations.length === 0 ? (
          <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
            No recommendations returned.
          </Card>
        ) : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {anime.recommendations.map((rec) => (
              <li key={rec.malId}>
                <Link to={`/anime/${rec.malId}`} className="group block">
                  <Card className="overflow-hidden transition-all group-hover:-translate-y-1 group-hover:border-primary/40">
                    <div className="aspect-[2/3] bg-black">
                      <img
                        src={rec.imageUrl}
                        alt={rec.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <p className="line-clamp-2 p-2 text-xs text-muted-foreground">
                      {rec.title}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {/* Glassmorphic Built-in Media Player Modal */}
      {isPlayerOpen && anime.trailerUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200"
          onClick={() => setIsPlayerOpen(false)}
        >
          <div
            className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-card/95 p-1 shadow-2xl shadow-primary/10 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header info */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div>
                <h3 className="font-semibold text-sm leading-none">{anime.titleEn}</h3>
                <p className="text-xs text-muted-foreground mt-1">Official PV / Trailer</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsPlayerOpen(false)}
                className="h-8 w-8 rounded-full hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Video aspect wrapper */}
            <div className="relative aspect-video w-full bg-black">
              <iframe
                src={getYouTubeEmbedUrl(anime.trailerUrl) ?? ""}
                title={`${anime.titleEn} Trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-none"
              ></iframe>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function getYouTubeEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    const videoId = match[2];
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&rel=0&modestbranding=1&origin=${window.location.origin}`;
  }
  return url;
}

function Fact({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="text-foreground">{value ?? "-"}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-24" />
      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        <Skeleton className="aspect-[2/3] w-full rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

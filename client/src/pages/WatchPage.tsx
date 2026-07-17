import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Play, ExternalLink, Tv } from "lucide-react";
import { fetchEpisodes, fetchTmdbId, submitEngagementSignal, fetchWatchStreams } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Episode } from "@/types";

const WATCH_THRESHOLD_MS = 23 * 60 * 1000 * 0.7;

const SOURCES = [
  { label: "1", url: (id: number, ep: number) => `https://vidsrc.to/embed/tv/${id}/1/${ep}` },
  { label: "2", url: (id: number, ep: number) => `https://vidsrc.me/embed/tv?tmdb=${id}&season=1&episode=${ep}` },
  { label: "3", url: (id: number, ep: number) => `https://embed.su/embed/tv/${id}/1/${ep}` },
  { label: "4", url: (id: number, ep: number) => `https://2embed.cc/embedtv/${id}&s=1&e=${ep}` },
];

function isGenericTitle(title: string | null, epNumber: number): boolean {
  if (!title) return true;
  return /^Episode\s+\d+$/i.test(title.trim()) || title.trim() === String(epNumber);
}

function storageKey(malId: number) {
  return `rasa_watched_${malId}`;
}
function loadWatched(malId: number): Set<string> {
  try {
    // Fall back to the pre-rename key so existing watched-marks carry over.
    const raw =
      localStorage.getItem(storageKey(malId)) ??
      localStorage.getItem(`anikinator_watched_${malId}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveWatched(malId: number, watched: Set<string>): void {
  try {
    localStorage.setItem(storageKey(malId), JSON.stringify([...watched]));
  } catch {}
}

export function WatchPage() {
  const { malId } = useParams();
  const parsedId = Number(malId);
  const isValidId = Number.isInteger(parsedId) && parsedId > 0;

  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [watched, setWatched] = useState<Set<string>>(() =>
    isValidId ? loadWatched(parsedId) : new Set(),
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedRef = useRef(0);
  const lastStartRef = useRef<number | null>(null);
  const selectedCardRef = useRef<HTMLButtonElement | null>(null);

  const tmdbQuery = useQuery({
    queryKey: ["tmdb", parsedId],
    queryFn: () => fetchTmdbId(parsedId),
    enabled: isValidId,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const episodesQuery = useQuery({
    queryKey: ["episodes", parsedId],
    queryFn: () => fetchEpisodes(parsedId),
    enabled: isValidId,
    staleTime: 5 * 60_000,
  });

  const streamsQuery = useQuery({
    queryKey: ["watchStreams", parsedId],
    queryFn: () => fetchWatchStreams(parsedId),
    enabled: isValidId,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    if (episodesQuery.data?.episodes.length && !selectedEpisode) {
      setSelectedEpisode(episodesQuery.data.episodes[0]);
    }
  }, [episodesQuery.data, selectedEpisode]);

  // Scroll selected episode card into view when it changes
  useEffect(() => {
    selectedCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedEpisode?.id]);

  // Visibility-aware watch timer
  useEffect(() => {
    if (!selectedEpisode) return;

    elapsedRef.current = 0;
    lastStartRef.current = document.hidden ? null : Date.now();
    if (timerRef.current) clearTimeout(timerRef.current);

    const markWatched = () => {
      const key = `e${selectedEpisode.number}`;
      setWatched((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        saveWatched(parsedId, next);
        submitEngagementSignal(parsedId, WATCH_THRESHOLD_MS, false).catch(() => {});
        return next;
      });
    };

    const scheduleRemaining = () => {
      const remaining = Math.max(0, WATCH_THRESHOLD_MS - elapsedRef.current);
      timerRef.current = setTimeout(markWatched, remaining);
    };

    if (!document.hidden) scheduleRemaining();

    const onVisibility = () => {
      if (document.hidden) {
        if (lastStartRef.current !== null) {
          elapsedRef.current += Date.now() - lastStartRef.current;
          lastStartRef.current = null;
        }
        if (timerRef.current) clearTimeout(timerRef.current);
      } else {
        lastStartRef.current = Date.now();
        scheduleRemaining();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selectedEpisode?.id, parsedId]);

  const handleSelectEpisode = (ep: Episode) => {
    setSelectedEpisode(ep);
    setSourceIdx(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!isValidId) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <p className="text-destructive">Invalid anime ID</p>
        <Button variant="outline" asChild className="mt-4">
          <Link to="/">Go to Discover</Link>
        </Button>
      </Card>
    );
  }

  const tmdbId = tmdbQuery.data?.tmdbId;
  const episodes = episodesQuery.data?.episodes ?? [];
  const title = episodesQuery.data?.title ?? "";
  const watchedCount = watched.size;
  const progressPct = episodes.length > 0 ? (watchedCount / episodes.length) * 100 : 0;
  const currentEpTitle =
    selectedEpisode && !isGenericTitle(selectedEpisode.title, selectedEpisode.number)
      ? selectedEpisode.title
      : selectedEpisode
        ? `Episode ${selectedEpisode.number}`
        : null;

  return (
    <section className="pb-8 -mx-4">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 min-w-0 px-4 py-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 shrink-0">
          <Link to={`/anime/${parsedId}`}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
        {title && (
          <h1 className="text-base font-semibold truncate text-foreground/90">{title}</h1>
        )}
      </div>

      {/* ── Player ── edge-to-edge, black bg */}
      <div className="w-full bg-black">
        {tmdbQuery.isLoading ? (
          <Skeleton className="aspect-video w-full rounded-none" />
        ) : tmdbQuery.isError ? (
          <div className="aspect-video flex items-center justify-center bg-card/40 border-y border-border/30">
            <div className="text-center space-y-1.5 p-6">
              <p className="text-sm font-medium text-destructive">
                Iframe player is currently unavailable for this title.
              </p>
              <p className="text-xs text-muted-foreground">
                Please try the direct stream links provided in the panel below!
              </p>
            </div>
          </div>
        ) : tmdbId && selectedEpisode ? (
          <div className="relative aspect-video w-full">
            <iframe
              key={`${tmdbId}-${selectedEpisode.number}-${sourceIdx}`}
              src={SOURCES[sourceIdx].url(tmdbId, selectedEpisode.number)}
              className="absolute inset-0 h-full w-full border-none"
              allowFullScreen
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="origin"
            />
          </div>
        ) : (
          <div className="aspect-video flex items-center justify-center text-sm text-muted-foreground bg-card/20">
            {episodesQuery.isLoading ? "Loading…" : "Select an episode"}
          </div>
        )}
      </div>

      {/* ── Now Playing bar ── */}
      {selectedEpisode && (
        <div className="px-4 py-3 flex items-center justify-between gap-4 border-b border-border/40 bg-card/20">
          <div className="flex items-center gap-3 min-w-0">
            {/* Animated live dot */}
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <div className="min-w-0">
              <p className="text-[0.65rem] font-bold uppercase tracking-widest text-primary leading-none mb-0.5">
                Now Playing
              </p>
              <p className="text-sm text-foreground/80 truncate leading-tight">
                {currentEpTitle}
              </p>
            </div>
            {watched.has(`e${selectedEpisode.number}`) && (
              <Badge variant="secondary" className="gap-1 text-xs shrink-0">
                <CheckCircle2 className="h-3 w-3 text-primary" />
                Watched
              </Badge>
            )}
          </div>

          {/* Server pills */}
          {tmdbId && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[0.65rem] text-muted-foreground mr-0.5 hidden sm:block">
                Server
              </span>
              {SOURCES.map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => setSourceIdx(i)}
                  title={`Switch to server ${s.label}`}
                  className={`w-6 h-6 rounded text-xs font-semibold transition-all ${
                    i === sourceIdx
                      ? "bg-primary text-primary-foreground shadow shadow-primary/30"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Episode list ── */}
      <div className="px-4 pt-5 space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {episodesQuery.isLoading
              ? "Loading episodes…"
              : `${episodes.length} Episode${episodes.length !== 1 ? "s" : ""}`}
          </h2>
          {episodes.length > 0 && (
            <div className="flex items-center gap-2.5">
              {watchedCount > 0 && (
                <span className="text-xs text-primary font-semibold">
                  {watchedCount}/{episodes.length}
                </span>
              )}
              <div className="w-24 h-1 bg-border/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary/60 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Cards - horizontal scroll */}
        {episodesQuery.isLoading ? (
          <div className="flex gap-3 overflow-x-hidden pb-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="shrink-0 w-36 h-[6.5rem] rounded-lg" />
            ))}
          </div>
        ) : episodesQuery.isError ? (
          <p className="text-sm text-destructive py-2">
            {episodesQuery.error.message}
          </p>
        ) : episodes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No episode data found.</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin -mx-4 px-4">
            {episodes.map((ep) => {
              const isSelected = selectedEpisode?.id === ep.id;
              const isWatched = watched.has(`e${ep.number}`);
              const epTitle = !isGenericTitle(ep.title, ep.number) ? ep.title : null;

              return (
                <button
                  key={ep.id}
                  ref={(el) => {
                    if (isSelected) selectedCardRef.current = el;
                  }}
                  onClick={() => handleSelectEpisode(ep)}
                  className={`group shrink-0 w-36 text-left rounded-lg overflow-hidden border transition-all duration-200 ${
                    isSelected
                      ? "border-primary shadow-lg shadow-primary/25 scale-[1.02]"
                      : "border-border/50 hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-md"
                  }`}
                >
                  {/* Thumbnail area */}
                  <div
                    className={`relative h-[4.5rem] flex items-center justify-center overflow-hidden ${
                      isSelected ? "bg-primary/10" : "bg-muted/40"
                    }`}
                  >
                    {/* Large dim number as texture */}
                    <span
                      className={`text-5xl font-black select-none leading-none ${
                        isSelected ? "text-primary/15" : "text-foreground/8"
                      }`}
                    >
                      {String(ep.number).padStart(2, "0")}
                    </span>

                    {/* State overlay */}
                    {isSelected ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Play className="h-7 w-7 text-primary fill-primary/30 drop-shadow-md" />
                      </div>
                    ) : isWatched ? (
                      <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                        <CheckCircle2 className="h-5 w-5 text-primary/60" />
                      </div>
                    ) : null}

                    {/* Ep number chip */}
                    <span
                      className={`absolute top-1.5 left-1.5 text-[0.58rem] font-semibold leading-none px-1 py-0.5 rounded ${
                        isSelected
                          ? "bg-primary/20 text-primary"
                          : "bg-background/40 text-muted-foreground"
                      }`}
                    >
                      EP {ep.number}
                    </span>
                  </div>

                  {/* Title */}
                  <div
                    className={`px-2 py-1.5 min-h-[2rem] ${
                      isSelected ? "bg-primary/5" : "bg-card"
                    }`}
                  >
                    <p
                      className={`text-[0.68rem] leading-snug line-clamp-2 ${
                        isSelected
                          ? "text-primary font-semibold"
                          : isWatched
                            ? "text-muted-foreground/60"
                            : "text-muted-foreground"
                      }`}
                    >
                      {epTitle ?? `Episode ${ep.number}`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Direct Streaming Links Panel ── */}
      <div className="mx-4 mt-8 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_32px_rgba(0,0,0,0.4)] space-y-5">
        <div className="flex items-center gap-2 border-b border-white/10 pb-3">
          <Tv className="h-4.5 w-4.5 text-primary" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-foreground/90">
            Direct Streaming Links
          </h2>
        </div>

        {streamsQuery.isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-10 w-full rounded-xl bg-white/5" />
            <Skeleton className="h-10 w-full rounded-xl bg-white/5" />
          </div>
        ) : streamsQuery.isError ? (
          <p className="text-xs text-muted-foreground">Failed to load streaming links.</p>
        ) : !streamsQuery.data?.streams || streamsQuery.data.streams.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 italic">
            No direct external streaming links crawled for this title. Use the player servers above.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Official streams */}
            {streamsQuery.data.streams.some((s) => s.type === "official") && (
              <div className="space-y-2">
                <p className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
                  Official Platforms
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {streamsQuery.data.streams
                    .filter((s) => s.type === "official")
                    .map((stream, idx) => {
                      const nameLower = stream.name.toLowerCase();
                      let brandStyle = "bg-white/10 text-white hover:bg-white/20";
                      if (nameLower.includes("crunchyroll")) {
                        brandStyle = "bg-[#f47521] text-white hover:bg-[#ff8533] shadow-md shadow-[#f47521]/20";
                      } else if (nameLower.includes("netflix")) {
                        brandStyle = "bg-[#e50914] text-white hover:bg-[#ff1f2d] shadow-md shadow-[#e50914]/20";
                      } else if (nameLower.includes("hulu")) {
                        brandStyle = "bg-[#1ce783] text-black hover:bg-[#2eff9a] shadow-md shadow-[#1ce783]/20";
                      } else if (nameLower.includes("disney")) {
                        brandStyle = "bg-[#0063e5] text-white hover:bg-[#1f7aff] shadow-md shadow-[#0063e5]/20";
                      } else if (nameLower.includes("bilibili")) {
                        brandStyle = "bg-[#00aeec] text-white hover:bg-[#20beff] shadow-md shadow-[#00aeec]/20";
                      }

                      return (
                        <a
                          key={idx}
                          href={stream.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 ${brandStyle}`}
                        >
                          {stream.name}
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-80" />
                        </a>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Alternative/Unofficial streams */}
            {streamsQuery.data.streams.some((s) => s.type !== "official") && (
              <div className="space-y-2">
                <p className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
                  Alternative Streams
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {streamsQuery.data.streams
                    .filter((s) => s.type !== "official")
                    .map((stream, idx) => (
                      <a
                        key={idx}
                        href={stream.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/10 transition-all duration-200 group"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-semibold text-foreground/90 truncate leading-tight group-hover:text-primary transition-colors">
                            {stream.name}
                          </p>
                          {stream.title && (
                            <p className="text-[0.65rem] text-muted-foreground truncate leading-tight mt-0.5">
                              {stream.title}
                            </p>
                          )}
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                      </a>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

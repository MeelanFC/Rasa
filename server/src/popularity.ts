import type { MediaType } from "./types.js";

/**
 * The anime table's `popularity` column means something different per source:
 *
 *   - anime (Jikan / MAL):  the popularity RANK. 1 is the most popular title
 *                           on MyAnimeList; ~25,000 is the fringe.
 *   - tv, movie (TMDB):     TMDB's popularity score. Mainstream titles sit in
 *                           the hundreds, blockbusters in the low thousands.
 *   - manhwa (MangaDex):    follower count. The most followed titles pass 100k.
 *
 * Comparing those raw numbers as "bigger = more popular" is what made the
 * franchise de-duplicator show "Naruto: Special" instead of "Naruto": for anime
 * a bigger number means LESS popular. Anything that asks "how well known is
 * this title" goes through popularityScore(), which maps all three onto one
 * 0..1 scale where higher always means more popular. The stored column is
 * left as the source gave it.
 */
const MAL_RANK_FLOOR = 30_000;
const TMDB_POPULARITY_CEILING = 5_000;
const MANGADEX_FOLLOWERS_CEILING = 300_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function popularityScore(
  mediaType: MediaType,
  raw: number | null | undefined,
): number {
  if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  switch (mediaType) {
    case "anime":
      // rank 1 -> 1.0, 10 -> 0.78, 100 -> 0.55, 1,000 -> 0.33, 30,000+ -> 0.
      // A missing rank is stored as a very large number and lands at 0.
      return clamp01(1 - Math.log10(raw) / Math.log10(MAL_RANK_FLOOR));
    case "tv":
    case "movie":
      return clamp01(Math.log10(1 + raw) / Math.log10(1 + TMDB_POPULARITY_CEILING));
    case "manhwa":
      return clamp01(Math.log10(1 + raw) / Math.log10(1 + MANGADEX_FOLLOWERS_CEILING));
  }
}

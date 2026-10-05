export const REACTIONS = ["up", "down"] as const;

export type Reaction = (typeof REACTIONS)[number];

/** Optional detail on a down vote. The first four are "why" chips; `dropped`
 *  means the user started watching and did not finish - a verdict on a title
 *  they tried, not a pass on a poster. */
export const DOWNVOTE_REASONS = ["pacing", "art", "genre", "length", "dropped"] as const;

export type DownvoteReason = (typeof DOWNVOTE_REASONS)[number];

/** Stronger binary signal: clearer taste profile over time. */
export const REACTION_WEIGHTS: Record<Reaction, number> = {
  up: 2.5,
  down: -3,
};

/** Explicit swipes (votes or would-watch saves) before the learned model
 *  takes over from info-gain exploration. */
export const COLD_START_RATINGS = 10;

export type FeatureWeights = Record<string, number>;

export type MediaType = "anime" | "manhwa" | "tv" | "movie";

export interface AnimeRow {
  mal_id: number;
  franchise_key: string | null;
  title_en: string;
  title_jp: string;
  synopsis: string;
  image_url: string;
  genres: string;
  themes: string;
  demographics: string;
  score: number | null;
  popularity: number;
  media_type: MediaType;
  mangadex_id: string | null;
  chapter_count: number | null;
  features_json: string;
}

export interface AnimeCard {
  malId: number;
  franchiseKey: string;
  titleEn: string;
  titleRomaji: string;
  synopsis: string;
  imageUrl: string;
  genres: string[];
  themes: string[];
  /** Top-billed names: lead cast (film/TV) or main characters (anime). */
  cast?: string[];
  score: number | null;
  mediaType: MediaType;
  chapterCount: number | null;
}

export interface RatingRow {
  mal_id: number;
  reaction: Reaction;
  rated_at: string;
  down_reason: DownvoteReason | null;
}

export interface EngagementSignalRow {
  mal_id: number;
  dwell_ms: number;
  skipped: number;
}

export interface ScoredAnime extends AnimeCard {
  matchScore: number;
  matchPercent: number;
  topGenres: string[];
  /** Why this recommendation surfaced - the candidate's strongest features as
   *  weighted by the user's ENTIRE rating history, humanized for display.
   *  Empty during cold start or when no meaningful signal overlaps. */
  tasteSignals: string[];
}

export interface WatchlistEntry extends AnimeCard {
  addedAt: string;
}

export interface WatchlistRow {
  mal_id: number;
  added_at: string;
}



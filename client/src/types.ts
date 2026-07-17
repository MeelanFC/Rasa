export const REACTIONS = ["up", "down"] as const;

export type Reaction = (typeof REACTIONS)[number];

export const DOWNVOTE_REASONS = ["pacing", "art", "genre", "length"] as const;

export type DownvoteReason = (typeof DOWNVOTE_REASONS)[number];

export type MediaType = "anime" | "manhwa" | "tv" | "movie";

export interface AnimeCard {
  malId: number;
  franchiseKey?: string;
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

export interface ScoredAnime extends AnimeCard {
  matchScore: number;
  matchPercent: number;
  topGenres: string[];
  tasteSignals: string[];
}

export interface HistoryEntry extends AnimeCard {
  reaction: Reaction;
  ratedAt: string;
}

export interface WatchlistEntry extends AnimeCard {
  addedAt: string;
}

export interface TastePatternFeature {
  name: string;
  upCount: number;
  downCount: number;
  upRate: number;
  contrast: number;
  weight: number;
}

export interface TastePatterns {
  minSample: number;
  upLeaning: TastePatternFeature[];
  downLeaning: TastePatternFeature[];
}

export interface TasteMetrics {
  reactionWeights: Record<Reaction, number>;
  topFeatures: Array<{ name: string; weight: number }>;
  patterns?: TastePatterns;
  signals: string[];
  jikanEndpointsUsed: Array<{ path: string; purpose: string }>;
  strategy: {
    coldStart: string;
    exploitation: string;
    exploration: string;
    lovedBoost: string;
  };
}

export interface TasteCombo {
  key: string;
  features: string[];
  label: string;
  likeCount: number;
  downCount: number;
  evidence: string[];
  matchingUnrated: number;
  status: "suggested" | "confirmed" | "rejected";
}

export interface ProfileData {
  topPicks: ScoredAnime[];
  recommendations: ScoredAnime[];
  /** @deprecated Use topPicks; kept for older clients */
  topRecommendations: ScoredAnime[];
  history: HistoryEntry[];
  reactionCounts: Record<Reaction, number>;
  totalRatings: number;
  taste: TasteMetrics;
  enginePhase: "learning" | "personalized";
  catalogStats?: {
    unratedFranchises: number;
    catalogEntries: number;
  };
}

export interface AnimeCharacter {
  malId: number;
  name: string;
  role: string;
  imageUrl: string | null;
  voiceActor: string | null;
}

export interface AnimeRecommendation {
  malId: number;
  title: string;
  imageUrl: string;
}

export interface AnimeDetail {
  malId: number;
  mediaType?: MediaType;
  userReaction: Reaction | null;
  isWatchlisted: boolean;
  malUrl: string | null;
  titleEn: string;
  titleRomaji: string;
  synopsis: string;
  background: string | null;
  imageUrl: string;
  trailerUrl: string | null;
  year: number | null;
  season: string | null;
  status: string | null;
  aired: string | null;
  episodes: number | null;
  duration: string | null;
  ageRating: string | null;
  score: number | null;
  scoredBy: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  favorites: number | null;
  source: string | null;
  genres: string[];
  themes: string[];
  demographics: string[];
  explicitGenres: string[];
  studios: string[];
  producers: string[];
  licensors: string[];
  characters: AnimeCharacter[];
  recommendations: AnimeRecommendation[];
}

export interface Episode {
  id: string;
  number: number;
  title: string | null;
}

export interface EpisodesResponse {
  malId: number;
  title: string;
  episodes: Episode[];
}

export interface StreamSource {
  url: string;
  quality: string;
  isM3U8: boolean;
}

export interface StreamResponse {
  sources: StreamSource[];
}

export interface WatchStream {
  name: string;
  title: string;
  url: string;
  image: string | null;
  type: "official" | "unofficial";
}

export interface WatchStreamsResponse {
  malId: number;
  title: string;
  image: string | null;
  streams: WatchStream[];
}



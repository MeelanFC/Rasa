import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  injectPreviewQueueForTests,
  resetPreviewQueueForTests,
  snapshotQueue,
} from "./queue.js";
import { addToWatchlist, resetDiscoverStateForTests } from "./service.js";
import type { AnimeCard } from "./types.js";

const watchlistedMalIds = new Set<number>();

const animeRows = new Map<
  number,
  {
    mal_id: number;
    franchise_key: string;
    title_en: string;
    title_jp: string;
    synopsis: string;
    image_url: string;
    genres: string;
    themes: string;
    demographics: string;
    score: number | null;
    popularity: number;
    media_type: "anime";
    mangadex_id: null;
    chapter_count: null;
    features_json: string;
    cached_at: string;
  }
>();

function card(malId: number): AnimeCard {
  return {
    malId,
    franchiseKey: `franchise-${malId}`,
    titleEn: `Title ${malId}`,
    titleRomaji: `Title ${malId}`,
    synopsis: "synopsis",
    imageUrl: `https://cdn.example.com/${malId}.jpg`,
    genres: ["Action"],
    themes: [],
    score: 8,
    mediaType: "anime",
    chapterCount: null,
  };
}

vi.mock("./jikan.js", () => ({
  fetchTopAnime: vi.fn(),
  fetchSeasonNow: vi.fn(),
  fetchAnimeFull: vi.fn(),
  fetchAnimeDetail: vi.fn(),
  fetchAnimeRelations: vi.fn(),
  fetchAnimeStaff: vi.fn(),
  fetchRecommendationIdsFromLoved: vi.fn().mockResolvedValue([]),
}));

vi.mock("./mangadex.js", () => ({
  fetchManhwaPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  fetchOfficialColoredManhwaPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  fetchMangaChapterTotal: vi.fn(),
}));

vi.mock("./anilist.js", () => ({
  fetchAnilistEnrichment: vi.fn().mockResolvedValue(null),
}));

vi.mock("./simkl-seed.js", () => ({
  fetchSimklTrendingMalIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("./enrichment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enrichment.js")>();
  return {
    ...actual,
    ensurePresentationCached: vi.fn().mockResolvedValue(undefined),
    scheduleRecommendationIngest: vi.fn(),
    scheduleTasteEnrichment: vi.fn(),
    scheduleBulkTasteEnrichment: vi.fn(),
  };
});

vi.mock("./db.js", () => ({
  getAllAnime: () => [...animeRows.values()],
  getAnimeById: (malId: number) => animeRows.get(malId),
  getRatedMalIds: () => new Set<number>(),
  getWatchlistMalIds: () => new Set(watchlistedMalIds),
  getWatchlistFranchiseKeys: () => new Set<string>(),
  getRatedFranchiseKeys: () => new Set<string>(),
  getRatingCount: () => 0,
  getRatings: () => [],
  getProfileHistory: () => [],
  getReactionCounts: () => ({ up: 0, down: 0 }),
  getUserReaction: () => null,
  insertRating: vi.fn(),
  insertWatchlist: (malId: number) => {
    watchlistedMalIds.add(malId);
  },
  removeWatchlist: vi.fn(),
  getWatchlist: () => [],
  isOnWatchlist: (malId: number) => watchlistedMalIds.has(malId),
  getEngagementSignalsForTaste: () => [],
  insertEngagementSignal: vi.fn(),
  getCreditScannedMalIds: () => new Set<number>(),
  getRecentlySkippedMalIds: () => new Set<number>(),
  getExpandedPersonIds: () => new Set<number>(),
  markCreditScanned: vi.fn(),
  markPersonExpanded: vi.fn(),
  rowToCard: (row: {
    mal_id: number;
    title_en: string;
    title_jp: string;
    synopsis: string;
    image_url: string;
    genres: string;
    themes: string;
    score: number | null;
    media_type: "anime";
    chapter_count: number | null;
    franchise_key: string;
  }) => ({
    malId: row.mal_id,
    franchiseKey: row.franchise_key,
    titleEn: row.title_en,
    titleRomaji: row.title_jp,
    synopsis: row.synopsis,
    imageUrl: row.image_url,
    genres: JSON.parse(row.genres) as string[],
    themes: JSON.parse(row.themes) as string[],
    score: row.score,
    mediaType: row.media_type,
    chapterCount: row.chapter_count,
  }),
  safeJsonArray: (raw: string) => JSON.parse(raw) as string[],
  upsertAnime: vi.fn(),
  getWatchStreamsFromDb: () => null,
  insertWatchStreamsIntoDb: vi.fn(),
}));

function seedRow(malId: number): void {
  animeRows.set(malId, {
    mal_id: malId,
    franchise_key: `franchise-${malId}`,
    title_en: `Title ${malId}`,
    title_jp: `Title ${malId}`,
    synopsis:
      "A long enough synopsis so catalog readiness checks pass for watchlist service tests.",
    image_url: `https://cdn.example.com/${malId}.jpg`,
    genres: '["Action"]',
    themes: "[]",
    demographics: "[]",
    score: 8,
    popularity: 1000 - malId,
    media_type: "anime",
    mangadex_id: null,
    chapter_count: null,
    features_json: '["genre:Action"]',
    cached_at: "2026-01-01",
  });
}

describe("addToWatchlist", () => {
  beforeEach(() => {
    animeRows.clear();
    watchlistedMalIds.clear();
    resetPreviewQueueForTests();
    resetDiscoverStateForTests();
    for (let malId = 1; malId <= 5; malId += 1) {
      seedRow(malId);
    }
    injectPreviewQueueForTests([card(1), card(2)]);
  });

  it("drops the title from the queue and records watchlist membership", async () => {
    const queue = await addToWatchlist(1);

    expect(watchlistedMalIds.has(1)).toBe(true);
    expect(queue.every((entry) => entry.malId !== 1)).toBe(true);
    expect(snapshotQueue().every((entry) => entry.malId !== 1)).toBe(true);
  });
});

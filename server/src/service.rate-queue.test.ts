import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  injectPreviewQueueForTests,
  pushQueue,
  resetPreviewQueueForTests,
} from "./queue.js";
import { resetDiscoverStateForTests } from "./service.js";
import type { AnimeCard } from "./types.js";

const ratedMalIds = new Set<number>();

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

vi.mock("./jikan.js", () => ({
  fetchTopAnime: vi.fn(),
  fetchSeasonNow: vi.fn(),
  fetchAnimeFull: vi.fn(),
  fetchAnimeFullTasteMeta: vi.fn().mockResolvedValue({
    studios: [],
    producers: [],
    licensors: [],
    explicitGenres: [],
    source: null,
    episodes: null,
    background: null,
    year: null,
    season: null,
    status: null,
    ageRating: null,
    malScore: null,
    scoredBy: null,
    rank: null,
    popularity: null,
  }),
  fetchAnimeDetail: vi.fn(),
  fetchAnimeRelations: vi.fn(),
  fetchAnimeStaff: vi.fn(),
  fetchAnimeCharacters: vi.fn().mockResolvedValue([]),
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

vi.mock("./db.js", () => ({
  getAllAnime: () => [...animeRows.values()],
  getAnimeById: (malId: number) => animeRows.get(malId),
  getRatedMalIds: () => new Set(ratedMalIds),
  getWatchlistMalIds: () => new Set<number>(),
  getWatchlistFranchiseKeys: () => new Set<string>(),
  getRatedFranchiseKeys: () => new Set<string>(),
  getRatingCount: () => ratedMalIds.size,
  getRatings: () => [],
  getProfileHistory: () => [],
  getReactionCounts: () => ({ up: 0, down: 0, meh: 0 }),
  getUserReaction: () => null,
  insertRating: (malId: number) => {
    ratedMalIds.add(malId);
  },
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
  }) => ({
    malId: row.mal_id,
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
  getEngagementSignalsForTaste: () => [],
  insertEngagementSignal: vi.fn(),
  getCreditScannedMalIds: () => new Set<number>(),
  getRecentlySkippedMalIds: () => new Set<number>(),
  getExpandedPersonIds: () => new Set<number>(),
  markCreditScanned: vi.fn(),
  markPersonExpanded: vi.fn(),
  safeJsonArray: (raw: string) => JSON.parse(raw) as string[],
  upsertAnime: vi.fn(),
  getWatchStreamsFromDb: () => null,
  insertWatchStreamsIntoDb: vi.fn(),
}));

function seedRow(malId: number, titleEn: string): void {
  animeRows.set(malId, {
    mal_id: malId,
    franchise_key: `franchise-${malId}`,
    title_en: titleEn,
    title_jp: titleEn,
    synopsis:
      "A long enough synopsis so catalog readiness checks pass for rate queue tests.",
    image_url: "https://cdn.example.com/poster.jpg",
    genres: '["Action"]',
    themes: "[]",
    demographics: "[]",
    score: 8,
    popularity: 50_000 - malId,
    media_type: "anime",
    mangadex_id: null,
    chapter_count: null,
    features_json: '["genre:Action"]',
    cached_at: "2026-01-01",
  });
}

const sampleCard = (malId: number, titleEn = `Anime ${malId}`): AnimeCard => ({
  malId,
  franchiseKey: `franchise-${malId}`,
  titleEn,
  titleRomaji: titleEn,
  synopsis:
    "A long enough synopsis so catalog readiness checks pass for rate queue tests.",
  imageUrl: "https://example.com/img.jpg",
  genres: [],
  themes: [],
  score: null,
  mediaType: "anime",
  chapterCount: null,
});

function uniqueMalIds(queue: AnimeCard[]): number[] {
  return queue.map((card) => card.malId);
}

describe("rateAnime queue integrity", () => {
  beforeEach(() => {
    animeRows.clear();
    ratedMalIds.clear();
    resetPreviewQueueForTests();
    resetDiscoverStateForTests();
    for (let malId = 1; malId <= 10; malId += 1) {
      seedRow(malId, `Title ${malId}`);
    }
  });

  it("returns unique malIds and never includes the rated card", async () => {
    injectPreviewQueueForTests([
      sampleCard(1),
      sampleCard(1),
      sampleCard(2),
      sampleCard(3),
    ]);

    const { rateAnime } = await import("./service.js");
    const queue = await rateAnime(1, "up");

    const malIds = uniqueMalIds(queue);
    expect(new Set(malIds).size).toBe(malIds.length);
    expect(malIds).not.toContain(1);
    expect(ratedMalIds.has(1)).toBe(true);
  });

  it("skipAnime advances the queue without inserting a rating", async () => {
    injectPreviewQueueForTests([sampleCard(1), sampleCard(2), sampleCard(3)]);

    const { skipAnime } = await import("./service.js");
    const db = await import("./db.js");
    const queue = await skipAnime(1, 1_500);

    expect(uniqueMalIds(queue)).not.toContain(1);
    expect(ratedMalIds.has(1)).toBe(false); // no rating - "don't know it" is not a vote
    expect(db.insertEngagementSignal).toHaveBeenCalledWith(1, 1_500, true);
  });

  it("returns an empty queue (not an error) when the refill hasn't landed yet", async () => {
    // Regression: throwing QueueUnavailableError here made the client treat a
    // SAVED vote as failed and roll the just-rated card back onto the deck.
    injectPreviewQueueForTests([sampleCard(1)]);

    const { rateAnime } = await import("./service.js");
    const queue = await rateAnime(1, "up");

    expect(Array.isArray(queue)).toBe(true);
    expect(uniqueMalIds(queue)).not.toContain(1);
    expect(ratedMalIds.has(1)).toBe(true); // the vote persisted regardless
  });

  it("getNextQueue returns unique malIds only", async () => {
    pushQueue(sampleCard(4));
    pushQueue(sampleCard(5));
    pushQueue(sampleCard(6));
    injectPreviewQueueForTests([
      ...[sampleCard(4), sampleCard(5), sampleCard(6)],
      sampleCard(5),
    ]);

    const { getNextQueue } = await import("./service.js");
    const queue = await getNextQueue();
    const malIds = uniqueMalIds(queue);
    expect(new Set(malIds).size).toBe(malIds.length);
  });
});

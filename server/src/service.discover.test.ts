import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPreviewQueueForTests } from "./queue.js";
import { resetDiscoverStateForTests } from "./service.js";

const fetchTopAnime = vi.fn();
const fetchSeasonNow = vi.fn();
const fetchAnimeFull = vi.fn();
const fetchManhwaPage = vi.fn();
const fetchOfficialColoredManhwaPage = vi.fn();

vi.mock("./jikan.js", () => ({
  fetchTopAnime: (...args: unknown[]) => fetchTopAnime(...args),
  fetchSeasonNow: (...args: unknown[]) => fetchSeasonNow(...args),
  fetchAnimeFull: (...args: unknown[]) => fetchAnimeFull(...args),
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
  fetchManhwaPage: (...args: unknown[]) => fetchManhwaPage(...args),
  fetchOfficialColoredManhwaPage: (...args: unknown[]) =>
    fetchOfficialColoredManhwaPage(...args),
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
    scheduleBulkTasteEnrichment: vi.fn(),
  };
});

const mockFetchTmdbDiscover = vi.fn().mockResolvedValue([]);
const mockFetchTmdbDetail = vi.fn();
const mockHasTmdbCredentials = vi.fn().mockReturnValue(true);
const mockIsTmdbId = vi.fn().mockImplementation((malId: number) => malId >= 1000000);
const mockParseSyntheticId = vi.fn().mockImplementation((malId: number) => {
  if (malId >= 2000000) return { kind: "movie", tmdbId: malId - 2000000 };
  if (malId >= 1000000) return { kind: "tv", tmdbId: malId - 1000000 };
  return null;
});

vi.mock("./tmdb.js", () => ({
  fetchTmdbDiscover: (...args: unknown[]) => mockFetchTmdbDiscover(...args),
  fetchTmdbDetail: (...args: unknown[]) => mockFetchTmdbDetail(...args),
  hasTmdbCredentials: (...args: unknown[]) => mockHasTmdbCredentials(...args),
  isTmdbId: (...args: unknown[]) => mockIsTmdbId(...args),
  parseSyntheticId: (...args: unknown[]) => mockParseSyntheticId(...args),
}));

const animeRows = new Map<
  number,
  {
    mal_id: number;
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
    franchise_key: string | null;
    cached_at: string;
  }
>();

vi.mock("./db.js", () => ({
  getAllAnime: () => [...animeRows.values()],
  getAnimeById: (malId: number) => animeRows.get(malId),
  getRatedMalIds: () => new Set<number>(),
  getWatchlistMalIds: () => new Set<number>(),
  getWatchlistFranchiseKeys: () => new Set<string>(),
  getRatedFranchiseKeys: () => new Set<string>(),
  getRatingCount: () => 0,
  getRatings: () => [],
  getProfileHistory: () => [],
  getReactionCounts: () => ({ up: 0, down: 0, meh: 0 }),
  getUserReaction: () => null,
  insertRating: vi.fn(),
  rowToCard: (row: (typeof animeRows extends Map<number, infer R> ? R : never)) => ({
    malId: row.mal_id,
    franchiseKey: row.franchise_key ?? row.title_en.toLowerCase(),
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

function seedRow(malId: number, titleEn: string, popularity: number): void {
  animeRows.set(malId, {
    mal_id: malId,
    title_en: titleEn,
    title_jp: titleEn,
    synopsis:
      "A long enough synopsis so catalog readiness checks pass for discover service tests.",
    image_url: "https://cdn.example.com/poster.jpg",
    genres: '["Action"]',
    themes: "[]",
    demographics: "[]",
    score: 8,
    popularity,
    media_type: "anime",
    mangadex_id: null,
    chapter_count: null,
    features_json: '["genre:Action"]',
    franchise_key: null,
    cached_at: "2026-01-01",
  });
}

describe("Discover hot path", () => {
  beforeEach(() => {
    animeRows.clear();
    resetPreviewQueueForTests();
    resetDiscoverStateForTests();
    fetchTopAnime.mockReset();
    fetchSeasonNow.mockReset();
    fetchAnimeFull.mockReset();
    fetchManhwaPage.mockResolvedValue({ items: [], total: 0 });
    fetchOfficialColoredManhwaPage.mockResolvedValue({ items: [], total: 0 });

    for (let malId = 1; malId <= 200; malId += 1) {
      seedRow(malId, `Title ${malId}`, 50_000 - malId);
    }
  });

  afterEach(() => {
    resetPreviewQueueForTests();
    resetDiscoverStateForTests();
    vi.clearAllMocks();
  });

  it("does not block buildNextCard on prepareCatalog when the pool is large", async () => {
    const { getNextQueue } = await import("./service.js");

    await getNextQueue();

    expect(fetchTopAnime).not.toHaveBeenCalled();
    expect(fetchSeasonNow).not.toHaveBeenCalled();
  });

  it("triggers TMDB movie and TV show refills when starved, even if anime pool is abundant", async () => {
    mockFetchTmdbDiscover.mockClear();
    mockHasTmdbCredentials.mockReturnValue(true);

    const { getNextQueue } = await import("./service.js");

    await getNextQueue();

    // Allow background prepareCatalog to run
    await new Promise((resolve) => setTimeout(resolve, 50));

    // It should have triggered TMDB refills because tvCount (0) and movieCount (0) are low
    expect(mockFetchTmdbDiscover).toHaveBeenCalledWith("tv", expect.any(Number), expect.any(Object));
    expect(mockFetchTmdbDiscover).toHaveBeenCalledWith("movie", expect.any(Number), expect.any(Object));
  });
});

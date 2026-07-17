import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPreviewQueueForTests } from "./queue.js";
import { resetTasteGraphForTests } from "./taste-graph.js";
import { resetDiscoverStateForTests } from "./service.js";

// Mutable rating/watchlist state the db mock reads from (set per test, before
// importing ./service.js). Closures in the mock read the current binding.
let ratedMalIds = new Set<number>();
let ratedFranchiseKeys = new Set<string>();
let watchlistMalIds = new Set<number>();
let watchlistFranchiseKeys = new Set<string>();
let ratings: Array<{ mal_id: number; reaction: "up" | "down"; down_reason: string | null }> = [];

interface Row {
  mal_id: number; title_en: string; title_jp: string; synopsis: string;
  image_url: string; genres: string; themes: string; demographics: string;
  score: number | null; popularity: number; media_type: "anime";
  mangadex_id: null; chapter_count: null; features_json: string;
  franchise_key: string | null; cached_at: string;
}
const animeRows = new Map<number, Row>();

vi.mock("./jikan.js", () => ({
  fetchTopAnime: vi.fn(), fetchSeasonNow: vi.fn(), fetchAnimeFull: vi.fn(),
  fetchAnimeFullTasteMeta: vi.fn().mockResolvedValue({}),
  fetchAnimeDetail: vi.fn(), fetchAnimeRelations: vi.fn(), fetchAnimeStaff: vi.fn(),
  fetchAnimeCharacters: vi.fn().mockResolvedValue([]),
  fetchRecommendationIdsFromLoved: vi.fn().mockResolvedValue([]),
  fetchAnimeByGenre: vi.fn(),
}));
vi.mock("./mangadex.js", () => ({
  fetchManhwaPage: vi.fn(), fetchOfficialColoredManhwaPage: vi.fn(), fetchMangaChapterTotal: vi.fn(),
}));
vi.mock("./anilist.js", () => ({ fetchAnilistEnrichment: vi.fn().mockResolvedValue(null) }));
vi.mock("./simkl-seed.js", () => ({ fetchSimklTrendingMalIds: vi.fn().mockResolvedValue([]) }));
vi.mock("./enrichment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enrichment.js")>();
  return { ...actual, scheduleBulkTasteEnrichment: vi.fn() };
});
vi.mock("./tmdb.js", () => ({
  fetchTmdbDiscover: vi.fn().mockResolvedValue([]), fetchTmdbDetail: vi.fn(),
  hasTmdbCredentials: vi.fn().mockReturnValue(false),
  isTmdbId: vi.fn().mockImplementation((id: number) => id >= 1_000_000),
  parseSyntheticId: vi.fn().mockReturnValue(null),
}));

vi.mock("./db.js", () => ({
  getAllAnime: () => [...animeRows.values()],
  getAnimeById: (malId: number) => animeRows.get(malId),
  getRatedMalIds: () => ratedMalIds,
  getWatchlistMalIds: () => watchlistMalIds,
  getRatedFranchiseKeys: () => ratedFranchiseKeys,
  getWatchlistFranchiseKeys: () => watchlistFranchiseKeys,
  getRatingCount: () => ratings.length,
  getRatings: () => ratings,
  getProfileHistory: () => [],
  getReactionCounts: () => ({
    up: ratings.filter((r) => r.reaction === "up").length,
    down: ratings.filter((r) => r.reaction === "down").length,
    meh: 0,
  }),
  getUserReaction: () => null,
  insertRating: vi.fn(),
  rowToCard: (row: Row) => ({
    malId: row.mal_id,
    franchiseKey: row.franchise_key ?? row.title_en.toLowerCase(),
    titleEn: row.title_en, titleRomaji: row.title_jp, synopsis: row.synopsis,
    imageUrl: row.image_url, genres: JSON.parse(row.genres) as string[],
    themes: JSON.parse(row.themes) as string[], score: row.score,
    mediaType: row.media_type, chapterCount: row.chapter_count,
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

function seedRow(malId: number, titleEn: string, franchiseKey: string | null, features: string[]): void {
  animeRows.set(malId, {
    mal_id: malId, title_en: titleEn, title_jp: titleEn,
    synopsis: "A long enough synopsis so the catalog readiness check passes for these profile tests.",
    image_url: "https://cdn.example.com/poster.jpg",
    genres: '["Action"]', themes: "[]", demographics: "[]",
    score: 8, popularity: 50_000 - malId, media_type: "anime",
    mangadex_id: null, chapter_count: null,
    features_json: JSON.stringify(features), franchise_key: franchiseKey, cached_at: "2026-01-01",
  });
}

describe("Profile recommendations exclude rated/watchlisted franchises", () => {
  beforeEach(() => {
    animeRows.clear();
    ratedMalIds = new Set();
    ratedFranchiseKeys = new Set();
    watchlistMalIds = new Set();
    watchlistFranchiseKeys = new Set();
    ratings = [];
    resetPreviewQueueForTests();
    resetTasteGraphForTests();
    resetDiscoverStateForTests();
  });

  afterEach(() => {
    resetPreviewQueueForTests();
    resetDiscoverStateForTests();
    vi.clearAllMocks();
  });

  it("does not surface a downvoted title's same-franchise duplicate in topPicks or recommendations", async () => {
    // Same franchise, two different mal_ids (e.g. a MAL "anime" row + a TMDB "tv" row).
    seedRow(100, "Miss Kobayashi's Dragon Maid (TV)", "dragonmaid", ["genre:Comedy"]); // downvoted
    seedRow(101, "Miss Kobayashi's Dragon Maid", "dragonmaid", ["genre:Comedy"]); // unrated duplicate
    // Unrelated unrated controls so the grid has a genuine pool to draw from.
    for (let i = 200; i < 215; i += 1) seedRow(i, `Control ${i}`, `control-${i}`, ["genre:Action"]);

    ratedMalIds = new Set([100]);
    ratedFranchiseKeys = new Set(["dragonmaid"]);
    ratings = [{ mal_id: 100, reaction: "down", down_reason: null }];

    const { getProfile } = await import("./service.js");
    const profile = getProfile();

    const surfaced = new Set<number>([
      ...profile.topPicks.map((p) => p.malId),
      ...profile.recommendations.map((p) => p.malId),
    ]);

    // The franchise duplicate (different mal_id, same franchise) must not appear...
    expect(surfaced.has(101)).toBe(false);
    // ...nor the rated title itself...
    expect(surfaced.has(100)).toBe(false);
    // ...but unrelated titles still get recommended (this isn't a blanket wipe).
    expect(surfaced.size).toBeGreaterThan(0);
  });

  it("also blocks watchlisted franchises", async () => {
    seedRow(300, "Steins;Gate", "steinsgate", ["genre:SciFi"]); // on watchlist
    seedRow(301, "Steins;Gate 0", "steinsgate", ["genre:SciFi"]); // unrated same-franchise duplicate
    for (let i = 400; i < 410; i += 1) seedRow(i, `Control ${i}`, `control-${i}`, ["genre:Action"]);

    watchlistMalIds = new Set([300]);
    watchlistFranchiseKeys = new Set(["steinsgate"]);

    const { getProfile } = await import("./service.js");
    const profile = getProfile();

    const surfaced = new Set<number>([
      ...profile.topPicks.map((p) => p.malId),
      ...profile.recommendations.map((p) => p.malId),
    ]);

    expect(surfaced.has(301)).toBe(false);
    expect(surfaced.has(300)).toBe(false);
    expect(surfaced.size).toBeGreaterThan(0);
  });
});

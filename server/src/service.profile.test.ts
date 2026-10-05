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
  getTasteComboRows: () => [],
  setTasteComboStatus: vi.fn(),
  loadTasteNeighborsFromDb: () => [],
  upsertTasteNeighbor: vi.fn(),
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

function seedRow(
  malId: number,
  titleEn: string,
  franchiseKey: string | null,
  features: string[],
  popularity = 50_000 - malId,
): void {
  animeRows.set(malId, {
    mal_id: malId, title_en: titleEn, title_jp: titleEn,
    synopsis: "A long enough synopsis so the catalog readiness check passes for these profile tests.",
    image_url: "https://cdn.example.com/poster.jpg",
    genres: '["Action"]', themes: "[]", demographics: "[]",
    score: 8, popularity, media_type: "anime",
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

describe("Profile ranks with the swiper's real signals", () => {
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

  it("represents a franchise by its most popular entry, not the highest MAL rank number", async () => {
    // For anime the stored popularity is a MAL RANK: 12 is a household name,
    // 9,000 is a special almost nobody has seen.
    seedRow(500, "Naruto", "naruto", ["genre:Action"], 12);
    seedRow(501, "Naruto: Special", "naruto", ["genre:Action"], 9_000);
    for (let i = 600; i < 606; i += 1) seedRow(i, `Control ${i}`, `control-${i}`, ["genre:Action"], 20_000 + i);

    const { getProfile } = await import("./service.js");
    const profile = getProfile();

    const surfaced = [...profile.topPicks, ...profile.recommendations].map((p) => p.malId);
    expect(surfaced).toContain(500);
    expect(surfaced).not.toContain(501);
    expect(profile.topPicks[0]?.malId).toBe(500);
  });

  it("counts would-watch saves toward warm-up", async () => {
    for (let i = 700; i < 712; i += 1) seedRow(i, `Saved ${i}`, `saved-${i}`, ["genre:SciFi"]);
    seedRow(720, "Unrated SciFi", "unrated-scifi", ["genre:SciFi"]);
    watchlistMalIds = new Set(Array.from({ length: 10 }, (_, k) => 700 + k));
    watchlistFranchiseKeys = new Set([...watchlistMalIds].map((id) => `saved-${id}`));

    const { getProfile } = await import("./service.js");
    const profile = getProfile();

    expect(profile.totalRatings).toBe(0);
    expect(profile.totalSignals).toBe(10);
    expect(profile.enginePhase).toBe("personalized");
    expect(profile.topPicks.map((p) => p.malId)).toContain(720);
  });

  it("learns from saves: an unseen title like the saved ones outranks one like the passed ones", async () => {
    for (let i = 800; i < 806; i += 1) seedRow(i, `Saved ${i}`, `saved-${i}`, ["genre:SciFi", "theme:Space"]);
    for (let i = 810; i < 814; i += 1) seedRow(i, `Passed ${i}`, `passed-${i}`, ["genre:Comedy", "theme:School"]);
    seedRow(820, "Target SciFi", "target-scifi", ["genre:SciFi", "theme:Space"]);
    seedRow(821, "Target Comedy", "target-comedy", ["genre:Comedy", "theme:School"]);

    watchlistMalIds = new Set([800, 801, 802, 803, 804, 805]);
    watchlistFranchiseKeys = new Set([...watchlistMalIds].map((id) => `saved-${id}`));
    ratedMalIds = new Set([810, 811, 812, 813]);
    ratedFranchiseKeys = new Set([...ratedMalIds].map((id) => `passed-${id}`));
    ratings = [...ratedMalIds].map((mal_id) => ({ mal_id, reaction: "down" as const, down_reason: null }));

    const { getProfile } = await import("./service.js");
    const profile = getProfile();

    expect(profile.enginePhase).toBe("personalized");
    const order = [...profile.topPicks, ...profile.recommendations].map((p) => p.malId);
    expect(order).toContain(820);
    expect(order).toContain(821);
    expect(order.indexOf(820)).toBeLessThan(order.indexOf(821));
    // Without the saves there would be no positive class at all; the learned
    // probability for the SciFi look-alike must sit clearly above the comedy one.
    const scifi = [...profile.topPicks, ...profile.recommendations].find((p) => p.malId === 820)!;
    const comedy = [...profile.topPicks, ...profile.recommendations].find((p) => p.malId === 821)!;
    expect(scifi.matchScore).toBeGreaterThan(comedy.matchScore);
  });
});

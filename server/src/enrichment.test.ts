import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensurePresentationCached,
  ensureTasteEnriched,
  isTasteEnriched,
  resetRecommendationIngestThrottleForTests,
  scheduleTasteEnrichment,
  TASTE_ENRICHED_MARKER,
} from "./enrichment.js";

vi.mock("./jikan.js", () => ({
  fetchAnimeFull: vi.fn(),
  fetchAnimeFullTasteMeta: vi.fn(),
  fetchAnimeStaff: vi.fn(),
  fetchAnimeCharacters: vi.fn(),
  fetchAnimeRelations: vi.fn(),
}));

vi.mock("./anilist.js", () => ({
  fetchAnilistEnrichment: vi.fn(),
}));

vi.mock("./mangadex.js", () => ({
  fetchMangaChapterTotal: vi.fn(),
}));

vi.mock("./db.js", () => ({
  getAnimeById: vi.fn(),
  upsertAnime: vi.fn(),
}));

import { fetchAnilistEnrichment } from "./anilist.js";
import { getAnimeById, upsertAnime } from "./db.js";
import {
  fetchAnimeCharacters,
  fetchAnimeFull,
  fetchAnimeFullTasteMeta,
  fetchAnimeRelations,
  fetchAnimeStaff,
} from "./jikan.js";

const readyRow = {
  mal_id: 1,
  title_en: "Cowboy Bebop",
  title_jp: "Cowboy Bebop",
  synopsis:
    "In the year 2071, humanity has colonized several planets and moons of the solar system.",
  image_url: "https://cdn.myanimelist.net/img.jpg",
  genres: '["Action"]',
  themes: "[]",
  demographics: "[]",
  score: 8.7,
  popularity: 42,
  media_type: "anime" as const,
  mangadex_id: null,
  chapter_count: null,
  features_json: '["genre:Action"]',
  franchise_key: null,
  cached_at: "2026-01-01",
};

describe("isTasteEnriched", () => {
  it("detects rich features and rejects sparse marker-only rows", () => {
    expect(
      isTasteEnriched(
        JSON.stringify([TASTE_ENRICHED_MARKER, "alist-tag:Male Protagonist", "studio:MAPPA"]),
      ),
    ).toBe(true);
    expect(isTasteEnriched(JSON.stringify(["alist-tag:Male Protagonist"]))).toBe(true);
    expect(isTasteEnriched(JSON.stringify(["alist:Male Protagonist"]))).toBe(true);
    expect(isTasteEnriched(JSON.stringify([TASTE_ENRICHED_MARKER, "genre:Action"]))).toBe(
      false,
    );
    expect(isTasteEnriched(JSON.stringify(["genre:Action"]))).toBe(false);
  });
});

describe("ensurePresentationCached", () => {
  afterEach(() => {
    vi.mocked(fetchAnimeFull).mockReset();
    vi.mocked(getAnimeById).mockReset();
    vi.mocked(upsertAnime).mockReset();
  });

  it("does not call Jikan when the row is already display-ready", async () => {
    vi.mocked(getAnimeById).mockReturnValue(readyRow);

    await ensurePresentationCached(1);

    expect(fetchAnimeFull).not.toHaveBeenCalled();
  });

  it("calls only /full when presentation is missing", async () => {
    vi.mocked(getAnimeById).mockReturnValue(undefined);
    vi.mocked(fetchAnimeFull).mockResolvedValue({
      mal_id: 1,
      title_en: "Cowboy Bebop",
      title_romaji: "Cowboy Bebop",
      synopsis: readyRow.synopsis,
      image_url: readyRow.image_url,
      genres: readyRow.genres,
      themes: readyRow.themes,
      demographics: readyRow.demographics,
      score: 8.7,
      popularity: 42,
    });

    await ensurePresentationCached(1);

    expect(fetchAnimeFull).toHaveBeenCalledTimes(1);
    expect(fetchAnimeStaff).not.toHaveBeenCalled();
    expect(fetchAnimeRelations).not.toHaveBeenCalled();
  });
});

describe("ensureTasteEnriched", () => {
  beforeEach(() => {
    resetRecommendationIngestThrottleForTests();
  });

  afterEach(() => {
    vi.mocked(fetchAnilistEnrichment).mockReset();
    vi.mocked(fetchAnimeFullTasteMeta).mockReset();
    vi.mocked(fetchAnimeStaff).mockReset();
    vi.mocked(fetchAnimeCharacters).mockReset();
    vi.mocked(fetchAnimeRelations).mockReset();
    vi.mocked(getAnimeById).mockReset();
    vi.mocked(upsertAnime).mockReset();
  });

  it("uses AniList first and skips Jikan staff when relations come from AniList", async () => {
    vi.mocked(getAnimeById).mockReturnValue(readyRow);
    vi.mocked(fetchAnimeFullTasteMeta).mockResolvedValue({
      studios: ["Sunrise"],
      producers: ["Bandai Visual"],
      licensors: [],
      explicitGenres: [],
      source: "Original",
      episodes: 26,
      background: null,
      year: null,
      season: null,
      status: null,
      ageRating: null,
      malScore: null,
      scoredBy: null,
      rank: null,
      popularity: null,
    });
    vi.mocked(fetchAnimeCharacters).mockResolvedValue([
      {
        malId: 1,
        name: "Spike Spiegel",
        role: "Main",
        imageUrl: null,
        voiceActor: null,
      },
    ]);
    vi.mocked(fetchAnilistEnrichment).mockResolvedValue({
      tags: ["Male Protagonist"],
      relationTypes: ["sequel"],
      relatedMalIds: [],
      recommendationMalIds: [],
      mainCharacterGenders: ["Male"],
      format: null,
      status: null,
      season: null,
      seasonYear: null,
      averageScore: null,
      popularity: null,
      episodes: null,
      duration: null,
      source: null,
      isAdult: false,
      genres: [],
      studios: [],
      categorizedTags: [],
      animationStudios: [],
      productionStudios: [],
      anilistStaff: [],
    });

    await ensureTasteEnriched(1);

    expect(fetchAnilistEnrichment).toHaveBeenCalledWith(1);
    expect(fetchAnimeRelations).not.toHaveBeenCalled();
    expect(fetchAnimeStaff).toHaveBeenCalledTimes(1);
    expect(upsertAnime).toHaveBeenCalled();
    const upsertArg = vi.mocked(upsertAnime).mock.calls[0]?.[0];
    const features = JSON.parse(upsertArg?.features_json ?? "[]") as string[];
    expect(features).toContain(TASTE_ENRICHED_MARKER);
    expect(features).toContain("studio:Sunrise");
    expect(features).toContain("main:Spike Spiegel");
  });

  it("fetches Jikan relations only when AniList has none", async () => {
    vi.mocked(getAnimeById).mockReturnValue(readyRow);
    vi.mocked(fetchAnimeFullTasteMeta).mockResolvedValue({
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
    });
    vi.mocked(fetchAnimeCharacters).mockResolvedValue([]);
    vi.mocked(fetchAnilistEnrichment).mockResolvedValue({
      tags: [],
      relationTypes: [],
      relatedMalIds: [],
      recommendationMalIds: [],
      mainCharacterGenders: [],
      format: null,
      status: null,
      season: null,
      seasonYear: null,
      averageScore: null,
      popularity: null,
      episodes: null,
      duration: null,
      source: null,
      isAdult: false,
      genres: [],
      studios: [],
      categorizedTags: [],
      animationStudios: [],
      productionStudios: [],
      anilistStaff: [],
    });
    vi.mocked(fetchAnimeRelations).mockResolvedValue([
      { relation: "Sequel", entries: [{ malId: 2, type: "anime", name: "X" }] },
    ]);
    vi.mocked(fetchAnimeStaff).mockResolvedValue([]);

    await ensureTasteEnriched(1);

    expect(fetchAnimeRelations).toHaveBeenCalledTimes(1);
    expect(fetchAnimeStaff).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleTasteEnrichment", () => {
  afterEach(() => {
    resetRecommendationIngestThrottleForTests();
    vi.mocked(getAnimeById).mockReset();
    vi.mocked(fetchAnilistEnrichment).mockReset();
  });

  it("does not re-schedule when already taste-enriched", async () => {
    vi.mocked(getAnimeById).mockReturnValue({
      ...readyRow,
      features_json: JSON.stringify([
        TASTE_ENRICHED_MARKER,
        "alist-tag:Male Protagonist",
        "studio:Sunrise",
      ]),
    });
    vi.mocked(fetchAnilistEnrichment).mockResolvedValue({
      tags: [],
      relationTypes: [],
      relatedMalIds: [],
      recommendationMalIds: [],
      mainCharacterGenders: [],
      format: null,
      status: null,
      season: null,
      seasonYear: null,
      averageScore: null,
      popularity: null,
      episodes: null,
      duration: null,
      source: null,
      isAdult: false,
      genres: [],
      studios: [],
      categorizedTags: [],
      animationStudios: [],
      productionStudios: [],
      anilistStaff: [],
    });

    scheduleTasteEnrichment(1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchAnilistEnrichment).not.toHaveBeenCalled();
  });
});

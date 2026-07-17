import { beforeEach, describe, expect, it, vi } from "vitest";
import { crewByRole, buildTmdbFeatures } from "./tmdb.js";
import * as tmdb from "./tmdb.js";
import * as dbModule from "./db.js";
import {
  TMDB_TASTE_ENRICHED_MARKER,
  isTmdbTasteEnriched,
  withTmdbTasteEnrichedMarker,
  ensureTmdbTasteEnriched,
  scheduleTasteEnrichment,
  resetRecommendationIngestThrottleForTests,
} from "./enrichment.js";

type AnimeRow = ReturnType<typeof dbModule.getAnimeById>;
function fakeRow(overrides: Partial<NonNullable<AnimeRow>>): AnimeRow {
  return {
    mal_id: 2_000_000_550,
    title_en: "Fight Club",
    title_jp: "Fight Club",
    synopsis: "",
    image_url: "",
    genres: "[]",
    themes: "[]",
    demographics: "[]",
    score: null,
    popularity: 0,
    media_type: "movie",
    mangadex_id: null,
    chapter_count: null,
    features_json: "[]",
    franchise_key: null,
    ...overrides,
  } as AnimeRow;
}

describe("crewByRole (widened)", () => {
  const crew = [
    { name: "Bong Joon-ho", job: "Director", department: "Directing" },
    { name: "Han Jin-won", job: "Screenplay", department: "Writing" },
    { name: "Jung Jae-il", job: "Original Music Composer", department: "Sound" },
    { name: "Hong Kyung-pyo", job: "Director of Photography", department: "Camera" },
    { name: "Choi Se-yeon", job: "Costume Design", department: "Costume & Make-Up" },
    { name: "Yang Jin-mo", job: "Editor", department: "Editing" },
    { name: "Lee Ha-jun", job: "Production Design", department: "Art" },
  ];

  it("splits crew into the seven film-relevant roles", () => {
    const out = crewByRole(crew);
    expect(out.directors).toEqual(["Bong Joon-ho"]);
    expect(out.writers).toEqual(["Han Jin-won"]);
    expect(out.composers).toEqual(["Jung Jae-il"]);
    expect(out.cinematographers).toEqual(["Hong Kyung-pyo"]);
    expect(out.costumeDesigners).toEqual(["Choi Se-yeon"]);
    expect(out.editors).toEqual(["Yang Jin-mo"]);
    expect(out.productionDesigners).toEqual(["Lee Ha-jun"]);
  });

  it("does not regress: art directors still excluded from directors", () => {
    const out = crewByRole([{ name: "X", job: "Art Director", department: "Art" }]);
    expect(out.directors).toEqual([]);
  });
});

describe("buildTmdbFeatures emits new staff role features", () => {
  it("includes cinematographer/costume/editor/production-design as staff features", () => {
    const features = buildTmdbFeatures({
      kind: "movie",
      genres: ["Drama"],
      keywords: [],
      synopsis: "",
      year: 2019,
      score: 8.5,
      runtime: 132,
      originCountries: ["KR"],
      originalLanguage: "ko",
      cast: ["Song Kang-ho"],
      directors: ["Bong Joon-ho"],
      writers: ["Han Jin-won"],
      composers: ["Jung Jae-il"],
      cinematographers: ["Hong Kyung-pyo"],
      costumeDesigners: ["Choi Se-yeon"],
      editors: ["Yang Jin-mo"],
      productionDesigners: ["Lee Ha-jun"],
      companies: ["CJ Entertainment"],
    });
    expect(features).toEqual(expect.arrayContaining([
      "cinematographer:Hong Kyung-pyo",
      "costume:Choi Se-yeon",
      "editor:Yang Jin-mo",
      "prod-design:Lee Ha-jun",
    ]));
  });
});

describe("TMDB taste-enriched marker", () => {
  it("marker is the expected literal", () => {
    expect(TMDB_TASTE_ENRICHED_MARKER).toBe("meta:tmdb_taste_enriched");
  });

  it("isTmdbTasteEnriched returns true only when marker present", () => {
    expect(isTmdbTasteEnriched(null)).toBe(false);
    expect(isTmdbTasteEnriched("[]")).toBe(false);
    expect(isTmdbTasteEnriched(JSON.stringify(["genre:Drama"]))).toBe(false);
    expect(isTmdbTasteEnriched(JSON.stringify(["genre:Drama", TMDB_TASTE_ENRICHED_MARKER]))).toBe(true);
  });

  it("withTmdbTasteEnrichedMarker is idempotent", () => {
    const once = withTmdbTasteEnrichedMarker(["genre:Drama"]);
    const twice = withTmdbTasteEnrichedMarker(once);
    expect(once).toContain(TMDB_TASTE_ENRICHED_MARKER);
    expect(twice.filter((f) => f === TMDB_TASTE_ENRICHED_MARKER)).toHaveLength(1);
  });
});

describe("ensureTmdbTasteEnriched", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on a non-TMDB mal_id (regular anime range)", async () => {
    await expect(ensureTmdbTasteEnriched(42)).rejects.toThrow(/not a TMDB id/i);
  });

  it("no-ops when the row is already TMDB-enriched", async () => {
    vi.spyOn(dbModule, "getAnimeById").mockReturnValue(fakeRow({
      features_json: JSON.stringify(["genre:Drama", "meta:tmdb_taste_enriched"]),
    }));
    const fetchSpy = vi.spyOn(tmdb, "fetchTmdbDetail");
    const upsertSpy = vi.spyOn(dbModule, "upsertAnime").mockImplementation(() => {});
    await ensureTmdbTasteEnriched(2_000_000_550);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("fetches detail and upserts a row marked as enriched", async () => {
    vi.spyOn(dbModule, "getAnimeById").mockReturnValue(fakeRow({
      genres: "[\"Drama\"]",
      features_json: JSON.stringify(["genre:Drama"]),
    }));
    vi.spyOn(tmdb, "fetchTmdbDetail").mockResolvedValue({
      parsed: {
        mal_id: 2_000_000_550,
        title_en: "Fight Club",
        title_jp: "Fight Club",
        synopsis: "Insomniac office worker...",
        image_url: "https://example.com/poster.jpg",
        genres: "[\"Drama\"]",
        themes: "[\"based on novel\"]",
        demographics: "[]",
        score: 8.4,
        popularity: 100,
        kind: "movie",
        features_json: JSON.stringify([
          "genre:Drama",
          "director:David Fincher",
          "writer:Jim Uhls",
          "composer:Dust Brothers",
          "cinematographer:Jeff Cronenweth",
          "editor:James Haygood",
        ]),
      },
      kind: "movie",
      genres: ["Drama"],
      keywords: ["based on novel"],
      cast: ["Brad Pitt"],
      year: 1999,
      runtime: 139,
      status: "Released",
      trailerUrl: null,
      watchProviders: [],
    });
    const upsertSpy = vi.spyOn(dbModule, "upsertAnime").mockImplementation(() => {});
    await ensureTmdbTasteEnriched(2_000_000_550);
    expect(upsertSpy).toHaveBeenCalledOnce();
    const payload = upsertSpy.mock.calls[0]![0];
    const features = JSON.parse(payload.features_json ?? "[]") as string[];
    expect(features).toContain("meta:tmdb_taste_enriched");
    expect(features).toContain("director:David Fincher");
  });
});

describe("scheduleTasteEnrichment dispatches by id range", () => {
  beforeEach(() => {
    resetRecommendationIngestThrottleForTests();
    vi.restoreAllMocks();
  });

  it("uses the TMDB path for synthetic TMDB ids", async () => {
    vi.spyOn(dbModule, "getAnimeById").mockReturnValue(fakeRow({
      features_json: JSON.stringify(["genre:Drama"]),
    }));
    const fetchSpy = vi.spyOn(tmdb, "fetchTmdbDetail").mockResolvedValue({
      parsed: {
        mal_id: 2_000_000_550, title_en: "X", title_jp: "X", synopsis: "", image_url: "",
        genres: "[]", themes: "[]", demographics: "[]", score: null, popularity: 0,
        kind: "movie", features_json: JSON.stringify(["genre:Drama"]),
      },
      kind: "movie", genres: [], keywords: [], cast: [], year: null, runtime: null,
      status: null, trailerUrl: null, watchProviders: [],
    });
    vi.spyOn(dbModule, "upsertAnime").mockImplementation(() => {});

    scheduleTasteEnrichment(2_000_000_550);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 2000 });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

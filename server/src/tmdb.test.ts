import { describe, expect, it } from "vitest";
import {
  MOVIE_ID_OFFSET,
  TV_ID_OFFSET,
  buildTmdbFeatures,
  crewByRole,
  parseDiscoverItem,
  parseSyntheticId,
  toSyntheticId,
} from "./tmdb.js";

describe("crewByRole", () => {
  it("keeps only true directors out of director-adjacent job titles", () => {
    const { directors, writers } = crewByRole([
      { name: "Priyadarshan", job: "Director", department: "Directing" },
      { name: "Casting Person", job: "Casting Director", department: "Production" },
      { name: "AD Person", job: "Assistant Director", department: "Directing" },
      { name: "2nd Unit", job: "Second Unit Director", department: "Directing" },
      { name: "Neeraj Vora", job: "Dialogue", department: "Writing" },
      { name: "Screen Writer", job: "Screenplay", department: "Writing" },
    ]);

    expect(directors).toEqual(["Priyadarshan"]);
    expect(writers).toContain("Neeraj Vora");
    expect(writers).toContain("Screen Writer");
  });
});

describe("synthetic id namespacing", () => {
  it("round-trips tv and movie ids", () => {
    const tv = toSyntheticId("tv", 1396);
    const movie = toSyntheticId("movie", 27205);

    expect(tv).toBe(TV_ID_OFFSET + 1396);
    expect(movie).toBe(MOVIE_ID_OFFSET + 27205);
    expect(parseSyntheticId(tv)).toEqual({ kind: "tv", tmdbId: 1396 });
    expect(parseSyntheticId(movie)).toEqual({ kind: "movie", tmdbId: 27205 });
  });

  it("returns null for real MAL ids (below the offset)", () => {
    expect(parseSyntheticId(5114)).toBeNull();
    expect(parseSyntheticId(999_999)).toBeNull();
  });
});

describe("parseDiscoverItem", () => {
  it("maps a tv item into an ingest-ready row with genre + region features", () => {
    const row = parseDiscoverItem("tv", {
      id: 1396,
      name: "Breaking Bad",
      original_name: "Breaking Bad",
      overview:
        "A high school chemistry teacher turned methamphetamine producer navigates the dangers of the criminal underworld.",
      poster_path: "/abc.jpg",
      genre_ids: [18, 80],
      vote_average: 8.9,
      popularity: 250,
      origin_country: ["US"],
      original_language: "en",
      first_air_date: "2008-01-20",
    });

    expect(row).not.toBeNull();
    expect(row!.mal_id).toBe(TV_ID_OFFSET + 1396);
    expect(row!.title_en).toBe("Breaking Bad");
    expect(row!.image_url).toBe("https://image.tmdb.org/t/p/w500/abc.jpg");
    expect(JSON.parse(row!.genres)).toEqual(["Drama", "Crime"]);

    const features: string[] = JSON.parse(row!.features_json);
    expect(features).toContain("genre:Drama");
    expect(features).toContain("genre:Crime");
    expect(features).toContain("region:us");
    expect(features).toContain("lang:en");
    expect(features).toContain("origin:tv");
  });

  it("drops adult items and uses movie title fields", () => {
    expect(
      parseDiscoverItem("movie", {
        id: 1,
        adult: true,
        overview: "",
        genre_ids: [],
        vote_average: 0,
        popularity: 0,
        origin_country: [],
      }),
    ).toBeNull();

    const row = parseDiscoverItem("movie", {
      id: 27205,
      title: "Inception",
      overview:
        "A thief who steals corporate secrets through dream-sharing technology is given a chance at redemption.",
      poster_path: "/x.jpg",
      genre_ids: [28, 878],
      vote_average: 8.4,
      popularity: 0,
      origin_country: [],
      release_date: "2010-07-16",
    });
    expect(row!.title_en).toBe("Inception");
    expect(JSON.parse(row!.genres)).toEqual(["Action", "Science Fiction"]);
  });
});

describe("buildTmdbFeatures", () => {
  it("emits crew, studio, and metadata feature tokens", () => {
    const features = buildTmdbFeatures({
      kind: "movie",
      genres: ["Drama"],
      keywords: ["heist", "dream"],
      synopsis: "A tale of love and revenge.",
      year: 2010,
      score: 8.4,
      runtime: 148,
      originCountries: ["US"],
      originalLanguage: "en",
      cast: ["Leonardo DiCaprio"],
      directors: ["Christopher Nolan"],
      writers: ["Christopher Nolan"],
      composers: ["Hans Zimmer"],
      cinematographers: [],
      costumeDesigners: [],
      editors: [],
      productionDesigners: [],
      companies: ["Warner Bros."],
    });

    expect(features).toContain("genre:Drama");
    expect(features).toContain("theme:heist");
    expect(features).toContain("director:Christopher Nolan");
    expect(features).toContain("composer:Hans Zimmer");
    expect(features).toContain("main:Leonardo DiCaprio");
    expect(features).toContain("year:2010");
    expect(features.some((f) => f.startsWith("studio:"))).toBe(true);
  });
});

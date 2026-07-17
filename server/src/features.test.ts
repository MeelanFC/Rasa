import { describe, expect, it } from "vitest";
import {
  anilistTagFeatures,
  buildTasteFeatures,
  episodeLengthBucket,
  inferMcFromCharacterGenders,
  isSparseTasteFeatures,
  normalizeAgeRating,
  relationTypeFeatures,
  scoreTierFromMalScore,
} from "./features.js";

describe("buildTasteFeatures", () => {
  it("includes studios, staff, MC bias, and synopsis story signals", () => {
    const features = buildTasteFeatures({
      genresJson: JSON.stringify(["Action", "Drama"]),
      themesJson: JSON.stringify(["Military"]),
      demographicsJson: JSON.stringify(["Shounen"]),
      synopsis:
        "A young man embarks on a journey of growth and redemption after tragedy.",
      background: null,
      studios: ["MAPPA"],
      source: "Manga",
      episodes: 24,
      staff: [{ name: "Hayao Miyazaki", positions: ["Director"] }],
      characters: [{ malId: 1, name: "Eren", role: "Main", imageUrl: null, voiceActor: null }],
      mediaFormat: "TV",
      year: 2019,
      ageRating: "PG-13 - Teens 13 or older",
      malScore: 8.2,
    });

    expect(features).toContain("studio:MAPPA");
    expect(features).toContain("director:Hayao Miyazaki");
    expect(features).toContain("main:Eren");
    expect(features).toContain("mc:male");
    expect(features).toContain("story:character_growth");
    expect(features).toContain("genre:Action");
    expect(features).toContain("episodes:medium");
    expect(features).toContain("format:tv");
    expect(features).toContain("year:2019");
    expect(features).toContain("rating:pg-13");
    expect(features).toContain("score-tier:high");
  });

  it("merges AniList tags, relations, and MC gender over synopsis heuristics", () => {
    const features = buildTasteFeatures({
      genresJson: JSON.stringify(["Action"]),
      themesJson: "[]",
      demographicsJson: "[]",
      synopsis: "She leads the squad while he watches from afar.",
      anilistTags: ["Male Protagonist", "Tragedy"],
      relationTypes: ["Sequel", "SPIN_OFF"],
      mainCharacterGenders: ["Male"],
    });

    expect(features).toContain("alist-tag:Male Protagonist");
    expect(features).toContain("relation:sequel");
    expect(features).toContain("relation:spin-off");
    expect(features).toContain("mc:male");
    expect(features).not.toContain("mc:female");
  });

  it("adds manhwa MangaDex metadata features", () => {
    const features = buildTasteFeatures({
      genresJson: JSON.stringify(["Manhwa"]),
      themesJson: "[]",
      demographicsJson: JSON.stringify(["Manhwa"]),
      synopsis: "A hunter rises through the tower.",
      manhwaTags: ["Action", "Full Color"],
      manhwaStatus: "ongoing",
      manhwaYear: 2020,
      manhwaContentRating: "safe",
    });

    expect(features).toContain("theme:Action");
    expect(features).toContain("status:ongoing");
    expect(features).toContain("year:2020");
    expect(features).toContain("rating:safe");
  });
});

describe("anilistTagFeatures", () => {
  it("prefixes tags for taste weights", () => {
    expect(anilistTagFeatures(["Isekai"])).toEqual(["alist-tag:Isekai"]);
  });
});

describe("relationTypeFeatures", () => {
  it("normalizes relation labels", () => {
    expect(relationTypeFeatures(["Side Story", "ADAPTATION"])).toEqual([
      "relation:side-story",
      "relation:adaptation",
    ]);
  });
});

describe("inferMcFromCharacterGenders", () => {
  it("detects mixed casts", () => {
    expect(inferMcFromCharacterGenders(["Male", "Female"])).toEqual(["mc:mixed_cast"]);
  });
});

describe("metadata helpers", () => {
  it("maps Jikan age ratings and score tiers", () => {
    expect(normalizeAgeRating("R - 17+ (violence & profanity)")).toBe("r");
    expect(scoreTierFromMalScore(8.7)).toBe("score-tier:elite");
    expect(episodeLengthBucket(6)).toBe("episodes:short");
  });

  it("detects sparse enriched feature sets", () => {
    expect(isSparseTasteFeatures(["meta:taste_enriched", "genre:Action"])).toBe(true);
    expect(
      isSparseTasteFeatures(["meta:taste_enriched", "alist-tag:Tragedy", "studio:MAPPA"]),
    ).toBe(false);
  });
});

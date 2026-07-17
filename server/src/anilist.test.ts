import { describe, expect, it } from "vitest";
import { parseAnilistMedia, selectAnilistTags } from "./anilist.js";
import { inferMcFromCharacterGenders } from "./features.js";

describe("selectAnilistTags", () => {
  it("drops spoiler tags and low-rank noise", () => {
    const tags = selectAnilistTags([
      { name: "Male Protagonist", rank: 95, isMediaSpoiler: false },
      { name: "Plot Twist", rank: 80, isMediaSpoiler: true },
      { name: "Weak Tag", rank: 10, isMediaSpoiler: false },
    ]);

    expect(tags).toEqual(["Male Protagonist"]);
  });
});

describe("parseAnilistMedia", () => {
  it("extracts tags, relation types, and main character genders", () => {
    const parsed = parseAnilistMedia({
      tags: [{ name: "Anti-Hero", rank: 70, isMediaSpoiler: false }],
      relations: {
        edges: [
          {
            relationType: "SEQUEL",
            node: { idMal: 5114, type: "ANIME" },
          },
        ],
      },
      characters: {
        edges: [
          { role: "MAIN", node: { gender: "Male" } },
          { role: "SUPPORTING", node: { gender: "Female" } },
        ],
      },
    });

    expect(parsed.tags).toContain("Anti-Hero");
    expect(parsed.relationTypes).toContain("sequel");
    expect(parsed.relatedMalIds).toEqual([5114]);
    expect(parsed.recommendationMalIds).toEqual([]);
    expect(parsed.mainCharacterGenders).toEqual(["Male"]);
  });

  it("extracts AniList recommendation mal ids", () => {
    const parsed = parseAnilistMedia({
      recommendations: {
        edges: [
          { node: { idMal: 20, type: "ANIME" } },
          { node: { idMal: null, type: "ANIME" } },
        ],
      },
    });

    expect(parsed.recommendationMalIds).toEqual([20]);
  });

  it("parses format, scores, and main studios", () => {
    const parsed = parseAnilistMedia({
      format: "TV",
      status: "FINISHED",
      seasonYear: 2011,
      season: "SPRING",
      averageScore: 91,
      popularity: 500000,
      episodes: 24,
      source: "MANGA",
      isAdult: false,
      genres: ["Action"],
      studios: { nodes: [{ name: "ufotable" }] },
    });

    expect(parsed.format).toBe("TV");
    expect(parsed.seasonYear).toBe(2011);
    expect(parsed.averageScore).toBe(91);
    expect(parsed.studios).toEqual(["ufotable"]);
    expect(parsed.source).toBe("MANGA");
  });
});

describe("inferMcFromCharacterGenders", () => {
  it("prefers female when all mains are female", () => {
    expect(inferMcFromCharacterGenders(["Female", "Female"])).toEqual(["mc:female"]);
  });

  it("returns empty when gender is unknown", () => {
    expect(inferMcFromCharacterGenders(["Unknown"])).toEqual([]);
  });
});

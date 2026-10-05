import { describe, expect, it } from "vitest";
import {
  buildCoverUrl,
  mangadexIdToMalId,
  mangadexTagFeatures,
  parseLastChapterNumber,
  parseManhwaEntity,
  parseMangaDexTasteMeta,
} from "./mangadex.js";

const SAMPLE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("mangadexIdToMalId", () => {
  it("returns stable ids in the manhwa range", () => {
    const id = mangadexIdToMalId(SAMPLE_ID);
    expect(id).toBeGreaterThanOrEqual(800_000_000);
    expect(mangadexIdToMalId(SAMPLE_ID)).toBe(id);
  });
});

describe("parseLastChapterNumber", () => {
  it("parses numeric chapter markers", () => {
    expect(parseLastChapterNumber("125")).toBe(125);
    expect(parseLastChapterNumber("12.5")).toBe(12);
    expect(parseLastChapterNumber(null)).toBeNull();
  });
});

describe("parseManhwaEntity", () => {
  it("maps Korean full-color manga to ParsedManhwa", () => {
    const entity = {
      id: SAMPLE_ID,
      type: "manga",
      attributes: {
        title: { en: "Solo Leveling", ko: "나 혼자만 레벨업" },
        description: { en: "Hunters fight monsters in gates." },
        originalLanguage: "ko",
        lastChapter: "200",
        status: "completed",
        year: 2018,
        contentRating: "safe",
        tags: [],
      },
      relationships: [
        { id: "cover-1", type: "cover_art" },
      ],
    };

    const included = [
      {
        id: "cover-1",
        type: "cover_art" as const,
        attributes: { fileName: "cover.jpg" },
      },
    ];

    const parsed = parseManhwaEntity(entity, 200, 0, included);

    expect(parsed.titleEn).toBe("Solo Leveling");
    expect(parsed.titleRomaji).toBe("나 혼자만 레벨업");
    expect(parsed.chapterCount).toBe(200);
    expect(parsed.imageUrl).toBe(buildCoverUrl(SAMPLE_ID, "cover.jpg"));
    expect(JSON.parse(parsed.genres)).toContain("Manhwa");
  });
});

describe("mangadexTagFeatures", () => {
  it("maps tag groups and publication demographic", () => {
    const features = mangadexTagFeatures({
      title: { en: "Test" },
      description: { en: "" },
      originalLanguage: "ko",
      publicationDemographic: "shounen",
      lastChapter: null,
      status: "ongoing",
      year: 2024,
      contentRating: "safe",
      tags: [
        {
          id: "g1",
          type: "tag",
          attributes: { name: { en: "Action" }, group: "genre" },
        },
        {
          id: "t1",
          type: "tag",
          attributes: { name: { en: "Survival" }, group: "theme" },
        },
        {
          id: "f1",
          type: "tag",
          attributes: { name: { en: "Long Strip" }, group: "format" },
        },
      ],
    });

    expect(features).toContain("genre:action");
    expect(features).toContain("theme:survival");
    expect(features).toContain("format:long-strip");
    expect(features).toContain("demo:shounen");
  });
});

describe("parseMangaDexTasteMeta", () => {
  it("includes author features from included entities", () => {
    const entity = {
      id: SAMPLE_ID,
      type: "manga",
      attributes: {
        title: { en: "Test" },
        description: { en: "" },
        originalLanguage: "ko",
        lastChapter: null,
        status: "ongoing",
        year: null,
        contentRating: "safe",
        tags: [],
      },
      relationships: [{ id: "auth-1", type: "author" }],
    };

    const included = [
      {
        id: "auth-1",
        type: "author" as const,
        attributes: { name: "Chugong" },
      },
    ];

    const meta = parseMangaDexTasteMeta(entity, included);
    expect(meta.tasteFeatures).toContain("author:chugong");
  });
});


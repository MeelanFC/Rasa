import { describe, expect, it } from "vitest";
import { dedupeByMalId, mergeDiscoverQueue } from "./mergeDiscoverQueue";
import type { AnimeCard } from "@/types";

function card(malId: number): AnimeCard {
  return {
    malId,
    titleEn: `Title ${malId}`,
    titleRomaji: `Title ${malId}`,
    synopsis: "synopsis",
    imageUrl: `https://example.com/${malId}.jpg`,
    genres: [],
    themes: [],
    score: null,
    mediaType: "anime",
    chapterCount: null,
  };
}

describe("mergeDiscoverQueue", () => {
  it("dedupes duplicate malIds in server queue", () => {
    const merged = mergeDiscoverQueue([card(2), card(2), card(3)], [], new Set());
    expect(merged.map((c) => c.malId)).toEqual([2, 3]);
  });

  it("excludes rated malIds and preserves local-only tail", () => {
    const rated = new Set([1]);
    const merged = mergeDiscoverQueue(
      [card(2), card(3)],
      [card(3), card(4)],
      rated,
    );
    expect(merged.map((c) => c.malId)).toEqual([2, 3, 4]);
  });

  it("dedupeByMalId keeps first occurrence", () => {
    const unique = dedupeByMalId([card(5), card(5), card(6)]);
    expect(unique.map((c) => c.malId)).toEqual([5, 6]);
  });
});

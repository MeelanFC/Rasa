import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getGenreNextPage, incrementGenrePage, clearAnimeCache } from "./db.js";
import { isCatalogStarved, runCatalogExpansion } from "./service.js";

// Mock Jikan client calls
vi.mock("./jikan.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./jikan.js")>();
  return {
    ...original,
    fetchAnimeByGenre: vi.fn(),
  };
});

// Mock enrichment calls to prevent actual background fetches
vi.mock("./enrichment.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./enrichment.js")>();
  return {
    ...original,
    scheduleBulkTasteEnrichment: vi.fn(),
  };
});

import { fetchAnimeByGenre } from "./jikan.js";
import { scheduleBulkTasteEnrichment } from "./enrichment.js";

describe("Catalog Starvation Engine", () => {
  beforeEach(() => {
    // Clear ratings and anime before each test
    const db = getDb();
    db.prepare("DELETE FROM ratings").run();
    db.prepare("DELETE FROM watchlist").run();
    db.prepare("DELETE FROM engagement_signals").run();
    db.prepare("DELETE FROM anime").run();
    db.prepare("DELETE FROM genre_expansion_pages").run();
    clearAnimeCache();
    vi.mocked(fetchAnimeByGenre).mockReset();
    vi.mocked(scheduleBulkTasteEnrichment).mockReset();
  });

  describe("isCatalogStarved", () => {
    it("returns true when database is empty (cold start)", () => {
      expect(isCatalogStarved()).toBe(true);
    });

    it("returns false when less than 50% of the catalog is rated", () => {
      const db = getDb();
      // Insert 10 anime
      for (let i = 1; i <= 10; i++) {
        db.prepare(`
          INSERT INTO anime (mal_id, title_en, title_jp, synopsis, image_url, genres, themes, demographics, score, popularity)
          VALUES (?, 'Title', 'Title', 'Synopsis', 'url', '[]', '[]', '[]', 8.0, 10)
        `).run(i);
      }
      // Rate 4 anime (40%)
      for (let i = 1; i <= 4; i++) {
        db.prepare("INSERT INTO ratings (mal_id, reaction) VALUES (?, 'up')").run(i);
      }

      expect(isCatalogStarved()).toBe(false);
    });

    it("returns true when 50% or more of the catalog is rated", () => {
      const db = getDb();
      // Insert 10 anime
      for (let i = 1; i <= 10; i++) {
        db.prepare(`
          INSERT INTO anime (mal_id, title_en, title_jp, synopsis, image_url, genres, themes, demographics, score, popularity)
          VALUES (?, 'Title', 'Title', 'Synopsis', 'url', '[]', '[]', '[]', 8.0, 10)
        `).run(i);
      }
      // Rate 5 anime (50%)
      for (let i = 1; i <= 5; i++) {
        db.prepare("INSERT INTO ratings (mal_id, reaction) VALUES (?, 'up')").run(i);
      }

      expect(isCatalogStarved()).toBe(true);
    });
  });

  describe("Genre persistent pagination", () => {
    it("returns default page 1 for uninitialized genres", () => {
      expect(getGenreNextPage(1)).toBe(1);
      expect(getGenreNextPage(99)).toBe(1);
    });

    it("increments genre pages and persists them in SQLite", () => {
      incrementGenrePage(1);
      expect(getGenreNextPage(1)).toBe(2);

      incrementGenrePage(1);
      expect(getGenreNextPage(1)).toBe(3);

      // Check distinct genre state
      expect(getGenreNextPage(2)).toBe(1);
    });
  });

  describe("runCatalogExpansion", () => {
    it("queries Jikan for genre seeds and schedules taste enrichment", async () => {
      const db = getDb();
      
      // 1. Seed some anime and upvote one with "Action" tag to drive seeding weight
      db.prepare(`
        INSERT INTO anime (mal_id, title_en, title_jp, synopsis, image_url, genres, themes, demographics, score, popularity)
        VALUES (101, 'Action Show', 'Action Show', 'Synopsis', 'url', '["Action"]', '[]', '[]', 8.0, 10)
      `).run();
      db.prepare("INSERT INTO ratings (mal_id, reaction) VALUES (101, 'up')").run();

      // Mock Jikan fetch to return 1 new anime
      const mockNewAnime = {
        mal_id: 202,
        title_en: "New Reco Anime",
        title_romaji: "New Reco Anime Romaji",
        synopsis: "New synopsis for search results.",
        image_url: "https://example.com/new.jpg",
        genres: '["Action"]',
        themes: "[]",
        demographics: "[]",
        score: 8.5,
        popularity: 15,
      };
      
      vi.mocked(fetchAnimeByGenre).mockResolvedValue([mockNewAnime]);

      // 2. Trigger catalog expansion
      await runCatalogExpansion();

      // 3. Verify Jikan called fetchAnimeByGenre for Action (ID 1)
      expect(fetchAnimeByGenre).toHaveBeenCalledWith(1, 1);

      // 4. Verify new anime inserted in database
      const row = db.prepare("SELECT title_en, image_url FROM anime WHERE mal_id = 202").get() as { title_en: string };
      expect(row).toBeDefined();
      expect(row.title_en).toBe("New Reco Anime");

      // 5. Verify genre page incremented
      expect(getGenreNextPage(1)).toBe(2);

      // 6. Verify bulk enrichment scheduled
      expect(scheduleBulkTasteEnrichment).toHaveBeenCalled();
    });
  });
});

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { franchiseKey } from "./franchise.js";
import { insertWatchlistOnDb, migrateDatabase } from "./db.js";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrateDatabase(db);
  return db;
}

function seedAnime(db: Database.Database, malId: number, titleEn: string, titleJp: string): void {
  const key = franchiseKey(titleEn, titleJp);
  db.prepare(
    `
    INSERT INTO anime (
      mal_id, franchise_key, title_en, title_jp, synopsis, image_url,
      genres, themes, demographics, score, popularity
    ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', '[]', NULL, 0)
  `,
  ).run(
    malId,
    key,
    titleEn,
    titleJp,
    "A long enough synopsis so catalog readiness checks pass for watchlist tests.",
    "https://example.com/img.jpg",
  );
}

describe("watchlist table", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("insertWatchlistOnDb stores added_at", () => {
    db = openTestDb();
    seedAnime(db, 1, "Solo Leveling", "Ore dake Level Up na Ken");
    insertWatchlistOnDb(db, 1);

    const row = db
      .prepare("SELECT mal_id, added_at FROM watchlist WHERE mal_id = 1")
      .get() as { mal_id: number; added_at: string };

    expect(row.mal_id).toBe(1);
    expect(row.added_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });

  it("deletes only the requested mal_id", () => {
    db = openTestDb();
    seedAnime(db, 2, "Frieren", "Sousou no Frieren");
    seedAnime(db, 3, "Dungeon Meshi", "Delicious in Dungeon");
    insertWatchlistOnDb(db, 2);
    insertWatchlistOnDb(db, 3);

    const del = db.prepare("DELETE FROM watchlist WHERE mal_id = ?");
    expect(del.run(2).changes).toBe(1);
    expect(del.run(2).changes).toBe(0);

    const remaining = db
      .prepare("SELECT mal_id FROM watchlist ORDER BY mal_id")
      .all() as Array<{ mal_id: number }>;
    expect(remaining).toEqual([{ mal_id: 3 }]);
  });

  it("joins franchise_key for discover exclusion queries", () => {
    db = openTestDb();
    const key = franchiseKey("Naruto Shippuden", "Naruto: Shippuuden");
    seedAnime(db, 10, "Naruto Shippuden", "Naruto: Shippuuden");
    db.prepare("UPDATE anime SET franchise_key = ? WHERE mal_id = 10").run(key);
    insertWatchlistOnDb(db, 10);

    const rows = db
      .prepare(
        `
      SELECT a.franchise_key, a.title_en, a.title_jp
      FROM watchlist w
      JOIN anime a ON a.mal_id = w.mal_id
    `,
      )
      .all() as Array<{ franchise_key: string; title_en: string; title_jp: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.franchise_key).toBe(key);
  });
});

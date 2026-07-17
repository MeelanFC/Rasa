import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { franchiseKey } from "./franchise.js";
import {
  getDb,
  getRecentlySkippedMalIds,
  insertRatingOnDb,
  migrateDatabase,
} from "./db.js";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrateDatabase(db);
  return db;
}

function seedAnime(db: Database.Database, malId: number): void {
  db.prepare(
    `
    INSERT INTO anime (
      mal_id, title_en, title_jp, synopsis, image_url,
      genres, themes, demographics, score, popularity
    ) VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', NULL, 0)
  `,
  ).run(
    malId,
    "Test EN",
    "Test JP",
    "A long enough synopsis so catalog readiness checks pass for rating tests.",
    "https://example.com/img.jpg",
  );
}

describe("insertRating", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("inserts a rating with rated_at on a migrated schema", () => {
    db = openTestDb();
    seedAnime(db, 1);
    insertRatingOnDb(db, 1, "up");

    const row = db
      .prepare("SELECT mal_id, reaction, rated_at FROM ratings WHERE mal_id = 1")
      .get() as { mal_id: number; reaction: string; rated_at: string };

    expect(row.mal_id).toBe(1);
    expect(row.reaction).toBe("up");
    expect(row.rated_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });

  it("updates reaction when the same anime is rated again", () => {
    db = openTestDb();
    seedAnime(db, 7);
    insertRatingOnDb(db, 7, "up");
    insertRatingOnDb(db, 7, "down");

    const row = db
      .prepare("SELECT reaction FROM ratings WHERE mal_id = 7")
      .get() as { reaction: string };

    expect(row.reaction).toBe("down");
  });

  it("stores optional down_reason on downvotes", () => {
    db = openTestDb();
    seedAnime(db, 3);
    insertRatingOnDb(db, 3, "down", "pacing");

    const row = db
      .prepare("SELECT reaction, down_reason FROM ratings WHERE mal_id = 3")
      .get() as { reaction: string; down_reason: string };

    expect(row.reaction).toBe("down");
    expect(row.down_reason).toBe("pacing");
    expect(
      db.prepare("SELECT COUNT(*) as count FROM ratings").get() as { count: number },
    ).toMatchObject({ count: 1 });
  });

  it("stores franchise_key when the column exists", () => {
    db = openTestDb();
    const key = franchiseKey("Naruto Shippuden", "Naruto: Shippuuden");
    db.prepare(
      `
      INSERT INTO anime (
        mal_id, franchise_key, title_en, title_jp, synopsis, image_url,
        genres, themes, demographics, score, popularity
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', '[]', NULL, 0)
    `,
    ).run(
      99,
      key,
      "Naruto Shippuden",
      "Naruto: Shippuuden",
      "A long enough synopsis so catalog readiness checks pass for rating tests.",
      "https://example.com/img.jpg",
    );

    const row = db
      .prepare("SELECT franchise_key FROM anime WHERE mal_id = 99")
      .get() as { franchise_key: string };

    expect(row.franchise_key).toBe(key);
    expect(row.franchise_key).toBe(franchiseKey("Naruto", "Naruto"));
  });

  it("restores rated_at DEFAULT after broken binary migration schema", () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE anime (
        mal_id INTEGER PRIMARY KEY,
        title_en TEXT NOT NULL,
        title_jp TEXT NOT NULL,
        synopsis TEXT NOT NULL,
        image_url TEXT NOT NULL,
        genres TEXT NOT NULL DEFAULT '[]',
        themes TEXT NOT NULL DEFAULT '[]',
        demographics TEXT NOT NULL DEFAULT '[]',
        score REAL,
        popularity INTEGER NOT NULL DEFAULT 0,
        cached_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE ratings (
        mal_id INTEGER PRIMARY KEY,
        reaction TEXT NOT NULL CHECK (reaction IN ('up', 'down')),
        rated_at TEXT NOT NULL,
        FOREIGN KEY (mal_id) REFERENCES anime(mal_id)
      );
    `);
    seedAnime(db, 42);

    expect(() => {
      db.prepare("INSERT INTO ratings (mal_id, reaction) VALUES (?, ?)").run(42, "down");
    }).toThrow(/rated_at/);

    migrateDatabase(db);

    db.prepare("INSERT INTO ratings (mal_id, reaction) VALUES (?, ?)").run(42, "down");

    const row = db
      .prepare("SELECT reaction, rated_at FROM ratings WHERE mal_id = 42")
      .get() as { reaction: string; rated_at: string };

    expect(row.reaction).toBe("down");
    expect(row.rated_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });
});

describe("getRecentlySkippedMalIds", () => {
  it("includes fresh skips, excludes stale skips and non-skip signals", () => {
    const db = getDb();
    for (const malId of [901, 902, 903]) {
      seedAnime(db, malId);
    }
    const insert = db.prepare(
      `INSERT INTO engagement_signals (mal_id, dwell_ms, skipped, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    insert.run(901, 100, 1, "2100-01-01 00:00:00"); // future = always "fresh"
    insert.run(902, 100, 1, "2000-01-01 00:00:00"); // long past the cooldown
    insert.run(903, 100, 0, "2100-01-01 00:00:00"); // dwell signal, not a skip

    const skipped = getRecentlySkippedMalIds(7);
    expect(skipped.has(901)).toBe(true);
    expect(skipped.has(902)).toBe(false);
    expect(skipped.has(903)).toBe(false);
  });
});

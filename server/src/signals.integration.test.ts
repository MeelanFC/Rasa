import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./db.js";
import { buildFeatureWeights, ratedFeaturesFromImplicitSignal } from "./recommendation.js";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrateDatabase(db);
  return db;
}

describe("engagement signals in taste weights", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("applies weak implicit down weight from fast skip signals", () => {
    db = openTestDb();
    db.prepare(
      `
      INSERT INTO anime (
        mal_id, title_en, title_jp, synopsis, image_url,
        genres, themes, demographics, score, popularity
      ) VALUES (10, 'Test', 'Test', 'Long enough synopsis for foreign key checks.', 'https://example.com/10.jpg', '[]', '[]', '[]', NULL, 0)
    `,
    ).run();
    db.prepare(
      `
      INSERT INTO engagement_signals (mal_id, dwell_ms, skipped)
      VALUES (10, 500, 1)
    `,
    ).run();

    const row = db
      .prepare("SELECT dwell_ms, skipped FROM engagement_signals WHERE mal_id = 10")
      .get() as { dwell_ms: number; skipped: number };

    expect(row.dwell_ms).toBe(500);
    expect(row.skipped).toBe(1);

    const weights = buildFeatureWeights([
      ratedFeaturesFromImplicitSignal(["genre:action"], "down"),
    ]);
    expect(weights["genre:action"]).toBeLessThan(0);
  });
});

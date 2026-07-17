import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "./db.js";
import * as dbModule from "./db.js";
import {
  getGraphBoostScore,
  registerGraphNeighbors,
  resetTasteGraphForTests,
} from "./taste-graph.js";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrateDatabase(db);
  return db;
}

describe("taste graph persistence", () => {
  afterEach(() => {
    resetTasteGraphForTests();
    vi.restoreAllMocks();
  });

  it("writes neighbor scores through upsertTasteNeighbor", () => {
    const memDb = openTestDb();
    const upserts: Array<{ id: number; score: number }> = [];

    vi.spyOn(dbModule, "upsertTasteNeighbor").mockImplementation((neighborMalId, score) => {
      upserts.push({ id: neighborMalId, score });
      memDb
        .prepare(
          `
        INSERT INTO taste_neighbors (neighbor_mal_id, score, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(neighbor_mal_id) DO UPDATE SET score = MAX(taste_neighbors.score, excluded.score)
      `,
        )
        .run(neighborMalId, score);
    });

    registerGraphNeighbors(1, [42, 43], 1);
    expect(upserts.length).toBeGreaterThan(0);
    expect(getGraphBoostScore(42)).toBeGreaterThan(0);

    memDb.close();
  });
});

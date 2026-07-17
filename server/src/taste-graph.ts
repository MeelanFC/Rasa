/**
 * Taste graph boost from AniList relations + recommendations and Jikan recs.
 * Neighbors of loved titles get a score boost during warm picks.
 * Persisted in SQLite across restarts.
 */
import { loadTasteNeighborsFromDb, upsertTasteNeighbor } from "./db.js";

const neighborScores = new Map<number, number>();

const GRAPH_BOOST_THRESHOLD = 0.45;
const GRAPH_DECAY_PER_SOURCE = 0.15;

let neighborsHydrated = false;

function hydrateNeighborsOnce(): void {
  if (neighborsHydrated) {
    return;
  }
  neighborsHydrated = true;
  for (const { neighborMalId, score } of loadTasteNeighborsFromDb()) {
    neighborScores.set(neighborMalId, score);
  }
}

export function registerGraphNeighbors(
  sourceMalId: number,
  neighborMalIds: number[],
  baseWeight = 1,
): void {
  hydrateNeighborsOnce();

  for (const neighborId of neighborMalIds) {
    if (neighborId === sourceMalId) {
      continue;
    }
    const increment = baseWeight * (1 - GRAPH_DECAY_PER_SOURCE);
    const next = (neighborScores.get(neighborId) ?? 0) + increment;
    neighborScores.set(neighborId, next);
    upsertTasteNeighbor(neighborId, next);
  }
}

export function getGraphBoostScore(malId: number): number {
  hydrateNeighborsOnce();
  const score = neighborScores.get(malId) ?? 0;
  return score >= GRAPH_BOOST_THRESHOLD ? Math.min(score, 2) : 0;
}

export function getGraphBoostMalIds(): Set<number> {
  hydrateNeighborsOnce();
  const boosted = new Set<number>();
  for (const [malId, score] of neighborScores) {
    if (score >= GRAPH_BOOST_THRESHOLD) {
      boosted.add(malId);
    }
  }
  return boosted;
}

/** Clears graph state (for tests only). */
export function resetTasteGraphForTests(): void {
  neighborScores.clear();
  neighborsHydrated = false;
}

/** Re-hydrates from DB after tests wipe the table. */
export function reloadTasteGraphFromDbForTests(): void {
  neighborScores.clear();
  neighborsHydrated = false;
  hydrateNeighborsOnce();
}

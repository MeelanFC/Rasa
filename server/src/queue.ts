import { isCatalogExhaustedError } from "./api-errors.js";
import { getWatchlistMalIds, getRatedMalIds } from "./db.js";
import { keyForAnime } from "./franchise.js";
import type { AnimeCard } from "./types.js";

const CATALOG_EXHAUSTED_BACKOFF_MS = 60_000;
const CATALOG_EXHAUSTED_LOG_COOLDOWN_MS = 30_000;

let catalogExhaustedUntil = 0;
let lastCatalogExhaustedLogAt = 0;

/** Minimum ready cards so the next vote never waits on Jikan. */
export let QUEUE_SIZE = 12;

const previewQueue: AnimeCard[] = [];
let refillInFlight: Promise<void> | null = null;

export function getQueuedMalIds(): Set<number> {
  return new Set(previewQueue.map((card) => card.malId));
}

export function getQueuedFranchiseKeys(): Set<string> {
  const keys = new Set<string>();
  for (const card of previewQueue) {
    keys.add(
      keyForAnime({
        titleEn: card.titleEn,
        titleRomaji: card.titleRomaji,
        franchiseKey: card.franchiseKey,
      }),
    );
  }
  return keys;
}

export function peekQueue(): AnimeCard | undefined {
  return previewQueue[0];
}

/** Keeps first occurrence of each malId; defensive if queue ever desyncs. */
export function dedupeQueueByMalId(cards: AnimeCard[]): AnimeCard[] {
  const seen = new Set<number>();
  const unique: AnimeCard[] = [];
  for (const card of cards) {
    if (seen.has(card.malId)) {
      continue;
    }
    seen.add(card.malId);
    unique.push(card);
  }
  return unique;
}

export function snapshotQueue(): AnimeCard[] {
  return dedupeQueueByMalId(previewQueue);
}

export function dropFromQueue(malId: number): void {
  for (let index = previewQueue.length - 1; index >= 0; index -= 1) {
    if (previewQueue[index]?.malId === malId) {
      previewQueue.splice(index, 1);
    }
  }
}

export function dropFranchiseFromQueue(franchiseKey: string): void {
  for (let index = previewQueue.length - 1; index >= 0; index -= 1) {
    const card = previewQueue[index];
    if (card) {
      const key = keyForAnime({
        titleEn: card.titleEn,
        titleRomaji: card.titleRomaji,
        franchiseKey: card.franchiseKey,
      });
      if (key === franchiseKey) {
        previewQueue.splice(index, 1);
      }
    }
  }
}

export function pushQueue(
  card: AnimeCard,
  extraBlockedFranchises?: Set<string>,
  bypassFranchiseCheck = false,
): void {
  if (previewQueue.some((queued) => queued.malId === card.malId)) {
    return;
  }
  // Defense-in-depth: never re-surface a watchlisted or rated title in Discover even if
  // the picker's exhaustion fallback let one slip through.
  if (getWatchlistMalIds().has(card.malId)) {
    return;
  }
  if (getRatedMalIds().has(card.malId)) {
    return;
  }

  if (!bypassFranchiseCheck) {
    const franchiseKey = keyForAnime({
      titleEn: card.titleEn,
      titleRomaji: card.titleRomaji,
      franchiseKey: card.franchiseKey,
    });
    if (getQueuedFranchiseKeys().has(franchiseKey)) {
      return;
    }
    if (extraBlockedFranchises?.has(franchiseKey)) {
      return;
    }
  }

  previewQueue.push(card);
}

export function queueLength(): number {
  return previewQueue.length;
}

export function queueDeficit(): number {
  return Math.max(0, QUEUE_SIZE - previewQueue.length);
}

function isCatalogExhaustedBackoffActive(): boolean {
  return Date.now() < catalogExhaustedUntil;
}

function noteCatalogExhausted(error: unknown): void {
  if (!isCatalogExhaustedError(error)) {
    return;
  }

  catalogExhaustedUntil = Date.now() + CATALOG_EXHAUSTED_BACKOFF_MS;
  const now = Date.now();
  if (now - lastCatalogExhaustedLogAt < CATALOG_EXHAUSTED_LOG_COOLDOWN_MS) {
    return;
  }
  lastCatalogExhaustedLogAt = now;
  console.warn(
    "[rasa] catalog exhausted; pausing queue refill for",
    CATALOG_EXHAUSTED_BACKOFF_MS / 1000,
    "s",
  );
}

export async function ensureQueue(
  targetSize: number,
  fetchNext: () => Promise<AnimeCard>,
): Promise<void> {
  let attempts = 0;
  const maxAttempts = targetSize * 6;
  let lastError: unknown;

  while (previewQueue.length < targetSize && attempts < maxAttempts) {
    attempts += 1;
    try {
      const card = await fetchNext();
      if (getWatchlistMalIds().has(card.malId)) {
        continue;
      }
      pushQueue(card, undefined, true);
    } catch (error) {
      lastError = error;
      break;
    }
  }

  if (previewQueue.length === 0 && lastError) {
    throw lastError;
  }
}

/** Fetch cards one at a time; fetchNext serializes picks (parallel batch was a no-op). */
async function fetchSequential(
  count: number,
  fetchNext: () => Promise<AnimeCard>,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    if (previewQueue.length >= QUEUE_SIZE) {
      break;
    }
    try {
      const card = await fetchNext();
      if (getWatchlistMalIds().has(card.malId)) {
        continue;
      }
      pushQueue(card, undefined, true);
    } catch (error) {
      noteCatalogExhausted(error);
      if (!isCatalogExhaustedError(error)) {
        console.error("[rasa] queue card failed", error);
      }
      break;
    }
  }
}

async function pumpQueue(fetchNext: () => Promise<AnimeCard>): Promise<void> {
  let attempts = 0;
  const maxAttempts = QUEUE_SIZE * 8;

  while (
    previewQueue.length < QUEUE_SIZE &&
    attempts < maxAttempts &&
    !isCatalogExhaustedBackoffActive()
  ) {
    attempts += 1;
    const deficit = queueDeficit();
    if (deficit <= 0) {
      break;
    }

    await fetchSequential(deficit, fetchNext);
    if (isCatalogExhaustedBackoffActive()) {
      break;
    }
  }
}

/**
 * Keeps the preview queue at QUEUE_SIZE in the background.
 * Safe to call after every vote; re-enters if the queue drops while a pump runs.
 */
export function scheduleQueueRefill(fetchNext: () => Promise<AnimeCard>): void {
  if (isCatalogExhaustedBackoffActive()) {
    return;
  }

  if (queueDeficit() <= 0) {
    return;
  }

  if (refillInFlight) {
    return;
  }

  const initialLength = queueLength();

  refillInFlight = pumpQueue(fetchNext)
    .catch(() => {
      // Refill failures are non-fatal; the next vote will retry.
    })
    .finally(() => {
      refillInFlight = null;
      if (queueDeficit() > 0 && queueLength() > initialLength) {
        scheduleQueueRefill(fetchNext);
      }
    });
}

export async function waitForQueueRefill(): Promise<void> {
  if (refillInFlight) {
    await refillInFlight;
  }
}

/** Clears the in-memory preview queue (for tests only). */
export function resetPreviewQueueForTests(): void {
  previewQueue.length = 0;
  refillInFlight = null;
  catalogExhaustedUntil = 0;
  lastCatalogExhaustedLogAt = 0;
  QUEUE_SIZE = 3;
}

/** Seeds the preview queue without pushQueue guards (for tests only). */
export function injectPreviewQueueForTests(cards: AnimeCard[]): void {
  previewQueue.length = 0;
  previewQueue.push(...cards);
}

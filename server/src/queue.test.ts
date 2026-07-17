import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogExhaustedError } from "./api-errors.js";
import {
  dedupeQueueByMalId,
  dropFromQueue,
  dropFranchiseFromQueue,
  ensureQueue,
  injectPreviewQueueForTests,
  peekQueue,
  pushQueue,
  queueDeficit,
  queueLength,
  resetPreviewQueueForTests,
  scheduleQueueRefill,
  snapshotQueue,
  waitForQueueRefill,
} from "./queue.js";
import { franchiseKey } from "./franchise.js";
import type { AnimeCard } from "./types.js";

const mockRatedMalIds = new Set<number>();
const mockWatchlistMalIds = new Set<number>();

vi.mock("./db.js", () => ({
  getRatedMalIds: () => mockRatedMalIds,
  getWatchlistMalIds: () => mockWatchlistMalIds,
}));

const sampleCard = (
  malId: number,
  titleEn = `Discover Title ${malId}`,
): AnimeCard => ({
  malId,
  franchiseKey: franchiseKey(titleEn, titleEn),
  titleEn,
  titleRomaji: titleEn,
  synopsis: "Test synopsis long enough for catalog readiness checks in tests.",
  imageUrl: "https://example.com/img.jpg",
  genres: [],
  themes: [],
  score: null,
  mediaType: "anime",
  chapterCount: null,
});

describe("preview queue", () => {
  beforeEach(() => {
    resetPreviewQueueForTests();
  });

  it("fills to target size with unique cards", async () => {
    let counter = 0;
    await ensureQueue(3, async () => {
      counter += 1;
      return sampleCard(counter);
    });

    expect(peekQueue()?.malId).toBe(1);
    pushQueue(sampleCard(1));
    await ensureQueue(3, async () => sampleCard(99));
    expect(peekQueue()?.malId).toBe(1);
  });

  it("drops rated card from queue", () => {
    pushQueue(sampleCard(10));
    pushQueue(sampleCard(11));
    dropFromQueue(10);
    expect(peekQueue()?.malId).toBe(11);
  });

  it("reports deficit when below target size", async () => {
    let counter = 0;
    pushQueue(sampleCard(1));
    expect(queueDeficit()).toBe(2);
    await ensureQueue(3, async () => {
      counter += 1;
      return sampleCard(counter);
    });
    expect(queueDeficit()).toBe(0);
  });

  it("refills to target after the queue is drained", async () => {
    let counter = 0;
    const fetchNext = async () => {
      counter += 1;
      return sampleCard(counter);
    };

    await ensureQueue(3, fetchNext);
    expect(queueLength()).toBe(3);

    dropFromQueue(1);
    dropFromQueue(2);
    dropFromQueue(3);
    expect(queueLength()).toBe(0);
    expect(queueDeficit()).toBe(3);

    scheduleQueueRefill(fetchNext);
    await waitForQueueRefill();

    expect(queueLength()).toBe(3);
    expect(queueDeficit()).toBe(0);
  });

  it("refills when a single card is consumed", async () => {
    let counter = 0;
    const fetchNext = async () => {
      counter += 1;
      return sampleCard(counter);
    };

    await ensureQueue(3, fetchNext);
    dropFromQueue(1);
    expect(queueDeficit()).toBe(1);

    scheduleQueueRefill(fetchNext);
    await waitForQueueRefill();

    expect(queueLength()).toBe(3);
  });

  it("rejects duplicate franchises in the queue", () => {
    pushQueue(sampleCard(1, "Spy x Family"));
    pushQueue(sampleCard(2, "Spy x Family Season 2"));
    expect(queueLength()).toBe(1);
  });

  it("rejects duplicate malId in pushQueue", () => {
    pushQueue(sampleCard(42));
    pushQueue(sampleCard(42));
    expect(queueLength()).toBe(1);
    expect(peekQueue()?.malId).toBe(42);
  });

  it("snapshotQueue dedupes by malId", () => {
    const unique = dedupeQueueByMalId([
      sampleCard(7),
      sampleCard(7),
      sampleCard(8),
    ]);
    expect(unique.map((c) => c.malId)).toEqual([7, 8]);
  });

  it("dropFromQueue removes every copy of malId", () => {
    injectPreviewQueueForTests([
      sampleCard(5),
      sampleCard(5),
      sampleCard(6),
    ]);
    dropFromQueue(5);
    expect(snapshotQueue().map((c) => c.malId)).toEqual([6]);
  });

  it("pauses background refill after catalog is exhausted", async () => {
    const fetchNext = vi.fn().mockRejectedValue(new CatalogExhaustedError());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    scheduleQueueRefill(fetchNext);
    await waitForQueueRefill();
    scheduleQueueRefill(fetchNext);
    await waitForQueueRefill();

    expect(fetchNext).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("dropFranchiseFromQueue removes all cards belonging to the franchise", () => {
    const card1 = sampleCard(1, "Frieren");
    const card2 = sampleCard(2, "Demon Slayer");
    injectPreviewQueueForTests([card1, card2]);
    expect(queueLength()).toBe(2);

    dropFranchiseFromQueue(card1.franchiseKey);
    expect(snapshotQueue().map((c) => c.malId)).toEqual([2]);
  });

  it("filters out exact rated/watchlisted malIds in pushQueue", () => {
    mockRatedMalIds.clear();
    mockWatchlistMalIds.clear();

    const ratedCard = sampleCard(3, "Frieren");
    mockRatedMalIds.add(3);

    const watchlistCard = sampleCard(4, "Demon Slayer");
    mockWatchlistMalIds.add(4);

    pushQueue(sampleCard(3, "Frieren")); // Should be rejected since exact malId is rated
    pushQueue(sampleCard(4, "Demon Slayer")); // Should be rejected since exact malId is watchlisted
    pushQueue(sampleCard(5, "Frieren")); // Should be allowed since it's a different season (different malId 5)
    pushQueue(sampleCard(6, "Demon Slayer")); // Should be allowed since different malId 6

    expect(snapshotQueue().map((c) => c.malId)).toEqual([5, 6]);

    // Clean up
    mockRatedMalIds.clear();
    mockWatchlistMalIds.clear();
  });
});

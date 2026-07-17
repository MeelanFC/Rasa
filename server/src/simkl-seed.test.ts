import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSimklTrendingMalIds } from "./simkl-seed.js";

describe("fetchSimklTrendingMalIds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses mal ids from static trending JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [
          { ids: { mal: "51553" } },
          { ids: { mal: "21" } },
          { ids: {} },
        ],
      }),
    );

    const malIds = await fetchSimklTrendingMalIds(10);
    expect(malIds).toEqual([51553, 21]);
  });

  it("returns empty array when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(fetchSimklTrendingMalIds()).resolves.toEqual([]);
  });
});

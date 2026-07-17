import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalApiError } from "./api-errors.js";
import { fetchAnimeEnrichment, resetJikanThrottleForTests } from "./jikan.js";

vi.mock("./fetch-retry.js", () => ({
  fetchWithRetry: vi.fn(),
}));

import { fetchWithRetry } from "./fetch-retry.js";

const fullPayload = {
  data: {
    mal_id: 1,
    title: "Test Anime",
    images: { jpg: { image_url: "https://cdn.example/full.jpg" } },
    synopsis: "A long enough synopsis for catalog readiness checks in the app.",
    genres: [{ name: "Action" }],
    themes: [],
    demographics: [],
    score: 8.1,
    popularity: 1000,
  },
};

const staffPayload = { data: [{ person: { name: "Director", mal_id: 2 }, positions: ["Director"] }] };

describe("fetchAnimeEnrichment", () => {
  beforeEach(() => {
    resetJikanThrottleForTests(0);
  });

  afterEach(() => {
    vi.mocked(fetchWithRetry).mockReset();
    resetJikanThrottleForTests();
  });

  it("returns full metadata when staff and characters rate-limit", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (_url, _init, options) => {
      if (options.path.endsWith("/full")) {
        return new Response(JSON.stringify(fullPayload), { status: 200 });
      }
      if (options.path.includes("/staff") || options.path.includes("/characters")) {
        throw new ExternalApiError("Jikan", 429, options.path);
      }
      if (options.path.includes("/relations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const enrichment = await fetchAnimeEnrichment(1);

    expect(enrichment.parsed.title_en).toBe("Test Anime");
    expect(enrichment.staff).toEqual([]);
    expect(enrichment.characters).toEqual([]);
    expect(enrichment.relations).toEqual([]);
  });

  it("includes staff when only characters fail", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (_url, _init, options) => {
      if (options.path.endsWith("/full")) {
        return new Response(JSON.stringify(fullPayload), { status: 200 });
      }
      if (options.path.includes("/staff")) {
        return new Response(JSON.stringify(staffPayload), { status: 200 });
      }
      if (options.path.includes("/characters")) {
        throw new ExternalApiError("Jikan", 429, options.path);
      }
      if (options.path.includes("/relations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const enrichment = await fetchAnimeEnrichment(1);

    expect(enrichment.staff).toHaveLength(1);
    expect(enrichment.characters).toEqual([]);
  });

  it("throws when /full fails after retries", async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(
      new ExternalApiError("Jikan", 429, "/anime/1/full"),
    );

    await expect(fetchAnimeEnrichment(1)).rejects.toBeInstanceOf(ExternalApiError);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalApiError } from "./api-errors.js";
import { fetchWithRetry, parseRetryAfterMs, retryDelayMs } from "./fetch-retry.js";

describe("parseRetryAfterMs", () => {
  it("parses Retry-After seconds", () => {
    const response = new Response(null, { headers: { "Retry-After": "2" } });
    expect(parseRetryAfterMs(response)).toBe(2000);
  });

  it("parses Retry-After HTTP-date", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const response = new Response(null, { headers: { "Retry-After": future } });
    const delay = parseRetryAfterMs(response);
    expect(delay).toBeGreaterThanOrEqual(4000);
    expect(delay).toBeLessThanOrEqual(6000);
  });
});

describe("retryDelayMs", () => {
  it("uses the longer of exponential backoff and Retry-After", () => {
    const response = new Response(null, { headers: { "Retry-After": "3" } });
    expect(retryDelayMs(0, response)).toBe(3000);
    expect(retryDelayMs(2, response)).toBe(3000);
  });
});

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries 429 up to five attempts then throws ExternalApiError", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = expect(
      fetchWithRetry("https://api.jikan.moe/v4/anime/1/staff", undefined, {
        service: "Jikan",
        path: "/anime/1/staff",
      }),
    ).rejects.toBeInstanceOf(ExternalApiError);

    await vi.runAllTimersAsync();
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
  });

  it("returns the response when a retry eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://example.com", undefined, {
      service: "Jikan",
      path: "/ok",
    });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

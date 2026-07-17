import { fetchWithRetry } from "./fetch-retry.js";

const SIMKL_TRENDING_URL =
  "https://data.simkl.in/discover/trending/anime/week_100.json";

const REQUEST_GAP_MS = 400;

let lastRequestAt = 0;

interface SimklTrendingEntry {
  ids?: {
    mal?: string | number | null;
  };
}

async function throttle(): Promise<void> {
  const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

function parseMalId(entry: SimklTrendingEntry): number | null {
  const raw = entry.ids?.mal;
  if (raw === null || raw === undefined) {
    return null;
  }
  const malId = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(malId) || malId <= 0) {
    return null;
  }
  return malId;
}

/**
 * Fetches Simkl static trending JSON and returns MAL ids (no per-vote API calls).
 * Fails soft: returns [] on network or parse errors.
 */
export async function fetchSimklTrendingMalIds(limit = 40): Promise<number[]> {
  try {
    await throttle();
    const response = await fetchWithRetry(
      SIMKL_TRENDING_URL,
      { headers: { Accept: "application/json" } },
      { service: "Simkl", path: "discover/trending/anime/week_100", attempts: 2 },
    );
    const json: unknown = await response.json();
    if (!Array.isArray(json)) {
      return [];
    }

    const malIds: number[] = [];
    for (const entry of json) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const malId = parseMalId(entry as SimklTrendingEntry);
      if (malId !== null) {
        malIds.push(malId);
      }
      if (malIds.length >= limit) {
        break;
      }
    }

    return [...new Set(malIds)];
  } catch {
    return [];
  }
}

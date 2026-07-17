import { ExternalApiError, isRetryableStatus } from "./api-errors.js";

const DEFAULT_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

export interface FetchRetryOptions {
  service: string;
  path: string;
  attempts?: number;
  onRetry?: (info: { status: number; attempt: number; delayMs: number }) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("network")
  );
}

/** Parse Retry-After as seconds or HTTP-date. */
export function parseRetryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) {
    return undefined;
  }

  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.min(asSeconds * 1000, MAX_DELAY_MS);
  }

  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    const delay = asDate - Date.now();
    if (delay > 0) {
      return Math.min(delay, MAX_DELAY_MS);
    }
  }

  return undefined;
}

/** Exponential backoff, honoring Retry-After when longer. */
export function retryDelayMs(attempt: number, response?: Response): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const retryAfter = response ? parseRetryAfterMs(response) : undefined;
  return Math.max(exponential, retryAfter ?? 0);
}

/**
 * Fetch with backoff for rate limits and gateway errors (429, 502/503/504).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  options: FetchRetryOptions,
): Promise<Response> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);

      if (response.ok) {
        return response;
      }

      if (isRetryableStatus(response.status) && attempt < attempts - 1) {
        const delayMs = retryDelayMs(attempt, response);
        options.onRetry?.({ status: response.status, attempt, delayMs });
        await sleep(delayMs);
        continue;
      }

      throw new ExternalApiError(options.service, response.status, options.path);
    } catch (error) {
      lastError = error;
      if (error instanceof ExternalApiError) {
        if (isRetryableStatus(error.status) && attempt < attempts - 1) {
          const delayMs = retryDelayMs(attempt);
          options.onRetry?.({ status: error.status, attempt, delayMs });
          await sleep(delayMs);
          continue;
        }
        throw error;
      }
      if (isTransientNetworkError(error) && attempt < attempts - 1) {
        const delayMs = retryDelayMs(attempt);
        options.onRetry?.({ status: 0, attempt, delayMs });
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

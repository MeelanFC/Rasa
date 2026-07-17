/** Typed errors for upstream APIs and user-facing HTTP responses. */

export class ExternalApiError extends Error {
  readonly service: string;
  readonly status: number;
  readonly path: string;

  constructor(service: string, status: number, path: string) {
    super(`${service} unavailable (${status})`);
    this.name = "ExternalApiError";
    this.service = service;
    this.status = status;
    this.path = path;
  }
}

export class CatalogNotReadyError extends Error {
  constructor(message = "Title is not ready to rate yet. Please try again.") {
    super(message);
    this.name = "CatalogNotReadyError";
  }
}

export class QueueUnavailableError extends Error {
  constructor(
    message = "Could not load the next title right now. Your connection may be busy; try again in a moment.",
  ) {
    super(message);
    this.name = "QueueUnavailableError";
  }
}

export class CatalogExhaustedError extends Error {
  constructor(
    message = "No new franchises left to rate right now. Check back later; we are still expanding the catalog.",
  ) {
    super(message);
    this.name = "CatalogExhaustedError";
  }
}

export function isCatalogExhaustedError(error: unknown): boolean {
  if (error instanceof CatalogExhaustedError) {
    return true;
  }
  return error instanceof Error && error.message.includes("No new franchises");
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

export function toUserMessage(error: unknown): string {
  if (error instanceof CatalogNotReadyError) {
    return error.message;
  }
  if (error instanceof QueueUnavailableError) {
    return error.message;
  }
  if (error instanceof CatalogExhaustedError) {
    return error.message;
  }
  if (error instanceof ExternalApiError) {
    return `${error.service} is temporarily unavailable. Wait a few seconds and try again.`;
  }
  if (error instanceof Error) {
    if (error.message.includes("No new franchises")) {
      return error.message;
    }
    if (error.message.includes("Jikan") || error.message.includes("MangaDex")) {
      return "Our data providers are temporarily unavailable. Please try again shortly.";
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export function toHttpStatus(error: unknown): number {
  if (error instanceof CatalogNotReadyError) {
    return 409;
  }
  if (error instanceof QueueUnavailableError || error instanceof ExternalApiError) {
    return 503;
  }
  return 500;
}

import { describe, expect, it } from "vitest";
import {
  CatalogNotReadyError,
  ExternalApiError,
  QueueUnavailableError,
  isRetryableStatus,
  toHttpStatus,
  toUserMessage,
} from "./api-errors.js";

describe("api-errors", () => {
  it("maps upstream failures to 503 and friendly copy", () => {
    const error = new ExternalApiError("Jikan", 502, "/anime/1/full");
    expect(toHttpStatus(error)).toBe(503);
    expect(toUserMessage(error)).toContain("Jikan");
    expect(isRetryableStatus(502)).toBe(true);
  });

  it("maps catalog not ready to 409", () => {
    const error = new CatalogNotReadyError();
    expect(toHttpStatus(error)).toBe(409);
  });

  it("maps queue unavailable to 503", () => {
    expect(toHttpStatus(new QueueUnavailableError())).toBe(503);
  });
});

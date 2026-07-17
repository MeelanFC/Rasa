import { describe, expect, it } from "vitest";
import { CatalogNotReadyError } from "./api-errors.js";
import {
  assertCatalogRowReady,
  isCatalogRowReady,
  isParsedAnimeReady,
} from "./catalog.js";

describe("isCatalogRowReady", () => {
  it("rejects placeholder synopsis and unknown titles", () => {
    expect(
      isCatalogRowReady({
        title_en: "Unknown",
        title_jp: "x",
        synopsis: "Synopsis loading…",
        image_url: "https://cdn.myanimelist.net/img.jpg",
      }),
    ).toBe(false);

    expect(
      isCatalogRowReady({
        title_en: "Cowboy Bebop",
        title_jp: "Cowboy Bebop",
        synopsis:
          "In the year 2071, humanity has colonized several planets and moons of the solar system.",
        image_url: "https://cdn.myanimelist.net/img.jpg",
      }),
    ).toBe(true);
  });
});

describe("isParsedAnimeReady", () => {
  it("matches catalog readiness for parsed rows", () => {
    expect(
      isParsedAnimeReady({
        title_en: "Trigun",
        synopsis: "Vash the Stampede is a gunman with a legend so ruthless.",
        image_url: "https://cdn.myanimelist.net/img.jpg",
      }),
    ).toBe(true);
  });
});

describe("assertCatalogRowReady", () => {
  it("throws CatalogNotReadyError for missing rows", () => {
    expect(() => assertCatalogRowReady(undefined, 99)).toThrow(CatalogNotReadyError);
  });
});

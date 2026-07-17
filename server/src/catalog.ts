import { CatalogNotReadyError } from "./api-errors.js";
import type { AnimeRow } from "./types.js";

const PLACEHOLDER_SYNOPSIS_MARKERS = [
  "synopsis loading",
  "no synopsis available",
  "no description available",
] as const;

export interface CatalogLike {
  title_en: string;
  title_jp: string;
  synopsis: string;
  image_url: string;
}

/** True when a row is safe to show in Discover or accept a rating. */
export function isCatalogRowReady(row: CatalogLike): boolean {
  const title = row.title_en.trim().toLowerCase();
  if (title.length === 0 || title === "unknown") {
    return false;
  }

  const synopsis = row.synopsis.trim().toLowerCase();
  if (synopsis.length < 40) {
    return false;
  }

  if (PLACEHOLDER_SYNOPSIS_MARKERS.some((marker) => synopsis.includes(marker))) {
    return false;
  }

  if (!row.image_url.trim() || row.image_url.includes("placeholder")) {
    return false;
  }

  return true;
}

export function isParsedAnimeReady(parsed: {
  title_en: string;
  synopsis: string;
  image_url: string;
}): boolean {
  return isCatalogRowReady({
    title_en: parsed.title_en,
    title_jp: parsed.title_en,
    synopsis: parsed.synopsis,
    image_url: parsed.image_url,
  });
}

export function assertCatalogRowReady(
  row: AnimeRow | undefined,
  malId: number,
): asserts row is AnimeRow {
  if (!row) {
    throw new CatalogNotReadyError(`Cannot rate unknown title (${malId}).`);
  }
  if (!isCatalogRowReady(row)) {
    throw new CatalogNotReadyError(
      "Cannot save vote: title data is still loading. Try again in a moment.",
    );
  }
}

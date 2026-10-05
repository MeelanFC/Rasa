import { fetchWithRetry } from "./fetch-retry.js";

/**
 * MangaDex client: Korean full-color manhwa only (no manga / manhua).
 * @see https://api.mangadex.org/docs/03-manga/search/
 */

const BASE_URL = "https://api.mangadex.org";
const REQUEST_GAP_MS = 350;

/** @see https://api.mangadex.org/manga/tag */
export const TAG_FULL_COLOR = "f5ba408b-0e7a-484d-8d49-4e9125ac96de";
export const TAG_OFFICIAL_COLORED = "320831a8-4026-470b-94f6-8353740e6f04";
/** Chinese martial-arts; common manhua signal on MangaDex */
export const TAG_WUXIA = "acc803a4-c95a-4c22-86fc-eb6b582d82a2";

const MANHWA_ID_BASE = 800_000_000;

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

interface MangaDexLocalized {
  en?: string;
  ko?: string;
  "ja-ro"?: string;
  [key: string]: string | undefined;
}

interface MangaDexMangaAttributes {
  title: MangaDexLocalized;
  altTitles?: Array<Record<string, string>>;
  description: MangaDexLocalized;
  originalLanguage: string;
  publicationDemographic?: string | null;
  lastChapter: string | null;
  status: string;
  year: number | null;
  contentRating: string;
  tags?: Array<{
    id: string;
    type: string;
    attributes: {
      name: { en?: string };
      group?: string;
    };
  }>;
}

interface MangaDexRelationship {
  id: string;
  type: string;
  attributes?: {
    fileName?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  };
}

interface MangaDexAuthorEntity {
  id: string;
  type: "author" | "artist";
  attributes: {
    name: string;
    firstName?: string;
    lastName?: string;
  };
}

interface MangaDexMangaEntity {
  id: string;
  type: string;
  attributes: MangaDexMangaAttributes;
  relationships: MangaDexRelationship[];
}

interface MangaDexCoverArt {
  id: string;
  type: "cover_art";
  attributes: { fileName: string };
}

interface MangaDexCollectionResponse {
  result: string;
  data: MangaDexMangaEntity[];
  included?: MangaDexCoverArt[];
  limit: number;
  offset: number;
  total: number;
}

export interface MangaDexTasteMeta {
  tags: string[];
  tasteFeatures: string[];
  status: string;
  year: number | null;
  contentRating: string;
}

interface MangaDexStatisticsResponse {
  result: string;
  statistics: Record<
    string,
    {
      chapters?: { total?: number };
    }
  >;
}

export interface ParsedManhwa {
  mangadexId: string;
  malId: number;
  titleEn: string;
  titleRomaji: string;
  synopsis: string;
  imageUrl: string;
  genres: string;
  themes: string;
  demographics: string;
  score: null;
  popularity: number;
  chapterCount: number | null;
}

export function mangadexIdToMalId(mangadexId: string): number {
  const hex = mangadexId.replace(/-/g, "").slice(0, 8);
  const bucket = Number.parseInt(hex, 16) % 99_000_000;
  return MANHWA_ID_BASE + bucket;
}

function pickLocalized(map: MangaDexLocalized | undefined, preferred: string[]): string {
  if (!map) {
    return "";
  }
  for (const key of preferred) {
    const value = map[key]?.trim();
    if (value) {
      return value;
    }
  }
  for (const value of Object.values(map)) {
    if (value?.trim()) {
      return value.trim();
    }
  }
  return "";
}

function resolveTitles(attributes: MangaDexMangaAttributes): {
  titleEn: string;
  titleRomaji: string;
} {
  const titleEn =
    pickLocalized(attributes.title, ["en", "en-us"]) ||
    attributes.altTitles?.find((entry) => entry.en)?.en?.trim() ||
    pickLocalized(attributes.title, ["ko-ro", "ja-ro", "ko"]) ||
    "Untitled";

  const titleRomaji =
    pickLocalized(attributes.title, ["ko", "ko-ro", "ja-ro"]) ||
    attributes.altTitles?.find((entry) => entry.ko)?.ko?.trim() ||
    titleEn;

  return { titleEn, titleRomaji };
}

function resolveDescription(attributes: MangaDexMangaAttributes): string {
  const text = pickLocalized(attributes.description, ["en", "en-us", "ko"]);
  return text || "No description available.";
}

function resolveCoverUrl(
  entity: MangaDexMangaEntity,
  included: MangaDexCoverArt[] | undefined,
): string {
  const coverRel = entity.relationships.find((rel) => rel.type === "cover_art");
  if (!coverRel) {
    return "";
  }
  const cover = included?.find((item) => item.type === "cover_art" && item.id === coverRel.id);
  if (cover?.attributes.fileName) {
    return buildCoverUrl(entity.id, cover.attributes.fileName);
  }
  return "";
}

export function buildCoverUrl(mangaId: string, fileName: string): string {
  return `https://uploads.mangadex.org/covers/${mangaId}/${fileName}`;
}

function tagNames(attributes: MangaDexMangaAttributes): string[] {
  return (attributes.tags ?? [])
    .map((tag) => tag.attributes.name.en)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

function slugTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function prefixFeature(kind: string, value: string): string {
  const slug = slugTag(value);
  return slug.length > 0 ? `${kind}:${slug}` : "";
}

/** Maps MangaDex tag groups into taste feature prefixes. */
export function mangadexTagFeatures(attributes: MangaDexMangaAttributes): string[] {
  const features: string[] = [];

  for (const tag of attributes.tags ?? []) {
    const name = tag.attributes.name.en?.trim();
    if (!name) {
      continue;
    }
    const group = tag.attributes.group?.toLowerCase() ?? "theme";
    switch (group) {
      case "genre":
        features.push(prefixFeature("genre", name));
        break;
      case "format":
        features.push(prefixFeature("format", name));
        break;
      case "content":
        features.push(prefixFeature("content", name));
        break;
      default:
        features.push(prefixFeature("theme", name));
        break;
    }
  }

  const demographic = attributes.publicationDemographic?.trim();
  if (demographic) {
    features.push(prefixFeature("demo", demographic));
  }

  return [...new Set(features.filter((feature) => feature.length > 0))];
}

function authorNameFromEntity(entity: MangaDexAuthorEntity): string {
  const direct = entity.attributes.name?.trim();
  if (direct) {
    return direct;
  }
  const parts = [entity.attributes.firstName, entity.attributes.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

function authorFeaturesFromIncluded(
  entity: MangaDexMangaEntity,
  included: MangaDexAuthorEntity[] | undefined,
): string[] {
  if (!included?.length) {
    return [];
  }

  const byId = new Map(included.map((item) => [item.id, item]));
  const features: string[] = [];

  for (const rel of entity.relationships) {
    if (rel.type !== "author" && rel.type !== "artist") {
      continue;
    }
    const person = byId.get(rel.id);
    const name = person ? authorNameFromEntity(person) : rel.attributes?.name?.trim() ?? "";
    if (!name) {
      continue;
    }
    features.push(prefixFeature(rel.type, name));
  }

  return [...new Set(features.filter((feature) => feature.length > 0))].slice(0, 8);
}

export function parseLastChapterNumber(lastChapter: string | null): number | null {
  if (!lastChapter?.trim()) {
    return null;
  }
  const match = /(\d+(?:\.\d+)?)/.exec(lastChapter);
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? Math.floor(value) : null;
}

export function parseManhwaEntity(
  entity: MangaDexMangaEntity,
  chapterCount: number | null,
  followedCount = 0,
  included?: MangaDexCoverArt[],
): ParsedManhwa {
  const { titleEn, titleRomaji } = resolveTitles(entity.attributes);
  const imageUrl =
    resolveCoverUrl(entity, included) ||
    "https://uploads.mangadex.org/covers/placeholder.jpg";

  const tags = tagNames(entity.attributes);
  const genres = tags.filter((tag) => !["Full Color", "Official Colored", "Long Strip", "Web Comic"].includes(tag));

  return {
    mangadexId: entity.id,
    malId: mangadexIdToMalId(entity.id),
    titleEn,
    titleRomaji,
    synopsis: resolveDescription(entity.attributes),
    imageUrl,
    genres: JSON.stringify([...genres, "Manhwa"]),
    themes: JSON.stringify(tags.filter((t) => ["Full Color", "Official Colored", "Long Strip", "Web Comic"].includes(t))),
    demographics: JSON.stringify(["Manhwa"]),
    score: null,
    popularity: followedCount,
    chapterCount: chapterCount ?? parseLastChapterNumber(entity.attributes.lastChapter),
  };
}

async function mangadexGet<T>(path: string, params: Record<string, string | string[]>): Promise<T> {
  await throttle();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        search.append(key, item);
      }
    } else {
      search.set(key, value);
    }
  }

  const url = `${BASE_URL}${path}?${search.toString()}`;
  const response = await fetchWithRetry(
    url,
    { headers: { "User-Agent": "MAL-Reco/1.0 (local taste app)" } },
    { service: "MangaDex", path },
  );

  return (await response.json()) as T;
}

export function parseMangaDexTasteMeta(
  entity: MangaDexMangaEntity,
  includedAuthors?: MangaDexAuthorEntity[],
): MangaDexTasteMeta {
  const tagFeatureList = mangadexTagFeatures(entity.attributes);
  const authorFeatures = authorFeaturesFromIncluded(entity, includedAuthors);

  return {
    tags: tagNames(entity.attributes),
    tasteFeatures: [...tagFeatureList, ...authorFeatures],
    status: entity.attributes.status,
    year: entity.attributes.year,
    contentRating: entity.attributes.contentRating,
  };
}

interface MangaDexEntityWithIncludedResponse {
  result: string;
  data: MangaDexMangaEntity;
  included?: MangaDexAuthorEntity[];
}

export async function fetchMangaDexTasteMeta(mangaId: string): Promise<MangaDexTasteMeta | null> {
  try {
    const payload = await mangadexGet<MangaDexEntityWithIncludedResponse>(`/manga/${mangaId}`, {
      "includes[]": ["author", "artist"],
    });
    const authors = (payload.included ?? []).filter(
      (item): item is MangaDexAuthorEntity =>
        item.type === "author" || item.type === "artist",
    );
    return parseMangaDexTasteMeta(payload.data, authors);
  } catch {
    return null;
  }
}

export async function fetchMangaChapterTotal(mangaId: string): Promise<number | null> {
  try {
    const payload = await mangadexGet<MangaDexStatisticsResponse>(
      `/statistics/manga/${mangaId}`,
      {},
    );
    const total = payload.statistics[mangaId]?.chapters?.total;
    return typeof total === "number" && total > 0 ? total : null;
  } catch {
    return null;
  }
}

/**
 * Korean-origin, full-color titles from MangaDex (webtoon-style manhwa).
 * Excludes Japanese manga and Chinese manhua via language + tag filters.
 */
export async function fetchManhwaPage(
  offset: number,
  limit = 20,
): Promise<{ items: ParsedManhwa[]; total: number }> {
  const payload = await mangadexGet<MangaDexCollectionResponse>("/manga", {
    "originalLanguage[]": ["ko"],
    "includedTags[]": [TAG_FULL_COLOR],
    "excludedTags[]": [TAG_WUXIA],
    "contentRating[]": ["safe", "suggestive", "erotica"],
    "order[followedCount]": "desc",
    limit: String(limit),
    offset: String(offset),
    "includes[]": ["cover_art"],
  });

  const items: ParsedManhwa[] = [];

  for (const entity of payload.data) {
    if (entity.attributes.originalLanguage !== "ko") {
      continue;
    }

    const chapterCount = parseLastChapterNumber(entity.attributes.lastChapter);
    items.push(
      parseManhwaEntity(entity, chapterCount, payload.total - offset, payload.included),
    );
  }

  return { items, total: payload.total };
}

/** Alternate ingest path: official-colored Korean works. */
export async function fetchOfficialColoredManhwaPage(
  offset: number,
  limit = 20,
): Promise<{ items: ParsedManhwa[]; total: number }> {
  const payload = await mangadexGet<MangaDexCollectionResponse>("/manga", {
    "originalLanguage[]": ["ko"],
    "includedTags[]": [TAG_OFFICIAL_COLORED],
    "excludedTags[]": [TAG_WUXIA],
    "contentRating[]": ["safe", "suggestive", "erotica"],
    "order[latestUploadedChapter]": "desc",
    limit: String(limit),
    offset: String(offset),
    "includes[]": ["cover_art"],
  });

  const items: ParsedManhwa[] = [];
  for (const entity of payload.data) {
    if (entity.attributes.originalLanguage !== "ko") {
      continue;
    }
    const chapterCount = parseLastChapterNumber(entity.attributes.lastChapter);
    items.push(parseManhwaEntity(entity, chapterCount, 0, payload.included));
  }

  return { items, total: payload.total };
}

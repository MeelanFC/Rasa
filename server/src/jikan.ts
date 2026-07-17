import { z } from "zod";
import { ExternalApiError } from "./api-errors.js";
import { fetchWithRetry } from "./fetch-retry.js";

const JIKAN_BASE = "https://api.jikan.moe/v4";
const JIKAN_SERVICE = "Jikan";

const genreSchema = z.object({ name: z.string() });

const namedEntitySchema = z.object({ name: z.string() });

const imagesSchema = z.object({
  jpg: z.object({
    large_image_url: z.string().optional(),
    image_url: z.string(),
  }),
});

const titleEntrySchema = z.object({
  type: z.string(),
  title: z.string(),
});

const animeListItemSchema = z.object({
  mal_id: z.number(),
  title: z.string().optional(),
  titles: z.array(titleEntrySchema).optional(),
  title_english: z.string().nullable().optional(),
  title_japanese: z.string().nullable().optional(),
  images: imagesSchema,
  synopsis: z.string().nullable().optional(),
  genres: z.array(genreSchema).optional(),
  themes: z.array(genreSchema).optional(),
  demographics: z.array(genreSchema).optional(),
  score: z.number().nullable().optional(),
  popularity: z.number().optional(),
  members: z.number().optional(),
});

const topAnimeResponseSchema = z.object({
  data: z.array(animeListItemSchema),
});

const animeFullDataSchema = z.object({
  mal_id: z.number(),
  url: z.string().optional(),
  title: z.string(),
  titles: z.array(titleEntrySchema).optional(),
  title_english: z.string().nullable().optional(),
  title_japanese: z.string().nullable().optional(),
  images: imagesSchema,
  synopsis: z.string().nullable(),
  background: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  season: z.string().nullable().optional(),
  status: z.string().optional(),
  aired: z
    .object({
      from: z.string().nullable(),
      to: z.string().nullable(),
      string: z.string().optional(),
    })
    .optional(),
  episodes: z.number().nullable().optional(),
  duration: z.string().optional(),
  rating: z.string().optional(),
  score: z.number().nullable(),
  scored_by: z.number().nullable().optional(),
  rank: z.number().nullable().optional(),
  popularity: z.number().nullable(),
  members: z.number().nullable().optional(),
  favorites: z.number().nullable().optional(),
  genres: z.array(genreSchema),
  themes: z.array(genreSchema),
  demographics: z.array(genreSchema),
  explicit_genres: z.array(genreSchema).optional(),
  studios: z.array(namedEntitySchema).optional(),
  producers: z.array(namedEntitySchema).optional(),
  licensors: z.array(namedEntitySchema).optional(),
  source: z.string().optional(),
  trailer: z
    .object({
      url: z.string().nullable().optional(),
      embed_url: z.string().nullable().optional(),
    })
    .optional(),
});

const animeFullResponseSchema = z.object({
  data: animeFullDataSchema,
});

const charactersResponseSchema = z.object({
  data: z.array(
    z.object({
      character: z.object({
        mal_id: z.number(),
        name: z.string(),
        images: z
          .object({
            jpg: z.object({ image_url: z.string().optional() }).optional(),
          })
          .optional(),
      }),
      role: z.string(),
      voice_actors: z
        .array(
          z.object({
            person: z.object({ name: z.string() }),
            language: z.string(),
          }),
        )
        .optional(),
    }),
  ),
});

const staffResponseSchema = z.object({
  data: z.array(
    z.object({
      person: z.object({
        mal_id: z.number().optional(),
        name: z.string(),
      }),
      positions: z.array(z.string()),
    }),
  ),
});

const recommendationsResponseSchema = z.object({
  data: z.array(
    z.object({
      entry: z.object({
        mal_id: z.number(),
        title: z.string(),
        images: imagesSchema,
      }),
      url: z.string().optional(),
    }),
  ),
});

const relationsResponseSchema = z.object({
  data: z.array(
    z.object({
      relation: z.string(),
      entry: z.array(
        z.object({
          mal_id: z.number(),
          type: z.string(),
          name: z.string(),
        }),
      ),
    }),
  ),
});

export interface ParsedAnime {
  mal_id: number;
  title_en: string;
  title_romaji: string;
  synopsis: string;
  image_url: string;
  genres: string;
  themes: string;
  demographics: string;
  score: number | null;
  popularity: number;
}

export interface AnimeCharacter {
  malId: number;
  name: string;
  role: string;
  imageUrl: string | null;
  voiceActor: string | null;
}

export interface AnimeRecommendation {
  malId: number;
  title: string;
  imageUrl: string;
}

export interface AnimeStaffMember {
  name: string;
  positions: string[];
}

export interface AnimeRelationGroup {
  relation: string;
  entries: Array<{ malId: number; type: string; name: string }>;
}

export interface AnimeEnrichment {
  parsed: ParsedAnime;
  studios: string[];
  source: string | null;
  episodes: number | null;
  background: string | null;
  staff: AnimeStaffMember[];
  characters: AnimeCharacter[];
  relations: AnimeRelationGroup[];
}

export interface AnimeDetail {
  malId: number;
  malUrl: string | null;
  titleEn: string;
  titleRomaji: string;
  synopsis: string;
  background: string | null;
  imageUrl: string;
  trailerUrl: string | null;
  year: number | null;
  season: string | null;
  status: string | null;
  aired: string | null;
  episodes: number | null;
  duration: string | null;
  ageRating: string | null;
  score: number | null;
  scoredBy: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  favorites: number | null;
  source: string | null;
  genres: string[];
  themes: string[];
  demographics: string[];
  explicitGenres: string[];
  studios: string[];
  producers: string[];
  licensors: string[];
  characters: AnimeCharacter[];
  recommendations: AnimeRecommendation[];
}

const MIN_GAP_MS = 1200;
const MAX_GAP_MS = 3000;
const RATE_LIMIT_GAP_BUMP_MS = 250;

let lastRequestAt = 0;
let minGapMs = MIN_GAP_MS;

function noteRateLimit(): void {
  minGapMs = Math.min(minGapMs + RATE_LIMIT_GAP_BUMP_MS, MAX_GAP_MS);
}

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < minGapMs) {
    await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
  }
  lastRequestAt = Date.now();
}

/** Reset throttle state (for tests only). */
export function resetJikanThrottleForTests(minGapOverride = MIN_GAP_MS): void {
  lastRequestAt = 0;
  minGapMs = minGapOverride;
}

async function jikanFetch<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  await throttle();
  const response = await fetchWithRetry(
    `${JIKAN_BASE}${path}`,
    { headers: { "User-Agent": "MAL-Reco/1.0 (local taste app)" } },
    {
      service: JIKAN_SERVICE,
      path,
      onRetry: ({ status }) => {
        if (status === 429) {
          noteRateLimit();
        }
      },
    },
  );
  const json: unknown = await response.json();
  return schema.parse(json);
}

function isJikanRateLimit(error: unknown): boolean {
  return error instanceof ExternalApiError && error.status === 429;
}

function titleFromEntries(
  entries: Array<{ type: string; title: string }> | undefined,
  type: string,
): string | undefined {
  const match = entries?.find((entry) => entry.type.toLowerCase() === type.toLowerCase());
  return match?.title.trim() || undefined;
}

/** English display title + romaji (latin script), never kanji/kana. */
export function resolveTitles(item: {
  title?: string;
  titles?: Array<{ type: string; title: string }>;
  title_english?: string | null;
}): { en: string; romaji: string } {
  const defaultTitle = item.title?.trim() ?? "Unknown";
  const english =
    item.title_english?.trim() ||
    titleFromEntries(item.titles, "English") ||
    defaultTitle;
  const romaji =
    titleFromEntries(item.titles, "Default") ||
    defaultTitle;

  return { en: english, romaji };
}

function namesFromTags(tags: Array<{ name: string }> | undefined): string[] {
  return (tags ?? []).map((tag) => tag.name);
}

function toDbRow(item: z.infer<typeof animeListItemSchema>, synopsisFallback = ""): ParsedAnime {
  const { en, romaji } = resolveTitles(item);
  const image =
    item.images.jpg.large_image_url ?? item.images.jpg.image_url;

  return {
    mal_id: item.mal_id,
    title_en: en,
    title_romaji: romaji,
    synopsis: item.synopsis?.trim() || synopsisFallback,
    image_url: image,
    genres: JSON.stringify(namesFromTags(item.genres)),
    themes: JSON.stringify(namesFromTags(item.themes)),
    demographics: JSON.stringify(namesFromTags(item.demographics)),
    score: item.score ?? null,
    popularity: item.popularity ?? item.members ?? 0,
  };
}

function mapFullToDetail(
  item: z.infer<typeof animeFullDataSchema>,
  characters: AnimeCharacter[],
  recommendations: AnimeRecommendation[],
): AnimeDetail {
  const { en, romaji } = resolveTitles(item);
  const image =
    item.images.jpg.large_image_url ?? item.images.jpg.image_url;

  return {
    malId: item.mal_id,
    malUrl: item.url ?? null,
    titleEn: en,
    titleRomaji: romaji,
    synopsis: item.synopsis?.trim() || "No synopsis available.",
    background: item.background?.trim() || null,
    imageUrl: image,
    trailerUrl: item.trailer?.url ?? item.trailer?.embed_url ?? null,
    year: item.year ?? null,
    season: item.season ?? null,
    status: item.status ?? null,
    aired: item.aired?.string ?? null,
    episodes: item.episodes ?? null,
    duration: item.duration ?? null,
    ageRating: item.rating ?? null,
    score: item.score,
    scoredBy: item.scored_by ?? null,
    rank: item.rank ?? null,
    popularity: item.popularity,
    members: item.members ?? null,
    favorites: item.favorites ?? null,
    source: item.source ?? null,
    genres: namesFromTags(item.genres),
    themes: namesFromTags(item.themes),
    demographics: namesFromTags(item.demographics),
    explicitGenres: namesFromTags(item.explicit_genres),
    studios: namesFromTags(item.studios),
    producers: namesFromTags(item.producers),
    licensors: namesFromTags(item.licensors),
    characters,
    recommendations,
  };
}

export async function fetchTopAnime(limit = 25, page = 1): Promise<ParsedAnime[]> {
  const result = await jikanFetch(
    `/top/anime?filter=bypopularity&limit=${limit}&page=${page}`,
    topAnimeResponseSchema,
  );
  return result.data.map((item) => toDbRow(item, "Synopsis loading…"));
}

/** Title search (used by favorite-seeding); most-membered first for relevance. */
export async function fetchAnimeSearch(query: string, limit = 5): Promise<ParsedAnime[]> {
  const result = await jikanFetch(
    `/anime?q=${encodeURIComponent(query)}&order_by=members&sort=desc&limit=${limit}`,
    topAnimeResponseSchema,
  );
  return result.data.map((item) => toDbRow(item, "Synopsis loading…"));
}

/** Search Jikan anime catalog by genre, sorted by MAL score to prioritize quality candidates. */
export async function fetchAnimeByGenre(genreId: number, page = 1, limit = 25): Promise<ParsedAnime[]> {
  const result = await jikanFetch(
    `/anime?genres=${genreId}&order_by=score&sort=desc&limit=${limit}&page=${page}`,
    topAnimeResponseSchema,
  );
  return result.data.map((item) => toDbRow(item, "Synopsis loading…"));
}

/** Current-season shows: extra catalog when popularity pages are exhausted. */
export async function fetchSeasonNow(limit = 25): Promise<ParsedAnime[]> {
  const result = await jikanFetch(
    `/seasons/now?limit=${limit}`,
    topAnimeResponseSchema,
  );
  return result.data.map((item) => toDbRow(item, "Synopsis loading…"));
}

export async function fetchAnimeStaff(malId: number): Promise<AnimeStaffMember[]> {
  const result = await jikanFetch(`/anime/${malId}/staff`, staffResponseSchema);
  return result.data.slice(0, 24).map((row) => ({
    name: row.person.name,
    positions: row.positions,
  }));
}

export async function fetchAnimeRelations(malId: number): Promise<AnimeRelationGroup[]> {
  const result = await jikanFetch(`/anime/${malId}/relations`, relationsResponseSchema);
  return result.data.map((group) => ({
    relation: group.relation,
    entries: group.entry.map((entry) => ({
      malId: entry.mal_id,
      type: entry.type,
      name: entry.name,
    })),
  }));
}

function mapFullToParsed(item: z.infer<typeof animeFullDataSchema>): ParsedAnime {
  const { en, romaji } = resolveTitles(item);
  const image =
    item.images.jpg.large_image_url ?? item.images.jpg.image_url;

  return {
    mal_id: item.mal_id,
    title_en: en,
    title_romaji: romaji,
    synopsis: item.synopsis?.trim() || "No synopsis available.",
    image_url: image,
    genres: JSON.stringify(namesFromTags(item.genres)),
    themes: JSON.stringify(namesFromTags(item.themes)),
    demographics: JSON.stringify(namesFromTags(item.demographics)),
    score: item.score,
    popularity: item.popularity ?? 0,
  };
}

/**
 * Full metadata + sequential Jikan supplements (staff → characters → relations).
 * Cold path only (detail page / legacy callers); not used on Discover queue picks.
 */
export async function fetchAnimeEnrichment(malId: number): Promise<AnimeEnrichment> {
  const full = await jikanFetch(`/anime/${malId}/full`, animeFullResponseSchema);
  const item = full.data;

  let staff: AnimeStaffMember[] = [];
  try {
    staff = await fetchAnimeStaff(malId);
  } catch (error) {
    console.warn(`[jikan] staff unavailable for ${malId}`, error);
  }

  let characters: AnimeCharacter[] = [];
  try {
    characters = (await fetchAnimeCharacters(malId)).slice(0, 12);
  } catch (error) {
    console.warn(`[jikan] characters unavailable for ${malId}`, error);
  }

  let relations: AnimeRelationGroup[] = [];
  try {
    relations = await fetchAnimeRelations(malId);
  } catch (error) {
    console.warn(`[jikan] relations unavailable for ${malId}`, error);
  }

  return {
    parsed: mapFullToParsed(item),
    studios: namesFromTags(item.studios),
    source: item.source ?? null,
    episodes: item.episodes ?? null,
    background: item.background?.trim() || null,
    staff,
    characters,
    relations,
  };
}

export async function fetchAnimeFull(malId: number): Promise<ParsedAnime> {
  const result = await jikanFetch(`/anime/${malId}/full`, animeFullResponseSchema);
  return mapFullToParsed(result.data);
}

/** Rich metadata from a single Jikan `/full` call (taste enrichment). */
export interface AnimeFullTasteMeta {
  studios: string[];
  producers: string[];
  licensors: string[];
  explicitGenres: string[];
  source: string | null;
  episodes: number | null;
  background: string | null;
  year: number | null;
  season: string | null;
  status: string | null;
  ageRating: string | null;
  malScore: number | null;
  scoredBy: number | null;
  rank: number | null;
  popularity: number | null;
}

export function mapFullDataToTasteMeta(
  item: z.infer<typeof animeFullDataSchema>,
): AnimeFullTasteMeta {
  return {
    studios: namesFromTags(item.studios),
    producers: namesFromTags(item.producers),
    licensors: namesFromTags(item.licensors),
    explicitGenres: namesFromTags(item.explicit_genres),
    source: item.source ?? null,
    episodes: item.episodes ?? null,
    background: item.background?.trim() || null,
    year: item.year ?? null,
    season: item.season ?? null,
    status: item.status ?? null,
    ageRating: item.rating ?? null,
    malScore: item.score,
    scoredBy: item.scored_by ?? null,
    rank: item.rank ?? null,
    popularity: item.popularity,
  };
}

export async function fetchAnimeFullTasteMeta(malId: number): Promise<AnimeFullTasteMeta> {
  const result = await jikanFetch(`/anime/${malId}/full`, animeFullResponseSchema);
  return mapFullDataToTasteMeta(result.data);
}

export async function fetchAnimeCharacters(malId: number): Promise<AnimeCharacter[]> {
  const result = await jikanFetch(
    `/anime/${malId}/characters`,
    charactersResponseSchema,
  );

  return result.data.slice(0, 24).map((row) => {
    const englishVa = row.voice_actors?.find((va) => va.language === "Japanese")
      ?? row.voice_actors?.[0];

    return {
      malId: row.character.mal_id,
      name: row.character.name,
      role: row.role,
      imageUrl: row.character.images?.jpg?.image_url ?? null,
      voiceActor: englishVa?.person.name ?? null,
    };
  });
}

export async function fetchAnimeRecommendations(
  malId: number,
): Promise<AnimeRecommendation[]> {
  const result = await jikanFetch(
    `/anime/${malId}/recommendations`,
    recommendationsResponseSchema,
  );

  return result.data.slice(0, 12).map((row) => ({
    malId: row.entry.mal_id,
    title: row.entry.title,
    imageUrl:
      row.entry.images.jpg.large_image_url ?? row.entry.images.jpg.image_url,
  }));
}

export async function fetchAnimeDetail(malId: number): Promise<AnimeDetail> {
  const full = await jikanFetch(`/anime/${malId}/full`, animeFullResponseSchema);

  let characters: AnimeCharacter[] = [];
  try {
    characters = await fetchAnimeCharacters(malId);
  } catch {
    // Detail page still works without cast.
  }

  let recommendations: AnimeRecommendation[] = [];
  try {
    recommendations = await fetchAnimeRecommendations(malId);
  } catch {
    // Detail page still works without related titles.
  }

  return mapFullToDetail(full.data, characters, recommendations);
}

/** Jikan recommendation entries for taste expansion (mal ids only). */
export async function fetchRecommendationIdsFromLoved(
  lovedMalIds: number[],
): Promise<number[]> {
  const ids = new Set<number>();

  for (const malId of lovedMalIds.slice(0, 3)) {
    try {
      const recs = await fetchAnimeRecommendations(malId);
      for (const rec of recs) {
        ids.add(rec.malId);
      }
    } catch (error) {
      if (isJikanRateLimit(error)) {
        console.warn(`[jikan] recommendations rate-limited for ${malId}, skipping`);
      }
    }
  }

  return [...ids];
}

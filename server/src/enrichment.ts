import { CatalogNotReadyError, QueueUnavailableError } from "./api-errors.js";
import { fetchAnilistEnrichment, type AnilistEnrichment } from "./anilist.js";
import { isCatalogRowReady, isParsedAnimeReady } from "./catalog.js";
import { getAllAnime, getAnimeById, upsertAnime } from "./db.js";
import {
  buildTasteFeatures,
  featuresFromJson,
  isSparseTasteFeatures,
} from "./features.js";
import type { ParsedAnime } from "./jikan.js";
import {
  fetchAnimeCharacters,
  fetchAnimeFull,
  fetchAnimeFullTasteMeta,
  fetchAnimeRelations,
  fetchAnimeStaff,
  type AnimeCharacter,
  type AnimeFullTasteMeta,
  type AnimeRelationGroup,
  type AnimeStaffMember,
} from "./jikan.js";
import { fetchMangaChapterTotal, fetchMangaDexTasteMeta } from "./mangadex.js";
import { fetchTmdbDetail, isTmdbId, parseSyntheticId } from "./tmdb.js";

/** Written when background taste enrichment completes successfully. */
export const TASTE_ENRICHED_MARKER = "meta:taste_enriched";

/** Written when TMDB rich detail enrichment completes successfully. */
export const TMDB_TASTE_ENRICHED_MARKER = "meta:tmdb_taste_enriched";

export function isTmdbTasteEnriched(featuresJson: string | null | undefined): boolean {
  return featuresFromJson(featuresJson).includes(TMDB_TASTE_ENRICHED_MARKER);
}

export function withTmdbTasteEnrichedMarker(features: string[]): string[] {
  if (features.includes(TMDB_TASTE_ENRICHED_MARKER)) {
    return features;
  }
  return [...features, TMDB_TASTE_ENRICHED_MARKER];
}

const tasteInFlight = new Set<number>();
let bulkEnrichmentRunning = false;
let lastRecommendationIngestAt = 0;
/** Minimum gap between loved-pick recommendation pool expansions (Jikan /recommendations). */
export const RECOMMENDATION_INGEST_MIN_INTERVAL_MS = 5 * 60 * 1000;

const BULK_ENRICH_BATCH = 4;
const BULK_ENRICH_GAP_MS = 2_500;

export function isTasteEnriched(featuresJson: string | null | undefined): boolean {
  const features = featuresFromJson(featuresJson);
  if (features.includes(TASTE_ENRICHED_MARKER)) {
    if (isSparseTasteFeatures(features)) {
      return false;
    }
    return true;
  }
  return features.some(
    (feature) => feature.startsWith("alist-tag:") || feature.startsWith("alist:"),
  );
}

function withTasteEnrichedMarker(features: string[]): string[] {
  if (features.includes(TASTE_ENRICHED_MARKER)) {
    return features;
  }
  return [...features, TASTE_ENRICHED_MARKER];
}

function upsertAnimeFromParsed(
  parsed: ParsedAnime,
  features: string[],
  mediaType: "anime" | "manhwa" = "anime",
  mangadexId: string | null = null,
  chapterCount: number | null = null,
): void {
  upsertAnime({
    mal_id: parsed.mal_id,
    title_en: parsed.title_en,
    title_jp: parsed.title_romaji,
    synopsis: parsed.synopsis,
    image_url: parsed.image_url,
    genres: parsed.genres,
    themes: parsed.themes,
    demographics: parsed.demographics,
    score: parsed.score,
    popularity: parsed.popularity,
    media_type: mediaType,
    mangadex_id: mangadexId,
    chapter_count: chapterCount,
    features_json: JSON.stringify(features),
  });
}

function upsertMinimalAnimeFromParsed(parsed: ParsedAnime): void {
  const features = buildTasteFeatures({
    genresJson: parsed.genres,
    themesJson: parsed.themes,
    demographicsJson: parsed.demographics,
    synopsis: parsed.synopsis,
    origin: "anime",
  });
  upsertAnimeFromParsed(parsed, features);
}

function mergeStudios(jikan: string[], anilist: string[]): string[] {
  return [...new Set([...jikan, ...anilist])].slice(0, 8);
}

function buildFeaturesFromRowAndSignals(
  parsed: ParsedAnime,
  options: {
    background?: string | null;
    studios?: string[];
    animationStudios?: string[];
    productionStudios?: string[];
    producers?: string[];
    licensors?: string[];
    explicitGenres?: string[];
    source?: string | null;
    episodes?: number | null;
    duration?: number | null;
    staff?: AnimeStaffMember[];
    anilistStaff?: AnilistEnrichment["anilistStaff"];
    characters?: AnimeCharacter[];
    relationTypes?: string[];
    anilistTags?: string[];
    categorizedTags?: AnilistEnrichment["categorizedTags"];
    mainCharacterGenders?: AnilistEnrichment["mainCharacterGenders"];
    mediaFormat?: string | null;
    status?: string | null;
    season?: string | null;
    year?: number | null;
    ageRating?: string | null;
    malScore?: number | null;
    averageScore?: number | null;
    popularity?: number | null;
    rank?: number | null;
    scoredBy?: number | null;
    isAdult?: boolean;
    manhwaTags?: string[];
    manhwaTasteFeatures?: string[];
    manhwaStatus?: string | null;
    manhwaYear?: number | null;
    manhwaContentRating?: string | null;
    origin?: "anime" | "manhwa";
  },
): string[] {
  return withTasteEnrichedMarker(
    buildTasteFeatures({
      genresJson: parsed.genres,
      themesJson: parsed.themes,
      demographicsJson: parsed.demographics,
      synopsis: parsed.synopsis,
      background: options.background ?? null,
      studios: options.studios,
      animationStudios: options.animationStudios,
      productionStudios: options.productionStudios,
      producers: options.producers,
      licensors: options.licensors,
      explicitGenres: options.explicitGenres,
      source: options.source,
      episodes: options.episodes,
      duration: options.duration,
      staff: options.staff,
      anilistStaff: options.anilistStaff,
      characters: options.characters,
      anilistTags: options.anilistTags,
      categorizedTags: options.categorizedTags,
      relationTypes: options.relationTypes,
      mainCharacterGenders: options.mainCharacterGenders,
      mediaFormat: options.mediaFormat,
      status: options.status,
      season: options.season,
      year: options.year,
      ageRating: options.ageRating,
      malScore: options.malScore,
      averageScore: options.averageScore,
      popularity: options.popularity,
      rank: options.rank,
      scoredBy: options.scoredBy,
      isAdult: options.isAdult,
      manhwaTags: options.manhwaTags,
      manhwaTasteFeatures: options.manhwaTasteFeatures,
      manhwaStatus: options.manhwaStatus,
      manhwaYear: options.manhwaYear,
      manhwaContentRating: options.manhwaContentRating,
      origin: options.origin,
    }),
  );
}

function parsedFromRow(row: NonNullable<ReturnType<typeof getAnimeById>>): ParsedAnime {
  return {
    mal_id: row.mal_id,
    title_en: row.title_en,
    title_romaji: row.title_jp,
    synopsis: row.synopsis,
    image_url: row.image_url,
    genres: row.genres,
    themes: row.themes,
    demographics: row.demographics,
    score: row.score,
    popularity: row.popularity,
  };
}

function tasteMetaFromSources(
  tasteMeta: AnimeFullTasteMeta | null,
  anilist: AnilistEnrichment | null,
): {
  studios: string[];
  animationStudios: string[];
  productionStudios: string[];
  producers: string[];
  licensors: string[];
  explicitGenres: string[];
  source: string | null;
  episodes: number | null;
  duration: number | null;
  background: string | null;
  year: number | null;
  season: string | null;
  status: string | null;
  ageRating: string | null;
  malScore: number | null;
  averageScore: number | null;
  popularity: number | null;
  rank: number | null;
  scoredBy: number | null;
  mediaFormat: string | null;
  isAdult: boolean;
} {
  return {
    studios: mergeStudios(tasteMeta?.studios ?? [], anilist?.studios ?? []),
    animationStudios: anilist?.animationStudios ?? [],
    productionStudios: anilist?.productionStudios ?? [],
    producers: tasteMeta?.producers ?? [],
    licensors: tasteMeta?.licensors ?? [],
    explicitGenres: tasteMeta?.explicitGenres ?? [],
    source: anilist?.source ?? tasteMeta?.source ?? null,
    episodes: anilist?.episodes ?? tasteMeta?.episodes ?? null,
    duration: anilist?.duration ?? null,
    background: tasteMeta?.background ?? null,
    year: anilist?.seasonYear ?? tasteMeta?.year ?? null,
    season: anilist?.season ?? tasteMeta?.season ?? null,
    status: anilist?.status ?? tasteMeta?.status ?? null,
    ageRating: tasteMeta?.ageRating ?? null,
    malScore: tasteMeta?.malScore ?? null,
    averageScore: anilist?.averageScore ?? null,
    popularity: anilist?.popularity ?? tasteMeta?.popularity ?? null,
    rank: tasteMeta?.rank ?? null,
    scoredBy: tasteMeta?.scoredBy ?? null,
    mediaFormat: anilist?.format ?? null,
    isAdult: anilist?.isAdult ?? false,
  };
}

async function ensureManhwaPresentationCached(malId: number): Promise<void> {
  const existing = getAnimeById(malId);
  if (!existing?.mangadex_id) {
    return;
  }

  if (existing.chapter_count !== null && existing.synopsis.trim().length > 40) {
    return;
  }

  const total = await fetchMangaChapterTotal(existing.mangadex_id);
  if (total !== null) {
    upsertAnime({
      ...existing,
      chapter_count: total,
    });
  }
}

async function enrichManhwaTaste(malId: number, existing: NonNullable<ReturnType<typeof getAnimeById>>): Promise<void> {
  const parsed = parsedFromRow(existing);
  const mangadexMeta = existing.mangadex_id
    ? await fetchMangaDexTasteMeta(existing.mangadex_id)
    : null;

  const features = buildFeaturesFromRowAndSignals(parsed, {
    manhwaTags: mangadexMeta?.tags,
    manhwaTasteFeatures: mangadexMeta?.tasteFeatures,
    manhwaStatus: mangadexMeta?.status ?? null,
    manhwaYear: mangadexMeta?.year ?? null,
    manhwaContentRating: mangadexMeta?.contentRating ?? null,
    origin: "manhwa",
  });

  upsertAnime({ ...existing, features_json: JSON.stringify(features) });
}

/**
 * Jikan presentation only: one `/full` call when the row is missing or not display-ready.
 */
export async function ensurePresentationCached(malId: number): Promise<void> {
  const existing = getAnimeById(malId);
  if (existing?.media_type === "manhwa") {
    await ensureManhwaPresentationCached(malId);
    return;
  }

  if (existing && isCatalogRowReady(existing)) {
    return;
  }

  try {
    const full = await fetchAnimeFull(malId);
    if (!isParsedAnimeReady(full)) {
      if (existing && isCatalogRowReady(existing)) {
        return;
      }
      throw new QueueUnavailableError("Title metadata is still loading. Try again shortly.");
    }
    upsertMinimalAnimeFromParsed(full);
  } catch (error) {
    if (existing && isCatalogRowReady(existing)) {
      return;
    }
    throw error;
  }
}

async function fetchJikanTasteSupplements(
  malId: number,
  anilistRelationTypes: string[],
): Promise<{
  staff: AnimeStaffMember[];
  characters: AnimeCharacter[];
  relationTypes: string[];
}> {
  let staff: AnimeStaffMember[] = [];
  let characters: AnimeCharacter[] = [];
  let relationTypes = [...anilistRelationTypes];

  if (relationTypes.length === 0) {
    try {
      const relations: AnimeRelationGroup[] = await fetchAnimeRelations(malId);
      relationTypes = relations?.map((group) => group.relation) ?? [];
    } catch (error) {
      console.warn("[rasa] Jikan relations supplement skipped for", malId, error);
    }
  }

  try {
    staff = await fetchAnimeStaff(malId);
  } catch (error) {
    console.warn("[rasa] Jikan staff supplement skipped for", malId, error);
  }

  try {
    characters = (await fetchAnimeCharacters(malId)).slice(0, 12);
  } catch (error) {
    console.warn("[rasa] Jikan characters supplement skipped for", malId, error);
  }

  return { staff, characters, relationTypes };
}

/**
 * AniList + Jikan taste signals, parallelized where possible.
 * AniList and Jikan hit different domains so their rate limits are independent.
 */
export async function ensureTasteEnriched(malId: number): Promise<void> {
  const existing = getAnimeById(malId);
  if (existing?.media_type === "manhwa") {
    if (!isTasteEnriched(existing.features_json)) {
      await enrichManhwaTaste(malId, existing);
    }
    return;
  }

  if (existing && isTasteEnriched(existing.features_json)) {
    return;
  }

  // Fire AniList and Jikan /full in parallel (different domains, independent rate limits)
  const [anilistResult, tasteMetaResult] = await Promise.allSettled([
    fetchAnilistEnrichment(malId),
    fetchAnimeFullTasteMeta(malId).catch((error) => {
      console.warn("[rasa] Jikan /full taste meta skipped for", malId, error);
      return null;
    }),
  ]);

  const anilist = anilistResult.status === "fulfilled" ? anilistResult.value : null;
  const tasteMeta = tasteMetaResult.status === "fulfilled" ? tasteMetaResult.value : null;

  let parsed: ParsedAnime | null = null;
  if (existing && isCatalogRowReady(existing)) {
    parsed = parsedFromRow(existing);
  } else {
    const full = await fetchAnimeFull(malId);
    if (!isParsedAnimeReady(full)) {
      if (existing && isCatalogRowReady(existing)) {
        return;
      }
      throw new CatalogNotReadyError();
    }
    parsed = full;
  }

  // Only fetch Jikan staff/characters if AniList staff is empty (avoid redundant calls)
  const needJikanStaff = (anilist?.anilistStaff ?? []).length === 0;
  const { staff, characters, relationTypes } = needJikanStaff
    ? await fetchJikanTasteSupplements(malId, anilist?.relationTypes ?? [])
    : { staff: [], characters: [], relationTypes: anilist?.relationTypes ?? [] };

  const meta = tasteMetaFromSources(tasteMeta, anilist);

  const features = buildFeaturesFromRowAndSignals(parsed, {
    ...meta,
    staff,
    anilistStaff: anilist?.anilistStaff,
    characters,
    anilistTags: anilist?.tags,
    categorizedTags: anilist?.categorizedTags,
    relationTypes,
    mainCharacterGenders: anilist?.mainCharacterGenders,
    origin: "anime",
  });

  upsertAnimeFromParsed(parsed, features);
}

/**
 * TMDB rich-detail enrichment: replaces a discover-feed row (genres only) with
 * full credits + keywords features from /movie/{id} or /tv/{id}.
 */
export async function ensureTmdbTasteEnriched(malId: number): Promise<void> {
  if (!isTmdbId(malId)) {
    throw new Error(`ensureTmdbTasteEnriched: ${malId} is not a TMDB id`);
  }
  const existing = getAnimeById(malId);
  if (existing && isTmdbTasteEnriched(existing.features_json)) {
    return;
  }
  const parsed = parseSyntheticId(malId);
  if (!parsed) {
    throw new Error(`ensureTmdbTasteEnriched: cannot parse synthetic id ${malId}`);
  }

  const detail = await fetchTmdbDetail(parsed.kind, parsed.tmdbId);
  const baseFeatures = featuresFromJson(detail.parsed.features_json);
  const features = withTmdbTasteEnrichedMarker(baseFeatures);

  upsertAnime({
    mal_id: detail.parsed.mal_id,
    title_en: detail.parsed.title_en,
    title_jp: detail.parsed.title_jp,
    synopsis: detail.parsed.synopsis,
    image_url: detail.parsed.image_url,
    genres: detail.parsed.genres,
    themes: detail.parsed.themes,
    demographics: detail.parsed.demographics,
    score: detail.parsed.score,
    popularity: detail.parsed.popularity,
    media_type: parsed.kind,
    mangadex_id: null,
    chapter_count: null,
    features_json: JSON.stringify(features),
  });
}

/** Fire-and-forget taste enrichment; dedupes concurrent work per malId. */
export function scheduleTasteEnrichment(malId: number): void {
  if (tasteInFlight.has(malId)) {
    return;
  }

  const row = getAnimeById(malId);
  const isTmdb = isTmdbId(malId);
  if (row && (isTmdb ? isTmdbTasteEnriched(row.features_json) : isTasteEnriched(row.features_json))) {
    return;
  }

  tasteInFlight.add(malId);
  const work = isTmdb ? ensureTmdbTasteEnriched(malId) : ensureTasteEnriched(malId);
  void work
    .catch((error: unknown) => {
      console.error("[rasa] background taste enrichment failed", malId, error);
    })
    .finally(() => {
      tasteInFlight.delete(malId);
    });
}

function listCatalogRowsNeedingEnrichment(): number[] {
  return getAllAnime()
    .filter((row) => {
      if (isTmdbId(row.mal_id)) return !isTmdbTasteEnriched(row.features_json);
      return !isTasteEnriched(row.features_json);
    })
    .map((row) => row.mal_id);
}

async function runBulkEnrichmentBatch(malIds: number[]): Promise<void> {
  for (const malId of malIds) {
    if (tasteInFlight.has(malId)) {
      continue;
    }
    tasteInFlight.add(malId);
    try {
      if (isTmdbId(malId)) {
        await ensureTmdbTasteEnriched(malId);
      } else {
        await ensureTasteEnriched(malId);
      }
    } catch (error) {
      console.warn("[rasa] bulk taste enrich failed", malId, error);
    } finally {
      tasteInFlight.delete(malId);
    }
    await new Promise((resolve) => setTimeout(resolve, BULK_ENRICH_GAP_MS));
  }
}

/**
 * Background catalog backfill: re-enrich rows missing taste marker or sparse features.
 * Never blocks Discover; runs in small throttled batches.
 */
export function scheduleBulkTasteEnrichment(options?: { maxTitles?: number }): void {
  if (bulkEnrichmentRunning) {
    return;
  }

  const pending = listCatalogRowsNeedingEnrichment();
  if (pending.length === 0) {
    return;
  }

  const maxTitles = options?.maxTitles ?? pending.length;
  const queue = pending.slice(0, maxTitles);
  bulkEnrichmentRunning = true;

  void (async () => {
    try {
      for (let offset = 0; offset < queue.length; offset += BULK_ENRICH_BATCH) {
        const batch = queue.slice(offset, offset + BULK_ENRICH_BATCH);
        await runBulkEnrichmentBatch(batch);
      }
    } finally {
      bulkEnrichmentRunning = false;
    }
  })();
}

/** Low-frequency Jikan /recommendations expansion; never blocks the vote path. */
export function scheduleRecommendationIngest(
  lovedMalIds: number[],
  ingest: (ids: number[]) => Promise<void>,
): void {
  if (lovedMalIds.length === 0) {
    return;
  }

  const now = Date.now();
  if (now - lastRecommendationIngestAt < RECOMMENDATION_INGEST_MIN_INTERVAL_MS) {
    return;
  }

  lastRecommendationIngestAt = now;
  void ingest(lovedMalIds).catch((error: unknown) => {
    console.error("[rasa] recommendation pool ingest failed", error);
  });
}

/** Reset recommendation ingest throttle (for tests only). */
export function resetRecommendationIngestThrottleForTests(): void {
  lastRecommendationIngestAt = 0;
  tasteInFlight.clear();
  bulkEnrichmentRunning = false;
}

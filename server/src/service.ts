import { CatalogExhaustedError, ExternalApiError, QueueUnavailableError } from "./api-errors.js";
import { assertCatalogRowReady, isCatalogRowReady, isParsedAnimeReady } from "./catalog.js";
import {
  getAllAnime,
  getAnimeById,
  getEngagementSignalsForTaste,
  getProfileHistory,
  getRatedMalIds,
  getRatingCount,
  getReactionCounts,
  getRatings,
  getUserReaction,
  getWatchlist,
  getWatchlistMalIds,
  insertEngagementSignal,
  insertRating,
  insertWatchlist,
  isOnWatchlist,
  removeWatchlist,
  rowToCard,
  safeJsonArray,
  upsertAnime,
  getWatchStreamsFromDb,
  insertWatchStreamsIntoDb,
  getRatedFranchiseKeys,
  getWatchlistFranchiseKeys,
  getGenreNextPage,
  incrementGenrePage,
} from "./db.js";
import { dedupeByFranchise, excludeFranchiseKeys, keyForRow } from "./franchise.js";
import {
  ensurePresentationCached,
  isTasteEnriched,
  scheduleRecommendationIngest,
  scheduleTasteEnrichment,
  scheduleBulkTasteEnrichment,
} from "./enrichment.js";
import { scoringFeatures } from "./feature-category.js";
import { buildTasteFeatures, featuresFromJson } from "./features.js";
import { computeTastePatterns } from "./taste-patterns.js";
import {
  fetchAnimeDetail,
  fetchAnimeFull,
  fetchRecommendationIdsFromLoved,
  fetchSeasonNow,
  fetchTopAnime,
  fetchAnimeByGenre,
} from "./jikan.js";
import { GENRE_MAP } from "./genre-map.js";
import {
  fetchManhwaPage,
  fetchOfficialColoredManhwaPage,
  type ParsedManhwa,
} from "./mangadex.js";
import { fetchAnilistEnrichment } from "./anilist.js";
import {
  implicitReactionFromEngagement,
} from "./engagement-signals.js";
import {
  buildFeatureWeights,
  isColdStart,
  parseFeatureTags,
  pickNextCandidateWithMl,
  ratedFeaturesFromImplicitSignal,
  scoreFeatures,
  type PickMlOptions,
  type RatedFeatures,
} from "./recommendation.js";
import { buildTasteMlContext, rankByMlScore, explainCandidateMl } from "./taste-ml.js";
import { calibrateMatchPercent } from "./match-percent.js";
import { humanizeTasteSignals } from "./taste-signals.js";
import {
  allocateMediaQuotas,
  mediaTypeUpShares,
  pickMediaTypeWeighted,
} from "./media-mix.js";
import { selectKDiverse } from "./mmr.js";
import {
  trainTasteModel,
  modelFeatures,
  type TasteModel,
  type TasteExample,
} from "./taste-model.js";
import { fetchSimklTrendingMalIds } from "./simkl-seed.js";
import {
  fetchTmdbDetail,
  fetchTmdbDiscover,
  fetchTmdbKeyPersons,
  fetchTmdbPersonCredits,
  hasTmdbCredentials,
  isTmdbId,
  parseSyntheticId,
  type ParsedTmdb,
} from "./tmdb.js";
import {
  getCreditScannedMalIds,
  getExpandedPersonIds,
  getRecentlySkippedMalIds,
  getTasteComboRows,
  markCreditScanned,
  markPersonExpanded,
  setTasteComboStatus,
} from "./db.js";
import {
  comboKey,
  humanizeCombo,
  mineTasteCombos,
  type RatedTitleForMining,
} from "./combo-mining.js";
import { registerGraphNeighbors, resetTasteGraphForTests } from "./taste-graph.js";
import {
  dropFromQueue,
  dropFranchiseFromQueue,
  ensureQueue,
  getQueuedFranchiseKeys,
  getQueuedMalIds,
  QUEUE_SIZE,
  queueLength,
  scheduleQueueRefill,
  snapshotQueue,
  waitForQueueRefill,
} from "./queue.js";
import type { AnimeCard, DownvoteReason, MediaType, Reaction, ScoredAnime } from "./types.js";
import { COLD_START_RATINGS, REACTION_WEIGHTS } from "./types.js";

let nextPickChain: Promise<void> = Promise.resolve();
let nextPresentationChain: Promise<void> = Promise.resolve();

// Wider memory: 20 was too short - a user scrolling past 25 cards without
// voting would see the first ones cycle back. 120 covers a sustained session.
const RECENTLY_SERVED_MAX = 120;
const RECENTLY_SERVED_FEATURES_MAX = 12;
const recentlyServedFranchiseKeys: string[] = [];
const recentlyServedFeatureRings: string[][] = [];
const reservedMalIds = new Set<number>();

const CATALOG_PREP_TTL_MS = 90_000;
let lastCatalogPrepAt = 0;
let catalogPrepInFlight: Promise<void> | null = null;

/** Top-popularity page we should fetch next when the candidate pool runs low. */
let nextTopPage = 1;
let nextManhwaOffset = 0;
let manhwaFeedAlternate = false;
const MAX_TOP_PAGE = 25;
const MIN_FRESH_CANDIDATES = 150;
const PROFILE_TOP_PICKS = 3;

// TMDB ingest cursors: alternate tv/movie and rotate origin countries so the
// mixed feed spans Hollywood, Bollywood, Korean, Japanese, and Chinese titles.
const TMDB_REGIONS = ["US", "IN", "KR", "JP", "CN"] as const;
const MAX_TMDB_PAGE = 25;
let tmdbRegionIndex = 0;
let nextTmdbTvPage = 1;
let nextTmdbMoviePage = 1;
const PROFILE_GRID_SIZE = 16;

/** Cached feature corpus - rebuilt lazily, invalidated when catalog changes. */
let featureCorpusCache: string[][] | null = null;
const cachedFeaturesMap = new Map<number, string[]>();

/** Call after upserting titles to invalidate the IDF corpus cache. */
export function invalidateFeatureCorpusCache(): void {
  featureCorpusCache = null;
  cachedFeaturesMap.clear();
}

function getFeatureCorpus(): string[][] {
  if (featureCorpusCache === null) {
    featureCorpusCache = getAllAnime().map((row) => rowFeatures(row));
  }
  return featureCorpusCache;
}

/** Serializes candidate picking so parallel refills cannot duplicate franchises. */
async function withPickLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = nextPickChain.then(fn, fn);
  nextPickChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Limits concurrent Jikan /full calls on the Discover hot path. */
async function withPresentationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = nextPresentationChain.then(fn, fn);
  nextPresentationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function recordRecentlyServedFranchise(franchiseKeyValue: string): void {
  const key = franchiseKeyValue.trim();
  if (!key) {
    return;
  }
  const index = recentlyServedFranchiseKeys.indexOf(key);
  if (index >= 0) {
    recentlyServedFranchiseKeys.splice(index, 1);
  }
  recentlyServedFranchiseKeys.push(key);
  while (recentlyServedFranchiseKeys.length > RECENTLY_SERVED_MAX) {
    recentlyServedFranchiseKeys.shift();
  }
}

function getRecentlyServedFranchiseKeys(): Set<string> {
  return new Set(recentlyServedFranchiseKeys);
}

/** Days a "don't know it" skip keeps a title out of the deck. Persisted via
 *  engagement_signals, so a server restart can't resurface just-skipped cards. */
const SKIP_COOLDOWN_DAYS = 7;

function getPickExcludeMalIds(): Set<number> {
  return new Set([
    ...getRatedMalIds(),
    ...getWatchlistMalIds(),
    ...getQueuedMalIds(),
    ...getRecentlySkippedMalIds(SKIP_COOLDOWN_DAYS),
    ...reservedMalIds,
  ]);
}

function getBlockedFranchiseKeys(): Set<string> {
  const keys = new Set<string>();
  for (const key of getQueuedFranchiseKeys()) {
    keys.add(key);
  }
  for (const key of getRecentlyServedFranchiseKeys()) {
    keys.add(key);
  }
  // A rated/watchlisted title answers for its whole franchise - don't spend
  // swipe cards on Naruto Movie 6 when Naruto is already rated. (Exhaustion
  // fallbacks below still relax this if the pool runs dry.)
  for (const key of getRatedFranchiseKeys()) {
    keys.add(key);
  }
  for (const key of getWatchlistFranchiseKeys()) {
    keys.add(key);
  }
  for (const malId of reservedMalIds) {
    const row = getAnimeById(malId);
    if (row) {
      keys.add(keyForRow(row));
    }
  }
  return keys;
}

function rowFeatures(row: ReturnType<typeof getAllAnime>[number]): string[] {
  const cached = cachedFeaturesMap.get(row.mal_id);
  if (cached) return cached;

  const raw = featuresFromJson(row.features_json);
  const scoring = scoringFeatures(raw);
  const enriched = isTasteEnriched(row.features_json);

  let result: string[];
  if (enriched && scoring.length > 0) {
    result = scoring;
  } else if (scoring.length > 0) {
    result = scoring;
  } else {
    result = parseFeatureTags(row.genres, row.themes, row.demographics).map((tag) =>
      tag.startsWith("genre:") ? tag : `genre:${tag}`,
    );
  }
  cachedFeaturesMap.set(row.mal_id, result);
  return result;
}

function rowToCandidate(row: ReturnType<typeof getAllAnime>[number]) {
  return {
    malId: row.mal_id,
    features: rowFeatures(row),
    popularity: row.popularity,
    synopsis: row.synopsis,
    card: rowToCard(row),
  };
}

function recordRecentlyServedFeatures(row: ReturnType<typeof getAllAnime>[number]): void {
  recentlyServedFeatureRings.push(rowFeatures(row));
  while (recentlyServedFeatureRings.length > RECENTLY_SERVED_FEATURES_MAX) {
    recentlyServedFeatureRings.shift();
  }
}

function getRecentlyServedFeatureSet(): Set<string> {
  const features = new Set<string>();
  for (const ring of recentlyServedFeatureRings) {
    for (const feature of ring) {
      features.add(feature);
    }
  }
  return features;
}

function buildMlPickOptions(): PickMlOptions {
  const featureCorpus = getFeatureCorpus();
  const watchlistFeatures: string[][] = [];

  for (const malId of getWatchlistMalIds()) {
    const row = getAnimeById(malId);
    if (row) {
      watchlistFeatures.push(rowFeatures(row));
    }
  }

  const lovedSynopses = getRatings()
    .filter((rating) => rating.reaction === "up")
    .map((rating) => getAnimeById(rating.mal_id)?.synopsis ?? "")
    .filter((synopsis) => synopsis.trim().length > 0);

  return {
    watchlistFeatures,
    featureCorpus,
    lovedSynopses,
    recentlyServedFeatures: getRecentlyServedFeatureSet(),
    recentItemsFeatures: recentlyServedFeatureRings.slice(-5),
  };
}

async function expandTasteGraphFromMalId(malId: number): Promise<void> {
  try {
    const enrichment = await fetchAnilistEnrichment(malId);
    if (!enrichment) {
      return;
    }
    registerGraphNeighbors(malId, enrichment.relatedMalIds, 1);
    registerGraphNeighbors(malId, enrichment.recommendationMalIds, 0.9);
  } catch (error) {
    console.warn("[rasa] taste graph expand failed", malId, error);
  }
}

export interface RateAnimeOptions {
  dwellMs?: number;
  skipped?: boolean;
  reason?: DownvoteReason;
}

async function seedCatalogFromSimklIfLow(): Promise<void> {
  const excluded = new Set([...getRatedMalIds(), ...getWatchlistMalIds()]);
  const unrated = getAllAnime().filter((row) => !excluded.has(row.mal_id));
  if (unrated.length >= MIN_FRESH_CANDIDATES) {
    return;
  }

  const malIds = await fetchSimklTrendingMalIds(30);
  for (const malId of malIds) {
    if (getAnimeById(malId)) {
      continue;
    }
    try {
      const full = await fetchAnimeFull(malId);
      if (!isParsedAnimeReady(full)) {
        continue;
      }
      upsertParsed([full]);
    } catch {
      // fail soft per title
    }
  }
}

function upsertParsed(items: Array<Awaited<ReturnType<typeof fetchTopAnime>>[number]>) {
  if (!items || !items[Symbol.iterator]) return;
  for (const item of items) {
    const existing = getAnimeById(item.mal_id);
    if (existing && isCatalogRowReady(existing)) {
      continue;
    }
    const features = buildTasteFeatures({
      genresJson: item.genres,
      themesJson: item.themes,
      demographicsJson: item.demographics,
      synopsis: item.synopsis,
      origin: "anime",
    });
    upsertAnime({
      mal_id: item.mal_id,
      franchise_key: null,
      title_en: item.title_en,
      title_jp: item.title_romaji,
      synopsis: item.synopsis,
      image_url: item.image_url,
      genres: item.genres,
      themes: item.themes,
      demographics: item.demographics,
      score: item.score,
      popularity: item.popularity ?? 999_999,
      media_type: "anime",
      mangadex_id: null,
      chapter_count: null,
      features_json: JSON.stringify(features),
    });
  }
  if (items.length > 0) invalidateFeatureCorpusCache();
}

function upsertManhwaBatch(items: ParsedManhwa[]): void {
  if (!items || !items[Symbol.iterator]) return;
  for (const item of items) {
    const existing = getAnimeById(item.malId);
    if (existing && isCatalogRowReady(existing)) {
      continue;
    }
    const features = buildTasteFeatures({
      genresJson: item.genres,
      themesJson: item.themes,
      demographicsJson: item.demographics,
      synopsis: item.synopsis,
      origin: "manhwa",
    });
    upsertAnime({
      mal_id: item.malId,
      franchise_key: null,
      title_en: item.titleEn,
      title_jp: item.titleRomaji,
      synopsis: item.synopsis,
      image_url: item.imageUrl,
      genres: item.genres,
      themes: item.themes,
      demographics: item.demographics,
      score: item.score,
      popularity: item.popularity ?? 999_999,
      media_type: "manhwa",
      mangadex_id: item.mangadexId,
      chapter_count: item.chapterCount,
      features_json: JSON.stringify(features),
    });
  }
  if (items.length > 0) invalidateFeatureCorpusCache();
}

async function ensureManhwaCandidates(): Promise<void> {
  const candidates = getUnratedCandidates();
  const manhwaCount = candidates.filter((c) => c.card.mediaType === "manhwa").length;

  if (manhwaCount >= 40) {
    return;
  }

  console.log(`[rasa] Manhwa candidate pool low (${manhwaCount}). Refilling with batch...`);
  for (let pageNum = 0; pageNum < 3; pageNum++) {
    if (nextManhwaOffset > 2000) {
      console.log("[rasa] nextManhwaOffset exceeded 2000. Wrapping back to 0.");
      nextManhwaOffset = 0;
    }

    try {
      const fetcher = manhwaFeedAlternate ? fetchOfficialColoredManhwaPage : fetchManhwaPage;
      manhwaFeedAlternate = !manhwaFeedAlternate;
      const { items, total } = await fetcher(nextManhwaOffset, 20);
      nextManhwaOffset += items.length > 0 ? items.length : 20;
      upsertManhwaBatch(items);

      if (nextManhwaOffset >= total && total > 0) {
        nextManhwaOffset = 0;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[rasa] MangaDex background ingest skipped (retrying later): ${msg}`);
      break;
    }
  }
}

export function upsertTmdbBatch(items: ParsedTmdb[]): void {
  if (!items || !items[Symbol.iterator]) return;
  let added = 0;
  for (const item of items) {
    const existing = getAnimeById(item.mal_id);
    if (existing && isCatalogRowReady(existing)) {
      continue;
    }
    if (!isParsedAnimeReady(item)) {
      continue;
    }
    upsertAnime({
      mal_id: item.mal_id,
      franchise_key: null,
      title_en: item.title_en,
      title_jp: item.title_jp,
      synopsis: item.synopsis,
      image_url: item.image_url,
      genres: item.genres,
      themes: item.themes,
      demographics: item.demographics,
      score: item.score,
      popularity: item.popularity,
      media_type: item.kind,
      mangadex_id: null,
      chapter_count: null,
      features_json: item.features_json,
    });
    added += 1;
  }
  if (added > 0) invalidateFeatureCorpusCache();
}

/** Paginates TMDB discover (alternating tv/movie, rotating origin country). */
async function ensureTmdbCandidates(): Promise<void> {
  if (!hasTmdbCredentials()) {
    return;
  }

  const candidates = getUnratedCandidates();
  const tvCount = candidates.filter((c) => c.card.mediaType === "tv").length;
  const movieCount = candidates.filter((c) => c.card.mediaType === "movie").length;

  if (tvCount < 50) {
    console.log(`[rasa] TV candidate pool low (${tvCount}). Refilling TV shows batch...`);
    for (let pageNum = 0; pageNum < 3; pageNum++) {
      const region = TMDB_REGIONS[tmdbRegionIndex % TMDB_REGIONS.length];
      tmdbRegionIndex += 1;
      const page = nextTmdbTvPage;
      nextTmdbTvPage = nextTmdbTvPage >= MAX_TMDB_PAGE ? 1 : nextTmdbTvPage + 1;

      try {
        const items = await fetchTmdbDiscover("tv", page, { originCountry: region });
        upsertTmdbBatch(items);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[rasa] TMDB tv background ingest page ${page} skipped: ${msg}`);
        break;
      }
    }
  }

  if (movieCount < 50) {
    console.log(`[rasa] Movie candidate pool low (${movieCount}). Refilling movies batch...`);
    for (let pageNum = 0; pageNum < 3; pageNum++) {
      const region = TMDB_REGIONS[tmdbRegionIndex % TMDB_REGIONS.length];
      tmdbRegionIndex += 1;
      const page = nextTmdbMoviePage;
      nextTmdbMoviePage = nextTmdbMoviePage >= MAX_TMDB_PAGE ? 1 : nextTmdbMoviePage + 1;

      try {
        const items = await fetchTmdbDiscover("movie", page, { originCountry: region });
        upsertTmdbBatch(items);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[rasa] TMDB movie background ingest page ${page} skipped: ${msg}`);
        break;
      }
    }
  }
}

// ── Taste-neighborhood expansion ─────────────────────────────────────────────
// For every liked film/TV title: fetch its credits, then ingest the filmography
// of each key person (director, writers, top cast). This is how the catalog
// reaches the user's actual taste space (e.g. a liked Akshay Kumar comedy pulls
// in the rest of his filmography) instead of only popularity pages.
// Background-only: never called on the swipe hot path.
let neighborhoodExpansionInFlight = false;

export async function runTasteNeighborhoodExpansion(
  options: { maxTitles?: number; maxPersons?: number } = {},
): Promise<{ titlesScanned: number; personsExpanded: number; rowsIngested: number }> {
  const { maxTitles = 4, maxPersons = 12 } = options;
  const summary = { titlesScanned: 0, personsExpanded: 0, rowsIngested: 0 };
  if (!hasTmdbCredentials() || neighborhoodExpansionInFlight) {
    return summary;
  }
  neighborhoodExpansionInFlight = true;
  try {
    const likedTmdbIds = [
      ...getRatings()
        .filter((r) => r.reaction === "up")
        .map((r) => r.mal_id),
      ...getWatchlistMalIds(),
    ].filter((id) => isTmdbId(id));

    const scanned = getCreditScannedMalIds();
    const toScan = likedTmdbIds.filter((id) => !scanned.has(id)).slice(0, maxTitles);
    const expandedPersons = getExpandedPersonIds();
    let personBudget = maxPersons;

    for (const malId of toScan) {
      const synth = parseSyntheticId(malId);
      if (!synth) {
        markCreditScanned(malId);
        continue;
      }
      try {
        const persons = await fetchTmdbKeyPersons(synth.kind, synth.tmdbId);
        markCreditScanned(malId);
        summary.titlesScanned += 1;

        for (const person of persons) {
          if (personBudget <= 0) break;
          if (expandedPersons.has(person.id)) continue;
          try {
            const credits = await fetchTmdbPersonCredits(person.id);
            upsertTmdbBatch(credits);
            markPersonExpanded(person.id, person.name);
            expandedPersons.add(person.id);
            personBudget -= 1;
            summary.personsExpanded += 1;
            summary.rowsIngested += credits.length;
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[rasa] person expansion skipped (${person.name}): ${msg}`);
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[rasa] credit scan skipped (id ${malId}): ${msg}`);
      }
      if (personBudget <= 0) break;
    }

    if (summary.rowsIngested > 0) {
      scheduleBulkTasteEnrichment({ maxTitles: 40 });
    }
  } finally {
    neighborhoodExpansionInFlight = false;
  }
  return summary;
}

export function scheduleTasteNeighborhoodExpansion(): void {
  void runTasteNeighborhoodExpansion().catch((error) => {
    console.error("[rasa] taste-neighborhood expansion failed", error);
  });
}

async function ensureCatalog(minCount = 25): Promise<void> {
  if (getAllAnime().length >= minCount) {
    return;
  }
  try {
    const top = await fetchTopAnime(25, 1);
    upsertParsed(top);
  } catch (error) {
    console.error("[rasa] ensureCatalog failed", error);
  }
}

/**
 * Keep the unrated candidate pool above 80 by paginating
 * `/top/anime?filter=bypopularity`. Each call only advances a single page
 * to stay friendly to Jikan rate limits.
 */
async function ensureFreshCandidates(): Promise<void> {
  const readyCandidates = getUnratedCandidates().filter((c) => c.card.mediaType === "anime");

  if (readyCandidates.length >= 80) {
    return;
  }

  if (nextTopPage > MAX_TOP_PAGE) {
    console.log(`[rasa] nextTopPage exceeded ${MAX_TOP_PAGE}. Wrapping back to page 1.`);
    nextTopPage = 1;
  }

  const page = nextTopPage;
  nextTopPage += 1;

  try {
    const more = await fetchTopAnime(25, page);
    upsertParsed(more);
  } catch (error) {
    console.error("[rasa] fetchTopAnime page", page, "failed", error);
  }
}

async function ingestRecommendationPool(lovedMalIds: number[]): Promise<void> {
  const recIdSet = new Set<number>();

  try {
    const jikanIds = await fetchRecommendationIdsFromLoved(lovedMalIds);
    for (const id of jikanIds) {
      recIdSet.add(id);
    }
  } catch (error) {
    console.error("[rasa] Jikan recommendation id fetch failed", error);
  }

  for (const malId of lovedMalIds.slice(0, 2)) {
    try {
      const enrichment = await fetchAnilistEnrichment(malId);
      if (enrichment) {
        for (const id of enrichment.recommendationMalIds) {
          recIdSet.add(id);
        }
        registerGraphNeighbors(malId, enrichment.recommendationMalIds, 0.85);
      }
    } catch (error) {
      console.warn("[rasa] AniList recommendation ingest skipped", malId, error);
    }
  }

  const recIds = [...recIdSet];

  for (const malId of recIds) {
    if (getAnimeById(malId)) {
      continue;
    }
    try {
      const full = await fetchAnimeFull(malId);
      if (!isParsedAnimeReady(full)) {
        continue;
      }
      const features = buildTasteFeatures({
        genresJson: full.genres,
        themesJson: full.themes,
        demographicsJson: full.demographics,
        synopsis: full.synopsis,
        origin: "anime",
      });
      upsertAnime({
        mal_id: full.mal_id,
        title_en: full.title_en,
        title_jp: full.title_romaji,
        synopsis: full.synopsis,
        image_url: full.image_url,
        genres: full.genres,
        themes: full.themes,
        demographics: full.demographics,
        score: full.score,
        popularity: full.popularity,
        media_type: "anime",
        mangadex_id: null,
        chapter_count: null,
        features_json: JSON.stringify(features),
      });
    } catch (error) {
      if (error instanceof ExternalApiError && error.status === 429) {
        console.warn("[rasa] recommendation pool ingest rate-limited, stopping");
        break;
      }
    }
  }
}

function buildRatedFeatureList(): RatedFeatures[] {
  const ratings = getRatings();
  const fromVotes = ratings
    .map((rating) => {
      const anime = getAnimeById(rating.mal_id);
      if (!anime) {
        return undefined;
      }
      return {
        features: rowFeatures(anime),
        reaction: rating.reaction,
        downReason: rating.down_reason as DownvoteReason | null,
      } as RatedFeatures;
    })
    .filter((item): item is RatedFeatures => item !== undefined);

  // Don't double-count shows that already have an explicit vote
  const explicitlyRatedIds = new Set(ratings.map((r) => r.mal_id));

  const fromSignals: RatedFeatures[] = [];
  for (const signal of getEngagementSignalsForTaste()) {
    if (explicitlyRatedIds.has(signal.mal_id)) continue;
    const anime = getAnimeById(signal.mal_id);
    if (!anime) {
      continue;
    }
    const implicit = implicitReactionFromEngagement({
      malId: signal.mal_id,
      dwellMs: signal.dwell_ms,
      skipped: signal.skipped === 1,
    });
    if (!implicit) {
      continue;
    }
    fromSignals.push(
      ratedFeaturesFromImplicitSignal(rowFeatures(anime), implicit),
    );
  }

  return [...fromVotes, ...fromSignals];
}

export function recordEngagementSignal(
  malId: number,
  dwellMs: number,
  skipped: boolean,
): void {
  const row = getAnimeById(malId);
  assertCatalogRowReady(row, malId);
  insertEngagementSignal(malId, dwellMs, skipped);
}

type CatalogCandidate = ReturnType<typeof rowToCandidate>;

function getUnratedCandidates(
  excludeMalIds: Set<number> = new Set(),
  extraBlockedFranchises: Set<string> = new Set(),
  ignoreFranchiseBlocks = false,
): CatalogCandidate[] {
  const excludedMalIds = new Set([...getRatedMalIds(), ...getWatchlistMalIds()]);
  const blockedFranchises = ignoreFranchiseBlocks
    ? new Set<string>()
    : new Set([
        ...extraBlockedFranchises,
      ]);
  const candidates = getAllAnime()
    .filter(
      (row) =>
        !excludedMalIds.has(row.mal_id) &&
        !excludeMalIds.has(row.mal_id) &&
        isCatalogRowReady(row),
    )
    .map(rowToCandidate);

  const withTitles = candidates.map((candidate) => ({
    candidate,
    titleEn: candidate.card.titleEn,
    titleRomaji: candidate.card.titleRomaji,
    franchiseKey: candidate.card.franchiseKey,
    popularity: candidate.popularity,
  }));

  const unique = dedupeByFranchise(withTitles);
  return excludeFranchiseKeys(unique, blockedFranchises).map((item) => item.candidate);
}

async function expandCatalogUntilCandidates(minCount = 1): Promise<void> {
  let safety = 0;
  while (getUnratedCandidates().length < minCount && safety < 12) {
    safety += 1;
    const before = getAllAnime().length;

    try {
      if (nextTopPage <= MAX_TOP_PAGE) {
        await ensureFreshCandidates();
      } else {
        await ensureManhwaCandidates();
      }
    } catch (error) {
      console.warn("[rasa] expandCatalog step skipped, trying seasonal fallback...", error);
    }

    if (getAllAnime().length === before) {
      try {
        console.log("[rasa] Hydrating queue with seasonal fallback titles...");
        const seasonal = await fetchSeasonNow(25);
        upsertParsed(seasonal);
      } catch (error) {
        console.error("[rasa] seasons/now ingest fallback failed", error);
      }
    }

    if (getAllAnime().length === before) {
      break;
    }
  }
}

async function prepareCatalog(): Promise<void> {
  try {
    await ensureCatalog();
  } catch (error) {
    console.error("[rasa] prepareCatalog ensureCatalog failed", error);
  }

  try {
    await ensureFreshCandidates();
  } catch (error) {
    console.error("[rasa] prepareCatalog ensureFreshCandidates failed", error);
  }

  try {
    await ensureManhwaCandidates();
  } catch (error) {
    console.error("[rasa] prepareCatalog ensureManhwaCandidates failed", error);
  }

  try {
    await ensureTmdbCandidates();
  } catch (error) {
    console.error("[rasa] prepareCatalog ensureTmdbCandidates failed", error);
  }

  try {
    if (getUnratedCandidates().length < MIN_FRESH_CANDIDATES) {
      await expandCatalogUntilCandidates(MIN_FRESH_CANDIDATES);
    }
  } catch (error) {
    console.error("[rasa] prepareCatalog expandCatalog failed", error);
  }

  try {
    await seedCatalogFromSimklIfLow();
  } catch (error) {
    console.warn("[rasa] Simkl catalog seed skipped", error);
  }

  const liked = thumbsUpMalIds();
  scheduleRecommendationIngest(liked, ingestRecommendationPool);

  // Pull the filmographies of people behind liked films/TV into the pool
  scheduleTasteNeighborhoodExpansion();

  // Trigger background enrichment for newly ingested/unenriched titles in the database
  scheduleBulkTasteEnrichment({ maxTitles: 100 });

  // Trigger background catalog expansion if starved
  scheduleCatalogExpansionIfNeeded();
}

function scheduleCatalogPrepIfNeeded(): void {
  const candidates = getUnratedCandidates();
  const counts = {
    anime: candidates.filter((c) => c.card.mediaType === "anime").length,
    manhwa: candidates.filter((c) => c.card.mediaType === "manhwa").length,
    tv: candidates.filter((c) => c.card.mediaType === "tv").length,
    movie: candidates.filter((c) => c.card.mediaType === "movie").length,
  };

  const hasTmdb = hasTmdbCredentials();
  const isStarved =
    counts.anime < 80 ||
    counts.manhwa < 40 ||
    (hasTmdb && counts.tv < 50) ||
    (hasTmdb && counts.movie < 50);

  if (!isStarved) {
    return;
  }

  const now = Date.now();
  if (catalogPrepInFlight !== null) {
    return;
  }
  if (now - lastCatalogPrepAt < CATALOG_PREP_TTL_MS) {
    return;
  }

  lastCatalogPrepAt = now;
  catalogPrepInFlight = prepareCatalog()
    .catch((error: unknown) => {
      console.error("[rasa] background catalog prep failed", error);
    })
    .finally(() => {
      catalogPrepInFlight = null;
    });
}

let expansionInFlight = false;

export function isCatalogStarved(): boolean {
  const total = getAllAnime().length;
  const rated = getRatedMalIds().size;
  if (total === 0) return true;
  return (rated / total) >= 0.5;
}

export async function runCatalogExpansion(): Promise<void> {
  if (expansionInFlight) return;
  expansionInFlight = true;
  console.log("[rasa] Starting background catalog expansion...");

  try {
    const ratings = getRatings();
    const genreCounts: Record<number, number> = {};

    for (const rating of ratings) {
      const anime = getAnimeById(rating.mal_id);
      if (!anime) continue;

      const genres = safeJsonArray(anime.genres);
      const themes = safeJsonArray(anime.themes);
      const demographics = safeJsonArray(anime.demographics);

      // Upvotes weigh more to target user's preferred genres
      const weight = rating.reaction === "up" ? 3 : 1;

      for (const tag of [...genres, ...themes, ...demographics]) {
        const genreId = GENRE_MAP[tag.toLowerCase().trim()];
        if (genreId !== undefined) {
          genreCounts[genreId] = (genreCounts[genreId] || 0) + weight;
        }
      }
    }

    const sortedGenreIds = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([genreId]) => Number(genreId));

    // Fallbacks if user has no genres rated (cold start)
    const genrePool = sortedGenreIds.length > 0
      ? sortedGenreIds.slice(0, 5)
      : [10, 1, 4, 2, 22]; // Fantasy, Action, Comedy, Adventure, Romance

    console.log(`[rasa] Seeding expansion with top genres: ${genrePool.join(", ")}`);

    let addedCount = 0;
    for (const genreId of genrePool) {
      try {
        const nextPage = getGenreNextPage(genreId);
        console.log(`[rasa] Fetching Jikan page ${nextPage} for genre ${genreId}...`);
        const items = await fetchAnimeByGenre(genreId, nextPage);
        
        upsertParsed(items);
        incrementGenrePage(genreId);
        
        addedCount += items.length;
      } catch (error) {
        console.warn(`[rasa] Expansion failed for genre ${genreId}`, error);
      }
    }

    console.log(`[rasa] Expansion batch finished. Added/parsed up to ${addedCount} candidate anime.`);

    // Trigger bulk taste enrichment for newly added titles
    scheduleBulkTasteEnrichment({ maxTitles: 100 });
  } finally {
    expansionInFlight = false;
  }
}

export function scheduleCatalogExpansionIfNeeded(): void {
  if (isCatalogStarved()) {
    void runCatalogExpansion().catch((error) => {
      console.error("[rasa] Background catalog expansion failed", error);
    });
  }
}


/** Per-media-type upvote counts - the user's demonstrated taste mix. */
function computeMediaUpCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rating of getRatings()) {
    if (rating.reaction !== "up") continue;
    const row = getAnimeById(rating.mal_id);
    if (!row) continue;
    counts[row.media_type] = (counts[row.media_type] ?? 0) + 1;
  }
  return counts;
}

/**
 * Picks one media type weighted by the user's upvote mix (45% anime ups →
 * ~45% anime cards), then returns that type's pool. Re-randomizing per pick
 * keeps the feed mixed instead of letting the model's loudest cluster
 * (e.g. a fresh batch of Bollywood likes) dominate every card.
 */
function selectMediaPool(candidates: CatalogCandidate[]): CatalogCandidate[] {
  const byType = new Map<string, CatalogCandidate[]>();
  for (const candidate of candidates) {
    const list = byType.get(candidate.card.mediaType) ?? [];
    list.push(candidate);
    byType.set(candidate.card.mediaType, list);
  }
  if (byType.size <= 1) {
    return candidates;
  }

  const shares = mediaTypeUpShares(computeMediaUpCounts());
  const chosen = pickMediaTypeWeighted(shares, new Set(byType.keys()));
  if (!chosen) {
    // No upvotes yet - fall back to a uniform pick among available types.
    const types = [...byType.keys()];
    return byType.get(types[Math.floor(Math.random() * types.length)]!) ?? candidates;
  }
  return byType.get(chosen) ?? candidates;
}

async function pickNextMalId(): Promise<number> {
  return withPickLock(async () => {
    scheduleCatalogPrepIfNeeded();

    let exclude = getPickExcludeMalIds();
    const blockedFranchises = getBlockedFranchiseKeys();
    let candidates = getUnratedCandidates(exclude, blockedFranchises);

    if (candidates.length === 0) {
      console.log("[DEBUG pickNextMalId] candidates is 0!", {
        allAnime: getAllAnime().length,
        exclude: exclude.size,
        blockedFranchises: blockedFranchises.size,
        getRatedMalIds: getRatedMalIds().size,
        getWatchlistMalIds: getWatchlistMalIds().size,
        getQueuedMalIds: getQueuedMalIds().size,
        reservedMalIds: reservedMalIds.size,
        getRatedFranchiseKeys: getRatedFranchiseKeys().size,
        getWatchlistFranchiseKeys: getWatchlistFranchiseKeys().size,
        getQueuedFranchiseKeys: getQueuedFranchiseKeys().size,
        getRecentlyServedFranchiseKeys: getRecentlyServedFranchiseKeys().size,
      });
      const relaxed = getUnratedCandidates(exclude, new Set(), true);
      if (relaxed.length > 0) {
        console.warn("[rasa] Strict candidate pool exhausted. Relaxing franchise blocks (local database has candidates)...");
        candidates = relaxed;
      } else {
        await expandCatalogUntilCandidates(1);
        exclude = getPickExcludeMalIds();
        candidates = getUnratedCandidates(exclude, blockedFranchises);
      }
    }

    if (candidates.length === 0) {
      console.warn("[rasa] Strict candidate pool exhausted. Relaxing franchise blocks...");
      candidates = getUnratedCandidates(exclude, new Set(), true);
    }

    if (candidates.length === 0) {
      console.warn("[rasa] Catalog fully exhausted. Relaxing all filters to allow re-discovery of popular/skipped titles...");
      // Still exclude rated AND watchlist - watchlist items are user-curated
      // "save for later" and should never be re-surfaced in Discover.
      const ratedIds = new Set(getRatedMalIds());
      const watchlistIds = getWatchlistMalIds();
      candidates = getAllAnime()
        .filter(
          (row) =>
            !ratedIds.has(row.mal_id) &&
            !watchlistIds.has(row.mal_id) &&
            isCatalogRowReady(row),
        )
        .map(rowToCandidate);
    }

    if (candidates.length === 0) {
      console.warn("[rasa] Extreme exhaustion. Allowing re-rating of all ready titles...");
      // Watchlist always stays excluded - even in extreme exhaustion we won't
      // serve back something the user explicitly set aside.
      const watchlistIds = getWatchlistMalIds();
      candidates = getAllAnime()
        .filter((row) => !watchlistIds.has(row.mal_id) && isCatalogRowReady(row))
        .map(rowToCandidate);
    }

    if (candidates.length === 0) {
      throw new CatalogExhaustedError();
    }

    const rated = buildRatedFeatureList();
    const weights = buildFeatureWeights(rated);

    const pool = selectMediaPool(candidates);

    const mlOptions = buildMlPickOptions();
    const pick =
      pickNextCandidateWithMl(pool, weights, getRatingCount(), rated, mlOptions, Math.random, getTasteModel()) ??
      pool[0] ??
      candidates[0];

    reservedMalIds.add(pick.malId);
    return pick.malId;
  });
}

async function buildNextCard(): Promise<AnimeCard> {
  const malId = await pickNextMalId();
  const cachedBeforePresentation = getAnimeById(malId);
  try {
    if (
      !isTmdbId(malId) &&
      (!cachedBeforePresentation || !isCatalogRowReady(cachedBeforePresentation))
    ) {
      await withPresentationLock(() => ensurePresentationCached(malId));
    }
  } catch (error) {
    console.error("[rasa] ensurePresentationCached in buildNextCard", malId, error);
    const cached = getAnimeById(malId);
    if (!cached || !isCatalogRowReady(cached)) {
      throw error;
    }
  } finally {
    reservedMalIds.delete(malId);
  }

  const row = getAnimeById(malId);
  assertCatalogRowReady(row, malId);

  // TMDB (tv/movie) rows are already complete and have no MAL id, so the
  // anime-only AniList enrichment and MAL-Sync streaming prefetch don't apply.
  if (row.media_type === "anime") {
    scheduleTasteEnrichment(malId);
    scheduleWatchStreamsPrefetch(malId);
  }

  recordRecentlyServedFranchise(keyForRow(row));
  recordRecentlyServedFeatures(row);
  return rowToCard(row);
}

function thumbsUpMalIds(): number[] {
  return getRatings()
    .filter((rating) => rating.reaction === "up")
    .map((rating) => rating.mal_id);
}

export function warmDiscoverQueue(): void {
  scheduleQueueRefill(buildNextCard);
}

export async function getNextQueue(): Promise<AnimeCard[]> {
  scheduleQueueRefill(buildNextCard);

  if (queueLength() < QUEUE_SIZE) {
    try {
      await waitForQueueRefill();
      if (queueLength() === 0) {
        await ensureQueue(QUEUE_SIZE, buildNextCard);
      } else if (queueLength() < QUEUE_SIZE) {
        scheduleQueueRefill(buildNextCard);
        await waitForQueueRefill();
      }
    } catch (error) {
      console.error("[rasa] ensureQueue failed", error);
      const partial = snapshotQueue();
      if (partial.length > 0) {
        scheduleQueueRefill(buildNextCard);
        return partial;
      }
      throw new QueueUnavailableError();
    }
  }

  const queue = snapshotQueue();
  if (queue.length === 0) {
    throw new QueueUnavailableError();
  }
  return queue;
}

export async function addToWatchlist(malId: number): Promise<AnimeCard[]> {
  const row = getAnimeById(malId);
  assertCatalogRowReady(row, malId);

  insertWatchlist(malId);
  dropFromQueue(malId);
  dropFranchiseFromQueue(keyForRow(row));
  recordRecentlyServedFranchise(keyForRow(row));

  scheduleQueueRefill(buildNextCard);

  // The save succeeded - an empty queue (mid-restart / slow refill) is NOT a
  // failure of this action. Throwing here made the client roll the just-saved
  // card back onto the deck in a loop.
  return snapshotQueue();
}

export function getWatchlistEntries() {
  return getWatchlist();
}

export function removeFromWatchlist(malId: number): boolean {
  return removeWatchlist(malId);
}

export async function rateAnime(
  malId: number,
  reaction: Reaction,
  options: RateAnimeOptions = {},
): Promise<AnimeCard[]> {
  const row = getAnimeById(malId);
  assertCatalogRowReady(row, malId);

  const downReason =
    reaction === "down" && options.reason ? options.reason : null;

  if (options.dwellMs !== undefined) {
    insertEngagementSignal(malId, options.dwellMs, options.skipped ?? false);
  }

  insertRating(malId, reaction, downReason);
  invalidateTasteModel();
  dropFromQueue(malId);
  dropFranchiseFromQueue(keyForRow(row));
  recordRecentlyServedFranchise(keyForRow(row));

  if (reaction === "up" && !isTmdbId(malId)) {
    void expandTasteGraphFromMalId(malId);
  }
  if (reaction === "up" && isTmdbId(malId)) {
    scheduleTasteNeighborhoodExpansion();
  }

  scheduleQueueRefill(buildNextCard);
  scheduleCatalogExpansionIfNeeded();

  // Rating is persisted; an empty queue is a refill-in-progress state, not an
  // error (throwing made the client resurrect the just-rated card in a loop).
  return snapshotQueue();
}

/** "Don't know it": advances the card without a taste vote. Records a skip
 *  engagement signal (near-zero weight) and temporarily blocks the franchise
 *  from re-serving, but inserts NO rating - unknown titles stay recommendable
 *  later and cost the title's features almost nothing. */
export async function skipAnime(malId: number, dwellMs = 0): Promise<AnimeCard[]> {
  const row = getAnimeById(malId);
  assertCatalogRowReady(row, malId);

  insertEngagementSignal(malId, dwellMs, true);
  dropFromQueue(malId);
  recordRecentlyServedFranchise(keyForRow(row));

  scheduleQueueRefill(buildNextCard);

  // Skip is recorded; empty queue = refill in progress, not a failure.
  return snapshotQueue();
}

/** Resets in-memory Discover state (for tests only). */
export function resetDiscoverStateForTests(): void {
  recentlyServedFranchiseKeys.length = 0;
  recentlyServedFeatureRings.length = 0;
  resetTasteGraphForTests();
  reservedMalIds.clear();
  lastCatalogPrepAt = 0;
  catalogPrepInFlight = null;
  nextPickChain = Promise.resolve();
  nextPresentationChain = Promise.resolve();
  featureCorpusCache = null;
}

export function getTastePatterns(precomputedRated?: RatedFeatures[]) {
  return computeTastePatterns(precomputedRated ?? buildRatedFeatureList());
}

export function getTasteMetrics(precomputedRated?: RatedFeatures[]) {
  const rated = precomputedRated ?? buildRatedFeatureList();
  const weights = buildFeatureWeights(rated);
  const topFeatures = Object.entries(weights)
    .filter(([name]) => !name.startsWith("meta:"))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 12)
    .map(([name, weight]) => ({ name, weight }));

  return {
    reactionWeights: REACTION_WEIGHTS,
    topFeatures,
    patterns: getTastePatterns(rated),
    signals: [
      "genres, themes, demographics, explicit genres",
      "format, status, season, year, age rating, episode length",
      "MAL score tier, rank tier, popularity (AniList + Jikan)",
      "studios and producers (Jikan /full + AniList main studios)",
      "directors, writers, composers, character designers (Jikan /staff)",
      "main characters by name (Jikan cast)",
      "AniList tags up to rank 40+ (alist-tag:*) weighted higher than genre",
      "lead gender (AniList; else synopsis mc:*)",
      "franchise links: sequel, spin-off (relation:*)",
      "synopsis tone and story depth (tone:*, story:*)",
      "watchlist as soft-positive taste signal",
      "synopsis token Jaccard (content similarity, no external ML API)",
      "AniList relation + recommendation graph boost on thumbs-up",
      "IDF-weighted cosine profiles with category boosts for tags/staff",
      "MMR diversity so Discover does not spam the same tag cluster",
      "manhwa: MangaDex tags, status, year, content rating",
      "dwell/skip implicit signals (weak, never replaces votes)",
      "optional downvote reason chips (pacing, art, genre, length)",
      "Simkl static trending JSON when catalog pool is low",
    ],
    jikanEndpointsUsed: [
      { path: "/top/anime?filter=bypopularity", purpose: "Cold-start catalog seeding (list metadata)" },
      { path: "/seasons/now", purpose: "Extra catalog when top pages exhausted" },
      { path: "/anime/{id}/full", purpose: "Discover cards + detail presentation (one call when DB row thin)" },
      { path: "/anime/{id}/relations", purpose: "Background taste supplement when AniList has no relations" },
      { path: "/anime/{id}/staff", purpose: "Background director/writer/composer signals (sequential, optional)" },
      { path: "/anime/{id}/recommendations", purpose: "Low-frequency pool expand from Loved (≥5 min apart, skips 429)" },
      { path: "/anime/{id}/characters", purpose: "Detail page cast only (not on swipe hot path)" },
    ],
    externalApisUsed: [
      {
        service: "AniList GraphQL",
        endpoint: "Media(idMal) + recommendations",
        purpose:
          "Taste enricher: tags, relations, MC gender, collab recs; graph boost on thumbs-up",
      },
      {
        service: "MangaDex",
        endpoint: "manga feed + aggregate",
        purpose: "Manhwa catalog and chapter counts (unchanged)",
      },
    ],
    strategy: {
      coldStart: `First ${COLD_START_RATINGS} ratings maximize information gain (Akinator-style)`,
      exploitation:
        "Warm picks: IDF cosine match vs positive profile minus negative, synopsis Jaccard, graph neighbors of loved titles",
      exploration: "~15% info-gain exploration when warm; MMR reduces tag-cluster spam",
      lovedBoost:
        "Thumbs-up registers AniList graph neighbors immediately; Jikan /recommendations still expands catalog in background",
      watchlistSignal: "Watchlist rows count as softer positives (not shown in Discover)",
      discoverHotPath:
        "Queue picks use cached DB + ML rank; presentation Jikan /full only when row thin",
    },
  };
}

// ── Learned taste model: logistic regression over tags + synopsis, trained on
// the user's own votes. Cached and rebuilt only when the rating set changes. ──
let cachedTasteModel: TasteModel | null = null;
let cachedTasteModelRatingCount = -1;

export function invalidateTasteModel(): void {
  cachedTasteModel = null;
  cachedTasteModelRatingCount = -1;
}

// ── Taste combos: mined credit conjunctions the user can confirm/reject ─────
export interface TasteComboView {
  key: string;
  features: string[];
  label: string;
  likeCount: number;
  downCount: number;
  evidence: string[];
  /** Unrated titles carrying the FULL combo - what confirming would unlock. */
  matchingUnrated: number;
  status: "suggested" | "confirmed" | "rejected";
}

function countMatchingUnrated(features: string[]): number {
  const rated = getRatedMalIds();
  let count = 0;
  for (const row of getAllAnime()) {
    if (rated.has(row.mal_id)) continue;
    const rowFeatureSet = new Set(rowFeatures(row));
    if (features.every((f) => rowFeatureSet.has(f))) count += 1;
  }
  return count;
}

function ratedTitlesForMining(): RatedTitleForMining[] {
  const rows: RatedTitleForMining[] = [];
  for (const rating of getRatings()) {
    const row = getAnimeById(rating.mal_id);
    if (!row) continue;
    rows.push({
      title: row.title_en || row.title_jp,
      franchiseKey: keyForRow(row),
      features: rowFeatures(row),
      reaction: rating.reaction,
    });
  }
  return rows;
}

export function getTasteCombos(): TasteComboView[] {
  const statuses = new Map(
    getTasteComboRows().map((row) => [row.combo_key, row.status]),
  );
  const mined = mineTasteCombos(ratedTitlesForMining());
  const views: TasteComboView[] = mined.map((combo) => ({
    key: combo.key,
    features: combo.features,
    label: humanizeCombo(combo.features),
    likeCount: combo.likeCount,
    downCount: combo.downCount,
    evidence: combo.evidence,
    matchingUnrated: countMatchingUnrated(combo.features),
    status: statuses.get(combo.key) ?? "suggested",
  }));
  // Confirmed rules that fell out of the current mining window stay visible.
  for (const row of getTasteComboRows()) {
    if (row.status !== "confirmed") continue;
    if (views.some((v) => v.key === row.combo_key)) continue;
    const features = JSON.parse(row.features_json) as string[];
    views.push({
      key: row.combo_key,
      features,
      label: humanizeCombo(features),
      likeCount: 0,
      downCount: 0,
      evidence: [],
      matchingUnrated: countMatchingUnrated(features),
      status: "confirmed",
    });
  }
  return views;
}

export function updateTasteComboStatus(
  features: string[],
  status: "confirmed" | "rejected",
): TasteComboView[] {
  setTasteComboStatus(comboKey(features), [...features].sort(), status);
  invalidateTasteModel(); // confirmed combos change ranking
  return getTasteCombos();
}

function getConfirmedComboFeatureSets(): string[][] {
  return getTasteComboRows()
    .filter((row) => row.status === "confirmed")
    .map((row) => JSON.parse(row.features_json) as string[]);
}

/** How much a confirmed combo lifts P(like): p' = p + (1-p)*COMBO_BOOST. */
const CONFIRMED_COMBO_BOOST = 0.5;

function withConfirmedComboBoost(
  model: TasteModel,
  combos: string[][],
): TasteModel {
  if (combos.length === 0) return model;
  return {
    dimension: model.dimension,
    predict(features: string[], synopsis: string): number {
      let p = model.predict(features, synopsis);
      const featureSet = new Set(features);
      for (const combo of combos) {
        if (combo.length > 0 && combo.every((f) => featureSet.has(f))) {
          p = p + (1 - p) * CONFIRMED_COMBO_BOOST;
          break;
        }
      }
      return p;
    },
    topContributors: (features, synopsis, k) =>
      model.topContributors(features, synopsis, k),
  };
}

/** Before this date a 👎 conflated "never heard of it" with "watched and
 *  disliked" (no Don't-know button existed), so those downvotes count less. */
const DOWNVOTE_SEMANTICS_EPOCH = "2026-07-16";
const AMBIGUOUS_DOWNVOTE_WEIGHT = 0.4;

function getTasteModel(): TasteModel | null {
  const ratings = getRatings();
  if (ratings.length < COLD_START_RATINGS) return null;
  if (cachedTasteModel && cachedTasteModelRatingCount === ratings.length) {
    return cachedTasteModel;
  }
  const examples: TasteExample[] = [];
  for (const r of ratings) {
    const row = getAnimeById(r.mal_id);
    if (!row) continue;
    const ambiguousDown =
      r.reaction === "down" && r.rated_at < DOWNVOTE_SEMANTICS_EPOCH;
    examples.push({
      features: rowFeatures(row),
      synopsis: row.synopsis,
      label: r.reaction === "up" ? 1 : 0,
      weight: ambiguousDown ? AMBIGUOUS_DOWNVOTE_WEIGHT : 1,
    });
  }
  if (examples.length < COLD_START_RATINGS) return null;
  const corpus = getAllAnime().map((row) => modelFeatures(rowFeatures(row), row.synopsis));
  cachedTasteModel = withConfirmedComboBoost(
    trainTasteModel(examples, corpus),
    getConfirmedComboFeatureSets(),
  );
  cachedTasteModelRatingCount = ratings.length;
  return cachedTasteModel;
}

/** Warm-profile ranking by learned P(like), composed with media-type quotas
 *  matching the user's upvote mix (a global top-N collapses into whichever
 *  cluster is currently loudest - e.g. an all-Bollywood grid). Within each
 *  type's slice the model still picks the best titles, MMR-diversified. */
function scoreCandidatesWithModel(
  candidates: CatalogCandidate[],
  model: TasteModel,
): ScoredAnime[] {
  const targetCount = PROFILE_TOP_PICKS + PROFILE_GRID_SIZE;
  const scored = candidates
    .map((candidate) => ({ ...candidate, mlScore: model.predict(candidate.features, candidate.synopsis) }))
    .sort((a, b) => b.mlScore - a.mlScore);

  const byType = new Map<string, typeof scored>();
  for (const item of scored) {
    const list = byType.get(item.card.mediaType) ?? [];
    list.push(item);
    byType.set(item.card.mediaType, list);
  }

  const shares = mediaTypeUpShares(computeMediaUpCounts());
  const availableByType = Object.fromEntries(
    [...byType.entries()].map(([type, list]) => [type, list.length]),
  );
  const quotas = allocateMediaQuotas(shares, targetCount, availableByType);

  let diversified: typeof scored;
  if (Object.keys(quotas).length === 0) {
    // No upvote history to derive a mix from - global top pool as before.
    diversified = selectKDiverse(scored.slice(0, targetCount * 3), targetCount, 0.6);
  } else {
    diversified = [];
    for (const [type, quota] of Object.entries(quotas)) {
      if (quota <= 0) continue;
      const pool = (byType.get(type) ?? []).slice(0, quota * 3);
      diversified.push(...selectKDiverse(pool, quota, 0.6));
    }
  }
  diversified.sort((a, b) => b.mlScore - a.mlScore);

  return diversified.map((candidate): ScoredAnime => ({
    ...candidate.card,
    matchScore: candidate.mlScore,
    matchPercent: Math.max(1, Math.min(99, Math.round(candidate.mlScore * 100))),
    topGenres: candidate.card.genres.slice(0, 3),
    tasteSignals: humanizeTasteSignals(
      model.topContributors(candidate.features, candidate.synopsis, 3),
      3,
    ),
  }));
}

function scoreCandidates(
  candidates: CatalogCandidate[],
  _weights: ReturnType<typeof buildFeatureWeights>,
  precomputedRated?: RatedFeatures[],
): ScoredAnime[] {
  const model = getTasteModel();
  if (model) {
    return scoreCandidatesWithModel(candidates, model);
  }

  // Cold start (< COLD_START_RATINGS votes): fall back to the cosine ranker.
  const rated = precomputedRated ?? buildRatedFeatureList();
  const mlOptions = buildMlPickOptions();
  const targetCount = PROFILE_TOP_PICKS + PROFILE_GRID_SIZE;

  // Build ML context once; rank ALL candidates by composite ML score
  const ctx = buildTasteMlContext({
    rated,
    watchlistFeatures: mlOptions.watchlistFeatures,
    featureCorpus: mlOptions.featureCorpus,
    lovedSynopses: mlOptions.lovedSynopses,
    ratingCount: getRatingCount(),
    coldStartThreshold: COLD_START_RATINGS,
  });
  const weightsForFallback = buildFeatureWeights(rated);
  const ranked = rankByMlScore(candidates, ctx, (features) =>
    scoreFeatures(features, weightsForFallback),
  );

  // Take a wider pool (3x the target) and diversify it down. Without this step
  // the grid collapses into one tag cluster ("16 isekai in a row"). MMR picks a
  // diverse SET but returns it in relevance-vs-diversity order; re-sort by score
  // so the displayed match % descends monotonically (the #1 pick can't read lower
  // than #2). The set stays diverse - only the display order changes.
  const pool = ranked.slice(0, targetCount * 3);
  const diversified = selectKDiverse(pool, targetCount, 0.6).sort(
    (a, b) => b.mlScore - a.mlScore,
  );

  // Relative match % is anchored to the full ranked pool, so a candidate's number
  // means "how well this matches your taste vs everything else available."
  // `ranked` is sorted desc by mlScore, so [0] is the best and the midpoint is the median.
  const poolRef = {
    median: ranked.length ? ranked[Math.floor(ranked.length / 2)]!.mlScore : 0,
    max: ranked.length ? ranked[0]!.mlScore : 0,
  };

  return diversified.map((candidate): ScoredAnime => {
    // matchedStrongFeatures are this pick's features weighted by the FULL rating
    // history, so the caption reflects all of the user's reviews, not one title.
    // Cold start has no meaningful aggregate taste yet, so no signals.
    const tasteSignals = ctx.useMl
      ? humanizeTasteSignals(explainCandidateMl(candidate, ctx).matchedStrongFeatures, 3)
      : [];
    return {
      ...candidate.card,
      matchScore: candidate.mlScore,
      matchPercent: calibrateMatchPercent(
        candidate.mlScore,
        poolRef,
        ctx.useMl,
        candidate.popularity,
      ),
      topGenres: candidate.card.genres.slice(0, 3),
      tasteSignals,
    };
  });
}

/** Profile scoring breakdown is verbose (~10 picks x ~15 lines per /api/profile call).
 *  Off by default; enable with DEBUG_RECOMMENDATIONS=true for local debugging. */
const DEBUG_RECOMMENDATIONS = process.env.DEBUG_RECOMMENDATIONS === "true";

export function getProfile() {
  const rated = buildRatedFeatureList();
  const weights = buildFeatureWeights(rated);

  // Exclude not just rated/watchlisted mal_ids but their whole franchises, so a
  // downvoted title's same-franchise duplicates/sequels can't resurface as picks.
  const blockedFranchises = new Set([
    ...getRatedFranchiseKeys(),
    ...getWatchlistFranchiseKeys(),
  ]);
  const unratedCandidates = getUnratedCandidates(new Set(), blockedFranchises);
  const queuedMalIds = getQueuedMalIds();
  const candidatesForScoring = unratedCandidates.filter(
    (c) => !queuedMalIds.has(c.card.malId),
  );

  // Exclude items already queued in Discover so profile recs don't duplicate the queue
  const scored = scoreCandidates(candidatesForScoring, weights, rated);
  const topPicks = scored.slice(0, PROFILE_TOP_PICKS);
  const recommendations = scored.slice(
    PROFILE_TOP_PICKS,
    PROFILE_TOP_PICKS + PROFILE_GRID_SIZE,
  );

  if (DEBUG_RECOMMENDATIONS) {
    // Breakdown for the top 10 picks. Computed via explainCandidateMl so these
    // numbers ARE the ranker's (weak-feature ceiling included) - no recompute drift.
    const top10 = scored.slice(0, 10);
    const mlOptions = buildMlPickOptions();
    const ctx = buildTasteMlContext({
      rated,
      watchlistFeatures: mlOptions.watchlistFeatures,
      featureCorpus: mlOptions.featureCorpus,
      lovedSynopses: mlOptions.lovedSynopses,
      ratingCount: getRatingCount(),
      coldStartThreshold: COLD_START_RATINGS,
    });

    console.log(`\n================ RECOMMENDATION SCORES BREAKDOWN (Top 10) ================`);
    for (const item of top10) {
      const candidate = candidatesForScoring.find((c) => c.malId === item.malId);
      if (!candidate) continue;

      console.log(`Candidate: "${item.titleEn || item.titleRomaji}" (ID: ${item.malId}, Type: ${item.mediaType})`);
      if (!ctx.useMl) {
        console.log(`  Phase: Cold Start (Linear Fallback)`);
        console.log(`  Fallback Score: ${item.matchScore.toFixed(4)}`);
      } else {
        const exp = explainCandidateMl(candidate, ctx);
        console.log(`  Final Score:          ${exp.finalScore.toFixed(4)}`);
        console.log(`  Match Percent:        ${item.matchPercent}%`);
        console.log(`  Core Score:           ${exp.coreScore.toFixed(4)}`);
        console.log(`  Capped Core Score:    ${exp.cappedCoreScore.toFixed(4)}`);
        console.log(`  Weak-Only Match:      ${exp.weakOnlyMatch}`);
        console.log(`  Positive Similarity:  ${exp.positiveSimilarity.toFixed(4)}`);
        console.log(`  Negative Similarity:  ${exp.negativeSimilarity.toFixed(4)}`);
        console.log(`  Synopsis Boost:       ${exp.synopsisBoost.toFixed(4)}`);
        console.log(`  Graph Boost:          ${exp.graphBoost.toFixed(4)}`);
        console.log(`  Popularity Prior:     ${exp.popularityPrior.toFixed(4)}`);

        const logFeatures = (label: string, features: string[]) => {
          console.log(`  ${label} (max 10):`);
          if (features.length > 0) {
            features.slice(0, 10).forEach((f) => console.log(`    - ${f}`));
          } else {
            console.log(`    - None`);
          }
        };
        logFeatures("Matched Strong Features", exp.matchedStrongFeatures);
        logFeatures("Matched Weak Features", exp.matchedWeakFeatures);
        logFeatures("Penalized Features", exp.penalizedFeatures);
      }
      console.log(`-------------------------------------------------------------------------`);
    }
    console.log(`=========================================================================\n`);
  }

  return {
    topPicks,
    recommendations,
    topRecommendations: topPicks,
    history: getProfileHistory(),
    reactionCounts: getReactionCounts(),
    totalRatings: getRatingCount(),
    taste: getTasteMetrics(rated),
    enginePhase: isColdStart(getRatingCount()) ? "learning" : "personalized",
    catalogStats: {
      unratedFranchises: unratedCandidates.length,
      catalogEntries: getAllAnime().length,
    },
  };
}

async function buildTmdbDetailPage(
  malId: number,
  row: ReturnType<typeof getAnimeById> & {},
  userReaction: Reaction | null,
  isWatchlisted: boolean,
) {
  const synth = parseSyntheticId(malId);
  if (!synth) {
    throw new Error(`Not a TMDB id: ${malId}`);
  }

  let detail;
  try {
    detail = await fetchTmdbDetail(synth.kind, synth.tmdbId);
    // Re-upsert with richer features from the detail call
    upsertTmdbBatch([detail.parsed]);
  } catch (error) {
    console.warn("[rasa] TMDB detail fetch failed, using catalog row", malId, error);
  }

  const card = rowToCard(row);
  const tmdbUrl = synth.kind === "tv"
    ? `https://www.themoviedb.org/tv/${synth.tmdbId}`
    : `https://www.themoviedb.org/movie/${synth.tmdbId}`;

  return {
    userReaction,
    isWatchlisted,
    mediaType: row.media_type as MediaType,
    malId: card.malId,
    malUrl: tmdbUrl,
    titleEn: card.titleEn,
    titleRomaji: card.titleRomaji,
    synopsis: card.synopsis,
    background: null,
    imageUrl: card.imageUrl,
    trailerUrl: detail?.trailerUrl ?? null,
    year: detail?.year ?? null,
    season: null,
    status: detail?.status ?? null,
    aired: null,
    episodes: null,
    duration: detail?.runtime ? `${detail.runtime} min` : null,
    ageRating: null,
    score: row.score,
    scoredBy: null,
    rank: null,
    popularity: row.popularity,
    members: null,
    favorites: null,
    source: synth.kind === "tv" ? "TV Show (TMDB)" : "Movie (TMDB)",
    genres: card.genres,
    themes: card.themes,
    demographics: safeJsonArray(row.demographics),
    explicitGenres: [],
    studios: detail ? detail.cast.slice(0, 5).map((name) => name) : [],
    producers: detail?.watchProviders ?? [],
    licensors: [],
    characters: [],
    recommendations: [],
  };
}

export async function getAnimeDetailPage(malId: number) {
  const userReaction = getUserReaction(malId);
  const isWatchlisted = isOnWatchlist(malId);

  if (isTmdbId(malId)) {
    let row = getAnimeById(malId);
    if (!row) {
      const synth = parseSyntheticId(malId);
      if (synth) {
        try {
          const detail = await fetchTmdbDetail(synth.kind, synth.tmdbId);
          upsertTmdbBatch([detail.parsed]);
          row = getAnimeById(malId);
        } catch (error) {
          console.error("[rasa] Dynamic TMDB detail fetch failed", malId, error);
        }
      }
    }
    if (!row) {
      throw new Error(`TMDB title not found: ${malId}`);
    }
    return buildTmdbDetailPage(malId, row, userReaction, isWatchlisted);
  }

  const row = getAnimeById(malId);
  if (row?.media_type === "manhwa") {
    await ensurePresentationCached(malId);
    const cached = getAnimeById(malId);
    if (!cached) {
      throw new Error("Manhwa not found");
    }
    const card = rowToCard(cached);
    return {
      userReaction,
      isWatchlisted,
      mediaType: "manhwa",
      malId: card.malId,
      malUrl: cached.mangadex_id
        ? `https://mangadex.org/title/${cached.mangadex_id}`
        : null,
      titleEn: card.titleEn,
      titleRomaji: card.titleRomaji,
      synopsis: card.synopsis,
      background: null,
      imageUrl: card.imageUrl,
      trailerUrl: null,
      year: null,
      season: null,
      status: null,
      aired:
        card.chapterCount !== null
          ? `${card.chapterCount} chapters available`
          : null,
      episodes: card.chapterCount,
      duration: null,
      ageRating: null,
      score: null,
      scoredBy: null,
      rank: null,
      popularity: cached.popularity,
      members: null,
      favorites: null,
      source: "Manhwa (MangaDex)",
      genres: card.genres,
      themes: card.themes,
      demographics: safeJsonArray(cached.demographics),
      explicitGenres: [],
      studios: [],
      producers: [],
      licensors: [],
      characters: [],
      recommendations: [],
    };
  }

  if (row && (row.media_type === "tv" || row.media_type === "movie")) {
    return buildTmdbDetailPage(malId, row, userReaction, isWatchlisted);
  }

  await ensurePresentationCached(malId);
  scheduleTasteEnrichment(malId);
  const detail = await fetchAnimeDetail(malId);

  const cached = getAnimeById(malId);
  if (cached) {
    upsertAnime({
      ...cached,
      title_en: detail.titleEn,
      title_jp: detail.titleRomaji,
      synopsis: detail.synopsis,
      image_url: detail.imageUrl,
      genres: JSON.stringify(detail.genres),
      themes: JSON.stringify(detail.themes),
      demographics: JSON.stringify(detail.demographics),
      score: detail.score,
      popularity: detail.popularity ?? cached.popularity,
    });
    invalidateFeatureCorpusCache();
  }

  return { ...detail, userReaction, isWatchlisted, mediaType: "anime" };
}

export function rateFromDetail(
  malId: number,
  reaction: Reaction,
  options: RateAnimeOptions = {},
): Reaction {
  const row = getAnimeById(malId);
  assertCatalogRowReady(row, malId);

  const downReason =
    reaction === "down" && options.reason ? options.reason : null;

  if (options.dwellMs !== undefined) {
    insertEngagementSignal(malId, options.dwellMs, options.skipped ?? false);
  }

  insertRating(malId, reaction, downReason);
  invalidateTasteModel();
  dropFromQueue(malId);
  dropFranchiseFromQueue(keyForRow(row));
  scheduleQueueRefill(buildNextCard);
  scheduleCatalogExpansionIfNeeded();
  return reaction;
}

export async function getWatchStreams(malId: number): Promise<any> {
  // TMDB tv/movie titles have no MAL id - MAL-Sync can't resolve them.
  if (isTmdbId(malId)) {
    return { malId, streams: [] };
  }

  // 1. Check SQLite Cache
  const cached = getWatchStreamsFromDb(malId);
  if (cached) {
    return cached;
  }

  // 2. Fetch from MAL-Sync
  try {
    const url = `https://api.malsync.moe/mal/anime/${malId}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const empty = { malId, streams: [] };
      insertWatchStreamsIntoDb(malId, empty);
      return empty;
    }

    const data = (await res.json()) as any;
    const streams: any[] = [];

    if (data && data.Sites) {
      for (const siteName of Object.keys(data.Sites)) {
        const siteData = data.Sites[siteName];
        for (const key of Object.keys(siteData)) {
          const entry = siteData[key];
          if (entry && entry.url) {
            let type = "unofficial";
            if (
              ["Crunchyroll", "Netflix", "Hulu", "Disney Plus", "Bilibili TV"].includes(
                siteName,
              )
            ) {
              type = "official";
            }
            streams.push({
              name: siteName,
              title: entry.title || data.title,
              url: entry.url,
              image: entry.image || null,
              type,
            });
          }
        }
      }
    }

    const payload = {
      malId,
      title: data.title || "",
      image: data.image || null,
      streams,
    };

    insertWatchStreamsIntoDb(malId, payload);
    return payload;
  } catch (error) {
    console.error(`[watch-api] Failed to fetch MAL-Sync for ID ${malId}:`, error);
    return { malId, streams: [] };
  }
}

export function scheduleWatchStreamsPrefetch(malId: number): void {
  // If it's already in the cache, don't prefetch again
  if (getWatchStreamsFromDb(malId)) {
    return;
  }
  // Fire and forget
  void getWatchStreams(malId).catch(() => {});
}


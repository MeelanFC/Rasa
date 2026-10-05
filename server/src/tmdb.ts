/**
 * TMDB adapter: pulls live-action TV + movies into the same catalog/feature
 * pipeline as anime/manhwa. Mirrors jikan.ts in shape so service.ts can ingest
 * it the same way. Authenticates with the v4 read token (Bearer) when present,
 * else falls back to the v3 api_key query param.
 */
import { z } from "zod";
import { fetchWithRetry } from "./fetch-retry.js";
import { buildTasteFeatures, type StaffMember } from "./features.js";
import type { AnimeCharacter } from "./jikan.js";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_SERVICE = "TMDB";

export type TmdbKind = "tv" | "movie";

// ── Synthetic id namespacing ───────────────────────────────────────────────
// The catalog PK is an integer `mal_id`; real MAL/MangaDex ids are well below
// 1e9. TMDB ids are < ~1e7, so these offsets are collision-free vs anime/manhwa
// and vs each other.
export const TV_ID_OFFSET = 1_000_000_000;
export const MOVIE_ID_OFFSET = 2_000_000_000;

export function toSyntheticId(kind: TmdbKind, tmdbId: number): number {
  return (kind === "movie" ? MOVIE_ID_OFFSET : TV_ID_OFFSET) + tmdbId;
}

export function parseSyntheticId(
  malId: number,
): { kind: TmdbKind; tmdbId: number } | null {
  if (malId >= MOVIE_ID_OFFSET) {
    return { kind: "movie", tmdbId: malId - MOVIE_ID_OFFSET };
  }
  if (malId >= TV_ID_OFFSET) {
    return { kind: "tv", tmdbId: malId - TV_ID_OFFSET };
  }
  return null;
}

export function isTmdbId(malId: number): boolean {
  return malId >= TV_ID_OFFSET;
}

// ── Static genre id → name maps (TMDB genre lists are stable) ───────────────
const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10762: "Kids",
  9648: "Mystery",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
  37: "Western",
};

const MOVIE_GENRES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

function genreNamesFromIds(kind: TmdbKind, ids: number[]): string[] {
  const map = kind === "tv" ? TV_GENRES : MOVIE_GENRES;
  return ids.map((id) => map[id]).filter((name): name is string => Boolean(name));
}

// ── Auth + fetch ───────────────────────────────────────────────────────────
function authHeaders(): Record<string, string> {
  const token = process.env.TMDB_READ_TOKEN?.trim();
  if (token) {
    return { Authorization: `Bearer ${token}`, Accept: "application/json" };
  }
  return { Accept: "application/json" };
}

function withApiKey(url: string): string {
  if (process.env.TMDB_READ_TOKEN?.trim()) {
    return url;
  }
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}api_key=${key}`;
}

export function hasTmdbCredentials(): boolean {
  return Boolean(
    process.env.TMDB_READ_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim(),
  );
}

const MIN_GAP_MS = 60;
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

async function tmdbFetch<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
): Promise<z.output<S>> {
  await throttle();
  const response = await fetchWithRetry(
    withApiKey(`${TMDB_BASE}${path}`),
    { headers: authHeaders() },
    { service: TMDB_SERVICE, path },
  );
  const json: unknown = await response.json();
  return schema.parse(json);
}

// ── Parsed shape (ingest-ready, mirrors ParsedAnime/ParsedManhwa) ───────────
export interface ParsedTmdb {
  mal_id: number;
  title_en: string;
  title_jp: string;
  synopsis: string;
  image_url: string;
  genres: string;
  themes: string;
  demographics: string;
  score: number | null;
  popularity: number;
  kind: TmdbKind;
  features_json: string;
}

export interface TmdbFeatureInput {
  kind: TmdbKind;
  genres: string[];
  keywords: string[];
  synopsis: string;
  year: number | null;
  score: number | null;
  runtime: number | null;
  originCountries: string[];
  originalLanguage: string | null;
  cast: string[];
  directors: string[];
  writers: string[];
  composers: string[];
  cinematographers: string[];
  costumeDesigners: string[];
  editors: string[];
  productionDesigners: string[];
  companies: string[];
}

/** Maps TMDB metadata onto the shared taste-feature vocabulary. */
export function buildTmdbFeatures(input: TmdbFeatureInput): string[] {
  const staff: StaffMember[] = [
    ...input.directors.map((name) => ({ name, positions: ["Director"] })),
    ...input.writers.map((name) => ({ name, positions: ["Writer"] })),
    ...input.composers.map((name) => ({ name, positions: ["Music"] })),
    ...input.cinematographers.map((name) => ({ name, positions: ["Cinematography"] })),
    ...input.costumeDesigners.map((name) => ({ name, positions: ["Costume Design"] })),
    ...input.editors.map((name) => ({ name, positions: ["Editor"] })),
    ...input.productionDesigners.map((name) => ({ name, positions: ["Production Design"] })),
  ];
  const characters: AnimeCharacter[] = input.cast
    .slice(0, 3)
    .map((name) => ({ malId: 0, name, role: "Main", imageUrl: null, voiceActor: null }));

  const base = buildTasteFeatures({
    genresJson: JSON.stringify(input.genres),
    themesJson: JSON.stringify(input.keywords),
    demographicsJson: "[]",
    synopsis: input.synopsis,
    studios: input.companies,
    staff,
    characters,
    year: input.year,
    malScore: input.score,
    duration: input.runtime,
  });

  const extra: string[] = [`origin:${input.kind}`];
  for (const country of input.originCountries) {
    const slug = country.trim().toLowerCase();
    if (slug) {
      extra.push(`region:${slug}`);
    }
  }
  const lang = input.originalLanguage?.trim().toLowerCase();
  if (lang) {
    extra.push(`lang:${lang}`);
  }

  return [...new Set([...base, ...extra])];
}

function yearFromDate(date: string | undefined): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : null;
}

function posterUrl(posterPath: string | null | undefined): string {
  return posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : "";
}

// ── Discover ───────────────────────────────────────────────────────────────
const discoverItemSchema = z
  .object({
    id: z.number(),
    title: z.string().optional(),
    name: z.string().optional(),
    original_title: z.string().optional(),
    original_name: z.string().optional(),
    overview: z.string().optional().default(""),
    poster_path: z.string().nullable().optional(),
    genre_ids: z.array(z.number()).optional().default([]),
    vote_average: z.number().optional().default(0),
    popularity: z.number().optional().default(0),
    origin_country: z.array(z.string()).optional().default([]),
    original_language: z.string().optional(),
    first_air_date: z.string().optional(),
    release_date: z.string().optional(),
    adult: z.boolean().optional(),
  })
  .passthrough();

const discoverResponseSchema = z.object({
  page: z.number().optional(),
  total_pages: z.number().optional(),
  results: z.array(discoverItemSchema),
});

type DiscoverItem = z.output<typeof discoverItemSchema>;

/** Build a ParsedTmdb row from a discover list item (genre-level features). */
export function parseDiscoverItem(kind: TmdbKind, raw: DiscoverItem): ParsedTmdb | null {
  if (raw.adult) {
    return null;
  }
  const titleEn = (kind === "tv" ? raw.name : raw.title)?.trim() ?? "";
  const original =
    (kind === "tv" ? raw.original_name : raw.original_title)?.trim() || titleEn;
  const synopsis = raw.overview?.trim() ?? "";
  const image = posterUrl(raw.poster_path);
  const genres = genreNamesFromIds(kind, raw.genre_ids ?? []);
  const year = yearFromDate(kind === "tv" ? raw.first_air_date : raw.release_date);
  const score = raw.vote_average && raw.vote_average > 0 ? raw.vote_average : null;

  const features = buildTmdbFeatures({
    kind,
    genres,
    keywords: [],
    synopsis,
    year,
    score,
    runtime: null,
    originCountries: raw.origin_country ?? [],
    originalLanguage: raw.original_language ?? null,
    cast: [],
    directors: [],
    writers: [],
    composers: [],
    cinematographers: [],
    costumeDesigners: [],
    editors: [],
    productionDesigners: [],
    companies: [],
  });

  return {
    mal_id: toSyntheticId(kind, raw.id),
    title_en: titleEn || original,
    title_jp: original,
    synopsis,
    image_url: image,
    genres: JSON.stringify(genres),
    themes: JSON.stringify([]),
    demographics: JSON.stringify([]),
    score,
    popularity: Math.round(raw.popularity ?? 0),
    kind,
    features_json: JSON.stringify(features),
  };
}

export interface DiscoverOptions {
  originCountry?: string;
}

/** Popularity-sorted TV or movie page, optionally filtered to an origin country. */
export async function fetchTmdbDiscover(
  kind: TmdbKind,
  page = 1,
  options: DiscoverOptions = {},
): Promise<ParsedTmdb[]> {
  const params = new URLSearchParams({
    sort_by: "popularity.desc",
    page: String(page),
    include_adult: "false",
    language: "en-US",
    "vote_count.gte": "50",
  });
  if (options.originCountry) {
    params.set("with_origin_country", options.originCountry);
  }

  const result = await tmdbFetch(
    `/discover/${kind}?${params.toString()}`,
    discoverResponseSchema,
  );

  return result.results
    .map((item) => parseDiscoverItem(kind, item as DiscoverItem))
    .filter((item): item is ParsedTmdb => item !== null);
}

// ── Detail (richer features + trailer + where-to-watch) ─────────────────────
const detailSchema = z
  .object({
    id: z.number(),
    title: z.string().optional(),
    name: z.string().optional(),
    original_title: z.string().optional(),
    original_name: z.string().optional(),
    overview: z.string().optional().default(""),
    poster_path: z.string().nullable().optional(),
    genres: z
      .array(z.object({ name: z.string() }))
      .optional()
      .default([]),
    vote_average: z.number().optional().default(0),
    popularity: z.number().optional().default(0),
    origin_country: z.array(z.string()).optional().default([]),
    original_language: z.string().optional(),
    first_air_date: z.string().optional(),
    release_date: z.string().optional(),
    runtime: z.number().nullable().optional(),
    episode_run_time: z.array(z.number()).optional().default([]),
    status: z.string().optional(),
    networks: z.array(z.object({ name: z.string() })).optional().default([]),
    production_companies: z
      .array(z.object({ name: z.string() }))
      .optional()
      .default([]),
    created_by: z.array(z.object({ name: z.string() })).optional().default([]),
    keywords: z
      .object({
        keywords: z.array(z.object({ name: z.string() })).optional(),
        results: z.array(z.object({ name: z.string() })).optional(),
      })
      .optional(),
    credits: z
      .object({
        cast: z.array(z.object({ name: z.string() })).optional().default([]),
        crew: z
          .array(
            z.object({
              name: z.string(),
              job: z.string().optional(),
              department: z.string().optional(),
            }),
          )
          .optional()
          .default([]),
      })
      .optional(),
    videos: z
      .object({
        results: z
          .array(z.object({ site: z.string(), type: z.string(), key: z.string() }))
          .optional()
          .default([]),
      })
      .optional(),
    "watch/providers": z
      .object({
        results: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .passthrough();


export interface TmdbDetail {
  parsed: ParsedTmdb;
  kind: TmdbKind;
  genres: string[];
  keywords: string[];
  cast: string[];
  year: number | null;
  runtime: number | null;
  status: string | null;
  trailerUrl: string | null;
  watchProviders: string[];
}

type CrewMember = { name: string; job?: string; department?: string };

export function crewByRole(crew: CrewMember[] | undefined) {
  const directors: string[] = [];
  const writers: string[] = [];
  const composers: string[] = [];
  const cinematographers: string[] = [];
  const costumeDesigners: string[] = [];
  const editors: string[] = [];
  const productionDesigners: string[] = [];
  for (const member of crew ?? []) {
    const job = (member.job ?? "").toLowerCase();
    const dept = (member.department ?? "").toLowerCase();
    // Strict match: fuzzy `includes("director")` used to sweep casting directors,
    // assistant directors, etc. into director: features (K3G showed 8 "directors").
    if (job === "director" || (dept === "directing" && job === "series director")) {
      directors.push(member.name);
    }
    if (
      dept === "writing" ||
      job.includes("writer") ||
      job.includes("screenplay") ||
      job.includes("story")
    ) {
      writers.push(member.name);
    }
    if (job.includes("music") || job.includes("composer")) {
      composers.push(member.name);
    }
    if (
      job.includes("director of photography") ||
      job === "cinematography" ||
      job === "cinematographer"
    ) {
      cinematographers.push(member.name);
    }
    if (job.includes("costume design")) {
      costumeDesigners.push(member.name);
    }
    if (job === "editor" || (dept === "editing" && job.includes("editor"))) {
      editors.push(member.name);
    }
    if (job.includes("production design")) {
      productionDesigners.push(member.name);
    }
  }
  return {
    directors,
    writers,
    composers,
    cinematographers,
    costumeDesigners,
    editors,
    productionDesigners,
  };
}

function trailerFromVideos(videos: { results?: Array<{ site: string; type: string; key: string }> } | undefined): string | null {
  const results = videos?.results ?? [];
  const trailer =
    results.find((v) => v.site === "YouTube" && v.type === "Trailer") ??
    results.find((v) => v.site === "YouTube");
  return trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
}

function watchProviderNames(raw: { "watch/providers"?: { results?: Record<string, unknown> } }): string[] {
  const results = raw["watch/providers"]?.results;
  if (!results) return [];
  const names = new Set<string>();
  for (const region of Object.values(results)) {
    const flatrate = (region as { flatrate?: Array<{ provider_name?: string }> })
      ?.flatrate;
    for (const provider of flatrate ?? []) {
      if (provider.provider_name) {
        names.add(provider.provider_name);
      }
    }
  }
  return [...names].slice(0, 12);
}

// ── Search (title → candidates, used by favorite-seeding) ───────────────────
export interface SearchOptions {
  year?: number;
  /** ISO-639-1 filter applied client-side (e.g. "hi" for Hindi) to disambiguate. */
  originalLanguage?: string;
}

/** Title search; returns ingest-ready rows, best match first (TMDB relevance order). */
export async function fetchTmdbSearch(
  kind: TmdbKind,
  query: string,
  options: SearchOptions = {},
): Promise<ParsedTmdb[]> {
  const params = new URLSearchParams({
    query,
    include_adult: "false",
    language: "en-US",
  });
  if (options.year) {
    params.set(kind === "tv" ? "first_air_date_year" : "primary_release_year", String(options.year));
  }
  const result = await tmdbFetch(
    `/search/${kind}?${params.toString()}`,
    discoverResponseSchema,
  );
  let items = result.results;
  if (options.originalLanguage) {
    items = items.filter((r) => r.original_language === options.originalLanguage);
  }
  return items
    .map((item) => parseDiscoverItem(kind, item as DiscoverItem))
    .filter((item): item is ParsedTmdb => item !== null);
}

// ── Credits with person ids (taste-neighborhood expansion) ──────────────────
const creditsResponseSchema = z.object({
  cast: z
    .array(z.object({ id: z.number(), name: z.string(), order: z.number().optional() }))
    .optional()
    .default([]),
  crew: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        job: z.string().optional(),
        department: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export interface TmdbKeyPerson {
  id: number;
  name: string;
  role: "director" | "writer" | "cast";
}

/** The people most predictive of taste for one title: director(s), writers, top cast. */
export async function fetchTmdbKeyPersons(
  kind: TmdbKind,
  tmdbId: number,
  maxCast = 4,
): Promise<TmdbKeyPerson[]> {
  const raw = await tmdbFetch(`/${kind}/${tmdbId}/credits`, creditsResponseSchema);
  const persons: TmdbKeyPerson[] = [];
  const seen = new Set<number>();
  const push = (id: number, name: string, role: TmdbKeyPerson["role"]) => {
    if (seen.has(id)) return;
    seen.add(id);
    persons.push({ id, name, role });
  };
  for (const member of raw.crew) {
    const job = (member.job ?? "").toLowerCase();
    const dept = (member.department ?? "").toLowerCase();
    if (job === "director") push(member.id, member.name, "director");
    else if (dept === "writing") push(member.id, member.name, "writer");
  }
  const cast = [...raw.cast].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  for (const member of cast.slice(0, maxCast)) {
    push(member.id, member.name, "cast");
  }
  return persons;
}

// ── Person filmography (combined credits → ingest-ready candidate rows) ─────
const personCreditItemSchema = discoverItemSchema.extend({
  media_type: z.string().optional(),
  vote_count: z.number().optional().default(0),
  job: z.string().optional(),
});

const personCombinedCreditsSchema = z.object({
  cast: z.array(personCreditItemSchema).optional().default([]),
  crew: z.array(personCreditItemSchema).optional().default([]),
});

/**
 * A person's filmography as shallow candidate rows. Acting credits plus
 * directing/writing crew credits; talk shows and barely-voted entries dropped.
 * Capped at the `limit` most popular so one prolific actor can't flood the pool.
 */
export async function fetchTmdbPersonCredits(
  personId: number,
  limit = 40,
  minVoteCount = 20,
): Promise<ParsedTmdb[]> {
  const raw = await tmdbFetch(
    `/person/${personId}/combined_credits?language=en-US`,
    personCombinedCreditsSchema,
  );
  const crewKept = raw.crew.filter((c) => {
    const job = (c.job ?? "").toLowerCase();
    return job === "director" || job === "writer" || job === "screenplay" || job === "dialogue";
  });
  const byKey = new Map<string, z.output<typeof personCreditItemSchema>>();
  for (const item of [...raw.cast, ...crewKept]) {
    if (item.media_type !== "movie" && item.media_type !== "tv") continue;
    if ((item.vote_count ?? 0) < minVoteCount) continue;
    byKey.set(`${item.media_type}:${item.id}`, item);
  }
  return [...byKey.values()]
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, limit)
    .map((item) => parseDiscoverItem(item.media_type as TmdbKind, item as DiscoverItem))
    .filter((item): item is ParsedTmdb => item !== null);
}

/** Full metadata for a single TV show or movie (detail page + rich features). */
export async function fetchTmdbDetail(
  kind: TmdbKind,
  tmdbId: number,
): Promise<TmdbDetail> {
  const raw = await tmdbFetch(
    `/${kind}/${tmdbId}?append_to_response=keywords,credits,videos,watch/providers&language=en-US`,
    detailSchema,
  );

  const titleEn = (kind === "tv" ? raw.name : raw.title)?.trim() ?? "";
  const original =
    (kind === "tv" ? raw.original_name : raw.original_title)?.trim() || titleEn;
  const synopsis = raw.overview?.trim() ?? "";
  const genres = (raw.genres ?? []).map((g) => g.name);
  const keywords = (raw.keywords?.keywords ?? raw.keywords?.results ?? []).map(
    (k) => k.name,
  );
  const cast = (raw.credits?.cast ?? []).slice(0, 10).map((c) => c.name);
  const {
    directors,
    writers,
    composers,
    cinematographers,
    costumeDesigners,
    editors,
    productionDesigners,
  } = crewByRole(raw.credits?.crew);
  const createdBy = (raw.created_by ?? []).map((c) => c.name);
  const companies = [
    ...(raw.networks ?? []).map((n) => n.name),
    ...(raw.production_companies ?? []).map((c) => c.name),
  ];
  const year = yearFromDate(kind === "tv" ? raw.first_air_date : raw.release_date);
  const runtime = raw.runtime ?? raw.episode_run_time?.[0] ?? null;
  const score = raw.vote_average && raw.vote_average > 0 ? raw.vote_average : null;

  const features = buildTmdbFeatures({
    kind,
    genres,
    keywords,
    synopsis,
    year,
    score,
    runtime,
    originCountries: raw.origin_country ?? [],
    originalLanguage: raw.original_language ?? null,
    cast,
    directors,
    writers: [...writers, ...createdBy],
    composers,
    cinematographers,
    costumeDesigners,
    editors,
    productionDesigners,
    companies,
  });

  const parsed: ParsedTmdb = {
    mal_id: toSyntheticId(kind, raw.id),
    title_en: titleEn || original,
    title_jp: original,
    synopsis,
    image_url: posterUrl(raw.poster_path),
    genres: JSON.stringify(genres),
    themes: JSON.stringify(keywords),
    demographics: JSON.stringify([]),
    score,
    popularity: Math.round(raw.popularity ?? 0),
    kind,
    features_json: JSON.stringify(features),
  };

  return {
    parsed,
    kind,
    genres,
    keywords,
    cast,
    year,
    runtime,
    status: raw.status ?? null,
    trailerUrl: trailerFromVideos(raw.videos),
    watchProviders: watchProviderNames(raw),
  };
}

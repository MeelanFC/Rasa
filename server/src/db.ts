import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCatalogRowReady } from "./catalog.js";
import { franchiseKey, keyForRow } from "./franchise.js";
import type {
  AnimeCard,
  AnimeRow,
  DownvoteReason,
  EngagementSignalRow,
  MediaType,
  RatingRow,
  Reaction,
  WatchlistEntry,
} from "./types.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const LIVE_DB_PATH = join(dataDir, "rasa.db");
const LEGACY_DB_PATH = join(dataDir, "anikinator.db");

/** One-time rename from the project's old name (pre-Rasa databases).
 *  Returns the path to open. If the rename fails (e.g. the old file is still
 *  locked by a dying process on Windows), we KEEP USING the legacy path for
 *  this run - never risk starting on a fresh empty database when the user's
 *  data exists under the old name. */
function migrateLegacyDbFile(): string {
  if (existsSync(LIVE_DB_PATH) || !existsSync(LEGACY_DB_PATH)) {
    return LIVE_DB_PATH;
  }
  try {
    renameSync(LEGACY_DB_PATH, LIVE_DB_PATH);
    for (const suffix of ["-shm", "-wal"]) {
      if (existsSync(LEGACY_DB_PATH + suffix)) {
        renameSync(LEGACY_DB_PATH + suffix, LIVE_DB_PATH + suffix);
      }
    }
    return LIVE_DB_PATH;
  } catch (error) {
    console.warn(
      "[db] Could not rename legacy database (still locked?). Using legacy path this run.",
      error,
    );
    return LEGACY_DB_PATH;
  }
}

/**
 * Which database file getDb() opens. Production uses the live file. Tests MUST set
 * RASA_DB_PATH to an isolated db (e.g. ":memory:"); the guard throws rather than
 * letting a vitest run open - and wipe - the live database.
 */
function resolveDbPath(): string {
  const override = process.env.RASA_DB_PATH?.trim();
  const underTest = process.env.VITEST === "true";
  if (underTest && (!override || override === LIVE_DB_PATH)) {
    throw new Error(
      "[db] Refusing to open the live database under vitest. Set RASA_DB_PATH to an " +
        'isolated path (e.g. ":memory:") before db.js is imported. Guards against tests wiping real data.',
    );
  }
  return override || LIVE_DB_PATH;
}

let dbInstance: Database.Database | undefined;

export function safeJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    let dbPath = resolveDbPath();
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
      if (dbPath === LIVE_DB_PATH) {
        dbPath = migrateLegacyDbFile();
      }
    }
    dbInstance = new Database(dbPath);
    dbInstance.pragma("journal_mode = WAL");
    migrate(dbInstance);
  }
  return dbInstance;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anime (
      mal_id INTEGER PRIMARY KEY,
      title_en TEXT NOT NULL,
      title_jp TEXT NOT NULL,
      synopsis TEXT NOT NULL,
      image_url TEXT NOT NULL,
      genres TEXT NOT NULL DEFAULT '[]',
      themes TEXT NOT NULL DEFAULT '[]',
      demographics TEXT NOT NULL DEFAULT '[]',
      score REAL,
      popularity INTEGER NOT NULL DEFAULT 0,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ratings (
      mal_id INTEGER PRIMARY KEY,
      reaction TEXT NOT NULL CHECK (reaction IN ('up', 'down')),
      rated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (mal_id) REFERENCES anime(mal_id)
    );
  `);

  migrateRatingsToBinary(db);
  ensureRatingsRatedAtDefault(db);
  migrateManhwaColumns(db);
  migrateFeaturesColumn(db);
  migrateFranchiseKeyColumn(db);
  migrateWatchlistTable(db);
  migrateEngagementSignalsTable(db);
  migrateRatingsDownReason(db);
  migrateTasteNeighborsTable(db);
  migrateWatchStreamsCacheTable(db);
  migrateGenreExpansionPagesTable(db);
  migratePersonExpansionTables(db);
}

function migratePersonExpansionTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tmdb_person_expansion (
      person_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      expanded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tmdb_credit_scans (
      mal_id INTEGER PRIMARY KEY,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS taste_combos (
      combo_key TEXT PRIMARY KEY,
      features_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('confirmed', 'rejected')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function migrateEngagementSignalsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS engagement_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mal_id INTEGER NOT NULL,
      dwell_ms INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (mal_id) REFERENCES anime(mal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_engagement_signals_mal_id ON engagement_signals(mal_id);
  `);
}

function migrateRatingsDownReason(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(ratings)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "down_reason")) {
    db.exec(`ALTER TABLE ratings ADD COLUMN down_reason TEXT`);
  }
}

function migrateTasteNeighborsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS taste_neighbors (
      neighbor_mal_id INTEGER PRIMARY KEY,
      score REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function migrateWatchStreamsCacheTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watch_streams_cache (
      mal_id INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function migrateGenreExpansionPagesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS genre_expansion_pages (
      genre_id INTEGER PRIMARY KEY,
      next_page INTEGER NOT NULL DEFAULT 1
    );
  `);
}

function migrateWatchlistTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      mal_id INTEGER PRIMARY KEY,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (mal_id) REFERENCES anime(mal_id)
    );
  `);
}

function migrateFeaturesColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(anime)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "features_json")) {
    db.exec(`ALTER TABLE anime ADD COLUMN features_json TEXT NOT NULL DEFAULT '[]'`);
  }
}

function migrateFranchiseKeyColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(anime)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "franchise_key")) {
    db.exec(`ALTER TABLE anime ADD COLUMN franchise_key TEXT`);
  }

  // Recompute for ALL rows, not just empty ones: keys are always derived from
  // titles, so when franchiseKey() changes (e.g. the colon-subtitle fix), stale
  // stored keys must follow or franchise blocking silently misses variants.
  const rows = db
    .prepare(
      `
    SELECT mal_id, title_en, title_jp, franchise_key
    FROM anime
  `,
    )
    .all() as Array<{
    mal_id: number;
    title_en: string;
    title_jp: string;
    franchise_key: string | null;
  }>;

  const update = db.prepare("UPDATE anime SET franchise_key = ? WHERE mal_id = ?");
  const recompute = db.transaction(() => {
    for (const row of rows) {
      const key = franchiseKey(row.title_en, row.title_jp);
      if (key !== row.franchise_key) {
        update.run(key, row.mal_id);
      }
    }
  });
  recompute();

  db.exec(`CREATE INDEX IF NOT EXISTS idx_anime_franchise_key ON anime(franchise_key)`);
}

function migrateManhwaColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(anime)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("media_type")) {
    db.exec(`ALTER TABLE anime ADD COLUMN media_type TEXT NOT NULL DEFAULT 'anime'`);
  }
  if (!names.has("mangadex_id")) {
    db.exec(`ALTER TABLE anime ADD COLUMN mangadex_id TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_anime_mangadex_id ON anime(mangadex_id)`);
  }
  if (!names.has("chapter_count")) {
    db.exec(`ALTER TABLE anime ADD COLUMN chapter_count INTEGER`);
  }
}

function migrateRatingsToBinary(db: Database.Database): void {
  const tableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ratings'")
    .get() as { sql: string } | undefined;

  if (tableSql?.sql.includes("CHECK (reaction IN ('up', 'down'))")) {
    return;
  }

  db.exec(`
    CREATE TABLE ratings_binary (
      mal_id INTEGER PRIMARY KEY,
      reaction TEXT NOT NULL CHECK (reaction IN ('up', 'down')),
      rated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (mal_id) REFERENCES anime(mal_id)
    );

    INSERT INTO ratings_binary (mal_id, reaction, rated_at)
    SELECT
      mal_id,
      CASE
        WHEN reaction IN ('loved', 'liked', 'seen', 'up') THEN 'up'
        ELSE 'down'
      END,
      rated_at
    FROM ratings;

    DROP TABLE ratings;
    ALTER TABLE ratings_binary RENAME TO ratings;
  `);
}

/** Repairs binary-migrated tables that dropped rated_at DEFAULT. */
function ensureRatingsRatedAtDefault(db: Database.Database): void {
  const tableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ratings'")
    .get() as { sql: string } | undefined;

  if (!tableSql?.sql || tableSql.sql.includes("DEFAULT (datetime('now'))")) {
    return;
  }

  db.exec(`
    CREATE TABLE ratings_rated_at_fix (
      mal_id INTEGER PRIMARY KEY,
      reaction TEXT NOT NULL CHECK (reaction IN ('up', 'down')),
      rated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (mal_id) REFERENCES anime(mal_id)
    );

    INSERT INTO ratings_rated_at_fix (mal_id, reaction, rated_at)
    SELECT mal_id, reaction, rated_at FROM ratings;

    DROP TABLE ratings;
    ALTER TABLE ratings_rated_at_fix RENAME TO ratings;
  `);
}

function rowMediaType(row: AnimeRow): MediaType {
  if (
    row.media_type === "manhwa" ||
    row.media_type === "tv" ||
    row.media_type === "movie"
  ) {
    return row.media_type;
  }
  return "anime";
}

/** Top-billed names from the stored features ("main:" = lead cast for film/TV,
 *  main characters for anime). No network call: features are already on the row.
 *  MAL character names arrive "Last, First"; flip them for display. */
function castFromFeatures(featuresJson: string, limit = 3): string[] {
  return safeJsonArray(featuresJson)
    .filter((feature) => feature.startsWith("main:"))
    .slice(0, limit)
    .map((feature) => {
      const name = feature.slice(5);
      const parts = name.split(", ");
      return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
    });
}

export function rowToCard(row: AnimeRow): AnimeCard {
  const cached = cachedCardsMap.get(row.mal_id);
  if (cached) return cached;

  const card = {
    malId: row.mal_id,
    franchiseKey: keyForRow(row),
    titleEn: row.title_en,
    titleRomaji: row.title_jp,
    synopsis: row.synopsis,
    imageUrl: row.image_url,
    genres: safeJsonArray(row.genres),
    themes: safeJsonArray(row.themes),
    cast: castFromFeatures(row.features_json),
    score: row.score,
    mediaType: rowMediaType(row),
    chapterCount: row.chapter_count ?? null,
  };
  cachedCardsMap.set(row.mal_id, card);
  return card;
}

type UpsertAnimeInput = Omit<AnimeRow, "cached_at" | "franchise_key"> & {
  media_type?: MediaType;
  mangadex_id?: string | null;
  chapter_count?: number | null;
  features_json?: string;
  franchise_key?: string | null;
};

let cachedAllAnime: AnimeRow[] | undefined;
let cachedAnimeMap: Map<number, AnimeRow> | undefined;
const cachedCardsMap = new Map<number, AnimeCard>();

export function clearAnimeCache(): void {
  cachedAllAnime = undefined;
  cachedAnimeMap = undefined;
  cachedCardsMap.clear();
}

export function upsertAnime(row: UpsertAnimeInput): void {
  const db = getDb();
  const payload = {
    ...row,
    franchise_key:
      row.franchise_key?.trim() || franchiseKey(row.title_en, row.title_jp),
    media_type: row.media_type ?? "anime",
    mangadex_id: row.mangadex_id ?? null,
    chapter_count: row.chapter_count ?? null,
    features_json: row.features_json ?? "[]",
  };

  db.prepare(
    `
    INSERT INTO anime (
      mal_id, franchise_key, title_en, title_jp, synopsis, image_url,
      genres, themes, demographics, score, popularity,
      media_type, mangadex_id, chapter_count, features_json, cached_at
    ) VALUES (
      @mal_id, @franchise_key, @title_en, @title_jp, @synopsis, @image_url,
      @genres, @themes, @demographics, @score, @popularity,
      @media_type, @mangadex_id, @chapter_count, @features_json, datetime('now')
    )
    ON CONFLICT(mal_id) DO UPDATE SET
      franchise_key = excluded.franchise_key,
      title_en = excluded.title_en,
      title_jp = excluded.title_jp,
      synopsis = excluded.synopsis,
      image_url = excluded.image_url,
      genres = excluded.genres,
      themes = excluded.themes,
      demographics = excluded.demographics,
      score = excluded.score,
      popularity = excluded.popularity,
      media_type = excluded.media_type,
      mangadex_id = COALESCE(excluded.mangadex_id, anime.mangadex_id),
      chapter_count = COALESCE(excluded.chapter_count, anime.chapter_count),
      features_json = CASE
        WHEN excluded.features_json != '[]' THEN excluded.features_json
        ELSE anime.features_json
      END,
      cached_at = datetime('now')
  `,
  ).run(payload);

  clearAnimeCache();
}

/** Franchise keys the user has already rated; used to exclude duplicate picks. */
export function getRatedFranchiseKeys(): Set<string> {
  const rows = getDb()
    .prepare(
      `
    SELECT a.franchise_key, a.title_en, a.title_jp
    FROM ratings r
    JOIN anime a ON a.mal_id = r.mal_id
  `,
    )
    .all() as Array<{
    franchise_key: string | null;
    title_en: string;
    title_jp: string;
  }>;

  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(keyForRow(row));
  }
  return keys;
}

export function getUserReaction(malId: number): Reaction | null {
  const row = getDb()
    .prepare("SELECT reaction FROM ratings WHERE mal_id = ?")
    .get(malId) as { reaction: Reaction } | undefined;
  return row?.reaction ?? null;
}

export function clearAllRatings(): number {
  const result = getDb().prepare("DELETE FROM ratings").run();
  return result.changes;
}

export function getAllAnimeMap(): Map<number, AnimeRow> {
  if (!cachedAnimeMap) {
    const list = getAllAnime();
    cachedAnimeMap = new Map(list.map((row) => [row.mal_id, row]));
  }
  return cachedAnimeMap;
}

export function getAnimeById(malId: number): AnimeRow | undefined {
  return getAllAnimeMap().get(malId);
}

export function getAllAnime(): AnimeRow[] {
  if (!cachedAllAnime) {
    cachedAllAnime = getDb().prepare("SELECT * FROM anime").all() as AnimeRow[];
  }
  return cachedAllAnime;
}

export function getRatedMalIds(): Set<number> {
  const rows = getDb()
    .prepare("SELECT mal_id FROM ratings")
    .all() as Array<{ mal_id: number }>;
  return new Set(rows.map((row) => row.mal_id));
}

export function insertRatingOnDb(
  db: Database.Database,
  malId: number,
  reaction: Reaction,
  downReason: DownvoteReason | null = null,
): void {
  db.prepare(
    `
    INSERT INTO ratings (mal_id, reaction, rated_at, down_reason)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(mal_id) DO UPDATE SET
      reaction = excluded.reaction,
      rated_at = datetime('now'),
      down_reason = excluded.down_reason
  `,
  ).run(malId, reaction, downReason);
}

export function insertRating(
  malId: number,
  reaction: Reaction,
  downReason: DownvoteReason | null = null,
): void {
  const row = getAnimeById(malId);
  assertCatalogRowReady(row, malId);
  insertRatingOnDb(getDb(), malId, reaction, downReason);
}

export function insertEngagementSignal(
  malId: number,
  dwellMs: number,
  skipped: boolean,
): void {
  getDb()
    .prepare(
      `
    INSERT INTO engagement_signals (mal_id, dwell_ms, skipped)
    VALUES (?, ?, ?)
  `,
    )
    .run(malId, Math.max(0, Math.floor(dwellMs)), skipped ? 1 : 0);
}

export function getEngagementSignalsForTaste(): EngagementSignalRow[] {
  return getDb()
    .prepare(
      `
    SELECT mal_id, MAX(dwell_ms) as dwell_ms, MIN(skipped) as skipped
    FROM engagement_signals
    GROUP BY mal_id
    ORDER BY MAX(dwell_ms) DESC
    LIMIT 200
  `,
    )
    .all() as EngagementSignalRow[];
}

export function upsertTasteNeighbor(neighborMalId: number, score: number): void {
  getDb()
    .prepare(
      `
    INSERT INTO taste_neighbors (neighbor_mal_id, score, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(neighbor_mal_id) DO UPDATE SET
      score = MAX(taste_neighbors.score, excluded.score),
      updated_at = datetime('now')
  `,
    )
    .run(neighborMalId, score);
}

export function loadTasteNeighborsFromDb(): Array<{ neighborMalId: number; score: number }> {
  const rows = getDb()
    .prepare("SELECT neighbor_mal_id, score FROM taste_neighbors")
    .all() as Array<{ neighbor_mal_id: number; score: number }>;
  return rows.map((row) => ({
    neighborMalId: row.neighbor_mal_id,
    score: row.score,
  }));
}

export function clearTasteNeighborsForTests(): void {
  getDb().prepare("DELETE FROM taste_neighbors").run();
}

export function clearEngagementSignalsForTests(): void {
  getDb().prepare("DELETE FROM engagement_signals").run();
}

/** @internal Runs schema migrations on an open database (tests). */
export function migrateDatabase(db: Database.Database): void {
  migrate(db);
}

export function getRatings(): RatingRow[] {
  return getDb()
    .prepare("SELECT * FROM ratings ORDER BY rated_at DESC")
    .all() as RatingRow[];
}

export function getRatingCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM ratings")
    .get() as { count: number };
  return row.count;
}

export function getProfileHistory(): Array<AnimeCard & { reaction: Reaction; ratedAt: string }> {
  const rows = getDb()
    .prepare(
      `
    SELECT a.*, r.reaction, r.rated_at
    FROM ratings r
    JOIN anime a ON a.mal_id = r.mal_id
    ORDER BY r.rated_at DESC
    LIMIT 100
  `,
    )
    .all() as Array<AnimeRow & { reaction: Reaction; rated_at: string }>;

  return rows.map((row) => ({
    ...rowToCard(row),
    reaction: row.reaction,
    ratedAt: row.rated_at,
  }));
}

export function getWatchlistMalIds(): Set<number> {
  const rows = getDb()
    .prepare("SELECT mal_id FROM watchlist")
    .all() as Array<{ mal_id: number }>;
  return new Set(rows.map((row) => row.mal_id));
}

export function isOnWatchlist(malId: number): boolean {
  const row = getDb()
    .prepare("SELECT mal_id FROM watchlist WHERE mal_id = ?")
    .get(malId) as { mal_id: number } | undefined;
  return row !== undefined;
}

/** Franchise keys on the watchlist; excluded from Discover picks like rated titles. */
export function getWatchlistFranchiseKeys(): Set<string> {
  const rows = getDb()
    .prepare(
      `
    SELECT a.franchise_key, a.title_en, a.title_jp
    FROM watchlist w
    JOIN anime a ON a.mal_id = w.mal_id
  `,
    )
    .all() as Array<{
    franchise_key: string | null;
    title_en: string;
    title_jp: string;
  }>;

  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(keyForRow(row));
  }
  return keys;
}

export function insertWatchlistOnDb(db: Database.Database, malId: number): void {
  db.prepare(
    `
    INSERT INTO watchlist (mal_id, added_at) VALUES (?, datetime('now'))
    ON CONFLICT(mal_id) DO UPDATE SET added_at = datetime('now')
  `,
  ).run(malId);
}

export function insertWatchlist(malId: number): void {
  const row = getAnimeById(malId);
  assertCatalogRowReady(row, malId);
  insertWatchlistOnDb(getDb(), malId);
}

export function removeWatchlist(malId: number): boolean {
  const result = getDb().prepare("DELETE FROM watchlist WHERE mal_id = ?").run(malId);
  return result.changes > 0;
}

export function getWatchlist(): WatchlistEntry[] {
  const rows = getDb()
    .prepare(
      `
    SELECT a.*, w.added_at
    FROM watchlist w
    JOIN anime a ON a.mal_id = w.mal_id
    ORDER BY w.added_at DESC
  `,
    )
    .all() as Array<AnimeRow & { added_at: string }>;

  return rows.map((row) => ({
    ...rowToCard(row),
    addedAt: row.added_at,
  }));
}

export function getReactionCounts(): Record<Reaction, number> {
  const reactions: Reaction[] = ["up", "down"];
  const counts = Object.fromEntries(reactions.map((r) => [r, 0])) as Record<Reaction, number>;

  const rows = getDb()
    .prepare("SELECT reaction, COUNT(*) as count FROM ratings GROUP BY reaction")
    .all() as Array<{ reaction: Reaction; count: number }>;

  for (const row of rows) {
    counts[row.reaction] = row.count;
  }

  return counts;
}

export function getWatchStreamsFromDb(malId: number): any | null {
  const row = getDb()
    .prepare("SELECT payload_json FROM watch_streams_cache WHERE mal_id = ?")
    .get(malId) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

export function insertWatchStreamsIntoDb(malId: number, payload: any): void {
  getDb()
    .prepare(
      `
      INSERT INTO watch_streams_cache (mal_id, payload_json, cached_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(mal_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        cached_at = datetime('now')
    `,
    )
    .run(malId, JSON.stringify(payload));
}

export function getGenreNextPage(genreId: number): number {
  const row = getDb()
    .prepare("SELECT next_page FROM genre_expansion_pages WHERE genre_id = ?")
    .get(genreId) as { next_page: number } | undefined;
  return row?.next_page ?? 1;
}

export function incrementGenrePage(genreId: number): void {
  getDb()
    .prepare(
      `
      INSERT INTO genre_expansion_pages (genre_id, next_page)
      VALUES (?, 2)
      ON CONFLICT(genre_id) DO UPDATE SET next_page = genre_expansion_pages.next_page + 1
    `,
    )
    .run(genreId);
}

export function getExpandedPersonIds(): Set<number> {
  const rows = getDb()
    .prepare("SELECT person_id FROM tmdb_person_expansion")
    .all() as Array<{ person_id: number }>;
  return new Set(rows.map((row) => row.person_id));
}

export function markPersonExpanded(personId: number, name: string): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO tmdb_person_expansion (person_id, name) VALUES (?, ?)",
    )
    .run(personId, name);
}

export interface TasteComboRow {
  combo_key: string;
  features_json: string;
  status: "confirmed" | "rejected";
}

export function getTasteComboRows(): TasteComboRow[] {
  return getDb()
    .prepare("SELECT combo_key, features_json, status FROM taste_combos")
    .all() as TasteComboRow[];
}

export function setTasteComboStatus(
  comboKey: string,
  features: string[],
  status: "confirmed" | "rejected",
): void {
  getDb()
    .prepare(
      `
      INSERT INTO taste_combos (combo_key, features_json, status, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(combo_key) DO UPDATE SET
        status = excluded.status,
        updated_at = datetime('now')
    `,
    )
    .run(comboKey, JSON.stringify(features), status);
}

/** Titles skipped ("don't know it") within the cooldown window. Persisted in
 *  engagement_signals, so the cooldown survives server restarts. */
export function getRecentlySkippedMalIds(days = 7): Set<number> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT mal_id FROM engagement_signals
       WHERE skipped = 1 AND created_at >= datetime('now', ?)`,
    )
    .all(`-${days} days`) as Array<{ mal_id: number }>;
  return new Set(rows.map((row) => row.mal_id));
}

export function getCreditScannedMalIds(): Set<number> {
  const rows = getDb()
    .prepare("SELECT mal_id FROM tmdb_credit_scans")
    .all() as Array<{ mal_id: number }>;
  return new Set(rows.map((row) => row.mal_id));
}

export function markCreditScanned(malId: number): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO tmdb_credit_scans (mal_id) VALUES (?)")
    .run(malId);
}

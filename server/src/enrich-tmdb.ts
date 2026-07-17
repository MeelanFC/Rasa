/**
 * CLI: backfill TMDB rich-detail enrichment for rated + watchlisted titles.
 * Usage: npx tsx --env-file=.env src/enrich-tmdb.ts
 */
import { getDb } from "./db.js";
import {
  ensureTmdbTasteEnriched,
  isTmdbTasteEnriched,
} from "./enrichment.js";
import { hasTmdbCredentials, isTmdbId } from "./tmdb.js";

const GAP_MS = 350;

async function main(): Promise<void> {
  if (!hasTmdbCredentials()) {
    console.error("[enrich-tmdb] TMDB_READ_TOKEN or TMDB_API_KEY required");
    process.exit(1);
  }
  const db = getDb();
  const rated = db.prepare("SELECT mal_id FROM ratings").all() as { mal_id: number }[];
  const watch = db.prepare("SELECT mal_id FROM watchlist").all() as { mal_id: number }[];
  const all = new Set<number>([...rated.map((r) => r.mal_id), ...watch.map((r) => r.mal_id)]);
  const tmdb = [...all].filter(isTmdbId);
  const targets: number[] = [];
  for (const id of tmdb) {
    const row = db.prepare("SELECT features_json FROM anime WHERE mal_id=?").get(id) as { features_json: string } | undefined;
    if (!row || !isTmdbTasteEnriched(row.features_json)) targets.push(id);
  }
  console.log(`[enrich-tmdb] ${targets.length} TMDB titles need enrichment (of ${tmdb.length} rated+watchlisted)`);
  let ok = 0;
  let fail = 0;
  for (const [i, id] of targets.entries()) {
    try {
      await ensureTmdbTasteEnriched(id);
      ok++;
    } catch (err) {
      fail++;
      console.warn(`[enrich-tmdb] ${id} failed:`, err instanceof Error ? err.message : err);
    }
    if (i % 10 === 9) console.log(`  ${i + 1}/${targets.length} processed (ok=${ok} fail=${fail})`);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  console.log(`[enrich-tmdb] done. ok=${ok} fail=${fail}`);
  process.exit(0);
}

void main();

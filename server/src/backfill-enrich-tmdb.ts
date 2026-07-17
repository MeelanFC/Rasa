/**
 * One-shot backfill: enrich every shallow (discover-grade) TMDB row with full
 * credits so candidates carry director:/writer:/main: features - closing the
 * train/serve gap where rated rows were enriched but the recommendable pool
 * was not. Run: npx tsx --env-file=.env src/backfill-enrich-tmdb.ts
 */
import { getAllAnime } from "./db.js";
import { ensureTmdbTasteEnriched, isTmdbTasteEnriched } from "./enrichment.js";
import { invalidateFeatureCorpusCache } from "./service.js";

async function main(): Promise<void> {
  const shallow = getAllAnime().filter(
    (row) =>
      (row.media_type === "tv" || row.media_type === "movie") &&
      !isTmdbTasteEnriched(row.features_json),
  );
  console.log(`[enrich-backfill] ${shallow.length} shallow TMDB rows to enrich`);

  let done = 0;
  let failed = 0;
  for (const row of shallow) {
    try {
      await ensureTmdbTasteEnriched(row.mal_id);
      done += 1;
    } catch (error) {
      failed += 1;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[enrich-backfill] failed ${row.title_en}: ${msg}`);
      if (failed > 50) {
        console.error("[enrich-backfill] too many failures, stopping");
        break;
      }
    }
    if (done % 100 === 0 && done > 0) {
      console.log(`[enrich-backfill] ${done}/${shallow.length} enriched...`);
    }
  }
  invalidateFeatureCorpusCache();
  console.log(`[enrich-backfill] DONE: ${done} enriched, ${failed} failed`);
}

void main();

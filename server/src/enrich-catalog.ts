/**
 * CLI: re-enrich catalog rows missing meta:taste_enriched or sparse features.
 * Usage: npm run enrich-catalog -w server
 */
import { getAllAnime } from "./db.js";
import { isTasteEnriched, scheduleBulkTasteEnrichment } from "./enrichment.js";

const maxTitles = Number(process.env.ENRICH_MAX ?? "0");

function main(): void {
  const pending = getAllAnime().filter((row) => !isTasteEnriched(row.features_json));
  const limit = maxTitles > 0 ? maxTitles : pending.length;

  console.log(
    `[enrich-catalog] ${pending.length} titles need enrichment; processing up to ${limit}`,
  );

  scheduleBulkTasteEnrichment({ maxTitles: limit });

  const waitMs = Math.max(30_000, limit * 3_000);
  setTimeout(() => {
    const remaining = getAllAnime().filter((row) => !isTasteEnriched(row.features_json));
    console.log(`[enrich-catalog] done (or timed out). ${remaining.length} still pending.`);
    process.exit(0);
  }, waitMs);
}

main();

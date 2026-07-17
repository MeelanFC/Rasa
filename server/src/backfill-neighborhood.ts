/**
 * One-shot backfill: repeatedly runs the (normally background, small-budget)
 * taste-neighborhood expansion until every liked film/TV title has been
 * credit-scanned. Run: npx tsx --env-file=.env src/backfill-neighborhood.ts
 */
import { runTasteNeighborhoodExpansion } from "./service.js";

async function main(): Promise<void> {
  let titles = 0;
  let persons = 0;
  let rows = 0;
  for (let round = 1; round <= 15; round++) {
    const s = await runTasteNeighborhoodExpansion({ maxTitles: 5, maxPersons: 10 });
    titles += s.titlesScanned;
    persons += s.personsExpanded;
    rows += s.rowsIngested;
    console.log(
      `[backfill] round ${round}: scanned ${s.titlesScanned} titles, expanded ${s.personsExpanded} persons, ingested ${s.rowsIngested} rows`,
    );
    if (s.titlesScanned === 0 && s.personsExpanded === 0) break;
  }
  console.log(`[backfill] TOTAL: ${titles} titles scanned, ${persons} persons expanded, ${rows} rows ingested`);
}

void main();

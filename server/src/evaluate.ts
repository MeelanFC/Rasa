/**
 * Offline Profile-recommendation evaluation harness. READ-ONLY on the database.
 *
 * Evaluates the PRODUCTION ranker: the learned logistic-regression taste model
 * (taste-model.ts), built from the same swipes service.ts getTasteModel() uses:
 * votes (liked = 1, pass / dropped = 0) AND would-watch saves (1, weighted
 * WATCHLIST_EXAMPLE_WEIGHT). Trains on the EARLIER swipes, holds out the LATER
 * ones, ranks the whole unrated+held-out pool, and measures whether held-out
 * positives (likes and saves) rank above held-out passes.
 *
 * (History: until 2026-07-16 this file evaluated the old cosine ranker, which
 * production had already replaced - the harness was measuring a retired engine.
 * Until 2026-10-05 it trained on votes alone; production now also learns from
 * would-watch saves, so the harness does too.)
 *
 * Run:  npx tsx src/evaluate.ts            (default: hold out last 19 swipes)
 *       HOLDOUT=80 npx tsx src/evaluate.ts
 */
import { getDb } from "./db.js";
import { featuresFromJson } from "./features.js";
import { scoringFeatures } from "./feature-category.js";
import { parseFeatureTags } from "./recommendation.js";
import { keyForRow } from "./franchise.js";
import {
  hasEnoughOfEachClass,
  MIN_EXAMPLES_PER_CLASS,
  modelFeatures,
  tasteExampleLabel,
  tasteExampleWeight,
  trainTasteModel,
  type TasteExample,
  type TasteSignal,
} from "./taste-model.js";
import { expectedCalibrationError, calibrationTable } from "./calibration.js";

interface Row {
  mal_id: number; title_en: string; title_jp: string; synopsis: string;
  genres: string; themes: string; demographics: string;
  features_json: string; franchise_key: string | null; popularity: number; media_type: string;
}
interface Rating { mal_id: number; reaction: "up" | "down"; rated_at: string; down_reason: string | null }
interface Save { mal_id: number; added_at: string }
interface Signal extends TasteSignal { malId: number }

// Mirror of service.ts rowFeatures(): prefer stored scoring features, else derive from genres.
function rowFeatures(row: Row): string[] {
  const scoring = scoringFeatures(featuresFromJson(row.features_json));
  if (scoring.length > 0) return scoring;
  return parseFeatureTags(row.genres, row.themes, row.demographics).map((t) =>
    t.startsWith("genre:") ? t : `genre:${t}`,
  );
}

const db = getDb();
const catalog = db.prepare(
  "SELECT mal_id,title_en,title_jp,synopsis,genres,themes,demographics,features_json,franchise_key,popularity,media_type FROM anime",
).all() as Row[];
const ratings = db.prepare(
  "SELECT mal_id,reaction,rated_at,down_reason FROM ratings",
).all() as Rating[];
const saves = db.prepare("SELECT mal_id, added_at FROM watchlist").all() as Save[];

const byId = new Map(catalog.map((r) => [r.mal_id, r]));
const featuresById = new Map(catalog.map((r) => [r.mal_id, rowFeatures(r)]));
const fkById = new Map(catalog.map((r) => [r.mal_id, r.franchise_key?.trim() || keyForRow(r)]));

// --- One chronological stream of swipes, exactly what production trains on ---
const ratedIds = new Set(ratings.map((r) => r.mal_id));
const signals: Signal[] = [
  ...ratings.map((r): Signal => ({ malId: r.mal_id, kind: r.reaction, at: r.rated_at })),
  // A title rated while still saved counts once, as the vote (same rule as service.ts).
  ...saves
    .filter((s) => !ratedIds.has(s.mal_id))
    .map((s): Signal => ({ malId: s.mal_id, kind: "save", at: s.added_at })),
].sort((a, b) => a.at.localeCompare(b.at));

// --- Chronological split: train on earlier swipes, hold out the later ones ---
const HOLDOUT = Number(process.env.HOLDOUT ?? 19);
const split = Math.max(0, signals.length - HOLDOUT);
const train = signals.slice(0, split);
const test = signals.slice(split);

const trainMalIds = new Set(train.map((s) => s.malId));
const trainFranchises = new Set(
  train.map((s) => fkById.get(s.malId)).filter((k): k is string => !!k),
);
const testPositive = new Set(test.filter((s) => s.kind !== "down").map((s) => s.malId));
const testDown = new Set(test.filter((s) => s.kind === "down").map((s) => s.malId));
const count = (list: Signal[], kind: Signal["kind"]) => list.filter((s) => s.kind === kind).length;

// --- Train the PRODUCTION model on train swipes only (same inputs service.ts uses) ---
const examples: TasteExample[] = train
  .map((s): TasteExample | null => {
    const row = byId.get(s.malId);
    if (!row) return null;
    return {
      features: featuresById.get(s.malId)!,
      synopsis: row.synopsis,
      label: tasteExampleLabel(s.kind),
      weight: tasteExampleWeight(s),
    };
  })
  .filter((x): x is TasteExample => x !== null);

const corpus = catalog.map((r) => modelFeatures(featuresById.get(r.mal_id)!, r.synopsis));
const model = trainTasteModel(examples, corpus);

// --- Rank every candidate (catalog minus trained ids) by P(like) ---
const scored = catalog
  .filter((r) => !trainMalIds.has(r.mal_id))
  .map((r) => ({
    malId: r.mal_id, title: r.title_en, mediaType: r.media_type, fk: fkById.get(r.mal_id)!,
    p: model.predict(featuresById.get(r.mal_id)!, r.synopsis),
  }))
  .sort((a, b) => b.p - a.p);

const N = scored.length;
const rankOf = new Map(scored.map((s, i) => [s.malId, i + 1]));
const top10 = scored.slice(0, 10);

// --- Metrics (relevant = held-out LIKES and SAVES) ---
const hitsTop10 = top10.filter((s) => testPositive.has(s.malId)).length;
const precision10 = hitsTop10 / 10;
const recall10 = testPositive.size > 0 ? hitsTop10 / testPositive.size : NaN;
const dcg = top10.reduce((acc, s, i) => acc + (testPositive.has(s.malId) ? 1 : 0) / Math.log2(i + 2), 0);
let idcg = 0;
for (let i = 0; i < Math.min(testPositive.size, 10); i++) idcg += 1 / Math.log2(i + 2);
const ndcg10 = idcg > 0 ? dcg / idcg : NaN;
let mrr = 0;
for (const s of scored) if (testPositive.has(s.malId)) { mrr = 1 / rankOf.get(s.malId)!; break; }
const downExposure10 = top10.filter((s) => testDown.has(s.malId)).length / 10;
const franchiseLeak10 = top10.filter((s) => trainFranchises.has(s.fk)).length / 10;

// Popularity baseline ("better than random?"). Raw popularity is a MAL rank for
// anime, so this baseline is only meaningful for a film/TV-heavy catalog.
const popP10 =
  [...scored].sort((a, b) => byId.get(b.malId)!.popularity - byId.get(a.malId)!.popularity)
    .slice(0, 10).filter((s) => testPositive.has(s.malId)).length / 10;

const fmt = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
console.log("========= OFFLINE PROFILE EVALUATION (production logreg model) =========");
console.log(
  `swipes=${signals.length} (${count(signals, "up")} liked / ${count(signals, "save")} saved / ${count(signals, "down")} passed)` +
  `  train=${train.length}  holdout=${test.length} (${testPositive.size} positive / ${testDown.size} passed)`,
);
console.log(`candidate pool=${N}  (catalog ${catalog.length} - trained ${trainMalIds.size})  model dim=${model.dimension}`);
if (!hasEnoughOfEachClass(examples)) {
  console.log(
    `note: fewer than ${MIN_EXAMPLES_PER_CLASS} training examples in one class; production would rank with the cosine ranker here, not this model.`,
  );
}
console.log("");
console.log("--- Metrics @10 (relevant = held-out LIKES and SAVES) ---");
console.log(`Precision@10:          ${fmt(precision10)}   (popularity baseline ${fmt(popP10)})`);
console.log(`Recall@10:             ${fmt(recall10)}`);
console.log(`NDCG@10:               ${fmt(ndcg10)}`);
console.log(`MRR:                   ${mrr.toFixed(4)}   ${mrr > 0 ? `(first held-out positive at rank ${Math.round(1 / mrr)})` : "(no held-out positive ranked)"}`);
console.log(`Passed exposure@10:    ${fmt(downExposure10)}   (held-out PASSES in top 10 - lower is better)`);
console.log(`Franchise leakage@10:  ${fmt(franchiseLeak10)}   (top 10 sharing a franchise with a trained title)`);
console.log("");
console.log(`--- Where each held-out swipe landed (of ${N}) ---`);
const kindLabel: Record<Signal["kind"], string> = { up: "LIKE   ", save: "SAVE   ", down: "pass   " };
for (const s of test) {
  const rk = rankOf.get(s.malId);
  const title = byId.get(s.malId)?.title_en ?? `#${s.malId}`;
  const pct = rk ? Math.round((1 - (rk - 1) / N) * 100) : 0;
  console.log(`  [${kindLabel[s.kind]}] ${title}: ${rk ? `#${rk}/${N} (top ${pct}%)` : "(not in pool)"}`);
}

// Calibration: the model's P(like) vs empirical positive rate on held-out swipes.
const calibrationItems: Array<{ score: number; label: 0 | 1 }> = [];
for (const s of scored) {
  if (testPositive.has(s.malId)) calibrationItems.push({ score: s.p, label: 1 });
  else if (testDown.has(s.malId)) calibrationItems.push({ score: s.p, label: 0 });
}
const ece = expectedCalibrationError(calibrationItems);
console.log("");
console.log("--- Calibration (held-out swipes only) ---");
console.log(`Expected Calibration Error: ${ece.toFixed(3)}   (closer to 0 = scores match reality)`);
console.log("bin   n   avg_score   empirical_positive_rate");
for (const row of calibrationTable(calibrationItems)) {
  if (row.n === 0) continue;
  console.log(`${String(row.bin).padStart(3)}  ${String(row.n).padStart(3)}     ${row.avgScore.toFixed(3)}            ${row.empirical.toFixed(3)}`);
}

console.log("");
console.log("--- Top 10 ranked candidates ---");
top10.forEach((s, i) => {
  const tag = testPositive.has(s.malId) ? "  <== held-out positive" : testDown.has(s.malId) ? "  <== held-out pass" : "";
  const row = byId.get(s.malId)!;
  const why = model.topContributors(featuresById.get(s.malId)!, row.synopsis, 4).join(", ");
  console.log(`#${String(i + 1).padStart(2)} ${s.title} (${s.mediaType})  p=${s.p.toFixed(3)}${tag}`);
  console.log(`     why: [${why || "none"}]`);
});

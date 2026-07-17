/**
 * Offline Profile-recommendation evaluation harness. READ-ONLY on the database.
 *
 * Evaluates the PRODUCTION ranker: the learned logistic-regression taste model
 * (taste-model.ts), exactly as service.ts getTasteModel()/scoreCandidatesWithModel
 * use it. Trains on the EARLIER votes, holds out the LATER votes, ranks the whole
 * unrated+held-out pool, and measures whether held-out LIKES rank above DISLIKES.
 *
 * (History: until 2026-07-16 this file evaluated the old cosine ranker, which
 * production had already replaced - the harness was measuring a retired engine.)
 *
 * Run:  npx tsx src/evaluate.ts            (default: hold out last 19 votes)
 *       HOLDOUT=80 npx tsx src/evaluate.ts
 */
import { getDb } from "./db.js";
import { featuresFromJson } from "./features.js";
import { scoringFeatures } from "./feature-category.js";
import { parseFeatureTags } from "./recommendation.js";
import { keyForRow } from "./franchise.js";
import { trainTasteModel, modelFeatures, type TasteExample } from "./taste-model.js";
import { expectedCalibrationError, calibrationTable } from "./calibration.js";

interface Row {
  mal_id: number; title_en: string; title_jp: string; synopsis: string;
  genres: string; themes: string; demographics: string;
  features_json: string; franchise_key: string | null; popularity: number; media_type: string;
}
interface Rating { mal_id: number; reaction: "up" | "down"; rated_at: string; down_reason: string | null }

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
  "SELECT mal_id,reaction,rated_at,down_reason FROM ratings ORDER BY rated_at ASC",
).all() as Rating[];

const byId = new Map(catalog.map((r) => [r.mal_id, r]));
const featuresById = new Map(catalog.map((r) => [r.mal_id, rowFeatures(r)]));
const fkById = new Map(catalog.map((r) => [r.mal_id, r.franchise_key?.trim() || keyForRow(r)]));

// --- Chronological split: train on earlier votes, hold out the later ones ---
const HOLDOUT = Number(process.env.HOLDOUT ?? 19);
const split = Math.max(0, ratings.length - HOLDOUT);
const train = ratings.slice(0, split);
const test = ratings.slice(split);

const trainMalIds = new Set(train.map((r) => r.mal_id));
const trainFranchises = new Set(
  train.map((r) => fkById.get(r.mal_id)).filter((k): k is string => !!k),
);
const testUp = new Set(test.filter((r) => r.reaction === "up").map((r) => r.mal_id));
const testDown = new Set(test.filter((r) => r.reaction === "down").map((r) => r.mal_id));

// --- Train the PRODUCTION model on train votes only (same inputs service.ts uses) ---
const examples: TasteExample[] = train
  .map((r) => {
    const row = byId.get(r.mal_id);
    if (!row) return null;
    return {
      features: featuresById.get(r.mal_id)!,
      synopsis: row.synopsis,
      label: (r.reaction === "up" ? 1 : 0) as 0 | 1,
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

// --- Metrics (relevant = held-out UPVOTES) ---
const hitsTop10 = top10.filter((s) => testUp.has(s.malId)).length;
const precision10 = hitsTop10 / 10;
const recall10 = testUp.size > 0 ? hitsTop10 / testUp.size : NaN;
const dcg = top10.reduce((acc, s, i) => acc + (testUp.has(s.malId) ? 1 : 0) / Math.log2(i + 2), 0);
let idcg = 0;
for (let i = 0; i < Math.min(testUp.size, 10); i++) idcg += 1 / Math.log2(i + 2);
const ndcg10 = idcg > 0 ? dcg / idcg : NaN;
let mrr = 0;
for (const s of scored) if (testUp.has(s.malId)) { mrr = 1 / rankOf.get(s.malId)!; break; }
const downExposure10 = top10.filter((s) => testDown.has(s.malId)).length / 10;
const franchiseLeak10 = top10.filter((s) => trainFranchises.has(s.fk)).length / 10;

// Popularity baseline ("better than random?")
const popP10 =
  [...scored].sort((a, b) => byId.get(b.malId)!.popularity - byId.get(a.malId)!.popularity)
    .slice(0, 10).filter((s) => testUp.has(s.malId)).length / 10;

const fmt = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
console.log("========= OFFLINE PROFILE EVALUATION (production logreg model) =========");
console.log(`votes=${ratings.length}  train=${train.length}  holdout=${test.length} (${testUp.size} up / ${testDown.size} down)`);
console.log(`candidate pool=${N}  (catalog ${catalog.length} - trained ${trainMalIds.size})  model dim=${model.dimension}`);
console.log("");
console.log("--- Metrics @10 (relevant = held-out LIKES) ---");
console.log(`Precision@10:          ${fmt(precision10)}   (popularity baseline ${fmt(popP10)})`);
console.log(`Recall@10:             ${fmt(recall10)}`);
console.log(`NDCG@10:               ${fmt(ndcg10)}`);
console.log(`MRR:                   ${mrr.toFixed(4)}   ${mrr > 0 ? `(first held-out like at rank ${Math.round(1 / mrr)})` : "(no held-out like ranked)"}`);
console.log(`Downvoted exposure@10: ${fmt(downExposure10)}   (held-out DISLIKES in top 10 - lower is better)`);
console.log(`Franchise leakage@10:  ${fmt(franchiseLeak10)}   (top 10 sharing a franchise with a trained title)`);
console.log("");
console.log(`--- Where each held-out vote landed (of ${N}) ---`);
for (const r of test) {
  const rk = rankOf.get(r.mal_id);
  const title = byId.get(r.mal_id)?.title_en ?? `#${r.mal_id}`;
  const pct = rk ? Math.round((1 - (rk - 1) / N) * 100) : 0;
  console.log(`  [${r.reaction === "up" ? "LIKE   " : "dislike"}] ${title}: ${rk ? `#${rk}/${N} (top ${pct}%)` : "(not in pool)"}`);
}

// Calibration: the model's P(like) vs empirical like rate on held-out votes.
const calibrationItems: Array<{ score: number; label: 0 | 1 }> = [];
for (const s of scored) {
  if (testUp.has(s.malId)) calibrationItems.push({ score: s.p, label: 1 });
  else if (testDown.has(s.malId)) calibrationItems.push({ score: s.p, label: 0 });
}
const ece = expectedCalibrationError(calibrationItems);
console.log("");
console.log("--- Calibration (held-out votes only) ---");
console.log(`Expected Calibration Error: ${ece.toFixed(3)}   (closer to 0 = scores match reality)`);
console.log("bin   n   avg_score   empirical_like_rate");
for (const row of calibrationTable(calibrationItems)) {
  if (row.n === 0) continue;
  console.log(`${String(row.bin).padStart(3)}  ${String(row.n).padStart(3)}     ${row.avgScore.toFixed(3)}            ${row.empirical.toFixed(3)}`);
}

console.log("");
console.log("--- Top 10 ranked candidates ---");
top10.forEach((s, i) => {
  const tag = testUp.has(s.malId) ? "  <== held-out LIKE" : testDown.has(s.malId) ? "  <== held-out dislike" : "";
  const row = byId.get(s.malId)!;
  const why = model.topContributors(featuresById.get(s.malId)!, row.synopsis, 4).join(", ");
  console.log(`#${String(i + 1).padStart(2)} ${s.title} (${s.mediaType})  p=${s.p.toFixed(3)}${tag}`);
  console.log(`     why: [${why || "none"}]`);
});

/**
 * OFFLINE EXPERIMENT: learn a taste model from the user's own ratings instead of
 * hand-tuned cosine. Features = existing tags + synopsis content tokens.
 * Model = L2-regularized logistic regression with class balancing.
 * Read-only on the DB. Run: npx tsx --env-file=.env src/taste-model-experiment.ts
 */
import { getDb } from "./db.js";
import { featuresFromJson } from "./features.js";
import { scoringFeatures } from "./feature-category.js";
import { parseFeatureTags } from "./recommendation.js";
import { tokenizeSynopsis } from "./synopsis-tokens.js";
import { keyForRow } from "./franchise.js";

interface Row {
  mal_id: number; title_en: string; synopsis: string;
  genres: string; themes: string; demographics: string;
  features_json: string; franchise_key: string | null; popularity: number; media_type: string;
}
interface Rating { mal_id: number; reaction: "up" | "down"; rated_at: string }

function titleFeatures(row: Row): string[] {
  const tags = scoringFeatures(featuresFromJson(row.features_json));
  const base = tags.length > 0 ? tags : parseFeatureTags(row.genres, row.themes, row.demographics).map((t) => (t.startsWith("genre:") ? t : `genre:${t}`));
  const syn = tokenizeSynopsis(row.synopsis).map((t) => `syn:${t}`);
  return [...new Set([...base, ...syn])];
}

const db = getDb();
const catalog = db.prepare(
  "SELECT mal_id,title_en,synopsis,genres,themes,demographics,features_json,franchise_key,popularity,media_type FROM anime",
).all() as Row[];
const ratings = (db.prepare("SELECT mal_id,reaction,rated_at FROM ratings ORDER BY rated_at ASC").all() as Rating[]);

const byId = new Map(catalog.map((r) => [r.mal_id, r]));
const featById = new Map(catalog.map((r) => [r.mal_id, titleFeatures(r)]));
const fkById = new Map(catalog.map((r) => [r.mal_id, r.franchise_key?.trim() || keyForRow(r)]));

// ---- Vocabulary: keep features seen in >= MIN_DF catalog titles (cuts overfit + noise) ----
const MIN_DF = 4;
const df = new Map<string, number>();
for (const r of catalog) for (const f of featById.get(r.mal_id)!) df.set(f, (df.get(f) ?? 0) + 1);
const vocab = [...df.entries()].filter(([, c]) => c >= MIN_DF).map(([f]) => f);
const idx = new Map(vocab.map((f, i) => [f, i]));
const D = vocab.length;
const activeIdx = (malId: number): number[] => {
  const out: number[] = [];
  for (const f of featById.get(malId)!) { const i = idx.get(f); if (i !== undefined) out.push(i); }
  return out;
};

// ---- Train/test split: train on earlier votes, hold out the last N ----
const HOLDOUT = Number(process.env.HOLDOUT ?? 80);
const split = Math.max(0, ratings.length - HOLDOUT);
const train = ratings.slice(0, split);
const test = ratings.slice(split);
const trainIds = new Set(train.map((r) => r.mal_id));

// ---- Logistic regression (batch GD, L2, class-balanced) ----
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
function trainLR(examples: { ids: number[]; y: number }[], lambda = 2.0, lr = 0.5, epochs = 400) {
  const w = new Float64Array(D);
  let b = 0;
  const nPos = examples.filter((e) => e.y === 1).length || 1;
  const nNeg = examples.filter((e) => e.y === 0).length || 1;
  const wPos = examples.length / (2 * nPos);
  const wNeg = examples.length / (2 * nNeg);
  for (let ep = 0; ep < epochs; ep++) {
    const grad = new Float64Array(D);
    let gb = 0;
    for (const e of examples) {
      let z = b; for (const j of e.ids) z += w[j]!;
      const p = sigmoid(z);
      const cw = e.y === 1 ? wPos : wNeg;
      const err = (p - e.y) * cw;
      for (const j of e.ids) grad[j]! += err;
      gb += err;
    }
    const n = examples.length;
    for (let j = 0; j < D; j++) w[j]! -= lr * (grad[j]! / n + lambda * w[j]! / n);
    b -= lr * gb / n;
  }
  return { w, b };
}

const examples = train
  .filter((r) => byId.has(r.mal_id))
  .map((r) => ({ ids: activeIdx(r.mal_id), y: r.reaction === "up" ? 1 : 0 }));
const { w, b } = trainLR(examples);
const pLike = (malId: number): number => { let z = b; for (const j of activeIdx(malId)) z += w[j]!; return sigmoid(z); };

// ---- Rank full catalog (minus trained ids) ----
const ranked = catalog
  .filter((r) => !trainIds.has(r.mal_id))
  .map((r) => ({ malId: r.mal_id, title: r.title_en, mt: r.media_type, fk: fkById.get(r.mal_id)!, p: pLike(r.mal_id) }))
  .sort((a, b2) => b2.p - a.p);

const testUp = new Set(test.filter((r) => r.reaction === "up").map((r) => r.mal_id));
const testDown = new Set(test.filter((r) => r.reaction === "down").map((r) => r.mal_id));
const top10 = ranked.slice(0, 10);
const hits = top10.filter((s) => testUp.has(s.malId)).length;
const dcg = top10.reduce((a, s, i) => a + (testUp.has(s.malId) ? 1 / Math.log2(i + 2) : 0), 0);
let idcg = 0; for (let i = 0; i < Math.min(testUp.size, 10); i++) idcg += 1 / Math.log2(i + 2);
const rankOf = new Map(ranked.map((s, i) => [s.malId, i + 1]));
let mrr = 0; for (const s of ranked) if (testUp.has(s.malId)) { mrr = 1 / rankOf.get(s.malId)!; break; }

// Calibration on held-out
const bins = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, sumY: 0 }));
let ece = 0, nCal = 0;
for (const r of test) {
  if (!testUp.has(r.mal_id) && !testDown.has(r.mal_id)) continue;
  const p = pLike(r.mal_id); const y = testUp.has(r.mal_id) ? 1 : 0;
  const bi = Math.min(9, Math.floor(p * 10)); bins[bi]!.n++; bins[bi]!.sumP += p; bins[bi]!.sumY += y; nCal++;
}
for (const bn of bins) if (bn.n) ece += (bn.n / nCal) * Math.abs(bn.sumP / bn.n - bn.sumY / bn.n);

console.log(`================ LEARNED TASTE MODEL (logreg on tags+synopsis) ================`);
console.log(`features=${D}  train=${train.length}  holdout=${test.length} (${testUp.size} up/${testDown.size} down)`);
console.log(`Precision@10: ${(hits / 10).toFixed(3)}   NDCG@10: ${(idcg > 0 ? dcg / idcg : 0).toFixed(3)}   MRR: ${mrr.toFixed(3)}   ECE: ${ece.toFixed(3)}`);
console.log(`Downvoted in top10: ${top10.filter((s) => testDown.has(s.malId)).length}`);
console.log(`\n--- where held-out votes landed ---`);
for (const r of test) {
  const rk = rankOf.get(r.mal_id); const t = byId.get(r.mal_id)?.title_en ?? r.mal_id;
  console.log(`  [${r.reaction === "up" ? "LIKE   " : "dislike"}] ${t}: ${rk ? `#${rk}/${ranked.length}` : "n/a"}  p=${pLike(r.mal_id).toFixed(2)}`);
}
console.log(`\n--- TOP 15 PICKS (full profile, trained on ALL ratings) ---`);
const exAll = ratings.filter((r) => byId.has(r.mal_id)).map((r) => ({ ids: activeIdx(r.mal_id), y: r.reaction === "up" ? 1 : 0 }));
const full = trainLR(exAll);
const pLikeFull = (malId: number) => { let z = full.b; for (const j of activeIdx(malId)) z += full.w[j]!; return sigmoid(z); };
const allRatedIds = new Set(ratings.map((r) => r.mal_id));
const finalRanked = catalog.filter((r) => !allRatedIds.has(r.mal_id)).map((r) => ({ t: r.title_en, mt: r.media_type, p: pLikeFull(r.mal_id) })).sort((a, b2) => b2.p - a.p);
for (const s of finalRanked.slice(0, 15)) console.log(`  ${(s.p * 100).toFixed(0).padStart(3)}%  [${s.mt}]  ${s.t}`);
const asobiRank = finalRanked.findIndex((s) => s.t.toLowerCase().includes("asobi asobase"));
console.log(`\nAsobi Asobase now ranks: #${asobiRank + 1} of ${finalRanked.length}  (p=${(finalRanked[asobiRank]?.p ?? 0).toFixed(2)})`);
const films = finalRanked.slice(0, 20).filter((s) => s.mt === "movie" || s.mt === "tv").length;
console.log(`Films/TV in top 20: ${films}`);

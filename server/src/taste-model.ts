/**
 * Learned taste model: an L2-regularized logistic regression trained on the
 * user's own up/down votes, over tag features + synopsis content tokens.
 *
 * Replaces hand-tuned cosine for warm-profile ranking. Because it learns weights
 * from the user's actual labels and reads what a title is *about* (synopsis), it
 * captures nuance the fixed tag vocabulary cannot - e.g. "dislikes mecha, but
 * likes Code Geass". Its output is a calibrated P(like), so the displayed match
 * percent finally means "chance you'll enjoy this", not a relative cosine.
 */
import { scoringFeatures } from "./feature-category.js";
import { featuresFromJson } from "./features.js";
import { tokenizeSynopsis } from "./synopsis-tokens.js";

export interface TasteExample {
  features: string[]; // raw scoring tag features (from features_json)
  synopsis: string;
  label: 0 | 1; // 1 = liked, 0 = disliked
  /** Sample weight in (0,1]; default 1. Used to discount ambiguous labels
   *  (e.g. downvotes cast before "down" meant "watched and disliked"). */
  weight?: number;
}

export interface TasteModel {
  /** P(user likes) in [0,1] for a candidate's tag features + synopsis. */
  predict(features: string[], synopsis: string): number;
  /** The candidate's own features that most push its score UP, strongest first.
   *  Synopsis tokens (syn:*) are excluded so callers get displayable tags. */
  topContributors(features: string[], synopsis: string, k: number): string[];
  /** Number of features in the trained vocabulary (observability). */
  readonly dimension: number;
}

export interface TasteModelOptions {
  minDocFrequency?: number;
  lambda?: number;
  learningRate?: number;
  epochs?: number;
}

const DEFAULTS = { minDocFrequency: 4, lambda: 2.0, learningRate: 0.5, epochs: 400 };

/** Combine stored tag features with synopsis content tokens into the model's input space. */
export function modelFeatures(tagFeatures: string[], synopsis: string): string[] {
  const tags = scoringFeatures(tagFeatures);
  const syn = tokenizeSynopsis(synopsis).map((t) => `syn:${t}`);
  return [...new Set([...tags, ...syn])];
}

/** Convenience: build model features straight from a stored features_json + synopsis. */
export function modelFeaturesFromJson(featuresJson: string, synopsis: string): string[] {
  return modelFeatures(featuresFromJson(featuresJson), synopsis);
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Prefixes that are real signal to the model but meaningless as a human "why this"
 *  caption (release year, age rating, popularity rank, etc.). Hidden from display. */
const DISPLAY_SKIP_PREFIXES = [
  "syn:", "year:", "rating:", "rank:", "score-tier:", "status:", "season:",
  "episodes:", "duration:", "format:", "origin:", "source:", "mc:", "relation:",
];

function isDisplayableContributor(feature: string): boolean {
  return !DISPLAY_SKIP_PREFIXES.some((p) => feature.startsWith(p));
}

/**
 * Trains the taste model. `corpusFeatureLists` is every catalog title's model
 * features (used only to build the min-document-frequency vocabulary, which cuts
 * rare overfit-prone tokens). Each example's `features` are raw tag features +
 * its synopsis; they are combined internally via modelFeatures().
 */
export function trainTasteModel(
  examples: TasteExample[],
  corpusFeatureLists: string[][],
  options: TasteModelOptions = {},
): TasteModel {
  const { minDocFrequency, lambda, learningRate, epochs } = { ...DEFAULTS, ...options };

  const df = new Map<string, number>();
  for (const list of corpusFeatureLists) {
    for (const f of new Set(list)) df.set(f, (df.get(f) ?? 0) + 1);
  }
  const vocab = [...df.entries()]
    .filter(([, count]) => count >= minDocFrequency)
    .map(([f]) => f);
  const index = new Map(vocab.map((f, i) => [f, i]));
  const dimension = vocab.length;

  const activeIndices = (tagFeatures: string[], synopsis: string): number[] => {
    const out: number[] = [];
    for (const f of modelFeatures(tagFeatures, synopsis)) {
      const i = index.get(f);
      if (i !== undefined) out.push(i);
    }
    return out;
  };

  const rows = examples.map((e) => ({
    ids: activeIndices(e.features, e.synopsis),
    y: e.label,
    w: e.weight ?? 1,
  }));
  const weights = new Float64Array(dimension);
  let bias = 0;

  // Class balancing: downvotes outnumber upvotes ~2.5:1; weight the loss so the
  // minority "like" class isn't drowned out. Uses weighted mass so discounted
  // (ambiguous) examples don't inflate their class.
  const nPos = rows.filter((r) => r.y === 1).reduce((s, r) => s + r.w, 0) || 1;
  const nNeg = rows.filter((r) => r.y === 0).reduce((s, r) => s + r.w, 0) || 1;
  const wPos = rows.length / (2 * nPos);
  const wNeg = rows.length / (2 * nNeg);
  const n = Math.max(1, rows.length);

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Float64Array(dimension);
    let gradBias = 0;
    for (const row of rows) {
      let z = bias;
      for (const j of row.ids) z += weights[j]!;
      const p = sigmoid(z);
      const err = (p - row.y) * (row.y === 1 ? wPos : wNeg) * row.w;
      for (const j of row.ids) grad[j]! += err;
      gradBias += err;
    }
    for (let j = 0; j < dimension; j++) {
      weights[j]! -= learningRate * (grad[j]! / n + (lambda * weights[j]!) / n);
    }
    bias -= (learningRate * gradBias) / n;
  }

  return {
    dimension,
    predict(features: string[], synopsis: string): number {
      let z = bias;
      for (const j of activeIndices(features, synopsis)) z += weights[j]!;
      return sigmoid(z);
    },
    topContributors(features: string[], synopsis: string, k: number): string[] {
      return activeIndices(features, synopsis)
        .map((j) => ({ feature: vocab[j]!, weight: weights[j]! }))
        .filter((c) => c.weight > 0 && isDisplayableContributor(c.feature))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, k)
        .map((c) => c.feature);
    },
  };
}

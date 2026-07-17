import { categoryWeightForFeature } from "./feature-category.js";

/** Sparse feature vectors for cosine-similarity taste matching. */
export type SparseVector = Map<string, number>;

export function emptySparseVector(): SparseVector {
  return new Map();
}

export function addToVector(
  target: SparseVector,
  source: SparseVector,
  scale = 1,
): SparseVector {
  for (const [key, value] of source) {
    target.set(key, (target.get(key) ?? 0) + value * scale);
  }
  return target;
}

export function vectorFromFeatures(
  features: string[],
  idf: Map<string, number>,
): SparseVector {
  const vec = emptySparseVector();
  for (const feature of features) {
    const categoryScale = categoryWeightForFeature(feature);
    if (categoryScale <= 0) {
      continue;
    }
    const weight = (idf.get(feature) ?? 1) * categoryScale;
    vec.set(feature, (vec.get(feature) ?? 0) + weight);
  }
  return vec;
}

/** Returns a new vector with all values multiplied by `factor`. */
export function scaleVector(vec: SparseVector, factor: number): SparseVector {
  const out = emptySparseVector();
  for (const [key, value] of vec) {
    out.set(key, value * factor);
  }
  return out;
}

export function l2Norm(vec: SparseVector): number {
  let sum = 0;
  for (const value of vec.values()) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

/** Cosine similarity in [0, 1] when vectors are non-negative. */
export function cosineSimilarity(a: SparseVector, b: SparseVector): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let dot = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;

  for (const [key, valueA] of smaller) {
    const valueB = larger.get(key);
    if (valueB !== undefined) {
      dot += valueA * valueB;
    }
  }

  const normA = l2Norm(a);
  const normB = l2Norm(b);
  if (normA === 0 || normB === 0 || !Number.isFinite(normA) || !Number.isFinite(normB)) {
    return 0;
  }

  const sim = dot / (normA * normB);
  return Number.isFinite(sim) ? sim : 0;
}

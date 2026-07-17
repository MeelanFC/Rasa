import { describe, expect, it } from "vitest";
import { cosineSimilarity, vectorFromFeatures } from "./sparse-vector.js";

describe("sparse vectors", () => {
  it("returns 1 for identical weighted vectors", () => {
    const idf = new Map([["a", 2], ["b", 1]]);
    const a = vectorFromFeatures(["a", "b"], idf);
    const b = vectorFromFeatures(["a", "b"], idf);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("returns 0 for disjoint vectors", () => {
    const idf = new Map([["a", 1], ["b", 1]]);
    const a = vectorFromFeatures(["a"], idf);
    const b = vectorFromFeatures(["b"], idf);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

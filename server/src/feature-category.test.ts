import { describe, expect, it } from "vitest";
import { categoryWeightForFeature, scoringFeatures } from "./feature-category.js";

describe("categoryWeightForFeature", () => {
  it("boosts AniList tags over genres", () => {
    expect(categoryWeightForFeature("alist-tag:Psychological")).toBeGreaterThan(
      categoryWeightForFeature("genre:Action"),
    );
  });

  it("drops meta markers from scoring", () => {
    expect(scoringFeatures(["meta:taste_enriched", "genre:Action"])).toEqual([
      "genre:Action",
    ]);
  });
});

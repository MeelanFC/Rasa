import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_DOWNVOTE_WEIGHT,
  hasEnoughOfEachClass,
  modelFeatures,
  tasteExampleLabel,
  tasteExampleWeight,
  trainTasteModel,
  WATCHLIST_EXAMPLE_WEIGHT,
  type TasteExample,
} from "./taste-model.js";

describe("trainTasteModel", () => {
  it("learns to separate liked from disliked patterns", () => {
    const liked = { features: ["genre:Action", "theme:War"], synopsis: "an epic battle to save the kingdom" };
    const disliked = { features: ["genre:Slice of Life"], synopsis: "calm peaceful days at school" };
    const examples: TasteExample[] = [];
    for (let i = 0; i < 6; i++) examples.push({ ...liked, label: 1 });
    for (let i = 0; i < 6; i++) examples.push({ ...disliked, label: 0 });
    const corpus = examples.map((e) => modelFeatures(e.features, e.synopsis));
    const model = trainTasteModel(examples, corpus, { minDocFrequency: 1, epochs: 300 });

    expect(model.predict(liked.features, liked.synopsis)).toBeGreaterThan(0.6);
    expect(model.predict(disliked.features, disliked.synopsis)).toBeLessThan(0.4);
  });

  it("separates same-tag titles by synopsis content (the nuance the tags miss)", () => {
    const examples: TasteExample[] = [];
    for (let i = 0; i < 6; i++) examples.push({ features: ["genre:Comedy"], synopsis: "brutal revenge bloodshed warriors death", label: 1 });
    for (let i = 0; i < 6; i++) examples.push({ features: ["genre:Comedy"], synopsis: "adorable girls relaxing peaceful sleepy afternoon", label: 0 });
    const corpus = examples.map((e) => modelFeatures(e.features, e.synopsis));
    const model = trainTasteModel(examples, corpus, { minDocFrequency: 1, epochs: 300 });

    const pAction = model.predict(["genre:Comedy"], "brutal revenge bloodshed warriors death");
    const pCute = model.predict(["genre:Comedy"], "adorable girls relaxing peaceful sleepy afternoon");
    expect(pAction).toBeGreaterThan(pCute);
  });

  it("discounted (ambiguous) downvotes drag a feature down less than full ones", () => {
    const build = (downWeight: number) => {
      const examples: TasteExample[] = [];
      for (let i = 0; i < 6; i++) examples.push({ features: ["genre:Action"], synopsis: "battle war", label: 1 });
      for (let i = 0; i < 6; i++) examples.push({ features: ["genre:Drama"], synopsis: "family tears", label: 0, weight: downWeight });
      const corpus = examples.map((e) => modelFeatures(e.features, e.synopsis));
      return trainTasteModel(examples, corpus, { minDocFrequency: 1, epochs: 300 });
    };

    const fullPenalty = build(1).predict(["genre:Drama"], "family tears");
    const discounted = build(0.4).predict(["genre:Drama"], "family tears");
    expect(discounted).toBeGreaterThan(fullPenalty);
  });

  it("excludes features below the minimum document frequency", () => {
    const model = trainTasteModel(
      [{ features: ["genre:Action"], synopsis: "battle", label: 1 }],
      [["genre:Action"]],
      { minDocFrequency: 5 },
    );
    expect(model.dimension).toBe(0);
  });
});

describe("swipe -> training example rules", () => {
  it("counts a would-watch save as a positive, a little below a liked verdict", () => {
    expect(tasteExampleLabel("save")).toBe(1);
    expect(tasteExampleLabel("up")).toBe(1);
    expect(tasteExampleWeight({ kind: "save", at: "2026-10-01 10:00:00" })).toBe(WATCHLIST_EXAMPLE_WEIGHT);
    expect(tasteExampleWeight({ kind: "up", at: "2026-10-01 10:00:00" })).toBe(1);
    expect(WATCHLIST_EXAMPLE_WEIGHT).toBeLessThan(1);
    expect(WATCHLIST_EXAMPLE_WEIGHT).toBeGreaterThan(0.5);
  });

  it("discounts only the downvotes cast before the button semantics changed", () => {
    expect(tasteExampleLabel("down")).toBe(0);
    expect(tasteExampleWeight({ kind: "down", at: "2026-07-01 10:00:00" })).toBe(AMBIGUOUS_DOWNVOTE_WEIGHT);
    expect(tasteExampleWeight({ kind: "down", at: "2026-10-01 10:00:00" })).toBe(1);
  });

  it("requires enough examples of both classes before the classifier is trusted", () => {
    const up: TasteExample = { features: ["genre:Action"], synopsis: "", label: 1 };
    const down: TasteExample = { features: ["genre:Drama"], synopsis: "", label: 0 };
    expect(hasEnoughOfEachClass([up, up, up, down, down, down])).toBe(true);
    expect(hasEnoughOfEachClass(Array.from({ length: 10 }, () => up))).toBe(false);
    expect(hasEnoughOfEachClass([up, up, up, down, down])).toBe(false);
  });
});

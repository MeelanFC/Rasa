import { describe, expect, it } from "vitest";
import { trainTasteModel, modelFeatures, type TasteExample } from "./taste-model.js";

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

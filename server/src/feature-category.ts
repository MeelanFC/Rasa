/** Relative importance of feature categories in IDF cosine scoring (warm users). */
const CATEGORY_WEIGHTS: Readonly<Record<string, number>> = {
  "alist-tag": 1.45,
  "alist-cast": 1.55,
  "alist-tech": 1.25,
  "alist-setting": 1.15,
  alist: 1.45,
  relation: 1.2,
  director: 1.15,
  writer: 1.12,
  "anim-studio": 1.2,
  "prod-studio": 0.85,
  studio: 1.1,
  composer: 1.05,
  chardesign: 1.1,
  artdir: 1.05,
  animator: 1.05,
  main: 1.05,
  mc: 0.05,
  tone: 1.1,
  story: 1.1,
  personality: 1.1,
  theme: 0.95,
  demo: 0.4,
  genre: 0.35,
  format: 0.1,
  episodes: 0.2,
  duration: 0.2,
  year: 0.05,
  season: 0.88,
  status: 0.05,
  rating: 0.1,
  source: 0.95,
  "score-tier": 0.85,
  rank: 0.8,
  licensor: 0.75,
  producer: 0.9,
  meta: 0,
};

export function featureCategory(feature: string): string {
  const colon = feature.indexOf(":");
  if (colon <= 0) {
    return "other";
  }
  return feature.slice(0, colon);
}

export function categoryWeightForFeature(feature: string): number {
  if (feature.startsWith("meta:")) {
    return 0;
  }
  const category = featureCategory(feature);
  return CATEGORY_WEIGHTS[category] ?? 1;
}

/** Features used for taste matching (drops meta markers). */
export function scoringFeatures(features: string[]): string[] {
  return features.filter((feature) => !feature.startsWith("meta:"));
}

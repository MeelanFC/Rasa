/** Inverse document frequency: rare staff/tags weigh more than ubiquitous genres. */
export function computeIdfWeights(featureCorpus: string[][]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  const documentCount = Math.max(1, featureCorpus.length);

  for (const features of featureCorpus) {
    const unique = new Set(features);
    for (const feature of unique) {
      documentFrequency.set(feature, (documentFrequency.get(feature) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [feature, df] of documentFrequency) {
    idf.set(feature, Math.log((documentCount + 1) / (df + 1)) + 1);
  }

  return idf;
}

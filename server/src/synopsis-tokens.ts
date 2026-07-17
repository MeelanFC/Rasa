const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "he",
  "she",
  "it",
  "they",
  "we",
  "you",
  "i",
  "his",
  "her",
  "its",
  "their",
  "our",
  "your",
  "my",
  "him",
  "them",
  "us",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "by",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "anime",
  "story",
  "follows",
  "follow",
  "life",
  "world",
  "one",
  "two",
  "new",
  "young",
  "man",
  "woman",
  "girl",
  "boy",
]);

const tokenizedSynopsisCache = new Map<string, string[]>();

/** Tokenize synopsis/background for content-based similarity (no external ML API). */
export function tokenizeSynopsis(text: string): string[] {
  let cached = tokenizedSynopsisCache.get(text);
  if (cached) return cached;

  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  const result = [...new Set(normalized)].slice(0, 80);
  tokenizedSynopsisCache.set(text, result);
  return result;
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  if (union === 0) {
    return 0;
  }

  return intersection / union;
}

export function maxSynopsisJaccard(candidateSynopsis: string, lovedSynopses: string[]): number {
  const candidateTokens = tokenizeSynopsis(candidateSynopsis);
  if (candidateTokens.length === 0 || lovedSynopses.length === 0) {
    return 0;
  }

  let best = 0;
  for (const loved of lovedSynopses) {
    const score = jaccardSimilarity(candidateTokens, tokenizeSynopsis(loved));
    if (score > best) {
      best = score;
    }
  }

  return best;
}

export function maxSynopsisJaccardPretokenized(candidateSynopsis: string, lovedTokensList: string[][]): number {
  const candidateTokens = tokenizeSynopsis(candidateSynopsis);
  if (candidateTokens.length === 0 || lovedTokensList.length === 0) {
    return 0;
  }

  let best = 0;
  for (const lovedTokens of lovedTokensList) {
    const score = jaccardSimilarity(candidateTokens, lovedTokens);
    if (score > best) {
      best = score;
    }
  }

  return best;
}

/**
 * Combo mining: finds CONJUNCTIONS of person/studio credits shared across the
 * user's liked titles - "directed by Priyadarshan AND starring Akshay Kumar" -
 * the taste structure a linear model can't express (it only adds up individual
 * features). Mined combos are shown to the user as plain-English taste rules to
 * confirm or reject; confirmed rules boost matching candidates in ranking.
 *
 * Singleton patterns (one feature) remain taste-patterns.ts territory.
 */
import type { Reaction } from "./types.js";

export interface RatedTitleForMining {
  title: string;
  /** Support is counted per FRANCHISE, not per title - five liked seasons of
   *  one show are one taste data point, not five. */
  franchiseKey: string;
  features: string[];
  reaction: Reaction;
}

export interface MinedCombo {
  /** Stable id: the sorted features joined with "+". */
  key: string;
  features: string[];
  likeCount: number;
  downCount: number;
  /** likes / (likes + downs) among rated titles carrying the full combo. */
  precision: number;
  score: number;
  /** Liked titles carrying the combo (evidence shown to the user). */
  evidence: string[];
}

const PERSON_PREFIXES = ["director:", "writer:", "main:", "composer:", "studio:"];
const MAX_PERSON_FEATURES_PER_TITLE = 10;
const MIN_LIKES = 2;
const MIN_PRECISION = 0.65;
const MAX_RESULTS = 10;

function personFeatures(features: string[]): string[] {
  const out: string[] = [];
  for (const f of features) {
    if (PERSON_PREFIXES.some((p) => f.startsWith(p))) {
      out.push(f);
      if (out.length >= MAX_PERSON_FEATURES_PER_TITLE) break;
    }
  }
  return out;
}

export function comboKey(features: string[]): string {
  return [...features].sort().join("+");
}

function* combosOf(items: string[], size: 2 | 3): Generator<string[]> {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (size === 2) {
        yield [items[i]!, items[j]!];
      } else {
        for (let k = j + 1; k < items.length; k++) {
          yield [items[i]!, items[j]!, items[k]!];
        }
      }
    }
  }
}

export function mineTasteCombos(
  rows: RatedTitleForMining[],
  options: { minLikes?: number; minPrecision?: number; limit?: number } = {},
): MinedCombo[] {
  const minLikes = options.minLikes ?? MIN_LIKES;
  const minPrecision = options.minPrecision ?? MIN_PRECISION;
  const limit = options.limit ?? MAX_RESULTS;

  interface Acc {
    features: string[];
    likedFranchises: Set<string>;
    downFranchises: Set<string>;
    evidence: string[];
  }
  const acc = new Map<string, Acc>();

  const personName = (feature: string): string =>
    feature.slice(feature.indexOf(":") + 1);
  const allDistinctPersons = (combo: string[]): boolean =>
    new Set(combo.map(personName)).size === combo.length;

  for (const row of rows) {
    const persons = personFeatures(row.features);
    if (persons.length < 2) continue;
    for (const size of [2, 3] as const) {
      if (persons.length < size) continue;
      for (const combo of combosOf(persons, size)) {
        // "music by X + directed by X" is one person, not a collaboration.
        if (!allDistinctPersons(combo)) continue;
        const key = comboKey(combo);
        let entry = acc.get(key);
        if (!entry) {
          entry = {
            features: [...combo].sort(),
            likedFranchises: new Set(),
            downFranchises: new Set(),
            evidence: [],
          };
          acc.set(key, entry);
        }
        if (row.reaction === "up") {
          if (!entry.likedFranchises.has(row.franchiseKey) && entry.evidence.length < 4) {
            entry.evidence.push(row.title);
          }
          entry.likedFranchises.add(row.franchiseKey);
        } else {
          entry.downFranchises.add(row.franchiseKey);
        }
      }
    }
  }

  let combos: MinedCombo[] = [];
  for (const [key, entry] of acc) {
    const likes = entry.likedFranchises.size;
    if (likes < minLikes) continue;
    const downs = entry.downFranchises.size;
    const precision = likes / (likes + downs);
    if (precision < minPrecision) continue;
    const size = entry.features.length;
    combos.push({
      key,
      features: entry.features,
      likeCount: likes,
      downCount: downs,
      precision,
      // Specificity bonus: a triple with the same support says more than a pair.
      score: likes * precision * (1 + 0.35 * (size - 2)),
      evidence: entry.evidence,
    });
  }

  // Subsumption: drop a combo when a STRICT SUPERSET has the same like-support -
  // the bigger rule explains everything the smaller one does.
  const byKey = new Map(combos.map((c) => [c.key, c]));
  combos = combos.filter((c) => {
    for (const other of byKey.values()) {
      if (
        other.features.length > c.features.length &&
        other.likeCount >= c.likeCount &&
        c.features.every((f) => other.features.includes(f))
      ) {
        return false;
      }
    }
    return true;
  });

  return combos.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** "director:Priyadarshan" + "main:Akshay Kumar" → "directed by Priyadarshan, starring Akshay Kumar" */
export function humanizeCombo(features: string[]): string {
  const parts = features.map((f) => {
    if (f.startsWith("director:")) return `directed by ${f.slice(9)}`;
    if (f.startsWith("writer:")) return `written by ${f.slice(7)}`;
    if (f.startsWith("main:")) return `starring ${f.slice(5)}`;
    if (f.startsWith("composer:")) return `music by ${f.slice(9)}`;
    if (f.startsWith("studio:")) return `from ${f.slice(7)}`;
    return f;
  });
  // Cast members read better grouped first: "starring A and B, directed by C".
  parts.sort((a, b) => Number(b.startsWith("starring")) - Number(a.startsWith("starring")));
  return parts.join(", ");
}

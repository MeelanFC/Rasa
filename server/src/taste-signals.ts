/**
 * Humanizes a candidate's profile-weighted matched features into short, readable
 * "taste signal" chips for the recommendation caption.
 *
 * Input is expected to be `matchedStrongFeatures` from explainCandidateMl, which
 * is already sorted by aggregate profile weight across ALL of the user's ratings.
 * So the caption reflects the whole rating history ("character growth, comedic,
 * A-1 Pictures") rather than a single liked title.
 */

// Categories that technically carry weight but say nothing about taste in a
// caption - almost every anime shares them.
const SKIP_PREFIXES = ["region:", "lang:", "episodes:"];

// "theme" values that describe the medium/source, not the user's preference.
const GENERIC_THEME = /^(anime$|based on)/i;

export function humanizeTasteSignals(matchedStrongFeatures: string[], limit = 3): string[] {
  const signals: string[] = [];
  const seen = new Set<string>();

  for (const feature of matchedStrongFeatures) {
    if (SKIP_PREFIXES.some((prefix) => feature.startsWith(prefix))) continue;

    const colon = feature.indexOf(":");
    const category = colon >= 0 ? feature.slice(0, colon) : "";
    const rawValue = colon >= 0 ? feature.slice(colon + 1) : feature;
    if (category === "theme" && GENERIC_THEME.test(rawValue)) continue;

    const label = rawValue.replace(/_/g, " ").trim();
    if (!label) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    signals.push(label);
    if (signals.length >= limit) break;
  }

  return signals;
}

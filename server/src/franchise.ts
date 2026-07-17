/**
 * Groups seasons, parts, and re-releases under one franchise so we do not
 * ask the user to rate "Attack on Titan" twice or surface duplicates in profile.
 */

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const SMART_SINGLE_QUOTES_RE = /[\u2018\u2019\u201A\u201B\u2032\u2035]/g;
const SMART_DOUBLE_QUOTES_RE = /[\u201C\u201D\u201E\u201F\u2033\u2036]/g;

/** Strips invisible junk and normalizes punctuation before franchise matching. */
export function normalizeTitleInput(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(SMART_SINGLE_QUOTES_RE, "'")
    .replace(SMART_DOUBLE_QUOTES_RE, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(CONTROL_CHARS_RE, "")
    .trim();
}

export function franchiseKey(titleEn: string, titleRomaji: string): string {
  const en = normalizeTitleInput(titleEn).toLowerCase();
  const romaji = normalizeTitleInput(titleRomaji).toLowerCase();
  const raw = en || romaji;

  // Colon subtitles are stripped only when the colon is FOLLOWED by whitespace:
  // "One Piece: The Movie" → "one piece", but "Re:Zero ..." keeps its colon.
  // (The old /\s+:\s+/ required a space BEFORE the colon, which real titles
  // never have - franchise variants leaked past the blocker for months.)
  let base = raw
    .replace(/[’']/g, "'")
    .replace(/\s*:\s+.*$/, "")
    .replace(/\s*-\s*.*$/, "")
    .replace(/\s+shippuden\b.*$/i, "")
    .replace(/\s+x\d+\b.*$/i, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s*(?:season|cour|part)\s*\d+.*$/i, "")
    .replace(/\s*\d+(?:st|nd|rd|th)?\s+season.*$/i, "")
    .replace(/\s*(?:2nd|3rd|4th|5th)\s+season.*$/i, "")
    .replace(/\s+(?:ii|iii|iv|v)$/i, "")
    .replace(/[!?.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (base.length === 0) {
    base = romaji || en;
  }

  return base;
}

export interface FranchiseKeyed {
  titleEn: string;
  titleRomaji: string;
  franchiseKey?: string | null;
}

export function keyForAnime(anime: FranchiseKeyed): string {
  const stored = anime.franchiseKey?.trim();
  if (stored) {
    return stored;
  }
  return franchiseKey(anime.titleEn, anime.titleRomaji);
}

export function keyForRow(row: {
  franchise_key?: string | null;
  title_en: string;
  title_jp: string;
}): string {
  const stored = row.franchise_key?.trim();
  if (stored) {
    return stored;
  }
  return franchiseKey(row.title_en, row.title_jp);
}

/**
 * One entry per franchise; keeps the candidate with higher popularity when tied.
 */
export function dedupeByFranchise<T extends FranchiseKeyed & { popularity?: number }>(
  items: T[],
): T[] {
  const best = new Map<string, T>();

  for (const item of items) {
    const key = keyForAnime(item);
    const existing = best.get(key);
    if (!existing || (item.popularity ?? 0) > (existing.popularity ?? 0)) {
      best.set(key, item);
    }
  }

  return [...best.values()];
}

export function excludeFranchiseKeys<T extends FranchiseKeyed>(
  items: T[],
  blocked: Set<string>,
): T[] {
  if (blocked.size === 0) {
    return items;
  }
  return items.filter((item) => !blocked.has(keyForAnime(item)));
}

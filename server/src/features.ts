/**
 * Taste features beyond genre tags: staff, studios, MC signals, synopsis tone/story.
 */
import type { AnilistStaffMember, CategorizedTag, CharacterGender } from "./anilist.js";
import type { AnimeCharacter } from "./jikan.js";

export interface StaffMember {
  name: string;
  positions: string[];
}

const SYNOPSIS_SIGNALS: Record<string, readonly string[]> = {
  "tone:dark": [
    "death",
    "murder",
    "tragedy",
    "despair",
    "horror",
    "vengeance",
    "revenge",
    "brutal",
    "bloodshed",
  ],
  "tone:wholesome": [
    "friendship",
    "heartwarming",
    "slice of life",
    "everyday",
    "heart-warming",
    "warmth",
  ],
  "tone:comedic": ["comedy", "hilarious", "funny", "gag", "parody", "humor", "humour"],
  "tone:psychological": [
    "psychological",
    "mind game",
    "paranoia",
    "madness",
    "manipulation",
    "trauma",
  ],
  "story:character_growth": [
    "growth",
    "journey",
    "become",
    "learn",
    "develop",
    "mature",
    "overcome",
    "redemption",
    "transform",
  ],
  "story:romance": ["love", "romance", "relationship", "confess", "dating", "beloved"],
  "story:action": ["battle", "fight", "war", "power", "defeat", "enemy", "combat"],
  "story:mystery": ["mystery", "secret", "investigate", "clue", "detective", "conspiracy"],
  "personality:antihero": ["anti-hero", "antihero", "morally gray", "ruthless", "villain"],
  "personality:underdog": ["underdog", "weak", "outcast", "bullied", "nobody"],
  "personality:determined": ["determined", "never give up", "persevere", "willpower"],
};

function parseJsonNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function prefix(kind: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return `${kind}:${trimmed}`;
}

function slugToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractSynopsisSignals(synopsis: string, background: string | null): string[] {
  const text = `${synopsis} ${background ?? ""}`.toLowerCase();
  const found: string[] = [];
  for (const [feature, keywords] of Object.entries(SYNOPSIS_SIGNALS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      found.push(feature);
    }
  }
  return found;
}

function normalizeRelationLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
}

/** AniList content tags (e.g. Male Protagonist, Anti-Hero): higher signal than synopsis keywords. */
export function anilistTagFeatures(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => prefix("alist-tag", tag)).filter((f) => f.length > 0))];
}

/** Maps AniList tag categories to distinct feature prefixes for weighted scoring. */
const TAG_CATEGORY_PREFIX: Record<string, string> = {
  "Cast-Main Cast": "alist-cast",
  "Cast-Traits": "alist-cast",
  Technical: "alist-tech",
  Setting: "alist-setting",
  "Setting-Scene": "alist-setting",
  "Setting-Time": "alist-setting",
  "Setting-Universe": "alist-setting",
};

/** Category-aware AniList tags: art style, cast personality, and setting get distinct prefixes. */
export function categorizedTagFeatures(tags: CategorizedTag[]): string[] {
  const features: string[] = [];
  for (const tag of tags) {
    const pfx = TAG_CATEGORY_PREFIX[tag.category ?? ""] ?? "alist-tag";
    const feature = prefix(pfx, tag.name);
    if (feature.length > 0) {
      features.push(feature);
    }
  }
  return [...new Set(features)];
}

/** Extract features from AniList staff roles (director, music, character design, art director). */
export function anilistStaffFeatures(staff: AnilistStaffMember[]): string[] {
  const features: string[] = [];
  for (const { name, role } of staff) {
    const lower = role.toLowerCase();
    if (lower.includes("director") && !lower.includes("animation director")) {
      features.push(prefix("director", name));
    }
    if (lower.includes("series composition") || lower.includes("script") || lower.includes("original creator")) {
      features.push(prefix("writer", name));
    }
    if (lower.includes("music") || lower.includes("sound director")) {
      features.push(prefix("composer", name));
    }
    if (lower.includes("character design")) {
      features.push(prefix("chardesign", name));
    }
    if (lower.includes("art director")) {
      features.push(prefix("artdir", name));
    }
    if (lower.includes("animation director")) {
      features.push(prefix("animator", name));
    }
  }
  return [...new Set(features)].slice(0, 18);
}

/** Franchise structure (sequel, spin-off, adaptation) from Jikan or AniList. */
export function relationTypeFeatures(relationTypes: string[]): string[] {
  return [...new Set(relationTypes.map((type) => prefix("relation", normalizeRelationLabel(type))))].slice(
    0,
    12,
  );
}

/** MC gender from AniList character records; preferred over synopsis heuristics. */
export function inferMcFromCharacterGenders(genders: CharacterGender[]): string[] {
  const known = genders.filter((g) => g !== "Unknown");
  if (known.length === 0) return [];

  const females = known.filter((g) => g === "Female").length;
  const males = known.filter((g) => g === "Male").length;

  if (females > 0 && males === 0) return ["mc:female"];
  if (males > 0 && females === 0) return ["mc:male"];
  if (females > males) return ["mc:female_likely"];
  if (males > females) return ["mc:male_likely"];
  return ["mc:mixed_cast"];
}

function inferMcBias(demographics: string[], synopsis: string): string {
  const demo = demographics.map((d) => d.toLowerCase());
  const text = synopsis.toLowerCase().slice(0, 900);

  const femaleHints =
    /\b(she|her|girl|woman|princess|queen|goddess|female protagonist)\b/.test(text);
  const maleHints =
    /\b(he|him|boy|man|prince|king|god|male protagonist)\b/.test(text);

  if (femaleHints && !maleHints) return "mc:female";
  if (maleHints && !femaleHints) return "mc:male";
  if (demo.some((d) => d.includes("shoujo"))) return "mc:female_likely";
  if (demo.some((d) => d.includes("shounen"))) return "mc:male_likely";
  if (demo.some((d) => d.includes("josei"))) return "mc:female_likely";
  return "mc:unknown";
}

export function normalizeMediaFormat(raw: string | null | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }
  return slugToken(raw);
}

export function normalizeAgeRating(raw: string | null | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (lower.includes("rx")) return "rx";
  if (lower.includes("r+") || lower.includes("r-17")) return "r-plus";
  if (lower.includes("r -")) return "r";
  if (lower.includes("pg-13")) return "pg-13";
  if (lower.includes("pg")) return "pg";
  if (lower.includes("g -")) return "g";
  return slugToken(raw.split("-")[0] ?? raw);
}

export function scoreTierFromAverage(score: number | null | undefined): string | null {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }
  if (score >= 85) return "score-tier:elite";
  if (score >= 75) return "score-tier:high";
  if (score >= 60) return "score-tier:mid";
  return "score-tier:low";
}

export function scoreTierFromMalScore(score: number | null | undefined): string | null {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }
  const scaled = score * 10;
  return scoreTierFromAverage(scaled);
}

export function episodeLengthBucket(episodes: number | null | undefined): string | null {
  if (episodes === null || episodes === undefined) {
    return null;
  }
  if (episodes <= 1) return "episodes:movie";
  if (episodes <= 12) return "episodes:short";
  if (episodes <= 26) return "episodes:medium";
  return "episodes:long";
}

export function rankTier(rank: number | null | undefined): string | null {
  if (rank === null || rank === undefined || rank <= 0) {
    return null;
  }
  if (rank <= 100) return "rank:top100";
  if (rank <= 500) return "rank:top500";
  if (rank <= 2000) return "rank:top2000";
  return "rank:listed";
}

function staffFeatures(staff: StaffMember[]): string[] {
  const features: string[] = [];
  for (const person of staff) {
    for (const position of person.positions) {
      const role = position.toLowerCase();
      const isCinematography = role.includes("cinematograph");
      const isProdDesign = role.includes("production design");
      if (role.includes("director") && !isCinematography && !isProdDesign) {
        features.push(prefix("director", person.name));
      }
      if (role.includes("producer")) {
        features.push(prefix("producer", person.name));
      }
      if (
        role.includes("story") ||
        role.includes("series composition") ||
        role.includes("script") ||
        role.includes("screenplay") ||
        role === "writer"
      ) {
        features.push(prefix("writer", person.name));
      }
      if (role.includes("music") || role.includes("sound") || role.includes("composer")) {
        features.push(prefix("composer", person.name));
      }
      if (role.includes("character design") || role.includes("animation director")) {
        features.push(prefix("animator", person.name));
      }
      if (isCinematography) {
        features.push(prefix("cinematographer", person.name));
      }
      if (role.includes("costume")) {
        features.push(prefix("costume", person.name));
      }
      if (role === "editor") {
        features.push(prefix("editor", person.name));
      }
      if (isProdDesign) {
        features.push(prefix("prod-design", person.name));
      }
    }
  }
  return [...new Set(features)].slice(0, 18);
}

function mainCharacterFeatures(characters: AnimeCharacter[]): string[] {
  const mains = characters
    .filter((c) => c.role.toLowerCase().includes("main"))
    .slice(0, 3);

  return mains.map((c) => prefix("main", c.name));
}

export interface BuildTasteFeaturesInput {
  genresJson: string;
  themesJson: string;
  demographicsJson: string;
  synopsis: string;
  background?: string | null;
  studios?: string[];
  animationStudios?: string[];
  productionStudios?: string[];
  producers?: string[];
  licensors?: string[];
  explicitGenres?: string[];
  source?: string | null;
  episodes?: number | null;
  duration?: number | null;
  staff?: StaffMember[];
  anilistStaff?: AnilistStaffMember[];
  characters?: AnimeCharacter[];
  anilistTags?: string[];
  categorizedTags?: CategorizedTag[];
  relationTypes?: string[];
  mainCharacterGenders?: CharacterGender[];
  mediaFormat?: string | null;
  status?: string | null;
  season?: string | null;
  year?: number | null;
  ageRating?: string | null;
  malScore?: number | null;
  averageScore?: number | null;
  popularity?: number | null;
  rank?: number | null;
  scoredBy?: number | null;
  isAdult?: boolean;
  manhwaTags?: string[];
  /** Pre-built MangaDex tag/author features (genre:, theme:, author:, etc.). */
  manhwaTasteFeatures?: string[];
  manhwaStatus?: string | null;
  manhwaYear?: number | null;
  manhwaContentRating?: string | null;
  origin?: "anime" | "manhwa" | "tv" | "movie" | string | null;
}

function metadataFeatures(input: BuildTasteFeaturesInput): string[] {
  const out: string[] = [];

  const mediaFormat = normalizeMediaFormat(input.mediaFormat);
  if (mediaFormat) {
    out.push(prefix("format", mediaFormat));
  }

  const origin = input.origin?.trim();
  if (origin) {
    out.push(prefix("origin", slugToken(origin)));
  }

  const status = input.status?.trim();
  if (status) {
    out.push(prefix("status", slugToken(status)));
  }

  const season = input.season?.trim();
  if (season) {
    out.push(prefix("season", slugToken(season)));
  }

  if (input.year !== null && input.year !== undefined && input.year > 1900) {
    out.push(prefix("year", String(Math.floor(input.year))));
  }

  const rating = normalizeAgeRating(input.ageRating);
  if (rating) {
    out.push(prefix("rating", rating));
  }

  const tier =
    scoreTierFromAverage(input.averageScore) ??
    scoreTierFromMalScore(input.malScore);
  if (tier) {
    out.push(tier);
  }

  const episodeBucket = episodeLengthBucket(input.episodes ?? null);
  if (episodeBucket) {
    out.push(episodeBucket);
  }

  const rankFeature = rankTier(input.rank ?? null);
  if (rankFeature) {
    out.push(rankFeature);
  }

  if (input.isAdult) {
    out.push("rating:adult");
  }

  if (input.manhwaStatus?.trim()) {
    out.push(prefix("status", slugToken(input.manhwaStatus)));
  }
  if (input.manhwaYear !== null && input.manhwaYear !== undefined && input.manhwaYear > 1900) {
    out.push(prefix("year", String(Math.floor(input.manhwaYear))));
  }
  if (input.manhwaContentRating?.trim()) {
    out.push(prefix("rating", slugToken(input.manhwaContentRating)));
  }

  if (input.manhwaTasteFeatures?.length) {
    out.push(...input.manhwaTasteFeatures);
  } else {
    for (const tag of input.manhwaTags ?? []) {
      const feature = prefix("theme", tag);
      if (feature) {
        out.push(feature);
      }
    }
  }

  return out;
}

/** Episode duration bucket (distinguishes shorts from standard-length episodes). */
export function durationBucket(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || minutes <= 0) {
    return null;
  }
  if (minutes <= 8) return "duration:short";
  if (minutes <= 18) return "duration:half";
  if (minutes <= 30) return "duration:standard";
  return "duration:long";
}

/** Builds the full weighted feature vector for taste matching. */
export function buildTasteFeatures(input: BuildTasteFeaturesInput): string[] {
  const genres = parseJsonNames(input.genresJson);
  const themes = parseJsonNames(input.themesJson);
  const demographics = parseJsonNames(input.demographicsJson);

  const taggedGenres = [
    ...genres.map((g) => prefix("genre", g)),
    ...themes.map((t) => prefix("theme", t)),
    ...demographics.map((d) => prefix("demo", d)),
    ...(input.explicitGenres ?? []).map((g) => prefix("genre", g)),
  ];

  // Split animation studios from production studios when available
  const animStudios = (input.animationStudios ?? []).map((s) => prefix("anim-studio", s));
  const prodStudios = (input.productionStudios ?? []).map((s) => prefix("prod-studio", s));
  const fallbackStudios = animStudios.length === 0 && prodStudios.length === 0
    ? (input.studios ?? []).map((s) => prefix("studio", s))
    : [];
  const producers = (input.producers ?? []).map((p) => prefix("producer", p));
  const licensors = (input.licensors ?? []).map((l) => prefix("licensor", l));
  const source = input.source?.trim() ? [prefix("source", slugToken(input.source))] : [];

  // Merge Jikan staff + AniList staff (AniList supplements, Jikan is the fallback)
  const jikanStaff = staffFeatures(input.staff ?? []);
  const alistStaff = anilistStaffFeatures(input.anilistStaff ?? []);
  const mains = mainCharacterFeatures(input.characters ?? []);
  const mcFromAnilist = inferMcFromCharacterGenders(input.mainCharacterGenders ?? []);
  const mcBias =
    mcFromAnilist.length > 0 ? mcFromAnilist : [inferMcBias(demographics, input.synopsis)];
  const synopsisSignals = extractSynopsisSignals(
    input.synopsis,
    input.background ?? null,
  );

  // Category-aware tags (art style, cast personality, setting) when available
  const catTags = input.categorizedTags?.length
    ? categorizedTagFeatures(input.categorizedTags)
    : anilistTagFeatures(input.anilistTags ?? []);

  const relations = relationTypeFeatures(input.relationTypes ?? []);
  const meta = metadataFeatures(input);

  const durBucket = durationBucket(input.duration ?? null);

  return [
    ...new Set([
      ...taggedGenres.filter((f) => f.length > 0),
      ...animStudios.filter((f) => f.length > 0),
      ...prodStudios.filter((f) => f.length > 0),
      ...fallbackStudios.filter((f) => f.length > 0),
      ...producers.filter((f) => f.length > 0),
      ...licensors.filter((f) => f.length > 0),
      ...source,
      ...jikanStaff,
      ...alistStaff,
      ...mains,
      ...mcBias,
      ...synopsisSignals,
      ...catTags,
      ...relations,
      ...meta,
      ...(durBucket ? [durBucket] : []),
    ]),
  ];
}

export function featuresFromJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** True when stored features are sparse (genre-only) despite enrichment marker. */
export function isSparseTasteFeatures(features: string[]): boolean {
  const scoring = features.filter((f) => !f.startsWith("meta:"));
  const richPrefixes = [
    "alist-tag:",
    "alist-cast:",
    "alist-tech:",
    "alist-setting:",
    "alist:",
    "director:",
    "studio:",
    "anim-studio:",
    "prod-studio:",
    "relation:",
    "format:",
    "episodes:",
  ];
  const hasRich = scoring.some((f) => richPrefixes.some((p) => f.startsWith(p)));
  if (hasRich) {
    return false;
  }
  return scoring.length <= 3;
}

import { z } from "zod";
import { ExternalApiError } from "./api-errors.js";
import { fetchWithRetry } from "./fetch-retry.js";

const ANILIST_GRAPHQL = "https://graphql.anilist.co";

const mediaByMalQuery = `
  query ($idMal: Int) {
    Media(idMal: $idMal, type: ANIME) {
      format
      status
      seasonYear
      season
      averageScore
      popularity
      episodes
      duration
      source
      isAdult
      genres
      tags {
        name
        rank
        category
        isMediaSpoiler
      }
      studios(isMain: false) {
        nodes {
          name
          isAnimationStudio
        }
      }
      staff(perPage: 15, sort: [RELEVANCE]) {
        edges {
          role
          node {
            name {
              full
            }
          }
        }
      }
      relations {
        edges {
          relationType(version: 2)
          node {
            idMal
            type
          }
        }
      }
      characters(perPage: 8, sort: [ROLE, RELEVANCE]) {
        edges {
          role
          node {
            name {
              full
            }
            gender
          }
        }
      }
      recommendations(perPage: 12, sort: RATING_DESC) {
        edges {
          node {
            idMal
            type
          }
        }
      }
    }
  }
`;

const tagSchema = z.object({
  name: z.string(),
  rank: z.number().nullable().optional(),
  category: z.string().nullable().optional(),
  isMediaSpoiler: z.boolean().optional(),
});

const mediaSchema = z.object({
  format: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  seasonYear: z.number().nullable().optional(),
  season: z.string().nullable().optional(),
  averageScore: z.number().nullable().optional(),
  popularity: z.number().nullable().optional(),
  episodes: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  source: z.string().nullable().optional(),
  isAdult: z.boolean().optional(),
  genres: z.array(z.string()).nullable().optional(),
  tags: z.array(tagSchema).nullable().optional(),
  studios: z
    .object({
      nodes: z.array(z.object({
        name: z.string(),
        isAnimationStudio: z.boolean().optional(),
      })).optional(),
    })
    .nullable()
    .optional(),
  staff: z
    .object({
      edges: z
        .array(
          z.object({
            role: z.string().optional(),
            node: z.object({
              name: z.object({ full: z.string().optional() }).optional(),
            }),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
  relations: z
    .object({
      edges: z
        .array(
          z.object({
            relationType: z.string(),
            node: z.object({
              idMal: z.number().nullable().optional(),
              type: z.string().optional(),
            }),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
  characters: z
    .object({
      edges: z
        .array(
          z.object({
            role: z.string().optional(),
            node: z.object({
              name: z.object({ full: z.string().optional() }).optional(),
              gender: z.string().nullable().optional(),
            }),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
  recommendations: z
    .object({
      edges: z
        .array(
          z.object({
            node: z.object({
              idMal: z.number().nullable().optional(),
              type: z.string().optional(),
            }),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
});

const responseSchema = z.object({
  data: z.object({
    Media: mediaSchema.nullable(),
  }),
});

export type CharacterGender = "Male" | "Female" | "Unknown";

export interface CategorizedTag {
  name: string;
  category: string | null;
}

export interface AnilistStaffMember {
  name: string;
  role: string;
}

export interface AnilistEnrichment {
  tags: string[];
  categorizedTags: CategorizedTag[];
  relationTypes: string[];
  relatedMalIds: number[];
  recommendationMalIds: number[];
  mainCharacterGenders: CharacterGender[];
  format: string | null;
  status: string | null;
  season: string | null;
  seasonYear: number | null;
  averageScore: number | null;
  popularity: number | null;
  episodes: number | null;
  duration: number | null;
  source: string | null;
  isAdult: boolean;
  genres: string[];
  animationStudios: string[];
  productionStudios: string[];
  /** @deprecated Use animationStudios; kept for existing callers */
  studios: string[];
  anilistStaff: AnilistStaffMember[];
}

let lastAnilistRequestAt = 0;

async function throttleAnilist(): Promise<void> {
  const minGapMs = 350;
  const elapsed = Date.now() - lastAnilistRequestAt;
  if (elapsed < minGapMs) {
    await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
  }
  lastAnilistRequestAt = Date.now();
}

function normalizeRelationType(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, "-");
}

function normalizeGender(raw: string | null | undefined): CharacterGender {
  if (raw === "Male") return "Male";
  if (raw === "Female") return "Female";
  return "Unknown";
}

function isMainRole(role: string | undefined): boolean {
  if (!role) return false;
  const lower = role.toLowerCase();
  return lower.includes("main");
}

/** Categories where lower-ranked tags are still high signal (art style, setting). */
const LOW_THRESHOLD_CATEGORIES = new Set([
  "Technical",
  "Setting",
  "Setting-Scene",
  "Setting-Time",
  "Setting-Universe",
]);

/** Picks high-signal AniList tags (personality, tone, structure) for taste matching. */
export function selectAnilistTags(
  tags: Array<{ name: string; rank?: number | null; category?: string | null; isMediaSpoiler?: boolean }>,
): string[] {
  return tags
    .filter((tag) => !tag.isMediaSpoiler && tag.name.trim().length > 0)
    .filter((tag) => {
      const minRank = LOW_THRESHOLD_CATEGORIES.has(tag.category ?? "") ? 15 : 40;
      return (tag.rank ?? 0) >= minRank;
    })
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, 36)
    .map((tag) => tag.name.trim());
}

/** Selects tags with their category metadata for category-aware feature extraction. */
export function selectCategorizedTags(
  tags: Array<{ name: string; rank?: number | null; category?: string | null; isMediaSpoiler?: boolean }>,
): CategorizedTag[] {
  return tags
    .filter((tag) => !tag.isMediaSpoiler && tag.name.trim().length > 0)
    .filter((tag) => {
      const minRank = LOW_THRESHOLD_CATEGORIES.has(tag.category ?? "") ? 15 : 40;
      return (tag.rank ?? 0) >= minRank;
    })
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, 36)
    .map((tag) => ({ name: tag.name.trim(), category: tag.category ?? null }));
}

const EMPTY_ENRICHMENT: AnilistEnrichment = {
  tags: [],
  categorizedTags: [],
  relationTypes: [],
  relatedMalIds: [],
  recommendationMalIds: [],
  mainCharacterGenders: [],
  format: null,
  status: null,
  season: null,
  seasonYear: null,
  averageScore: null,
  popularity: null,
  episodes: null,
  duration: null,
  source: null,
  isAdult: false,
  genres: [],
  animationStudios: [],
  productionStudios: [],
  studios: [],
  anilistStaff: [],
};

/** Maps AniList GraphQL media payload into enrichment used by feature extraction. */
export function parseAnilistMedia(
  media: z.infer<typeof mediaSchema> | null | undefined,
): AnilistEnrichment {
  if (!media) {
    return { ...EMPTY_ENRICHMENT };
  }

  const tags = selectAnilistTags(media.tags ?? []);
  const categorizedTags = selectCategorizedTags(media.tags ?? []);

  const relationTypes: string[] = [];
  const relatedMalIds: number[] = [];

  for (const edge of media.relations?.edges ?? []) {
    relationTypes.push(normalizeRelationType(edge.relationType));
    const malId = edge.node.idMal;
    if (malId && edge.node.type?.toUpperCase() === "ANIME") {
      relatedMalIds.push(malId);
    }
  }

  const mainCharacterGenders: CharacterGender[] = [];
  for (const edge of media.characters?.edges ?? []) {
    if (!isMainRole(edge.role)) continue;
    mainCharacterGenders.push(normalizeGender(edge.node.gender));
  }

  const recommendationMalIds: number[] = [];
  for (const edge of media.recommendations?.edges ?? []) {
    const malId = edge.node.idMal;
    if (malId && edge.node.type?.toUpperCase() === "ANIME") {
      recommendationMalIds.push(malId);
    }
  }

  const studioNodes = media.studios?.nodes ?? [];
  const animationStudios = studioNodes
    .filter((node) => node.isAnimationStudio === true)
    .map((node) => node.name.trim())
    .filter((name) => name.length > 0);
  const productionStudios = studioNodes
    .filter((node) => node.isAnimationStudio !== true)
    .map((node) => node.name.trim())
    .filter((name) => name.length > 0);
  const allStudios = studioNodes
    .map((node) => node.name.trim())
    .filter((name) => name.length > 0);

  const anilistStaff: AnilistStaffMember[] = [];
  for (const edge of media.staff?.edges ?? []) {
    const name = edge.node.name?.full?.trim();
    const role = edge.role?.trim();
    if (name && role) {
      anilistStaff.push({ name, role });
    }
  }

  return {
    tags,
    categorizedTags,
    relationTypes: [...new Set(relationTypes)].slice(0, 12),
    relatedMalIds: [...new Set(relatedMalIds)].slice(0, 12),
    recommendationMalIds: [...new Set(recommendationMalIds)].slice(0, 12),
    mainCharacterGenders: mainCharacterGenders.slice(0, 4),
    format: media.format ?? null,
    status: media.status ?? null,
    season: media.season ?? null,
    seasonYear: media.seasonYear ?? null,
    averageScore: media.averageScore ?? null,
    popularity: media.popularity ?? null,
    episodes: media.episodes ?? null,
    duration: media.duration ?? null,
    source: media.source ?? null,
    isAdult: media.isAdult ?? false,
    genres: media.genres ?? [],
    animationStudios: [...new Set(animationStudios)].slice(0, 6),
    productionStudios: [...new Set(productionStudios)].slice(0, 6),
    studios: [...new Set(allStudios)].slice(0, 8),
    anilistStaff: anilistStaff.slice(0, 15),
  };
}

/** MAL ids from AniList's collaborative recommendation graph (no API key). */
export async function fetchAnilistRecommendationMalIds(malId: number): Promise<number[]> {
  const enrichment = await fetchAnilistEnrichment(malId);
  return enrichment?.recommendationMalIds ?? [];
}

/** Fetches tag, relation, and MC gender signals from AniList by MAL id (no API key). */
export async function fetchAnilistEnrichment(malId: number): Promise<AnilistEnrichment | null> {
  await throttleAnilist();

  try {
    const response = await fetchWithRetry(
      ANILIST_GRAPHQL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: mediaByMalQuery,
          variables: { idMal: malId },
        }),
      },
      { service: "AniList", path: `Media(idMal:${malId})`, attempts: 2 },
    );

    if (response.status === 400 || response.status === 404) {
      return null;
    }

    const json: unknown = await response.json();

    if (
      json &&
      typeof json === "object" &&
      "errors" in json &&
      Array.isArray((json as { errors: unknown }).errors)
    ) {
      return null;
    }

    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) {
      return null;
    }

    return parseAnilistMedia(parsed.data.data.Media);
  } catch (error) {
    if (error instanceof ExternalApiError && (error.status === 400 || error.status === 404)) {
      return null;
    }
    throw error;
  }
}

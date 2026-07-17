import type { AnimeCard } from "@/types";

export function dedupeByMalId(cards: AnimeCard[]): AnimeCard[] {
  const seen = new Set<number>();
  const unique: AnimeCard[] = [];
  for (const card of cards) {
    if (seen.has(card.malId)) {
      continue;
    }
    seen.add(card.malId);
    unique.push(card);
  }
  return unique;
}

/** Server queue wins order; local tail keeps cards not yet on the server snapshot. */
export function mergeDiscoverQueue(
  serverQueue: AnimeCard[],
  localQueue: AnimeCard[],
  ratedMalIds: ReadonlySet<number>,
): AnimeCard[] {
  const server = dedupeByMalId(serverQueue).filter(
    (card) => !ratedMalIds.has(card.malId),
  );
  const serverIds = new Set(server.map((card) => card.malId));
  const tail = localQueue.filter(
    (card) => !ratedMalIds.has(card.malId) && !serverIds.has(card.malId),
  );
  return [...server, ...tail];
}

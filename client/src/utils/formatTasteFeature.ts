/** Human-readable label for a stored taste feature (e.g. director:Hayao Miyazaki). */
export function formatTasteFeature(feature: string): string {
  const colon = feature.indexOf(":");
  if (colon <= 0) {
    return feature;
  }
  const kind = feature.slice(0, colon);
  const value = feature.slice(colon + 1);
  const labels: Record<string, string> = {
    genre: "Genre",
    theme: "Theme",
    demo: "Demo",
    studio: "Studio",
    producer: "Producer",
    director: "Director",
    writer: "Writer",
    composer: "Composer",
    animator: "Art / animation",
    main: "Main character",
    mc: "Lead",
    alist: "Tag",
    "alist-tag": "AniList tag",
    relation: "Franchise link",
    source: "Source",
    tone: "Tone",
    story: "Story",
    personality: "Personality",
    format: "Format",
    episodes: "Length",
    year: "Year",
    season: "Season",
    status: "Status",
    rating: "Rating",
    "score-tier": "Score tier",
    rank: "Rank",
    licensor: "Licensor",
    meta: "Meta",
  };
  const label = labels[kind] ?? kind;
  return `${label}: ${value}`;
}

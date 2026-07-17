import { upsertAnime } from "./db.js";
import { fetchTopAnime } from "./jikan.js";

async function seed() {
  console.log("Fetching popular anime from Jikan…");
  const top = await fetchTopAnime(50);
  for (const anime of top) {
    upsertAnime({
      mal_id: anime.mal_id,
      franchise_key: null,
      title_en: anime.title_en,
      title_jp: anime.title_romaji,
      synopsis: anime.synopsis,
      image_url: anime.image_url,
      genres: anime.genres,
      themes: anime.themes,
      demographics: anime.demographics,
      score: anime.score,
      popularity: anime.popularity,
      media_type: "anime",
      mangadex_id: null,
      chapter_count: null,
      features_json: "[]",
    });
  }
  console.log(`Seeded ${top.length} anime into local database.`);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});

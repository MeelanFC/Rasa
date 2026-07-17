import { getAllAnime, upsertAnime } from "./db.js";
import { fetchAnimeFull } from "./jikan.js";

/** One-off: fix cached titles that stored kanji instead of romaji. */
async function refreshTitles() {
  const rows = getAllAnime();
  let updated = 0;

  for (const row of rows) {
    const hasKanji = /[\u3040-\u30ff\u4e00-\u9faf]/.test(row.title_jp);
    if (!hasKanji) {
      continue;
    }

    const full = await fetchAnimeFull(row.mal_id);
    upsertAnime({
      ...row,
      mal_id: full.mal_id,
      title_en: full.title_en,
      title_jp: full.title_romaji,
      synopsis: full.synopsis,
      image_url: full.image_url,
      genres: full.genres,
      themes: full.themes,
      demographics: full.demographics,
      score: full.score,
      popularity: full.popularity,
    });
    updated += 1;
  }

  console.log(`Refreshed ${updated} anime titles to romaji.`);
}

refreshTitles().catch((error) => {
  console.error(error);
  process.exit(1);
});

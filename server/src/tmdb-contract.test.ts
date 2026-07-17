import { describe, expect, it } from "vitest";
import { fetchTmdbDetail, hasTmdbCredentials } from "./tmdb.js";

const runContract = process.env.CONTRACT_TESTS === "1" && hasTmdbCredentials();
const run = runContract ? describe : describe.skip;

run("TMDB contract (movie/550 = Fight Club)", () => {
  it("returns rich crew, cast, keywords, genres, and a valid year", async () => {
    const detail = await fetchTmdbDetail("movie", 550);
    expect(detail.kind).toBe("movie");
    expect(detail.year).toBe(1999);
    expect(detail.genres.length).toBeGreaterThan(0);
    expect(detail.cast.length).toBeGreaterThan(3);
    expect(detail.keywords.length).toBeGreaterThan(0);

    const features = JSON.parse(detail.parsed.features_json) as string[];
    expect(features.some((f) => f.toLowerCase().includes("david fincher"))).toBe(true);
  }, 30_000);
});

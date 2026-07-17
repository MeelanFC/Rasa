import { describe, expect, it } from "vitest";
import { resolveTitles } from "./jikan.js";

describe("resolveTitles", () => {
  it("uses english and default romaji titles", () => {
    const titles = resolveTitles({
      title: "Shingeki no Kyojin",
      title_english: "Attack on Titan",
      titles: [
        { type: "Default", title: "Shingeki no Kyojin" },
        { type: "English", title: "Attack on Titan" },
        { type: "Japanese", title: "進撃の巨人" },
      ],
    });

    expect(titles.en).toBe("Attack on Titan");
    expect(titles.romaji).toBe("Shingeki no Kyojin");
    expect(titles.romaji).not.toMatch(/[\u3040-\u30ff\u4e00-\u9faf]/);
  });
});

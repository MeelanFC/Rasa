import { describe, expect, it } from "vitest";
import {
  dedupeByFranchise,
  excludeFranchiseKeys,
  franchiseKey,
  keyForAnime,
  normalizeTitleInput,
} from "./franchise.js";

describe("normalizeTitleInput", () => {
  it("strips zero-width characters and smart quotes", () => {
    const junk = "Re\u200B:Zero\u2019s Journey";
    expect(normalizeTitleInput(junk)).toBe("Re:Zero's Journey");
  });
});

describe("franchiseKey", () => {
  it("strips season suffixes from english titles", () => {
    expect(
      franchiseKey("Attack on Titan Season 2", "Shingeki no Kyojin Season 2"),
    ).toBe("attack on titan");
  });

  it("strips subtitle after colon for Re:Zero variants", () => {
    expect(
      franchiseKey(
        "Re:Zero - Starting Life in Another World",
        "Re:Zero kara Hajimeru Isekai Seikatsu",
      ),
    ).toBe("re:zero");
  });

  it("matches Re:Zero when titles include unicode junk and smart punctuation", () => {
    const messyEn = "Re\u200B:Zero \u2013 Starting Life in Another World";
    const cleanEn = "Re:Zero - Starting Life in Another World";
    expect(franchiseKey(messyEn, "Re:Zero kara Hajimeru Isekai Seikatsu")).toBe(
      franchiseKey(cleanEn, "Re:Zero kara Hajimeru Isekai Seikatsu"),
    );
  });

  it("strips colon subtitles without requiring a space before the colon", () => {
    // Real titles are "X: Y" - the old regex needed "X : Y" and never matched,
    // so franchise movies/sequels leaked past the rated-franchise blocker.
    expect(franchiseKey("One Piece: The Movie", "One Piece: The Movie")).toBe(
      franchiseKey("One Piece", "One Piece"),
    );
    expect(
      franchiseKey("Magi: Adventure of Sinbad", "Magi: Sinbad no Bouken"),
    ).toBe(franchiseKey("Magi: The Labyrinth of Magic", "Magi"));
  });

  it("keeps colons with no trailing space (Re:Zero stays intact)", () => {
    expect(franchiseKey("Re:Zero", "Re:Zero kara Hajimeru Isekai Seikatsu")).toBe(
      "re:zero",
    );
  });

  it("treats sequel numbering as same franchise", () => {
    expect(franchiseKey("Durarara!!", "Durarara!!")).toBe(
      franchiseKey("Durarara!! x2", "Durarara!!x2"),
    );
  });

  it("collapses Naruto and Naruto Shippuden", () => {
    expect(franchiseKey("Naruto Shippuden", "Naruto: Shippuuden")).toBe(
      franchiseKey("Naruto", "Naruto"),
    );
  });

  it("does not collapse unrelated titles that end in a digit", () => {
    expect(franchiseKey("86", "86 - Eighty-Six")).not.toBe(
      franchiseKey("8", "8"),
    );
  });
});

describe("dedupeByFranchise", () => {
  it("keeps one row per franchise", () => {
    const items = [
      { titleEn: "Fate/Zero", titleRomaji: "Fate/Zero", popularity: 100 },
      { titleEn: "Fate/stay night", titleRomaji: "Fate/stay night", popularity: 200 },
    ];
    const deduped = dedupeByFranchise(items);
    expect(deduped).toHaveLength(2);
  });

  it("collapses seasons to a single entry", () => {
    const items = [
      { titleEn: "Spy x Family", titleRomaji: "Spy x Family", popularity: 900 },
      {
        titleEn: "Spy x Family Season 2",
        titleRomaji: "Spy x Family Season 2",
        popularity: 50,
      },
    ];
    const deduped = dedupeByFranchise(items);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.titleEn).toBe("Spy x Family");
  });

  it("prefers stored franchiseKey over title heuristics", () => {
    const items = [
      {
        titleEn: "Custom A",
        titleRomaji: "Custom A",
        franchiseKey: "shared-franchise",
        popularity: 10,
      },
      {
        titleEn: "Custom B",
        titleRomaji: "Custom B",
        franchiseKey: "shared-franchise",
        popularity: 20,
      },
    ];
    expect(dedupeByFranchise(items)).toHaveLength(1);
  });
});

describe("excludeFranchiseKeys", () => {
  it("removes candidates matching a rated franchise", () => {
    const blocked = new Set([franchiseKey("Naruto", "Naruto")]);
    const remaining = excludeFranchiseKeys(
      [
        { titleEn: "Naruto Shippuden", titleRomaji: "Naruto Shippuden" },
        { titleEn: "Bleach", titleRomaji: "Bleach" },
      ],
      blocked,
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.titleEn).toBe("Bleach");
  });

  it("uses franchiseKey on items when present", () => {
    const blocked = new Set(["bleach"]);
    const remaining = excludeFranchiseKeys(
      [
        {
          titleEn: "Bleach: Thousand-Year Blood War",
          titleRomaji: "Bleach",
          franchiseKey: "bleach",
        },
        { titleEn: "One Piece", titleRomaji: "One Piece" },
      ],
      blocked,
    );
    expect(remaining).toHaveLength(1);
    expect(keyForAnime(remaining[0]!)).toBe("one piece");
  });
});

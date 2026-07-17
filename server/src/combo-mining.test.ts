import { describe, expect, it } from "vitest";
import { comboKey, humanizeCombo, mineTasteCombos, type RatedTitleForMining } from "./combo-mining.js";

const up = (title: string, features: string[]): RatedTitleForMining => ({
  title,
  franchiseKey: title.toLowerCase(),
  features,
  reaction: "up",
});
const down = (title: string, features: string[]): RatedTitleForMining => ({
  title,
  franchiseKey: title.toLowerCase(),
  features,
  reaction: "down",
});

describe("mineTasteCombos", () => {
  it("rediscovers the director+actor combo from liked titles (the golden case)", () => {
    const combo = ["director:Priyadarshan", "main:Akshay Kumar"];
    const rows = [
      up("Hera Pheri", [...combo, "writer:Neeraj Vora", "genre:Comedy"]),
      up("Garam Masala", [...combo, "genre:Comedy"]),
      up("Bhagam Bhag", [...combo, "writer:Neeraj Vora"]),
      // Priyadarshan WITHOUT Akshay, disliked - the combo matters, not the director alone.
      down("Kyon Ki", ["director:Priyadarshan", "main:Salman Khan"]),
      up("Unrelated Anime", ["studio:MAPPA", "director:Someone Else"]),
    ];

    const mined = mineTasteCombos(rows, { minLikes: 2 });
    const found = mined.find((c) => c.key === comboKey(combo));
    expect(found).toBeDefined();
    expect(found!.likeCount).toBe(3);
    expect(found!.downCount).toBe(0);
    expect(found!.evidence).toContain("Hera Pheri");

    // The bare-director rule pays for the disliked Kyon Ki (precision 3/4);
    // the full combo scores higher (specificity + clean precision).
    const bare = mined.find((c) => c.key === comboKey(["director:Priyadarshan", "main:Salman Khan"]));
    expect(bare).toBeUndefined(); // only 0 likes
  });

  it("counts franchises, not titles - five liked seasons are one data point", () => {
    const features = ["director:Same Crew", "studio:Same Studio"];
    const rows = [
      { title: "Slime S1", franchiseKey: "slime", features, reaction: "up" as const },
      { title: "Slime S2", franchiseKey: "slime", features, reaction: "up" as const },
      { title: "Slime S3", franchiseKey: "slime", features, reaction: "up" as const },
    ];
    expect(mineTasteCombos(rows, { minLikes: 2 })).toHaveLength(0);
  });

  it("rejects one person appearing under two roles as a fake duo", () => {
    const rows = [
      up("Show A", ["director:Jin Aketagawa", "composer:Jin Aketagawa"]),
      up("Show B", ["director:Jin Aketagawa", "composer:Jin Aketagawa"]),
    ];
    expect(mineTasteCombos(rows, { minLikes: 2 })).toHaveLength(0);
  });

  it("drops combos that fail the precision floor", () => {
    const combo = ["main:Actor A", "main:Actor B"];
    const rows = [
      up("Good One", combo),
      up("Good Two", combo),
      down("Bad One", combo),
      down("Bad Two", combo),
      down("Bad Three", combo),
    ];
    // precision 2/5 = 0.4 < 0.65
    expect(mineTasteCombos(rows, { minLikes: 2 })).toHaveLength(0);
  });

  it("subsumes a pair when a triple explains all its support", () => {
    const triple = ["director:D", "main:A", "writer:W"];
    const rows = [up("One", triple), up("Two", triple), up("Three", triple)];
    const mined = mineTasteCombos(rows, { minLikes: 2 });
    expect(mined).toHaveLength(1);
    expect(mined[0]!.features).toEqual([...triple].sort());
  });
});

describe("humanizeCombo", () => {
  it("reads as a sentence with cast first", () => {
    expect(
      humanizeCombo(["director:Priyadarshan", "main:Akshay Kumar", "writer:Neeraj Vora"]),
    ).toBe("starring Akshay Kumar, directed by Priyadarshan, written by Neeraj Vora");
  });
});

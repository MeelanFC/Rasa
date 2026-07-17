import { describe, it, expect } from "vitest";
import { humanizeTasteSignals } from "./taste-signals.js";

describe("humanizeTasteSignals", () => {
  it("strips the category prefix and underscores into readable labels", () => {
    expect(
      humanizeTasteSignals(["story:character_growth", "theme:Isekai", "studio:A-1 Pictures"]),
    ).toEqual(["character growth", "Isekai", "A-1 Pictures"]);
  });

  it("preserves the aggregate weight order it is given", () => {
    expect(humanizeTasteSignals(["tone:comedic", "demo:Shounen"])).toEqual([
      "comedic",
      "Shounen",
    ]);
  });

  it("drops low-information signals (region / language / episode counts)", () => {
    expect(
      humanizeTasteSignals(["region:jp", "lang:ja", "episodes:short", "story:action"]),
    ).toEqual(["action"]);
  });

  it("drops generic medium descriptors masquerading as themes", () => {
    expect(
      humanizeTasteSignals(["theme:anime", "theme:based on manga", "theme:Harem"]),
    ).toEqual(["Harem"]);
  });

  it("dedupes case-insensitively", () => {
    expect(humanizeTasteSignals(["theme:Action", "story:action", "demo:Seinen"])).toEqual([
      "Action",
      "Seinen",
    ]);
  });

  it("caps the number of signals at the limit", () => {
    expect(
      humanizeTasteSignals(["theme:A", "theme:B", "theme:C", "theme:D"], 3),
    ).toEqual(["A", "B", "C"]);
  });

  it("returns an empty list when there is nothing meaningful (cold start)", () => {
    expect(humanizeTasteSignals([])).toEqual([]);
    expect(humanizeTasteSignals(["region:jp", "lang:ja"])).toEqual([]);
  });
});

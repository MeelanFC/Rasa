import { describe, expect, it } from "vitest";
import { formatSynopsis } from "./formatSynopsis";

describe("formatSynopsis", () => {
  it("returns an empty array for blank synopses", () => {
    expect(formatSynopsis("   ")).toEqual([]);
  });

  it("returns a single paragraph when there are no breaks", () => {
    expect(formatSynopsis("Bounty hunters in space.")).toEqual([
      "Bounty hunters in space.",
    ]);
  });

  it("splits on double newlines", () => {
    expect(
      formatSynopsis("Spike is a bounty hunter.\n\nJet runs the ship."),
    ).toEqual(["Spike is a bounty hunter.", "Jet runs the ship."]);
  });

  it("splits on the MAL Rewrite marker", () => {
    expect(
      formatSynopsis(
        "Original pitch.\n\n[Written by MAL Rewrite]\n\nExpanded backstory.",
      ),
    ).toEqual(["Original pitch.", "Expanded backstory."]);
  });

  it("collapses single newlines inside a paragraph", () => {
    expect(formatSynopsis("Line one\nline two")).toEqual(["Line one line two"]);
  });
});

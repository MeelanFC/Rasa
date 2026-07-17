import { describe, expect, it } from "vitest";
import { computeTastePatterns } from "./taste-patterns.js";

describe("computeTastePatterns", () => {
  it("ranks features with higher up rate toward upLeaning", () => {
    const patterns = computeTastePatterns(
      [
        { reaction: "up", features: ["genre:Action", "alist-tag:Tragedy"] },
        { reaction: "up", features: ["genre:Action", "alist-tag:Tragedy"] },
        { reaction: "down", features: ["genre:Romance"] },
        { reaction: "down", features: ["genre:Romance", "theme:School"] },
      ],
      { minSample: 2 },
    );

    const action = patterns.upLeaning.find((p) => p.name === "genre:Action");
    expect(action?.upRate).toBe(1);
    expect(patterns.downLeaning.some((p) => p.name === "genre:Romance")).toBe(true);
  });

  it("ignores features below min sample", () => {
    const patterns = computeTastePatterns(
      [{ reaction: "up", features: ["genre:Sci-Fi"] }],
      { minSample: 2 },
    );

    expect(patterns.upLeaning).toHaveLength(0);
    expect(patterns.downLeaning).toHaveLength(0);
  });
});

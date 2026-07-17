import { describe, expect, it } from "vitest";
import {
  downReasonCategoryBoost,
  downReasonFeature,
} from "./downvote-reason.js";

describe("downvote reason features", () => {
  it("stores a down-reason feature tag", () => {
    expect(downReasonFeature("pacing")).toBe("down-reason:pacing");
  });

  it("boosts pacing-related categories", () => {
    expect(downReasonCategoryBoost("pacing", "episodes:long")).toBeGreaterThan(1);
    expect(downReasonCategoryBoost("pacing", "studio:ufotable")).toBe(1);
  });
});

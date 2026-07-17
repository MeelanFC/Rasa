import { describe, expect, it } from "vitest";
import { expectedCalibrationError } from "./calibration.js";

describe("expectedCalibrationError", () => {
  it("is close to 0 for a near-calibrated set", () => {
    const items: Array<{ score: number; label: 0 | 1 }> = [];
    for (let b = 0; b < 10; b++) {
      const score = (b + 0.5) / 10;
      const ups = b + 1;
      for (let i = 0; i < 10; i++) items.push({ score, label: (i < ups ? 1 : 0) as 0 | 1 });
    }
    expect(expectedCalibrationError(items)).toBeLessThan(0.10);
  });

  it("is high when scores invert reality", () => {
    const items = [
      ...Array.from({ length: 100 }, () => ({ score: 0.9, label: 0 as const })),
      ...Array.from({ length: 100 }, () => ({ score: 0.1, label: 1 as const })),
    ];
    expect(expectedCalibrationError(items)).toBeGreaterThan(0.7);
  });

  it("returns 0 on empty input", () => {
    expect(expectedCalibrationError([])).toBe(0);
  });
});

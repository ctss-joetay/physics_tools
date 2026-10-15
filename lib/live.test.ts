import { describe, expect, it } from "vitest";
import {
  finaliseRun,
  median,
  runningMedian,
  scaleFor,
  type RawSample,
} from "./live";

describe("median", () => {
  it("handles odd, even and single lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
});

describe("runningMedian", () => {
  it("uses only the last n values", () => {
    expect(runningMedian([100, 100, 1, 2, 3], 3)).toBe(2);
  });
});

describe("scaleFor", () => {
  it("gives metres per pixel for a real diameter", () => {
    const s = scaleFor("0.067", 40);
    expect(s).toEqual({ perPx: 0.067 / 40, unit: "m" });
  });

  it("falls back to arbitrary units for blank, zero or negative", () => {
    expect(scaleFor("", 40)).toEqual({ perPx: 1 / 40, unit: "a.u." });
    expect(scaleFor("0", 40)).toEqual({ perPx: 1 / 40, unit: "a.u." });
    expect(scaleFor("-1", 40)).toEqual({ perPx: 1 / 40, unit: "a.u." });
  });

  it("returns null when the blob has no size", () => {
    expect(scaleFor("0.067", 0)).toBeNull();
  });
});

describe("finaliseRun", () => {
  // Scan canvas 320x180; the blob is 40 px across and falls straight down.
  const raw: RawSample[] = Array.from({ length: 10 }, (_, i) => ({
    t: i / 30,
    px: 0.5,
    py: 0.2 + 0.05 * i,
    diameter: 40 + (i % 2 ? 1 : -1),
  }));

  it("fixes one scale from the median diameter and puts the origin at the first sample", () => {
    const r = finaliseRun(raw, "0.4", 320, 180)!;
    expect(r.unit).toBe("m");
    expect(r.perPx).toBeCloseTo(0.4 / 40, 6);
    expect(r.data[0]).toEqual({ t: 0, x: 0, y: 0 });
  });

  it("flips y so that moving down the screen is negative", () => {
    const r = finaliseRun(raw, "0.4", 320, 180)!;
    expect(r.data[1].y).toBeCloseTo(-0.05 * 180 * (0.4 / 40), 6);
    expect(r.data[1].x).toBeCloseTo(0, 6);
  });

  it("drops a sample whose timestamp does not advance", () => {
    const dup = [...raw.slice(0, 3), { ...raw[2] }, ...raw.slice(3)];
    const r = finaliseRun(dup, "0.4", 320, 180)!;
    expect(r.data.length).toBe(raw.length);
    for (let i = 1; i < r.data.length; i++) {
      expect(r.data[i].t).toBeGreaterThan(r.data[i - 1].t);
    }
  });

  it("uses arbitrary units when the diameter is blank", () => {
    const r = finaliseRun(raw, "", 320, 180)!;
    expect(r.unit).toBe("a.u.");
    // One a.u. is one blob diameter: falling 0.05·180 = 9 px per frame is 0.225 diameters.
    expect(r.data[1].y).toBeCloseTo(-9 / 40, 6);
  });

  it("returns null with fewer than two samples", () => {
    expect(finaliseRun([], "0.4", 320, 180)).toBeNull();
    expect(finaliseRun(raw.slice(0, 1), "0.4", 320, 180)).toBeNull();
  });
});

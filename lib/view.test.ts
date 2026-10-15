import { describe, expect, it } from "vitest";
import { isZoomed, panRange, zoomRange, type Range } from "./view";

const full: Range = [0, 10];

describe("zoomRange", () => {
  it("zooming in about the centre halves the span and keeps the centre", () => {
    expect(zoomRange(full, full, 2, 0.5)).toEqual([2.5, 7.5]);
  });

  it("zooming in about the left edge keeps the left edge", () => {
    expect(zoomRange(full, full, 2, 0)).toEqual([0, 5]);
  });

  it("zooming out never exceeds the full range", () => {
    expect(zoomRange([2, 4], full, 0.1, 0.5)).toEqual(full);
  });

  it("zooming in never exceeds the maximum zoom", () => {
    const r = zoomRange(full, full, 1000, 0.5, 50);
    expect(r[1] - r[0]).toBeCloseTo(10 / 50);
  });

  it("stays inside the full range when zooming near an edge", () => {
    const r = zoomRange([8, 10], full, 0.5, 0.9);
    expect(r[0]).toBeGreaterThanOrEqual(0);
    expect(r[1]).toBeLessThanOrEqual(10);
    expect(r[1] - r[0]).toBeCloseTo(4);
  });
});

describe("panRange", () => {
  it("shifts by delta", () => {
    expect(panRange([2, 4], full, 1)).toEqual([3, 5]);
  });

  it("clamps at the right end", () => {
    expect(panRange([7, 9], full, 5)).toEqual([8, 10]);
  });

  it("clamps at the left end", () => {
    expect(panRange([1, 3], full, -5)).toEqual([0, 2]);
  });

  it("cannot pan a full range", () => {
    expect(panRange(full, full, 3)).toEqual(full);
  });
});

describe("isZoomed", () => {
  it("is false for the full range and true for a subrange", () => {
    expect(isZoomed(full, full)).toBe(false);
    expect(isZoomed([0, 9.99], full)).toBe(true);
  });
});

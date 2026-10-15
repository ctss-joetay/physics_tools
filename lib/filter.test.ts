import { describe, expect, it } from "vitest";
import { OneEuro } from "./filter";

const run = (f: OneEuro, xs: number[], dt = 1 / 30) =>
  xs.map((x, i) => f.filter(x, i * dt));

describe("OneEuro", () => {
  it("passes the first sample through unchanged", () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
    expect(f.filter(3.5, 0)).toBe(3.5);
  });

  it("converges on a constant input", () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
    const out = run(f, Array(60).fill(2));
    expect(out.at(-1)).toBeCloseTo(2, 6);
  });

  it("follows a step to within 5% inside 0.5 s at 1 Hz", () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
    const xs = [...Array(10).fill(0), ...Array(30).fill(1)];
    const out = run(f, xs);
    expect(out[10 + 15]).toBeGreaterThan(0.95); // 15 frames = 0.5 s
  });

  it("damps jitter around a fixed value", () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
    const xs = Array.from({ length: 120 }, (_, i) => 5 + (i % 2 ? 0.1 : -0.1));
    const out = run(f, xs).slice(60);
    const spread = Math.max(...out) - Math.min(...out);
    expect(spread).toBeLessThan(0.05);
  });

  it("tracks a ramp with less lag at a higher minCutoff", () => {
    const lo = new OneEuro({ minCutoff: 0.5, beta: 0 });
    const hi = new OneEuro({ minCutoff: 5, beta: 0 });
    const xs = Array.from({ length: 60 }, (_, i) => i / 30);
    const a = run(lo, xs);
    const b = run(hi, xs);
    expect(Math.abs(xs[59] - b[59])).toBeLessThan(Math.abs(xs[59] - a[59]));
  });

  it("reset makes the next sample pass through", () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
    run(f, Array(20).fill(0));
    f.reset();
    expect(f.filter(9, 1)).toBe(9);
  });

  it("stays finite on a duplicate timestamp", () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
    f.filter(0, 1);
    expect(Number.isFinite(f.filter(1, 1))).toBe(true);
  });

  it("setOptions changes the cutoff for later samples", () => {
    const f = new OneEuro({ minCutoff: 0.5, beta: 0 });
    f.filter(0, 0);
    f.setOptions({ minCutoff: 50 });
    // Near-instant response at 50 Hz cutoff with a 1/30 s step.
    expect(f.filter(1, 1 / 30)).toBeGreaterThan(0.9);
  });
});

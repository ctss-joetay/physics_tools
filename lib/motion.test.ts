import { describe, expect, it } from "vitest";
import {
  csvHeaders,
  derive,
  scaleFromCalibration,
  unitLabels,
  type Sample,
} from "./motion";

/** Constant-acceleration synthetic run: x = 2t, y = 5t − 4.9t². */
const run: Sample[] = Array.from({ length: 31 }, (_, i) => {
  const t = i / 30;
  return { t, x: 2 * t, y: 5 * t - 4.9 * t * t };
});

describe("derive", () => {
  it("recovers the velocities", () => {
    const d = derive(run);
    expect(d.vxPts[15].s).toBeCloseTo(2, 3);
    // vy = 5 − 9.8t at t = 0.5
    expect(d.vyPts[15].s).toBeCloseTo(5 - 9.8 * 0.5, 2);
  });

  it("recovers the acceleration from the velocity", () => {
    const d = derive(run);
    expect(d.axPts[15].s).toBeCloseTo(0, 3);
    expect(d.ayPts[15].s).toBeCloseTo(-9.8, 1);
  });

  it("speed is the magnitude of velocity", () => {
    const d = derive(run);
    const i = 10;
    expect(d.speedPts[i].s).toBeCloseTo(
      Math.hypot(d.vxPts[i].s, d.vyPts[i].s),
      9,
    );
    expect(d.speedPts[i].t).toBe(d.vxPts[i].t);
  });

  it("arrays line up in length", () => {
    const d = derive(run);
    expect(d.vxPts.length).toBe(run.length);
    expect(d.speedPts.length).toBe(run.length);
    expect(d.axPts.length).toBe(run.length);
  });

  it("returns empty arrays for fewer than two samples", () => {
    const d = derive([{ t: 0, x: 0, y: 0 }]);
    expect(d.vxPts).toEqual([]);
    expect(d.axPts).toEqual([]);
  });
});

describe("unitLabels", () => {
  it("formats metres and arbitrary units", () => {
    expect(unitLabels("m")).toEqual({ s: "m", v: "m s⁻¹", a: "m s⁻²" });
    expect(unitLabels("a.u.")).toEqual({
      s: "a.u.",
      v: "a.u. s⁻¹",
      a: "a.u. s⁻²",
    });
  });
});

describe("csvHeaders", () => {
  it("lists kinematic columns, with force and energy only when a mass is given", () => {
    expect(csvHeaders("m", false)).toEqual([
      "t / s",
      "x / m",
      "y / m",
      "vx / m s^-1",
      "vy / m s^-1",
      "speed / m s^-1",
      "ax / m s^-2",
      "ay / m s^-2",
    ]);
    expect(csvHeaders("m", true).slice(8)).toEqual([
      "Fx / N",
      "Fy / N",
      "KE / J",
      "GPE / J",
      "total E / J",
    ]);
    expect(csvHeaders("a.u.", false)[1]).toBe("x / a.u.");
  });
});

describe("scaleFromCalibration", () => {
  it("gives metres per pixel for a real length", () => {
    expect(scaleFromCalibration(200, "2")).toEqual({ mPerPx: 0.01, unit: "m" });
  });

  it("falls back to arbitrary units when the length is blank or non-positive", () => {
    expect(scaleFromCalibration(200, "")).toEqual({ mPerPx: 1 / 200, unit: "a.u." });
    expect(scaleFromCalibration(200, "0")).toEqual({ mPerPx: 1 / 200, unit: "a.u." });
    expect(scaleFromCalibration(200, "-3")).toEqual({ mPerPx: 1 / 200, unit: "a.u." });
    expect(scaleFromCalibration(200, "abc")).toEqual({ mPerPx: 1 / 200, unit: "a.u." });
  });

  it("returns null when the two taps coincide", () => {
    expect(scaleFromCalibration(0.5, "1")).toBeNull();
  });
});

/**
 * Shared motion maths for both trackers: turn a list of (t, x, y) samples
 * into velocities, speed and accelerations, and name the units.
 *
 * Pure and unit-agnostic. A tracker that could not establish a real scale
 * passes unit "a.u." and everything downstream labels itself accordingly.
 */

import { derivative, type Pt } from "./fit";

export type Sample = { t: number; x: number; y: number };
export type Unit = "m" | "a.u.";

export type Derived = {
  xPts: Pt[];
  yPts: Pt[];
  vxPts: Pt[];
  vyPts: Pt[];
  /** |v|, paired by index with vxPts/vyPts. */
  speedPts: Pt[];
  axPts: Pt[];
  ayPts: Pt[];
};

export function derive(data: Sample[]): Derived {
  const xPts = data.map((d) => ({ t: d.t, s: d.x }));
  const yPts = data.map((d) => ({ t: d.t, s: d.y }));
  const vxPts = derivative(xPts);
  const vyPts = derivative(yPts);
  const n = Math.min(vxPts.length, vyPts.length);
  const speedPts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    speedPts.push({ t: vxPts[i].t, s: Math.hypot(vxPts[i].s, vyPts[i].s) });
  }
  return {
    xPts,
    yPts,
    vxPts,
    vyPts,
    speedPts,
    axPts: derivative(vxPts),
    ayPts: derivative(vyPts),
  };
}

export function unitLabels(unit: Unit): { s: string; v: string; a: string } {
  return { s: unit, v: `${unit} s⁻¹`, a: `${unit} s⁻²` };
}

/** Plain-ASCII headings for CSV/TSV so spreadsheets never mangle them. */
export function csvHeaders(unit: Unit, energy: boolean): string[] {
  const base = [
    "t / s",
    `x / ${unit}`,
    `y / ${unit}`,
    `vx / ${unit} s^-1`,
    `vy / ${unit} s^-1`,
    `speed / ${unit} s^-1`,
    `ax / ${unit} s^-2`,
    `ay / ${unit} s^-2`,
  ];
  return energy
    ? [...base, "Fx / N", "Fy / N", "KE / J", "GPE / J", "total E / J"]
    : base;
}

/**
 * Scale from a calibration line `pxLength` pixels long whose real length the
 * student typed as `metres`. A blank or non-positive entry means "no real
 * length known": the line itself becomes the unit.
 */
export function scaleFromCalibration(
  pxLength: number,
  metres: string,
): { mPerPx: number; unit: Unit } | null {
  if (pxLength < 1) return null; // both taps landed on the same spot
  const m = parseFloat(metres);
  if (Number.isFinite(m) && m > 0) return { mPerPx: m / pxLength, unit: "m" };
  return { mPerPx: 1 / pxLength, unit: "a.u." };
}

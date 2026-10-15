/**
 * Pure maths for a live-camera run: fixing the scale from the tracked
 * object's own size and turning raw per-frame samples into (t, x, y) data.
 */

import type { Sample, Unit } from "./motion";

/** One frame's detection, in normalised (0–1) coordinates of the scan canvas. */
export type RawSample = {
  /** Seconds since Start. */
  t: number;
  px: number;
  py: number;
  /** Equivalent-circle diameter of the blob, in scan-canvas pixels. */
  diameter: number;
};

export const SMOOTHING = { min: 0.5, max: 5, default: 1.5 };
export const SENSITIVITY = { min: 8, max: 35, default: 20 };
export const MAX_RUN_SECONDS = 60;
/** Frames the live scale readout averages over. */
export const LIVE_SCALE_FRAMES = 15;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function runningMedian(xs: number[], n: number): number {
  return median(xs.slice(-n));
}

/**
 * Units per scan pixel. A blank or non-positive diameter means the student
 * has no real length: one object diameter becomes the unit.
 */
export function scaleFor(
  diameterMetres: string,
  medianDiameterPx: number,
): { perPx: number; unit: Unit } | null {
  if (!(medianDiameterPx > 0)) return null;
  const d = parseFloat(diameterMetres);
  if (Number.isFinite(d) && d > 0) {
    return { perPx: d / medianDiameterPx, unit: "m" };
  }
  return { perPx: 1 / medianDiameterPx, unit: "a.u." };
}

/**
 * Fix one scale for the whole run (median of every frame's diameter, so a
 * flicker in one frame cannot bend the data), drop samples whose clock did
 * not advance, put the origin at the first sample and flip y so up is
 * positive.
 */
export function finaliseRun(
  raw: RawSample[],
  diameterMetres: string,
  scanW: number,
  scanH: number,
): { data: Sample[]; unit: Unit; perPx: number } | null {
  const ordered: RawSample[] = [];
  for (const s of raw) {
    const prev = ordered[ordered.length - 1];
    if (!prev || s.t > prev.t) ordered.push(s);
  }
  if (ordered.length < 2) return null;

  const scale = scaleFor(diameterMetres, median(ordered.map((s) => s.diameter)));
  if (!scale) return null;

  const o = ordered[0];
  const data = ordered.map((s) => ({
    t: s.t - o.t,
    x: (s.px - o.px) * scanW * scale.perPx,
    // "+ 0" turns the -0 that the flip produces at the origin into 0.
    y: -(s.py - o.py) * scanH * scale.perPx + 0,
  }));
  return { data, unit: scale.unit, perPx: scale.perPx };
}

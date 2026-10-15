/**
 * Axis-range maths for zooming and scrolling a chart.
 *
 * A "view" is the [min, max] currently shown; "full" is the data's own
 * extent. Views never leave the full range and never zoom in beyond
 * MAX_ZOOM, so a student can always find their way back.
 */

export type Range = [number, number];

export const MAX_ZOOM = 50;

const EPS = 1e-9;

export function isZoomed(cur: Range, full: Range): boolean {
  return (
    Math.abs(cur[0] - full[0]) > EPS * (1 + Math.abs(full[0])) ||
    Math.abs(cur[1] - full[1]) > EPS * (1 + Math.abs(full[1]))
  );
}

/** Slide `cur` so it stays inside `full`, preserving its span. */
function fit(cur: Range, full: Range): Range {
  const span = Math.min(cur[1] - cur[0], full[1] - full[0]);
  let lo = cur[0];
  if (lo < full[0]) lo = full[0];
  if (lo + span > full[1]) lo = full[1] - span;
  return [lo, lo + span];
}

/**
 * Zoom `cur` by `factor` (>1 zooms in) about the point a fraction `f`
 * (0 = left edge, 1 = right edge) along the current span.
 */
export function zoomRange(
  cur: Range,
  full: Range,
  factor: number,
  f: number,
  maxZoom = MAX_ZOOM,
): Range {
  const fullSpan = full[1] - full[0];
  if (!(fullSpan > 0) || !(factor > 0)) return full;
  const minSpan = fullSpan / maxZoom;
  const span = Math.min(fullSpan, Math.max(minSpan, (cur[1] - cur[0]) / factor));
  const anchor = cur[0] + f * (cur[1] - cur[0]);
  const lo = anchor - f * span;
  return fit([lo, lo + span], full);
}

/** Shift `cur` by `delta` in data units, clamped inside `full`. */
export function panRange(cur: Range, full: Range, delta: number): Range {
  return fit([cur[0] + delta, cur[1] + delta], full);
}

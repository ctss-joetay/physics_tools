/**
 * Colour-blob detection for the live tracker.
 *
 * Everything here is pure and operates on an ImageData, so it can be unit
 * tested with a synthetic image and never touches the DOM. The hot loop in
 * findBlob is written against the raw byte array without per-pixel
 * allocations: at 320x180 and 30 fps it runs ~1.7 M pixel tests a second.
 */

export type Hsv = { h: number; s: number; v: number };
/** A hue in degrees and how far either side of it still counts, in degrees. */
export type Target = { hue: number; tolerance: number };
export type Blob = {
  /** Centroid, in pixels of the scanned image. */
  cx: number;
  cy: number;
  /** Matched pixel count. */
  count: number;
  /** Equivalent-circle diameter in pixels: sqrt(4·count/π). */
  diameter: number;
};
export type Window = { x: number; y: number; w: number; h: number } | null;

/** Between orange (~30°) and yellow (~55°): a tennis ball or orange ball. */
export const DEFAULT_TARGET: Target = { hue: 40, tolerance: 20 };
/** "Bright" means saturated and not dark — this is what rejects skin and beige. */
export const MIN_SAT = 0.45;
export const MIN_VAL = 0.35;
/** Fewer matched pixels than this is noise, not an object (at 320 px wide). */
export const MIN_PIXELS = 8;

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function matches(p: Hsv, target: Target): boolean {
  return (
    p.s >= MIN_SAT &&
    p.v >= MIN_VAL &&
    hueDistance(p.h, target.hue) <= target.tolerance
  );
}

function clampWindow(img: ImageData, w: Window) {
  if (!w) return { x0: 0, y0: 0, x1: img.width, y1: img.height };
  return {
    x0: Math.max(0, Math.floor(w.x)),
    y0: Math.max(0, Math.floor(w.y)),
    x1: Math.min(img.width, Math.ceil(w.x + w.w)),
    y1: Math.min(img.height, Math.ceil(w.y + w.h)),
  };
}

/**
 * Hue of one pixel from raw bytes, or -1 when it fails the brightness floors.
 * Inlined HSV so the scan loop allocates nothing.
 */
function brightHue(r: number, g: number, b: number): number {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  if (max < MIN_VAL * 255) return -1;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const d = max - min;
  if (d / max < MIN_SAT) return -1;
  let h: number;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return h < 0 ? h + 360 : h;
}

/** Centroid and size of the pixels matching `target`, optionally inside `window`. */
export function findBlob(
  img: ImageData,
  target: Target,
  window: Window = null,
): Blob | null {
  const { x0, y0, x1, y1 } = clampWindow(img, window);
  const { data, width } = img;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    let i = (y * width + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) {
      const h = brightHue(data[i], data[i + 1], data[i + 2]);
      if (h >= 0 && hueDistance(h, target.hue) <= target.tolerance) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  if (count < MIN_PIXELS) return null;
  return {
    cx: sumX / count,
    cy: sumY / count,
    count,
    diameter: Math.sqrt((4 * count) / Math.PI),
  };
}

/**
 * Median hue of the bright, saturated pixels within `radius` of a point —
 * what a tap on the object should set as the new target. Null when the tap
 * landed on nothing colourful, so the caller can leave the target alone.
 */
export function sampleHue(
  img: ImageData,
  x: number,
  y: number,
  radius: number,
): number | null {
  const { x0, y0, x1, y1 } = clampWindow(img, {
    x: x - radius,
    y: y - radius,
    w: 2 * radius + 1,
    h: 2 * radius + 1,
  });
  const hues: number[] = [];
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 > radius * radius) continue;
      const i = (yy * img.width + xx) * 4;
      const h = brightHue(img.data[i], img.data[i + 1], img.data[i + 2]);
      if (h >= 0) hues.push(h);
    }
  }
  if (hues.length < 3) return null;
  hues.sort((a, b) => a - b);
  return hues[Math.floor(hues.length / 2)];
}

/** A swatch colour for showing the current target. */
export function hueToCss(hue: number): string {
  return `hsl(${Math.round(hue)} 90% 50%)`;
}

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGET,
  findBlob,
  hueDistance,
  hueToCss,
  matches,
  rgbToHsv,
  sampleHue,
} from "./colour";

type Rgb = [number, number, number];

function makeImage(
  w: number,
  h: number,
  paint: (x: number, y: number) => Rgb,
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

const GREY: Rgb = [120, 120, 120];
const YELLOW: Rgb = [250, 200, 20];
const inDisc = (cx: number, cy: number, r: number) => (x: number, y: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

describe("rgbToHsv", () => {
  it("maps primaries and greys", () => {
    expect(rgbToHsv(255, 0, 0).h).toBeCloseTo(0);
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120);
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240);
    expect(rgbToHsv(255, 255, 0)).toMatchObject({ h: 60, s: 1, v: 1 });
    expect(rgbToHsv(128, 128, 128).s).toBe(0);
  });
});

describe("hueDistance / matches", () => {
  it("wraps around 360", () => {
    expect(hueDistance(350, 10)).toBe(20);
  });

  it("accepts bright yellow and rejects grey, dark and beige", () => {
    expect(matches(rgbToHsv(...YELLOW), DEFAULT_TARGET)).toBe(true);
    expect(matches(rgbToHsv(...GREY), DEFAULT_TARGET)).toBe(false);
    expect(matches(rgbToHsv(60, 50, 5), DEFAULT_TARGET)).toBe(false);
    expect(matches(rgbToHsv(230, 210, 170), DEFAULT_TARGET)).toBe(false);
  });

  it("respects tolerance at the boundary", () => {
    expect(matches({ h: 61, s: 1, v: 1 }, { hue: 40, tolerance: 20 })).toBe(false);
    expect(matches({ h: 59, s: 1, v: 1 }, { hue: 40, tolerance: 20 })).toBe(true);
  });
});

describe("findBlob", () => {
  it("finds the centroid and diameter of a disc", () => {
    const d = inDisc(100.5, 80.5, 20);
    const img = makeImage(320, 180, (x, y) => (d(x, y) ? YELLOW : GREY));
    const b = findBlob(img, DEFAULT_TARGET);
    expect(b).not.toBeNull();
    expect(b!.cx).toBeCloseTo(100.5, 0);
    expect(b!.cy).toBeCloseTo(80.5, 0);
    expect(Math.abs(b!.diameter - 40) / 40).toBeLessThan(0.05);
  });

  it("returns null on a blank image", () => {
    expect(findBlob(makeImage(320, 180, () => GREY), DEFAULT_TARGET)).toBeNull();
  });

  it("returns null when fewer than MIN_PIXELS match", () => {
    const img = makeImage(320, 180, (x, y) =>
      x === 5 && y < 5 ? YELLOW : GREY,
    );
    expect(findBlob(img, DEFAULT_TARGET)).toBeNull();
  });

  it("searches only inside the window", () => {
    const a = inDisc(60, 90, 15);
    const b = inDisc(260, 90, 15);
    const img = makeImage(320, 180, (x, y) =>
      a(x, y) || b(x, y) ? YELLOW : GREY,
    );
    const found = findBlob(img, DEFAULT_TARGET, { x: 200, y: 40, w: 120, h: 100 });
    expect(found!.cx).toBeCloseTo(260, 0);
  });

  it("clamps a window that overhangs the image", () => {
    const d = inDisc(10, 10, 8);
    const img = makeImage(320, 180, (x, y) => (d(x, y) ? YELLOW : GREY));
    expect(
      findBlob(img, DEFAULT_TARGET, { x: -50, y: -50, w: 100, h: 100 }),
    ).not.toBeNull();
  });
});

describe("sampleHue", () => {
  it("returns the hue inside a coloured disc and null on grey", () => {
    const d = inDisc(100, 80, 20);
    const img = makeImage(320, 180, (x, y) => (d(x, y) ? [20, 200, 250] : GREY));
    expect(sampleHue(img, 100, 80, 4)).toBeCloseTo(193, 0);
    expect(sampleHue(img, 10, 10, 4)).toBeNull();
  });
});

describe("hueToCss", () => {
  it("builds an hsl swatch", () => {
    expect(hueToCss(40)).toBe("hsl(40 90% 50%)");
  });
});

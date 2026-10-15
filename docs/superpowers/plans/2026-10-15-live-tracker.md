# Live Motion Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live camera tracker that follows a yellow/orange object, plots four stacked graphs as it runs, and shares the analysis section with the existing video tracker.

**Architecture:** Pure, unit-tested modules for colour detection (`lib/colour.ts`) and smoothing (`lib/filter.ts`); a shared `MotionAnalysis` component extracted from `VideoTracker`; a new `LiveTracker` client component running a `requestVideoFrameCallback` loop over a 320 px scan canvas; a `StepBanner` that tells the user the next action in both trackers. Playwright drives Chromium with a synthetic Y4M camera feed for end-to-end clickthroughs.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Vitest (unit), Playwright (e2e, Chromium fake camera).

**Spec:** `docs/superpowers/specs/2026-10-15-live-tracker-design.md`

## Global Constraints

- Everything runs client-side; no server component, nothing uploaded.
- Camera page must work in Safari on iPadOS over HTTPS; feature-detect `requestVideoFrameCallback` and fall back to `requestAnimationFrame`.
- No new runtime dependencies. Vitest and Playwright are dev dependencies only.
- Default target hue 40°, tolerance 20° (slider 8°–35°); saturation ≥ 0.45, value ≥ 0.35; `MIN_PIXELS` = 8 at 320 px scan width.
- One Euro: `minCutoff` 0.5–5 Hz via slider, `beta` 0.05, `dCutoff` 1 Hz.
- Default diameter 0.067 m; blank → arbitrary units, label `a.u.`, energy hidden.
- Final scale per run = median diameter over the run. Runs auto-stop at 60 s. Stop freezes the data.
- Banner copy exactly as in the spec table.
- Four charts stacked vertically, shared time domain, order: displacement, velocity, speed, acceleration.
- Existing video tracker behaviour unchanged apart from the banner, the stacked charts, the new columns, and the a.u. fallback.

## Review Focus

1. **Diameter field holds `0` or a negative number** → treat exactly like blank (a.u.), never divide by zero. Test in Task 7 (LiveTracker unit of `scaleFor`).
2. **Object lost for the whole recording** → Stop shows "Not enough points" rather than an empty analysis or a crash. Test in Task 9 (e2e `live-lost.spec` using a blank Y4M).
3. **Two tracked frames share a timestamp** (rAF fallback can deliver duplicates) → `derivative` already skips `dt === 0`; samples with `dt <= 0` are dropped at Stop. Test in Task 7 (`finaliseRun` unit test).
4. **Video tracker known length blank or `0`** → a.u. rather than `NaN` everywhere. Test in Task 6 (`scaleFromCalibration` unit test).
5. **Tap-to-sample on grey background** → target unchanged and a short message, not a hue of `0` that tracks red. Test in Task 3 (`sampleHue` returns null) and the preview message in Task 7.

---

### Task 1: Test tooling

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `playwright.config.ts`, `e2e/.gitignore`
- Modify: `tsconfig.json` (exclude `e2e` and `*.test.ts` from Next's typecheck is not needed; include them so `tsc` checks tests too)

- [ ] **Step 1: Install**

```bash
npm i -D vitest @playwright/test
```

- [ ] **Step 2: Scripts**

Add to `package.json` scripts:

```json
"test": "vitest run",
"e2e": "playwright test",
"e2e:fixtures": "node --experimental-strip-types e2e/fixtures/make-ball.ts"
```

- [ ] **Step 3: Configs**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["lib/**/*.test.ts", "components/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
```

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import path from "node:path";
const y4m = path.resolve(__dirname, "e2e/fixtures/out/ball.y4m");
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1024, height: 1366 },
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${y4m}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

`e2e/.gitignore`: `fixtures/out/`

- [ ] **Step 4: Verify** `npx vitest run` reports no test files (exit 0 with `--passWithNoTests`); add `--passWithNoTests` to the script if it fails on empty.

- [ ] **Step 5: Commit** `chore: add vitest and playwright`

---

### Task 2: One Euro filter (`lib/filter.ts`)

**Files:** Create `lib/filter.ts`, `lib/filter.test.ts`

**Interfaces — Produces:**
```ts
export type OneEuroOptions = { minCutoff: number; beta: number; dCutoff?: number };
export class OneEuro {
  constructor(opts: OneEuroOptions);
  setOptions(opts: Partial<OneEuroOptions>): void;
  filter(x: number, t: number): number;
  reset(): void;
}
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { OneEuro } from "./filter";

const run = (f: OneEuro, xs: number[], dt = 1 / 30) => xs.map((x, i) => f.filter(x, i * dt));

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
    const a = run(lo, xs), b = run(hi, xs);
    expect(Math.abs(xs[59] - b[59])).toBeLessThan(Math.abs(xs[59] - a[59]));
  });
  it("reset makes the next sample pass through", () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
    run(f, Array(20).fill(0));
    f.reset();
    expect(f.filter(9, 1)).toBe(9);
  });
  it("ignores a non-positive dt", () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
    f.filter(0, 1);
    expect(Number.isFinite(f.filter(1, 1))).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/filter.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
/** One Euro filter (Casiez, Roussel, Vogel 2012): adaptive low-pass that filters hard when still and relaxes when moving. */
export type OneEuroOptions = { minCutoff: number; beta: number; dCutoff?: number };

class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  last(): number | null { return this.y; }
  reset() { this.y = null; }
}

const alphaFor = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private minCutoff: number; private beta: number; private dCutoff: number;
  private x = new LowPass(); private dx = new LowPass(); private tPrev: number | null = null;
  constructor(o: OneEuroOptions) { this.minCutoff = o.minCutoff; this.beta = o.beta; this.dCutoff = o.dCutoff ?? 1; }
  setOptions(o: Partial<OneEuroOptions>) { if (o.minCutoff !== undefined) this.minCutoff = o.minCutoff; if (o.beta !== undefined) this.beta = o.beta; if (o.dCutoff !== undefined) this.dCutoff = o.dCutoff; }
  reset() { this.x.reset(); this.dx.reset(); this.tPrev = null; }
  filter(x: number, t: number): number {
    if (this.tPrev === null) { this.tPrev = t; this.dx.filter(0, 1); return this.x.filter(x, 1); }
    let dt = t - this.tPrev;
    if (!(dt > 0)) dt = 1 / 60; // duplicate timestamp: assume one short frame rather than divide by zero
    this.tPrev = t;
    const prev = this.x.last() ?? x;
    const dxRaw = (x - prev) / dt;
    const dxHat = this.dx.filter(dxRaw, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    return this.x.filter(x, alphaFor(cutoff, dt));
  }
}
```

- [ ] **Step 4: Run** → PASS. If the step test is marginal, keep tests honest: adjust the assertion frame count only after computing the analytic response (at 1 Hz, tau = 0.159 s; 0.5 s ≈ 3.1 tau → 95.6 %).

- [ ] **Step 5: Commit** `feat: one euro filter`

---

### Task 3: Pixel scan (`lib/colour.ts`)

**Files:** Create `lib/colour.ts`, `lib/colour.test.ts`

**Interfaces — Produces:**
```ts
export type Hsv = { h: number; s: number; v: number };
export type Target = { hue: number; tolerance: number };
export type Blob = { cx: number; cy: number; count: number; diameter: number };
export type Window = { x: number; y: number; w: number; h: number } | null;
export const DEFAULT_TARGET: Target; // { hue: 40, tolerance: 20 }
export const MIN_SAT = 0.45, MIN_VAL = 0.35, MIN_PIXELS = 8;
export function rgbToHsv(r: number, g: number, b: number): Hsv;
export function hueDistance(a: number, b: number): number;
export function matches(h: Hsv, target: Target): boolean;
export function findBlob(img: ImageData, target: Target, window?: Window): Blob | null;
export function sampleHue(img: ImageData, x: number, y: number, radius: number): number | null;
export function hueToCss(hue: number): string; // hsl(h 90% 50%) swatch
```

Tests build `ImageData` without a DOM: a tiny helper `makeImage(w, h, paint)` returning `{ width, height, data: Uint8ClampedArray } as ImageData`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TARGET, findBlob, hueDistance, matches, rgbToHsv, sampleHue } from "./colour";

function makeImage(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = paint(x, y); const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}
const GREY: [number, number, number] = [120, 120, 120];
const YELLOW: [number, number, number] = [250, 200, 20];
const disc = (cx: number, cy: number, r: number, col: [number, number, number]) =>
  (x: number, y: number): [number, number, number] => (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? col : GREY;

describe("rgbToHsv", () => {
  it("maps primaries", () => {
    expect(rgbToHsv(255, 0, 0).h).toBeCloseTo(0);
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120);
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240);
    expect(rgbToHsv(255, 255, 0)).toMatchObject({ h: 60, s: 1, v: 1 });
    expect(rgbToHsv(128, 128, 128).s).toBe(0);
  });
});
describe("hueDistance / matches", () => {
  it("wraps around 360", () => { expect(hueDistance(350, 10)).toBe(20); });
  it("accepts a bright yellow and rejects grey, dark and desaturated", () => {
    expect(matches(rgbToHsv(...YELLOW), DEFAULT_TARGET)).toBe(true);
    expect(matches(rgbToHsv(...GREY), DEFAULT_TARGET)).toBe(false);
    expect(matches(rgbToHsv(60, 50, 5), DEFAULT_TARGET)).toBe(false); // dark
    expect(matches(rgbToHsv(230, 210, 170), DEFAULT_TARGET)).toBe(false); // beige
  });
  it("respects tolerance at the boundary", () => {
    expect(matches({ h: 61, s: 1, v: 1 }, { hue: 40, tolerance: 20 })).toBe(false);
    expect(matches({ h: 59, s: 1, v: 1 }, { hue: 40, tolerance: 20 })).toBe(true);
  });
});
describe("findBlob", () => {
  it("finds the centroid and diameter of a disc", () => {
    const img = makeImage(320, 180, disc(100.5, 80.5, 20, YELLOW));
    const b = findBlob(img, DEFAULT_TARGET)!;
    expect(b).not.toBeNull();
    expect(b.cx).toBeCloseTo(100.5, 0); expect(b.cy).toBeCloseTo(80.5, 0);
    expect(Math.abs(b.diameter - 40) / 40).toBeLessThan(0.05);
  });
  it("returns null on a blank image", () => {
    expect(findBlob(makeImage(320, 180, () => GREY), DEFAULT_TARGET)).toBeNull();
  });
  it("returns null when fewer than MIN_PIXELS match", () => {
    const img = makeImage(320, 180, (x, y) => (x === 5 && y < 5 ? YELLOW : GREY));
    expect(findBlob(img, DEFAULT_TARGET)).toBeNull();
  });
  it("searches only inside the window", () => {
    const img = makeImage(320, 180, (x, y) => (disc(60, 90, 15, YELLOW)(x, y) !== GREY || disc(260, 90, 15, YELLOW)(x, y) !== GREY ? YELLOW : GREY));
    const b = findBlob(img, DEFAULT_TARGET, { x: 200, y: 40, w: 120, h: 100 })!;
    expect(b.cx).toBeCloseTo(260, 0);
  });
  it("clamps a window that overhangs the image", () => {
    const img = makeImage(320, 180, disc(10, 10, 8, YELLOW));
    expect(findBlob(img, DEFAULT_TARGET, { x: -50, y: -50, w: 100, h: 100 })).not.toBeNull();
  });
});
describe("sampleHue", () => {
  it("returns the hue inside a disc and null on grey", () => {
    const img = makeImage(320, 180, disc(100, 80, 20, [20, 200, 250]));
    expect(sampleHue(img, 100, 80, 4)).toBeCloseTo(193, 0);
    expect(sampleHue(img, 10, 10, 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — single pass over `data`, accumulate `sumX`, `sumY`, `count` within the (clamped) window using integer loops over rows and columns; `diameter = Math.sqrt((4 * count) / Math.PI)`; `sampleHue` collects hues of pixels with `s >= MIN_SAT && v >= MIN_VAL` inside `radius`, returns the circular median (sort, pick middle; good enough since the disc is one colour) or `null` if fewer than 3 such pixels. Inline the HSV maths in the hot loop (avoid allocating an object per pixel): compute `max`, `min`, `v = max/255`, `s = max ? (max-min)/max : 0`, skip early if below floors, then hue.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: colour blob detection`

---

### Task 4: Chart `xDomain` and `title`

**Files:** Modify `components/Chart.tsx`

- [ ] Add props `xDomain?: [number, number]` and `title?: string`. In the `domain` memo, when `xDomain` is given use it for `xMin/xMax` (still compute y from data). Render `title` as a `<h4 className="px-1 pb-1 text-[13px] font-medium">` above the legend. Keep `PAD` constant so stacked charts align.
- [ ] `npm run typecheck` passes. Commit `feat(chart): shared x domain and title`.

---

### Task 4b: Chart zoom and scroll

**Files:** Modify `components/Chart.tsx`; Create `lib/view.ts`, `lib/view.test.ts`

**Interfaces — Produces (`lib/view.ts`, pure):**
```ts
export type Range = [number, number];
/** Zoom a range by factor about a fraction f (0–1) of its span; clamp to full and to max zoom. */
export function zoomRange(cur: Range, full: Range, factor: number, f: number, maxZoom?: number): Range;
/** Shift a range by delta, clamped inside full. */
export function panRange(cur: Range, full: Range, delta: number): Range;
export function isZoomed(cur: Range, full: Range): boolean;
```

- [ ] Tests: zoom in about f=0.5 halves the span and keeps the centre; zoom out never exceeds `full`; zoom in never exceeds 50×; pan clamps at both ends; `isZoomed` false for full. Run → FAIL → implement → PASS.
- [ ] Chart: add state `xView: Range | null`, `yView: Range | null` (controlled x via props `xView?: Range | null`, `onXViewChange?: (r: Range | null) => void`). `domain` uses the view when set. Pointer handling on the SVG: one pointer → drag pans (dx → x, dy → y) once movement > 6 px (otherwise it is a hover); two pointers → anisotropic pinch (x spread ratio → `zoomRange` on x about the midpoint fraction, y spread ratio → y). Non-passive `wheel` listener: `ctrlKey` → zoom both about pointer by `exp(-deltaY·0.01)`; else if `|deltaX| > |deltaY|` → pan x by `deltaX` in data units and `preventDefault`; else do nothing (page scrolls). `onDoubleClick` → reset. "Reset zoom" button (`data-testid="reset-zoom"`) when `isZoomed` on either axis. `touchAction: "pan-y"` stays.
- [ ] MotionAnalysis (Task 6) holds one shared `xView` and passes it to all four charts.
- [ ] e2e (Task 9, add to `live.spec.ts` after Done): dispatch a `WheelEvent` with `ctrlKey: true, deltaY: -300` on the first chart svg via `page.evaluate` → `reset-zoom` buttons appear on all four charts and the first x tick label changes; mouse drag 200 px left on chart 2 → first x tick label of chart 1 changes too (linked); click reset → tick labels return to the original. Dispatch two `pointerdown`/`pointermove` pairs with `pointerType: "touch"` to simulate a pinch → zoomed.
- [ ] Commit `feat(chart): pinch zoom and drag scroll`.

### Task 5: StepBanner

**Files:** Create `components/StepBanner.tsx`; Modify `components/VideoTracker.tsx` (replace the instruction `<p>` at the top of the tracking card).

**Interface — Produces:**
```ts
type Props = { step: string; instruction: string; tone?: "info" | "live" | "done"; hint?: string };
export default function StepBanner(props: Props): JSX.Element;
```

- [ ] Banner: `role="status" aria-live="polite" data-testid="step-banner"`, rounded, `bg-[var(--series-1)] text-white` for info, `bg-[var(--critical)]` with a pulsing dot (`animate-pulse`) for live, `bg-[var(--series-3)]` for done. Step label bold in 13 px, instruction 14 px, optional muted hint 12 px.
- [ ] Video tracker: banner `step` = "Setting up" / "Tracking", `instruction` = existing `instruction[tapMode]`, `hint` = "Pinch with two fingers to zoom, slide both to pan." Also show a banner in the idle state: step "Start", instruction "Record a clip with the camera or choose one from your files."
- [ ] Typecheck, commit `feat: step banner in video tracker`.

---

### Task 6: MotionAnalysis extraction + stacked charts + a.u.

**Files:** Create `components/MotionAnalysis.tsx`, `lib/motion.ts`, `lib/motion.test.ts`; Modify `components/VideoTracker.tsx`.

**Interfaces — Produces (`lib/motion.ts`, pure):**
```ts
export type Sample = { t: number; x: number; y: number };
export type Unit = "m" | "a.u.";
export type Derived = {
  xPts: Pt[]; yPts: Pt[]; vxPts: Pt[]; vyPts: Pt[]; speedPts: Pt[]; axPts: Pt[]; ayPts: Pt[];
};
export function derive(data: Sample[]): Derived;
export function unitLabels(unit: Unit): { s: string; v: string; a: string }; // "m","m s⁻¹","m s⁻²" or "a.u.", ...
export function csvHeaders(unit: Unit, energy: boolean): string[];
/** metres per pixel from a calibration line; null if the taps coincide; falls back to a.u. when metres is blank/≤0. */
export function scaleFromCalibration(pxLength: number, metres: string): { mPerPx: number; unit: Unit } | null;
```
`speedPts[i] = hypot(vx, vy)` paired by index with `vxPts`; `axPts = derivative(vxPts)`, `ayPts = derivative(vyPts)`.

**MotionAnalysis props** exactly as the spec (`data`, `massKg?`, `g?`, `unit`, `csvFilename`, plus `auNote?: string` for the one-line a.u. explanation).

- [ ] **Step 1: Tests** for `derive` (constant-acceleration synthetic data gives `ay` ≈ a, speed = |v|, lengths line up), `scaleFromCalibration("", …)` → `{ unit: "a.u.", mPerPx: 1/px }`, `"0"` → a.u., `"2"` → m, px < 1 → null. Run → FAIL. Implement. PASS.
- [ ] **Step 2: Create `MotionAnalysis`** by moving from `VideoTracker` the derived memos, energy, headers, table rows, export/copy, charts, fit cards and table. Render order per spec: `<section data-testid="graphs">` with four `Chart`s (titles "Displacement–time", "Velocity–time", "Speed–time", "Acceleration–time"; `xDomain=[tMin,tMax]`; `height={240}`; `yLabel` from `unitLabels`), a fifth `Chart` "Net force–time" (`Fx = massKg·ax`, `Fy = massKg·ay`, `yLabel` "force / N", same linked `xView`) and the energy stores chart (series "Kinetic store", "Gravitational potential store", "Total"; `yLabel` "energy / J"), both only when `unit === "m"` and energy on; fit cards (units from `unitLabels`), table with extra columns `speed`, `ax`, `ay`, and when energy on `Fx / N`, `Fy / N` before the three energy columns. `csvHeaders(unit, energy)` returns the same headings. Table gets `data-testid="data-table"`.
- [ ] **Step 3: VideoTracker** keeps marks → `data` conversion, but uses `scaleFromCalibration` so blank/0 length → a.u.; passes `unit`, `auNote="No real length was given, so distances are in arbitrary units (1 a.u. = the calibration line)."`, `massKg`, `g`, `csvFilename="kinematics-data.csv"`. Remove the now-dead imports/memos. File should shrink to roughly 700 lines.
- [ ] Typecheck + `npm run build`. Commit `refactor: shared MotionAnalysis with stacked graphs and a.u.`

---

### Task 7: LiveTracker component, route, home card, nav

**Files:** Create `components/LiveTracker.tsx`, `lib/live.ts`, `lib/live.test.ts`, `app/live/page.tsx`; Modify `app/page.tsx`, `app/layout.tsx`.

**Interfaces — Produces (`lib/live.ts`, pure, tested):**
```ts
export type RawSample = { t: number; px: number; py: number; diameter: number }; // px, py normalised 0–1
export function median(xs: number[]): number;
/** metres per scan-pixel for a given diameter string and median blob diameter (px). */
export function scaleFor(diameterMetres: string, medianDiameterPx: number): { perPx: number; unit: Unit } | null;
/** Fix one scale, drop non-increasing timestamps, origin = first sample, flip y. */
export function finaliseRun(raw: RawSample[], diameterMetres: string, scanW: number, scanH: number): { data: Sample[]; unit: Unit; perPx: number } | null;
export function runningMedian(xs: number[], n: number): number; // median of the last n
export const SMOOTHING = { min: 0.5, max: 5 }; export const SENSITIVITY = { min: 8, max: 35 };
```

- [ ] **Step 1: Tests**: `scaleFor("", 40)` → `{ perPx: 1/40, unit: "a.u." }`; `"0"` and `"-1"` → a.u.; `"0.067", 40` → `0.067/40`, m; `medianDiameterPx 0` → null. `finaliseRun` drops a sample whose `t` equals the previous, sets origin at the first sample, returns `y` positive when `py` decreases, returns null for `< 2` samples. Run → FAIL → implement → PASS.

- [ ] **Step 2: Component** (`"use client"`). State: `phase: "off" | "preview" | "recording" | "done"`, `error: string | null`, `target: Target`, `tolerance`, `minCutoff`, `diameter: string` (default `"0.067"`), `mass`, `gravity`, `blob: Blob | null` (throttled to ~15 Hz for the overlay), `lost: boolean`, `liveData: Sample[]` (flushed every 100 ms), `elapsed`, `result: ReturnType<typeof finaliseRun>`, `sampleMsg: string | null`.
  Refs: `videoRef` (hidden `<video playsInline muted autoPlay>`), `canvasRef` (320×H scan canvas, `getContext("2d", { willReadFrequently: true })`), `streamRef`, `rawRef: RawSample[]`, `filters` (two `OneEuro`), `lastBlobRef`, `lostFramesRef`, `t0Ref`, `rvfcHandle`.
  - `startCamera()`: `navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, frameRate: { ideal: 60 } }, audio: false })`; on success set `srcObject`, wait for `loadedmetadata`, size the scan canvas to `320 × round(320·vh/vw)`, `phase = "preview"`, start loop. Error mapping per spec. `track.onended` handling per spec.
  - Loop: `rvfc` if `"requestVideoFrameCallback" in video` else `rAF`. Each tick: `drawImage(video, 0, 0, w, h)`, `getImageData`, window = `lastBlob ? {x: cx-1.5d, y: cy-1.5d, w: 3d, h: 3d} : null`, `findBlob`. If null: `lostFrames++`; after 3 → `lost = true`, `lastBlob = null`, filters reset. If found: filter `cx, cy` with `t = mediaTime ?? performance.now()/1000`; when recording push `RawSample` with `t - t0`.
  - `start()`: `t0 = current t`, `rawRef = []`, `phase = "recording"`, 100 ms flush interval computing `liveData` via `finaliseRun(rawRef, diameter, w, h)?.data ?? []` (cheap at ≤ 3600 samples; use `runningMedian` of last 15 diameters for the live scale readout), auto-stop at 60 s.
  - `stop()`: cancel loop, stop tracks, `result = finaliseRun(...)`, `phase = "done"`.
  - `newRun()`: `result = null`, `startCamera()`.
  - Tap on the surface in preview → map to scan pixels → `sampleHue(img, x, y, 4)`; null → `sampleMsg = "That spot isn't a bright colour — tap the ball itself."`; else `target.hue = hue`.
  - Cleanup on unmount: cancel loop, stop tracks, clear interval.
  UI: `StepBanner` per spec table (tone live while recording, done when done); viewing surface (`aspectRatio` from the video; visible `<video>` fills it, SVG overlay in scan-pixel `viewBox` draws the ring `data-testid="track-ring"`, trail polyline of the last 2 s, "Lost — looking…" badge `data-testid="lost-badge"`); controls row (Start camera / Start / Stop / New run, `data-testid="primary-action"`); settings grid: Object diameter (helper text toggles between "Real diameter of the tracked object" and "Blank → arbitrary units (1 a.u. = one object diameter)"), Sensitivity range `8–35`, Smoothing range `0.5–5 step 0.1`, Mass, g; target swatch (`hueToCss`) with "Reset to yellow/orange"; scale readout `data-testid="scale-readout"` ("scale: N px per m" or "per a.u."). Live charts while recording: two `Chart`s (displacement, velocity) from `derive(liveData)` under `data-testid="live-charts"`. In done: `MotionAnalysis` with `csvFilename="live-tracker-data.csv"` and the a.u. note "(1 a.u. = one object diameter)", or the "Not enough points" message when `result` is null.

- [ ] **Step 3: Route** `app/live/page.tsx` mirroring `kinematics/page.tsx`, title "Live motion tracker · Physics Tools", intro mentioning 30 fps suits carts, pendulums and rolling balls, and the video tracker for fast motion. Home card per spec (status ready, href `/live`). Nav link "Live" in `layout.tsx`.
- [ ] Typecheck + build. Commit `feat: live motion tracker`.

---

### Task 8: e2e fixtures (synthetic ball video)

**Files:** Create `e2e/fixtures/make-ball.ts`

- [ ] Script writes `e2e/fixtures/out/ball.y4m` (and `ball.mp4` via Playwright's ffmpeg found by `require("playwright-core/lib/utils").registry`? — simpler: locate the binary at `~/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac*` or `ffmpeg-linux`, skip MP4 with a warning if absent). Frame geometry 640×360, 30 fps, 6 s (180 frames). Background grey (120,120,120); ball: yellow (250,200,20) disc radius 18 px. Motion: `x = 80 + 80·t` px, `y = 300 − 240·t + 60·t²` px for `t` in `[0, 4)` then holds; i.e. a parabola whose acceleration is +120 px/s² downward on screen. With diameter 36 px, if the test enters diameter `0.36` m then 1 px = 0.01 m, so expected `ay = −1.2 m s⁻²` and `vx = 0.8 m s⁻¹`.
  Y4M: header `YUV4MPEG2 W640 H360 F30:1 Ip A1:1 C420jpeg\n`, each frame `FRAME\n` + Y plane (W·H) + U (W/2·H/2) + V; convert RGB→YCbCr (BT.601 full-range formulas with 16–235 scaling). Write with Node `fs` streams. Keep frame 0..14 (0.5 s) static at the start position so preview has something to lock onto.
  MP4: `ffmpeg -y -i ball.y4m -c:v libx264 -pix_fmt yuv420p -movflags +faststart ball.mp4`.
- [ ] Run `npm run e2e:fixtures`; confirm file sizes (~62 MB y4m is fine; it's gitignored). Commit the script.

---

### Task 9: Playwright clickthroughs

**Files:** Create `e2e/home.spec.ts`, `e2e/kinematics.spec.ts`, `e2e/live.spec.ts`, `e2e/live-lost.spec.ts`, `e2e/helpers.ts`

- [ ] `helpers.ts`: `banner(page)` = `page.getByTestId("step-banner")`; `expectStackedGraphs(page)` asserts four `[data-testid=graphs] svg` in document order with titles Displacement/Velocity/Speed/Acceleration, equal `left` of the plot area (compare bounding boxes of the first y-axis `<line>`… simpler: compare the `<svg>` bounding boxes' `x` and `width`, and compare the x tick label texts of chart 1 and chart 4 are identical).
- [ ] `home.spec.ts`: both cards visible and navigate.
- [ ] `kinematics.spec.ts`: banner "Start" → upload `ball.mp4` via `setInputFiles` on the "Choose a video" input → banner "Setting up" with calibration text → click surface at two points (ball diameter: tap left and right edge of the ball in the first frame) → set Known length `0.36` → banner moves through "other end", "origin", "Tracking" → tap the ball 10 times (ball is static for the first 0.5 s, so tap near start position; the test cares about flow, not accuracy) → graphs section shows four stacked charts, table has 10 rows, Export CSV triggers a download named `kinematics-data.csv`. Skip (with a clear message) if `ball.mp4` is missing.
- [ ] `live.spec.ts`: goto `/live` → banner contains "Step 1 of 3" → click "Start camera" → banner contains "Ready" within 10 s and `track-ring` visible → fill diameter `0.36` → click Start → banner "Recording" with live tone → `live-charts` visible and chart has ≥ 10 circles after 2 s → wait 3.5 s total → Stop → banner "Done" → `expectStackedGraphs` → table rows > 30 → fitted vertical acceleration text within 25 % of −1.2 → scale readout mentions "per m" → New run returns to Step 2.
  Then a second test in the same file: blank diameter → Start → Stop → labels show `a.u.`, no energy chart even with mass set.
- [ ] `live-lost.spec.ts`: launch a context with a blank grey y4m (generated in the fixture script as `blank.y4m`) via `test.use({ launchOptions })` → Start camera → banner "Find the object" and no ring → Start is disabled.
- [ ] Run `npm run e2e`, iterate until green. Commit `test: playwright clickthroughs`.

---

### Task 10: README

- [ ] Tool table row (Ready), "Using the live tracker" section (colour, lighting, diameter and a.u., 30 fps caveat, camera permission on iPad, tap-to-sample), project structure (new files), testing section (`npm test`, `npm run e2e:fixtures && npm run e2e`). Commit `docs: live tracker`.

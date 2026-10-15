# Live motion tracker — design

Date: 2026-10-15
Status: approved in conversation, awaiting written review

## Goal

Add a second motion-measurement tool that uses the iPad camera live instead
of a recorded clip. The page opens the rear camera, finds a bright
yellow/orange object in every frame, follows it automatically with smoothing,
and plots displacement–time and velocity–time graphs while the run is in
progress. On Stop the run gets the same analysis the kinematics video tracker
already provides: velocities, least-squares fits, energy graphs, data table,
CSV export and clipboard copy.

Audience: secondary-school physics students on a class set of iPads, over
HTTPS (Vercel), in Safari. No install, no login, nothing uploaded.

## Decisions taken

| Question | Decision |
|---|---|
| Output while running | Live displacement and velocity graphs under the camera view, refreshed about 10 times a second; full analysis on Stop. |
| Scale | From the tracked object's own diameter. The student enters the real diameter in metres. If the field is blank, the run is reported in arbitrary units (a.u.) where 1 a.u. is one object diameter. |
| Placement | Separate tool page at `/live`, with a card on the home page. The video tracker is unchanged in behaviour. |
| Target colour | Default bright yellow/orange hue band; tapping the object in preview re-samples the target colour; a sensitivity slider widens or narrows the match. |
| Detection | Plain canvas pixel scan on the main thread at reduced resolution. No libraries. |
| Smoothing | One Euro filter on the centroid, exposed as a single "Smoothing" slider. |
| Graphs | Four charts stacked vertically on a shared time axis: displacement, velocity, speed, acceleration. Energy chart below when a mass is given. Applies to both trackers via the shared analysis component. |
| Guidance | A distinct step banner at the top of each tracker always names the next action. |
| Verification | Playwright clickthroughs run sequentially as a user against a fake camera feed, plus Vitest unit tests. |

## Known limitation

A browser camera stream runs at 30 fps on iPad, occasionally 60. That suits
carts, pendulums, rolling and bouncing balls. A free-fall drop over one metre
gives about 13 frames, so the video tracker with 240 fps slow motion remains
the right tool for fast motion. The page says so in its intro text and the
README repeats it.

## Architecture

### Files

```
app/live/page.tsx            route: heading, intro, <LiveTracker />
app/page.tsx                 add the "Live motion tracker" card (status ready)
components/LiveTracker.tsx   camera, frame loop, state machine, live UI
components/MotionAnalysis.tsx shared analysis: extracted from VideoTracker
components/VideoTracker.tsx  uses MotionAnalysis; otherwise unchanged
lib/colour.ts                pure pixel scan: colour match, centroid, diameter
lib/filter.ts                pure One Euro filter
lib/colour.test.ts           Vitest unit tests
lib/filter.test.ts           Vitest unit tests
README.md                    new tool row, iPad notes, project structure
```

### Shared analysis component (`MotionAnalysis`)

Extracted verbatim from the bottom half of `VideoTracker.tsx` so the video
tracker's behaviour does not change.

Props:

```ts
type Sample = { t: number; x: number; y: number }; // seconds, metres, metres
type Props = {
  data: Sample[];
  /** Parsed, validated by the parent; undefined disables the energy section. */
  massKg?: number;
  g?: number;
  /** "m" normally; "a.u." when no real length was given. Drives every label. */
  unit: "m" | "a.u.";
  csvFilename: string;
};
```

When `unit` is `"a.u."`, axis labels, fit-card units, table headings and CSV
headings read `a.u.`, `a.u. s^-1` and `a.u. s^-2`, and the energy section is
hidden regardless of mass, since joules need metres. A one-line note under the
charts says "No real length was given, so distances are in arbitrary units
(1 a.u. = one object diameter)." for the live tracker, or "(1 a.u. = the
calibration line)" for the video tracker. The video tracker treats a blank
known-length field the same way.

Renders, when `data.length >= 2`, in this order:

1. Four charts stacked vertically, full width, each on its own axes, all
   sharing the same time domain so the time axes line up: displacement
   (`x`, `y`), velocity (`vx`, `vy`), speed (`|v|`), acceleration (`ax`,
   `ay`). Acceleration is the central-difference derivative of velocity;
   speed is `sqrt(vx² + vy²)`. `Chart` gains an optional `xDomain` prop so
   the parent can pin all four to `[tMin, tMax]`. The charts are grouped
   under a heading, with each chart carrying a short title.
2. The energy chart and note when `massKg` and `g` are both present and
   positive.
3. The two fit cards (horizontal and vertical).
4. The data table with Copy table data and Export CSV buttons. The table and
   exports gain `speed / m s^-1`, `ax / m s^-2` and `ay / m s^-2` columns. Owns the derived values it needs
(derivatives, fits, energies, table rows, copied flag). The parents keep the
mass and g inputs and pass parsed values down.

### Step banner (`components/StepBanner.tsx`)

A shared, visually distinct banner (filled background in the accent colour,
bold step label, one-sentence instruction) placed at the top of each tracker
so the next action is always obvious. Props: `step: string`,
`instruction: string`, optional `tone: "info" | "live" | "done"` (live pulses
a red dot while recording). The video tracker's existing plain-text
instruction line is replaced with this banner; its wording is unchanged.

Live tracker banner text by state:

| State | Step | Instruction |
|---|---|---|
| off | Step 1 of 3 — Camera | Press Start camera, then allow camera access. |
| preview, nothing found | Step 2 of 3 — Find the object | Point the camera at a bright yellow or orange ball. If the ring doesn't lock on, tap the ball to sample its colour. |
| preview, blob found | Step 2 of 3 — Ready | The ring is on the object. Check the diameter, then press Start. |
| recording | Step 3 of 3 — Recording | Let the motion happen. Press Stop when it is done. |
| done | Done | Scroll down for graphs and data, or press New run to go again. |

### Pure pixel scan (`lib/colour.ts`)

```ts
type Hsv = { h: number; s: number; v: number }; // h in degrees 0–360, s and v 0–1
type Target = { hue: number; tolerance: number }; // tolerance in degrees of hue
type Blob = {
  cx: number; cy: number;   // centroid in source pixels of the scanned image
  count: number;            // matched pixels
  diameter: number;         // equivalent-circle diameter, px: sqrt(4·count/π)
};
type Window = { x: number; y: number; w: number; h: number } | null;

function rgbToHsv(r: number, g: number, b: number): Hsv;
function matches(h: Hsv, target: Target): boolean;
function findBlob(img: ImageData, target: Target, window: Window): Blob | null;
function sampleHue(img: ImageData, x: number, y: number, radius: number): number | null;
```

- `matches` requires saturation ≥ 0.45 and value ≥ 0.35 as well as hue within
  `tolerance` of the target, with wrap-around at 360°. The "bright" part of
  "bright yellow/orange" is the saturation and value floor; it rejects
  skin, wood and beige walls that share the hue.
- Default target hue is 40° (between orange at 30° and yellow at 55°) with a
  tolerance of 20°. The sensitivity slider maps to tolerance 8°–35°.
- `findBlob` scans only inside `window` when it is given, otherwise the full
  image. Returns `null` when fewer than `MIN_PIXELS` (8 at 320 px wide) match.
- `sampleHue` returns the median hue of sufficiently saturated pixels in a
  small disc around a tapped point, or `null` if the tap landed on nothing
  saturated. Used by tap-to-sample.

All functions are pure and operate on `ImageData`, so they can be unit tested
with a synthetic image built in the test.

### One Euro filter (`lib/filter.ts`)

```ts
class OneEuro {
  constructor(opts: { minCutoff: number; beta: number; dCutoff?: number });
  /** Returns the filtered value; t in seconds. */
  filter(x: number, t: number): number;
  reset(): void;
}
```

Standard formulation: an exponential low-pass whose cutoff frequency is
`minCutoff + beta · |dx/dt|`, with the derivative itself low-passed at
`dCutoff` (default 1 Hz). Two instances, one per axis, share the parameters.
The Smoothing slider sets `minCutoff` between 0.5 Hz (heaviest) and 5 Hz
(lightest); `beta` is fixed at 0.05. The filter is reset whenever the track is
lost and reacquired so the dot does not slide across the gap.

### Live tracker component (`LiveTracker`)

State machine:

```
off ──Start camera──▶ preview ──Start──▶ recording ──Stop──▶ done
                        ▲                                      │
                        └────────────── New run ───────────────┘
off ◀── camera error / permission denied (message, Retry button)
```

- **off**: explanatory panel and a "Start camera" button. The button is the
  user gesture that calls `getUserMedia({ video: { facingMode: "environment",
  width: { ideal: 1280 }, frameRate: { ideal: 60 } }, audio: false })`.
- **preview**: the live video fills the viewing surface. The frame loop runs
  and draws the detected blob as a ring, or shows "Looking for a yellow/orange
  object…" when nothing matches. Tapping the video samples the colour under
  the finger (`sampleHue`) and becomes the new target; a swatch shows the
  current target colour with a "Reset to yellow/orange" link. Controls:
  object diameter (metres, default 0.067 for a tennis ball), Sensitivity
  slider, Smoothing slider, Mass, g. Start is enabled when a blob is visible.
  The diameter may be left blank, in which case the run is in arbitrary units
  (1 a.u. = one object diameter) and the field's helper text says so.
- **recording**: same view plus a fading trail of the last 2 s of positions
  and a running clock. Live charts (displacement and velocity) sit below the
  video and are refreshed from a ref on a 100 ms timer, not on every frame.
  They convert samples with the live running scale (below) and use `Chart`
  and `derivative` from `lib/fit` directly; `MotionAnalysis` is only rendered
  in **done**, where the final scale applies.
  Lost frames show a "Lost — looking…" badge; the trail breaks and the filter
  resets on reacquisition. Runs auto-stop at 120 s.
- **done**: the camera track is stopped (the camera light goes off), the
  last frame stays on the canvas with the full trail, and `MotionAnalysis`
  renders the run. "New run" returns to preview by reopening the camera.

Frame loop: `requestVideoFrameCallback` on the hidden `<video>` when
available (Safari 15.4+), falling back to `requestAnimationFrame`. Each
callback draws the frame to an offscreen canvas 320 px wide (height by
aspect), reads `ImageData` once, calls `findBlob` with a search window of
three blob diameters centred on the previous position (full frame when lost
or at first acquisition), filters the centroid, and appends a raw sample.

Per-frame raw sample stored in a ref (never in React state):

```ts
type RawSample = { t: number; px: number; py: number; diameter: number };
```

`t` is `metadata.mediaTime` from the frame callback when present, otherwise
`performance.now() / 1000`, in both cases relative to the Start press.
`px, py` are the filtered centroid in normalised (0–1) video coordinates, as
in the video tracker, so the on-screen overlay survives resize and rotation.

Conversion to metres:

- **Live scale**: running median of the last 15 frames' equivalent diameters,
  divided into the entered diameter. Shown on screen as "scale: N px per m".
- **Final scale**: on Stop, a single metres-per-pixel value is fixed as the
  median of all recorded diameters divided into the entered diameter (or into
  1 when the diameter is blank, giving arbitrary units), and every sample is
  converted with it. One scale per run matches the camera-
  still, side-on assumption and removes frame-to-frame flicker from the data.
- Origin is the first recorded sample. `x = (px − ox)·W·mPerPx`,
  `y = −(py − oy)·H·mPerPx` where `W, H` are the scan canvas dimensions, so up
  is positive.
- Samples flagged as lost are omitted from the data (a gap in time), not
  interpolated.

Overlay: an SVG with `viewBox` in scan-canvas pixels draws the ring at the
current blob position and diameter, the trail as a polyline with opacity
falling with age, and the lost badge. No pinch zoom on this page; the
object is tracked automatically so there is nothing to tap precisely.

### Error handling

| Case | Behaviour |
|---|---|
| `getUserMedia` rejected or missing (HTTP, denied, no camera) | Return to **off** with a message naming the likely cause: "Camera access needs HTTPS" when `!window.isSecureContext`; "Camera permission was denied — allow it in Settings → Safari → Camera" on `NotAllowedError`; generic otherwise. Retry button. |
| Camera track ends unexpectedly (`track.onended`) | Treat as Stop if recording, otherwise return to **off** with a message. |
| Object lost mid-run | Gap in data, badge shown, filter reset on reacquisition. |
| Run stopped with fewer than 2 samples | Show "Not enough points — the object was not seen" and offer New run. |
| Component unmounts | Camera tracks stopped, frame callback cancelled, timers cleared. |

### Home page and README

- Add a `ready` card: name "Live motion tracker", blurb "Point the camera at
  a yellow or orange ball and watch displacement–time and velocity–time
  graphs draw themselves. Best for carts, pendulums and rolling balls."
- README: new tool row, a "Using the live tracker" section (colour,
  lighting, diameter, 30 fps limitation, iPad camera permission), project
  structure updates, and a note that Vitest covers the pure `lib/` modules.

## Testing

- **Playwright (new dev dependency, `npm run e2e`)**: sequential clickthroughs
  in Chromium, `e2e/` directory, `fullyParallel: false`, one worker, against
  `next dev` started by the Playwright config. Chromium is launched with
  `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` and
  `--use-file-for-fake-video-capture=<y4m>`, where the Y4M file is generated
  by a script (`e2e/fixtures/make-ball.ts`) that draws a yellow disc moving on
  a parabola over a grey background at 30 fps for 6 s. The same script also
  encodes an MP4 with Playwright's bundled ffmpeg for the video-tracker
  clickthrough.
  - `live.spec.ts`: visits `/live`; asserts the Step 1 banner; presses Start
    camera; asserts the Step 2 banner changes to "Ready" and the ring is
    visible; sets the diameter; presses Start; asserts the Recording banner
    and that the live charts appear and gain points; presses Stop after 3 s;
    asserts the Done banner, four stacked charts in order (displacement,
    velocity, speed, acceleration) with aligned left plot edges and identical
    time-axis tick labels, a table with more than 30 rows, and fitted
    acceleration in y within 25 % of the synthetic parabola's value.
  - `kinematics.spec.ts`: visits `/kinematics`; asserts the banner; uploads
    the MP4; taps two calibration points, an origin and ten tracked points
    following the banner prompts; asserts the four stacked charts, the table
    and the CSV download.
  - A home-page test asserts both tool cards link to their routes.

- **Unit (Vitest, new dev dependency, `npm test`)**:
  - `rgbToHsv` on known colours; `matches` at hue boundaries and wrap-around.
  - `findBlob` on a synthetic 320×180 image with a filled yellow disc:
    centroid within 0.5 px and diameter within 5 % of the drawn disc; `null`
    on a blank image; window excludes a second disc outside it; a few scattered
    yellow pixels below `MIN_PIXELS` return `null`.
  - `sampleHue` returns the disc hue when tapped inside it and `null` on grey.
  - `OneEuro`: constant input converges to that constant within a few samples;
    a step is followed to within 5 % inside 0.5 s at `minCutoff` 1 Hz and
    beta 0.05; higher `minCutoff` tracks a ramp with less lag than lower.
- **Typecheck and build**: `npm run typecheck` and `npm run build` pass.
- **Hardware**: Vercel preview on an iPad in Safari with a tennis ball:
  permission prompt, preview ring, tap-to-sample on a differently coloured
  object, a 10 s roll along a bench giving a plausible velocity, camera light
  off after Stop, New run works, video tracker unaffected.

## Out of scope

Colour tracking of recorded videos, multiple objects, pinch zoom on the live
view, saving runs between sessions, and any server component.

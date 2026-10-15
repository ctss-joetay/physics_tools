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
| Scale | From the tracked object's own diameter. The student enters the real diameter in metres. |
| Placement | Separate tool page at `/live`, with a card on the home page. The video tracker is unchanged in behaviour. |
| Target colour | Default bright yellow/orange hue band; tapping the object in preview re-samples the target colour; a sensitivity slider widens or narrows the match. |
| Detection | Plain canvas pixel scan on the main thread at reduced resolution. No libraries. |
| Smoothing | One Euro filter on the centroid, exposed as a single "Smoothing" slider. |

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
  csvFilename: string;
};
```

Renders, when `data.length >= 2`: the displacement and velocity charts, the
energy chart and note when `massKg` and `g` are both present and positive,
the two fit cards (horizontal and vertical), and the data table with Copy
table data and Export CSV buttons. Owns the derived values it needs
(derivatives, fits, energies, table rows, copied flag). The parents keep the
mass and g inputs and pass parsed values down.

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
  slider, Smoothing slider, Mass, g. Start is enabled when a blob is visible
  and the diameter is a positive number.
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
  median of all recorded diameters divided into the entered diameter, and
  every sample is converted with it. One scale per run matches the camera-
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

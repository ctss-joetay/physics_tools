# Physics Tools

Browser-based instruments for physics practical work, built to run on a class
set of iPads. No app install, no student logins — every measurement is taken
and analysed on the device, and nothing is uploaded.

Built with Next.js (App Router), TypeScript and Tailwind CSS. Deployed on
Vercel.

## Tools

| Tool | Status | What it does |
|---|---|---|
| Kinematics video tracker | Ready | Frame-by-frame tap tracking of a filmed motion → stacked s–t, v–t, speed and acceleration graphs, fitted `u` and `a`, CSV export |
| Live motion tracker | Ready | Camera follows a yellow/orange ball by itself, graphs draw live; same analysis on Stop. Carts, pendulums, rolling balls |
| Sound timing gates | Planned | Microphone as a pair of timing gates — free-fall `g`, speed of sound |
| Pendulum timer | Planned | Period measurement averaged over many swings |
| Waves & frequency | Planned | Live FFT from the microphone |

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

To try it on an iPad on the same Wi-Fi, run `npm run dev -- -H 0.0.0.0` and
visit `http://<your-mac-ip>:3000`. Note that camera and motion sensors need a
**secure context**, so most sensor features will only work over HTTPS — use a
Vercel preview deployment for real device testing rather than plain HTTP.

## Deploying

Push to GitHub, then import the repository at
[vercel.com/new](https://vercel.com/new). Vercel detects Next.js and needs no
configuration. Every push to `main` redeploys; every pull request gets its own
preview URL, which is the easiest way to test on a real iPad over HTTPS.

## iPad browser notes

These constraints shaped the design and are worth knowing before adding tools:

- **The Generic Sensor API does not exist in Safari on iOS.** `new Accelerometer()`
  and `new Gyroscope()` are undefined in every version to date. Use the legacy
  `DeviceMotionEvent` / `DeviceOrientationEvent` instead.
- **Motion sensors need permission from a user gesture.** `DeviceMotionEvent.requestPermission()`
  must be called from inside a real tap handler, over HTTPS. Always feature-detect
  it first — it does not exist on Android or desktop, where no permission is needed.
- **Prefer a normal Safari tab to a home-screen PWA.** Standalone-mode PWAs on iOS
  have a history of re-prompting for camera and microphone permission on every
  launch, which is painful with a class of 30.
- **Video comes from the native camera, not `MediaRecorder`.** The tracker uses a
  file input with `capture`, which opens the iPad's own camera app. That gives
  access to 120/240 fps slow motion and avoids Safari's patchy `MediaRecorder`
  codec support.

## Using the tracker on an iPad

- **Pinch with two fingers to zoom, slide both to pan.** One finger is always a
  tap; a second finger cancels any pending tap, so zooming never drops a stray
  data point. Tap accuracy is unaffected by zoom — positions are read through
  the zoomed element's own bounding box, so a point tapped at 5x lands on
  exactly the same video pixel as at 1x.
- **The frame rate is detected automatically** from the frames the browser
  presents (`requestVideoFrameCallback`, Safari 15.4+). Override it by hand if
  detection fails, or press Detect to retry.
- **Enter a mass to unlock the energy graphs** — KE, GPE and total energy
  against time, plus the same three columns in the table and exports. `g`
  defaults to 9.81 and is editable for syllabuses that use 10.
- **Copy table data** puts the whole table on the clipboard tab-separated, so a
  paste into Google Sheets lands in individual cells with headings, no import
  dialog. Export CSV is there for a file.

## Using the live tracker on an iPad

- **Prop the iPad up so it cannot move**, side-on to the motion, in even light.
  Use a bright yellow or orange ball; a tennis ball works well. The tracker
  looks for saturated, bright pixels near that hue, so dull, dark or beige
  objects are ignored by design.
- **The step banner always says what to do next.** Start camera → allow
  access → wait for the ring to lock on → Start → Stop. Recording stops by
  itself after 60 s.
- **Set up before you start.** Once the camera is on, every setting and the
  Start button sit in a rail over the left of the camera view (under it on
  phones); "Hide" folds it away if it covers the ball. Mass and g are tucked
  under "Force & energy (optional)" and can also be entered after Stop.
- **Tap the ball in the camera view** to re-sample its colour if the ring
  will not lock on, or to track a differently coloured object. The swatch
  shows the current target; "Reset to yellow/orange" restores the default.
  Colour detection sensitivity runs from strict (only colours very close to
  the object) to loose (nearby shades too); Smoothing trades jitter
  against lag (a One Euro filter: it filters hard when the object is still
  and relaxes when it moves fast).
- **Scale comes from the ball's own diameter.** Enter it in metres. Leave the
  field blank to work in arbitrary units, where 1 a.u. is one ball diameter;
  the graphs, table and CSV are labelled `a.u.`, and the force and energy
  graphs are hidden because they need metres.
- **The camera runs at about 30 fps** (occasionally 60), which is fine for
  carts, pendulums and rolling or bouncing balls. A one-metre free fall gives
  only ~13 frames, so use the video tracker with 240 fps slow motion for fast
  motion.
- **Camera access needs HTTPS** and a user tap, so test on a Vercel preview.
  iPadOS asks for permission once per site in a normal Safari tab.

## Graphs, force and energy (both trackers)

- Graphs are stacked full-width on one linked time axis: displacement,
  velocity, speed and acceleration, then, when a mass is entered, net force
  (`F = ma`, x and y) and the energy stores (kinetic, gravitational potential
  and total overlaid on one axis). Everything except force and energy works
  without a mass.
- **Pinch with two fingers** on a graph to zoom (a sideways pinch stretches
  time only; up-and-down stretches values only), **drag** to scroll when
  zoomed, **double-tap** or press Reset zoom to go back. On a trackpad, pinch
  zooms and a two-finger sideways scroll pans. Zooming or scrolling time on
  one graph moves all of them, so they stay aligned for comparison.
- Leaving the video tracker's known length blank also switches it to
  arbitrary units (1 a.u. = the calibration line).

## How the tracker computes its numbers

- Time is read from `video.currentTime` at the moment of each tap, so the chosen
  frame rate only controls how far each step jumps — it never enters the timings.
  A slow-motion factor divides the playback clock back down to real time.
- Tap positions are stored in normalised (0–1) video coordinates, so rotating the
  iPad or resizing the window cannot corrupt collected data.
- Scale comes from a two-tap calibration line of known length; screen `y` is
  flipped so that upward is positive.
- Velocity uses a central difference (second-order accurate, no lag), with
  one-sided differences at the ends.
- KE uses the full speed (both components); GPE is measured from the origin the
  student chose, so only *changes* in it are meaningful. Total energy is the
  useful teaching line — flat means KE and GPE are trading cleanly.
- Each mark's timestamp is captured into a local before the state update, not
  read inside the updater. React runs updaters during the render pass, by which
  point the auto-advance has already moved the video on — reading the clock
  there stamps every point with the next frame's time.
- Acceleration is reported twice — from a least-squares parabola fitted to `s–t`,
  and from the gradient of a straight line fitted to `v–t`. Agreement between the
  two is a good sanity check for students. The acceleration graph is the
  central difference of the velocity, and net force is mass times that.
- The live tracker scans each camera frame at 320 px wide, takes the centroid
  of pixels matching the target hue (within a search window around the last
  position once locked on), smooths it with a One Euro filter, and fixes one
  scale for the whole run from the median blob diameter so a single flickery
  frame cannot bend the data. Time comes from the camera frame clock
  (`requestVideoFrameCallback`), with `requestAnimationFrame` as a fallback.

## Project structure

```
app/
  layout.tsx          site shell and nav
  page.tsx            tool index
  kinematics/page.tsx tracker route
  live/page.tsx       live tracker route
components/
  VideoTracker.tsx    the video tracker (client component)
  LiveTracker.tsx     camera, frame loop and live UI
  MotionAnalysis.tsx  shared graphs, fits, table and export
  StepBanner.tsx      the "what to do next" banner
  Chart.tsx           dependency-free SVG chart with hover readout, zoom and scroll
lib/
  fit.ts              least-squares fits, central-difference derivative
  motion.ts           samples → velocity, speed, acceleration; unit labels
  colour.ts           colour-blob detection on ImageData
  filter.ts           One Euro filter
  live.ts             live-run scale and finalisation
  view.ts             axis zoom/scroll range maths
  fps.ts              frame-rate detection via requestVideoFrameCallback
  csv.ts              CSV/TSV building, clipboard copy, download
e2e/                  Playwright clickthroughs and synthetic video fixtures
```

## Testing

```bash
npm test              # Vitest unit tests for the pure lib/ modules
npm run e2e:fixtures  # build the synthetic ball videos (needs python3 + Pillow on macOS)
npm run e2e           # Playwright clickthroughs in Chromium with a fake camera
```

The end-to-end tests drive Chromium with `--use-file-for-fake-video-capture`
pointed at a generated Y4M clip of a yellow ball on a parabola, so the live
tracker is exercised exactly as a student would use it: camera on, ring locks,
Start, Stop, graphs, zoom, scroll, export. The video-tracker clickthrough uses
the same clip as VP9/WebM; it is skipped if the fixture is missing.

Every tool page is a client component, because `navigator.mediaDevices` and the
sensor APIs do not exist during server rendering.

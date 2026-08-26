# Physics Tools

Browser-based instruments for physics practical work, built to run on a class
set of iPads. No app install, no student logins — every measurement is taken
and analysed on the device, and nothing is uploaded.

Built with Next.js (App Router), TypeScript and Tailwind CSS. Deployed on
Vercel.

## Tools

| Tool | Status | What it does |
|---|---|---|
| Kinematics video tracker | Ready | Frame-by-frame tap tracking of a filmed motion → s–t and v–t graphs, fitted `u` and `a`, CSV export |
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
- Acceleration is reported twice — from a least-squares parabola fitted to `s–t`,
  and from the gradient of a straight line fitted to `v–t`. Agreement between the
  two is a good sanity check for students.

## Project structure

```
app/
  layout.tsx          site shell and nav
  page.tsx            tool index
  kinematics/page.tsx tracker route
components/
  VideoTracker.tsx    the tracker (client component)
  Chart.tsx           dependency-free SVG chart with hover readout
lib/
  fit.ts              least-squares fits, central-difference derivative
  csv.ts              CSV building and download
```

Every tool page is a client component, because `navigator.mediaDevices` and the
sensor APIs do not exist during server rendering.

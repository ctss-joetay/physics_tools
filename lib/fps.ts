/**
 * Frame-rate detection.
 *
 * HTML5 video exposes no frame-rate property, so the only honest way to learn
 * it is to watch the frames the browser actually presents.
 * `requestVideoFrameCallback` reports each presented frame's `mediaTime`; the
 * spacing between consecutive values is the frame period.
 *
 * Supported in Safari 15.4+, Chrome 83+ and Firefox 132+. Callers must handle
 * a null result and fall back to a manual setting.
 */

type FrameMeta = { mediaTime: number; presentedFrames: number };
type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback: (
    cb: (now: number, meta: FrameMeta) => void,
  ) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};

/** Rates a camera might plausibly have shot at. */
const COMMON_RATES = [
  23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240,
];

/**
 * Snap a noisy measurement onto a standard rate when it is within 5%,
 * so 29.94 becomes 30 rather than a number that looks like a bug.
 */
export function snapFps(fps: number): number {
  let best = fps;
  let bestErr = Infinity;
  for (const rate of COMMON_RATES) {
    const err = Math.abs(rate - fps) / rate;
    if (err < bestErr) {
      bestErr = err;
      best = rate;
    }
  }
  return bestErr < 0.05 ? best : Math.round(fps * 100) / 100;
}

function medianPeriod(times: number[]): number | null {
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    // Discard duplicates and backward steps — a repeated frame is not a period.
    if (d > 1e-4) deltas.push(d);
  }
  if (deltas.length < 3) return null;
  deltas.sort((a, b) => a - b);
  // The median shrugs off the occasional dropped or doubled frame.
  return deltas[Math.floor(deltas.length / 2)];
}

export function supportsFrameCallback(v: HTMLVideoElement | null): boolean {
  return !!v && "requestVideoFrameCallback" in v;
}

/**
 * Play a short muted burst and measure the playback frame rate from it.
 *
 * Note this is the *playback* rate. An iPhone slow-motion clip shot at 240 fps
 * but rendered to play back slowed will measure ~30 — which is the correct step
 * size for scrubbing. Real-world timing is handled separately by the
 * slow-motion factor.
 *
 * Resolves to null when unsupported, when playback is blocked, or when too few
 * frames arrive to be confident.
 */
export function measureFps(
  video: HTMLVideoElement,
  { samples = 24, timeoutMs = 4000 } = {},
): Promise<number | null> {
  if (!supportsFrameCallback(video)) return Promise.resolve(null);
  const v = video as VideoWithRvfc;

  return new Promise((resolve) => {
    const times: number[] = [];
    const restoreTime = v.currentTime;
    const wasMuted = v.muted;
    let finished = false;
    let handle = 0;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (fps: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        v.cancelVideoFrameCallback(handle);
      } catch {
        /* already fired */
      }
      v.pause();
      v.muted = wasMuted;
      try {
        v.currentTime = restoreTime;
      } catch {
        /* not seekable — the caller's own seek will fix this */
      }
      resolve(fps && Number.isFinite(fps) && fps > 1 ? snapFps(fps) : null);
    };

    const onFrame = (_now: number, meta: FrameMeta) => {
      times.push(meta.mediaTime);
      if (times.length >= samples) {
        const period = medianPeriod(times);
        finish(period ? 1 / period : null);
        return;
      }
      handle = v.requestVideoFrameCallback(onFrame);
    };

    // Bail out with whatever we have if playback stalls or is blocked.
    timer = setTimeout(() => {
      const period = medianPeriod(times);
      finish(period ? 1 / period : null);
    }, timeoutMs);

    handle = v.requestVideoFrameCallback(onFrame);
    v.muted = true;
    v.play().catch(() => finish(null));
  });
}

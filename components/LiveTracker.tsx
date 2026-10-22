"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chart, { type Hover } from "./Chart";
import MotionAnalysis from "./MotionAnalysis";
import StepBanner from "./StepBanner";
import {
  DEFAULT_TARGET,
  findBlob,
  hueToCss,
  sampleHue,
  type Blob,
  type Target,
} from "@/lib/colour";
import { OneEuro } from "@/lib/filter";
import {
  finaliseRun,
  LIVE_SCALE_FRAMES,
  MAX_RUN_SECONDS,
  runningMedian,
  scaleFor,
  SENSITIVITY,
  SMOOTHING,
  type RawSample,
} from "@/lib/live";
import { derive, type Sample } from "@/lib/motion";
import type { Range } from "@/lib/view";

type Phase = "off" | "preview" | "recording" | "done";

/** Width of the hidden canvas every frame is scanned at. */
const SCAN_W = 320;
/** Misses in a row before the object counts as lost. */
const LOST_AFTER = 3;
/** How much of the trail to draw, seconds. */
const TRAIL_SECONDS = 2;
/** The scale readout and lost state update at most this often. */
const OVERLAY_MS = 66;
/** Live charts and the clock refresh this often. */
const FLUSH_MS = 100;
const BETA = 0.05;
const DEFAULT_DIAMETER = "0.067"; // a tennis ball

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Smoothing slider 0–100 → One Euro minimum cutoff in Hz (more smoothing = lower cutoff). */
const cutoffFor = (smoothing: number) =>
  SMOOTHING.max - (smoothing / 100) * (SMOOTHING.max - SMOOTHING.min);

function cameraError(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera access needs HTTPS. Open this page from a secure (https://) address.";
  }
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied — allow it in Settings → Safari → Camera, then press Retry.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device.";
  }
  return "The camera could not be started. Close other apps using it and press Retry.";
}

export default function LiveTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Full-resolution copy of the last camera frame, shown once the run is done. */
  const freezeRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("off");
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<{ w: number; h: number } | null>(null);

  const [target, setTarget] = useState<Target>(DEFAULT_TARGET);
  const [smoothing, setSmoothing] = useState(
    Math.round(
      ((SMOOTHING.max - SMOOTHING.default) / (SMOOTHING.max - SMOOTHING.min)) * 100,
    ),
  );
  const [diameter, setDiameter] = useState(DEFAULT_DIAMETER);
  const [mass, setMass] = useState("");
  const [gravity, setGravity] = useState("9.81");

  const [blob, setBlob] = useState<Blob | null>(null);
  const [lost, setLost] = useState(false);
  const [trail, setTrail] = useState<RawSample[]>([]);
  const [liveData, setLiveData] = useState<Sample[]>([]);
  const [liveScale, setLiveScale] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [sampleMsg, setSampleMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnType<typeof finaliseRun>>(null);
  const [tooFew, setTooFew] = useState(false);
  /** Setup rail over the camera view; can be folded away if it hides the ball. */
  const [railOpen, setRailOpen] = useState(true);
  // The two live graphs share one time view and one hovered/pinned instant.
  const [liveView, setLiveView] = useState<Range | null>(null);
  const [liveHover, setLiveHover] = useState<Hover | null>(null);

  // ------------------------------------------------------------ refs

  const streamRef = useRef<MediaStream | null>(null);
  const loopHandle = useRef<{ kind: "rvfc" | "raf"; id: number } | null>(null);
  const phaseRef = useRef<Phase>("off");
  phaseRef.current = phase;
  const targetRef = useRef(target);
  targetRef.current = target;
  const diameterRef = useRef(diameter);
  diameterRef.current = diameter;
  const scanRef = useRef(scan);
  scanRef.current = scan;

  /** Which clock this stream's frames are stamped with — decided once per stream. */
  const clockRef = useRef<"media" | "perf" | null>(null);
  /** Wall-clock time of the Start press; drives the on-screen clock and the cap. */
  const startedAtRef = useRef(0);
  /** Guards against a second tap on Start camera / New run while the first is pending. */
  const startingRef = useRef(false);
  const [maxRun, setMaxRun] = useState(MAX_RUN_SECONDS);
  const maxRunRef = useRef(MAX_RUN_SECONDS);
  const [stopNote, setStopNote] = useState<string | null>(null);

  // `?maxRun=<seconds>` shortens the cap so the auto-stop can be exercised
  // by the end-to-end tests without waiting a full minute.
  useEffect(() => {
    const n = parseFloat(new URLSearchParams(window.location.search).get("maxRun") ?? "");
    if (Number.isFinite(n) && n > 0) {
      setMaxRun(n);
      maxRunRef.current = n;
    }
  }, []);

  const rawRef = useRef<RawSample[]>([]);
  const recentRef = useRef<RawSample[]>([]); // for the trail in preview too
  const lastBlobRef = useRef<Blob | null>(null);
  const lostFramesRef = useRef(0);
  const t0Ref = useRef(0);
  const lastOverlayRef = useRef(0);
  const fx = useRef(new OneEuro({ minCutoff: SMOOTHING.default, beta: BETA }));
  const fy = useRef(new OneEuro({ minCutoff: SMOOTHING.default, beta: BETA }));

  useEffect(() => {
    const c = cutoffFor(smoothing);
    fx.current.setOptions({ minCutoff: c });
    fy.current.setOptions({ minCutoff: c });
  }, [smoothing]);

  // ------------------------------------------------------------ camera

  const stopLoop = useCallback(() => {
    const h = loopHandle.current;
    const v = videoRef.current as VideoWithRvfc | null;
    if (h && v) {
      if (h.kind === "rvfc") v.cancelVideoFrameCallback?.(h.id);
      else cancelAnimationFrame(h.id);
    }
    loopHandle.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, [stopLoop]);

  /** One frame: scan, filter, record, and throttle the overlay. */
  const processFrame = useCallback((tSeconds: number) => {
    const v = videoRef.current;
    const c = canvasRef.current;
    const dims = scanRef.current;
    if (!v || !c || !dims || v.readyState < 2) return;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, dims.w, dims.h);
    const img = ctx.getImageData(0, 0, dims.w, dims.h);

    const prev = lastBlobRef.current;
    const win = prev
      ? {
          x: prev.cx - 1.5 * prev.diameter,
          y: prev.cy - 1.5 * prev.diameter,
          w: 3 * prev.diameter,
          h: 3 * prev.diameter,
        }
      : null;
    let found = findBlob(img, targetRef.current, win);
    // A miss inside the window may just be a fast move; look everywhere once.
    if (!found && win) found = findBlob(img, targetRef.current, null);

    const now = performance.now();
    if (!found) {
      lostFramesRef.current++;
      if (lostFramesRef.current >= LOST_AFTER) {
        lastBlobRef.current = null;
        fx.current.reset();
        fy.current.reset();
        if (now - lastOverlayRef.current > OVERLAY_MS) {
          lastOverlayRef.current = now;
          setLost(true);
          setBlob(null);
        }
      }
      return;
    }

    lostFramesRef.current = 0;
    lastBlobRef.current = found;
    const sx = fx.current.filter(found.cx, tSeconds);
    const sy = fy.current.filter(found.cy, tSeconds);
    const sample: RawSample = {
      t: tSeconds - t0Ref.current,
      px: sx / dims.w,
      py: sy / dims.h,
      diameter: found.diameter,
    };
    if (phaseRef.current === "recording") rawRef.current.push(sample);
    const recent = recentRef.current;
    recent.push(sample);
    while (recent.length && sample.t - recent[0].t > TRAIL_SECONDS) recent.shift();

    // The ring sits on the raw detection every frame so it visibly stays on
    // the ball; the trail and the data use the smoothed position.
    setBlob(found);
    setTrail([...recent]);
    if (now - lastOverlayRef.current > OVERLAY_MS) {
      lastOverlayRef.current = now;
      setLost(false);
      const med = runningMedian(
        recent.map((s) => s.diameter),
        LIVE_SCALE_FRAMES,
      );
      const sc = scaleFor(diameterRef.current, med);
      setLiveScale(
        sc
          ? `scale: ${Math.round(1 / sc.perPx)} px per ${sc.unit === "m" ? "m" : "a.u."}`
          : null,
      );
    }
  }, []);

  const startLoop = useCallback(() => {
    const v = videoRef.current as VideoWithRvfc | null;
    if (!v) return;
    stopLoop();
    if (typeof v.requestVideoFrameCallback === "function") {
      const tick = (now: number, meta: { mediaTime: number }) => {
        // mediaTime is the camera's own frame clock. Some browsers report 0
        // for live streams; decide once per stream so one run never mixes
        // two clocks with different origins.
        if (clockRef.current === null) {
          clockRef.current = meta.mediaTime > 0 ? "media" : "perf";
        }
        const t = clockRef.current === "media" ? meta.mediaTime : now / 1000;
        processFrame(t);
        if (loopHandle.current) {
          loopHandle.current = { kind: "rvfc", id: v.requestVideoFrameCallback!(tick) };
        }
      };
      loopHandle.current = { kind: "rvfc", id: v.requestVideoFrameCallback(tick) };
    } else {
      const tick = (now: number) => {
        processFrame(now / 1000);
        if (loopHandle.current) {
          loopHandle.current = { kind: "raf", id: requestAnimationFrame(tick) };
        }
      };
      loopHandle.current = { kind: "raf", id: requestAnimationFrame(tick) };
    }
  }, [processFrame, stopLoop]);

  const startCamera = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setError(null);
    setStopNote(null);
    setTooFew(false);
    setResult(null);
    setLiveData([]);
    setLiveView(null);
    setLiveHover(null);
    rawRef.current = [];
    recentRef.current = [];
    lastBlobRef.current = null;
    lostFramesRef.current = 0;
    t0Ref.current = 0;
    clockRef.current = null;
    fx.current.reset();
    fy.current.reset();
    setBlob(null);
    setLost(false);
    setTrail([]);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("unsupported");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          frameRate: { ideal: 60 },
        },
        audio: false,
      });
      const v = videoRef.current;
      if (!v || streamRef.current) {
        // Unmounted meanwhile, or a stream is already running: never hold two.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      v.srcObject = stream;
      await new Promise<void>((res) => {
        if (v.readyState >= 1) res();
        else v.onloadedmetadata = () => res();
      });
      await v.play();
      const sizeScan = () => {
        const w = SCAN_W;
        const h = Math.max(1, Math.round((SCAN_W * v.videoHeight) / v.videoWidth));
        const c = canvasRef.current;
        if (c) {
          c.width = w;
          c.height = h;
        }
        setScan({ w, h });
        scanRef.current = { w, h };
        lastBlobRef.current = null;
      };
      sizeScan();
      // Rotating the iPad swaps the frame's width and height. In preview we
      // just re-measure; mid-run the scale would no longer be consistent, so
      // the run ends with what was recorded and the student is told why.
      v.onresize = () => {
        if (!v.videoWidth || !v.videoHeight) return;
        const cur = scanRef.current;
        const h = Math.round((SCAN_W * v.videoHeight) / v.videoWidth);
        if (cur && cur.h === h) return;
        if (phaseRef.current === "recording") {
          setStopNote(
            "The camera view changed shape (was the iPad rotated?), so the run was stopped here.",
          );
          stopRef.current();
        } else {
          sizeScan();
        }
      };
      stream.getVideoTracks()[0].onended = () => {
        if (phaseRef.current === "recording") stopRef.current();
        else {
          stopCamera();
          setPhase("off");
          setError("The camera stopped unexpectedly. Press Retry.");
        }
      };
      setPhase("preview");
      startLoop();
    } catch (err) {
      stopCamera();
      setPhase("off");
      setError(cameraError(err));
    } finally {
      startingRef.current = false;
    }
  }, [startLoop, stopCamera]);

  const start = useCallback(() => {
    rawRef.current = [];
    // Time zero is now: the next frame's t is measured from here.
    const last = recentRef.current[recentRef.current.length - 1];
    t0Ref.current = last ? last.t + t0Ref.current : 0;
    recentRef.current = [];
    startedAtRef.current = performance.now();
    setLiveData([]);
    setLiveView(null);
    setLiveHover(null);
    setElapsed(0);
    setPhase("recording");
  }, []);

  function stop() {
    const v = videoRef.current;
    const fz = freezeRef.current;
    if (v && fz && v.videoWidth) {
      fz.width = v.videoWidth;
      fz.height = v.videoHeight;
      fz.getContext("2d")?.drawImage(v, 0, 0);
    }
    stopCamera();
    const dims = scanRef.current;
    const r = dims
      ? finaliseRun(rawRef.current, diameterRef.current, dims.w, dims.h)
      : null;
    setResult(r);
    setTooFew(!r);
    setPhase("done");
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Live charts, clock and the 60 s cap while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const dims = scanRef.current;
      const raw = rawRef.current;
      if (dims && raw.length >= 2) {
        setLiveData(
          finaliseRun(raw, diameterRef.current, dims.w, dims.h)?.data ?? [],
        );
      }
      // Wall time, not sample time: the cap must fire even if the object
      // has left the frame and no samples are arriving.
      const e = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(e);
      if (e >= maxRunRef.current) stopRef.current();
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, [phase]);

  // Changing the diameter after Stop re-scales the stored run; nothing has
  // to be repeated physically.
  useEffect(() => {
    if (phase !== "done") return;
    const dims = scanRef.current;
    if (!dims) return;
    const r = finaliseRun(rawRef.current, diameter, dims.w, dims.h);
    setResult(r);
    setTooFew(!r);
  }, [diameter, phase]);

  // Release the camera if the student navigates away.
  useEffect(() => () => stopCamera(), [stopCamera]);

  // ------------------------------------------------------------ tap to sample

  const onSurfaceTap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phase !== "preview") return;
    const c = canvasRef.current;
    const dims = scan;
    const el = surfaceRef.current;
    if (!c || !dims || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * dims.w);
    const y = Math.round(((e.clientY - r.top) / r.height) * dims.h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, dims.w, dims.h);
    const hue = sampleHue(img, x, y, 4);
    if (hue === null) {
      setSampleMsg("That spot isn't a bright colour — tap the ball itself.");
    } else {
      setTarget((t) => ({ ...t, hue }));
      setSampleMsg(`Now tracking hue ${Math.round(hue)}°.`);
      lastBlobRef.current = null;
    }
    setTimeout(() => setSampleMsg(null), 2500);
  };

  // ------------------------------------------------------------ derived

  const live = useMemo(() => derive(liveData), [liveData]);
  const liveSeries = useMemo(
    () => ({
      s: [
        { name: "x", color: "var(--series-1)", points: live.xPts.map((p) => ({ x: p.t, y: p.s })) },
        { name: "y", color: "var(--series-2)", points: live.yPts.map((p) => ({ x: p.t, y: p.s })) },
      ],
      v: [
        { name: "vx", color: "var(--series-1)", points: live.vxPts.map((p) => ({ x: p.t, y: p.s })) },
        { name: "vy", color: "var(--series-2)", points: live.vyPts.map((p) => ({ x: p.t, y: p.s })) },
      ],
    }),
    [live],
  );
  const liveDomain = useMemo<Range | undefined>(
    () =>
      liveData.length ? [liveData[0].t, liveData[liveData.length - 1].t] : undefined,
    [liveData],
  );
  const liveLink = {
    xDomain: liveDomain,
    xView: liveView,
    onXViewChange: setLiveView,
    hover: liveHover,
    onHoverChange: setLiveHover,
  };
  const massKg = parseFloat(mass);
  const g = parseFloat(gravity);
  const diameterBlank = !(parseFloat(diameter) > 0);

  const banner = (() => {
    switch (phase) {
      case "off":
        return {
          step: "Step 1 of 3 — Camera",
          instruction: "Press Start camera, then allow camera access.",
          tone: "info" as const,
        };
      case "preview":
        return blob
          ? {
              step: "Step 2 of 3 — Ready",
              instruction: "The ring is on the object. Check the settings, then press Start.",
              tone: "info" as const,
            }
          : {
              step: "Step 2 of 3 — Find the object",
              instruction:
                "Point the camera at a bright yellow or orange ball. If the ring doesn't lock on, tap the ball to sample its colour.",
              tone: "info" as const,
            };
      case "recording":
        return {
          step: "Step 3 of 3 — Recording",
          instruction: "Let the motion happen. Press Stop when it is done.",
          tone: "live" as const,
          hint: `Recording stops by itself after ${maxRun} s.`,
        };
      case "done":
        return {
          step: "Done",
          instruction: "Scroll down for graphs and data, or press New run to go again.",
          tone: "done" as const,
        };
    }
  })();

  const ring = blob && scan ? Math.max(blob.diameter / 2, 4) : 0;
  const remaining = maxRun - elapsed;

  // ------------------------------------------------------------ fields

  // Shared by the setup rail (before a run) and the panel under the video
  // (after Stop, when only the numbers that feed the analysis still matter).
  const diameterField = (
    <label className="block text-[15px]">
      <span className="text-[var(--text-secondary)]">Object diameter / m</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.001"
        min="0"
        placeholder="blank = arbitrary units"
        value={diameter}
        onChange={(e) => setDiameter(e.target.value)}
        data-testid="diameter-input"
        className="tabular mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
      />
      <span className="mt-1 block text-[13px] text-[var(--text-muted)]">
        {diameterBlank
          ? "Blank → arbitrary units (1 a.u. = one object diameter)"
          : "Estimated diameter of the object (tennis ball ≈ 0.067)"}
      </span>
    </label>
  );

  const massField = (
    <label className="block text-[15px]">
      <span className="text-[var(--text-secondary)]">Mass / kg</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.001"
        min="0"
        placeholder="optional"
        value={mass}
        onChange={(e) => setMass(e.target.value)}
        data-testid="mass-input"
        className="tabular mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
      />
      <span className="mt-1 block text-[13px] text-[var(--text-muted)]">
        {diameterBlank
          ? "Force and energy need a real diameter as well as a mass"
          : "Enter a mass to unlock the force and energy graphs"}
      </span>
    </label>
  );

  const gravityField = (
    <label className="block text-[15px]">
      <span className="text-[var(--text-secondary)]">g / m s⁻²</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={gravity}
        onChange={(e) => setGravity(e.target.value)}
        className="tabular mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
      />
      <span className="mt-1 block text-[13px] text-[var(--text-muted)]">
        Used for GPE — set 10 if that is your syllabus convention
      </span>
    </label>
  );

  // ------------------------------------------------------------ render

  return (
    <div className="space-y-6">
      <StepBanner {...banner} />

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--critical)]/40 bg-[var(--surface-1)] p-4 text-[15px] leading-relaxed"
        >
          <p className="font-medium">Camera problem</p>
          <p className="mt-1 text-[var(--text-secondary)]">{error}</p>
        </div>
      )}

      {phase === "off" && (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-8 text-center">
          <h2 className="text-[17px] font-medium">Track a moving object live</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[var(--text-secondary)]">
            Prop the iPad up so it does not move, point it side-on at the
            motion, and use a bright yellow or orange ball. Good, even light
            helps the tracker a lot.
          </p>
          <button
            type="button"
            onClick={() => void startCamera()}
            data-testid="primary-action"
            className="mt-5 rounded-lg bg-[var(--series-1)] px-4 py-2.5 text-[16px] font-medium text-white"
          >
            {error ? "Retry" : "Start camera"}
          </button>
        </div>
      )}

      <div className={phase === "off" ? "hidden" : "space-y-3"}>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
          <div className="relative">
          <div
            ref={surfaceRef}
            data-tap-surface
            onPointerUp={onSurfaceTap}
            className="relative w-full select-none overflow-hidden rounded-lg bg-black"
            style={{
              aspectRatio: scan ? scan.w / scan.h : 16 / 9,
              touchAction: "manipulation",
            }}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute inset-0 h-full w-full object-fill"
            />
            <canvas ref={canvasRef} className="hidden" />
            <canvas
              ref={freezeRef}
              data-testid="freeze-frame"
              className={`absolute inset-0 h-full w-full object-fill ${phase === "done" ? "" : "hidden"}`}
            />

            {scan && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${scan.w} ${scan.h}`}
              >
                {trail.length >= 2 && (
                  <polyline
                    points={trail
                      .map((s) => `${s.px * scan.w},${s.py * scan.h}`)
                      .join(" ")}
                    fill="none"
                    stroke={phase === "recording" ? "#e34948" : "#ffffff"}
                    strokeOpacity={0.7}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    data-testid="trail"
                  />
                )}
                {blob && (
                  <g data-testid="track-ring">
                    <circle
                      cx={blob.cx}
                      cy={blob.cy}
                      r={ring}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={2.5}
                    />
                    <circle
                      cx={blob.cx}
                      cy={blob.cy}
                      r={ring}
                      fill="none"
                      stroke={phase === "recording" ? "#e34948" : "#1baf7a"}
                      strokeWidth={1.5}
                    />
                    <circle cx={blob.cx} cy={blob.cy} r={1.5} fill="#ffffff" />
                  </g>
                )}
              </svg>
            )}

            {phase !== "done" && lost && (
              <div
                data-testid="lost-badge"
                className={`absolute top-2 rounded-md bg-black/70 px-2 py-1 text-[14px] text-white ${
                  phase === "preview" ? "right-2" : "left-2"
                }`}
              >
                {phase === "recording"
                  ? "Lost — looking…"
                  : "Looking for a yellow/orange object…"}
              </div>
            )}

            {phase === "recording" && (
              <div className="tabular absolute right-2 top-2 flex items-center gap-2 rounded-md bg-black/70 px-2 py-1 text-[14px] text-white">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#e34948]" />
                {remaining <= 10
                  ? `${Math.max(0, remaining).toFixed(0)} s left`
                  : `${elapsed.toFixed(1)} s`}
              </div>
            )}

            {sampleMsg && (
              <div
                className={`absolute bottom-2 right-2 rounded-md bg-black/70 px-3 py-1.5 text-center text-[14px] text-white ${
                  phase === "preview" && railOpen ? "left-2 sm:left-[21rem]" : "left-2"
                }`}
              >
                {sampleMsg}
              </div>
            )}
          </div>

          {/* Setup rail: over the left of the camera view on tablets and up,
              stacked under it on phones. A sibling of the tap surface, so
              touching a control never samples a colour. */}
          {phase === "preview" && (
            <aside
              data-testid="setup-rail"
              className={`mt-3 flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface-1)] sm:absolute sm:left-2 sm:top-2 sm:mt-0 sm:w-80 sm:bg-[var(--surface-1)]/90 sm:shadow-lg sm:backdrop-blur ${
                railOpen ? "sm:bottom-2" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2 px-3 pt-3">
                <h3 className="text-[16px] font-medium">Set up before you start</h3>
                <button
                  type="button"
                  onClick={() => setRailOpen((o) => !o)}
                  aria-expanded={railOpen}
                  className="hidden rounded-md border border-[var(--border)] px-2 py-1 text-[13px] text-[var(--text-secondary)] sm:block"
                >
                  {railOpen ? "Hide" : "Settings"}
                </button>
              </div>

              <div
                className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pt-3 ${
                  railOpen ? "" : "sm:hidden"
                }`}
              >
                <div className="text-[15px]">
                  <span className="text-[var(--text-secondary)]">Target colour</span>
                  <div className="mt-2 flex items-center gap-3">
                    <span
                      data-testid="sample-swatch"
                      aria-label={`target hue ${Math.round(target.hue)} degrees`}
                      className="inline-block h-8 w-8 shrink-0 rounded-full border border-[var(--border)]"
                      style={{ background: hueToCss(target.hue) }}
                    />
                    <button
                      type="button"
                      onClick={() => setTarget((t) => ({ ...t, hue: DEFAULT_TARGET.hue }))}
                      disabled={target.hue === DEFAULT_TARGET.hue}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[14px] disabled:opacity-40"
                    >
                      Reset to yellow/orange
                    </button>
                  </div>
                  <span className="mt-1 block text-[13px] text-[var(--text-muted)]">
                    Tap the object in the camera view to track a different colour
                  </span>
                </div>

                <label className="block text-[15px]">
                  <span className="text-[var(--text-secondary)]">
                    Colour detection sensitivity
                  </span>
                  <input
                    type="range"
                    min={SENSITIVITY.min}
                    max={SENSITIVITY.max}
                    step={1}
                    value={target.tolerance}
                    onChange={(e) =>
                      setTarget((t) => ({ ...t, tolerance: parseInt(e.target.value, 10) }))
                    }
                    className="mt-2 w-full accent-[var(--series-1)]"
                  />
                  <span className="flex justify-between text-[13px] text-[var(--text-secondary)]">
                    <span>Strict</span>
                    <span>Loose</span>
                  </span>
                  <span className="mt-1 block text-[13px] text-[var(--text-muted)]">
                    Strict only accepts colours very close to your object; loose
                    accepts nearby shades too
                  </span>
                </label>

                {diameterField}

                <label className="block text-[15px]">
                  <span className="text-[var(--text-secondary)]">Smoothing</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={smoothing}
                    onChange={(e) => setSmoothing(parseInt(e.target.value, 10))}
                    className="mt-2 w-full accent-[var(--series-1)]"
                  />
                  <span className="mt-1 block text-[13px] text-[var(--text-muted)]">
                    More smoothing steadies a jittery dot but lags fast motion
                  </span>
                </label>

                {/* Optional, and still editable after Stop, so folded away. */}
                <details className="text-[15px]">
                  <summary className="cursor-pointer text-[var(--text-secondary)]">
                    Force &amp; energy (optional)
                  </summary>
                  <div className="mt-3 space-y-4">
                    {massField}
                    {gravityField}
                  </div>
                </details>
              </div>

              <div className="space-y-2 border-t border-[var(--border)] p-3 sm:mt-3">
                <p className="text-[14px] text-[var(--text-muted)]">
                  {blob ? "Object found." : "Waiting for a bright yellow/orange object…"}
                </p>
                {liveScale && (
                  <p data-testid="scale-readout" className="tabular text-[14px] text-[var(--text-muted)]">
                    {liveScale}
                  </p>
                )}
                <button
                  type="button"
                  onClick={start}
                  disabled={!blob}
                  data-testid="primary-action"
                  className="w-full rounded-lg bg-[var(--series-1)] px-4 py-2.5 text-[16px] font-medium text-white disabled:opacity-40"
                >
                  Start
                </button>
              </div>
            </aside>
          )}
          </div>

          {phase !== "preview" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {phase === "recording" && (
              <button
                type="button"
                onClick={() => stop()}
                data-testid="primary-action"
                className="rounded-lg bg-[var(--critical)] px-4 py-2.5 text-[16px] font-medium text-white"
              >
                Stop
              </button>
            )}
            {phase === "done" && (
              <button
                type="button"
                onClick={() => void startCamera()}
                data-testid="primary-action"
                className="rounded-lg bg-[var(--series-1)] px-4 py-2.5 text-[16px] font-medium text-white"
              >
                New run
              </button>
            )}
            {liveScale && phase === "recording" && (
              <span
                data-testid="scale-readout"
                className="tabular ml-auto text-[14px] text-[var(--text-muted)]"
              >
                {liveScale}
              </span>
            )}
          </div>
          )}
        </div>

        {stopNote && (
          <p role="status" className="px-1 text-[15px] text-[var(--text-secondary)]">
            {stopNote}
          </p>
        )}

        {phase === "done" && (
          <div className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 sm:grid-cols-3">
            {diameterField}
            {massField}
            {gravityField}
          </div>
        )}
        {phase === "recording" && (
          <section className="space-y-3" data-testid="live-charts">
            <h3 className="px-1 text-[16px] font-medium">Live graphs</h3>
            <Chart
              title="Displacement–time"
              xLabel="time / s"
              yLabel={`displacement / ${diameterBlank ? "a.u." : "m"}`}
              unit={diameterBlank ? "a.u." : "m"}
              height={260}
              series={liveSeries.s}
              {...liveLink}
            />
            <Chart
              title="Velocity–time"
              xLabel="time / s"
              yLabel={`velocity / ${diameterBlank ? "a.u." : "m"} s⁻¹`}
              unit={`${diameterBlank ? "a.u." : "m"} s⁻¹`}
              height={260}
              series={liveSeries.v}
              {...liveLink}
            />
          </section>
        )}

        {phase === "done" && tooFew && (
          <div
            data-testid="too-few"
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-[15px] text-[var(--text-secondary)]"
          >
            Not enough points — the object was not seen during the recording.
            Check the colour and lighting, then press New run.
          </div>
        )}

        {phase === "done" && result && (
          <>
            <p className="px-1 text-[14px] text-[var(--text-muted)]" data-testid="final-scale">
              Scale fixed for this run: {Math.round(1 / result.perPx)} px per{" "}
              {result.unit}. {result.data.length} points over{" "}
              {result.data[result.data.length - 1].t.toFixed(1)} s.
            </p>
            <MotionAnalysis
              data={result.data}
              massKg={Number.isFinite(massKg) && massKg > 0 ? massKg : undefined}
              g={Number.isFinite(g) && g > 0 ? g : undefined}
              unit={result.unit}
              csvFilename="live-tracker-data.csv"
              auNote="No real length was given, so distances are in arbitrary units (1 a.u. = one object diameter)."
            />
          </>
        )}
      </div>
    </div>
  );
}

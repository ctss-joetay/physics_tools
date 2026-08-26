"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chart from "./Chart";
import { derivative, fitLinear, fitQuadratic, sig, type Pt } from "@/lib/fit";
import { copyText, downloadCsv, toCsv, toTsv } from "@/lib/csv";
import { measureFps, supportsFrameCallback } from "@/lib/fps";

/** A tap, stored in normalised video coordinates so it survives resize and zoom. */
type Mark = { t: number; u: number; v: number };

type TapMode = "calA" | "calB" | "origin" | "track";
type LoadState = "idle" | "loading" | "ready" | "error";
type FpsStatus = "manual" | "detecting" | "detected" | "failed";
/** Pan/zoom of the viewing surface. Content origin is top-left. */
type View = { k: number; tx: number; ty: number };

const FPS_SUGGESTIONS = [24, 25, 30, 60, 120, 240];
const SLOWMO_OPTIONS = [1, 2, 4, 8];
const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
/** Finger movement below this many pixels still counts as a tap, not a drag. */
const TAP_SLOP = 10;
const IDENTITY: View = { k: 1, tx: 0, ty: 0 };

const BASE_HEADERS = ["t / s", "x / m", "y / m", "vx / m s^-1", "vy / m s^-1"];
const ENERGY_HEADERS = ["KE / J", "GPE / J", "total E / J"];

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** Keep the content covering the viewport — no dragging it off into space. */
function clampView(v: View, w: number, h: number): View {
  const k = clamp(v.k, MIN_ZOOM, MAX_ZOOM);
  return {
    k,
    tx: clamp(v.tx, w * (1 - k), 0),
    ty: clamp(v.ty, h * (1 - k), 0),
  };
}

export default function VideoTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{
    name: string;
    type: string;
  } | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [slowLoad, setSlowLoad] = useState(false);

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const [tapMode, setTapMode] = useState<TapMode>("calA");
  const [fps, setFps] = useState(30);
  const [fpsStatus, setFpsStatus] = useState<FpsStatus>("manual");
  const [slowmo, setSlowmo] = useState(1);
  const [mass, setMass] = useState("");
  const [gravity, setGravity] = useState("9.81");

  const [calA, setCalA] = useState<{ u: number; v: number } | null>(null);
  const [calB, setCalB] = useState<{ u: number; v: number } | null>(null);
  const [calMetres, setCalMetres] = useState("1");
  const [origin, setOrigin] = useState<{ u: number; v: number } | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);

  const [view, setView] = useState<View>(IDENTITY);
  const [copied, setCopied] = useState(false);

  // Object URLs must be revoked or the blob leaks for the life of the tab.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // A clip stuck in "loading" is usually a codec this browser cannot decode,
  // which otherwise just looks like an unexplained black rectangle.
  useEffect(() => {
    if (loadState !== "loading") {
      setSlowLoad(false);
      return;
    }
    const id = setTimeout(() => setSlowLoad(true), 6000);
    return () => clearTimeout(id);
  }, [loadState]);

  const resetCalibration = useCallback(() => {
    setCalA(null);
    setCalB(null);
    setOrigin(null);
    setMarks([]);
    setTapMode("calA");
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setFileMeta({ name: file.name, type: file.type });
    setLoadState("loading");
    setFpsStatus("manual");
    setDims(null);
    setDuration(0);
    setCurrentTime(0);
    setView(IDENTITY);
    resetCalibration();
    e.target.value = ""; // allow re-picking the same file
  };

  /** Measure the clip's playback frame rate from the frames it presents. */
  const detectFps = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !supportsFrameCallback(v)) {
      setFpsStatus("failed");
      return;
    }
    setFpsStatus("detecting");
    const measured = await measureFps(v);
    if (measured) {
      setFps(measured);
      setFpsStatus("detected");
    } else {
      setFpsStatus("failed");
    }
    setCurrentTime(v.currentTime);
  }, []);

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    // A readable container whose video track cannot be decoded reports 0x0.
    if (!v.videoWidth || !v.videoHeight) {
      setLoadState("error");
      return;
    }
    setDims({ w: v.videoWidth, h: v.videoHeight });
    setDuration(v.duration);
    // Safari paints nothing until a frame has actually been decoded, which
    // reads as a black box. Nudging the clock forces that first decode.
    try {
      v.currentTime = Math.min(0.001, (v.duration || 1) / 2);
    } catch {
      /* not seekable yet — onLoadedData will still mark it ready */
    }
    void detectFps();
  };

  const seekBy = useCallback(
    (frames: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.pause();
      v.currentTime = clamp(v.currentTime + frames / fps, 0, v.duration);
    },
    [fps],
  );

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.pause();
    v.currentTime = clamp(t, 0, v.duration);
  }, []);

  // ------------------------------------------------------------- gestures

  /** Live pointers, in coordinates local to the viewing surface. */
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    dist: number;
    midX: number;
    midY: number;
    view: View;
  } | null>(null);
  const tapCandidate = useRef<{ x: number; y: number; id: number } | null>(null);
  const sawSecondFinger = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const handleTap = (clientX: number, clientY: number) => {
    const el = innerRef.current;
    const v = videoRef.current;
    if (!el) return;
    // The inner element carries the zoom transform, so its own bounding box
    // already accounts for scale and pan — no inverse maths needed here, and
    // a point tapped at 6x lands on exactly the same video pixel as at 1x.
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const u = clamp((clientX - r.left) / r.width, 0, 1);
    const vv = clamp((clientY - r.top) / r.height, 0, 1);

    if (tapMode === "calA") {
      setCalA({ u, v: vv });
      setTapMode("calB");
    } else if (tapMode === "calB") {
      setCalB({ u, v: vv });
      setTapMode("origin");
    } else if (tapMode === "origin") {
      setOrigin({ u, v: vv });
      setTapMode("track");
    } else {
      if (!v) return;
      // Read the clock NOW, into a local. A state updater runs during the
      // render pass — by then seekBy() below has already moved the video on,
      // and the mark would be stamped with the next frame's time.
      const stamp = v.currentTime;
      setMarks((prev) =>
        [...prev, { t: stamp, u, v: vv }].sort((a, b) => a.t - b.t),
      );
      seekBy(1);
    }
  };

  const localPoint = (e: React.PointerEvent) => {
    const rect = outerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = outerRef.current;
    if (!el) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released — capture is an optimisation, not required */
    }
    ptrs.current.set(e.pointerId, localPoint(e));

    if (ptrs.current.size === 1) {
      tapCandidate.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      sawSecondFinger.current = false;
    } else if (ptrs.current.size === 2) {
      // Second finger down — this gesture is a zoom/pan, never a tap.
      sawSecondFinger.current = true;
      tapCandidate.current = null;
      const [a, b] = [...ptrs.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        view: viewRef.current,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = outerRef.current;
    if (!el || !ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, localPoint(e));

    if (ptrs.current.size === 1 && tapCandidate.current) {
      const moved = Math.hypot(
        e.clientX - tapCandidate.current.x,
        e.clientY - tapCandidate.current.y,
      );
      if (moved > TAP_SLOP) tapCandidate.current = null;
      return;
    }

    if (ptrs.current.size >= 2 && pinch.current) {
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const g = pinch.current;
      const rect = el.getBoundingClientRect();

      const k = clamp((g.view.k * dist) / g.dist, MIN_ZOOM, MAX_ZOOM);
      // The content point under the starting midpoint stays under the current
      // midpoint, so pinching zooms and sliding both fingers pans — together.
      const px = (g.midX - g.view.tx) / g.view.k;
      const py = (g.midY - g.view.ty) / g.view.k;
      setView(
        clampView(
          { k, tx: midX - k * px, ty: midY - k * py },
          rect.width,
          rect.height,
        ),
      );
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, fire: boolean) => {
    const el = outerRef.current;
    const cand = tapCandidate.current;
    const wasSingle = ptrs.current.size === 1;
    ptrs.current.delete(e.pointerId);
    try {
      if (el?.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }

    if (
      fire &&
      cand &&
      wasSingle &&
      !sawSecondFinger.current &&
      cand.id === e.pointerId
    ) {
      handleTap(e.clientX, e.clientY);
    }

    if (ptrs.current.size < 2) pinch.current = null;
    if (ptrs.current.size === 0) {
      tapCandidate.current = null;
      sawSecondFinger.current = false;
    }
  };

  /** Zoom about a point — shared by the wheel handler and the +/− buttons. */
  const zoomAbout = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = outerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = cx ?? rect.width / 2;
    const my = cy ?? rect.height / 2;
    setView((cur) => {
      const k = clamp(cur.k * factor, MIN_ZOOM, MAX_ZOOM);
      const px = (mx - cur.tx) / cur.k;
      const py = (my - cur.ty) / cur.k;
      return clampView(
        { k, tx: mx - k * px, ty: my - k * py },
        rect.width,
        rect.height,
      );
    });
  }, []);

  // Wheel/trackpad zoom needs a non-passive listener to call preventDefault.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAbout(
        Math.exp(-e.deltaY * 0.002),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAbout, videoUrl]);

  // Keep the view legal when the surface resizes or the iPad is rotated.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setView((cur) => clampView(cur, r.width, r.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [videoUrl]);

  // ------------------------------------------------------------- analysis

  const mPerPx = useMemo(() => {
    if (!calA || !calB || !dims) return null;
    const metres = parseFloat(calMetres);
    if (!Number.isFinite(metres) || metres <= 0) return null;
    const dx = (calA.u - calB.u) * dims.w;
    const dy = (calA.v - calB.v) * dims.h;
    const px = Math.hypot(dx, dy);
    if (px < 1) return null; // both taps landed on the same spot
    return metres / px;
  }, [calA, calB, calMetres, dims]);

  const data = useMemo(() => {
    if (!mPerPx || !dims || marks.length === 0) return [];
    // Two taps on the same frame would give a zero time step, which the
    // derivative cannot use and which would misalign the velocity arrays.
    const unique = marks.filter(
      (m, i) => i === 0 || m.t - marks[i - 1].t > 1e-6,
    );
    const o = origin ?? { u: unique[0].u, v: unique[0].v };
    const t0 = unique[0].t;
    return unique.map((m) => ({
      // Slow-motion footage plays back stretched, so real time runs faster.
      t: (m.t - t0) / slowmo,
      x: (m.u - o.u) * dims.w * mPerPx,
      // Screen y grows downward; physics y grows upward.
      y: -(m.v - o.v) * dims.h * mPerPx,
    }));
  }, [marks, mPerPx, dims, origin, slowmo]);

  const xPts: Pt[] = useMemo(
    () => data.map((d) => ({ t: d.t, s: d.x })),
    [data],
  );
  const yPts: Pt[] = useMemo(
    () => data.map((d) => ({ t: d.t, s: d.y })),
    [data],
  );
  const vxPts = useMemo(() => derivative(xPts), [xPts]);
  const vyPts = useMemo(() => derivative(yPts), [yPts]);

  const fitX = useMemo(() => fitQuadratic(xPts), [xPts]);
  const fitY = useMemo(() => fitQuadratic(yPts), [yPts]);
  const fitVx = useMemo(() => fitLinear(vxPts), [vxPts]);
  const fitVy = useMemo(() => fitLinear(vyPts), [vyPts]);

  const massKg = parseFloat(mass);
  const g = parseFloat(gravity);
  const energyOn =
    Number.isFinite(massKg) && massKg > 0 && Number.isFinite(g) && g > 0;

  /**
   * Energies at each tracked point.
   *
   * KE uses the full speed (both components), GPE is measured from whatever
   * the student chose as the origin — so total energy is only conserved to
   * within the accuracy of their tapping, which is the interesting part.
   */
  const energy = useMemo(() => {
    if (!energyOn) return [];
    return data.map((d, i) => {
      const vx = vxPts[i]?.s ?? 0;
      const vy = vyPts[i]?.s ?? 0;
      const ke = 0.5 * massKg * (vx * vx + vy * vy);
      const gpe = massKg * g * d.y;
      return { t: d.t, ke, gpe, total: ke + gpe };
    });
  }, [data, vxPts, vyPts, massKg, g, energyOn]);

  const headers = useMemo(
    () => (energyOn ? [...BASE_HEADERS, ...ENERGY_HEADERS] : BASE_HEADERS),
    [energyOn],
  );

  /** Rows shared by the CSV download and the clipboard copy. */
  const tableRows = useMemo(
    () =>
      data.map((d, i) => {
        const row = [
          d.t.toFixed(5),
          d.x.toFixed(5),
          d.y.toFixed(5),
          vxPts[i] === undefined ? "" : vxPts[i].s.toFixed(5),
          vyPts[i] === undefined ? "" : vyPts[i].s.toFixed(5),
        ];
        if (energyOn && energy[i]) {
          row.push(
            energy[i].ke.toFixed(5),
            energy[i].gpe.toFixed(5),
            energy[i].total.toFixed(5),
          );
        }
        return row;
      }),
    [data, vxPts, vyPts, energy, energyOn],
  );

  const exportCsv = () =>
    downloadCsv("kinematics-data.csv", toCsv(headers, tableRows));

  const copyTable = async () => {
    // Tab-separated, so Sheets splits it into cells with no import dialog.
    const ok = await copyText(toTsv(headers, tableRows));
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  // --------------------------------------------------------------- render

  const instruction: Record<TapMode, string> = {
    calA: "Tap one end of an object of known length in the frame.",
    calB: "Now tap the other end.",
    origin: "Tap where you want the origin (0, 0) to be.",
    track: "Tap the moving object. The video advances a frame automatically.",
  };

  const likelyHevc =
    !!fileMeta &&
    (/quicktime/i.test(fileMeta.type) || /\.mov$/i.test(fileMeta.name));

  // Marker geometry is held at a constant on-screen size by dividing out zoom.
  const markScale = dims ? Math.max(dims.w, dims.h) / 100 : 1;
  const rMark = markScale / view.k;
  const strokeW = (markScale * 0.4) / view.k;
  const crossArm = (markScale * 3) / view.k;

  return (
    <div className="space-y-6">
      {!videoUrl && (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-8 text-center">
          <h2 className="text-[15px] font-medium">Start with a video</h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[var(--text-secondary)]">
            Film the motion side-on, with the camera still and an object of
            known length in shot for the scale. Slow motion gives far better
            results for anything fast.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <label className="cursor-pointer rounded-lg bg-[var(--series-1)] px-4 py-2.5 text-[14px] font-medium text-white">
              Record with camera
              <input
                type="file"
                accept="video/*"
                capture="environment"
                className="hidden"
                onChange={onPickFile}
              />
            </label>
            <label className="cursor-pointer rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] font-medium">
              Choose a video
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={onPickFile}
              />
            </label>
          </div>
        </div>
      )}

      {videoUrl && (
        <>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
            <p className="mb-2 px-1 text-[13px] text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">
                {tapMode === "track" ? "Tracking" : "Setting up"}
              </span>{" "}
              — {instruction[tapMode]}
              <span className="text-[var(--text-muted)]">
                {" "}
                Pinch with two fingers to zoom, slide both to pan.
              </span>
            </p>

            <div
              ref={outerRef}
              data-tap-surface
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => endPointer(e, true)}
              onPointerCancel={(e) => endPointer(e, false)}
              className="relative w-full select-none overflow-hidden rounded-lg bg-black"
              style={{
                aspectRatio: dims ? dims.w / dims.h : 16 / 9,
                touchAction: "none",
              }}
            >
              <div
                ref={innerRef}
                className="absolute inset-0 origin-top-left"
                style={{
                  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`,
                }}
              >
                <video
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  muted
                  preload="auto"
                  onLoadedMetadata={onLoadedMetadata}
                  onLoadedData={() => setLoadState("ready")}
                  onCanPlay={() => setLoadState("ready")}
                  onError={() => setLoadState("error")}
                  onSeeked={() => {
                    setCurrentTime(videoRef.current?.currentTime ?? 0);
                    setLoadState("ready");
                  }}
                  className="absolute inset-0 h-full w-full object-fill"
                />

                {dims && (
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${dims.w} ${dims.h}`}
                  >
                    {calA && calB && (
                      <line
                        x1={calA.u * dims.w}
                        y1={calA.v * dims.h}
                        x2={calB.u * dims.w}
                        y2={calB.v * dims.h}
                        stroke="#eda100"
                        strokeWidth={strokeW}
                      />
                    )}
                    {[calA, calB].map((c, i) =>
                      c ? (
                        <circle
                          key={`cal${i}`}
                          cx={c.u * dims.w}
                          cy={c.v * dims.h}
                          r={rMark}
                          fill="#eda100"
                        />
                      ) : null,
                    )}
                    {origin && (
                      <g stroke="#1baf7a" strokeWidth={strokeW}>
                        <line
                          x1={origin.u * dims.w - crossArm}
                          y1={origin.v * dims.h}
                          x2={origin.u * dims.w + crossArm}
                          y2={origin.v * dims.h}
                        />
                        <line
                          x1={origin.u * dims.w}
                          y1={origin.v * dims.h - crossArm}
                          x2={origin.u * dims.w}
                          y2={origin.v * dims.h + crossArm}
                        />
                      </g>
                    )}
                    {marks.map((m, i) => (
                      <circle
                        key={i}
                        cx={m.u * dims.w}
                        cy={m.v * dims.h}
                        r={rMark}
                        fill="none"
                        stroke={
                          Math.abs(m.t - currentTime) < 0.5 / fps
                            ? "#e34948"
                            : "#2a78d6"
                        }
                        strokeWidth={strokeW}
                      />
                    ))}
                  </svg>
                )}
              </div>

              {loadState === "loading" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 p-6 text-center text-[13px] text-white">
                  {slowLoad
                    ? "Still decoding… if this stays black, the format may not be supported here."
                    : "Loading video…"}
                </div>
              )}

              {loadState === "error" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6 text-center text-[13px] leading-relaxed text-white">
                  <div className="max-w-sm space-y-2">
                    <p className="font-medium">
                      This browser can&apos;t decode that video.
                    </p>
                    {likelyHevc ? (
                      <p className="text-white/75">
                        {fileMeta?.name} looks like an iPhone or iPad clip in
                        HEVC. Safari plays HEVC; Chrome and Firefox often
                        can&apos;t. Open this page in Safari, or set{" "}
                        <span className="whitespace-nowrap">
                          Settings → Camera → Formats → Most Compatible
                        </span>{" "}
                        and re-record.
                      </p>
                    ) : (
                      <p className="text-white/75">
                        Try an MP4 (H.264) clip, or open this page in Safari.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {view.k > 1.01 && (
                <div className="tabular pointer-events-none absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">
                  {view.k.toFixed(1)}×
                </div>
              )}
            </div>

            <div className="mt-3 space-y-3">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={duration ? duration / 1000 : 0.001}
                value={currentTime}
                onChange={(e) => seekTo(parseFloat(e.target.value))}
                className="w-full accent-[var(--series-1)]"
                aria-label="Scrub video"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => seekBy(-10)}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                >
                  −10
                </button>
                <button
                  onClick={() => seekBy(-1)}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                >
                  ◀ frame
                </button>
                <button
                  onClick={() => seekBy(1)}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                >
                  frame ▶
                </button>
                <button
                  onClick={() => seekBy(10)}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                >
                  +10
                </button>
                <span className="tabular ml-1 text-[13px] text-[var(--text-muted)]">
                  {currentTime.toFixed(3)} s / {duration.toFixed(2)} s
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => zoomAbout(1 / 1.4)}
                  aria-label="Zoom out"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                >
                  −
                </button>
                <button
                  onClick={() => zoomAbout(1.4)}
                  aria-label="Zoom in"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                >
                  +
                </button>
                <button
                  onClick={() => setView(IDENTITY)}
                  disabled={view.k <= 1.01}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] disabled:opacity-40"
                >
                  Reset view
                </button>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => setMarks((m) => m.slice(0, -1))}
                    disabled={marks.length === 0}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] disabled:opacity-40"
                  >
                    Undo point
                  </button>
                  <button
                    onClick={resetCalibration}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                  >
                    Recalibrate
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 sm:grid-cols-3">
            <label className="block text-[13px]">
              <span className="text-[var(--text-secondary)]">
                Known length / m
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                value={calMetres}
                onChange={(e) => setCalMetres(e.target.value)}
                className="tabular mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              />
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Real length of the calibration line
              </span>
            </label>

            <div className="text-[13px]">
              <label
                htmlFor="fps-input"
                className="text-[var(--text-secondary)]"
              >
                Frame rate / fps
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="fps-input"
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="1"
                  list="fps-suggestions"
                  value={fps}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (Number.isFinite(n) && n > 0) setFps(n);
                    setFpsStatus("manual");
                  }}
                  className="tabular w-full min-w-0 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                />
                <datalist id="fps-suggestions">
                  {FPS_SUGGESTIONS.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={detectFps}
                  disabled={fpsStatus === "detecting" || loadState !== "ready"}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] disabled:opacity-40"
                >
                  {fpsStatus === "detecting" ? "…" : "Detect"}
                </button>
              </div>
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                {fpsStatus === "detecting"
                  ? "Measuring from the video…"
                  : fpsStatus === "detected"
                    ? "Detected from the video. Only sets the step size."
                    : fpsStatus === "failed"
                      ? "Couldn't detect — set it by hand."
                      : "Only sets the step size — timings come from the video clock"}
              </span>
            </div>

            <label className="block text-[13px]">
              <span className="text-[var(--text-secondary)]">
                Slow-motion factor
              </span>
              <select
                value={slowmo}
                onChange={(e) => setSlowmo(parseInt(e.target.value, 10))}
                className="tabular mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              >
                {SLOWMO_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Set this if the clip plays back slowed down
              </span>
            </label>

            <label className="block text-[13px]">
              <span className="text-[var(--text-secondary)]">Mass / kg</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="optional"
                value={mass}
                onChange={(e) => setMass(e.target.value)}
                className="tabular mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              />
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Enter a mass to unlock the energy graphs
              </span>
            </label>

            <label className="block text-[13px]">
              <span className="text-[var(--text-secondary)]">
                g / m s⁻²
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={gravity}
                onChange={(e) => setGravity(e.target.value)}
                className="tabular mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              />
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Used for GPE — set 10 if that is your syllabus convention
              </span>
            </label>
          </div>

          {data.length >= 2 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Chart
                  series={[
                    {
                      name: "x",
                      color: "var(--series-1)",
                      points: data.map((d) => ({ x: d.t, y: d.x })),
                    },
                    {
                      name: "y",
                      color: "var(--series-2)",
                      points: data.map((d) => ({ x: d.t, y: d.y })),
                    },
                  ]}
                  xLabel="time / s"
                  yLabel="displacement / m"
                  unit="m"
                />
                <Chart
                  series={[
                    {
                      name: "vx",
                      color: "var(--series-1)",
                      points: vxPts.map((p) => ({ x: p.t, y: p.s })),
                    },
                    {
                      name: "vy",
                      color: "var(--series-2)",
                      points: vyPts.map((p) => ({ x: p.t, y: p.s })),
                    },
                  ]}
                  xLabel="time / s"
                  yLabel="velocity / m s⁻¹"
                  unit="m/s"
                />
              </div>

              {energyOn && energy.length >= 2 && (
                <div className="space-y-2">
                  <Chart
                    series={[
                      {
                        name: "KE",
                        color: "var(--series-1)",
                        points: energy.map((e) => ({ x: e.t, y: e.ke })),
                      },
                      {
                        name: "GPE",
                        color: "var(--series-2)",
                        points: energy.map((e) => ({ x: e.t, y: e.gpe })),
                      },
                      {
                        name: "total",
                        color: "var(--series-3)",
                        points: energy.map((e) => ({ x: e.t, y: e.total })),
                      },
                    ]}
                    xLabel="time / s"
                    yLabel="energy / J"
                    unit="J"
                    height={320}
                  />
                  <p className="px-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
                    GPE is measured from the origin you set, so only{" "}
                    <em>changes</em> in it are meaningful. A flat total-energy
                    line means KE and GPE are trading cleanly; a drifting one
                    usually means tapping scatter or a scale that is slightly
                    off, which is worth discussing with students.
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["Horizontal (x)", fitX, fitVx, "var(--series-1)"],
                    ["Vertical (y)", fitY, fitVy, "var(--series-2)"],
                  ] as const
                ).map(([label, q, l, color]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-0.5 w-4 rounded-full"
                        style={{ background: color }}
                      />
                      <h3 className="text-[14px] font-medium">{label}</h3>
                    </div>
                    {q ? (
                      <dl className="tabular mt-3 space-y-1.5 text-[13px]">
                        <div className="flex justify-between gap-4">
                          <dt className="text-[var(--text-secondary)]">
                            Initial velocity, u
                          </dt>
                          <dd>{sig(q.u)} m s⁻¹</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-[var(--text-secondary)]">
                            Acceleration, a (s–t fit)
                          </dt>
                          <dd>{sig(q.a)} m s⁻²</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-[var(--text-secondary)]">
                            Acceleration, a (v–t gradient)
                          </dt>
                          <dd>{l ? `${sig(l.m)} m s⁻²` : "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-[var(--text-secondary)]">
                            r² of s–t fit
                          </dt>
                          <dd>{sig(q.r2, 4)}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-3 text-[13px] text-[var(--text-muted)]">
                        Need at least 3 points for a fit.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[14px] font-medium">
                    Data ({data.length} points)
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyTable}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px]"
                    >
                      {copied ? "Copied ✓" : "Copy table data"}
                    </button>
                    <button
                      onClick={exportCsv}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px]"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
                <p className="mb-3 text-[12px] text-[var(--text-muted)]">
                  Copy, then paste straight into Google Sheets — headings and
                  values land in their own cells.
                </p>
                <div className="overflow-x-auto">
                  <table className="tabular w-full text-left text-[13px]">
                    <thead className="text-[var(--text-muted)]">
                      <tr>
                        {[
                          "t / s",
                          "x / m",
                          "y / m",
                          "vx / m s⁻¹",
                          "vy / m s⁻¹",
                          ...(energyOn
                            ? ["KE / J", "GPE / J", "total E / J"]
                            : []),
                        ].map((h) => (
                          <th key={h} className="py-1.5 pr-4 font-normal">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((d, i) => (
                        <tr key={i} className="border-t border-[var(--border)]">
                          <td className="py-1.5 pr-4">{d.t.toFixed(3)}</td>
                          <td className="py-1.5 pr-4">{d.x.toFixed(4)}</td>
                          <td className="py-1.5 pr-4">{d.y.toFixed(4)}</td>
                          <td className="py-1.5 pr-4">
                            {vxPts[i] ? vxPts[i].s.toFixed(4) : "—"}
                          </td>
                          <td className="py-1.5 pr-4">
                            {vyPts[i] ? vyPts[i].s.toFixed(4) : "—"}
                          </td>
                          {energyOn && (
                            <>
                              <td className="py-1.5 pr-4">
                                {energy[i] ? energy[i].ke.toFixed(4) : "—"}
                              </td>
                              <td className="py-1.5 pr-4">
                                {energy[i] ? energy[i].gpe.toFixed(4) : "—"}
                              </td>
                              <td className="py-1.5 pr-4">
                                {energy[i] ? energy[i].total.toFixed(4) : "—"}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chart from "./Chart";
import { derivative, fitLinear, fitQuadratic, sig, type Pt } from "@/lib/fit";
import { downloadCsv, toCsv } from "@/lib/csv";

/** A tap, stored in normalised video coordinates so it survives any resize. */
type Mark = { t: number; u: number; v: number };

type Stage = "load" | "calibrate" | "track";
type TapMode = "calA" | "calB" | "origin" | "track";

const FPS_OPTIONS = [24, 25, 30, 60, 120, 240];
const SLOWMO_OPTIONS = [1, 2, 4, 8];

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

export default function VideoTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const [stage, setStage] = useState<Stage>("load");
  const [tapMode, setTapMode] = useState<TapMode>("calA");

  const [fps, setFps] = useState(30);
  const [slowmo, setSlowmo] = useState(1);

  const [calA, setCalA] = useState<{ u: number; v: number } | null>(null);
  const [calB, setCalB] = useState<{ u: number; v: number } | null>(null);
  const [calMetres, setCalMetres] = useState("1");
  const [origin, setOrigin] = useState<{ u: number; v: number } | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);

  // Object URLs must be revoked or the blob leaks for the life of the tab.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const reset = useCallback(() => {
    setCalA(null);
    setCalB(null);
    setOrigin(null);
    setMarks([]);
    setStage("calibrate");
    setTapMode("calA");
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setDims(null);
    setDuration(0);
    setCurrentTime(0);
    reset();
    // Allow re-picking the same file straight after.
    e.target.value = "";
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDims({ w: v.videoWidth, h: v.videoHeight });
    setDuration(v.duration);
    setCurrentTime(v.currentTime);
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

  /** Map a pointer event to normalised coordinates inside the video box. */
  const normalise = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = surfaceRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      u: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      v: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const onTapSurface = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = normalise(e);
    if (!p) return;
    const v = videoRef.current;

    if (tapMode === "calA") {
      setCalA(p);
      setTapMode("calB");
    } else if (tapMode === "calB") {
      setCalB(p);
      setTapMode("origin");
    } else if (tapMode === "origin") {
      setOrigin(p);
      setTapMode("track");
      setStage("track");
    } else {
      if (!v) return;
      setMarks((prev) =>
        [...prev, { t: v.currentTime, u: p.u, v: p.v }].sort(
          (a, b) => a.t - b.t,
        ),
      );
      seekBy(1);
    }
  };

  /** metres per video pixel, from the calibration segment. */
  const mPerPx = useMemo(() => {
    if (!calA || !calB || !dims) return null;
    const metres = parseFloat(calMetres);
    if (!Number.isFinite(metres) || metres <= 0) return null;
    const dx = (calA.u - calB.u) * dims.w;
    const dy = (calA.v - calB.v) * dims.h;
    const px = Math.hypot(dx, dy);
    if (px < 1) return null; // the two taps landed on the same spot
    return metres / px;
  }, [calA, calB, calMetres, dims]);

  /** Marks converted to real-world metres and seconds. */
  const data = useMemo(() => {
    if (!mPerPx || !dims || marks.length === 0) return [];
    const o = origin ?? { u: marks[0].u, v: marks[0].v };
    const t0 = marks[0].t;
    return marks.map((m) => ({
      // Slow-motion footage plays back stretched, so real time runs faster.
      t: (m.t - t0) / slowmo,
      x: (m.u - o.u) * dims.w * mPerPx,
      // Screen y grows downward; physics y grows upward.
      y: -(m.v - o.v) * dims.h * mPerPx,
    }));
  }, [marks, mPerPx, dims, origin, slowmo]);

  const xPts: Pt[] = useMemo(() => data.map((d) => ({ t: d.t, s: d.x })), [data]);
  const yPts: Pt[] = useMemo(() => data.map((d) => ({ t: d.t, s: d.y })), [data]);
  const vxPts = useMemo(() => derivative(xPts), [xPts]);
  const vyPts = useMemo(() => derivative(yPts), [yPts]);

  const fitX = useMemo(() => fitQuadratic(xPts), [xPts]);
  const fitY = useMemo(() => fitQuadratic(yPts), [yPts]);
  const fitVx = useMemo(() => fitLinear(vxPts), [vxPts]);
  const fitVy = useMemo(() => fitLinear(vyPts), [vyPts]);

  const exportCsv = () => {
    const rows = data.map((d, i) => {
      const vx = vxPts[i]?.s;
      const vy = vyPts[i]?.s;
      return [
        d.t.toFixed(5),
        d.x.toFixed(5),
        d.y.toFixed(5),
        vx === undefined ? "" : vx.toFixed(5),
        vy === undefined ? "" : vy.toFixed(5),
      ];
    });
    downloadCsv(
      "kinematics-data.csv",
      toCsv(
        ["t / s", "x / m", "y / m", "vx / m s^-1", "vy / m s^-1"],
        rows,
      ),
    );
  };

  // ---------------------------------------------------------------- render

  const instruction: Record<TapMode, string> = {
    calA: "Tap one end of an object of known length in the frame.",
    calB: "Now tap the other end.",
    origin: "Tap where you want the origin (0, 0) to be.",
    track: "Tap the moving object. The video advances a frame automatically.",
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- load */}
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

      {/* --------------------------------------------------- workspace */}
      {videoUrl && (
        <>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
            <p className="mb-2 px-1 text-[13px] text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">
                {stage === "track" ? "Tracking" : "Setting up"}
              </span>{" "}
              — {instruction[tapMode]}
            </p>

            <div
              ref={surfaceRef}
              data-tap-surface
              onPointerDown={onTapSurface}
              className="relative w-full overflow-hidden rounded-lg bg-black select-none"
              style={{ aspectRatio: dims ? dims.w / dims.h : 16 / 9 }}
            >
              <video
                ref={videoRef}
                src={videoUrl}
                playsInline
                muted
                preload="auto"
                onLoadedMetadata={onLoadedMetadata}
                onSeeked={() =>
                  setCurrentTime(videoRef.current?.currentTime ?? 0)
                }
                className="absolute inset-0 h-full w-full"
              />

              {/* Overlay markers. pointer-events-none so taps reach the surface. */}
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {calA && calB && (
                  <line
                    x1={calA.u * 100}
                    y1={calA.v * 100}
                    x2={calB.u * 100}
                    y2={calB.v * 100}
                    stroke="#eda100"
                    strokeWidth={0.4}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {[calA, calB].map((c, i) =>
                  c ? (
                    <circle
                      key={`cal${i}`}
                      cx={c.u * 100}
                      cy={c.v * 100}
                      r={1}
                      fill="#eda100"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null,
                )}
                {origin && (
                  <g stroke="#1baf7a" strokeWidth={0.3} vectorEffect="non-scaling-stroke">
                    <line
                      x1={origin.u * 100 - 3}
                      y1={origin.v * 100}
                      x2={origin.u * 100 + 3}
                      y2={origin.v * 100}
                    />
                    <line
                      x1={origin.u * 100}
                      y1={origin.v * 100 - 3}
                      x2={origin.u * 100}
                      y2={origin.v * 100 + 3}
                    />
                  </g>
                )}
                {marks.map((m, i) => (
                  <circle
                    key={i}
                    cx={m.u * 100}
                    cy={m.v * 100}
                    r={0.9}
                    fill="none"
                    stroke={
                      Math.abs(m.t - currentTime) < 0.5 / fps
                        ? "#e34948"
                        : "#2a78d6"
                    }
                    strokeWidth={0.4}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            </div>

            {/* transport */}
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
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => setMarks((m) => m.slice(0, -1))}
                    disabled={marks.length === 0}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] disabled:opacity-40"
                  >
                    Undo point
                  </button>
                  <button
                    onClick={reset}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                  >
                    Recalibrate
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* settings */}
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
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 tabular"
              />
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Real length of the calibration line
              </span>
            </label>

            <label className="block text-[13px]">
              <span className="text-[var(--text-secondary)]">
                Frame rate / fps
              </span>
              <select
                value={fps}
                onChange={(e) => setFps(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 tabular"
              >
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Only sets the step size — timings come from the video clock
              </span>
            </label>

            <label className="block text-[13px]">
              <span className="text-[var(--text-secondary)]">
                Slow-motion factor
              </span>
              <select
                value={slowmo}
                onChange={(e) => setSlowmo(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 tabular"
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
          </div>

          {/* results */}
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
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[14px] font-medium">
                    Data ({data.length} points)
                  </h3>
                  <button
                    onClick={exportCsv}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px]"
                  >
                    Export CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="tabular w-full text-left text-[13px]">
                    <thead className="text-[var(--text-muted)]">
                      <tr>
                        {["t / s", "x / m", "y / m", "vx / m s⁻¹", "vy / m s⁻¹"].map(
                          (h) => (
                            <th key={h} className="py-1.5 pr-4 font-normal">
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((d, i) => (
                        <tr
                          key={i}
                          className="border-t border-[var(--border)]"
                        >
                          <td className="py-1.5 pr-4">{d.t.toFixed(3)}</td>
                          <td className="py-1.5 pr-4">{d.x.toFixed(4)}</td>
                          <td className="py-1.5 pr-4">{d.y.toFixed(4)}</td>
                          <td className="py-1.5 pr-4">
                            {vxPts[i] ? vxPts[i].s.toFixed(4) : "—"}
                          </td>
                          <td className="py-1.5 pr-4">
                            {vyPts[i] ? vyPts[i].s.toFixed(4) : "—"}
                          </td>
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

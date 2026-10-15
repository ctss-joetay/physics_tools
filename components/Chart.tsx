"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isZoomed, panRange, zoomRange, type Range } from "@/lib/view";

export type Series = {
  name: string;
  /** CSS colour — pass a var(--series-n) so it follows the theme. */
  color: string;
  points: { x: number; y: number }[];
};

type Props = {
  series: Series[];
  xLabel: string;
  yLabel: string;
  /** Suffix shown in the tooltip, e.g. "m" or "m/s". */
  unit?: string;
  height?: number;
  /** Short heading above the plot, e.g. "Velocity–time". */
  title?: string;
  /**
   * Pin the full x extent instead of deriving it from the data, so several
   * stacked charts share one time axis.
   */
  xDomain?: Range;
  /**
   * Controlled x view (zoomed/scrolled range). Pass `null` for "show all".
   * When given, the chart reports changes through onXViewChange and the
   * parent can share one view across several charts.
   */
  xView?: Range | null;
  onXViewChange?: (view: Range | null) => void;
};

/** Constant padding so stacked charts' plot areas line up exactly. */
const PAD = { top: 16, right: 56, bottom: 40, left: 56 };
/** Pointer movement below this is a hover, not a drag. */
const DRAG_SLOP = 6;
/** Finger spread below this (px) is too small to read a zoom factor from. */
const MIN_SPREAD = 20;

/** "Nice" axis ticks — 1, 2, 2.5 or 5 times a power of ten. */
function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) > 1e-9 ? Math.abs(min) * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const rawStep = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * mag;

  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  // Nudge the loop bound by a fraction of a step to survive float drift.
  for (let v = first; v <= max + step * 1e-6; v += step) {
    out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  }
  return out;
}

function fmt(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(1);
  return String(Number(v.toPrecision(4)));
}

type Gesture =
  | {
      kind: "drag";
      id: number;
      startX: number;
      startY: number;
      moved: boolean;
      xView: Range;
      yView: Range;
    }
  | {
      kind: "pinch";
      ids: [number, number];
      spreadX: number;
      spreadY: number;
      fx: number;
      fy: number;
      xView: Range;
      yView: Range;
    };

export default function Chart({
  series,
  xLabel,
  yLabel,
  unit = "",
  height = 300,
  title,
  xDomain,
  xView: xViewProp,
  onXViewChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [xViewState, setXViewState] = useState<Range | null>(null);
  const [yView, setYView] = useState<Range | null>(null);

  const controlled = xViewProp !== undefined;
  const xView = controlled ? xViewProp : xViewState;
  const setXView = useCallback(
    (v: Range | null) => {
      if (onXViewChange) onXViewChange(v);
      if (!controlled) setXViewState(v);
    },
    [controlled, onXViewChange],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(280, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const populated = useMemo(
    () => series.filter((s) => s.points.length > 0),
    [series],
  );

  /** The data's own extent — what "Reset zoom" returns to. */
  const full = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const s of populated) {
      for (const p of s.points) {
        if (Number.isFinite(p.x)) xs.push(p.x);
        if (Number.isFinite(p.y)) ys.push(p.y);
      }
    }
    if (xs.length === 0 && !xDomain) return null;

    let yMin = ys.length ? Math.min(...ys) : 0;
    let yMax = ys.length ? Math.max(...ys) : 0;
    // Always show y = 0 so gradients read honestly against the axis.
    yMin = Math.min(yMin, 0);
    yMax = Math.max(yMax, 0);
    const yPad = (yMax - yMin) * 0.08 || 1;

    const x: Range = xDomain ?? [Math.min(...xs), Math.max(...xs)];
    const y: Range = [yMin - yPad, yMax + yPad];
    return { x, y };
  }, [populated, xDomain]);

  const domain = useMemo(() => {
    if (!full) return null;
    const x = xView ?? full.x;
    const y = yView ?? full.y;
    return { xMin: x[0], xMax: x[1], yMin: y[0], yMax: y[1] };
  }, [full, xView, yView]);

  const zoomed =
    !!full &&
    ((!!xView && isZoomed(xView, full.x)) || (!!yView && isZoomed(yView, full.y)));

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const sx = useCallback(
    (x: number) => {
      if (!domain) return 0;
      const span = domain.xMax - domain.xMin || 1;
      return PAD.left + ((x - domain.xMin) / span) * plotW;
    },
    [domain, plotW],
  );

  const sy = useCallback(
    (y: number) => {
      if (!domain) return 0;
      const span = domain.yMax - domain.yMin || 1;
      return PAD.top + plotH - ((y - domain.yMin) / span) * plotH;
    },
    [domain, plotH],
  );

  // ------------------------------------------------------------- gestures

  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const viewsRef = useRef({ xView, yView, full });
  viewsRef.current = { xView, yView, full };

  const resetZoom = useCallback(() => {
    setXView(null);
    setYView(null);
  }, [setXView]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Fraction along the plot area, clamped to 0–1. */
  const fracX = (px: number) =>
    Math.min(1, Math.max(0, (px - PAD.left) / plotW));
  const fracY = (py: number) =>
    Math.min(1, Math.max(0, 1 - (py - PAD.top) / plotH));

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const { full: f, xView: xv, yView: yv } = viewsRef.current;
    if (!f) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation */
    }
    const p = local(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 1) {
      gesture.current = {
        kind: "drag",
        id: e.pointerId,
        startX: p.x,
        startY: p.y,
        moved: false,
        xView: xv ?? f.x,
        yView: yv ?? f.y,
      };
    } else if (pointers.current.size === 2) {
      const [[idA, a], [idB, b]] = [...pointers.current.entries()];
      setHoverX(null);
      gesture.current = {
        kind: "pinch",
        ids: [idA, idB],
        spreadX: Math.abs(a.x - b.x),
        spreadY: Math.abs(a.y - b.y),
        fx: fracX((a.x + b.x) / 2),
        fy: fracY((a.y + b.y) / 2),
        xView: xv ?? f.x,
        yView: yv ?? f.y,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const { full: f } = viewsRef.current;
    const p = local(e);
    const g = gesture.current;

    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);

    if (!g || !f) {
      setHoverX(p.x);
      return;
    }

    if (g.kind === "drag" && g.id === e.pointerId) {
      const dx = p.x - g.startX;
      const dy = p.y - g.startY;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_SLOP) {
        setHoverX(p.x);
        return;
      }
      g.moved = true;
      setHoverX(null);
      const xSpan = g.xView[1] - g.xView[0];
      const ySpan = g.yView[1] - g.yView[0];
      const nx = panRange(g.xView, f.x, (-dx / plotW) * xSpan);
      const ny = panRange(g.yView, f.y, (dy / plotH) * ySpan);
      setXView(isZoomed(nx, f.x) ? nx : null);
      setYView(isZoomed(ny, f.y) ? ny : null);
      return;
    }

    if (g.kind === "pinch") {
      const a = pointers.current.get(g.ids[0]);
      const b = pointers.current.get(g.ids[1]);
      if (!a || !b) return;
      const spreadX = Math.abs(a.x - b.x);
      const spreadY = Math.abs(a.y - b.y);
      // A sideways pinch stretches time only; an up-down pinch stretches values only.
      if (g.spreadX >= MIN_SPREAD) {
        const nx = zoomRange(g.xView, f.x, spreadX / g.spreadX, g.fx);
        setXView(isZoomed(nx, f.x) ? nx : null);
      }
      if (g.spreadY >= MIN_SPREAD) {
        const ny = zoomRange(g.yView, f.y, spreadY / g.spreadY, g.fy);
        setYView(isZoomed(ny, f.y) ? ny : null);
      }
    }
  };

  const onPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (pointers.current.size === 0) gesture.current = null;
    else if (pointers.current.size === 1 && gesture.current?.kind === "pinch") {
      // Lifting one finger ends the pinch; the remaining finger just hovers.
      gesture.current = null;
    }
  };

  // Trackpad: pinch arrives as a wheel event with ctrlKey; two-finger
  // sideways scroll as deltaX. Both need preventDefault, so the listener
  // must be non-passive. Vertical two-finger scroll is left to the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { full: f, xView: xv, yView: yv } = viewsRef.current;
      if (!f) return;
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.01);
        const nx = zoomRange(xv ?? f.x, f.x, factor, fracX(px));
        const ny = zoomRange(yv ?? f.y, f.y, factor, fracY(py));
        setXView(isZoomed(nx, f.x) ? nx : null);
        setYView(isZoomed(ny, f.y) ? ny : null);
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const cur = xv ?? f.x;
        const nx = panRange(cur, f.x, (e.deltaX / plotW) * (cur[1] - cur[0]));
        setXView(isZoomed(nx, f.x) ? nx : null);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // fracX/fracY are plain closures over plotW/plotH, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotW, plotH, setXView]);

  // Nearest sample to the pointer, per series, for the crosshair readout.
  const hover = useMemo(() => {
    if (hoverX === null || !domain || populated.length === 0) return null;
    const span = domain.xMax - domain.xMin || 1;
    const dataX = domain.xMin + ((hoverX - PAD.left) / plotW) * span;

    const readouts = populated
      .map((s) => {
        let best = s.points[0];
        for (const p of s.points) {
          if (Math.abs(p.x - dataX) < Math.abs(best.x - dataX)) best = p;
        }
        return { name: s.name, color: s.color, point: best };
      })
      .filter((r) => r.point !== undefined);

    if (readouts.length === 0) return null;
    return { x: readouts[0].point.x, readouts };
  }, [hoverX, domain, populated, plotW]);

  if (!domain || populated.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
        {title && <h4 className="px-1 pb-1 text-[13px] font-medium">{title}</h4>}
        <div
          ref={wrapRef}
          className="flex items-center justify-center text-[13px] text-[var(--text-muted)]"
          style={{ height }}
        >
          No data yet
        </div>
      </div>
    );
  }

  const xTicks = niceTicks(domain.xMin, domain.xMax, 6);
  const yTicks = niceTicks(domain.yMin, domain.yMax, 5);
  const showLegend = populated.length >= 2;
  const inX = (x: number) => x >= domain.xMin && x <= domain.xMax;

  return (
    <div
      className="relative rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3"
      data-chart
    >
      {title && (
        <h4 className="px-1 pb-1 text-[13px] font-medium" data-chart-title>
          {title}
        </h4>
      )}
      {showLegend && (
        <div className="mb-1 flex flex-wrap items-center gap-4 px-1">
          {populated.map((s) => (
            <span
              key={s.name}
              className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]"
            >
              <span
                aria-hidden
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: s.color }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}

      {zoomed && (
        <button
          type="button"
          onClick={resetZoom}
          data-testid="reset-zoom"
          className="absolute right-3 top-2 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
        >
          Reset zoom
        </button>
      )}

      <div ref={wrapRef}>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={(e) => {
            if (!gesture.current) setHoverX(null);
            onPointerEnd(e);
          }}
          onDoubleClick={resetZoom}
          // pan-y keeps one-finger vertical swipes scrolling the page;
          // sideways drags and two-finger pinches reach us as pointer events.
          style={{ touchAction: "pan-y", display: "block", cursor: "grab" }}
          role="img"
          aria-label={`${yLabel} against ${xLabel}`}
        >
          <defs>
            <clipPath id={`clip-${title ?? yLabel}`.replace(/\W/g, "-")}>
              <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* gridlines */}
          {yTicks.map((t) => (
            <line
              key={`gy${t}`}
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={sy(t)}
              y2={sy(t)}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
          ))}
          {xTicks.map((t) => (
            <line
              key={`gx${t}`}
              x1={sx(t)}
              x2={sx(t)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
          ))}

          {/* zero line, drawn stronger than the grid when it is in range */}
          {domain.yMin < 0 && domain.yMax > 0 && (
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={sy(0)}
              y2={sy(0)}
              stroke="var(--baseline)"
              strokeWidth={1.5}
            />
          )}

          {/* axes */}
          <line
            x1={PAD.left}
            x2={PAD.left}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--baseline)"
            strokeWidth={1}
            data-y-axis
          />
          <line
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            stroke="var(--baseline)"
            strokeWidth={1}
          />

          {/* tick labels */}
          {yTicks.map((t) => (
            <text
              key={`ty${t}`}
              x={PAD.left - 8}
              y={sy(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fmt(t)}
            </text>
          ))}
          {xTicks.map((t) => (
            <text
              key={`tx${t}`}
              x={sx(t)}
              y={PAD.top + plotH + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}
              data-x-tick
            >
              {fmt(t)}
            </text>
          ))}

          {/* axis titles */}
          <text
            x={PAD.left + plotW / 2}
            y={height - 6}
            textAnchor="middle"
            fontSize={12}
            fill="var(--text-secondary)"
          >
            {xLabel}
          </text>
          <text
            transform={`translate(14, ${PAD.top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={12}
            fill="var(--text-secondary)"
          >
            {yLabel}
          </text>

          {/* series, clipped to the plot so zoomed-out points don't spill */}
          <g clipPath={`url(#${`clip-${title ?? yLabel}`.replace(/\W/g, "-")})`}>
            {populated.map((s) => {
              const d = s.points
                .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)},${sy(p.y)}`)
                .join(" ");
              const visible = s.points.filter((p) => inX(p.x));
              const last = visible[visible.length - 1];
              return (
                <g key={s.name}>
                  <path
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {visible.map((p, i) => (
                    <circle
                      key={i}
                      cx={sx(p.x)}
                      cy={sy(p.y)}
                      r={4}
                      fill={s.color}
                      stroke="var(--surface-1)"
                      strokeWidth={2}
                      data-point
                    />
                  ))}
                  {/* direct label at the line end — identity without colour alone */}
                  {last && (
                    <text
                      x={Math.min(sx(last.x) + 8, PAD.left + plotW - 4)}
                      y={sy(last.y)}
                      dominantBaseline="middle"
                      fontSize={11}
                      fill="var(--text-secondary)"
                    >
                      {s.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* crosshair */}
          {hover && (
            <g pointerEvents="none">
              <line
                x1={sx(hover.x)}
                x2={sx(hover.x)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--text-muted)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {hover.readouts.map((r) => (
                <circle
                  key={r.name}
                  cx={sx(r.point.x)}
                  cy={sy(r.point.y)}
                  r={6}
                  fill={r.color}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>
      </div>

      {hover && (
        <div className="tabular mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12px] text-[var(--text-secondary)]">
          <span>
            {xLabel.split(" ")[0]} {fmt(hover.x)}
          </span>
          {hover.readouts.map((r) => (
            <span key={r.name} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: r.color }}
              />
              {r.name} {fmt(r.point.y)}
              {unit && ` ${unit}`}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 px-1 text-[11px] text-[var(--text-muted)]">
        Pinch to zoom, drag to scroll, double-tap to reset.
      </p>
    </div>
  );
}

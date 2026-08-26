"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
};

const PAD = { top: 16, right: 56, bottom: 40, left: 56 };

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

export default function Chart({
  series,
  xLabel,
  yLabel,
  unit = "",
  height = 300,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverX, setHoverX] = useState<number | null>(null);

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

  const domain = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const s of populated) {
      for (const p of s.points) {
        if (Number.isFinite(p.x)) xs.push(p.x);
        if (Number.isFinite(p.y)) ys.push(p.y);
      }
    }
    if (xs.length === 0) return null;

    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    // Always show y = 0 so gradients read honestly against the axis.
    yMin = Math.min(yMin, 0);
    yMax = Math.max(yMax, 0);
    const yPad = (yMax - yMin) * 0.08 || 1;

    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      yMin: yMin - yPad,
      yMax: yMax + yPad,
    };
  }, [populated]);

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

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverX(e.clientX - rect.left);
  };

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

  if (!domain) {
    return (
      <div
        ref={wrapRef}
        className="flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-1)] text-[13px] text-[var(--text-muted)]"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  const xTicks = niceTicks(domain.xMin, domain.xMax, 6);
  const yTicks = niceTicks(domain.yMin, domain.yMax, 5);
  const showLegend = populated.length >= 2;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
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

      <div ref={wrapRef}>
        <svg
          width={width}
          height={height}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverX(null)}
          style={{ touchAction: "pan-y", display: "block" }}
          role="img"
          aria-label={`${yLabel} against ${xLabel}`}
        >
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

          {/* series */}
          {populated.map((s) => {
            const d = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)},${sy(p.y)}`)
              .join(" ");
            const last = s.points[s.points.length - 1];
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
                {s.points.map((p, i) => (
                  <circle
                    key={i}
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={4}
                    fill={s.color}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                ))}
                {/* direct label at the line end — identity without colour alone */}
                <text
                  x={Math.min(sx(last.x) + 8, width - 4)}
                  y={sy(last.y)}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="var(--text-secondary)"
                >
                  {s.name}
                </text>
              </g>
            );
          })}

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
    </div>
  );
}

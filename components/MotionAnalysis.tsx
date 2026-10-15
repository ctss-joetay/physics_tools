"use client";

import { memo, useMemo, useState } from "react";
import Chart from "./Chart";
import { fitLinear, fitQuadratic, sig } from "@/lib/fit";
import { copyText, downloadCsv, toCsv, toTsv } from "@/lib/csv";
import { csvHeaders, derive, unitLabels, type Sample, type Unit } from "@/lib/motion";
import type { Range } from "@/lib/view";

type Props = {
  data: Sample[];
  /** Parsed and validated by the parent; absent disables force and energy. */
  massKg?: number;
  g?: number;
  /** "m" normally; "a.u." when no real length was given. Drives every label. */
  unit: Unit;
  csvFilename: string;
  /** One-line explanation shown when unit is "a.u.". */
  auNote?: string;
};

const CHART_H = 240;

/**
 * Everything below the tracking surface, shared by the video and live
 * trackers: stacked graphs on one linked time axis, fits, table, export.
 */
export default function MotionAnalysis({
  data,
  massKg,
  g,
  unit,
  csvFilename,
  auNote,
}: Props) {
  const [copied, setCopied] = useState(false);
  // One time view shared by every stacked chart, so zooming or scrolling
  // time on one moves them all and they stay aligned.
  const [xView, setXView] = useState<Range | null>(null);

  const d = useMemo(() => derive(data), [data]);
  const labels = unitLabels(unit);

  const fitX = useMemo(() => fitQuadratic(d.xPts), [d.xPts]);
  const fitY = useMemo(() => fitQuadratic(d.yPts), [d.yPts]);
  const fitVx = useMemo(() => fitLinear(d.vxPts), [d.vxPts]);
  const fitVy = useMemo(() => fitLinear(d.vyPts), [d.vyPts]);

  // Joules and newtons need metres and a mass; otherwise these stay hidden.
  const dynamicsOn =
    unit === "m" &&
    massKg !== undefined &&
    Number.isFinite(massKg) &&
    massKg > 0 &&
    g !== undefined &&
    Number.isFinite(g) &&
    g > 0;

  const force = useMemo(() => {
    if (!dynamicsOn) return [];
    const m = massKg as number;
    return d.axPts.map((p, i) => ({
      t: p.t,
      fx: m * p.s,
      fy: m * (d.ayPts[i]?.s ?? 0),
    }));
  }, [d.axPts, d.ayPts, massKg, dynamicsOn]);

  /**
   * Energy stores at each tracked point. KE uses the full speed; GPE is
   * measured from whatever the student chose as the origin, so total energy
   * is only conserved to within the accuracy of their data — which is the
   * interesting part.
   */
  const energy = useMemo(() => {
    if (!dynamicsOn) return [];
    const m = massKg as number;
    const gg = g as number;
    return data.map((s, i) => {
      const v = d.speedPts[i]?.s ?? 0;
      const ke = 0.5 * m * v * v;
      const gpe = m * gg * s.y;
      return { t: s.t, ke, gpe, total: ke + gpe };
    });
  }, [data, d.speedPts, massKg, g, dynamicsOn]);

  const headers = useMemo(() => csvHeaders(unit, dynamicsOn), [unit, dynamicsOn]);

  const cell = (p: { s: number } | undefined, dp: number) =>
    p === undefined ? "" : p.s.toFixed(dp);

  /** Rows shared by the CSV download and the clipboard copy. */
  const tableRows = useMemo(
    () =>
      data.map((s, i) => {
        const row = [
          s.t.toFixed(5),
          s.x.toFixed(5),
          s.y.toFixed(5),
          cell(d.vxPts[i], 5),
          cell(d.vyPts[i], 5),
          cell(d.speedPts[i], 5),
          cell(d.axPts[i], 5),
          cell(d.ayPts[i], 5),
        ];
        if (dynamicsOn) {
          row.push(
            force[i] ? force[i].fx.toFixed(5) : "",
            force[i] ? force[i].fy.toFixed(5) : "",
            energy[i] ? energy[i].ke.toFixed(5) : "",
            energy[i] ? energy[i].gpe.toFixed(5) : "",
            energy[i] ? energy[i].total.toFixed(5) : "",
          );
        }
        return row;
      }),
    [data, d, force, energy, dynamicsOn],
  );

  const exportCsv = () => downloadCsv(csvFilename, toCsv(headers, tableRows));

  const copyTable = async () => {
    // Tab-separated, so Sheets splits it into cells with no import dialog.
    const ok = await copyText(toTsv(headers, tableRows));
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  // Series arrays are memoised so Chart's memo can skip unchanged charts
  // while a sibling is being zoomed or scrolled.
  const pts = (arr: { t: number; s: number }[]) =>
    arr.map((p) => ({ x: p.t, y: p.s }));
  const series = useMemo(
    () => ({
      s: [
        { name: "x", color: "var(--series-1)", points: pts(d.xPts) },
        { name: "y", color: "var(--series-2)", points: pts(d.yPts) },
      ],
      v: [
        { name: "vx", color: "var(--series-1)", points: pts(d.vxPts) },
        { name: "vy", color: "var(--series-2)", points: pts(d.vyPts) },
      ],
      speed: [{ name: "speed", color: "var(--series-3)", points: pts(d.speedPts) }],
      a: [
        { name: "ax", color: "var(--series-1)", points: pts(d.axPts) },
        { name: "ay", color: "var(--series-2)", points: pts(d.ayPts) },
      ],
      f: [
        { name: "Fx", color: "var(--series-1)", points: force.map((f) => ({ x: f.t, y: f.fx })) },
        { name: "Fy", color: "var(--series-2)", points: force.map((f) => ({ x: f.t, y: f.fy })) },
      ],
      e: [
        { name: "Kinetic store", color: "var(--series-1)", points: energy.map((e) => ({ x: e.t, y: e.ke })) },
        { name: "Gravitational potential store", color: "var(--series-2)", points: energy.map((e) => ({ x: e.t, y: e.gpe })) },
        { name: "Total", color: "var(--series-3)", points: energy.map((e) => ({ x: e.t, y: e.total })) },
      ],
    }),
    [d, force, energy],
  );
  const tDomain = useMemo<Range>(
    () => (data.length ? [data[0].t, data[data.length - 1].t] : [0, 1]),
    [data],
  );
  const tableHeaders = useMemo(
    () => [
      "t / s",
      `x / ${labels.s}`,
      `y / ${labels.s}`,
      `vx / ${labels.v}`,
      `vy / ${labels.v}`,
      `speed / ${labels.v}`,
      `ax / ${labels.a}`,
      `ay / ${labels.a}`,
      ...(dynamicsOn ? ["Fx / N", "Fy / N", "KE / J", "GPE / J", "total E / J"] : []),
    ],
    [labels.s, labels.v, labels.a, dynamicsOn],
  );

  if (data.length < 2) return null;

  const shared = { xLabel: "time / s", xDomain: tDomain, xView, onXViewChange: setXView, height: CHART_H };

  return (
    <>
      <section className="space-y-3" data-testid="graphs">
        <h3 className="px-1 text-[14px] font-medium">Graphs</h3>
        <Chart
          {...shared}
          title="Displacement–time"
          yLabel={`displacement / ${labels.s}`}
          unit={labels.s}
          series={series.s}
        />
        <Chart
          {...shared}
          title="Velocity–time"
          yLabel={`velocity / ${labels.v}`}
          unit={labels.v}
          series={series.v}
        />
        <Chart
          {...shared}
          title="Speed–time"
          yLabel={`speed / ${labels.v}`}
          unit={labels.v}
          series={series.speed}
        />
        <Chart
          {...shared}
          title="Acceleration–time"
          yLabel={`acceleration / ${labels.a}`}
          unit={labels.a}
          series={series.a}
        />
        {dynamicsOn && (
          <>
            <Chart
              {...shared}
              title="Net force–time"
              yLabel="force / N"
              unit="N"
              series={series.f}
            />
            <Chart
              {...shared}
              title="Energy stores–time"
              yLabel="energy / J"
              unit="J"
              height={300}
              series={series.e}
            />
            <p className="px-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
              The gravitational potential store is measured from the origin, so
              only <em>changes</em> in it are meaningful. A flat total line
              means the kinetic and gravitational stores are trading cleanly; a
              drifting one usually means tracking scatter or a scale that is
              slightly off, which is worth discussing with students.
            </p>
          </>
        )}
        {unit === "a.u." && auNote && (
          <p className="px-1 text-[12px] leading-relaxed text-[var(--text-muted)]" data-testid="au-note">
            {auNote}
          </p>
        )}
      </section>

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
            data-testid={`fit-${label.startsWith("H") ? "x" : "y"}`}
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
                  <dd>
                    {sig(q.u)} {labels.v}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-secondary)]">
                    Acceleration, a (s–t fit)
                  </dt>
                  <dd data-testid="fit-a">
                    {sig(q.a)} {labels.a}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-secondary)]">
                    Acceleration, a (v–t gradient)
                  </dt>
                  <dd>{l ? `${sig(l.m)} ${labels.a}` : "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-secondary)]">r² of s–t fit</dt>
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
          <h3 className="text-[14px] font-medium">Data ({data.length} points)</h3>
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
          Copy, then paste straight into Google Sheets — headings and values
          land in their own cells.
        </p>
        <DataTable headers={tableHeaders} rows={tableRows} />
      </div>
    </>
  );
}

/**
 * The table is its own memoised component: with a long run it is thousands
 * of cells, and it must not be rebuilt while a chart above it is being
 * dragged.
 */
const DataTable = memo(function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="tabular w-full text-left text-[13px]" data-testid="data-table">
        <thead className="text-[var(--text-muted)]">
          <tr>
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap py-1.5 pr-4 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-[var(--border)]">
              {row.map((c, j) => (
                <td key={j} className="py-1.5 pr-4">
                  {c === "" ? "—" : j === 0 ? Number(c).toFixed(3) : Number(c).toFixed(4)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

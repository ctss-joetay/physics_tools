/**
 * Least-squares fitting and numerical differentiation for motion data.
 *
 * Everything here is pure and unit-agnostic: feed it seconds and metres and
 * you get back m/s and m/s^2.
 */

export type Pt = { t: number; s: number };

export type LinearFit = {
  /** intercept — value at t = 0 */
  c: number;
  /** gradient */
  m: number;
  r2: number;
};

export type QuadraticFit = {
  /** initial displacement, s0 */
  s0: number;
  /** initial velocity, u */
  u: number;
  /** acceleration, a (the t^2 coefficient is a/2) */
  a: number;
  r2: number;
};

function coefficientOfDetermination(
  pts: Pt[],
  predict: (t: number) => number,
): number {
  const n = pts.length;
  if (n === 0) return 0;
  const mean = pts.reduce((acc, p) => acc + p.s, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of pts) {
    const d = p.s - predict(p.t);
    ssRes += d * d;
    const dm = p.s - mean;
    ssTot += dm * dm;
  }
  // A perfectly flat data set has no variance to explain.
  if (ssTot === 0) return ssRes === 0 ? 1 : 0;
  return 1 - ssRes / ssTot;
}

/** Ordinary least squares straight line, s = c + m*t. Needs >= 2 points. */
export function fitLinear(pts: Pt[]): LinearFit | null {
  const n = pts.length;
  if (n < 2) return null;

  let sumT = 0;
  let sumS = 0;
  let sumTT = 0;
  let sumTS = 0;
  for (const p of pts) {
    sumT += p.t;
    sumS += p.s;
    sumTT += p.t * p.t;
    sumTS += p.t * p.s;
  }

  const denom = n * sumTT - sumT * sumT;
  // Every point at the same time value — no line to fit.
  if (Math.abs(denom) < 1e-12) return null;

  const m = (n * sumTS - sumT * sumS) / denom;
  const c = (sumS - m * sumT) / n;

  return { c, m, r2: coefficientOfDetermination(pts, (t) => c + m * t) };
}

/**
 * Least-squares parabola s = s0 + u*t + (a/2)*t^2, solved from the 3x3 normal
 * equations by Gaussian elimination with partial pivoting. Needs >= 3 points.
 */
export function fitQuadratic(pts: Pt[]): QuadraticFit | null {
  const n = pts.length;
  if (n < 3) return null;

  // Normal equations for the design matrix [1, t, t^2].
  const p: number[] = new Array(5).fill(0); // sums of t^0..t^4
  const b: number[] = new Array(3).fill(0); // sums of s*t^0..t^2
  for (const pt of pts) {
    let tp = 1;
    for (let k = 0; k < 5; k++) {
      p[k] += tp;
      if (k < 3) b[k] += pt.s * tp;
      tp *= pt.t;
    }
  }

  const A: number[][] = [
    [p[0], p[1], p[2], b[0]],
    [p[1], p[2], p[3], b[1]],
    [p[2], p[3], p[4], b[2]],
  ];

  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-12) return null; // singular / degenerate
    [A[col], A[pivot]] = [A[pivot], A[col]];

    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = A[r][col] / A[col][col];
      for (let c = col; c < 4; c++) A[r][c] -= factor * A[col][c];
    }
  }

  const s0 = A[0][3] / A[0][0];
  const u = A[1][3] / A[1][1];
  const half = A[2][3] / A[2][2];
  const a = 2 * half;

  return {
    s0,
    u,
    a,
    r2: coefficientOfDetermination(pts, (t) => s0 + u * t + half * t * t),
  };
}

/**
 * Velocity by central difference, which is second-order accurate and does not
 * lag the data the way a forward difference does. The first and last points
 * fall back to one-sided differences.
 */
export function derivative(pts: Pt[]): Pt[] {
  const n = pts.length;
  if (n < 2) return [];

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let v: number;
    if (i === 0) {
      const dt = pts[1].t - pts[0].t;
      if (dt === 0) continue;
      v = (pts[1].s - pts[0].s) / dt;
    } else if (i === n - 1) {
      const dt = pts[n - 1].t - pts[n - 2].t;
      if (dt === 0) continue;
      v = (pts[n - 1].s - pts[n - 2].s) / dt;
    } else {
      const dt = pts[i + 1].t - pts[i - 1].t;
      if (dt === 0) continue;
      v = (pts[i + 1].s - pts[i - 1].s) / dt;
    }
    out.push({ t: pts[i].t, s: v });
  }
  return out;
}

/** Significant-figure formatting, so readouts don't imply false precision. */
export function sig(value: number, figures = 3): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const rounded = Number(value.toPrecision(figures));
  if (Math.abs(rounded) >= 1e5 || Math.abs(rounded) < 1e-3) {
    return rounded.toExponential(figures - 1);
  }
  return String(rounded);
}

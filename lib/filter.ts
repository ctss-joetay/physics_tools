/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * An adaptive first-order low-pass: the cutoff frequency rises with the
 * speed of the signal, so a nearly still object is filtered hard (no
 * jitter) while a fast one is barely filtered (no lag). One instance per
 * axis; feed it values with their timestamps in seconds.
 */

export type OneEuroOptions = {
  /** Cutoff at rest, Hz. Lower = smoother but laggier when slow. */
  minCutoff: number;
  /** How fast the cutoff rises with speed. 0 makes it a fixed low-pass. */
  beta: number;
  /** Cutoff for the speed estimate itself, Hz. */
  dCutoff?: number;
};

class LowPass {
  private y: number | null = null;

  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }

  last(): number | null {
    return this.y;
  }

  reset(): void {
    this.y = null;
  }
}

function alphaFor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  private tPrev: number | null = null;

  constructor(opts: OneEuroOptions) {
    this.minCutoff = opts.minCutoff;
    this.beta = opts.beta;
    this.dCutoff = opts.dCutoff ?? 1;
  }

  setOptions(opts: Partial<OneEuroOptions>): void {
    if (opts.minCutoff !== undefined) this.minCutoff = opts.minCutoff;
    if (opts.beta !== undefined) this.beta = opts.beta;
    if (opts.dCutoff !== undefined) this.dCutoff = opts.dCutoff;
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.tPrev = null;
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null) {
      this.tPrev = t;
      this.dx.filter(0, 1);
      return this.x.filter(x, 1);
    }
    let dt = t - this.tPrev;
    // A repeated timestamp (rAF fallback can deliver two) must not divide
    // by zero; treat it as one short frame instead.
    if (!(dt > 0)) dt = 1 / 60;
    this.tPrev = t;

    const prev = this.x.last() ?? x;
    const dxHat = this.dx.filter((x - prev) / dt, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    return this.x.filter(x, alphaFor(cutoff, dt));
  }
}

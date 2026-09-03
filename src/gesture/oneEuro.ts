// One Euro filter (Casiez, Roussel & Vogel, CHI 2012) — the standard adaptive low-pass for hand
// tracking. At rest the cutoff sits at `minCutoff` so landmark jitter is smoothed away; as the hand
// speeds up the cutoff rises with `beta` × speed so fast moves are followed with little lag. It is
// applied per axis, in NORMALISED camera units (0..1 across the frame), and takes real timestamps so
// the recognition rate can vary (CPU vs GPU, dropped frames) without changing the feel.

export interface OneEuroParams {
  minCutoff: number; // Hz — lower = smoother at rest, more lag
  beta: number; // cutoff gain per unit of speed (normalised units / s)
  dCutoff: number; // Hz — cutoff for the derivative estimate
}

const alphaFor = (cutoff: number, dtSeconds: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSeconds);
};

export class OneEuroAxis {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private params: OneEuroParams) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }

  get value(): number | null {
    return this.x;
  }

  get velocity(): number {
    return this.dx;
  }

  filter(value: number, timestampMs: number): number {
    if (this.x === null || !(timestampMs > this.t)) {
      this.x = value;
      this.dx = 0;
      this.t = timestampMs;
      return value;
    }
    const dt = Math.min(0.25, Math.max(0.001, (timestampMs - this.t) / 1000));
    this.t = timestampMs;
    const rawD = (value - this.x) / dt;
    const aD = alphaFor(this.params.dCutoff, dt);
    this.dx = this.dx + aD * (rawD - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    const a = alphaFor(cutoff, dt);
    this.x = this.x + a * (value - this.x);
    return this.x;
  }
}

export class OneEuroPoint {
  readonly x: OneEuroAxis;
  readonly y: OneEuroAxis;
  constructor(params: OneEuroParams) {
    this.x = new OneEuroAxis(params);
    this.y = new OneEuroAxis(params);
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
  }

  filter(px: number, py: number, timestampMs: number): { x: number; y: number } {
    return { x: this.x.filter(px, timestampMs), y: this.y.filter(py, timestampMs) };
  }

  get velocity(): { x: number; y: number } {
    return { x: this.x.velocity, y: this.y.velocity };
  }
}

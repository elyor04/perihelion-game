// The flight model, mirrored line for line from internal/game/physics.go.
// Only +, -, *, / and Math.sqrt are used, all correctly rounded doubles, so
// both runtimes produce identical trajectories. Keep the operation order the
// same as the Go file; scripts/check-physics.ts verifies it against a golden
// file written by `go run ./internal/tools/export`.
//
// This file must stay plain, type-strippable TypeScript (no enums or
// parameter properties) so Node can run the check script directly.

export const SIM_DT = 1 / 120;
export const SIM_MAX_STEPS = 1800;
export const SOFT2 = 64;
export const COMET_RADIUS = 5;
export const WORLD_W = 1600;
export const WORLD_H = 1000;
export const BOUNDS_MARGIN = 60;
export const MIN_SPEED = 120;
export const MAX_SPEED = 540;

export type Outcome = "flying" | "gate" | "crash" | "horizon" | "rock" | "lost" | "stall";

export interface Vec { x: number; y: number }
export interface Planet { x: number; y: number; r: number; mu: number; style: number }
export interface Hole { x: number; y: number; r: number; mu: number }
export interface Repulsor { x: number; y: number; r: number; mu: number }
export interface Moon { cx: number; cy: number; orbit: number; r: number; mu: number; c0: number; s0: number; kc: number; ks: number }
export interface Rock { x: number; y: number; r: number; seed: number }
export interface Wormhole { ax: number; ay: number; bx: number; by: number; r: number }
export interface Gate { x: number; y: number; r: number }

export interface LevelData {
  id: string;
  sector: number;
  index: number;
  par: number;
  hint: string;
  start: Vec;
  gate: Gate;
  planets: Planet[];
  holes: Hole[];
  repulsors: Repulsor[];
  moons: Moon[];
  rocks: Rock[];
  wormholes: Wormhole[];
}

/** Go's StarsFor: three stars at par, two within par+2, else one. */
export function starsFor(shots: number, par: number): number {
  if (shots <= 0) return 0;
  if (shots <= par) return 3;
  if (shots <= par + 2) return 2;
  return 1;
}

export function launchVelocity(angle: number, power: number): [number, number] {
  const p = power < 0 ? 0 : power > 1 ? 1 : power;
  const speed = MIN_SPEED + p * (MAX_SPEED - MIN_SPEED);
  return [Math.cos(angle) * speed, Math.sin(angle) * speed];
}

function within(px: number, py: number, x: number, y: number, r: number): boolean {
  const dx = px - x;
  const dy = py - y;
  return dx * dx + dy * dy < r * r;
}

export class Sim {
  l: LevelData;
  x: number;
  y: number;
  vx: number;
  vy: number;
  step = 0;
  mc: number[];
  ms: number[];
  wlock = -1;
  outcome: Outcome = "flying";
  /** Set for the step on which the comet passed through a wormhole. */
  warped = false;

  constructor(l: LevelData, vx: number, vy: number) {
    this.l = l;
    this.x = l.start.x;
    this.y = l.start.y;
    this.vx = vx;
    this.vy = vy;
    this.mc = l.moons.map((m) => m.c0);
    this.ms = l.moons.map((m) => m.s0);
  }

  moonX(i: number): number {
    const m = this.l.moons[i];
    return m.cx + m.orbit * this.mc[i];
  }

  moonY(i: number): number {
    const m = this.l.moons[i];
    return m.cy + m.orbit * this.ms[i];
  }

  advance(): Outcome {
    if (this.outcome !== "flying") return this.outcome;
    const l = this.l;
    let ax = 0;
    let ay = 0;
    // pull(): identical to Go, inlined for speed.
    for (const p of l.planets) {
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const r2 = dx * dx + dy * dy + SOFT2;
      const inv = p.mu / (r2 * Math.sqrt(r2));
      ax += dx * inv;
      ay += dy * inv;
    }
    for (const h of l.holes) {
      const dx = h.x - this.x;
      const dy = h.y - this.y;
      const r2 = dx * dx + dy * dy + SOFT2;
      const inv = h.mu / (r2 * Math.sqrt(r2));
      ax += dx * inv;
      ay += dy * inv;
    }
    for (let i = 0; i < l.moons.length; i++) {
      const dx = this.moonX(i) - this.x;
      const dy = this.moonY(i) - this.y;
      const r2 = dx * dx + dy * dy + SOFT2;
      const inv = l.moons[i].mu / (r2 * Math.sqrt(r2));
      ax += dx * inv;
      ay += dy * inv;
    }
    for (const r of l.repulsors) {
      const dx = r.x - this.x;
      const dy = r.y - this.y;
      const r2 = dx * dx + dy * dy + SOFT2;
      const inv = r.mu / (r2 * Math.sqrt(r2));
      ax -= dx * inv;
      ay -= dy * inv;
    }
    this.vx += ax * SIM_DT;
    this.vy += ay * SIM_DT;
    this.x += this.vx * SIM_DT;
    this.y += this.vy * SIM_DT;
    for (let i = 0; i < l.moons.length; i++) {
      const m = l.moons[i];
      const c = this.mc[i];
      const s = this.ms[i];
      this.mc[i] = c * m.kc - s * m.ks;
      this.ms[i] = s * m.kc + c * m.ks;
    }
    this.step++;
    this.warped = false;
    this.outcome = this.collide();
    return this.outcome;
  }

  private collide(): Outcome {
    const l = this.l;
    const x = this.x;
    const y = this.y;
    if (within(l.gate.x, l.gate.y, x, y, l.gate.r)) return "gate";
    for (const p of l.planets) if (within(p.x, p.y, x, y, p.r + COMET_RADIUS)) return "crash";
    for (let i = 0; i < l.moons.length; i++) {
      if (within(this.moonX(i), this.moonY(i), x, y, l.moons[i].r + COMET_RADIUS)) return "crash";
    }
    for (const r of l.repulsors) if (within(r.x, r.y, x, y, r.r + COMET_RADIUS)) return "crash";
    for (const h of l.holes) if (within(h.x, h.y, x, y, h.r)) return "horizon";
    for (const r of l.rocks) if (within(r.x, r.y, x, y, r.r + COMET_RADIUS)) return "rock";
    for (let i = 0; i < l.wormholes.length; i++) {
      const w = l.wormholes[i];
      const inA = within(w.ax, w.ay, x, y, w.r);
      const inB = within(w.bx, w.by, x, y, w.r);
      if (this.wlock === i) {
        if (!inA && !inB) this.wlock = -1;
        continue;
      }
      if (inA) {
        this.x = w.bx + (x - w.ax);
        this.y = w.by + (y - w.ay);
        this.wlock = i;
        this.warped = true;
        break;
      }
      if (inB) {
        this.x = w.ax + (x - w.bx);
        this.y = w.ay + (y - w.by);
        this.wlock = i;
        this.warped = true;
        break;
      }
    }
    if (this.x < -BOUNDS_MARGIN || this.x > WORLD_W + BOUNDS_MARGIN || this.y < -BOUNDS_MARGIN || this.y > WORLD_H + BOUNDS_MARGIN) {
      return "lost";
    }
    if (this.step >= SIM_MAX_STEPS) return "stall";
    return "flying";
  }
}

/** Simulate a whole flight and return the path (one point per step). */
export function predict(l: LevelData, vx: number, vy: number, out: Float32Array): { count: number; outcome: Outcome; warps: number[] } {
  const s = new Sim(l, vx, vy);
  let n = 0;
  const warps: number[] = [];
  out[n++] = s.x;
  out[n++] = s.y;
  while (s.advance() === "flying") {
    if (s.warped) warps.push(n / 2);
    if (n + 2 <= out.length) {
      out[n++] = s.x;
      out[n++] = s.y;
    }
  }
  return { count: n / 2, outcome: s.outcome, warps };
}

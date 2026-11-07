// The flight view: a fixed-step simulation (physics.ts) drawn on a canvas.
// React owns menus and the HUD; the engine only reports ids and numbers.

import type { HapticKind } from "../api/backend";
import { AudioEngine } from "./audio";
import { Drag, Input } from "./input";
import { COMET_RADIUS, LevelData, MAX_SPEED, Outcome, SIM_DT, SIM_MAX_STEPS, Sim, launchVelocity, predict } from "./physics";
import { C, Camera, Lens, lensPoint, lensesFor, paintBackground, paintStatic, rgba } from "./render";

export type Phase = "demo" | "aim" | "flight" | "result" | "won";
export type ShotOutcome = Exclude<Outcome, "flying" | "gate"> | "recall";

export interface HudState {
  phase: Phase;
  shots: number;
  angleDeg: number;
  power: number;
}

export interface EngineEvents {
  hud(h: HudState): void;
  outcome(o: ShotOutcome): void;
  won(shots: number): void;
  haptic(k: HapticKind): void;
  /** Gamepad B during play. */
  back(): void;
  /** Gamepad Start during play. */
  pause(): void;
}

export interface EngineSettings {
  reducedMotion: boolean;
  shake: boolean;
  longGuide: boolean;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; glow: boolean }
interface Ring { x: number; y: number; r0: number; r1: number; t: number; dur: number; color: string; width: number }
interface Star { u: number; v: number; s: number; b: number; tw: number; ph: number }

const TAU = Math.PI * 2;
const STAR_COLORS = Array.from({ length: 21 }, (_, i) => rgba(C.chalk, i / 20));

/** Remove items failing `keep` without allocating a new array. */
function compact<T>(arr: T[], keep: (x: T) => boolean) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i];
  arr.length = j;
}
const DEG = 180 / Math.PI;

// The title-screen orrery: a comet on an eccentric orbit around a large world.
const DEMO: LevelData = {
  id: "demo", sector: 0, index: 0, par: 1, hint: "",
  start: { x: 1060, y: 150 },
  gate: { x: -5000, y: -5000, r: 0 },
  planets: [
    { x: 1060, y: 520, r: 108, mu: 2400 * 108 * 108, style: 1 },
    { x: 1520, y: 140, r: 30, mu: 2400 * 30 * 30, style: 3 },
  ],
  holes: [{ x: 1530, y: 890, r: 18, mu: 1.6e7 }],
  repulsors: [],
  moons: [{ cx: 1060, cy: 520, orbit: 150, r: 11, mu: 0, c0: 1, s0: 0, kc: Math.cos(TAU / 120 / 9), ks: Math.sin(TAU / 120 / 9) }],
  rocks: [],
  wormholes: [],
};

export class Game {
  readonly input: Input;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: AudioEngine;
  private cam = new Camera();
  private ev: EngineEvents | null = null;

  private level: LevelData = DEMO;
  private lenses: Lens[] = [];
  private phase: Phase = "demo";
  private shots = 0;
  private angle = 0;
  private power = 0.5;
  private sim: Sim | null = null;
  private prevX = 0;
  private prevY = 0;
  private trail: number[] = [];
  private ghost: Float32Array | null = null;
  private preview = new Float32Array((SIM_MAX_STEPS + 2) * 2);
  private previewCount = 0;
  private previewDirty = true;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private stars: Star[] = [];
  private bg: HTMLCanvasElement | null = null;
  private staticLayer: HTMLCanvasElement | null = null;
  private w = 1;
  private h = 1;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private t = 0;
  private timeScale = 1;
  private slowUntil = 0;
  private slowTarget = 1;
  private shakeAmp = 0;
  private paused = false;
  private phaseTimer = 0;
  private wonSent = false;
  private lastNear = -10;
  private nearArmed = true;
  private horizon: { hx: number; hy: number; x: number; y: number; t: number } | null = null;
  private holdTime = { turn: 0, power: 0 };
  private lastTickPower = -1;
  private hudKey = "";
  private settings: EngineSettings = { reducedMotion: false, shake: true, longGuide: false };

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.audio = audio;
    this.input = new Input(canvas);
    this.input.onDragMove = (d) => this.dragAim(d);
    this.input.onDragEnd = (d) => {
      if (this.phase === "aim" && this.dragAim(d)) this.launch();
    };
    this.input.onTap = () => {
      if (this.phase === "flight") this.recall();
    };
    for (let i = 0; i < 380; i++) {
      this.stars.push({ u: Math.random(), v: Math.random(), s: Math.random() < 0.08 ? 1.6 : Math.random() < 0.4 ? 1.1 : 0.7, b: 0.25 + Math.random() * 0.6, tw: 0.6 + Math.random() * 2, ph: Math.random() * TAU });
    }
    this.resize();
    this.showDemo();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  setEvents(ev: EngineEvents) {
    this.ev = ev;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.probe?.remove();
    this.input.destroy();
    this.audio.flight(null);
  }

  applySettings(s: EngineSettings) {
    const repaint = s.reducedMotion !== this.settings.reducedMotion;
    this.settings = { ...s };
    this.previewDirty = true;
    if (repaint) this.repaint();
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) {
      this.input.cancelDrag();
      this.audio.flight(null);
    } else {
      this.last = performance.now();
      this.input.resetPad();
    }
  }

  setInputEnabled(on: boolean) {
    if (on && !this.input.enabled) {
      this.input.clearPresses();
      this.input.resetPad();
    }
    this.input.enabled = on;
    if (!on) this.input.cancelDrag();
  }

  // ------------------------------------------------------------ levels

  showDemo() {
    this.level = DEMO;
    this.phase = "demo";
    this.shots = 0;
    this.ghost = null;
    this.particles = [];
    this.rings = [];
    this.horizon = null;
    this.startDemoOrbit();
    this.repaint();
  }

  private startDemoOrbit() {
    const sun = DEMO.planets[0];
    const r = sun.y - DEMO.start.y;
    const v = Math.sqrt(sun.mu / r) * 0.8;
    this.sim = new Sim(DEMO, -v, 0);
    this.prevX = this.sim.x;
    this.prevY = this.sim.y;
    this.trail = [];
  }

  /** Open a level. Aim starts pointing at the gate with half power. */
  loadLevel(level: LevelData) {
    this.level = level;
    this.shots = 0;
    this.ghost = null;
    this.particles = [];
    this.rings = [];
    this.horizon = null;
    this.angle = Math.atan2(level.gate.y - level.start.y, level.gate.x - level.start.x);
    this.power = 0.5;
    this.toAim();
    this.repaint();
    this.emitHud(true);
  }

  restart() {
    // Once the gate is reached the clear is final; nothing may undo it.
    if (this.phase === "demo" || this.phase === "won") return;
    this.audio.flight(null);
    this.shots = 0;
    this.ghost = null;
    this.horizon = null;
    this.toAim();
    this.emitHud(true);
  }

  private toAim() {
    this.phase = "aim";
    this.sim = null;
    this.trail = [];
    this.previewDirty = true;
    this.timeScale = 1;
    this.slowUntil = 0;
    this.input.clearPresses();
  }

  // ------------------------------------------------------------ layout

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.cam.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.bg = paintBackground(w, h, dpr);
    this.repaint();
  }

  private probe: HTMLDivElement | null = null;

  /** Safe-area insets in CSS px (custom properties holding env() don't resolve, padding does). */
  private insets() {
    if (!this.probe) {
      const p = document.createElement("div");
      p.setAttribute("aria-hidden", "true");
      p.style.cssText =
        "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
        "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
      document.body.appendChild(p);
      this.probe = p;
    }
    const cs = getComputedStyle(this.probe);
    const v = (x: string) => parseFloat(x) || 0;
    return { top: v(cs.paddingTop), bottom: v(cs.paddingBottom), left: v(cs.paddingLeft), right: v(cs.paddingRight) };
  }

  private repaint() {
    const ins = this.insets();
    if (this.phase === "demo") {
      this.cam.fit(this.w, this.h, ins.top, ins.bottom, 0);
      // Let the orrery overflow a little so it reads as a backdrop.
      this.cam.scale *= this.w < 700 ? 1.25 : 1.12;
      // Portrait: lift the orrery above the menu, which sits at the bottom.
      if (this.cam.rot) this.cam.cy = this.h * 0.36;
    } else {
      const compact = this.h < 520 || this.w < 520;
      // Short landscape screens: the HUD sits in the corners, so let the
      // chart run up between them and keep only a sliver of margin.
      const wideShort = this.h < 520 && this.w > this.h * 1.5;
      const top = ins.top + (wideShort ? 30 : compact ? 50 : 66);
      const bottom = ins.bottom + (wideShort ? 12 : compact ? 40 : 62);
      this.cam.fit(this.w, this.h, top, bottom, Math.max(ins.left, ins.right) + 10, compact ? 24 : 60);
    }
    this.lenses = lensesFor(this.level);
    this.staticLayer = paintStatic(this.level, this.cam, this.w, this.h);
    this.previewDirty = true;
  }

  // ------------------------------------------------------------ aiming

  private maxDrag() {
    return Math.max(110, Math.min(300, Math.min(this.w, this.h) * 0.34));
  }

  /** Aim from a drag: pull back from the press point, like a slingshot. */
  private dragAim(d: Drag): boolean {
    if (this.phase !== "aim") return false;
    const dx = d.x0 - d.x;
    const dy = d.y0 - d.y;
    const len = Math.hypot(dx, dy);
    if (len < 10) return false;
    const [wx, wy] = this.cam.dirToWorld(dx, dy);
    this.angle = Math.atan2(wy, wx);
    this.setPower(len / this.maxDrag());
    this.previewDirty = true;
    return true;
  }

  /** Set the aim exactly. Exposed as window.__game in dev builds for browser tests. */
  debugAim(deg: number, power: number) {
    if (this.phase !== "aim") return;
    this.angle = deg / DEG;
    this.power = power;
    this.previewDirty = true;
    this.emitHud(true);
  }

  private setPower(p: number) {
    this.power = Math.min(1, Math.max(0, p));
    if (Math.abs(this.power - this.lastTickPower) >= 0.04) {
      this.lastTickPower = this.power;
      this.audio.aimTick(this.power);
    }
  }

  private launch() {
    if (this.phase !== "aim") return;
    this.shots++;
    const [vx, vy] = launchVelocity(this.angle, this.power);
    this.sim = new Sim(this.level, vx, vy);
    this.prevX = this.sim.x;
    this.prevY = this.sim.y;
    this.trail = [this.sim.x, this.sim.y];
    this.phase = "flight";
    this.acc = 0;
    this.nearArmed = true;
    this.audio.unlock();
    this.audio.play("launch", this.power);
    this.ev?.haptic("light");
    this.burst(this.sim.x, this.sim.y, 14, C.ember, 60, true);
    this.emitHud(true);
  }

  private recall() {
    if (this.phase !== "flight" || !this.sim) return;
    this.endFlight("recall");
  }

  private handleControls(dt: number) {
    const inp = this.input;
    inp.pollPad();
    if (!inp.enabled || this.phase === "demo") return;
    const pad = inp.pad;

    if (inp.consume("KeyR") || inp.padPressed(3)) {
      this.restart();
      return;
    }
    if (inp.padPressed(9)) this.ev?.pause();
    if (inp.padPressed(1)) this.ev?.back();
    const fire = inp.consume("Space") || inp.consume("Enter") || inp.consume("NumpadEnter") || inp.padPressed(0);

    if (this.phase === "flight") {
      if (fire) this.recall();
      return;
    }
    if (this.phase !== "aim") return;

    const fine = inp.shift;
    const angle0 = this.angle;
    const power0 = this.power;
    // Turning: a tap nudges, holding sweeps faster after a short delay.
    let turn = 0;
    if (inp.isHeld("ArrowLeft", "KeyA") || pad?.buttons[14]) turn -= 1;
    if (inp.isHeld("ArrowRight", "KeyD") || pad?.buttons[15]) turn += 1;
    const tapL = inp.consume("ArrowLeft") || inp.consume("KeyA") || inp.padPressed(14);
    const tapR = inp.consume("ArrowRight") || inp.consume("KeyD") || inp.padPressed(15);
    const step = (fine ? 0.1 : 0.5) / DEG;
    if (tapL) this.angle -= step;
    if (tapR) this.angle += step;
    if (turn !== 0) {
      this.holdTime.turn += dt;
      if (this.holdTime.turn > 0.28) {
        const rate = fine ? 0.12 : Math.min(1.6, 0.35 + (this.holdTime.turn - 0.28) * 1.4);
        this.angle += turn * rate * dt;
      }
    } else this.holdTime.turn = 0;

    let pw = 0;
    if (inp.isHeld("ArrowUp", "KeyW") || pad?.buttons[12]) pw += 1;
    if (inp.isHeld("ArrowDown", "KeyS") || pad?.buttons[13]) pw -= 1;
    const tapU = inp.consume("ArrowUp") || inp.consume("KeyW") || inp.padPressed(12);
    const tapD = inp.consume("ArrowDown") || inp.consume("KeyS") || inp.padPressed(13);
    let power = this.power;
    const pstep = fine ? 0.002 : 0.01;
    if (tapU) power += pstep;
    if (tapD) power -= pstep;
    if (pw !== 0) {
      this.holdTime.power += dt;
      if (this.holdTime.power > 0.28) power += pw * (fine ? 0.05 : 0.4) * dt;
    } else this.holdTime.power = 0;

    if (pad) {
      // The left stick points where the comet will go.
      const mag = Math.hypot(pad.ax, pad.ay);
      if (mag > 0.45) {
        const [wx, wy] = this.cam.dirToWorld(pad.ax, pad.ay);
        const target = Math.atan2(wy, wx);
        let diff = target - this.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.angle += diff * Math.min(1, dt * (fine ? 4 : 14));
      }
      const trig = pad.rt - pad.lt + (Math.abs(pad.ry) > 0.25 ? -pad.ry : 0);
      if (Math.abs(trig) > 0.06) power += trig * (fine ? 0.08 : 0.45) * dt;
    }
    if (power !== this.power) this.setPower(power);
    this.angle = Math.atan2(Math.sin(this.angle), Math.cos(this.angle));
    if (this.angle !== angle0 || this.power !== power0) this.previewDirty = true;

    if (fire) this.launch();
  }

  // ------------------------------------------------------------ simulation

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.paused) this.update(dt);
    this.render();
  };

  private slow(target: number, dur: number) {
    this.slowTarget = Math.min(this.slowTarget < 1 && this.t < this.slowUntil ? this.slowTarget : 1, target);
    this.slowUntil = Math.max(this.slowUntil, this.t + dur);
  }

  private update(dt: number) {
    this.t += dt;
    if (this.t >= this.slowUntil) this.slowTarget = 1;
    this.timeScale += (this.slowTarget - this.timeScale) * Math.min(1, dt * 9);
    this.handleControls(dt);

    if ((this.phase === "flight" || this.phase === "demo") && this.sim) {
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 14 && this.sim) {
        this.acc -= SIM_DT;
        steps++;
        this.step();
      }
      if (this.phase === "flight" && this.sim) {
        const sp = Math.hypot(this.sim.vx, this.sim.vy) / MAX_SPEED;
        this.audio.flight(Math.min(1, sp));
        this.emitTail(dt);
      }
    }

    if (this.phase === "result") {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.toAim();
        this.emitHud(true);
      }
    } else if (this.phase === "won") {
      this.phaseTimer = Math.max(0, this.phaseTimer - dt);
    }

    const pdt = dt * this.timeScale;
    for (const p of this.particles) {
      p.life -= pdt;
      p.x += p.vx * pdt;
      p.y += p.vy * pdt;
      p.vx *= 1 - 1.6 * pdt;
      p.vy *= 1 - 1.6 * pdt;
    }
    compact(this.particles, (p) => p.life > 0);
    for (const r of this.rings) r.t += pdt;
    compact(this.rings, (r) => r.t < r.dur);
    if (this.horizon) {
      this.horizon.t += pdt;
      if (this.horizon.t > 0.9) this.horizon = null;
    }
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 30);
    if (this.phase !== "demo") this.emitHud(false);
  }

  private step() {
    const s = this.sim!;
    this.prevX = s.x;
    this.prevY = s.y;
    const out = s.advance();
    if (this.phase === "demo") {
      this.trail.push(s.x, s.y);
      if (this.trail.length > 1400) this.trail.splice(0, this.trail.length - 1400);
      if (out !== "flying" || s.step > SIM_MAX_STEPS - 10) {
        if (out === "flying") {
          // Continue the same orbit seamlessly from where it is.
          const cont: LevelData = { ...DEMO, start: { x: s.x, y: s.y }, moons: DEMO.moons.map((m, i) => ({ ...m, c0: s.mc[i], s0: s.ms[i] })) };
          const n = new Sim(cont, s.vx, s.vy);
          this.sim = n;
        } else this.startDemoOrbit();
      }
      return;
    }
    if (s.warped) {
      this.warpFx();
      this.prevX = s.x;
      this.prevY = s.y;
      this.trail.push(NaN, NaN);
    }
    this.trail.push(s.x, s.y);
    if (out === "flying") this.nearMiss(s);
    else this.endFlight(out);
  }

  private warpFx() {
    const s = this.sim!;
    const w = this.level.wormholes[s.wlock];
    if (w) {
      this.rings.push({ x: w.ax, y: w.ay, r0: w.r * 0.3, r1: w.r * 2.2, t: 0, dur: 0.6, color: C.mist, width: 2 });
      this.rings.push({ x: w.bx, y: w.by, r0: w.r * 2.2, r1: w.r * 0.3, t: 0, dur: 0.5, color: C.ember, width: 2 });
    }
    this.audio.play("warp");
    this.ev?.haptic("medium");
  }

  /** Slow time briefly when the comet skims past something deadly or the gate. */
  private nearMiss(s: Sim) {
    const l = this.level;
    let clear = Infinity;
    for (const p of l.planets) clear = Math.min(clear, Math.hypot(p.x - s.x, p.y - s.y) - p.r - COMET_RADIUS);
    for (const h of l.holes) clear = Math.min(clear, Math.hypot(h.x - s.x, h.y - s.y) - h.r);
    for (const r of l.rocks) clear = Math.min(clear, Math.hypot(r.x - s.x, r.y - s.y) - r.r - COMET_RADIUS);
    for (let i = 0; i < l.moons.length; i++) clear = Math.min(clear, Math.hypot(s.moonX(i) - s.x, s.moonY(i) - s.y) - l.moons[i].r - COMET_RADIUS);
    const gateGap = Math.hypot(l.gate.x - s.x, l.gate.y - s.y) - l.gate.r;
    const close = clear < 14 || (gateGap > 0 && gateGap < 26);
    if (close && this.nearArmed && s.step > 12 && this.t - this.lastNear > 0.8) {
      this.nearArmed = false;
      this.lastNear = this.t;
      this.slow(this.settings.reducedMotion ? 0.55 : 0.3, 0.45);
      this.audio.play("nearMiss");
      this.ev?.haptic("selection");
    } else if (!close) this.nearArmed = true;
  }

  private endFlight(out: Outcome | "recall") {
    const s = this.sim!;
    this.audio.flight(null);
    this.ghost = Float32Array.from(this.trail);
    this.sim = null;
    if (out === "gate") {
      this.phase = "won";
      this.phaseTimer = 1.25;
      this.wonSent = false;
      const g = this.level.gate;
      this.rings.push({ x: g.x, y: g.y, r0: g.r, r1: g.r * 4, t: 0, dur: 1.1, color: C.gate, width: 3 });
      this.rings.push({ x: g.x, y: g.y, r0: g.r * 0.5, r1: g.r * 2.4, t: 0, dur: 0.8, color: C.ember, width: 2 });
      this.burst(s.x, s.y, 40, C.gate, 160, true);
      this.burst(s.x, s.y, 30, C.ember, 120, true);
      this.slow(0.35, 0.6);
      this.audio.play("gate");
      this.ev?.haptic("success");
      // Report the clear right away (it is saved even if the app is closed
      // during the arrival animation); the UI delays its dialog.
      if (!this.wonSent) {
        this.wonSent = true;
        this.ev?.won(this.shots);
      }
      this.prevX = s.x;
      this.prevY = s.y;
      this.trailHead = [s.x, s.y];
      this.emitHud(true);
      return;
    }
    this.phase = "result";
    this.phaseTimer = out === "horizon" ? 1.3 : 1.05;
    this.trailHead = null;
    switch (out) {
      case "crash":
        this.burst(s.x, s.y, 46, C.chalk, 190, false);
        this.burst(s.x, s.y, 24, C.ember, 140, true);
        this.rings.push({ x: s.x, y: s.y, r0: 4, r1: 70, t: 0, dur: 0.5, color: C.chalk, width: 2 });
        this.shake(9);
        this.audio.play("crash");
        this.ev?.haptic("heavy");
        break;
      case "rock":
        this.burst(s.x, s.y, 36, C.coral, 170, false);
        this.burst(s.x, s.y, 18, C.ember, 120, true);
        this.shake(7);
        this.audio.play("rock");
        this.ev?.haptic("heavy");
        break;
      case "horizon": {
        const h = this.level.holes.reduce((a, b) => (Math.hypot(b.x - s.x, b.y - s.y) < Math.hypot(a.x - s.x, a.y - s.y) ? b : a));
        this.horizon = { hx: h.x, hy: h.y, x: s.x, y: s.y, t: 0 };
        this.audio.play("horizon");
        this.ev?.haptic("medium");
        break;
      }
      case "lost":
        this.audio.play("lost");
        this.ev?.haptic("light");
        break;
      default:
        this.burst(s.x, s.y, 16, C.mist, 70, false);
        this.audio.play("recall");
        this.ev?.haptic("light");
    }
    this.ev?.outcome(out as ShotOutcome);
    this.emitHud(true);
  }

  private trailHead: [number, number] | null = null;

  private shake(px: number) {
    if (this.settings.shake && !this.settings.reducedMotion) this.shakeAmp = Math.max(this.shakeAmp, px);
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, glow: boolean) {
    const count = this.settings.reducedMotion ? Math.ceil(n / 2) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.25 + Math.random() * 0.75);
      const life = 0.4 + Math.random() * 0.7;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: 1 + Math.random() * 2.2, color, glow });
    }
  }

  private emitTail(dt: number) {
    const s = this.sim!;
    const n = this.settings.reducedMotion ? 1 : 3;
    const sp = Math.hypot(s.vx, s.vy) || 1;
    for (let i = 0; i < n * Math.min(2, dt * 60); i++) {
      const spread = 26;
      const life = 0.5 + Math.random() * 0.6;
      this.particles.push({
        x: s.x, y: s.y,
        vx: (-s.vx / sp) * 40 + (Math.random() - 0.5) * spread,
        vy: (-s.vy / sp) * 40 + (Math.random() - 0.5) * spread,
        life, max: life, size: 0.8 + Math.random() * 1.8,
        color: Math.random() < 0.7 ? C.ember : C.emberHot, glow: true,
      });
    }
  }

  private emitHud(force: boolean) {
    const h: HudState = {
      phase: this.phase,
      shots: this.shots,
      angleDeg: Math.round(((-this.angle * DEG + 360) % 360) * 10) / 10,
      power: Math.round(this.power * 100),
    };
    const key = `${h.phase}|${h.shots}|${h.angleDeg}|${h.power}`;
    if (!force && key === this.hudKey) return;
    this.hudKey = key;
    this.ev?.hud(h);
  }

  // ------------------------------------------------------------ rendering

  private render() {
    const ctx = this.ctx;
    const cam = this.cam;
    const dpr = cam.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    else {
      ctx.fillStyle = C.prussian;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    const ox = this.shakeAmp ? (Math.random() - 0.5) * this.shakeAmp : 0;
    const oy = this.shakeAmp ? (Math.random() - 0.5) * this.shakeAmp : 0;
    cam.cx += ox;
    cam.cy += oy;

    this.drawStars();
    if (this.staticLayer) ctx.drawImage(this.staticLayer, ox * dpr, oy * dpr);
    cam.apply(ctx);
    const px = 1 / cam.scale;

    this.drawGhost(px);
    this.drawTrail(px);
    this.drawBodies(px);
    if (this.phase === "aim") this.drawAim(px);
    this.drawParticles(px);
    this.drawComet(px);
    for (const r of this.rings) {
      const k = r.t / r.dur;
      const e = 1 - Math.pow(1 - k, 3);
      ctx.strokeStyle = rgba(r.color, (1 - k) * 0.9);
      ctx.lineWidth = r.width * px;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0.1, r.r0 + (r.r1 - r.r0) * e), 0, TAU);
      ctx.stroke();
    }
    cam.cx -= ox;
    cam.cy -= oy;
  }

  private drawStars() {
    const ctx = this.ctx;
    const cam = this.cam;
    const dpr = cam.dpr;
    const pt: [number, number] = [0, 0];
    const still = this.settings.reducedMotion;
    for (const s of this.stars) {
      const sx = s.u * this.w;
      const sy = s.v * this.h;
      let x = sx;
      let y = sy;
      if (this.lenses.length) {
        const [wx, wy] = cam.toWorld(sx, sy);
        lensPoint(wx, wy, this.lenses, pt);
        [x, y] = cam.toScreen(pt[0], pt[1]);
      }
      const a = still ? s.b : s.b * (0.7 + 0.3 * Math.sin(this.t * s.tw + s.ph));
      ctx.fillStyle = STAR_COLORS[Math.min(STAR_COLORS.length - 1, Math.round(a * (STAR_COLORS.length - 1)))];
      const size = s.s * dpr;
      ctx.fillRect(x * dpr - size / 2, y * dpr - size / 2, size, size);
    }
  }

  private polyline(pts: ArrayLike<number>, from: number, to: number) {
    const ctx = this.ctx;
    let pen = false;
    ctx.beginPath();
    for (let i = from; i < to; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (Number.isNaN(x)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }

  private drawGhost(px: number) {
    if (!this.ghost || this.phase === "demo") return;
    const ctx = this.ctx;
    ctx.setLineDash([2 * px, 6 * px]);
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = rgba(C.mist, this.phase === "aim" ? 0.55 : 0.25);
    this.polyline(this.ghost, 0, this.ghost.length / 2);
    ctx.setLineDash([]);
  }

  private drawTrail(px: number) {
    const pts = this.trail;
    const n = pts.length / 2;
    if (n < 2) return;
    const ctx = this.ctx;
    const segs = 10;
    const span = this.phase === "demo" ? n : Math.min(n, 900);
    const start = n - span;
    ctx.lineCap = "round";
    for (let k = 0; k < segs; k++) {
      const a = start + Math.floor((span * k) / segs);
      const b = Math.min(n, start + Math.floor((span * (k + 1)) / segs) + 1);
      const f = (k + 1) / segs;
      ctx.strokeStyle = rgba(C.ember, (this.phase === "demo" ? 0.4 : 0.75) * f * f);
      ctx.lineWidth = (0.8 + 1.4 * f) * px;
      this.polyline(pts, a, b);
    }
  }

  private drawBodies(px: number) {
    const ctx = this.ctx;
    const l = this.level;
    const t = this.settings.reducedMotion ? this.t * 0.25 : this.t;

    // Moons follow the live flight; otherwise they wait at their starting phase.
    l.moons.forEach((m, i) => {
      const s = this.sim;
      const live = s && (this.phase === "flight" || this.phase === "demo");
      const x = live ? s.moonX(i) : m.cx + m.orbit * m.c0;
      const y = live ? s.moonY(i) : m.cy + m.orbit * m.s0;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, TAU);
      ctx.fillStyle = "#16406F";
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.arc(x + m.r * 0.5, y + m.r * 0.5, m.r * 0.95, 0, TAU);
      ctx.fillStyle = rgba(C.ink, 0.45);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, TAU);
      ctx.strokeStyle = C.chalk;
      ctx.lineWidth = 1.4 * px;
      ctx.stroke();
    });

    for (const h of l.holes) {
      const glow = ctx.createRadialGradient(h.x, h.y, h.r * 0.6, h.x, h.y, h.r * 3.2);
      glow.addColorStop(0, rgba(C.ink, 0.95));
      glow.addColorStop(0.45, rgba(C.ink, 0.5));
      glow.addColorStop(1, rgba(C.ink, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r * 3.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#02060D";
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r * 0.8, 0, TAU);
      ctx.fill();
      // The event horizon: a dashed coral ring (crossing it loses the comet).
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.lineDashOffset = -t * 6 * px;
      ctx.strokeStyle = rgba(C.coral, 0.95);
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      // Photon ring.
      ctx.strokeStyle = rgba(C.chalk, 0.9);
      ctx.lineWidth = 1.1 * px;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r * 1.32, 0, TAU);
      ctx.stroke();
      // Accretion streaks circling the hole.
      for (let i = 0; i < 4; i++) {
        const rr = h.r * (1.55 + i * 0.32);
        const a0 = t * (1.6 - i * 0.28) + i * 1.7;
        ctx.strokeStyle = rgba(C.chalk, 0.42 - i * 0.08);
        ctx.lineWidth = (1.2 - i * 0.15) * px;
        ctx.beginPath();
        ctx.arc(h.x, h.y, rr, a0, a0 + 1.1 + i * 0.25);
        ctx.stroke();
      }
    }

    for (const r of l.repulsors) {
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.55 + i / 3) % 1 + 1) % 1;
        ctx.strokeStyle = rgba(C.chalk, (1 - k) * 0.45);
        ctx.lineWidth = 1.2 * px;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * (1 + k * 2.4), 0, TAU);
        ctx.stroke();
      }
      const core = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.r);
      core.addColorStop(0, rgba(C.chalk, 1));
      core.addColorStop(0.6, rgba(C.chalk, 0.85));
      core.addColorStop(1, rgba(C.chalk, 0.15));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.fill();
      // Outward chevrons.
      ctx.strokeStyle = rgba(C.prussian, 0.8);
      ctx.lineWidth = 1.4 * px;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + t * 0.2;
        const c1 = r.r * 0.35;
        const c2 = r.r * 0.7;
        ctx.beginPath();
        ctx.moveTo(r.x + Math.cos(a - 0.25) * c1, r.y + Math.sin(a - 0.25) * c1);
        ctx.lineTo(r.x + Math.cos(a) * c2, r.y + Math.sin(a) * c2);
        ctx.lineTo(r.x + Math.cos(a + 0.25) * c1, r.y + Math.sin(a + 0.25) * c1);
        ctx.stroke();
      }
    }

    l.wormholes.forEach((w, i) => {
      for (const [x, y, dir] of [[w.ax, w.ay, 1], [w.bx, w.by, -1]] as const) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, w.r);
        g.addColorStop(0, rgba(C.ink, 0.95));
        g.addColorStop(0.7, rgba(C.deep, 0.7));
        g.addColorStop(1, rgba(C.mist, 0.12));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, w.r, 0, TAU);
        ctx.fill();
        for (let k = 0; k < 3; k++) {
          const rr = w.r * (1 - k * 0.26);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(dir * t * (0.8 + k * 0.5));
          ctx.setLineDash([(6 - k) * px, (5 + k) * px]);
          ctx.strokeStyle = rgba(C.mist, 0.9 - k * 0.22);
          ctx.lineWidth = (1.6 - k * 0.3) * px;
          ctx.beginPath();
          ctx.arc(0, 0, rr, 0, TAU);
          ctx.stroke();
          ctx.restore();
        }
        ctx.setLineDash([]);
        // Pair marks: one dot for the first pair, two for the second...
        ctx.fillStyle = C.mist;
        for (let d = 0; d <= i; d++) {
          const a = -Math.PI / 2 + (d - i / 2) * 0.35;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * (w.r + 7 * px), y + Math.sin(a) * (w.r + 7 * px), 1.8 * px, 0, TAU);
          ctx.fill();
        }
      }
    });

    const g = l.gate;
    if (g.r > 0) {
      const won = this.phase === "won";
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
      const glow = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r * 1.6);
      glow.addColorStop(0, rgba(C.gate, won ? 0.45 : 0.12 + pulse * 0.05));
      glow.addColorStop(1, rgba(C.gate, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * 1.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = C.gate;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 1.3 * px;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + t * 0.25;
        const r1 = g.r + 4 * px;
        const r2 = g.r + (i % 3 === 0 ? 12 : 7) * px;
        ctx.beginPath();
        ctx.moveTo(g.x + Math.cos(a) * r1, g.y + Math.sin(a) * r1);
        ctx.lineTo(g.x + Math.cos(a) * r2, g.y + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(C.gate, 0.5);
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * 0.45, 0, TAU);
      ctx.stroke();
    }
  }

  private drawAim(px: number) {
    const ctx = this.ctx;
    const st = this.level.start;
    if (this.previewDirty) {
      const [vx, vy] = launchVelocity(this.angle, this.power);
      this.previewCount = predict(this.level, vx, vy, this.preview).count;
      this.previewDirty = false;
    }
    // Dotted guide over the first quarter (or half) of the predicted path.
    const pts = this.preview;
    let total = 0;
    for (let i = 1; i < this.previewCount; i++) total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const frac = this.settings.longGuide ? 0.5 : 0.25;
    const limit = Math.min(total * frac, this.settings.longGuide ? 1100 : 700);
    const gap = 13 * px;
    let walked = 0;
    let nextDot = gap;
    for (let i = 1; i < this.previewCount && walked < limit; i++) {
      const x0 = pts[i * 2 - 2];
      const y0 = pts[i * 2 - 1];
      const x1 = pts[i * 2];
      const y1 = pts[i * 2 + 1];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (seg > 200) {
        walked += seg; // wormhole jump: no dots across the fold
        nextDot = walked + gap;
        continue;
      }
      while (nextDot <= walked + seg && nextDot < limit) {
        const k = (nextDot - walked) / seg;
        const fade = 1 - nextDot / limit;
        ctx.fillStyle = rgba(C.ember, 0.15 + 0.8 * fade);
        ctx.beginPath();
        ctx.arc(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, (1.2 + fade) * px, 0, TAU);
        ctx.fill();
        nextDot += gap;
      }
      walked += seg;
    }

    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);
    // Rubber band while dragging: shows the pull.
    const drag = this.input.drag;
    if (drag && this.input.enabled) {
      const len = Math.min(Math.hypot(drag.x - drag.x0, drag.y - drag.y0), this.maxDrag()) * 0.5;
      ctx.setLineDash([3 * px, 4 * px]);
      ctx.strokeStyle = rgba(C.chalk, 0.5);
      ctx.lineWidth = 1.2 * px;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(st.x - dx * len * px, st.y - dy * len * px);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Direction arrow, longer with power.
    const len = (34 + this.power * 70) * px;
    const ex = st.x + dx * len;
    const ey = st.y + dy * len;
    ctx.strokeStyle = C.ember;
    ctx.lineWidth = 2 * px;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(st.x + dx * 14 * px, st.y + dy * 14 * px);
    ctx.lineTo(ex, ey);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - (dx * 8 - dy * 5) * px, ey - (dy * 8 + dx * 5) * px);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - (dx * 8 + dy * 5) * px, ey - (dy * 8 - dx * 5) * px);
    ctx.stroke();
    // Power ring.
    const rr = 24 * px;
    ctx.strokeStyle = rgba(C.chalk, 0.18);
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath();
    ctx.arc(st.x, st.y, rr, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = C.ember;
    ctx.beginPath();
    ctx.arc(st.x, st.y, rr, this.angle - this.power * Math.PI, this.angle + this.power * Math.PI);
    ctx.stroke();
  }

  private drawParticles(px: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      if (!p.glow) continue;
      const k = p.life / p.max;
      ctx.fillStyle = rgba(p.color, k * 0.8);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.8) * px, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    for (const p of this.particles) {
      if (p.glow) continue;
      const k = p.life / p.max;
      ctx.fillStyle = rgba(p.color, k);
      ctx.fillRect(p.x - p.size * px * 0.6, p.y - p.size * px * 0.6, p.size * px * 1.2, p.size * px * 1.2);
    }
  }

  private head(x: number, y: number, px: number, scale = 1) {
    const ctx = this.ctx;
    const r = 15 * px * scale;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(C.emberHot, 1));
    g.addColorStop(0.25, rgba(C.ember, 0.85));
    g.addColorStop(1, rgba(C.ember, 0));
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = C.emberHot;
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * px * scale, 0, TAU);
    ctx.fill();
  }

  private drawComet(px: number) {
    if (this.horizon) {
      // Spiral into the black hole, stretching and fading.
      const h = this.horizon;
      const k = Math.min(1, h.t / 0.9);
      const a0 = Math.atan2(h.y - h.hy, h.x - h.hx);
      const d0 = Math.hypot(h.y - h.hy, h.x - h.hx);
      const a = a0 + k * 5;
      const d = d0 * (1 - k);
      this.head(h.hx + Math.cos(a) * d, h.hy + Math.sin(a) * d, px, 1 - k * 0.9);
      return;
    }
    if (this.phase === "aim") {
      const st = this.level.start;
      this.head(st.x, st.y, px, 0.9 + 0.1 * Math.sin(this.t * 3));
      return;
    }
    if (this.phase === "won" && this.trailHead) {
      const g = this.level.gate;
      const k = Math.max(0, this.phaseTimer / 1.25);
      this.head(g.x + (this.trailHead[0] - g.x) * k, g.y + (this.trailHead[1] - g.y) * k, px, 0.6 + k * 0.4);
      return;
    }
    const s = this.sim;
    if (!s) return;
    const alpha = Math.min(1, this.acc / SIM_DT);
    const x = this.prevX + (s.x - this.prevX) * alpha;
    const y = this.prevY + (s.y - this.prevY) * alpha;
    this.head(x, y, px);
  }
}

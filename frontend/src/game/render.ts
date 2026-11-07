// Drawing helpers: the cyanotype palette, a camera that can turn the chart
// on its side for portrait screens, and the cached static layer (warped
// graticule, isolines, planets, belts) that only changes on resize.

import { BOUNDS_MARGIN, LevelData, Planet, WORLD_H, WORLD_W } from "./physics";

export const C = {
  prussian: "#0E2A4F",
  deep: "#081A33",
  ink: "#05101F",
  chalk: "#E8E4D3",
  mist: "#8FA8C8",
  ember: "#FFB547",
  emberHot: "#FFF1D2",
  coral: "#F2705E",
  gate: "#8FE3C0",
};

export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const WCX = WORLD_W / 2;
const WCY = WORLD_H / 2;

/** Maps chart coordinates to CSS pixels. `rot` turns the chart 90° counter-clockwise. */
export class Camera {
  scale = 1;
  rot = false;
  cx = 0;
  cy = 0;
  dpr = 1;

  fit(w: number, h: number, top: number, bottom: number, side: number, margin = BOUNDS_MARGIN) {
    this.rot = h > w * 1.05;
    const vw = WORLD_W + 2 * margin;
    const vh = WORLD_H + 2 * margin;
    const aw = Math.max(50, w - 2 * side);
    const ah = Math.max(50, h - top - bottom);
    this.scale = this.rot ? Math.min(aw / vh, ah / vw) : Math.min(aw / vw, ah / vh);
    this.cx = w / 2;
    this.cy = top + ah / 2;
  }

  toScreen(x: number, y: number): [number, number] {
    const dx = x - WCX;
    const dy = y - WCY;
    return this.rot ? [this.cx + dy * this.scale, this.cy - dx * this.scale] : [this.cx + dx * this.scale, this.cy + dy * this.scale];
  }

  toWorld(sx: number, sy: number): [number, number] {
    const ux = (sx - this.cx) / this.scale;
    const uy = (sy - this.cy) / this.scale;
    return this.rot ? [WCX - uy, WCY + ux] : [WCX + ux, WCY + uy];
  }

  /** Rotate a screen-space direction into chart space. */
  dirToWorld(dx: number, dy: number): [number, number] {
    return this.rot ? [-dy, dx] : [dx, dy];
  }

  /** Apply the chart transform (scaled for the device pixel ratio). */
  apply(ctx: CanvasRenderingContext2D) {
    const s = this.scale * this.dpr;
    const d = this.dpr;
    if (this.rot) ctx.setTransform(0, -s, s, 0, (this.cx - this.scale * WCY) * d, (this.cy + this.scale * WCX) * d);
    else ctx.setTransform(s, 0, 0, s, (this.cx - this.scale * WCX) * d, (this.cy - this.scale * WCY) * d);
  }
}

/** A gravitational lens in chart space: images are pushed out to (b + sqrt(b^2 + 4 rE^2)) / 2. */
export interface Lens { x: number; y: number; re: number }

export function lensesFor(l: LevelData): Lens[] {
  const out: Lens[] = [];
  for (const h of l.holes) out.push({ x: h.x, y: h.y, re: 0.016 * Math.sqrt(h.mu) });
  for (const p of l.planets) out.push({ x: p.x, y: p.y, re: 0.006 * Math.sqrt(p.mu) });
  return out;
}

export function lensPoint(x: number, y: number, lenses: Lens[], out: [number, number]) {
  let px = x;
  let py = y;
  for (const L of lenses) {
    const dx = px - L.x;
    const dy = py - L.y;
    const b = Math.sqrt(dx * dx + dy * dy) + 1e-6;
    const th = (b + Math.sqrt(b * b + 4 * L.re * L.re)) / 2;
    px = L.x + (dx / b) * th;
    py = L.y + (dy / b) * th;
  }
  out[0] = px;
  out[1] = py;
}

/** Deterministic pseudo-random numbers for decorative variation. */
export function hash01(n: number) {
  let h = (n | 0) * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

/** Background: Prussian-blue wash, paper grain and vignette, at device resolution. */
export function paintBackground(w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(c.width * 0.55, c.height * 0.45, 0, c.width * 0.5, c.height * 0.5, Math.hypot(c.width, c.height) * 0.62);
  grad.addColorStop(0, "#14386A");
  grad.addColorStop(0.55, C.prussian);
  grad.addColorStop(1, C.deep);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // Paper grain: a small noise tile repeated.
  const tile = document.createElement("canvas");
  tile.width = tile.height = 160;
  const tg = tile.getContext("2d")!;
  const img = tg.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random();
    const light = v > 0.5;
    img.data[i] = light ? 232 : 4;
    img.data[i + 1] = light ? 228 : 14;
    img.data[i + 2] = light ? 211 : 30;
    img.data[i + 3] = Math.floor(Math.abs(v - 0.5) * 30);
  }
  tg.putImageData(img, 0, 0);
  g.fillStyle = g.createPattern(tile, "repeat")!;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Hatched, engraved-looking planet sprite (centred, radius r in CSS px). */
export function planetSprite(p: Planet, r: number, dpr: number, seed: number): HTMLCanvasElement {
  const pad = p.style === 2 ? r * 0.9 : 4;
  const size = Math.ceil((r + pad) * 2 * dpr);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const R = r * dpr;
  const o = size / 2;
  const ring = (front: boolean) => {
    g.save();
    g.translate(o, o);
    g.rotate(-0.38);
    g.beginPath();
    g.ellipse(0, 0, R * 1.7, R * 0.42, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    g.strokeStyle = rgba(C.chalk, 0.55);
    g.lineWidth = 1.1 * dpr;
    g.setLineDash([3 * dpr, 3 * dpr]);
    g.stroke();
    g.restore();
  };
  if (p.style === 2) ring(false);
  // Body.
  g.beginPath();
  g.arc(o, o, R, 0, Math.PI * 2);
  g.fillStyle = "#123660";
  g.fill();
  // Hatching on the night side (light comes from the upper left).
  const hatch = document.createElement("canvas");
  hatch.width = hatch.height = size;
  const h = hatch.getContext("2d")!;
  h.beginPath();
  h.arc(o, o, R, 0, Math.PI * 2);
  h.clip();
  h.strokeStyle = rgba(C.chalk, 0.5);
  h.lineWidth = 0.9 * dpr;
  const step = Math.max(3, 4.2 * dpr);
  h.beginPath();
  for (let d = -size; d < size * 2; d += step) {
    h.moveTo(d, 0);
    h.lineTo(d - size, size);
  }
  h.stroke();
  // Cross-hatch deep in the shadow.
  h.strokeStyle = rgba(C.chalk, 0.28);
  h.save();
  h.beginPath();
  h.arc(o + R * 0.55, o + R * 0.55, R * 0.95, 0, Math.PI * 2);
  h.clip();
  h.beginPath();
  for (let d = -size; d < size * 2; d += step * 1.6) {
    h.moveTo(d - size, 0);
    h.lineTo(d, size);
  }
  h.stroke();
  h.restore();
  h.globalCompositeOperation = "destination-out";
  const lit = h.createRadialGradient(o - R * 0.45, o - R * 0.45, R * 0.2, o - R * 0.3, o - R * 0.3, R * 1.15);
  lit.addColorStop(0, "rgba(0,0,0,1)");
  lit.addColorStop(0.75, "rgba(0,0,0,0.9)");
  lit.addColorStop(1, "rgba(0,0,0,0)");
  h.fillStyle = lit;
  h.fillRect(0, 0, size, size);
  g.drawImage(hatch, 0, 0);
  // Surface detail per style.
  g.save();
  g.beginPath();
  g.arc(o, o, R, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = rgba(C.chalk, 0.4);
  g.lineWidth = 1 * dpr;
  if (p.style === 1) {
    for (let i = -3; i <= 3; i++) {
      const y = o + (i / 3.5) * R + (hash01(seed + i) - 0.5) * R * 0.1;
      g.beginPath();
      g.ellipse(o, y, R * 1.1, R * 0.16, 0, 0, Math.PI);
      g.stroke();
    }
  } else if (p.style === 3) {
    for (let i = 0; i < 6; i++) {
      const a = hash01(seed * 7 + i) * Math.PI * 2;
      const d = hash01(seed * 13 + i) * R * 0.7;
      const cr = R * (0.08 + hash01(seed * 3 + i) * 0.12);
      g.beginPath();
      g.arc(o + Math.cos(a) * d, o + Math.sin(a) * d, cr, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (p.style === 0) {
    g.beginPath();
    g.arc(o - R * 0.2, o - R * 0.25, R * 0.62, Math.PI * 0.9, Math.PI * 1.6);
    g.stroke();
  }
  g.restore();
  // Rim.
  g.beginPath();
  g.arc(o, o, R, 0, Math.PI * 2);
  g.strokeStyle = C.chalk;
  g.lineWidth = 1.6 * dpr;
  g.stroke();
  if (p.style === 2) ring(true);
  return c;
}

/** Irregular rock outline, deterministic per seed, unit radius. */
export function rockShape(seed: number): [number, number][] {
  const n = 7 + Math.floor(hash01(seed) * 3);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01(seed * 31 + i) * 0.4;
    const r = 0.78 + hash01(seed * 17 + i) * 0.34;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/**
 * The static layer: graticule bent by every mass on the chart, the chart
 * frame, isolines, planets, belts and the launch cradle. Painted once per
 * level and resize into a transparent canvas at device resolution.
 */
export function paintStatic(l: LevelData, cam: Camera, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * cam.dpr));
  c.height = Math.max(1, Math.round(h * cam.dpr));
  const g = c.getContext("2d")!;
  cam.apply(g);
  const px = 1 / cam.scale; // one CSS pixel in chart units
  const lenses = lensesFor(l).map((L) => ({ ...L, re: L.re * 1.8 }));
  const pt: [number, number] = [0, 0];

  // Warped graticule.
  g.lineWidth = px;
  g.strokeStyle = rgba(C.chalk, 0.075);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const n = 80;
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      lensPoint(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, lenses, pt);
      if (i === 0) g.moveTo(pt[0], pt[1]);
      else g.lineTo(pt[0], pt[1]);
    }
    g.stroke();
  };
  g.save();
  g.beginPath();
  g.rect(0, 0, WORLD_W, WORLD_H);
  g.clip();
  for (let x = 100; x < WORLD_W; x += 100) line(x, -100, x, WORLD_H + 100);
  for (let y = 100; y < WORLD_H; y += 100) line(-100, y, WORLD_W + 100, y);
  g.restore();

  // Chart frame with ticks every 50 units, like a plate border.
  if (l.id !== "demo") paintFrame(g, px);

  // Isolines: rings of equal pull, spaced by mass.
  g.setLineDash([2 * px, 5 * px]);
  g.lineWidth = px;
  for (const p of l.planets) {
    for (const [k, a] of [[1.5, 0.22], [2.2, 0.14], [3.1, 0.08]] as const) {
      g.strokeStyle = rgba(C.chalk, a);
      g.beginPath();
      g.arc(p.x, p.y, p.r * k, 0, Math.PI * 2);
      g.stroke();
    }
  }
  for (const r of l.repulsors) {
    for (const [k, a] of [[2.6, 0.16], [4.2, 0.09]] as const) {
      g.strokeStyle = rgba(C.chalk, a);
      g.beginPath();
      g.arc(r.x, r.y, r.r * k, 0, Math.PI * 2);
      g.stroke();
    }
  }
  for (const m of l.moons) {
    g.strokeStyle = rgba(C.mist, 0.4);
    g.beginPath();
    g.arc(m.cx, m.cy, m.orbit, 0, Math.PI * 2);
    g.stroke();
  }
  g.setLineDash([]);

  // Wormhole pairs are linked by a faint dotted arc.
  for (const w of l.wormholes) {
    const mx = (w.ax + w.bx) / 2;
    const my = (w.ay + w.by) / 2;
    const nx = -(w.by - w.ay) * 0.18;
    const ny = (w.bx - w.ax) * 0.18;
    g.setLineDash([1.5 * px, 7 * px]);
    g.strokeStyle = rgba(C.mist, 0.4);
    g.lineWidth = px * 1.4;
    g.beginPath();
    g.moveTo(w.ax, w.ay);
    g.quadraticCurveTo(mx + nx, my + ny, w.bx, w.by);
    g.stroke();
    g.setLineDash([]);
  }

  // Belts.
  for (const r of l.rocks) {
    const pts = rockShape(r.seed);
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(r.x + x * r.r, r.y + y * r.r) : g.moveTo(r.x + x * r.r, r.y + y * r.r)));
    g.closePath();
    g.fillStyle = rgba(C.coral, 0.18);
    g.fill();
    g.strokeStyle = C.coral;
    g.lineWidth = px * 1.3;
    g.stroke();
  }

  // Planets from cached sprites.
  g.setTransform(1, 0, 0, 1, 0, 0);
  l.planets.forEach((p, i) => {
    const s = planetSprite(p, p.r * cam.scale, cam.dpr, i + 1 + l.index * 10);
    const [sx, sy] = cam.toScreen(p.x, p.y);
    g.drawImage(s, sx * cam.dpr - s.width / 2, sy * cam.dpr - s.height / 2);
  });
  cam.apply(g);

  // Launch cradle (not on the title-screen orrery).
  if (l.id === "demo") return c;
  const st = l.start;
  g.strokeStyle = rgba(C.chalk, 0.55);
  g.lineWidth = px;
  g.beginPath();
  g.arc(st.x, st.y, 16 * px, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    g.moveTo(st.x + Math.cos(a) * 20 * px, st.y + Math.sin(a) * 20 * px);
    g.lineTo(st.x + Math.cos(a) * 26 * px, st.y + Math.sin(a) * 26 * px);
  }
  g.stroke();
  return c;
}

function paintFrame(g: CanvasRenderingContext2D, px: number) {
  g.strokeStyle = rgba(C.chalk, 0.35);
  g.lineWidth = px * 1.2;
  g.strokeRect(0, 0, WORLD_W, WORLD_H);
  g.strokeStyle = rgba(C.chalk, 0.25);
  g.beginPath();
  for (let x = 0; x <= WORLD_W; x += 50) {
    const len = x % 200 === 0 ? 14 : 7;
    g.moveTo(x, 0);
    g.lineTo(x, len * px);
    g.moveTo(x, WORLD_H);
    g.lineTo(x, WORLD_H - len * px);
  }
  for (let y = 0; y <= WORLD_H; y += 50) {
    const len = y % 200 === 0 ? 14 : 7;
    g.moveTo(0, y);
    g.lineTo(len * px, y);
    g.moveTo(WORLD_W, y);
    g.lineTo(WORLD_W - len * px, y);
  }
  g.stroke();
}

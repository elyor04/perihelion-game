// Mouse, touch, keyboard and gamepad input for the flight view. Keys are
// matched by KeyboardEvent.code (physical position), so WASD and R work on
// Russian and other layouts too.

export type InputMode = "touch" | "mouse" | "keyboard" | "gamepad";

export interface Drag {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
}

export interface PadState {
  ax: number;
  ay: number;
  ry: number;
  lt: number;
  rt: number;
  buttons: boolean[];
}

const GAME_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS",
  "Space", "Enter", "NumpadEnter", "KeyR",
]);

function interactive(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest("button, input, select, textarea, a, [role='dialog']");
}

export class Input {
  mode: InputMode;
  onModeChange?: (m: InputMode) => void;
  /** False while menus are open: the flight view ignores everything. */
  enabled = false;

  drag: Drag | null = null;
  onDragMove?: (d: Drag) => void;
  onDragEnd?: (d: Drag) => void;
  onTap?: () => void;

  readonly held = new Set<string>();
  private pressed = new Set<string>();
  shift = false;

  pad: PadState | null = null;
  private padPrev: boolean[] | null = null;
  private padEdges = new Set<number>();

  private canvas: HTMLCanvasElement;
  private off: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.mode = matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(canvas, "pointerdown", (e) => this.down(e as PointerEvent));
    on(window, "pointermove", (e) => this.move(e));
    on(window, "pointerup", (e) => this.up(e, false));
    on(window, "pointercancel", (e) => this.up(e, true));
    on(window, "keydown", (e) => this.key(e, true));
    on(window, "keyup", (e) => this.key(e, false));
    on(window, "blur", () => {
      this.held.clear();
      this.drag = null;
    });
  }

  destroy() {
    for (const f of this.off) f();
    this.off = [];
  }

  setMode(m: InputMode) {
    if (m !== this.mode) {
      this.mode = m;
      this.onModeChange?.(m);
    }
  }

  private down(e: PointerEvent) {
    this.setMode(e.pointerType === "touch" || e.pointerType === "pen" ? "touch" : "mouse");
    if (!this.enabled || this.drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  }

  private move(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (this.enabled) this.onDragMove?.(d);
  }

  private up(e: PointerEvent, cancelled: boolean) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (!this.enabled || cancelled) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (Math.hypot(d.x - d.x0, d.y - d.y0) < 10) this.onTap?.();
    else this.onDragEnd?.(d);
  }

  /** Abandon a drag in progress (e.g. when a menu opens). */
  cancelDrag() {
    this.drag = null;
  }

  private key(e: KeyboardEvent, down: boolean) {
    this.shift = e.shiftKey;
    if (!down) {
      this.held.delete(e.code);
      return;
    }
    if (!GAME_KEYS.has(e.code) || !this.enabled || interactive(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    this.setMode("keyboard");
    if (!e.repeat) this.pressed.add(e.code);
    this.held.add(e.code);
  }

  /** True once per physical press of `code` since the last call. */
  consume(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  clearPresses() {
    this.pressed.clear();
    this.padEdges.clear();
  }

  isHeld(...codes: string[]) {
    return codes.some((c) => this.held.has(c));
  }

  /** Read the first connected gamepad and record newly pressed buttons. */
  pollPad() {
    const pad = navigator.getGamepads?.().find((p) => p && p.connected) ?? null;
    if (!pad) {
      this.pad = null;
      this.padPrev = null;
      return;
    }
    const buttons = pad.buttons.map((b) => b.pressed);
    const val = (i: number) => pad.buttons[i]?.value ?? 0;
    this.pad = { ax: pad.axes[0] ?? 0, ay: pad.axes[1] ?? 0, ry: pad.axes[3] ?? 0, lt: val(6), rt: val(7), buttons };
    // Buttons held when the pad is first seen (or when play resumes) are
    // ignored until released, so a menu's A press never launches the comet.
    if (this.padPrev) {
      buttons.forEach((b, i) => {
        if (b && !this.padPrev![i]) this.padEdges.add(i);
      });
    }
    this.padPrev = buttons;
    const active = buttons.some(Boolean) || Math.hypot(this.pad.ax, this.pad.ay) > 0.35 || Math.abs(this.pad.ry) > 0.35;
    if (active) this.setMode("gamepad");
  }

  padPressed(i: number): boolean {
    if (this.padEdges.has(i)) {
      this.padEdges.delete(i);
      return true;
    }
    return false;
  }

  /** Forget the pad's current buttons, so anything held now must be released first. */
  resetPad() {
    this.padPrev = null;
    this.padEdges.clear();
  }
}

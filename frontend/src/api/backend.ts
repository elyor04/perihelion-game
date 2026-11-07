// Thin adapter over the generated Wails bindings. Inside the app every call
// goes to Go. Opened in a plain browser (vite dev, Playwright) there is no Go
// at all, so a localStorage-backed preview takes over. Which one is used is
// decided once, by whether the Wails bridge exists — never by whether a Go
// call happened to fail, so a real error in the app surfaces as an error.

import * as Go from "../../bindings/perihelion/internal/game/gameservice";
import type * as M from "../../bindings/perihelion/internal/game/models";
import type { LevelData } from "../game/physics";

export type Settings = M.Settings;
export type Stats = M.Stats;
export type LevelRecord = M.LevelRecord;
export type DailyRecord = M.DailyRecord;

export interface Profile extends Omit<M.Profile, "levels" | "daily"> {
  levels: Record<string, LevelRecord>;
  daily: Record<string, DailyRecord>;
}
export interface Sector { id: string; index: number; levels: LevelData[] }
export interface Catalog { sectors: Sector[]; clearsToUnlock: number }
export interface DailyOrbit extends Omit<M.DailyOrbit, "level"> { level: LevelData }
export interface LevelReward extends Omit<M.LevelReward, "profile"> { profile: Profile }
export interface DailyReward extends Omit<M.DailyReward, "profile"> { profile: Profile }
export type LevelResult = M.LevelResult;
export type DailyResult = M.DailyResult;

export type HapticKind = "light" | "medium" | "heavy" | "success" | "warning" | "error" | "selection";

export interface Backend {
  native: boolean;
  getProfile(): Promise<Profile>;
  getCatalog(): Promise<Catalog>;
  getDaily(): Promise<DailyOrbit>;
  saveSettings(s: Settings): Promise<Profile>;
  submitLevel(r: LevelResult): Promise<LevelReward>;
  submitDaily(r: DailyResult): Promise<DailyReward>;
  resetProfile(): Promise<Profile>;
  haptic(kind: HapticKind): void;
  setKeepAwake(on: boolean): void;
}

/** Go serialises nil slices and maps as null; normalise once here. */
export function fixLevel(l: M.Level | LevelData): LevelData {
  return {
    ...l,
    hint: l.hint ?? "",
    planets: l.planets ?? [],
    holes: l.holes ?? [],
    repulsors: l.repulsors ?? [],
    moons: l.moons ?? [],
    rocks: l.rocks ?? [],
    wormholes: l.wormholes ?? [],
  };
}

export function fixProfile(p: M.Profile | Profile): Profile {
  return {
    ...p,
    levels: (p.levels ?? {}) as Record<string, LevelRecord>,
    daily: (p.daily ?? {}) as Record<string, DailyRecord>,
  };
}

function fixCatalog(c: M.Catalog): Catalog {
  return {
    clearsToUnlock: c.clearsToUnlock,
    sectors: (c.sectors ?? []).map((s) => ({ id: s.id, index: s.index, levels: (s.levels ?? []).map(fixLevel) })),
  };
}

/** An error from the game service. `code` matches Go's GameError.Code. */
export class BackendError extends Error {
  code: string;
  constructor(message: string, code = "generic") {
    super(message);
    this.code = code;
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "game service error";
}

/** Wails puts the marshalled Go error in `cause`; keep its code. */
function errorCode(e: unknown): string {
  const cause = (e as { cause?: unknown })?.cause;
  let c: unknown = cause;
  if (typeof cause === "string") {
    try {
      c = JSON.parse(cause);
    } catch {
      c = undefined;
    }
  }
  const code = (c as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : "generic";
}

async function wrap<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw new BackendError(errorMessage(e), errorCode(e));
  }
}

const native: Backend = {
  native: true,
  getProfile: async () => fixProfile(await wrap(Go.GetProfile())),
  getCatalog: async () => fixCatalog(await wrap(Go.GetCatalog())),
  getDaily: async () => {
    const d = await wrap(Go.GetDaily());
    return { ...d, level: fixLevel(d.level) };
  },
  saveSettings: async (s) => fixProfile(await wrap(Go.SaveSettings(s))),
  submitLevel: async (r) => {
    const res = await wrap(Go.SubmitLevel(r));
    return { ...res, profile: fixProfile(res.profile) };
  },
  submitDaily: async (r) => {
    const res = await wrap(Go.SubmitDaily(r));
    return { ...res, profile: fixProfile(res.profile) };
  },
  resetProfile: async () => fixProfile(await wrap(Go.ResetProfile())),
  haptic: (k) => void Go.Haptic(k).catch(() => {}),
  setKeepAwake: (on) => void Go.SetKeepAwake(on).catch(() => {}),
};

/** True when running inside a Wails webview (desktop or mobile). */
export function hasWailsRuntime(): boolean {
  const w = window as unknown as {
    chrome?: { webview?: { postMessage?: unknown } };
    webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
    wails?: { invoke?: unknown };
  };
  return !!(w.chrome?.webview?.postMessage || w.webkit?.messageHandlers?.external?.postMessage || w.wails?.invoke);
}

let chosen: Backend | null = null;

/** Pick the backend once: Go inside Wails, the preview in a plain browser. */
export async function connect(): Promise<Backend> {
  if (chosen) return chosen;
  if (hasWailsRuntime()) {
    chosen = native;
  } else {
    const { previewBackend } = await import("./preview");
    chosen = previewBackend();
  }
  return chosen;
}

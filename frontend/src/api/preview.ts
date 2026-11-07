// Browser-only stand-in for the Go service, used when the page runs without
// Wails (vite dev server, Playwright). It mirrors the Go rules closely enough
// to click through every screen; the real rules and the daily generator live
// in internal/game. Levels come from preview-data.json, which Go generates
// (go run ./internal/tools/export) and a Go test keeps up to date.

import data from "./preview-data.json";
import { starsFor, type LevelData } from "../game/physics";
import {
  Backend, BackendError, Catalog, DailyOrbit, DailyResult, DailyReward, LevelResult, LevelReward, Profile, Settings,
  fixLevel, fixProfile,
} from "./backend";

const KEY = "perihelion.preview.profile";
const MAX_SHOTS = 999;

const catalog: Catalog = {
  clearsToUnlock: data.catalog.clearsToUnlock,
  sectors: data.catalog.sectors.map((s) => ({ id: s.id, index: s.index, levels: s.levels.map((l) => fixLevel(l as LevelData)) })),
};

function defaultSettings(): Settings {
  return { masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.8, haptics: true, screenShake: true, motion: "auto", longGuide: false, language: "" };
}

function newProfile(): Profile {
  return {
    version: 1,
    levels: {},
    unlockedSectors: 1,
    daily: {},
    stats: { launches: 0, clears: 0, dailyClears: 0, streak: 0, bestStreak: 0, lastDaily: "" },
    settings: defaultSettings(),
  };
}

const allLevels = () => catalog.sectors.flatMap((s) => s.levels);

function unlockedSectors(p: Profile): number {
  let open = 1;
  for (let i = 0; i < catalog.sectors.length - 1; i++) {
    const cleared = catalog.sectors[i].levels.filter((l) => (p.levels[l.id]?.bestShots ?? 0) > 0).length;
    if (cleared < catalog.clearsToUnlock) break;
    open++;
  }
  return open;
}

function levelUnlocked(p: Profile, l: LevelData): boolean {
  if (l.sector < 1 || l.sector > p.unlockedSectors) return false;
  if (l.index <= 1) return true;
  const id = (n: number) => `s${l.sector}-${String(n).padStart(2, "0")}`;
  return [1, 2].some((b) => l.index - b >= 1 && (p.levels[id(l.index - b)]?.bestShots ?? 0) > 0);
}

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = fixProfile(JSON.parse(raw));
      p.settings = { ...defaultSettings(), ...p.settings };
      p.unlockedSectors = unlockedSectors(p);
      return p;
    }
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return newProfile();
}

function save(p: Profile): Profile {
  p.unlockedSectors = unlockedSectors(p);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private mode or quota: keep playing with in-memory progress.
  }
  return structuredClone(p);
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

function dailyLevel(key: string): LevelData {
  return { ...fixLevel(data.daily as LevelData), id: `daily-${key}` };
}

function currentStreak(p: Profile, now: Date): number {
  const today = dateKey(now);
  const yesterday = dateKey(new Date(now.getTime() - 86400000));
  return p.stats.lastDaily === today || p.stats.lastDaily === yesterday ? p.stats.streak : 0;
}

export function previewBackend(): Backend {
  let profile = load();
  const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 30));
  return {
    native: false,
    getProfile: () => delay(profile),
    getCatalog: () => delay(catalog),
    getDaily: () => {
      const now = new Date();
      const key = dateKey(now);
      const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const rec = profile.daily[key];
      const d: DailyOrbit = {
        key,
        level: dailyLevel(key),
        bestShots: rec?.bestShots ?? 0,
        stars: rec?.stars ?? 0,
        streak: currentStreak(profile, now),
        secondsLeft: Math.ceil((midnight - now.getTime()) / 1000),
      };
      return delay(d);
    },
    saveSettings: (s: Settings) => {
      profile.settings = { ...s };
      profile = save(profile);
      return delay(profile);
    },
    submitLevel: (r: LevelResult) => {
      const l = allLevels().find((x) => x.id === r.levelId);
      if (!l) return Promise.reject(new BackendError("unknown level", "unknown_level"));
      if (r.shots < 1 || r.shots > MAX_SHOTS || r.stars !== starsFor(r.shots, l.par)) {
        return Promise.reject(new BackendError("bad result", "bad_result"));
      }
      if (!levelUnlocked(profile, l)) return Promise.reject(new BackendError("locked", "level_locked"));
      const before = profile.unlockedSectors;
      const rec = { ...(profile.levels[l.id] ?? { stars: 0, bestShots: 0, clears: 0 }) };
      const firstClear = rec.bestShots === 0;
      let newBest = false;
      if (firstClear || r.shots < rec.bestShots) {
        newBest = !firstClear;
        rec.bestShots = r.shots;
      }
      rec.stars = starsFor(rec.bestShots, l.par);
      rec.clears++;
      profile.levels[l.id] = rec;
      profile.stats.launches += r.shots;
      profile.stats.clears++;
      const after = unlockedSectors(profile);
      profile = save(profile);
      const reward: LevelReward = {
        stars: r.stars, bestShots: rec.bestShots, newBest, firstClear,
        sectorUnlocked: after > before ? after : 0, profile,
      };
      return delay(reward);
    },
    submitDaily: (r: DailyResult) => {
      const now = new Date();
      const today = dateKey(now);
      const yesterday = dateKey(new Date(now.getTime() - 86400000));
      if (r.key !== today && r.key !== yesterday) return Promise.reject(new BackendError("expired", "daily_expired"));
      const par = dailyLevel(r.key).par;
      if (r.shots < 1 || r.shots > MAX_SHOTS || r.stars !== starsFor(r.shots, par)) {
        return Promise.reject(new BackendError("bad result", "bad_result"));
      }
      const rec = { ...(profile.daily[r.key] ?? { stars: 0, bestShots: 0 }) };
      const firstClear = rec.bestShots === 0;
      let newBest = false;
      if (firstClear || r.shots < rec.bestShots) {
        newBest = !firstClear;
        rec.bestShots = r.shots;
        rec.stars = r.stars;
      }
      profile.daily[r.key] = rec;
      profile.stats.launches += r.shots;
      if (firstClear) {
        profile.stats.dailyClears++;
        const s = profile.stats;
        if (!s.lastDaily || r.key > s.lastDaily) {
          const next = s.lastDaily ? dateKey(new Date(Date.parse(s.lastDaily) + 86400000)) : "";
          s.streak = r.key === next ? s.streak + 1 : 1;
          s.lastDaily = r.key;
          s.bestStreak = Math.max(s.bestStreak, s.streak);
        }
      }
      profile = save(profile);
      const reward: DailyReward = { stars: r.stars, bestShots: rec.bestShots, newBest, firstClear, streak: currentStreak(profile, now), profile };
      return delay(reward);
    },
    resetProfile: () => {
      const settings = profile.settings;
      profile = newProfile();
      profile.settings = settings;
      profile = save(profile);
      return delay(profile);
    },
    haptic: () => {},
    setKeepAwake: () => {},
  };
}

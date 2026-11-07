// Progress helpers mirroring the unlock rules in internal/game/profile.go.
// Go is the authority (it rejects locked submissions); these only decide
// what the menus show.

import type { Catalog, Profile } from "../api/backend";
import type { LevelData } from "../game/physics";

export const cleared = (p: Profile, id: string) => (p.levels[id]?.bestShots ?? 0) > 0;

export function levelUnlocked(p: Profile, l: LevelData): boolean {
  if (l.sector < 1 || l.sector > p.unlockedSectors) return false;
  if (l.index <= 1) return true;
  const id = (n: number) => `s${l.sector}-${String(n).padStart(2, "0")}`;
  return [1, 2].some((b) => l.index - b >= 1 && cleared(p, id(l.index - b)));
}

/** How many more clears the sector before `index` (1-based) needs to open it. */
export function clearsNeeded(c: Catalog, p: Profile, index: number): number {
  const prev = c.sectors[index - 2];
  if (!prev) return 0;
  const done = prev.levels.filter((l) => cleared(p, l.id)).length;
  return Math.max(0, c.clearsToUnlock - done);
}

export function sectorStars(p: Profile, levels: LevelData[]) {
  return levels.reduce((n, l) => n + (p.levels[l.id]?.stars ?? 0), 0);
}

export function totalStars(c: Catalog, p: Profile) {
  return c.sectors.reduce((n, s) => n + sectorStars(p, s.levels), 0);
}

/** The first open level not yet cleared, in catalog order. */
export function continueLevel(c: Catalog, p: Profile): LevelData | null {
  for (const s of c.sectors) {
    for (const l of s.levels) {
      if (levelUnlocked(p, l) && !cleared(p, l.id)) return l;
    }
  }
  return null;
}

/** The level after `l` if it is open: the next in its sector, else the next sector's first. */
export function nextLevel(c: Catalog, p: Profile, l: LevelData): LevelData | null {
  const all = c.sectors.flatMap((s) => s.levels);
  const i = all.findIndex((x) => x.id === l.id);
  for (let j = i + 1; j < all.length; j++) {
    if (levelUnlocked(p, all[j])) return all[j];
    if (all[j].sector !== l.sector) break;
  }
  return null;
}

/** The profile as it will be once this clear is saved (Go stays the authority). */
export function withClear(c: Catalog, p: Profile, id: string, shots: number, stars: number): Profile {
  const prev = p.levels[id];
  const best = prev && prev.bestShots > 0 && prev.bestShots <= shots ? prev : { stars, bestShots: shots, clears: (prev?.clears ?? 0) + 1 };
  const next: Profile = { ...p, levels: { ...p.levels, [id]: best } };
  let open = 1;
  for (let i = 0; i < c.sectors.length - 1; i++) {
    if (c.sectors[i].levels.filter((l) => cleared(next, l.id)).length < c.clearsToUnlock) break;
    open++;
  }
  next.unlockedSectors = open;
  return next;
}

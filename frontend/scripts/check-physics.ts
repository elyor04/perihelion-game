// Proves the TypeScript integrator matches Go bit for bit. The golden file
// is written by `go run ./internal/tools/export` from the Go integrator.
// Run: npm run check:physics  (Node 22.18+ runs TypeScript directly)
import { readFileSync } from "node:fs";
import { Sim, type LevelData } from "../src/game/physics.ts";

interface Case { level: string; vx: number; vy: number; outcome: string; steps: number; samples: number[][] }
const golden = JSON.parse(readFileSync(new URL("./physics-golden.json", import.meta.url), "utf8")) as { daily: LevelData; cases: Case[] };
const preview = JSON.parse(readFileSync(new URL("../src/api/preview-data.json", import.meta.url), "utf8")) as { catalog: { sectors: { levels: LevelData[] }[] } };

const levels = new Map<string, LevelData>();
levels.set(golden.daily.id, golden.daily);
for (const s of preview.catalog.sectors) for (const l of s.levels) levels.set(l.id, l);

let failures = 0;
for (const c of golden.cases) {
  const l = levels.get(c.level);
  if (!l) throw new Error(`unknown level ${c.level}`);
  const s = new Sim(l, c.vx, c.vy);
  const samples: number[][] = [];
  while (s.advance() === "flying") {
    if (s.step % 30 === 0) samples.push([s.x, s.y, s.vx, s.vy]);
  }
  samples.push([s.x, s.y, s.vx, s.vy]);
  let ok = s.outcome === c.outcome && s.step === c.steps && samples.length === c.samples.length;
  for (let i = 0; ok && i < samples.length; i++) {
    for (let k = 0; k < 4; k++) if (samples[i][k] !== c.samples[i][k]) ok = false;
  }
  if (!ok) {
    failures++;
    console.error(`MISMATCH ${c.level} v=(${c.vx}, ${c.vy}): ts ${s.outcome}@${s.step}, go ${c.outcome}@${c.steps}`);
  }
}
const hits = golden.cases.filter((c) => c.outcome === "gate").length;
console.log(`${golden.cases.length - failures}/${golden.cases.length} flights identical (${hits} reach the gate)`);
process.exit(failures ? 1 : 0);

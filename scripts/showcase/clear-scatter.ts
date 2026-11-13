/**
 * Keep scatter vegetation off buildings: computes the XZ footprint of every
 * structure entity (houses, castles, towers, walls, gates, churches...) by
 * generating its mesh, pads and merges the boxes, and writes them as
 * `exclude` rects on every scatter layer whose area overlaps them.
 *
 *   npx tsx scripts/showcase/clear-scatter.ts <world.json> [--pad 3.5] [--match <regex>] [--layers <regex>] [--dry]
 *
 * `--match` picks structure generators by id (default: a building regex plus
 * the architecture catalog); `--layers` picks the scatter layers to clear by
 * the id of what they scatter (default: trees and shrubs, so balcony flowers
 * and cafe chairs stay). Rects are written in each layer's local frame
 * (world XZ minus the layer position); layers that are rotated, scaled or
 * parented are skipped with a warning. Re-running replaces earlier rects.
 *
 * World generators run in-process, unsandboxed: use it on trusted worlds only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { eulerDegToQuat, rotateVec3, type ScatterExcludeRect, type Vec3 } from '@aether/core';
import { ARCH_GENERATOR_IDS, createGeneratorApi, DEFAULT_SEED, generateBuiltinSync, getBuiltinGenerator, resolveParams, type GeneratorOutput } from '@aether/procgen';
import { scatterInstances } from '@aether/physics';

const DEFAULT_MATCH = /house|row|church|chapel|castle|tower|keep|wall|gate|temple|pagoda|cabin|hut|barn|shop|building|lighthouse|mill/;
const DEFAULT_LAYERS = /tree|pine|cypress|oak|palm|birch|spruce|shrub|bush|scrub|hedge|bougainvillea/;
const MAX_RECTS = 64;
/** Occupancy grid cell (m). */
const CELL = 0.5;

interface Box { x0: number; z0: number; x1: number; z1: number }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const overlaps = (a: Box, b: Box): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;

const areaOf = (b: Box): number => (b.x1 - b.x0) * (b.z1 - b.z0);
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) });

/**
 * Pairwise merge (least added area first) until at most `cap` boxes remain.
 */
function capRects(boxes: Box[], cap: number): Box[] {
  const out = boxes.map((b) => ({ ...b }));
  while (out.length > cap) {
    let best = 0;
    let bestJ = 1;
    let bestCost = Infinity;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const u = union(out[i] as Box, out[j] as Box);
        const cost = areaOf(u) - areaOf(out[i] as Box) - areaOf(out[j] as Box);
        if (cost < bestCost) {
          bestCost = cost;
          best = i;
          bestJ = j;
        }
      }
    }
    out[best] = union(out[best] as Box, out[bestJ] as Box);
    out.splice(bestJ, 1);
  }
  return out;
}

/**
 * Footprint union on a grid: rasterize the padded boxes, fill enclosed holes
 * (a castle courtyard counts as castle), then cover the cells with a few
 * maximal rectangles. Returns the rects and an exact inside test.
 */
function footprintRects(boxes: Box[]): { rects: Box[]; inside: (x: number, z: number) => boolean } {
  const all = boxes.reduce(union);
  const ox = all.x0 - CELL;
  const oz = all.z0 - CELL;
  const nx = Math.ceil((all.x1 - ox) / CELL) + 2;
  const nz = Math.ceil((all.z1 - oz) / CELL) + 2;
  const grid = new Uint8Array(nx * nz);
  for (const b of boxes) {
    for (let j = Math.floor((b.z0 - oz) / CELL); j < Math.ceil((b.z1 - oz) / CELL); j++) {
      for (let i = Math.floor((b.x0 - ox) / CELL); i < Math.ceil((b.x1 - ox) / CELL); i++) grid[j * nx + i] = 1;
    }
  }
  // Flood the outside from the border; whatever empty cell it misses is enclosed.
  const outside = new Uint8Array(nx * nz);
  const stack: number[] = [0];
  outside[0] = 1;
  while (stack.length) {
    const k = stack.pop() as number;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di;
      const c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
      const n = c * nx + a;
      if (grid[n] || outside[n]) continue;
      outside[n] = 1;
      stack.push(n);
    }
  }
  for (let k = 0; k < grid.length; k++) if (!outside[k]) grid[k] = 1;
  const used = new Uint8Array(nx * nz);
  const rects: Box[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!grid[k] || used[k]) continue;
      let i1 = i;
      while (i1 < nx && grid[j * nx + i1] && !used[j * nx + i1]) i1++;
      let j1 = j + 1;
      for (; j1 < nz; j1++) {
        let full = true;
        for (let a = i; a < i1 && full; a++) full = grid[j1 * nx + a] === 1 && used[j1 * nx + a] === 0;
        if (!full) break;
      }
      for (let c = j; c < j1; c++) for (let a = i; a < i1; a++) used[c * nx + a] = 1;
      rects.push({ x0: ox + i * CELL, z0: oz + j * CELL, x1: ox + i1 * CELL, z1: oz + j1 * CELL });
    }
  }
  const inside = (x: number, z: number): boolean => {
    const i = Math.floor((x - ox) / CELL);
    const j = Math.floor((z - oz) / CELL);
    return i >= 0 && j >= 0 && i < nx && j < nz && grid[j * nx + i] === 1;
  };
  return { rects, inside };
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) throw new Error('usage: clear-scatter.ts <world.json> [--pad 3.5] [--match regex] [--layers regex] [--dry] [--verbose]');
  const pad = Number(arg('--pad') ?? 3.5);
  const match = arg('--match') ? new RegExp(arg('--match') as string) : DEFAULT_MATCH;
  const layers = arg('--layers') ? new RegExp(arg('--layers') as string) : DEFAULT_LAYERS;
  const dry = process.argv.includes('--dry');
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const world = doc.world ?? doc;
  const entities = world.entities as Record<string, any>;
  const footprints: Box[] = [];
  for (const [id, e] of Object.entries(entities)) {
      const s = e.shape;
      if (s?.kind !== 'procedural' || !(match.test(s.generator) || ARCH_GENERATOR_IDS.has(s.generator))) continue;
      if (e.parent) {
        console.warn(`skip ${id}: parented`);
        continue;
      }
      const seed = s.seed ?? DEFAULT_SEED;
      let out: GeneratorOutput;
      if (getBuiltinGenerator(s.generator)) out = generateBuiltinSync(s.generator, s.params ?? {}, seed);
      else {
        const def = world.generators?.[s.generator];
        if (!def) {
          console.warn(`skip ${id}: unknown generator ${s.generator}`);
          continue;
        }
        try {
          const api = createGeneratorApi(seed);
          // eslint-disable-next-line @typescript-eslint/no-implied-eval -- trusted showcase source, see the header
          out = new Function('params', 'api', `"use strict";\n${def.source}`)(resolveParams(def.params, s.params ?? {}), api) as GeneratorOutput;
        } catch (err) {
          console.warn(`skip ${id} (${s.generator}): ${err instanceof Error ? err.message : err}`);
          continue;
        }
      }
      const t = e.transform ?? {};
      const pos: Vec3 = t.position ?? [0, 0, 0];
      const scl: Vec3 = t.scale ?? [1, 1, 1];
      const q = eulerDegToQuat(t.rotation ?? [0, 0, 0]);
      const b: Box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      for (const part of out.parts) {
        const p = part.positions;
        for (let i = 0; i < p.length; i += 3) {
          const v = rotateVec3(q, [(p[i] as number) * scl[0], (p[i + 1] as number) * scl[1], (p[i + 2] as number) * scl[2]]);
          const x = v[0] + pos[0];
          const z = v[2] + pos[2];
          if (x < b.x0) b.x0 = x;
          if (x > b.x1) b.x1 = x;
          if (z < b.z0) b.z0 = z;
          if (z > b.z1) b.z1 = z;
        }
      }
      if (!Number.isFinite(b.x0)) continue;
      footprints.push({ x0: b.x0 - pad, z0: b.z0 - pad, x1: b.x1 + pad, z1: b.z1 + pad });
      if (process.argv.includes('--verbose')) console.log(`  ${id.padEnd(22)} ${s.generator.padEnd(18)} x ${b.x0.toFixed(1)}..${b.x1.toFixed(1)}  z ${b.z0.toFixed(1)}..${b.z1.toFixed(1)}`);
  }
  if (footprints.length === 0) return console.log('no structures found');
  const { rects: merged, inside } = footprintRects(footprints);
  console.log(`${footprints.length} structures -> ${merged.length} footprint rects`);
  if (process.argv.includes('--verbose')) for (const m of merged) console.log(`  rect x ${m.x0.toFixed(1)}..${m.x1.toFixed(1)}  z ${m.z0.toFixed(1)}..${m.z1.toFixed(1)}`);
  const round = (v: number): number => Math.round(v * 100) / 100;
  for (const [id, e] of Object.entries(entities)) {
    const s = e.shape;
    if (s?.kind !== 'scatter' || !layers.test(s.of?.generator ?? s.of?.primitive ?? '')) continue;
    const t = e.transform ?? {};
    const [px, , pz] = (t.position ?? [0, 0, 0]) as Vec3;
    const rot = (t.rotation ?? [0, 0, 0]) as Vec3;
    const scl = (t.scale ?? [1, 1, 1]) as Vec3;
    const plain = !e.parent && rot.every((r) => r === 0) && scl.every((v) => v === 1);
    let area: Box;
    if (s.points) {
      const xs = (s.points as Vec3[]).map((p) => p[0]);
      const zs = (s.points as Vec3[]).map((p) => p[2]);
      area = { x0: px + Math.min(...xs), x1: px + Math.max(...xs), z0: pz + Math.min(...zs), z1: pz + Math.max(...zs) };
    } else area = { x0: px - s.area[0] / 2, x1: px + s.area[0] / 2, z0: pz - s.area[1] / 2, z1: pz + s.area[1] / 2 };
    const hits = capRects(merged.filter((m) => overlaps(m, area)), MAX_RECTS);
    const onStructure = (inst: { position: Vec3 }): boolean => inside(inst.position[0] + px, inst.position[2] + pz);
    const before = scatterInstances({ ...s, exclude: undefined }).filter(onStructure).length;
    if (hits.length === 0) {
      if (s.exclude) delete s.exclude;
      continue;
    }
    if (!plain) {
      console.warn(`skip ${id}: rotated, scaled or parented scatter layer (${before} instances on structures)`);
      continue;
    }
    const rects: ScatterExcludeRect[] = hits.map((m) => ({ x0: round(m.x0 - px), z0: round(m.z0 - pz), x1: round(m.x1 - px), z1: round(m.z1 - pz) }));
    s.exclude = rects;
    const total = scatterInstances({ ...s, exclude: undefined }).length;
    const after = scatterInstances(s);
    const left = after.filter(onStructure).length;
    if (before > 0 || left > 0) console.log(`${id.padEnd(24)} ${String(rects.length).padStart(2)} rects  on structures ${String(before).padStart(4)} -> ${left}  (kept ${after.length}/${total})`);
  }
  if (!dry) writeFileSync(path, JSON.stringify(doc));
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

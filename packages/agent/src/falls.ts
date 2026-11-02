/**
 * Buried falls: a waterfall placed at or behind the face of the cliff it pours from has the top of its drop inside the rock,
 * so the lip and the first metres of falling water never show. Measured like the sunk check: the lip line of every falling-water
 * piece (the `waterfall-sheet` generator, a piece tagged "waterfall", a generator named for falls, or a part with
 * `material.waterKind` "fall") is sampled from its lip down through the top of its drop, and each sample is tested against the
 * solid masses of the world: the terrain heightfield, cliff and crag generators (their generated bounds) and box primitives.
 *
 * It runs in every review round with the sunk check, so the model sees it without asking.
 */
import type { Entity, Json, WorldDoc } from '@aether/core';
import { findingKey, scoreFindings, type Finding } from '@aether/arch';
import { getBuiltinGenerator } from '@aether/procgen';
import type { ReviewSnapshot } from './review';
import { worldGround } from './land';
import { localBounds, paramBounds } from './sunk';

type Box = { min: [number, number, number]; max: [number, number, number] };

/** Most falling-water pieces measured per call. */
export const FALLS_LIMITS = Object.freeze({ MAX_FALLS: 24, MAX_SOLIDS: 600 });

/** Generators that are falling water. */
const FALL_GEN = /(^|-)(waterfalls?|cascades?|falls)($|-)/;
/** Generators that are a solid mass of rock (filled through their bounds). */
const ROCK_GEN = /(^|-)(cliffs?|crags?|bluffs?|escarpments?|scarps?|rockface|rock-wall|mesas?|buttes?)($|-)/;
const SKIP_TAG = /^(sky|backdrop|water|cloud)$|float|hover|fly/;

/** One falling-water piece whose top is inside solid geometry. */
export interface BuriedFall {
  id: string;
  /** Metres of the drop below the lip that are inside rock or ground. */
  hidden: number;
  /** The drop from the lip to the foot. */
  height: number;
  /** What it is buried in: entity ids, or "terrain". */
  inside: string[];
  /** Metres to move it, along `dir` (world x, z), so its top stands clear; null when no move within 40 m clears it. */
  move: number | null;
  dir: [number, number];
}

interface Solid {
  id: string;
  b: Box;
  ox: number;
  oy: number;
  oz: number;
  sx: number;
  sy: number;
  sz: number;
  c: number;
  s: number;
}

const num = (v: Json | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function solidsOf(world: WorldDoc, skip: string): Solid[] {
  const out: Solid[] = [];
  for (const e of Object.values(world.entities)) {
    if (out.length >= FALLS_LIMITS.MAX_SOLIDS) break;
    if (e.id === skip || e.template || !e.visible || e.parent || e.tags.some((t) => SKIP_TAG.test(t)) || isFall(e)) continue;
    const sh = e.shape;
    let b: Box | null = null;
    if (sh.kind === 'primitive' && sh.primitive === 'box' && Array.isArray(sh.size)) {
      const [w, h, d] = sh.size as number[];
      b = { min: [-(w ?? 1) / 2, -(h ?? 1) / 2, -(d ?? 1) / 2], max: [(w ?? 1) / 2, (h ?? 1) / 2, (d ?? 1) / 2] };
    } else if (sh.kind === 'procedural' && ROCK_GEN.test(sh.generator)) {
      const params = sh.params as Record<string, Json>;
      b = getBuiltinGenerator(sh.generator) ? localBounds(sh.generator, params, sh.seed ?? 0) : paramBounds(params);
    }
    if (!b) continue;
    const yaw = (e.transform.rotation[1] * Math.PI) / 180;
    const [sx, sy, sz] = e.transform.scale;
    const [ox, oy, oz] = e.transform.position;
    if (!(sx > 0 && sy > 0 && sz > 0)) continue;
    out.push({ id: e.id, b, ox, oy, oz, sx, sy, sz, c: Math.cos(yaw), s: Math.sin(yaw) });
  }
  return out;
}

/** The solid `(x, y, z)` is inside, or null. */
function inside(solids: readonly Solid[], ground: (x: number, z: number) => number, x: number, y: number, z: number): string | null {
  if (y < ground(x, z) - 0.2) return 'terrain';
  for (const q of solids) {
    const dx = x - q.ox;
    const dz = z - q.oz;
    // Inverse of the yaw used to place pieces (x' = x c + z s, z' = -x s + z c).
    const lx = (dx * q.c - dz * q.s) / q.sx;
    const lz = (dx * q.s + dz * q.c) / q.sz;
    const ly = (y - q.oy) / q.sy;
    if (lx > q.b.min[0] && lx < q.b.max[0] && ly > q.b.min[1] && ly < q.b.max[1] && lz > q.b.min[2] && lz < q.b.max[2]) return q.id;
  }
  return null;
}

function isFall(e: Entity): boolean {
  if (e.tags.includes('waterfall') || e.material?.waterKind === 'fall') return true;
  const sh = e.shape;
  return sh.kind === 'procedural' && FALL_GEN.test(sh.generator);
}

/** The lip of a falling-water piece in its own frame: x across, the top y, the z of the lip and the drop, or null. */
function lipOf(e: Entity): { x0: number; x1: number; top: number; z: number; drop: number; pours: boolean } | null {
  const sh = e.shape;
  if (sh.kind === 'procedural' && sh.generator === 'waterfall-sheet') {
    const params = sh.params as Record<string, Json>;
    const b = localBounds(sh.generator, params, sh.seed ?? 0);
    const w = num(params['width']) ?? 6;
    const h = b ? b.max[1] : (num(params['height']) ?? 18);
    // The sheet leaves its lip at z = 0 and pours toward +z.
    return { x0: -w / 2, x1: w / 2, top: h, z: 0.15, drop: h, pours: true };
  }
  let b: Box | null = null;
  if (sh.kind === 'primitive' && Array.isArray(sh.size)) {
    const [w, h, d] = sh.size as number[];
    b = { min: [-(w ?? 1) / 2, -(h ?? 1) / 2, -(d ?? 1) / 2], max: [(w ?? 1) / 2, (h ?? 1) / 2, (d ?? 1) / 2] };
  } else if (sh.kind === 'procedural') {
    const params = sh.params as Record<string, Json>;
    b = getBuiltinGenerator(sh.generator) ? localBounds(sh.generator, params, sh.seed ?? 0) : paramBounds(params);
  }
  if (!b) return null;
  return { x0: b.min[0], x1: b.max[0], top: b.max[1], z: (b.min[2] + b.max[2]) / 2, drop: b.max[1] - b.min[1], pours: false };
}

/**
 * Every falling-water piece of `world` whose top is buried: at least 2 m (or a tenth of the drop) of the upper 60 % of the drop
 * is inside rock, ground or a solid box on at least half its width.
 */
export function findBuriedFalls(world: WorldDoc): BuriedFall[] {
  const falls = Object.values(world.entities).filter((e) => !e.template && e.visible && !e.parent && isFall(e)).slice(0, FALLS_LIMITS.MAX_FALLS);
  if (falls.length === 0) return [];
  const ground = worldGround(world);
  const out: BuriedFall[] = [];
  for (const e of falls) {
    const lip = lipOf(e);
    if (!lip) continue;
    const [sx, sy, sz] = e.transform.scale;
    const [ox, oy, oz] = e.transform.position;
    const yaw = (e.transform.rotation[1] * Math.PI) / 180;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const drop = lip.drop * sy;
    if (!(drop > 1)) continue;
    const solids = solidsOf(world, e.id);
    const step = Math.max(0.5, Math.min(2, drop / 30));
    const rows: number[] = [0.3];
    for (let d = step; d <= drop * 0.6; d += step) rows.push(d);
    /** Metres of the upper drop buried when the piece is shifted by `shift` m along local z, and what buries it. */
    const measure = (shift: number): { hidden: number; ids: Set<string> } => {
      const ids = new Set<string>();
      let hidden = 0;
      for (const d of rows) {
        let n = 0;
        let buried = 0;
        for (let i = 0; i <= 6; i++) {
          const lx = (lip.x0 + ((lip.x1 - lip.x0) * i) / 6) * sx;
          const lz = (lip.z + shift) * sz;
          const hit = inside(solids, ground, ox + lx * c + lz * s, oy + lip.top * sy - d, oz - lx * s + lz * c);
          n++;
          if (hit) {
            buried++;
            ids.add(hit);
          }
        }
        if (buried * 2 >= n) hidden += step;
      }
      return { hidden, ids };
    };
    const at = measure(0);
    if (at.hidden < Math.max(2, drop * 0.1)) continue;
    // How far to move it out: along the way it pours (a sheet), else whichever way along its depth clears first.
    const dirs = lip.pours ? [1] : [1, -1];
    let move: number | null = null;
    let sign = 1;
    for (let m = 0.5; m <= 40 && move === null; m += 0.5) {
      for (const d of dirs) {
        if (measure((d * m) / Math.max(1e-6, sz)).hidden < 1) {
          move = m + 1;
          sign = d;
          break;
        }
      }
    }
    out.push({ id: e.id, hidden: at.hidden, height: drop, inside: [...at.ids].slice(0, 4), move, dir: [s * sign, c * sign] });
  }
  return out.sort((p, q) => q.hidden - p.hidden);
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The buried falls as review findings (warnings), with the fix for each. */
export function fallsFindings(world: WorldDoc): Finding[] {
  return findBuriedFalls(world).map((p) => {
    const where = p.inside.map((i) => (i === 'terrain' ? 'the terrain' : i)).join(', ');
    const fix =
      p.move !== null
        ? `move it about ${r1(p.move)} m out from the face (world x ${r1(p.dir[0] * p.move)}, z ${r1(p.dir[1] * p.move)}) so it stands clear in front of the rock it pours from, with its lip at the cliff top`
        : 'move it out in front of the face it pours from, so the lip stands clear at the cliff top and the whole drop shows';
    return { code: 'fall_buried', severity: 'warning', message: `${p.id} (falling water, ${r1(p.height)} m drop) is buried at the top: ${r1(p.hidden)} m of its upper drop is inside ${where}, so the lip and the first metres of water never show.`, entities: [p.id], fix } as Finding;
  });
}

/** `snap` with the buried falls of `world` added to its findings (score and keys follow), so every review round checks it. */
export function withFalls(snap: ReviewSnapshot, world: WorldDoc): ReviewSnapshot {
  let extra: Finding[];
  try {
    extra = fallsFindings(world);
  } catch {
    return snap;
  }
  if (extra.length === 0) return snap;
  const findings = [...snap.findings.filter((f) => f.code !== 'fall_buried'), ...extra];
  return { ...snap, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)) };
}

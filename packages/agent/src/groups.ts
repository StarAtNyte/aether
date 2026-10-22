/**
 * `inspect {groups:true}`: read every group of repeated things (trees, rocks, hedges, fence posts, grass) at once
 * instead of one entity at a time. Per scatter layer: how many, where (bounds), how tightly they sit (closest and typical
 * neighbour distance), how many pairs touch, and how many stand off the ground or sink into it. Separate entities that
 * share one generator (hand-placed trees) are read as a group too. Pure measurement for the model; nothing is changed.
 */
import { type Entity, type WorldDoc } from '@aether/core';
import { worldGround } from './land';

const MAX_POINTS = 6000;
const MAX_LINES = 40;

interface P {
  x: number;
  y: number;
  z: number;
}

/** Closest-neighbour distances of `pts` (grid-hashed, so thousands of points stay cheap). */
function nearest(pts: readonly P[], reach: number): { min: number; mean: number; touching: number } {
  const cell = Math.max(reach, 0.5);
  const grid = new Map<string, number[]>();
  const key = (x: number, z: number): string => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  pts.forEach((p, i) => {
    const k = key(p.x, p.z);
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  });
  let min = Infinity;
  let sum = 0;
  let found = 0;
  let touching = 0;
  pts.forEach((p, i) => {
    let best = Infinity;
    const cx = Math.floor(p.x / cell);
    const cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (j === i) continue;
          const q = pts[j] as P;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < best) best = d;
          if (j > i && d < reach) touching++;
        }
      }
    }
    if (Number.isFinite(best)) {
      min = Math.min(min, best);
      sum += best;
      found++;
    }
  });
  return { min: Number.isFinite(min) ? min : 0, mean: found > 0 ? sum / found : 0, touching };
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

function bounds(pts: readonly P[]): string {
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  return `x ${f(Math.min(...xs))}..${f(Math.max(...xs))}, z ${f(Math.min(...zs))}..${f(Math.max(...zs))}`;
}

function genOf(e: Entity): string {
  const s = e.shape.kind === 'scatter' ? e.shape.of : e.shape;
  return s.kind === 'procedural' ? s.generator : s.kind === 'asset' ? `asset:${s.id}` : s.kind === 'primitive' ? s.primitive : s.kind;
}

/** Text read of every scatter layer and every run of three or more separate entities sharing one generator. */
export function readGroups(world: WorldDoc, only?: readonly string[]): string {
  const ground = worldGround(world);
  const lines: string[] = [];
  const wanted = (id: string): boolean => !only || only.length === 0 || only.includes(id);
  for (const e of Object.values(world.entities)) {
    if (e.shape.kind !== 'scatter' || !wanted(e.id)) continue;
    const s = e.shape;
    const [ox, oy, oz] = e.transform.position;
    const label = `${e.id} (${genOf(e)})`;
    const pts: P[] | null = s.points && s.points.length > 0 ? s.points.slice(0, MAX_POINTS).map(([x, y, z]) => ({ x: ox + x, y: oy + y, z: oz + z })) : null;
    if (!pts) {
      lines.push(`- ${label}: ${s.count} scattered at random in ${f(s.area[0])}x${f(s.area[1])} m around (${f(ox)}, ${f(oz)})${s.minSpacing ? `, min spacing ${s.minSpacing} m` : ''}${s.onSurface ? `, on ${s.onSurface}` : ''}; no explicit points, so not measured per instance`);
      continue;
    }
    const reach = Math.max(0.3, (s.minSpacing ?? 0) * 0.6);
    const n = nearest(pts, reach);
    const off = pts.filter((p) => Math.abs(p.y - ground(p.x, p.z)) > 0.35).length;
    lines.push(`- ${label}: ${s.points?.length ?? 0} placed, ${bounds(pts)}; neighbour distance min ${f(n.min)} m, typical ${f(n.mean)} m; ${n.touching} pair${n.touching === 1 ? '' : 's'} closer than ${f(reach)} m (overlapping)${off > 0 ? `; ${off} stand more than 0.35 m off the ground height (floating or buried)` : ''}`);
  }
  const runs = new Map<string, Entity[]>();
  for (const e of Object.values(world.entities)) {
    if (e.shape.kind === 'scatter' || e.shape.kind === 'none' || e.light || e.parent) continue;
    if (e.shape.kind !== 'procedural' && e.shape.kind !== 'asset') continue;
    const g = genOf(e);
    runs.set(g, [...(runs.get(g) ?? []), e]);
  }
  for (const [g, list] of runs) {
    if (list.length < 3) continue;
    if (only && only.length > 0 && !list.some((e) => only.includes(e.id)) && !only.includes(g)) continue;
    const pts = list.map((e) => ({ x: e.transform.position[0], y: e.transform.position[1], z: e.transform.position[2] }));
    const n = nearest(pts, 0.6);
    const off = pts.filter((p) => Math.abs(p.y - ground(p.x, p.z)) > 0.35).length;
    lines.push(`- ${g} x${list.length} as separate entities (${list.slice(0, 4).map((e) => e.id).join(', ')}${list.length > 4 ? ', …' : ''}): ${bounds(pts)}; neighbour distance min ${f(n.min)} m, typical ${f(n.mean)} m; ${n.touching} pair${n.touching === 1 ? '' : 's'} closer than 0.6 m${off > 0 ? `; ${off} more than 0.35 m off the ground height` : ''}. For more than 8 alike, one scatter or shape_land {op:"row"} is cheaper.`);
  }
  if (lines.length === 0) return 'No groups: no scatter layers and no run of three or more alike entities.';
  const shown = lines.slice(0, MAX_LINES);
  return `Groups (${lines.length}):\n${shown.join('\n')}${lines.length > shown.length ? `\n… ${lines.length - shown.length} more` : ''}`;
}


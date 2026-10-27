/**
 * `shape_land` `street`: a village street in one call. A road along a centre line, and along both sides of it dwellings
 * of the regional types (stone cottage, timber frame, whitewashed Mediterranean, machiya, brick terrace, adobe, Nordic
 * board-clad), each with its own width, proportions, door bay, chimney and colours, set back from the road behind a
 * front fence with a gate that lines up with the door and a flagstone path to it, flower borders in front, a kitchen
 * garden or yard behind, hedges or walls between the lots and street lamps along the road with a few real lights.
 *
 * The model chooses the types and the look of the place; this code only does the measuring: it takes each house's real
 * footprint and door position from the dwelling part, advances along the street by that width plus a gap, turns the house
 * to face the road, and gathers everything of a kind into instanced scatters (a few distinct looks per type, so twenty
 * houses cost a few entities and a few dozen draw calls, not twenty meshes of their own).
 */
import { DWELLING_TYPES, furnitureById, furnitureSize, dwellingDoorAt } from '@aether/arch';
import { Color, rng, type Json, type PatchInput, type WorldDoc } from '@aether/core';
import { z } from 'zod';
import { Builder, r2, type Mood } from './providers/mock/builder';

const XZ = z.number().min(-2000).max(2000);
const CALM: Mood = { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false };
const D2R = Math.PI / 180;

export const StreetInput = z.object({
  op: z.literal('street'),
  points: z.array(z.tuple([XZ, XZ])).min(2).max(12),
  width: z.number().min(2.5).max(14).default(5),
  surface: z.enum(['soil', 'gravel', 'cobble', 'sand', 'asphalt', 'dry-earth']).default('cobble'),
  houses: z
    .object({
      types: z.array(z.enum(DWELLING_TYPES as unknown as [string, ...string[]])).min(1).max(4).default(['stone-cottage']),
      variants: z.number().int().min(1).max(4).default(3),
      gap: z.number().min(0).max(14).default(3.5),
      frontGarden: z.number().min(0).max(14).optional(),
      sides: z.enum(['both', 'left', 'right']).default('both'),
      floors: z.array(z.number().int().min(1).max(3)).max(3).optional(),
      gableFront: z.number().min(0).max(1).default(0.2),
      roofing: z.enum(['auto', 'tile', 'slate', 'thatch', 'metal']).default('auto'),
      lit: z.boolean().default(false),
      maxCount: z.number().int().min(1).max(60).default(30),
      params: z.record(z.string(), z.unknown()).optional(),
    })
    .prefault({}),
  fences: z.union([z.literal(false), z.object({ variant: z.enum(['picket', 'rail', 'stone-wall', 'brick-wall', 'hedge', 'wattle', 'bamboo', 'iron']).optional(), height: z.number().min(0).max(2.4).optional(), color: Color.optional(), gate: z.boolean().default(true) })]).default({ gate: true }),
  gardens: z.boolean().default(true),
  lamps: z.union([z.literal(false), z.object({ every: z.number().min(8).max(90).default(28), lights: z.number().int().min(0).max(12).default(6) })]).default({ every: 28, lights: 6 }),
  name: z.string().max(60).optional(),
});
export type StreetInput = z.infer<typeof StreetInput>;

/** What a type's lot looks like: front boundary, garden depth in front, and how its edges are drawn. */
interface LotStyle {
  fence: { variant: string; height: number; color?: string };
  front: number;
  between: string | null;
  back: 'kitchen-garden' | 'yard' | null;
  flowers: boolean;
}

const LOTS: Record<string, LotStyle> = {
  'stone-cottage': { fence: { variant: 'stone-wall', height: 0.9 }, front: 4, between: 'hedge', back: 'kitchen-garden', flowers: true },
  'timber-frame': { fence: { variant: 'picket', height: 0.95, color: '#efece4' }, front: 3.5, between: 'hedge', back: 'kitchen-garden', flowers: true },
  mediterranean: { fence: { variant: 'stone-wall', height: 0.8, color: '#d8cdb8' }, front: 3, between: 'stone-wall', back: 'yard', flowers: true },
  machiya: { fence: { variant: 'bamboo', height: 1.4 }, front: 0.6, between: null, back: null, flowers: false },
  'brick-terrace': { fence: { variant: 'iron', height: 1.0 }, front: 2.2, between: null, back: 'yard', flowers: false },
  adobe: { fence: { variant: 'wattle', height: 1.1 }, front: 4.5, between: 'wattle', back: 'yard', flowers: false },
  nordic: { fence: { variant: 'picket', height: 0.95, color: '#f2f0eb' }, front: 4.5, between: 'rail', back: 'kitchen-garden', flowers: true },
};

interface Placement {
  gen: string;
  params: Record<string, Json>;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Poly {
  pts: Array<[number, number]>;
  cum: number[];
  length: number;
}

function polyline(points: ReadonlyArray<readonly [number, number]>): Poly {
  const pts = points.map((p) => [p[0], p[1]] as [number, number]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push((cum[i - 1] as number) + Math.hypot((pts[i] as [number, number])[0] - (pts[i - 1] as [number, number])[0], (pts[i] as [number, number])[1] - (pts[i - 1] as [number, number])[1]));
  return { pts, cum, length: cum[cum.length - 1] as number };
}

/** Point and unit tangent of the line at distance `u` along it (clamped to its ends). */
function sample(poly: Poly, u: number): { x: number; z: number; tx: number; tz: number } {
  const uu = Math.min(poly.length, Math.max(0, u));
  let i = 1;
  while (i < poly.pts.length - 1 && (poly.cum[i] as number) < uu) i++;
  const a = poly.pts[i - 1] as [number, number];
  const b = poly.pts[i] as [number, number];
  const seg = Math.max(1e-6, (poly.cum[i] as number) - (poly.cum[i - 1] as number));
  const t = (uu - (poly.cum[i - 1] as number)) / seg;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / len, tz: (b[1] - a[1]) / len };
}

/** Entity yaw (degrees) that turns a piece whose front is +Z to look along (fx, fz). */
const yawOf = (fx: number, fz: number): number => (Math.atan2(fx, fz) * 180) / Math.PI;
/** Entity yaw that turns a piece that runs along +X to run along (dx, dz). */
const runYaw = (dx: number, dz: number): number => (Math.atan2(-dz, dx) * 180) / Math.PI;

export interface StreetResult {
  patches: PatchInput[];
  summary: string;
  refused?: boolean;
}

/** The patches of one `street` call. `ground` is the height of the land at a point; `road` lays the road ribbon. */
export function streetPatches(world: WorldDoc, input: StreetInput, seed: number, ground: (x: number, z: number) => number, road: () => PatchInput[]): StreetResult {
  const poly = polyline(input.points);
  if (poly.length < 12) return { patches: [], refused: true, summary: 'shape_land street refused: the centre line is shorter than 12 m; give a longer line (two or more points).' };
  const dwelling = furnitureById('furn-dwelling');
  const fenceDef = furnitureById('furn-fence');
  if (!dwelling || !fenceDef) return { patches: [], refused: true, summary: 'shape_land street refused: the dwelling parts are not available.' };
  const random = rng(seed);
  const b = new Builder(seed, Object.keys(world.entities), CALM);
  const h = input.houses;
  const hw = input.width / 2;
  const sides = h.sides === 'both' ? [1, -1] : h.sides === 'left' ? [1] : [-1];
  const houses: Placement[] = [];
  const fences: Placement[] = [];
  const gardens: Placement[] = [];
  const lamps: Placement[] = [];
  const counts: Record<string, number> = {};
  const pavement = 1.1;
  const walls = input.fences === false ? null : input.fences;

  // A few distinct looks per type: variant numbers chosen once, so houses of one look instance together.
  const looks: Array<{ type: string; params: Record<string, Json> }> = [];
  for (const type of h.types) {
    for (let k = 0; k < h.variants; k++) {
      const floors = h.floors && h.floors.length > 0 ? (h.floors[(k + looks.length) % h.floors.length] as number) : 0;
      const gableFront = random() < h.gableFront && type !== 'brick-terrace';
      looks.push({
        type,
        params: { ...((h.params ?? {}) as Record<string, Json>), type, variant: Math.floor(random() * 90) + k, ...(floors > 0 ? { floors } : {}), ...(gableFront ? { gableFront: true } : {}), ...(h.roofing !== 'auto' ? { roofing: h.roofing } : {}), ...(h.lit ? { lit: true } : {}) },
      });
    }
  }
  const spacing = h.gap;
  let total = 0;
  let order = 0;
  for (const side of sides) {
    let u = 4;
    let last = -1;
    let sideCount = 0;
    while (total < h.maxCount) {
      // The next look: never the same as its neighbour.
      let li = Math.floor(random() * looks.length);
      if (looks.length > 1 && li === last) li = (li + 1) % looks.length;
      last = li;
      const look = looks[li] as { type: string; params: Record<string, Json> };
      const lot = LOTS[look.type] as LotStyle;
      const front = h.frontGarden ?? lot.front;
      const params: Record<string, Json> = { ...look.params, path: r2(pavement + front + 0.3) };
      const size = furnitureSize(dwelling, params);
      const frontage = size[0] * 0.94;
      if (u + frontage > poly.length - 3) break;
      const uc = u + frontage / 2;
      const s0 = sample(poly, uc);
      // The normal on this side; the house looks back at the road.
      const nx = -s0.tz * side;
      const nz = s0.tx * side;
      const yaw = Math.round(yawOf(-nx, -nz) / 5) * 5;
      const fx = Math.sin(yaw * D2R);
      const fz = Math.cos(yaw * D2R);
      // Depth of the house from its front wall to the back (the part's box is symmetric, the door sits on the front).
      const [doorX, frontZ] = dwellingDoorAt(params);
      const depthFront = frontZ;
      const depthBack = Math.max(3.5, size[2] / 2 - 0.2);
      const vFront = hw + pavement + front;
      const cx = s0.x + nx * (vFront + depthFront);
      const cz = s0.z + nz * (vFront + depthFront);
      // Ground under the corners: the house stands on the lowest so the upper side buries into the slope.
      const corners: number[] = [];
      for (const [dx, dz] of [[-size[0] / 2, -depthBack], [size[0] / 2, -depthBack], [-size[0] / 2, depthFront], [size[0] / 2, depthFront]] as const) {
        corners.push(ground(cx + dx * fz + dz * fx, cz - dx * fx + dz * fz));
      }
      const y = Math.min(...corners);
      houses.push({ gen: 'furn-dwelling', params, x: cx, y, z: cz, yaw });
      counts[look.type] = (counts[look.type] ?? 0) + 1;
      total++;
      sideCount++;
      order++;
      // Door world position, for the gate.
      const dwx = cx + doorX * fz + frontZ * fx;
      const dwz = cz - doorX * fx + frontZ * fz;
      const ug = uc + (dwx - s0.x) * s0.tx + (dwz - s0.z) * s0.tz;
      if (walls !== null) {
        const fv = walls.variant ?? lot.fence.variant;
        const fh = walls.height ?? lot.fence.height;
        const fc = walls.color ?? lot.fence.color ?? '#efece4';
        const vf = hw + pavement;
        const u0 = u;
        const u1 = u + frontage;
        const pitch = 2.4;
        const run = (a: number, c2: number): void => {
          const len = c2 - a;
          if (len < 0.5) return;
          const n = Math.max(1, Math.round(len / pitch));
          const span = len / n;
          for (let i = 0; i < n; i++) {
            const uu = a + (i + 0.5) * span;
            const sp = sample(poly, uu);
            const px = sp.x + -sp.tz * side * vf;
            const pz = sp.z + sp.tx * side * vf;
            fences.push({ gen: 'furn-fence', params: { variant: fv, span: r2(span), height: fh, color: fc, seed: order % 7 }, x: px, y: ground(px, pz), z: pz, yaw: Math.round(runYaw(sp.tx, sp.tz) / 5) * 5 });
          }
        };
        const gateOn = walls.gate && front > 1;
        const gw = 1.5;
        if (gateOn) {
          const gu = Math.min(u1 - gw / 2 - 0.2, Math.max(u0 + gw / 2 + 0.2, ug));
          run(u0, gu - gw / 2);
          run(gu + gw / 2, u1);
          const sp = sample(poly, gu);
          const px = sp.x + -sp.tz * side * vf;
          const pz = sp.z + sp.tx * side * vf;
          fences.push({ gen: 'furn-fence', params: { variant: fv, span: gw, height: fh, color: fc, gate: true, seed: order % 7 }, x: px, y: ground(px, pz), z: pz, yaw: Math.round(runYaw(sp.tx, sp.tz) / 5) * 5 });
        } else run(u0, u1);
        // Dividing line between neighbours, from the road fence back past the house.
        if (lot.between && spacing > 0.5 && sideCount > 1) {
          const ub = u - spacing / 2;
          const sp = sample(poly, ub);
          const dep = front + depthFront + depthBack + 3.5;
          const nn = Math.max(1, Math.round(dep / 2.4));
          const span = dep / nn;
          for (let i = 0; i < nn; i++) {
            const v = vf + (i + 0.5) * span;
            const px = sp.x + -sp.tz * side * v;
            const pz = sp.z + sp.tx * side * v;
            const yawSide = Math.round(runYaw(-sp.tz * side, sp.tx * side) / 5) * 5;
            fences.push({ gen: 'furn-fence', params: { variant: lot.between, span: r2(span), height: lot.between === 'hedge' ? 1.2 : 1.0, color: lot.between === 'hedge' ? '#4f7340' : fc, seed: (order + i) % 7 }, x: px, y: ground(px, pz), z: pz, yaw: yawSide });
          }
        }
      }
      if (input.gardens) {
        if (lot.flowers && front >= 3) {
          const gdep = front - 0.8;
          const gwid = Math.min(frontage - 1.2, 7);
          const vc = vFront - front / 2 - 0.0;
          const px = s0.x + nx * (vc + 0.1);
          const pz = s0.z + nz * (vc + 0.1);
          gardens.push({ gen: 'furn-garden', params: { variant: 'flowers', width: r2(Math.max(2, gwid)), depth: r2(Math.max(1.6, gdep)), seed: order % 5 }, x: px, y: ground(px, pz), z: pz, yaw });
        }
        if (lot.back) {
          const bd = 4.2;
          const bwid = Math.min(frontage + 1, 8);
          const vb = vFront + depthFront + depthBack + bd / 2 + 0.4;
          const px = s0.x + nx * vb;
          const pz = s0.z + nz * vb;
          const kind = lot.back === 'yard' || order % 3 === 0 ? 'yard' : 'kitchen-garden';
          gardens.push({ gen: 'furn-garden', params: { variant: kind, width: r2(bwid), depth: bd, seed: order % 5 }, x: px, y: ground(px, pz), z: pz, yaw });
        }
      }
      u += frontage + spacing * (0.7 + random() * 0.6);
    }
  }
  if (houses.length === 0) return { patches: [], refused: true, summary: 'shape_land street refused: no house fits along that line; make it longer or the gap smaller.' };

  // Lamps along the road on alternate sides.
  let lampCount = 0;
  const lightSpots: Array<[number, number, number]> = [];
  if (input.lamps !== false) {
    const every = input.lamps.every;
    for (let u = every / 2, k = 0; u < poly.length; u += every, k++) {
      const side = sides.length === 1 ? (sides[0] as number) : k % 2 === 0 ? 1 : -1;
      const sp = sample(poly, u);
      const v = hw + 0.5;
      const px = sp.x + -sp.tz * side * v;
      const pz = sp.z + sp.tx * side * v;
      const y = ground(px, pz);
      lamps.push({ gen: 'furn-street-lamp', params: { variant: 'post', glow: 0.8 }, x: px, y, z: pz, yaw: 0 });
      lightSpots.push([r2(px), r2(y + 3.2), r2(pz)]);
      lampCount++;
    }
  }

  // Gather by look and turn into instanced scatters.
  const ids: string[] = [];
  const emit = (list: Placement[], label: string, tag: string, solid: boolean): void => {
    const groups = new Map<string, { gen: string; params: Record<string, Json>; yaw: number; pts: Array<[number, number, number]> }>();
    for (const p of list) {
      const key = `${p.gen}|${JSON.stringify(p.params)}|${p.yaw}`;
      let g = groups.get(key);
      if (!g) {
        g = { gen: p.gen, params: p.params, yaw: p.yaw, pts: [] };
        groups.set(key, g);
      }
      const c = Math.cos(p.yaw * D2R);
      const s = Math.sin(p.yaw * D2R);
      g.pts.push([r2(p.x * c - p.z * s), r2(p.y), r2(p.x * s + p.z * c)]);
    }
    for (const g of groups.values()) {
      const nm = typeof g.params['type'] === 'string' ? String(g.params['type']) : typeof g.params['variant'] === 'string' ? String(g.params['variant']) : g.gen.replace(/^furn-/, '');
      ids.push(
        b.add({
          id: b.id(`street-${label}-${nm}`),
          name: `${g.pts.length} x ${nm.replace(/-/g, ' ')} (${label})`,
          transform: { position: [0, 0, 0], rotation: [0, g.yaw, 0] },
          shape: { kind: 'scatter', of: { kind: 'procedural', generator: g.gen, params: g.params }, count: g.pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: g.pts },
          ...(solid ? { physics: { body: 'static' as const } } : {}),
          tags: ['street', tag],
        }),
      );
    }
  };
  emit(houses, 'houses', 'houses', true);
  emit(fences, 'fences', 'fences', true);
  emit(gardens, 'gardens', 'gardens', false);
  emit(lamps, 'lamps', 'lamps', false);
  const nLights = input.lamps === false ? 0 : Math.min(input.lamps.lights, lightSpots.length);
  for (let i = 0; i < nLights; i++) {
    const at = lightSpots[Math.floor((i * lightSpots.length) / Math.max(1, nLights))] as [number, number, number];
    b.add({
      id: b.id('street-lamp-light'),
      name: 'Street lamp light',
      transform: { position: at, rotation: [0, 0, 0], scale: [1, 1, 1] },
      shape: { kind: 'none' },
      light: { type: 'point', color: '#ffd7a6', intensity: 0.7, range: 9, angle: 60, castShadow: false },
      tags: ['light', 'street'],
    });
  }
  const patches = [...road(), ...b.build()];
  const perType = Object.entries(counts).map(([t, n]) => `${n} ${t.replace(/-/g, ' ')}`).join(', ');
  return {
    patches,
    summary: `Built the street${input.name ? ` "${input.name}"` : ''}: a ${input.surface} road ${poly.length.toFixed(0)} m long and ${input.width} m wide, ${houses.length} dwellings (${perType}), ${fences.length} fence and wall pieces with a gate in line with each door and a flagstone path to it, ${gardens.length} gardens, ${lampCount} street lamps (${nLights} with a real light), in ${ids.length} instanced entities. Each house turns to face the road at the width its type needs; the types' own variation (proportions, door bay, chimney, colours) and ${h.variants} looks per type keep them from repeating. Walk the street to judge it; add trees with shape_land row, a well, a market or a bridge with the generators.`,
  };
}

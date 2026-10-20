/**
 * `shape_land`: the landscape kit of the offline planner offered to the model as a tool, so an outdoor world the
 * assistant builds stands on the same ground the flagships do instead of a flat plane:
 *
 * - `land`: a terrain with relief (the estate variant: a level plot for buildings or an arena, meadow swells, hills
 *   that close the horizon; or a sandstone canyon), an optional stream carved across it with flowing water, woods of
 *   the leaf-card trees on the slopes and clumped ground cover (grass, flowers) round the plot. Replaces the land it
 *   built before.
 * - `path`: a trail, lane or road draped over whatever terrain is there as one mesh with soft verges.
 *
 * Deterministic for its input. Everything it adds is tagged `land`; positions are measured from the same heightfield
 * physics uses, so `place_level_items` and `query_level` agree with it.
 */
import { Color, hashString, rng, type Json, type PatchInput, type WorldDoc } from '@aether/core';
import { z } from 'zod';
import { Builder, r2, type Mood } from './providers/mock/builder';
import { naturalGround, scatterBelt, type ThemeCtx } from './providers/mock/decor';
import { groundRibbon, terrainHeight } from './providers/mock/showcase/kit';

const XZ = z.number().min(-2000).max(2000);

/** Input of the `shape_land` tool. */
export const LandInput = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('land'),
    kind: z.enum(['meadow', 'forest', 'snow', 'canyon']).default('meadow'),
    size: z.number().min(120).max(800).default(420),
    relief: z.number().min(0).max(120).default(48),
    color: Color.optional(),
    plot: z.object({ x: XZ.default(0), z: XZ.default(0), radius: z.number().min(4).max(200).default(20) }).default({ x: 0, z: 0, radius: 20 }),
    stream: z.object({ z: XZ, half: z.number().min(1).max(12).default(2.5), bend: z.number().min(0).max(30).default(5), depth: z.number().min(0.4).max(4).default(1.4) }).optional(),
    woods: z.object({ conifers: z.number().int().min(0).max(400), broadleaf: z.number().int().min(0).max(400), birch: z.number().int().min(0).max(200), scrub: z.number().int().min(0).max(600), boulders: z.number().int().min(0).max(200) }).partial().optional(),
    cover: z.object({ grass: Color.optional(), flowers: z.array(Color).max(4).optional(), radius: z.number().min(5).max(150).default(40), density: z.number().min(0).max(2).default(1) }).optional(),
  }),
  z.object({
    op: z.literal('path'),
    points: z.array(z.tuple([XZ, XZ])).min(2).max(64),
    width: z.number().min(0.6).max(14).default(1.8),
    surface: z.enum(['soil', 'gravel', 'cobble', 'sand', 'decking', 'asphalt', 'dry-earth']).default('soil'),
    color: Color.optional(),
    name: z.string().max(60).optional(),
  }),
]);
export type LandInput = z.infer<typeof LandInput>;

const CALM: Mood = { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false };

/** Default tints per kind: grass of the land, the centre and verge of a path. */
const KIND_COLOR: Record<'meadow' | 'forest' | 'snow' | 'canyon', string> = { meadow: '#6a9a45', forest: '#4f7a35', snow: '#eef2f6', canyon: '#9a8a4f' };
const SURFACE_COLOR: Record<string, string> = { soil: '#7d6c52', gravel: '#b7ab92', cobble: '#9d968a', sand: '#d6c08e', decking: '#8f6d4f', asphalt: '#4f4e4d', 'dry-earth': '#a88c66' };

/** Height of the ground under (x, z) in `world`: its first terrain entity (procedural `terrain`), else the flat plane at 0. */
export function worldGround(world: WorldDoc): (x: number, z: number) => number {
  for (const e of Object.values(world.entities)) {
    if (e.shape.kind !== 'procedural' || e.shape.generator !== 'terrain' || e.parent) continue;
    const params = e.shape.params as Record<string, Json>;
    const size = typeof params['size'] === 'number' ? params['size'] : 60;
    try {
      const h = terrainHeight(params, e.shape.seed ?? 0, size);
      const [ox, oy, oz] = e.transform.position;
      return (x, z) => (Math.abs(x - ox) <= size / 2 && Math.abs(z - oz) <= size / 2 ? h(x - ox, z - oz) + oy : 0);
    } catch {
      return () => 0;
    }
  }
  return () => 0;
}

function tagLand(patches: PatchInput[]): PatchInput[] {
  for (const p of patches) {
    if (p.op === 'add' && p.entity) p.entity.tags = [...(p.entity.tags ?? []), 'land'];
  }
  return patches;
}

/** The patches for one `shape_land` call against `world`, and a summary for the model. */
export function landPatches(world: WorldDoc, input: LandInput): { patches: PatchInput[]; summary: string } {
  const seed = hashString(JSON.stringify(input)) >>> 0;
  const ids = Object.keys(world.entities);
  if (input.op === 'path') {
    const b = new Builder(seed, ids, CALM);
    const h = worldGround(world);
    const id = groundRibbon(b, {
      id: b.id('path'),
      name: input.name ?? 'Path',
      paths: [input.points],
      height: h,
      width: input.width,
      lift: input.surface === 'asphalt' ? 0.03 : 0.045,
      centre: input.color ?? SURFACE_COLOR[input.surface] ?? '#7d6c52',
      edge: input.color ?? SURFACE_COLOR[input.surface] ?? '#7d6c52',
      material: { finish: input.surface, roughness: input.surface === 'asphalt' ? 0.8 : 0.95 },
      tags: ['path'],
      taper: true,
    });
    const len = input.points.reduce((s, p, i) => (i === 0 ? 0 : s + Math.hypot(p[0] - (input.points[i - 1] as [number, number])[0], p[1] - (input.points[i - 1] as [number, number])[1])), 0);
    return { patches: tagLand(b.build()), summary: `Laid "${id}": a ${input.surface} path ${len.toFixed(0)} m long and ${input.width} m wide, draped over the ground (no collider: the ground carries the walker).` };
  }
  // A new land replaces the one built before (its terrain, water, woods and cover).
  const removals: PatchInput[] = Object.values(world.entities).filter((e) => !e.parent && e.tags.includes('land') && !e.tags.includes('path')).map((e) => ({ op: 'remove', id: e.id, recursive: true }));
  const removed = new Set(removals.map((p) => (p.op === 'remove' ? p.id : '')));
  const b = new Builder(seed, ids.filter((id) => !removed.has(id)), CALM);
  b.realisticNature = true;
  const color = input.color ?? KIND_COLOR[input.kind];
  b.env({ ground: { material: { preset: 'grass', color }, size: 400 } });
  const c: ThemeCtx = { b, x: input.plot.x, z: input.plot.z, clear: 0, primary: true };
  let terrain = '';
  if (input.kind === 'canyon') {
    const params: Record<string, Json> = { size: input.size, height: Math.max(12, input.relief), resolution: 384, roughness: 0.55, color, variant: 3 };
    const tseed = seed % 100_000;
    b.env({ ground: null });
    terrain = b.add({ id: b.id('canyon'), name: 'Canyon', shape: { kind: 'procedural', generator: 'terrain', params, seed: tseed }, transform: { position: [0, 0, 0] }, physics: { body: 'static', friction: 0.9 }, tags: ['terrain'] });
    b.ground = { h: terrainHeight(params, tseed, input.size), surface: terrain };
    const w = input.woods ?? {};
    const random = rng(seed);
    for (let k = 0; k < (w.boulders ?? 40); k++) {
      const z = r2((random() - 0.5) * input.size * 0.8);
      const x = r2((random() - 0.5) * input.size * 0.12);
      b.gen('boulder', 'boulder', { size: r2(0.8 + random() * 2.6), lichen: 0, color: '#c49a72', variant: 1 }, [x, 0, z], { yaw: r2(random() * 360), physics: 'static' });
    }
    for (let k = 0; k < Math.min(120, (w.scrub ?? 30)); k++) {
      const z = r2((random() - 0.5) * input.size * 0.8);
      const x = r2((random() - 0.5) * input.size * 0.12);
      b.gen('cactus', 'cactus', { height: r2(3 + random() * 4), arms: Math.floor(random() * 4) }, [x, 0, z], { yaw: r2(random() * 360), physics: 'static' });
    }
  } else {
    naturalGround(c, {
      pad: input.plot.radius,
      relief: input.relief,
      size: input.size,
      color,
      ...(input.stream ? { stream: input.stream } : {}),
      ...(input.woods ? { woods: input.woods } : input.kind === 'forest' ? { woods: { conifers: 220, broadleaf: 70, birch: 30, scrub: 260, boulders: 50 } } : {}),
      ...(input.kind === 'snow' ? { snow: true } : {}),
    });
    terrain = b.ground?.surface ?? '';
  }
  const cov = input.cover ?? (input.kind === 'canyon' ? undefined : { radius: 40, density: 1 });
  if (cov) {
    const k = cov.density ?? 1;
    const outer = cov.radius ?? 40;
    const inner = Math.min(outer - 3, Math.max(2, input.plot.radius * 0.15));
    const grass = cov.grass ?? (input.kind === 'snow' ? '#a9a98f' : '#78a048');
    scatterBelt(c, 'meadow', 'meadow-grass', { color: grass, size: 0.55 }, Math.round(520 * k), inner, outer, { scaleRange: [0.6, 1.4], minSpacing: 0.3 });
    for (const f of cov.flowers ?? []) scatterBelt(c, 'wildflowers', 'wildflowers', { color: f, size: 0.5 }, Math.round(60 * k), inner + 2, outer, { minSpacing: 0.5 });
  }
  const patches = [...removals, ...tagLand(b.build())];
  const stream = b.stream;
  const parts = [
    `Built the land: ${input.kind === 'canyon' ? 'a sandstone canyon' : 'a terrain'} ${input.size} m across with ${input.relief} m of relief, the level ${input.kind === 'canyon' ? 'canyon floor at y = 0 running along Z' : `plot of radius ${input.plot.radius} m at (${input.plot.x}, ${input.plot.z}) at y = 0`} (terrain "${terrain}", the flat ground plane is off).`,
    stream ? `A stream runs along X at z ≈ ${input.stream?.z ?? 0} (bends of ±${input.stream?.bend ?? 5} m), ${(stream.half * 2).toFixed(1)} m wide, water surface at y = ${stream.waterY}: cross it with a bridge generator (it spans X, so yaw 90) or stepping stones.` : '',
    `Outside the plot the ground rises: place things with place_level_items or read heights with query_level {op:"ground"}; scatter layers can set onSurface "${terrain}". Lay trails and roads with shape_land {op:"path"}.`,
    removals.length > 0 ? `Replaced the previous land (${removals.length} entities).` : '',
  ];
  return { patches, summary: parts.filter(Boolean).join(' ') };
}

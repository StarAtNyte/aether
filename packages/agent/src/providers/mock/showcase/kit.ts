/**
 * Shared helpers of the flagship showcase plans: a fresh builder with an
 * explicit mood, the finishing step (clear + patches + title card), and
 * small placement utilities (rings, curves, glowing lanterns).
 */
import { encodeMesh, type Json, type MaterialSpec, type MeshData, type PatchInput, type WorldIntro } from '@aether/core';
import { generateBuiltinSync } from '@aether/procgen';
import { Builder, r2, type Mood, type V3 } from '../builder';
import type { MockPlan } from '../planner';

/** A calm default mood (every flag off). */
const CALM: Mood = Object.freeze({ night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false });

/** A builder for a whole new world, seeded from the flagship id. */
export function flagshipBuilder(seed: number, mood: Partial<Mood> = {}, opts: { stylised?: boolean } = {}): Builder {
  const b = new Builder(seed, [], { ...CALM, ...mood });
  b.realisticNature = opts.stylised !== true;
  return b;
}

/** Title card input (defaults filled by the schema). */
export type IntroInput = { title: string; tagline?: string; objective?: string; controls?: string[]; accent?: string };

/** Everything a flagship plan reports besides its patches. */
export interface FlagshipFinish {
  name: string;
  description: string;
  intro?: IntroInput;
  /** Plan line shown before the tool calls. */
  plan: string;
  /** Finish message for the user. */
  message: string;
  /** Architecture ops sent with build_architecture after the patches. */
  arch?: { ops: unknown[]; message: string };
}

/**
 * Turn a builder into a complete plan: the world is cleared first (a
 * flagship always replaces the current world), then the builder's patches,
 * then the title card.
 */
export function finish(b: Builder, f: FlagshipFinish): MockPlan {
  b.meta(f.name, f.description);
  const patches: PatchInput[] = [{ op: 'clear', keepEnvironment: false }, ...b.build()];
  if (f.intro) {
    const intro: Partial<WorldIntro> & { title: string } = { title: f.intro.title };
    if (f.intro.tagline) intro.tagline = f.intro.tagline;
    if (f.intro.objective) intro.objective = f.intro.objective;
    if (f.intro.controls) intro.controls = f.intro.controls;
    if (f.intro.accent) intro.accent = f.intro.accent;
    patches.push({ op: 'setMeta', intro: intro as WorldIntro });
  }
  return { plan: f.plan, patches, message: f.message, ...(f.arch ? { arch: f.arch } : {}) };
}

/** Point on a circle of radius `r` around (cx, cz) at angle `a` (radians), y = `y`. */
export function onCircle(cx: number, cz: number, r: number, a: number, y = 0): V3 {
  return [r2(cx + Math.cos(a) * r), r2(y), r2(cz + Math.sin(a) * r)];
}

/** Yaw (degrees) facing from (x, z) toward (tx, tz) for a +Z-facing object. */
export function faceToward(x: number, z: number, tx: number, tz: number): number {
  return r2((Math.atan2(tx - x, tz - z) * 180) / Math.PI);
}

/**
 * A glowing paper/stone lantern: a short post with an emissive shade and,
 * unless `lit` is false, a warm point light that breathes gently (keep real
 * lights to a dozen or so per world: each one costs every lit pixel).
 * Returns the post id.
 */
export function glowLantern(b: Builder, pos: V3, color = '#ffb35c', o: { height?: number; intensity?: number; range?: number; tags?: string[]; shade?: string; lit?: boolean } = {}): string {
  const h = o.height ?? 1.4;
  const post = b.prim('lantern-post', 'box', [0.14, h, 0.14], [pos[0], r2(pos[1] + h / 2), pos[2]], { material: { preset: 'wood', color: '#3b2a20' }, physics: 'static', footprint: 0.4, ...(o.tags ? { tags: o.tags } : {}) });
  b.prim(`${post}-shade`, 'box', [0.36, 0.42, 0.36], [0, r2(h / 2 + 0.2), 0], { parent: post, material: { preset: 'emissive', color: o.shade ?? '#fff1d6', emissive: color, emissiveIntensity: 2.6 }, castShadow: false });
  if (o.lit === false) return post;
  b.light(post, [0, r2(h / 2 + 0.25), 0], color, o.intensity ?? 2.2, o.range ?? 10, [{ type: 'pulseLight', params: { min: (o.intensity ?? 2.2) * 0.8, max: (o.intensity ?? 2.2) * 1.1, period: r2(b.rand(2.2, 3.6)), phase: r2(b.rand(0, 1)) } }]);
  return post;
}

/** A floating spinning collectible (glowing gem / lantern / cell) adding to `scoreKey`. */
export function pickup(b: Builder, base: string, pos: V3, o: { scoreKey: string; color: string; size?: number; shape?: 'sphere' | 'box' | 'cylinder'; message?: string; name?: string; tags?: string[] }): string {
  const s = o.size ?? 0.6;
  const id = b.prim(base, o.shape ?? 'sphere', [s, o.shape === 'cylinder' ? s * 0.25 : s, s], pos, {
    name: o.name ?? 'Collectible',
    ...(o.shape === 'cylinder' ? { rot: [90, 0, 0] as V3 } : {}),
    material: { preset: 'emissive', color: o.color, emissive: o.color, emissiveIntensity: 2.2 },
    behaviors: [
      { type: 'spin', params: { axis: o.shape === 'cylinder' ? [0, 0, 1] : [0, 1, 0], speed: 110 } },
      { type: 'bob', params: { amplitude: 0.18, period: 1.8, phase: r2(b.rand(0, 1)) } },
      { type: 'collectible', params: { scoreKey: o.scoreKey, value: 1, margin: 1.2, ...(o.message ? { message: o.message } : {}) } },
    ],
    tags: o.tags ?? ['pickup'],
    castShadow: false,
  });
  return id;
}

/** Points along a closed loop (ellipse with a wobble) — race lines, train tracks, patrols. */
export function loopPoints(cx: number, cz: number, rx: number, rz: number, count: number, wobble = 0, y = 0, phase = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    const w = 1 + wobble * Math.sin(a * 3);
    out.push([r2(cx + Math.cos(a) * rx * w), r2(y), r2(cz + Math.sin(a) * rz * w)]);
  }
  return out;
}

/** A thin box segment from `a` to `b` (rails, curbs, paths, fences of light). */
export function segment(b: Builder, base: string, from: V3, to: V3, width: number, height: number, material: NonNullable<Parameters<Builder['prim']>[4]>['material'], extra: { physics?: 'static'; tags?: string[]; castShadow?: boolean; y?: number } = {}): string {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dz);
  const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  return b.prim(base, 'box', [r2(width), r2(height), r2(len)], [r2((from[0] + to[0]) / 2), r2(extra.y ?? (from[1] + to[1]) / 2 + height / 2), r2((from[2] + to[2]) / 2)], {
    yaw: r2(yaw),
    material,
    ...(extra.physics ? { physics: extra.physics } : {}),
    ...(extra.tags ? { tags: extra.tags } : {}),
    castShadow: extra.castShadow ?? false,
  });
}

/** Deep-frozen JSON params helper (keeps literal params typed as Json). */
export function params(p: Record<string, Json>): Record<string, Json> {
  return p;
}

/**
 * Ground height under (x, z) of a built-in terrain entity (bilinear over the heightfield grid the renderer and physics
 * share), for placing things on it offline.
 */
export function terrainHeight(params: Record<string, Json>, seed: number, size: number): (x: number, z: number) => number {
  const out = generateBuiltinSync('terrain', params, seed);
  const hf = out.colliders.find((c) => c.kind === 'heightfield');
  if (!hf || hf.kind !== 'heightfield') throw new Error('terrain has no heightfield');
  const n = hf.rows + 1;
  const sizeY = hf.size[1];
  const at = (ix: number, iz: number): number => (hf.heights[Math.min(hf.cols, Math.max(0, ix)) * n + Math.min(hf.rows, Math.max(0, iz))] as number) * sizeY;
  return (x, z) => {
    const fx = ((x + size / 2) / size) * hf.cols;
    const fz = ((z + size / 2) / size) * hf.rows;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    return at(ix, iz) * (1 - tx) * (1 - tz) + at(ix + 1, iz) * tx * (1 - tz) + at(ix, iz + 1) * (1 - tx) * tz + at(ix + 1, iz + 1) * tx * tz;
  };
}

/** Options of {@link groundRibbon}. */
export interface GroundRibbonOptions {
  /** Entity id (also the mesh id slug base). */
  id: string;
  name?: string;
  /** Polylines of (x, z) the ribbon follows, one strip each (a gap such as a bridge is a separate polyline). */
  paths: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** Ground height under (x, z). */
  height: (x: number, z: number) => number;
  /** Average width in metres (default 1.8); it breathes by about a quarter along the way. */
  width?: number;
  /** Height above the ground in metres (default 0.05). */
  lift?: number;
  /** Distance between cross-sections (default 0.8 m). */
  step?: number;
  /** Colour of the worn centre and of the verges, "#rrggbb" (the verge fades towards the ground tone). */
  centre?: string;
  edge?: string;
  /** Surface finish and tint of the strip. */
  material?: MaterialSpec;
  tags?: string[];
}

function chaikin(pts: ReadonlyArray<readonly [number, number]>, rounds: number): Array<[number, number]> {
  let cur: Array<[number, number]> = pts.map((p) => [p[0], p[1]]);
  for (let r = 0; r < rounds && cur.length > 2; r++) {
    const next: Array<[number, number]> = [cur[0] as [number, number]];
    for (let i = 0; i + 1 < cur.length; i++) {
      const a = cur[i] as [number, number];
      const c = cur[i + 1] as [number, number];
      next.push([a[0] * 0.75 + c[0] * 0.25, a[1] * 0.75 + c[1] * 0.25], [a[0] * 0.25 + c[0] * 0.75, a[1] * 0.25 + c[1] * 0.75]);
    }
    next.push(cur[cur.length - 1] as [number, number]);
    cur = next;
  }
  return cur;
}

function srgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}

/**
 * A worn path as one mesh draped over the terrain: cross-sections every `step` metres sample the ground under five points
 * across the strip (so it follows slope across the path as well as along it), the width breathes, the line wanders a little
 * and the verges darken towards the ground tone. It has no collider (the terrain carries the walker) and no seams to
 * float or sink, unlike a row of boxes. Returns the entity id.
 */
export function groundRibbon(b: Builder, o: GroundRibbonOptions): string {
  const width = o.width ?? 1.8;
  const lift = o.lift ?? 0.05;
  const step = o.step ?? 0.8;
  const centre = srgb(o.centre ?? '#cdbf9e');
  const edge = srgb(o.edge ?? '#7d7656');
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ACROSS = 5;
  const phase = b.rand(0, 100);
  let run = 0;
  for (const raw of o.paths) {
    if (raw.length < 2) continue;
    const pts = chaikin(raw, 2);
    // Resample at an even step along the smoothed line.
    const samples: Array<[number, number, number, number]> = [];
    let carry = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as [number, number];
      const c = pts[i + 1] as [number, number];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 1e-6) continue;
      const dx = (c[0] - a[0]) / len;
      const dz = (c[1] - a[1]) / len;
      for (let t = carry; t < len; t += step) samples.push([a[0] + dx * t, a[1] + dz * t, dx, dz]);
      carry = (carry + Math.ceil((len - carry) / step) * step) - len;
    }
    const last = pts[pts.length - 1] as [number, number];
    const prev = samples[samples.length - 1];
    if (prev) samples.push([last[0], last[1], prev[2], prev[3]]);
    if (samples.length < 2) continue;
    const base = positions.length / 3;
    samples.forEach((sm, k) => {
      const dist = run + k * step;
      const wob = 0.35 * Math.sin(dist * 0.21 + phase) + 0.2 * Math.sin(dist * 0.53 + phase * 1.7);
      const half = (width / 2) * (1 + 0.22 * Math.sin(dist * 0.17 + phase * 0.6) + 0.1 * Math.sin(dist * 0.61));
      const nx = -sm[3];
      const nz = sm[2];
      const cx = sm[0] + nx * wob;
      const cz = sm[1] + nz * wob;
      for (let j = 0; j < ACROSS; j++) {
        const u = (j / (ACROSS - 1)) * 2 - 1;
        const x = cx + nx * half * u;
        const z = cz + nz * half * u;
        // The verge sinks a little so it meets the turf instead of standing proud of it.
        positions.push(x, o.height(x, z) + lift - 0.03 * u * u, z);
        const e = Math.min(1, Math.abs(u) ** 2.2);
        const grain = 0.88 + 0.12 * Math.sin(dist * 1.7 + j * 2.3);
        colors.push((centre[0] + (edge[0] - centre[0]) * e) * grain, (centre[1] + (edge[1] - centre[1]) * e) * grain, (centre[2] + (edge[2] - centre[2]) * e) * grain);
        uvs.push((u * half) / 1.5, dist / 1.5);
      }
    });
    for (let k = 0; k + 1 < samples.length; k++) {
      for (let j = 0; j + 1 < ACROSS; j++) {
        const a = base + k * ACROSS + j;
        const c = a + ACROSS;
        // Counter-clockwise seen from above: along +path, across +normal.
        indices.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
    run += samples.length * step + 3;
  }
  const data: MeshData = { positions: new Float32Array(positions), indices: new Uint32Array(indices), colors: new Float32Array(colors), uvs: new Float32Array(uvs), faceMaterials: null };
  const mat: MaterialSpec = { finish: 'gravel', roughness: 0.95, ...(o.material ?? {}) };
  const meshId = `${o.id}-mesh`;
  b.mesh(encodeMesh(meshId, data, { materials: [mat] }));
  b.add({ id: o.id, name: o.name ?? 'Path', shape: { kind: 'mesh', mesh: meshId }, transform: { position: [0, 0, 0] }, castShadow: false, ...(o.tags ? { tags: o.tags } : {}) });
  return o.id;
}

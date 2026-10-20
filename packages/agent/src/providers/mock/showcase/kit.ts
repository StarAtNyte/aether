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
    material: { preset: 'emissive', color: o.color, emissive: o.color, emissiveIntensity: 1.5 },
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

/**
 * Hand-placed points on a landscape: up to `count` points in the square `[-half, half]` where `ok(x, z)` holds and
 * nothing already reserved lies within `spacing` metres (the points are reserved), set on the ground height `h`.
 */
export function landPoints(b: Builder, count: number, half: number, ok: (x: number, z: number) => boolean, spacing: number, h: (x: number, z: number) => number, tries = 30): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < tries; t++) {
      const x = r2(b.rand(-half, half));
      const z = r2(b.rand(-half, half));
      if (!ok(x, z) || !b.isFree(x, z, spacing)) continue;
      b.reserve(x, z, spacing);
      out.push([x, h(x, z), z]);
      break;
    }
  }
  return out;
}

/** A layer of instanced plants or trees at hand-placed `points` on the terrain entity `onSurface`. */
export function grove(b: Builder, base: string, name: string, generator: string, params: Record<string, Json>, points: V3[], scale: [number, number], onSurface: string, area = 400): void {
  if (points.length === 0) return;
  b.add({
    id: b.id(base),
    name,
    transform: { position: [0, 0, 0] },
    shape: { kind: 'scatter', of: { kind: 'procedural', generator, params }, count: points.length, area: [area, area], seed: b.subSeed() % 100_000, scaleRange: scale, onSurface, points },
    tags: ['grove'],
  });
}

/** What {@link estateGround} reports. */
export interface EstateGround {
  /** World height of the ground at (x, z), the plot at y = 0. */
  h(x: number, z: number): number;
  /** Id of the terrain entity (for scatter `onSurface`). */
  id: string;
  /** Slope in degrees around (x, z). */
  slope(x: number, z: number): number;
}

/** Options of {@link estateGround}. */
export interface EstateOptions {
  /** Terrain edge length in metres. */
  size: number;
  /** Relief of the surrounding hills in metres. */
  relief: number;
  /** Level plot: centre x, centre z, radius. */
  pad: readonly [number, number, number];
  /** Optional lake basin: centre x, centre z, radius, depth below the shore. */
  lake?: readonly [number, number, number, number];
  /** Optional level lane (a drive) from the plot centre: far end x, z and half width. */
  lane?: readonly [number, number, number];
  color: string;
  roughness?: number;
  resolution?: number;
  name?: string;
}

/**
 * A real landscape for a house: the `terrain` generator's estate variant (level plot, meadow swells, hills that close
 * the horizon, optional lake basin) placed so the plot sits at y = 0 and the building needs no change. The world's
 * flat ground plane should be switched off by the caller (`ground: null`).
 */
export function estateGround(b: Builder, seed: number, o: EstateOptions): EstateGround {
  const params: Record<string, Json> = {
    size: o.size,
    height: o.relief,
    resolution: o.resolution ?? 224,
    roughness: o.roughness ?? 0.55,
    color: o.color,
    variant: 5,
    padX: o.pad[0],
    padZ: o.pad[1],
    padRadius: o.pad[2],
    ...(o.lake ? { lakeX: o.lake[0], lakeZ: o.lake[1], lakeRadius: o.lake[2], lakeDepth: o.lake[3] } : {}),
    ...(o.lane ? { laneX: o.lane[0], laneZ: o.lane[1], laneRadius: o.lane[2] } : {}),
  };
  const raw = terrainHeight(params, seed, o.size);
  const base = raw(o.pad[0], o.pad[1]);
  const id = b.add({
    id: b.id('landscape'),
    name: o.name ?? 'Landscape',
    shape: { kind: 'procedural', generator: 'terrain', params, seed },
    transform: { position: [0, r2(-base), 0] },
    physics: { body: 'static', friction: 0.9 },
    tags: ['terrain'],
  });
  const h = (x: number, z: number): number => r2(raw(x, z) - base);
  const slope = (x: number, z: number): number => (Math.atan(Math.hypot((h(x + 1.2, z) - h(x - 1.2, z)) / 2.4, (h(x, z + 1.2) - h(x, z - 1.2)) / 2.4)) * 180) / Math.PI;
  return { h, id, slope };
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

/** Options of {@link roadRibbon}. */
export interface RoadRibbonOptions {
  /** Entity id of the road (the curbs are `<id>-curbs`). */
  id: string;
  name?: string;
  /** The closed centre line as (x, z) points (any spacing); it is smoothed, so a coarse polygon becomes round bends. */
  loop: ReadonlyArray<readonly [number, number]>;
  /** Asphalt width in metres. */
  width: number;
  /** Height above the ground (default 0.03). */
  lift?: number;
  /** Distance between cross-sections (default 1 m). */
  step?: number;
  /** Asphalt tint and the darker rubbered racing line (default `#4f4e4d` / `#34322f`). */
  asphalt?: string;
  line?: string;
  /** Half width of the racing line (default 1.7). */
  lineHalf?: number;
  /** Curb width and its two alternating colours (default 0.7 m, red and white). */
  curbWidth?: number;
  curbColors?: readonly [string, string];
  /** Length of one curb stripe (default 2.4 m, adjusted so the stripes close around the loop). */
  curbRun?: number;
  tags?: string[];
}

/** Closed Chaikin corner cutting. */
function chaikinClosed(pts: ReadonlyArray<readonly [number, number]>, rounds: number): Array<[number, number]> {
  let cur: Array<[number, number]> = pts.map((p) => [p[0], p[1]]);
  for (let r = 0; r < rounds; r++) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i] as [number, number];
      const c = cur[(i + 1) % cur.length] as [number, number];
      next.push([a[0] * 0.75 + c[0] * 0.25, a[1] * 0.75 + c[1] * 0.25], [a[0] * 0.25 + c[0] * 0.75, a[1] * 0.25 + c[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
}

/**
 * A race circuit as two meshes instead of a row of boxes: one continuous asphalt strip (mitred through every bend, with the
 * rubbered racing line blended into its middle) and one strip of red/white curbs whose stripes start and end exactly and close
 * around the loop. A row of boxes leaves wedges of ground open at every bend and a seam at every joint. Visual only (the terrain
 * carries the kart). Returns the road and curb entity ids.
 */
export function roadRibbon(b: Builder, o: RoadRibbonOptions): { road: string; curbs: string } {
  const lift = o.lift ?? 0.03;
  const step = o.step ?? 1;
  const asphalt = srgb(o.asphalt ?? '#4f4e4d');
  const line = srgb(o.line ?? '#34322f');
  const lineHalf = o.lineHalf ?? 1.7;
  const curbW = o.curbWidth ?? 0.7;
  const curbCols = (o.curbColors ?? ['#d7263d', '#f5f3ee']).map(srgb);
  const half = o.width / 2;
  const pts = chaikinClosed(o.loop, 3);
  const cum: number[] = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as [number, number];
    const c = pts[(i + 1) % pts.length] as [number, number];
    cum.push((cum[i] as number) + Math.hypot(c[0] - a[0], c[1] - a[1]));
  }
  const total = cum[cum.length - 1] as number;
  /** Point and unit tangent at distance d along the closed loop. */
  const at = (d0: number): { x: number; z: number; tx: number; tz: number } => {
    const d = ((d0 % total) + total) % total;
    let lo = 0;
    let hi = pts.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((cum[mid] as number) <= d) lo = mid;
      else hi = mid;
    }
    const a = pts[lo] as [number, number];
    const c = pts[(lo + 1) % pts.length] as [number, number];
    const len = (cum[lo + 1] as number) - (cum[lo] as number) || 1;
    const t = (d - (cum[lo] as number)) / len;
    return { x: a[0] + (c[0] - a[0]) * t, z: a[1] + (c[1] - a[1]) * t, tx: (c[0] - a[0]) / len, tz: (c[1] - a[1]) / len };
  };
  // Road: even rows around the loop (the last row repeats the first so the strip closes).
  const rows = Math.max(8, Math.round(total / step));
  const offsets = [-half, -lineHalf, -lineHalf * 0.55, lineHalf * 0.55, lineHalf, half];
  const tones = [asphalt, asphalt, line, line, asphalt, asphalt];
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const d = (r / rows) * total;
    const p = at(d);
    // Look a little ahead and behind for the tangent so the mitre is smooth through the bend.
    const f = at(d + 1.2);
    const bk = at(d - 1.2);
    let tx = f.x - bk.x;
    let tz = f.z - bk.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz;
    const nz = tx;
    offsets.forEach((off, j) => {
      pos.push(p.x + nx * off, lift, p.z + nz * off);
      const tone = tones[j] as [number, number, number];
      const grain = 0.9 + 0.1 * Math.sin(d * 1.3 + j * 2.1) * Math.sin(d * 0.37);
      col.push(tone[0] * grain, tone[1] * grain, tone[2] * grain);
      uv.push(off / 3, d / 3);
    });
  }
  const W = offsets.length;
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j + 1 < W; j++) {
      const a = r * W + j;
      const c = a + W;
      // Seen from above: along the path, across its left normal.
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const roadMat: MaterialSpec = { finish: 'asphalt', roughness: 0.8 };
  const roadMesh = `${o.id}-mesh`;
  b.mesh(encodeMesh(roadMesh, { positions: new Float32Array(pos), indices: new Uint32Array(idx), colors: new Float32Array(col), uvs: new Float32Array(uv), faceMaterials: null }, { materials: [roadMat] }));
  b.add({ id: o.id, name: o.name ?? 'Road', shape: { kind: 'mesh', mesh: roadMesh }, transform: { position: [0, 0, 0] }, castShadow: false, ...(o.tags ? { tags: o.tags } : {}) });

  // Curbs: whole stripes, each its own little strip, so every stripe has a clean edge.
  const stripes = 2 * Math.max(1, Math.round(total / (2 * (o.curbRun ?? 2.4))));
  const stripeLen = total / stripes;
  const cpos: number[] = [];
  const ccol: number[] = [];
  const cuv: number[] = [];
  const cidx: number[] = [];
  const cOff = [-half - curbW, -half, half, half + curbW];
  const sub = Math.max(1, Math.ceil(stripeLen / 1.2));
  for (let s = 0; s < stripes; s++) {
    const tone = curbCols[s % 2] as [number, number, number];
    const base = cpos.length / 3;
    for (let m = 0; m <= sub; m++) {
      const d = s * stripeLen + (m / sub) * stripeLen;
      const p = at(d);
      const f = at(d + 1.2);
      const bk = at(d - 1.2);
      let tx = f.x - bk.x;
      let tz = f.z - bk.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const nx = -tz;
      const nz = tx;
      cOff.forEach((off, j) => {
        cpos.push(p.x + nx * off, lift + 0.035, p.z + nz * off);
        ccol.push(tone[0], tone[1], tone[2]);
        cuv.push(j, m);
      });
    }
    for (let m = 0; m < sub; m++) {
      for (const j of [0, 2]) {
        const a = base + m * 4 + j;
        const c = a + 4;
        cidx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
  }
  const curbMat: MaterialSpec = { preset: 'plastic', roughness: 0.6 };
  const curbMesh = `${o.id}-curbs-mesh`;
  b.mesh(encodeMesh(curbMesh, { positions: new Float32Array(cpos), indices: new Uint32Array(cidx), colors: new Float32Array(ccol), uvs: new Float32Array(cuv), faceMaterials: null }, { materials: [curbMat] }));
  b.add({ id: `${o.id}-curbs`, name: 'Curbs', shape: { kind: 'mesh', mesh: curbMesh }, transform: { position: [0, 0, 0] }, castShadow: false, ...(o.tags ? { tags: o.tags } : {}) });
  return { road: o.id, curbs: `${o.id}-curbs` };
}

/** Options of {@link planetMesh}. */
export interface PlanetMeshOptions {
  id: string;
  name?: string;
  /** Centre in world space and radius in metres. */
  center: V3;
  radius: number;
  /** Seed of the continents and clouds. */
  seed: number;
  /** Icosphere subdivision (default 5: about 10 000 vertices). */
  detail?: number;
  tags?: string[];
}

/** Deterministic lattice hash in [0, 1). */
function latticeHash(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(iz | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 3D value noise in [0, 1). */
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const h = (dx: number, dy: number, dz: number): number => latticeHash(ix + dx, iy + dy, iz + dz, seed);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), sx), lerp(h(0, 1, 0), h(1, 1, 0), sx), sy),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), sx), lerp(h(0, 1, 1), h(1, 1, 1), sx), sy),
    sz,
  );
}

function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * f, y * f, z * f, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2.02;
  }
  return sum / norm;
}

/**
 * A planet as one painted mesh: an icosphere whose vertex colours carry ocean depth, continents, ice caps and a cloud layer
 * (noise on the unit sphere, so there is no seam and no texture to stretch over a 500 m ball). Backdrop only: no collider.
 */
export function planetMesh(b: Builder, o: PlanetMeshOptions): string {
  const level = Math.max(2, Math.min(5, o.detail ?? 5));
  // Icosahedron, subdivided with a midpoint cache.
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => {
    const l = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
    return [(v[0] as number) / l, (v[1] as number) / l, (v[2] as number) / l] as V3;
  });
  let faces: Array<[number, number, number]> = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < level; s++) {
    const cache = new Map<number, number>();
    const mid = (a: number, c: number): number => {
      const key = a < c ? a * 100003 + c : c * 100003 + a;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const p = verts[a] as V3;
      const q = verts[c] as V3;
      const m: V3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      const l = Math.hypot(m[0], m[1], m[2]);
      verts.push([m[0] / l, m[1] / l, m[2] / l]);
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next: Array<[number, number, number]> = [];
    for (const [a, c, d] of faces) {
      const ab = mid(a, c);
      const cd = mid(c, d);
      const da = mid(d, a);
      next.push([a, ab, da], [c, cd, ab], [d, da, cd], [ab, cd, da]);
    }
    faces = next;
  }
  const lin = (hex: string): [number, number, number] => srgb(hex);
  const deep = lin('#0d2f6b');
  const shallow = lin('#2b72b8');
  const grass = lin('#4a7a3a');
  const dry = lin('#a28d58');
  const rock = lin('#6f675e');
  const ice = lin('#eef3f7');
  const cloud = lin('#fbfcff');
  const mixc = (a: [number, number, number], c: [number, number, number], k: number): [number, number, number] => [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k];
  const positions = new Float32Array(verts.length * 3);
  const colors = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => {
    positions[i * 3] = v[0] * o.radius;
    positions[i * 3 + 1] = v[1] * o.radius;
    positions[i * 3 + 2] = v[2] * o.radius;
    // Slightly more land than ocean-only noise would give, so a view of the planet shows coast and continent, not just sea.
    const land = fbm3(v[0] * 2.1 + 5, v[1] * 2.1, v[2] * 2.1, o.seed, 6) + 0.06;
    let c: [number, number, number];
    if (land < 0.5) c = mixc(deep, shallow, Math.min(1, Math.max(0, (land - 0.3) / 0.2)));
    else if (land < 0.53) c = mixc(shallow, dry, (land - 0.5) / 0.03);
    else if (land < 0.62) c = mixc(grass, dry, Math.min(1, Math.max(0, (land - 0.53) / 0.09 + 0.25 * (fbm3(v[0] * 9, v[1] * 9, v[2] * 9, o.seed + 7, 3) - 0.5))));
    else c = mixc(dry, rock, Math.min(1, (land - 0.62) / 0.1));
    const lat = Math.abs(v[1]);
    const iceK = Math.min(1, Math.max(0, (lat - 0.82) / 0.1 + 0.4 * (fbm3(v[0] * 6, v[1] * 6, v[2] * 6, o.seed + 3, 3) - 0.5)));
    c = mixc(c, ice, iceK);
    const cl = fbm3(v[0] * 3.2 + 11, v[1] * 3.6, v[2] * 3.2 - 4, o.seed + 19, 5);
    const clK = Math.min(0.9, Math.max(0, (cl - 0.5) / 0.14));
    c = mixc(c, cloud, clK);
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  });
  const indices = new Uint32Array(faces.length * 3);
  faces.forEach((f, i) => {
    indices[i * 3] = f[0];
    indices[i * 3 + 1] = f[1];
    indices[i * 3 + 2] = f[2];
  });
  const meshId = `${o.id}-mesh`;
  b.mesh(encodeMesh(meshId, { positions, indices, colors, uvs: null, faceMaterials: null }, { materials: [{ preset: 'plastic', roughness: 0.85 }] }));
  b.add({ id: o.id, name: o.name ?? 'Planet', shape: { kind: 'mesh', mesh: meshId }, transform: { position: [o.center[0], o.center[1], o.center[2]] }, castShadow: false, tags: o.tags ?? ['backdrop'] });
  return o.id;
}

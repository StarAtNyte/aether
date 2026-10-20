/**
 * Reusable scene-dressing helpers for the mock planner themes: orientation
 * math, tree rings, scatter belts, backdrop mountains, lamps, paths.
 * Built-in generators follow procgen conventions: base at y=0, centered,
 * long axis / facing along +X (cars, boats, walls, fences, docks, ramps).
 */
import { streamCourse, type Json } from '@aether/core';
import { r2, type Builder, type ScatterOpts } from './builder';
import { estateGround, grove, groundRibbon, landPoints } from './showcase/kit';

/** Theme placement context: origin of the theme and the radius it must keep clear. */
export interface ThemeCtx {
  b: Builder;
  x: number;
  z: number;
  /** Radius around (x, z) reserved for an activity; settings place nothing inside. */
  clear: number;
  /** True for the main setting (owns the environment and backdrop). */
  primary: boolean;
  /** A count the user asked for ("collect 12 coins"), when any. */
  count?: number;
  /** A time limit the user asked for, in seconds ("in 60 seconds"), when any. */
  seconds?: number;
  /** Ids of every activity named in the request (lets one activity adapt to another). */
  with?: ReadonlySet<string>;
  /** The normalized request text (for small wording-driven touches). */
  request?: string;
}

const DEG = 180 / Math.PI;

/**
 * Bearing (degrees, 0 = +Z) from the world origin toward the default
 * three-quarter camera. Mirrors the renderer's `DEFAULT_FRAMING_AZIMUTH`.
 */
export const VIEW_BEARING = 28;
/** Half-width (degrees) of the tree-free view corridor toward the camera. */
export const VIEW_CORRIDOR_HALF_ANGLE = 26;
/** The corridor starts this far from the origin (closer trees are part of the set). */
export const VIEW_CORRIDOR_START = 10;

/**
 * True when (x, z) lies in the corridor between the scene and the default
 * camera. Trees there would fill the foreground with dark silhouettes, so
 * tree rings and forest belts leave it open (it reads as a trail or a clearing).
 */
export function inViewCorridor(x: number, z: number): boolean {
  if (Math.hypot(x, z) < VIEW_CORRIDOR_START) return false;
  const bearing = Math.atan2(x, z) * DEG;
  const diff = Math.abs(((bearing - VIEW_BEARING + 540) % 360) - 180);
  return diff < VIEW_CORRIDOR_HALF_ANGLE;
}

/** Yaw (degrees) that turns a +Z-facing object at (fx, fz) toward (tx, tz). */
export function yawFacingZ(fx: number, fz: number, tx: number, tz: number): number {
  return r2(Math.atan2(tx - fx, tz - fz) * DEG);
}

/** Yaw (degrees) that turns a +X-facing object (car, boat, wall) along direction (dx, dz). */
export function yawAlongX(dx: number, dz: number): number {
  return r2(Math.atan2(-dz, dx) * DEG);
}

/** Night or dusk: lights should be on. */
export function lightsOn(b: Builder): boolean {
  return b.mood.night || b.mood.dusk;
}

/** Individual static trees in an annulus around the context origin. */
export function treeRing(c: ThemeCtx, count: number, inner: number, outer: number, kinds: ReadonlyArray<{ generator: string; params: Record<string, Json> }>, footprint = 1.8): number {
  let placed = 0;
  const lo = Math.max(inner, c.clear + footprint);
  if (lo >= outer) return 0;
  for (let i = 0; i < count; i++) {
    const p = c.b.spot(c.x, c.z, lo, outer, footprint);
    if (!p || inViewCorridor(p[0], p[1])) continue;
    const kind = c.b.pick(kinds);
    const params: Record<string, Json> = { ...kind.params };
    if (typeof params['height'] === 'number') params['height'] = r2((params['height'] as number) * c.b.rand(0.75, 1.3));
    c.b.gen(kind.generator.startsWith('tree-') ? 'tree' : kind.generator, kind.generator, params, [p[0], 0, p[1]], { yaw: r2(c.b.rand(0, 360)), physics: 'static', tags: ['tree'] });
    placed++;
  }
  return placed;
}

/**
 * Decorative scatter patches (no physics) tiling a ring [inner, outer] so the
 * cleared center stays empty. `perPatch` instances per patch.
 */
export function scatterBelt(c: ThemeCtx, base: string, generator: string, params: Record<string, Json>, perPatch: number, inner: number, outer: number, opts: { scaleRange?: [number, number]; minSpacing?: number; tags?: string[] } = {}): void {
  const lo = Math.max(inner, c.clear);
  if (outer - lo < 2) return;
  const side = r2((outer - lo) * 0.65);
  const mid = lo + (outer - lo) / 2;
  const patches = Math.max(3, Math.min(10, Math.round((2 * Math.PI * mid) / (side * 1.6))));
  const offset = c.b.rand(0, Math.PI * 2);
  for (let i = 0; i < patches; i++) {
    const a = offset + (i / patches) * Math.PI * 2;
    const px = r2(c.x + Math.cos(a) * mid);
    const pz = r2(c.z + Math.sin(a) * mid);
    if (c.b.touchesKeepClear(px, pz, side / 2)) continue;
    if (generator.startsWith('tree') && inViewCorridor(px, pz)) continue;
    const o: ScatterOpts = { castShadow: generator.startsWith('tree') };
    if (opts.scaleRange) o.scaleRange = opts.scaleRange;
    if (opts.minSpacing !== undefined) o.minSpacing = opts.minSpacing;
    if (opts.tags) o.tags = opts.tags;
    c.b.scatter(base, generator, params, perPatch, [side, side], [px, 0, pz], o);
  }
}

/** Color of the pending world ground ("#rrggbb"), when the environment sets one. */
export function groundColor(b: Builder): string | undefined {
  const ground = b.envValue('ground');
  if (!ground || typeof ground !== 'object' || Array.isArray(ground)) return undefined;
  const material = (ground as Record<string, Json>)['material'];
  if (!material || typeof material !== 'object' || Array.isArray(material)) return undefined;
  const color = (material as Record<string, Json>)['color'];
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

/** Ring of distant mountains framing the scene (no physics: unreachable). Foothills take the ground color. */
export function backdropMountains(c: ThemeCtx, count: number, color: string, snowLine: number, radius = 110, height = 30): void {
  // A landscape closes the horizon with its own hills.
  if (c.b.ground) return;
  const offset = c.b.rand(0, Math.PI * 2);
  const foot = groundColor(c.b);
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2 + c.b.rand(-0.25, 0.25);
    const d = radius * c.b.rand(0.9, 1.15);
    c.b.gen('mountain', 'mountain', { size: r2(c.b.rand(60, 90)), height: r2(height * c.b.rand(0.7, 1.3)), color, snowLine, ...(foot ? { groundColor: foot } : {}) }, [r2(c.x + Math.cos(a) * d), 0, r2(c.z + Math.sin(a) * d)], { yaw: r2(c.b.rand(0, 360)), tags: ['backdrop'] });
  }
}

/** Options of {@link naturalGround}. */
export interface NaturalGroundOptions {
  /** Radius of the level plot round the theme's origin (activities that need flat ground stand in it). */
  pad: number;
  /** Relief of the hills that close the horizon in metres (default 48). */
  relief?: number;
  /** Grass colour of the land (default: the theme's ground colour). */
  color?: string;
  /** Terrain edge length in metres (default 420). */
  size?: number;
  /** A stream across the land along X: mean z, half width, bend amplitude, depth (metres). */
  stream?: { z: number; half: number; bend?: number; depth?: number };
  /** A lake basin with water: centre, radius and depth (metres). */
  lake?: { x: number; z: number; radius: number; depth?: number };
  /** Woods on the slopes beyond the plot (counts; 0 leaves a kind out). */
  woods?: { conifers?: number; broadleaf?: number; birch?: number; scrub?: number; boulders?: number };
  /** Snow on the boughs of the spruce woods. */
  snow?: boolean;
  /** Spruce colour and height, broadleaf colour (defaults: a temperate forest). */
  conifer?: { color?: string; height?: number };
  broadleafColor?: string;
  /** Broadleaf woods stand bare (winter, a haunted hollow). */
  bare?: boolean;
}

/**
 * A real landscape under a natural setting in place of the flat ground plane: the `terrain` generator's estate variant
 * (a level plot of `pad` metres round the theme's origin, meadow swells beyond it and hills that close the horizon),
 * an optional stream carved across it with flowing water, and woods of the leaf-card trees on the slopes. The builder's
 * {@link Builder.ground} is set, so everything placed afterwards stands on the land and scatter layers drape over it.
 * Primary settings with realistic nature only; returns whether it was built.
 */
export function naturalGround(c: ThemeCtx, o: NaturalGroundOptions): boolean {
  const b = c.b;
  if (!c.primary || !b.realisticNature || b.ground) return false;
  const color = o.color ?? groundColor(b) ?? '#6a9a45';
  const size = o.size ?? 420;
  b.env({ ground: null });
  const st = o.stream;
  const land = estateGround(b, (b.seed ^ 0x51ed) >>> 0, {
    size,
    relief: o.relief ?? 48,
    resolution: 256,
    pad: [c.x, c.z, o.pad],
    color,
    roughness: 0.5,
    name: 'Landscape',
    ...(st ? { stream: [st.half, st.z, st.bend ?? 5, st.depth ?? 1.4] as const } : {}),
    ...(o.snow ? { snowCover: 0.95 } : {}),
    ...(o.lake ? { lake: [o.lake.x, o.lake.z, o.lake.radius, o.lake.depth ?? 2.5] as const } : {}),
  });
  if (o.lake) {
    const lk = o.lake;
    const waterY = r2(-Math.min(0.6, (lk.depth ?? 2.5) * 0.15));
    b.prim('lake', 'cylinder', [r2(lk.radius * 2.5), 0.08, r2(lk.radius * 2.5)], [lk.x, waterY, lk.z], { name: 'Lake', absolute: true, material: { preset: 'water', waterKind: 'lake', color: '#4f7f99', opacity: 0.9, roughness: 0.03 }, castShadow: false, tags: ['water', 'lake'] });
    b.reserve(lk.x, lk.z, lk.radius + 1);
    b.keepClear(lk.x, lk.z, lk.radius + 0.8);
  }
  b.ground = { h: land.h, surface: land.id };
  if (st) {
    const depth = st.depth ?? 1.4;
    const waterY = r2(-depth * 0.5);
    const course = (x: number): number => streamCourse(x, st.z, st.bend ?? 5);
    b.stream = { z: course, half: st.half, waterY };
    b.prim('stream', 'plane', [size, 0.1, size], [0, waterY, 0], {
      name: 'Stream',
      absolute: true,
      material: { preset: 'water', waterKind: 'stream', waterFlow: [0.8, 0], color: '#4f7f8c', opacity: 0.85, roughness: 0.05 },
      castShadow: false,
      tags: ['water', 'river'],
    });
    // Nothing stands or grows in the water: reserve the channel and keep ground cover out of it.
    for (let x = -size / 2; x <= size / 2; x += 2) {
      const z = course(x);
      b.reserve(x, z, st.half + 1.6);
      b.keepClear(x, z, st.half + 0.6);
    }
  }
  const woods = o.woods ?? {};
  const wooded = (minD: number) => (x: number, z: number): boolean => Math.hypot(x - c.x, z - c.z) > minD && land.slope(x, z) < 30 && (!b.stream || Math.abs(z - b.stream.z(x)) > b.stream.half + 3) && (!o.lake || Math.hypot(x - o.lake.x, z - o.lake.z) > o.lake.radius * 1.3 + 2);
  const half = size / 2 - 20;
  const spruce: Record<string, Json> = { height: o.conifer?.height ?? 14, detail: 0.5, color: o.conifer?.color ?? '#2f4f32', ...(o.snow ? { snow: 0.8 } : {}) };
  if ((woods.conifers ?? 150) > 0) grove(b, 'woods-spruce', 'Spruce woods', 'tree-spruce', spruce, landPoints(b, woods.conifers ?? 150, half, wooded(o.pad + 12), 6, land.h), [0.75, 1.35], land.id, size);
  if ((woods.broadleaf ?? 110) > 0) grove(b, 'woods-oak', 'Broadleaf woods', 'tree-broadleaf', { height: 10, detail: 0.5, color: o.broadleafColor ?? '#4f7a34', variant: 1, ...(o.bare ? { leaf: 0 } : {}) }, landPoints(b, woods.broadleaf ?? 110, half, wooded(o.pad + 8), 7, land.h), [0.8, 1.3], land.id, size);
  if ((woods.birch ?? 0) > 0) grove(b, 'woods-birch', 'Birches', 'tree-birch', { height: 8.5, detail: 0.6 }, landPoints(b, woods.birch ?? 0, half * 0.6, wooded(o.pad + 4), 5, land.h), [0.8, 1.2], land.id, size);
  if ((woods.scrub ?? 240) > 0) grove(b, 'scrub', 'Scrub', 'shrub', { size: 1.4, detail: 0.6, color: '#587a3c' }, landPoints(b, woods.scrub ?? 240, half * 0.8, wooded(o.pad + 3), 2.6, land.h), [0.7, 1.5], land.id, size);
  if ((woods.boulders ?? 40) > 0) grove(b, 'boulders', 'Boulders', 'boulder', { size: 1.6, lichen: 0.35, variant: 0 }, landPoints(b, woods.boulders ?? 40, half * 0.7, wooded(o.pad + 2), 4, land.h), [0.5, 1.6], land.id, size);
  return true;
}

/**
 * A real landscape for a setting that stands on level ground (a village, a castle): {@link naturalGround} with a level
 * plot of `pad` metres and wooded hills, in place of the ring of blob mountains and the flat green field (these two
 * settings always build it, whatever the nature style). Returns whether it was built.
 */
export function hillside(c: ThemeCtx, o: { pad: number; relief?: number; color?: string; conifers?: number; broadleaf?: number }): boolean {
  if (!c.primary) return false;
  const b = c.b;
  const was = b.realisticNature;
  b.realisticNature = true;
  const built = naturalGround(c, { pad: o.pad, relief: o.relief ?? 64, size: 520, ...(o.color ? { color: o.color } : {}), woods: { conifers: o.conifers ?? 150, broadleaf: o.broadleaf ?? 120, scrub: 260, boulders: 0 } });
  b.realisticNature = was;
  return built;
}

/** Inner and outer radius (m) of the cloud ring: beyond the set, where the camera never flies. */
export const CLOUD_RING: readonly [number, number] = Object.freeze([80, 150]) as readonly [number, number];
/** Cloud altitude range (m): above any framing camera, low enough to show above the horizon. */
export const CLOUD_ALTITUDE: readonly [number, number] = Object.freeze([46, 70]) as readonly [number, number];

/** Drifting clouds on a distant ring high above the scene (a sky backdrop, never in the camera's way). */
export function clouds(c: ThemeCtx, count: number, color = '#ffffff'): void {
  const offset = c.b.rand(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    // Spread around the ring (with jitter) so a few always sit behind the content.
    const a = offset + (i / Math.max(1, count)) * Math.PI * 2 + c.b.rand(-0.4, 0.4);
    const d = c.b.rand(CLOUD_RING[0], CLOUD_RING[1]);
    c.b.gen('cloud', 'cloud', { size: r2(c.b.rand(18, 30)), color, variant: c.b.chance(0.3) ? 1 : 0 }, [r2(c.x + Math.cos(a) * d), r2(c.b.rand(CLOUD_ALTITUDE[0], CLOUD_ALTITUDE[1])), r2(c.z + Math.sin(a) * d)], {
      // Daylight clouds scatter light through: a little self-illumination keeps their shaded side soft.
      ...(lightsOn(c.b) ? {} : { material: { emissive: color, emissiveIntensity: 0.3 } }),
      castShadow: false,
      tags: ['sky'],
      behaviors: [{ type: 'bob', params: { amplitude: 0.6, period: r2(c.b.rand(6, 10)) } }],
    });
  }
}

/** Lamp post with a real light when it is dark (or when `lit`). Returns the lamp id. */
export function lamp(b: Builder, x: number, z: number, color = '#ffd27a', height = 3.5, lit = lightsOn(b)): string {
  const id = b.gen('lamp-post', 'lamp-post', { height, lightColor: color }, [x, 0, z], { physics: 'static', tags: ['lamp'], footprint: 0.6 });
  if (lit) b.light(id, [0, r2(height - 0.3), 0], color, 2.5, 14);
  return id;
}

/** Flat path strip (decal-like thin box) from (x1, z1) to (x2, z2). */
export function path(b: Builder, x1: number, z1: number, x2: number, z2: number, width: number, color: string, preset: 'dirt' | 'stone' | 'concrete' | 'sand' | 'wood' = 'dirt'): string {
  if (b.realisticNature) {
    // A worn strip draped over the ground with soft verges, not a box laid on the lawn.
    const finish = preset === 'stone' || preset === 'concrete' ? 'cobble' : preset === 'sand' ? 'sand' : preset === 'wood' ? 'decking' : 'soil';
    return groundRibbon(b, { id: b.id('path'), name: 'Path', paths: [[[x1, z1], [r2((x1 + x2) / 2 + (z2 - z1) * 0.06), r2((z1 + z2) / 2 - (x2 - x1) * 0.06)], [x2, z2]]], height: (x, z) => b.groundAt(x, z), width, lift: 0.04, centre: color, edge: shadeHex(color, -0.25), material: { finish, roughness: 0.95 }, tags: ['path'], taper: true });
  }
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  return b.prim('path', 'box', [r2(width), 0.04, r2(len)], [r2((x1 + x2) / 2), 0.02, r2((z1 + z2) / 2)], {
    yaw: yawFacingZ(x1, z1, x2, z2),
    material: { preset, color, roughness: 0.95 },
    castShadow: false,
  });
}

/** `hex` darker (amount < 0) or lighter (amount > 0) by a fraction, "#rrggbb". */
export function shadeHex(hex: string, amount: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Small glowing lantern on a post (a warm point light when it is dark). */
export function lantern(b: Builder, x: number, z: number, color = '#ffb35c'): string {
  const post = b.prim('lantern-post', 'cylinder', [0.1, 1.3, 0.1], [x, 0.65, z], { material: { preset: 'wood', color: '#4a3424' }, physics: 'static', footprint: 0.4 });
  b.prim(`${post}-lamp`, 'box', [0.28, 0.34, 0.28], [0, 0.8, 0], { parent: post, material: { preset: 'emissive', color, emissive: color, emissiveIntensity: lightsOn(b) ? 3 : 0.6 }, castShadow: false });
  if (lightsOn(b)) b.light(post, [0, 0.9, 0], color, 1.6, 9);
  return post;
}

/** A lake (flat water disc) with a reed fringe, a little jetty and a rowboat. Returns the lake id. */
export function lake(b: Builder, x: number, z: number, radius: number): string {
  const id = b.prim('lake', 'cylinder', [r2(radius * 2), 0.08, r2(radius * 2)], [x, 0.04, z], { name: 'Lake', material: { preset: 'water', waterKind: 'lake', color: '#2f7fae', opacity: 0.88, roughness: 0.04 }, castShadow: false, tags: ['water'] });
  b.prim(`${id}-shore`, 'cylinder', [r2(radius * 2 + 2.2), 0.05, r2(radius * 2 + 2.2)], [x, 0.025, z], { material: { preset: 'sand', color: '#b9a57a' }, castShadow: false });
  b.reserve(x, z, radius + 1);
  b.keepClear(x, z, radius + 0.5);
  // Reed clumps around the rim (never on the water).
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + b.rand(-0.2, 0.2);
    const d = radius + 0.6;
    b.scatter('reeds', 'grass-tuft', { color: '#6f8f3a', size: 1.1 }, 7, [2.4, 2.4], [r2(x + Math.cos(a) * d), 0, r2(z + Math.sin(a) * d)], { minSpacing: 0.4, scaleRange: [0.9, 1.6] });
  }
  const jx = r2(x + radius * 0.35);
  const jz = r2(z + radius * 0.8);
  b.gen('jetty', 'dock', { length: r2(radius * 0.7), width: 1.6, height: 0.5 }, [jx, 0, jz], { yaw: 90, physics: 'static', name: 'Jetty' });
  b.gen('rowboat', 'boat', { length: 3.2, variant: 0, color: '#8a5a3a' }, [r2(x - radius * 0.3), 0.05, r2(z + radius * 0.1)], { yaw: 35, behaviors: [{ type: 'bob', params: { amplitude: 0.06, period: 3.4 } }], name: 'Rowboat' });
  return id;
}

/** Campfire with a flickering light. */
export function campfire(b: Builder, x: number, z: number): string {
  const id = b.gen('campfire', 'campfire', { size: 1.2 }, [x, 0, z], { physics: 'static', footprint: 2.2, name: 'Campfire', tags: ['focus', 'fire'] });
  b.light(id, [0, 0.8, 0], '#ff8a3d', 3, 12, [{ type: 'pulseLight', params: { min: 2, max: 3.6, period: 0.35 } }]);
  return id;
}

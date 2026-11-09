/**
 * Deterministic world builder used by the offline mock planner.
 *
 * Collects patches in a canonical order (meta, environment, player, entities,
 * state, HUD, rules, tests), hands out unique slug ids, and keeps a simple
 * occupancy map of footprint circles so generated objects do not overlap.
 */
import { rng, slugify, type EntityInput, type MeshAssetInput, type Json, type PatchInput, type RuleInput, type WorldTest } from '@aether/core';
import type { z } from 'zod';
import { realisticStandIn } from './realistic';
import { CLUSTERED_GENERATORS, clusterPoints } from './cluster';
import { PLINTH_MATERIAL, isSettleable, settleBounds, settleOnTerrain } from '../../settle-core';

/** Input shape of a world test (defaults optional). */
export type WorldTestInput = z.input<typeof WorldTest>;

/** Mutable 3-vector. */
export type V3 = [number, number, number];

/** Global mood flags derived from the request (affect lights and colors). */
export interface Mood {
  night: boolean;
  dusk: boolean;
  dawn: boolean;
  rain: boolean;
  snow: boolean;
  fog: boolean;
  lowGravity: boolean;
  /** The request mentions open water (lakeside, by the river, pond…). */
  water: boolean;
}

/** Physics shorthand accepted by {@link Builder} helpers. */
export type PhysicsOpt = 'static' | 'dynamic' | 'kinematic' | NonNullable<EntityInput['physics']>;

/** Optional entity fields for the helper constructors. */
export interface PlaceOpts {
  name?: string;
  description?: string;
  tags?: string[];
  /** Yaw in degrees (ignored when `rot` is given). */
  yaw?: number;
  rot?: V3;
  scale?: number | V3;
  physics?: PhysicsOpt;
  material?: EntityInput['material'];
  behaviors?: EntityInput['behaviors'];
  light?: EntityInput['light'];
  joint?: EntityInput['joint'];
  state?: Record<string, Json>;
  /** An intelligent character (see the NPC schema in @aether/core). */
  npc?: EntityInput['npc'];
  /** A person's look (a cast member shown instead of the shape; see `character-schema.ts`). */
  character?: EntityInput['character'];
  parent?: string;
  visible?: boolean;
  castShadow?: boolean;
  template?: boolean;
  /** Footprint radius to reserve in the occupancy map (0 = none). */
  footprint?: number;
  /** Keep `y` absolute even when the scene stands on a landscape ({@link Builder.ground}); default: y is above the ground. */
  absolute?: boolean;
  /**
   * A building or structure stands on terrain by its whole footprint (default `'terrain'` whenever the builder has a
   * landscape or `terrain` is given): its base is set on the highest ground under the footprint and a stone plinth fills
   * the slope below it, so it is neither buried on the uphill side nor hanging on the downhill side. `'flat'` keeps `y` as given.
   */
  ground?: 'terrain' | 'flat';
  /** Ground height at (x, z) for a builder with no landscape of its own ({@link Builder.ground}): hand-placed worlds on a terrain they sampled. */
  terrain?: (x: number, z: number) => number;
}

/** Extra options of scatter entities. */
export interface ScatterOpts extends PlaceOpts {
  scaleRange?: [number, number];
  minSpacing?: number;
  randomYaw?: boolean;
  /** Terrain entity id to place the instances on. */
  onSurface?: string;
  /** World ground height at (x, z): clustered points are set on it (relative to the layer's own y). */
  heightAt?: (x: number, z: number) => number;
}

/**
 * `count` points spread evenly (a jittered grid) in a `width`×`depth` box centred on the origin, deterministic; with
 * `minSpacing` the grid is no finer than that.
 */
export function jitteredPoints(count: number, width: number, depth: number, seed: number, minSpacing = 0): Array<[number, number, number]> {
  const n = Math.max(0, Math.min(20_000, Math.floor(count)));
  if (n === 0 || !(width > 0) || !(depth > 0)) return [];
  const random = rng((seed ^ 0x9e3779b9) >>> 0);
  let cell = Math.sqrt((width * depth) / n);
  if (minSpacing > cell) cell = minSpacing;
  const cols = Math.max(1, Math.floor(width / cell));
  const rows = Math.max(1, Math.floor(depth / cell));
  const cw = width / cols;
  const cd = depth / rows;
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) cells.push([i, j]);
  // Shuffle so a count below the cell count still covers the whole area.
  for (let i = cells.length - 1; i > 0; i--) {
    const k = Math.floor(random() * (i + 1));
    const t = cells[i] as [number, number];
    cells[i] = cells[k] as [number, number];
    cells[k] = t;
  }
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < Math.min(n, cells.length); i++) {
    const [cx, cz] = cells[i] as [number, number];
    out.push([r2(-width / 2 + (cx + 0.15 + 0.7 * random()) * cw), 0, r2(-depth / 2 + (cz + 0.15 + 0.7 * random()) * cd)]);
  }
  return out;
}

/** A circle of reserved ground (x/z plane). */
interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Round to centimeters so generated JSON stays compact and stable. */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function physicsSpec(p: PhysicsOpt): NonNullable<EntityInput['physics']> {
  return typeof p === 'string' ? { body: p } : p;
}

/** Collects patches for one mock response. */
export class Builder {
  readonly mood: Mood;
  readonly seed: number;
  private readonly random: () => number;
  private readonly ids: Set<string>;
  private readonly counters = new Map<string, number>();
  private readonly circles: Circle[] = [];
  /** Areas decorative scatter must stay out of (water surfaces). */
  private readonly keepOut: Circle[] = [];
  /** Rectangles (x0, z0, x1, z1) clustered ground cover must stay out of (a building's footprint). */
  private readonly keepOutRects: Array<readonly [number, number, number, number]> = [];
  private readonly entities: PatchInput[] = [];
  private readonly envSet: Record<string, Json> = {};
  private readonly playerSet: Record<string, Json> = {};
  private readonly stateSet = new Map<string, Json>();
  private readonly hudList: Array<{ key: string; label: string }> = [];
  private keptHud = 0;
  private readonly rules: PatchInput[] = [];
  private readonly tests: PatchInput[] = [];
  private readonly ruleIds = new Set<string>();
  private readonly testIds = new Set<string>();
  private readonly extra: PatchInput[] = [];
  private readonly meshPatches: PatchInput[] = [];
  private metaName: string | undefined;
  private metaDescription: string | undefined;
  /** Kind of theme currently building (see {@link setPhase}). */
  private phase: 'setting' | 'activity' = 'setting';
  /** When true, settings' `focus` tags are dropped: the activity owns the camera. */
  private activityOwnsFocus = false;
  /**
   * When true, `gen` and `scatter` exchange the stylised nature generators (tree-oak, tree-pine, bush,
   * grass-tuft, rock) for the realistic leaf-card vegetation. Flagships turn it on unless they are
   * painterly on purpose.
   */
  realisticNature = false;
  /**
   * The landscape under the scene when a theme replaces the flat ground plane with a terrain: root entities placed by the
   * helpers stand on it (their y is taken relative to the ground under them, see {@link PlaceOpts.absolute}) and scatter
   * layers drape over it (`onSurface`). Null on a flat world (y is absolute, ground at 0).
   */
  ground: { h(x: number, z: number): number; surface: string } | null = null;
  /** A stream carved across the landscape (see `naturalGround` in decor.ts): its centre z at x, half width and water level. */
  stream: { z(x: number): number; half: number; waterY: number } | null = null;
  /**
   * A circuit laid out by an activity before the settings build (see `Theme.prepare`): its racing line as (x, z)
   * points, the half extent of level ground it needs round the origin, and the valley axis it follows (x at z), so a
   * canyon or landscape can be shaped around it.
   */
  track: { loop: Array<[number, number]>; extent: number; axis(z: number): number; canyonSize: number } | null = null;

  constructor(seed: number, existingIds: Iterable<string>, mood: Mood, existingTests: Iterable<string> = [], existingRules: Iterable<string> = []) {
    this.seed = seed >>> 0;
    this.random = rng(this.seed);
    this.ids = new Set(existingIds);
    this.mood = mood;
    for (const t of existingTests) this.testIds.add(t);
    for (const r of existingRules) this.ruleIds.add(r);
  }

  // -- randomness -------------------------------------------------------------

  /** Uniform in [a, b). */
  rand(a = 0, b = 1): number {
    return a + (b - a) * this.random();
  }

  /** Integer in [a, b]. */
  int(a: number, b: number): number {
    return Math.floor(this.rand(a, b + 1));
  }

  /** Random element (array must be non-empty). */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length) % items.length] as T;
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.random() < p;
  }

  /** A fresh 31-bit seed for generator variation. */
  subSeed(): number {
    return Math.floor(this.random() * 2_147_483_647);
  }

  // -- camera focus ---------------------------------------------------------------

  /**
   * Declare which kind of theme the following entities belong to. Once
   * `activityOwnsFocus` is set (a world with a playable mechanic), `focus`
   * tags from settings are dropped so the framing camera looks at the
   * mechanic instead of, say, a castle keep next to it.
   */
  setPhase(kind: 'setting' | 'activity', activityOwnsFocus = this.activityOwnsFocus): void {
    this.phase = kind;
    this.activityOwnsFocus = activityOwnsFocus;
  }

  // -- ids & occupancy ----------------------------------------------------------

  /** Unique id from a base name: "tree" → "tree-1", "tree-2", …; `single` tries the bare base first. */
  id(base: string, single = false): string {
    const slug = slugify(base) || 'object';
    if (single && !this.ids.has(slug)) {
      this.ids.add(slug);
      return slug;
    }
    let n = this.counters.get(slug) ?? 0;
    let candidate: string;
    do {
      n++;
      candidate = `${slug}-${n}`.slice(0, 64);
    } while (this.ids.has(candidate));
    this.counters.set(slug, n);
    this.ids.add(candidate);
    return candidate;
  }

  /** Whether an id is taken (existing world or this builder). */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** Reserve a footprint circle. */
  reserve(x: number, z: number, r: number): void {
    if (r > 0) this.circles.push({ x, z, r });
  }

  /** True when a circle at (x, z) with radius r touches no reserved circle. */
  isFree(x: number, z: number, r: number): boolean {
    for (const c of this.circles) {
      const dx = c.x - x;
      const dz = c.z - z;
      const min = c.r + r;
      if (dx * dx + dz * dz < min * min) return false;
    }
    return true;
  }

  /**
   * Random free spot in the annulus [minR, maxR] around (cx, cz); reserves it.
   * Returns null when no free spot is found (callers then skip the object).
   */
  spot(cx: number, cz: number, minR: number, maxR: number, r: number, tries = 40): [number, number] | null {
    for (let i = 0; i < tries; i++) {
      const a = this.rand(0, Math.PI * 2);
      const d = Math.sqrt(this.rand(minR * minR, maxR * maxR));
      const x = r2(cx + Math.cos(a) * d);
      const z = r2(cz + Math.sin(a) * d);
      if (this.isFree(x, z, r)) {
        this.reserve(x, z, r);
        return [x, z];
      }
    }
    return null;
  }

  /** Keep decorative scatter (grass, flowers) out of a circle, e.g. a lake surface. */
  keepClear(x: number, z: number, r: number): void {
    if (r > 0) this.keepOut.push({ x, z, r });
  }

  /**
   * Keep clustered ground cover (grass, shrubs, flowers) out of a rectangle (world x/z, any corner order), for example
   * under a house: the scatter's hand-placed points inside it are dropped when the layer is built.
   */
  keepClearRect(x0: number, z0: number, x1: number, z1: number): void {
    this.keepOutRects.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
  }

  /** True when a square patch of half-size `half` centered at (x, z) touches a keep-clear circle. */
  touchesKeepClear(x: number, z: number, half: number): boolean {
    for (const c of this.keepOut) {
      const dx = Math.max(0, Math.abs(c.x - x) - half);
      const dz = Math.max(0, Math.abs(c.z - z) - half);
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  /** Reserve (x, z) if free; returns whether it was. */
  claim(x: number, z: number, r: number): boolean {
    if (!this.isFree(x, z, r)) return false;
    this.reserve(x, z, r);
    return true;
  }

  // -- entities -------------------------------------------------------------------

  /** Add a raw entity (id must come from {@link id}). */
  add(entity: EntityInput): string {
    this.entities.push({ op: 'add', entity });
    return entity.id;
  }

  /** World height of the ground under (x, z): the landscape when there is one, else 0. */
  groundAt(x: number, z: number): number {
    return this.ground ? this.ground.h(x, z) : 0;
  }

  private compose(id: string, pos: V3, shape: EntityInput['shape'], o: PlaceOpts): EntityInput {
    const lift = this.ground && !o.parent && o.absolute !== true && shape?.kind !== 'scatter' ? this.ground.h(pos[0], pos[2]) : 0;
    const e: EntityInput = { id, transform: { position: [r2(pos[0]), r2(pos[1] + lift), r2(pos[2])] }, shape };
    const rot: V3 | undefined = o.rot ?? (o.yaw !== undefined ? [0, r2(o.yaw), 0] : undefined);
    if (rot && e.transform) e.transform.rotation = rot;
    if (o.scale !== undefined && e.transform) e.transform.scale = typeof o.scale === 'number' ? [r2(o.scale), r2(o.scale), r2(o.scale)] : o.scale;
    if (o.name) e.name = o.name;
    if (o.description) e.description = o.description;
    if (o.tags) {
      const tags = this.phase === 'setting' && this.activityOwnsFocus ? o.tags.filter((t) => t !== 'focus') : o.tags;
      if (tags.length > 0) e.tags = tags;
    }
    if (o.physics) e.physics = physicsSpec(o.physics);
    if (o.material) e.material = o.material;
    if (o.behaviors) e.behaviors = o.behaviors;
    if (o.light) e.light = o.light;
    if (o.joint) e.joint = o.joint;
    if (o.state) e.state = o.state;
    if (o.npc) e.npc = o.npc;
    if (o.character) e.character = o.character;
    if (o.parent) e.parent = o.parent;
    if (o.visible === false) e.visible = false;
    if (o.castShadow === false) e.castShadow = false;
    if (o.template) e.template = true;
    if (o.footprint) this.reserve(pos[0], pos[2], o.footprint);
    return e;
  }

  /**
   * The generator and params to use for a nature part: the realistic stand-in when {@link realisticNature}
   * is on and the generator has one, else the arguments unchanged.
   */
  nature(generator: string, params: Record<string, Json>): { generator: string; params: Record<string, Json> } {
    return (this.realisticNature ? realisticStandIn(generator, params) : null) ?? { generator, params };
  }

  /** Procedural (generator) entity standing at `pos` (base at pos.y). */
  gen(base: string, generator: string, params: Record<string, Json>, pos: V3, o: PlaceOpts = {}): string {
    const id = this.id(base);
    if (this.realisticNature) {
      const stand = realisticStandIn(generator, params);
      if (stand) {
        generator = stand.generator;
        params = stand.params;
      }
    }
    const seed = this.subSeed() % 100_000;
    const h = o.ground === 'flat' || o.parent || o.absolute === true && !o.terrain ? null : (o.terrain ?? this.ground?.h ?? null);
    const bounds = h && isSettleable(generator) ? settleBounds(generator, params, seed) : null;
    if (h && bounds) {
      const sc = typeof o.scale === 'number' ? ([o.scale, o.scale, o.scale] as V3) : (o.scale ?? [1, 1, 1]);
      const yaw = o.rot?.[1] ?? o.yaw ?? 0;
      const s = settleOnTerrain(h, [pos[0], pos[2]], bounds, yaw, sc);
      if (s.plinth) {
        this.prim('foundation', 'box', s.plinth.size, s.plinth.position, { name: 'Foundation', yaw, material: { ...PLINTH_MATERIAL }, physics: 'static', tags: ['foundation'], absolute: true });
      }
      this.add(this.compose(id, [pos[0], r2(s.floorY - bounds.min[1] * sc[1] + pos[1]), pos[2]], { kind: 'procedural', generator, params, seed }, { ...o, absolute: true }));
      return id;
    }
    this.add(this.compose(id, pos, { kind: 'procedural', generator, params, seed }, o));
    return id;
  }

  /**
   * Library asset standing at `pos` (base at pos.y, real-world size). The
   * renderer shows `fallback` (or a box of the asset's size) when the asset
   * cannot be loaded.
   */
  asset(base: string, assetId: string, pos: V3, o: PlaceOpts & { fallback?: EntityInput['shape']; fitSize?: number; animation?: string } = {}): string {
    const id = this.id(base);
    const shape: EntityInput['shape'] = { kind: 'asset', id: assetId, ...(o.fallback && (o.fallback.kind === 'procedural' || o.fallback.kind === 'primitive') ? { fallback: o.fallback } : {}), ...(o.fitSize ? { fitSize: o.fitSize } : {}), ...(o.animation ? { animation: o.animation } : {}) };
    this.add(this.compose(id, pos, shape, o));
    return id;
  }

  /** Primitive entity centered at `pos`. */
  prim(base: string, primitive: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'torus' | 'plane', size: V3, pos: V3, o: PlaceOpts = {}): string {
    const id = this.id(base);
    this.add(this.compose(id, pos, { kind: 'primitive', primitive, size }, o));
    return id;
  }

  /** Shape-less entity (group, light, zone). */
  empty(base: string, pos: V3, o: PlaceOpts = {}): string {
    const id = this.id(base);
    this.add(this.compose(id, pos, { kind: 'none' }, o));
    return id;
  }

  /** GPU-instanced scatter of a generator over a w×d area centered at pos. */
  scatter(base: string, generator: string, params: Record<string, Json>, count: number, area: [number, number], pos: V3, o: ScatterOpts = {}): string {
    const id = this.id(base);
    if (this.realisticNature) {
      const stand = realisticStandIn(generator, params);
      if (stand) {
        generator = stand.generator;
        params = stand.params;
      }
    }
    if (this.ground && !o.onSurface && !o.parent) {
      o = { ...o, onSurface: this.ground.surface };
    }
    const scatterSeed = this.subSeed();
    // Natural ground cover grows in clumps: lay it out as a clustered point process (deterministic).
    let clustered = this.realisticNature && CLUSTERED_GENERATORS.has(generator) && count >= 12 ? clusterPoints(count, area[0], area[1], scatterSeed, { ...(o.minSpacing ? { minSpacing: o.minSpacing } : {}) }) : null;
    // On a landscape every layer gets explicit points, so water and building plots can be kept clear of it.
    if (!clustered && this.ground && count >= 1) clustered = jitteredPoints(count, area[0], area[1], scatterSeed, o.minSpacing ?? 0);
    if (clustered && (this.keepOutRects.length > 0 || o.heightAt || (this.ground && this.keepOut.length > 0))) {
      const [px, py, pz] = pos;
      const kept: Array<[number, number, number]> = [];
      for (const [x, , z] of clustered) {
        const wx = px + x;
        const wz = pz + z;
        if (this.keepOutRects.some(([x0, z0, x1, z1]) => wx > x0 && wx < x1 && wz > z0 && wz < z1)) continue;
        if (this.ground && this.keepOut.some((c) => (c.x - wx) ** 2 + (c.z - wz) ** 2 < c.r * c.r)) continue;
        kept.push([x, o.heightAt ? r2(o.heightAt(wx, wz) - py) : 0, z]);
      }
      clustered = kept;
    }
    const shape: EntityInput['shape'] = {
      kind: 'scatter',
      of: { kind: 'procedural', generator, params },
      count: Math.max(1, clustered ? clustered.length : Math.floor(count)),
      area,
      seed: scatterSeed % 100_000,
      ...(o.scaleRange ? { scaleRange: o.scaleRange } : {}),
      ...(o.minSpacing !== undefined ? { minSpacing: o.minSpacing } : {}),
      ...(o.randomYaw === false ? { randomYaw: false } : {}),
      ...(o.onSurface ? { onSurface: o.onSurface } : {}),
      ...(clustered && clustered.length > 0 ? { points: clustered } : {}),
    };
    this.add(this.compose(id, pos, shape, o));
    return id;
  }

  /** A point light child entity at local `offset`. */
  light(parent: string, offset: V3, color: string, intensity: number, range: number, behaviors?: EntityInput['behaviors']): string {
    return this.empty(`${parent}-light`, offset, { parent, light: { type: 'point', color, intensity, range, castShadow: false }, ...(behaviors ? { behaviors } : {}) });
  }

  // -- world-level ------------------------------------------------------------------

  /** Merge environment fields (later calls win per key). */
  env(set: Record<string, Json>): void {
    Object.assign(this.envSet, set);
  }

  /** Current pending environment value. */
  envValue(key: string): Json | undefined {
    return this.envSet[key];
  }

  /** Merge player fields. */
  player(set: Record<string, Json>): void {
    Object.assign(this.playerSet, set);
  }

  /** Copy of the pending player fields. */
  playerSnapshot(): Record<string, Json> {
    return { ...this.playerSet };
  }

  /** Pending player field value. */
  playerValue(key: string): Json | undefined {
    return this.playerSet[key];
  }

  /** `base`, or `base2`, `base3`… — the first state key not yet used by this build. */
  freshStateKey(base: string): string {
    let key = base;
    for (let n = 2; this.stateSet.has(key); n++) key = `${base}${n}`;
    return key;
  }

  /** Set (or overwrite) a world state variable. */
  state(key: string, value: Json): void {
    this.stateSet.set(key, value);
  }

  /** Add a HUD binding (deduplicated by key). */
  hud(key: string, label: string): void {
    if (!this.hudList.some((h) => h.key === key)) this.hudList.push({ key, label });
  }

  /** Add a rule; its id is made unique. Returns the final id. */
  rule(rule: RuleInput): string {
    let id = rule.id;
    for (let n = 2; this.ruleIds.has(id); n++) id = `${rule.id}-${n}`;
    this.ruleIds.add(id);
    this.rules.push({ op: 'addRule', rule: { ...rule, id } });
    return id;
  }

  /** Add a verification test; its id is made unique. */
  test(test: WorldTestInput): string {
    let id = test.id;
    for (let n = 2; this.testIds.has(id); n++) id = `${test.id}-${n}`;
    this.testIds.add(id);
    this.tests.push({ op: 'addTest', test: { ...test, id } });
    return id;
  }

  /** Seed HUD entries that already exist (setHud replaces the whole list). */
  keepHud(entries: ReadonlyArray<{ key: string; label: string }>): void {
    for (const e of entries) this.hud(e.key, e.label);
    this.keptHud = this.hudList.length;
  }

  /** Add an editable mesh asset (a `setMesh` patch applied before every entity, so a `mesh` shape can reference it). */
  mesh(asset: MeshAssetInput): void {
    this.meshPatches.push({ op: 'setMesh', mesh: asset });
  }

  /** Append a raw patch after entities (updates/removes in edits). */
  patch(p: PatchInput): void {
    this.extra.push(p);
  }

  /** Set the world name/description (first caller wins for the name). */
  meta(name: string, description?: string): void {
    this.metaName ??= name;
    if (description) this.metaDescription ??= description;
  }

  /** Name the world `name` even when a theme already named it (a game is named after what you play, not where). */
  rename(name: string): void {
    this.metaName = name;
  }

  /** Number of entities added so far. */
  get entityCount(): number {
    return this.entities.length;
  }

  /** All patches in canonical order. */
  build(): PatchInput[] {
    const out: PatchInput[] = [];
    if (this.metaName !== undefined || this.metaDescription !== undefined) {
      out.push({ op: 'setMeta', ...(this.metaName !== undefined ? { name: this.metaName } : {}), ...(this.metaDescription !== undefined ? { description: this.metaDescription } : {}) });
    }
    if (Object.keys(this.envSet).length > 0) out.push({ op: 'setEnvironment', set: { ...this.envSet } });
    // The player settings come after the entities: `controls` names one, and a plan longer than one tool call is cut into chunks.
    out.push(...this.meshPatches, ...this.entities, ...this.extra);
    if (Object.keys(this.playerSet).length > 0) out.push({ op: 'setPlayer', set: { ...this.playerSet } });
    for (const [key, value] of this.stateSet) out.push({ op: 'setState', key, value });
    if (this.hudList.length > this.keptHud) out.push({ op: 'setHud', hud: [...this.hudList] });
    out.push(...this.rules, ...this.tests);
    return out;
  }
}

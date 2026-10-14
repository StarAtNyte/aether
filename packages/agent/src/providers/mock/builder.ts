/**
 * Deterministic world builder used by the offline mock planner.
 *
 * Collects patches in a canonical order (meta, environment, player, entities,
 * state, HUD, rules, tests), hands out unique slug ids, and keeps a simple
 * occupancy map of footprint circles so generated objects do not overlap.
 */
import { rng, slugify, type EntityInput, type Json, type PatchInput, type RuleInput, type WorldTest } from '@aether/core';
import type { z } from 'zod';

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
  parent?: string;
  visible?: boolean;
  castShadow?: boolean;
  template?: boolean;
  /** Footprint radius to reserve in the occupancy map (0 = none). */
  footprint?: number;
}

/** Extra options of scatter entities. */
export interface ScatterOpts extends PlaceOpts {
  scaleRange?: [number, number];
  minSpacing?: number;
  randomYaw?: boolean;
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
  private metaName: string | undefined;
  private metaDescription: string | undefined;
  /** Kind of theme currently building (see {@link setPhase}). */
  private phase: 'setting' | 'activity' = 'setting';
  /** When true, settings' `focus` tags are dropped: the activity owns the camera. */
  private activityOwnsFocus = false;

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

  private compose(id: string, pos: V3, shape: EntityInput['shape'], o: PlaceOpts): EntityInput {
    const e: EntityInput = { id, transform: { position: [r2(pos[0]), r2(pos[1]), r2(pos[2])] }, shape };
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
    if (o.parent) e.parent = o.parent;
    if (o.visible === false) e.visible = false;
    if (o.castShadow === false) e.castShadow = false;
    if (o.template) e.template = true;
    if (o.footprint) this.reserve(pos[0], pos[2], o.footprint);
    return e;
  }

  /** Procedural (generator) entity standing at `pos` (base at pos.y). */
  gen(base: string, generator: string, params: Record<string, Json>, pos: V3, o: PlaceOpts = {}): string {
    const id = this.id(base);
    this.add(this.compose(id, pos, { kind: 'procedural', generator, params, seed: this.subSeed() % 100_000 }, o));
    return id;
  }

  /**
   * Library asset standing at `pos` (base at pos.y, real-world size). The
   * renderer shows `fallback` (or a box of the asset's size) when the asset
   * cannot be loaded.
   */
  asset(base: string, assetId: string, pos: V3, o: PlaceOpts & { fallback?: EntityInput['shape']; fitSize?: number } = {}): string {
    const id = this.id(base);
    const shape: EntityInput['shape'] = { kind: 'asset', id: assetId, ...(o.fallback && (o.fallback.kind === 'procedural' || o.fallback.kind === 'primitive') ? { fallback: o.fallback } : {}), ...(o.fitSize ? { fitSize: o.fitSize } : {}) };
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
    const shape: EntityInput['shape'] = {
      kind: 'scatter',
      of: { kind: 'procedural', generator, params },
      count: Math.max(1, Math.floor(count)),
      area,
      seed: this.subSeed() % 100_000,
      ...(o.scaleRange ? { scaleRange: o.scaleRange } : {}),
      ...(o.minSpacing !== undefined ? { minSpacing: o.minSpacing } : {}),
      ...(o.randomYaw === false ? { randomYaw: false } : {}),
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

  /** Append a raw patch after entities (updates/removes in edits). */
  patch(p: PatchInput): void {
    this.extra.push(p);
  }

  /** Set the world name/description (first caller wins for the name). */
  meta(name: string, description?: string): void {
    this.metaName ??= name;
    if (description) this.metaDescription ??= description;
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
    if (Object.keys(this.playerSet).length > 0) out.push({ op: 'setPlayer', set: { ...this.playerSet } });
    out.push(...this.entities, ...this.extra);
    for (const [key, value] of this.stateSet) out.push({ op: 'setState', key, value });
    if (this.hudList.length > this.keptHud) out.push({ op: 'setHud', hud: [...this.hudList] });
    out.push(...this.rules, ...this.tests);
    return out;
  }
}

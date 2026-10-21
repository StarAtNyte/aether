/**
 * Gameplay visual effects: seeded, pooled, GPU-evaluated particles.
 *
 * Two instanced draws (additive light and alpha-blended matter), each a
 * fixed ring of particles sized by the render tier's budget. A burst writes
 * its particles once (seeded: the same seed draws the same particles);
 * continuous emitters (a torch's fire, a chimney's smoke) follow their
 * entity and add particles at their rate. Per frame the CPU only advances a
 * clock, refreshes four uniforms and uploads the slots written that frame.
 * No allocation happens per frame once the pools exist.
 *
 * Effects are presentation only: nothing here is read by physics, logic or
 * the playtest bot, so replay proofs are unaffected.
 */
import {
  DataTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import { hashString, type EntityVfx, type VfxPreset } from '@aether/core';
import { atlasPixels, ATLAS_CELLS } from './atlas';
import { createVfxMaterial, vfxUniforms, type VfxUniforms } from './material';
import { linearColor, mixSeed, NO_FLOOR, ParticlePool, SeededRandom, type SpawnOptions } from './pool';
import { VFX_PRESETS, vfxBudget, type VfxLayer } from './presets';

/** Options of one burst. */
export interface BurstOptions {
  /** Deterministic seed (same seed, same particles). */
  seed: number;
  /** Size multiplier 0.2..4 (default 1). */
  scale?: number;
  /** Tint `#rrggbb`. */
  color?: string;
  /** Emission axis (default up). */
  direction?: readonly [number, number, number];
  /** Ground height particles rest on (default: the burst's own height). */
  floorY?: number;
}

/** A continuous emitter following an object. */
interface Emitter {
  id: string;
  preset: VfxPreset;
  target: Object3D;
  rate: number;
  scale: number;
  tint: Float32Array | null;
  offset: Vector3;
  accum: number;
  rand: SeededRandom;
}

const ATTRS = ['aOrigin', 'aVel', 'aShape', 'aColor0', 'aColor1', 'aMotion'] as const;
type PoolArray = 'origin' | 'velocity' | 'shape' | 'color0' | 'color1' | 'motion';
const ARRAYS: readonly PoolArray[] = ['origin', 'velocity', 'shape', 'color0', 'color1', 'motion'];
/** Emitters further than this from the camera do not emit (m). */
const EMIT_DISTANCE = 90;
/** Most particles all continuous emitters add in one frame. */
const MAX_EMIT_PER_FRAME = 400;
/** Most emitters held at once. */
export const MAX_EMITTERS = 256;
/** Share of the budget given to additive light (sparks, fire); the rest is matter (smoke, dust). */
const ADD_SHARE = 0.6;

interface Layer {
  pool: ParticlePool;
  mesh: Mesh;
  geometry: InstancedBufferGeometry;
  attrs: InstancedBufferAttribute[];
  /** One reused update range per attribute (three's `addUpdateRange` would allocate a record each frame). */
  ranges: Array<{ start: number; count: number }>;
  material: MeshBasicNodeMaterial;
}

const dirty = { start: 0, count: 0 };
/** Replaces `clearUpdateRanges` on the particle attributes (see `makeLayer`). */
function keepRanges(this: InstancedBufferAttribute): InstancedBufferAttribute {
  return this;
}
const drawScratch = new Float64Array(4);
const _pos = new Vector3();
const UP: readonly [number, number, number] = [0, 1, 0];

/** The effects of one renderer. */
export class VfxSystem {
  private readonly layers: { add: Layer; alpha: Layer };
  private readonly uniforms: VfxUniforms;
  private readonly atlas: DataTexture;
  private readonly rand = new SeededRandom(1);
  private readonly spawnOpts: SpawnOptions = { scale: 1, tint: null, floorY: NO_FLOOR };
  private readonly emitters = new Map<string, Emitter>();
  /** The emitters again as an array (iterating a Map allocates an iterator every frame). */
  private emitterList: Emitter[] = [];
  private readonly lightColor = new Vector3(1, 1, 1);
  private clock = 0;
  private worldSeed = 1;
  private disposed = false;
  /** Hide every particle without touching the pools (tests compare frames with and without effects). */
  hidden = false;
  /** Bursts played since construction (diagnostics, tests). */
  bursts = 0;
  readonly capacity: number;

  constructor(private readonly parent: { add(o: Object3D): unknown }, tier: 'low' | 'medium' | 'high' | 'ultra' = 'medium', lowMemory = false) {
    this.capacity = vfxBudget(tier, lowMemory);
    this.atlas = new DataTexture(atlasPixels(64), 64 * ATLAS_CELLS, 64, RGBAFormat);
    this.atlas.colorSpace = NoColorSpace;
    this.atlas.magFilter = LinearFilter;
    this.atlas.minFilter = LinearMipmapLinearFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.needsUpdate = true;
    this.uniforms = vfxUniforms(new Vector3(1, 0, 0), new Vector3(0, 1, 0), this.lightColor);
    const addCap = Math.max(256, Math.round(this.capacity * ADD_SHARE));
    this.layers = { add: this.makeLayer('add', addCap), alpha: this.makeLayer('alpha', Math.max(256, this.capacity - addCap)) };
  }

  private makeLayer(blend: 'add' | 'alpha', capacity: number): Layer {
    const pool = new ParticlePool(capacity);
    const quad = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    const attrs: InstancedBufferAttribute[] = [];
    const ranges: Array<{ start: number; count: number }> = [];
    for (let i = 0; i < ATTRS.length; i++) {
      const attr = new InstancedBufferAttribute(pool[ARRAYS[i] as PoolArray], 4);
      attr.setUsage(35048); // DynamicDrawUsage
      // One update range per attribute, owned here and kept across uploads: three's `addUpdateRange` allocates a
      // record and its clear trims the array, so both would allocate every frame.
      const range = { start: 0, count: 0 };
      attr.updateRanges.push(range);
      attr.clearUpdateRanges = keepRanges;
      ranges.push(range);
      geometry.setAttribute(ATTRS[i] as string, attr);
      attrs.push(attr);
    }
    geometry.instanceCount = 0;
    const material = createVfxMaterial(blend, this.atlas, this.uniforms);
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    // After the weather (5) and the water: light on top of matter.
    mesh.renderOrder = blend === 'add' ? 8 : 7;
    mesh.name = `aether:vfx:${blend}`;
    this.parent.add(mesh);
    return { pool, mesh, geometry, attrs, ranges, material };
  }

  /** The world's seed: emitters and unseeded bursts derive their streams from it. */
  setWorldSeed(seed: number): void {
    this.worldSeed = Number.isFinite(seed) ? Math.trunc(seed) : 1;
  }

  /** Light the alpha-blended matter receives (linear RGB, ~1 at noon, low at night). */
  setLighting(r: number, g: number, b: number): void {
    this.lightColor.set(r, g, b);
  }

  /** The effects clock (s). */
  get time(): number {
    return this.clock;
  }

  /** Particles that may be alive (an upper bound: slots written whose lives have not all ended). */
  get liveEstimate(): number {
    const t = this.clock;
    let n = 0;
    for (const l of [this.layers.add, this.layers.alpha]) if (l.pool.alive(t)) n += l.pool.count;
    return n;
  }

  /** Particles written so far (diagnostics, tests). */
  get spawned(): number {
    return this.layers.add.pool.spawned + this.layers.alpha.pool.spawned;
  }

  /** Emitters held. */
  get emitterCount(): number {
    return this.emitters.size;
  }

  /** True while particles may be on screen (the renderer keeps drawing). */
  get animating(): boolean {
    return this.emitters.size > 0 || this.layers.add.pool.alive(this.clock) || this.layers.alpha.pool.alive(this.clock);
  }

  /** Read-only views of the pools (tests). */
  get pools(): { add: ParticlePool; alpha: ParticlePool } {
    return { add: this.layers.add.pool, alpha: this.layers.alpha.pool };
  }

  /** Play a burst of `preset` at (x, y, z). */
  burst(preset: VfxPreset, x: number, y: number, z: number, opts: BurstOptions): void {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const def = VFX_PRESETS[preset];
    if (!def) return;
    const scale = clampScale(opts.scale);
    this.spawnOpts.scale = scale;
    this.spawnOpts.tint = opts.color ? linearColor(opts.color) : null;
    this.spawnOpts.floorY = opts.floorY !== undefined && Number.isFinite(opts.floorY) ? opts.floorY : y;
    const dir = opts.direction ?? UP;
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    this.rand.reset(mixSeed(opts.seed, hashString(preset), this.worldSeed));
    const countScale = Math.sqrt(scale);
    for (let li = 0; li < def.layers.length; li++) {
      const layer = def.layers[li] as VfxLayer;
      const n = Math.max(1, Math.round(this.rand.range(layer.burst[0], layer.burst[1] + 1) * (layer.burst[1] > 1 ? countScale : 1)));
      const pool = layer.blend === 'add' ? this.layers.add.pool : this.layers.alpha.pool;
      const at = pool.at;
      for (let i = 0; i < n; i++) {
        at[0] = x;
        at[1] = y;
        at[2] = z;
        at[3] = dir[0] / dl;
        at[4] = dir[1] / dl;
        at[5] = dir[2] / dl;
        at[6] = this.clock;
        pool.write(layer, this.rand, this.spawnOpts);
      }
    }
    this.bursts++;
  }

  /** Attach (or replace) a continuous emitter on `target`; `spec.enabled: false` or an unknown preset removes it. */
  setEmitter(id: string, spec: EntityVfx | null, target: Object3D | null): void {
    if (!spec || !spec.enabled || !target || !VFX_PRESETS[spec.preset]) {
      if (this.emitters.delete(id)) this.emitterList = [...this.emitters.values()];
      return;
    }
    const def = VFX_PRESETS[spec.preset];
    const baseRate = def.layers[0]?.rate ?? 0;
    const prev = this.emitters.get(id);
    if (!prev && this.emitters.size >= MAX_EMITTERS) return;
    const e: Emitter = prev ?? { id, preset: spec.preset, target, rate: 0, scale: 1, tint: null, offset: new Vector3(), accum: 0, rand: new SeededRandom(mixSeed(this.worldSeed, hashString(id), 0x5eed)) };
    e.preset = spec.preset;
    e.target = target;
    e.rate = spec.rate ?? baseRate;
    e.scale = clampScale(spec.scale);
    e.tint = spec.color ? linearColor(spec.color) : null;
    const o = spec.offset;
    e.offset.set(o ? o[0] : 0, o ? o[1] : 0, o ? o[2] : 0);
    if (!prev) {
      this.emitters.set(id, e);
      this.emitterList = [...this.emitters.values()];
    }
  }

  /** Remove every emitter whose id is not in `keep`. */
  retainEmitters(keep: ReadonlySet<string>): void {
    let changed = false;
    for (const id of [...this.emitters.keys()]) {
      if (!keep.has(id)) {
        this.emitters.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitterList = [...this.emitters.values()];
  }

  /** Kill every particle and emitter (world switch). */
  clear(): void {
    this.emitters.clear();
    this.emitterList = [];
    this.layers.add.pool.clear();
    this.layers.alpha.pool.clear();
  }

  /** Advance the effects by `dt` seconds and orient them to `camera`. Zero allocations. */
  update(dt: number, camera: Camera): void {
    if (this.disposed) return;
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    this.clock += step;
    if (this.clock > 1e5) {
      // Keep float32 birth times precise: start the clock over (nothing lives this long).
      this.clock = 0;
      this.layers.add.pool.clear();
      this.layers.alpha.pool.clear();
    }
    if (step > 0 && this.emitters.size > 0) {
      this.frameStep[0] = step;
      this.emit(camera);
    }
    const e = camera.matrixWorld.elements;
    this.uniforms.right.value.set(e[0] as number, e[1] as number, e[2] as number);
    this.uniforms.up.value.set(e[4] as number, e[5] as number, e[6] as number);
    this.uniforms.time.value.x = this.clock;
    this.upload(this.layers.add);
    this.upload(this.layers.alpha);
  }

  /** Step of the current frame (a typed array: a fractional argument to `emit` would be boxed every frame). */
  private readonly frameStep = new Float64Array(1);

  private emit(camera: Camera): void {
    const step = this.frameStep[0]!;
    let budget = MAX_EMIT_PER_FRAME;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const list = this.emitterList;
    for (let ei = 0; ei < list.length; ei++) {
      const em = list[ei] as Emitter;
      const def = VFX_PRESETS[em.preset];
      const t = em.target;
      if (!inScene(t)) continue;
      _pos.copy(em.offset);
      t.localToWorld(_pos);
      const dx = _pos.x - cx;
      const dy = _pos.y - cy;
      const dz = _pos.z - cz;
      if (dx * dx + dy * dy + dz * dz > EMIT_DISTANCE * EMIT_DISTANCE || !t.visible) {
        em.accum = 0;
        continue;
      }
      em.accum += em.rate * step * Math.sqrt(em.scale);
      const n = Math.min(Math.floor(em.accum), budget);
      if (n <= 0) continue;
      em.accum -= n;
      budget -= n;
      this.spawnOpts.scale = em.scale;
      this.spawnOpts.tint = em.tint;
      this.spawnOpts.floorY = NO_FLOOR;
      const baseRate = def.layers[0]?.rate || 1;
      for (let i = 0; i < n; i++) {
        // Spread births over the frame so a steady rate does not pulse at low frame rates.
        const born = this.clock - step * (em.rand.fill(drawScratch, 4), drawScratch[0]!);
        for (let li = 0; li < def.layers.length; li++) {
          const layer = def.layers[li] as VfxLayer;
          // Secondary layers (a fire's embers) emit in proportion to their own rate.
          if (li > 0 && drawScratch[1 + (li % 3)]! > layer.rate / baseRate) continue;
          const pool = layer.blend === 'add' ? this.layers.add.pool : this.layers.alpha.pool;
          const at = pool.at;
          at[0] = _pos.x;
          at[1] = _pos.y;
          at[2] = _pos.z;
          at[3] = 0;
          at[4] = 1;
          at[5] = 0;
          at[6] = born;
          pool.write(layer, em.rand, this.spawnOpts);
        }
      }
      if (budget <= 0) break;
    }
  }

  private upload(l: Layer): void {
    const pool = l.pool;
    const live = pool.alive(this.clock);
    l.mesh.visible = live && !this.hidden;
    l.geometry.instanceCount = live ? pool.count : 0;
    if (!pool.takeDirty(dirty)) return;
    for (let i = 0; i < l.attrs.length; i++) {
      const attr = l.attrs[i] as InstancedBufferAttribute;
      const range = l.ranges[i] as { start: number; count: number };
      range.start = dirty.start * 4;
      range.count = dirty.count * 4;
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.emitters.clear();
    this.emitterList = [];
    for (const l of [this.layers.add, this.layers.alpha]) {
      l.mesh.removeFromParent();
      l.geometry.dispose();
      l.material.dispose();
    }
    this.atlas.dispose();
  }
}

/** True when `o` hangs in a scene (a removed rig or entity keeps its own parents, so walk to the root). Allocation-free. */
function inScene(o: Object3D): boolean {
  let n: Object3D = o;
  for (let i = 0; i < 64 && n.parent; i++) n = n.parent;
  return (n as Object3D & { isScene?: boolean }).isScene === true;
}

function clampScale(s: number | undefined): number {
  return s !== undefined && Number.isFinite(s) ? Math.min(4, Math.max(0.2, s)) : 1;
}

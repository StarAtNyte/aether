/**
 * Owns a building's baked light volume (see `environment/light-volume.ts`): gathers the building's shell and
 * furniture into a trace scene, plans the probe grid, bakes it in a module worker (or, without one, in
 * small time slices between frames), uploads the result to the {@link LightVolume} light and answers
 * eye-adaptation queries from the CPU copy. Nothing runs per frame.
 *
 * A bake starts once the building has been still for a moment ({@link SETTLE_SECONDS} after the last
 * change); a change during a bake restarts it, and the previous volume stays on screen until the new one is
 * complete, so editing never flashes an unlit room.
 */
import { WorkerSlot } from '@aether/core';
import { Box3, Color, Matrix4, Vector3, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';
import { combineVolume, FLOATS_PER_PROBE, LightVolumeBaker, MAX_TRACE_TRIANGLES, planVolumeGrid, sampleVolume, TraceScene, type TraceInput, type VolumeGrid, type VolumeLamp, type V3 } from '../environment/light-volume';
import { CACHE_MIN_BAKE_MS, createIdbVolumeCache, volumeFileKey, volumeKey, type VolumeCache } from '../environment/light-volume-cache';
import { packVolumeAsset, unpackVolumeAsset, VOLUME_MAX_ASSET_BYTES } from '../environment/light-volume-asset';
import { LightVolume } from '../environment/light-volume-light';
import { partCount, relightCoefficients, sunKeyDirections, volumeLightFloats, type RelightLighting } from '../environment/relight';
import { parseVolumeReply, type VolumeRequest } from '../environment/light-volume-protocol';
import { log } from '../log';

/** Seconds a building must stay unchanged before a bake starts. */
export const SETTLE_SECONDS = 0.6;
/** Milliseconds of bake work per frame. */
export const BAKE_SLICE_MS = 6;
/** Smallest furniture (two largest box dimensions, metres) that becomes an occluder. */
const MIN_PROXY = 0.3;
/** Most lamps a bake lights the rooms with. */
const MAX_LAMPS = 32;
/** Metres within which a lamp counts toward the eye's exposure, and the height difference that puts it on another storey. */
const EYE_LAMP_REACH = 12;
const EYE_LAMP_STOREY = 2.4;

/** Arch roles whose real geometry the rays hit. */
export const SHELL_ROLES: ReadonlySet<string> = new Set(['wall', 'room', 'ceiling', 'roof', 'stair', 'door', 'window', 'opening', 'column']);
/** Arch roles that become box proxies (their bounding box, their mean colour). */
export const PROXY_ROLES: ReadonlySet<string> = new Set(['furniture', 'fixture']);

/** Pieces that hang over a window and let its light through (a curtain is a thin cloth, its box would shut the window): no box proxy. */
export const SOFT_KINDS: ReadonlySet<string> = new Set(['curtain']);

/** One mesh of a building part, as the scene sync holds it. */
export interface VolumeMesh {
  mesh: Mesh;
  /** Glass and other see-through parts: light passes. */
  seeThrough: boolean;
  doubleSided: boolean;
}

/** One building part offered to the bake. */
export interface VolumePart {
  role: string;
  /** The arch kind of the piece (`curtain`, `bed`, ...), when it has one. */
  kind?: string;
  object: Object3D;
  meshes: readonly VolumeMesh[];
  /**
   * The meshes that are drawn, when `meshes` are trace stand-ins (a wall the view has sectioned is traced as built): the
   * baked lightmap goes onto these.
   */
  drawn?: readonly VolumeMesh[];
  /** The part moves at run time (a behaviour, a dynamic body): a baked lightmap does not follow it. */
  movable?: boolean;
}

/** The lamps and ground the bake uses, and the live light its parts are weighted with (`relight.ts`). */
export interface VolumeLighting {
  /** The lamps at full strength (their part is scaled by `live.lampScale`). */
  lamps: readonly VolumeLamp[];
  groundAlbedo: V3;
  /** The light now: the sun, the sky's ambient, the lamps' scale. */
  live: RelightLighting;
}

const _m = new Matrix4();
const _v = new Vector3();
const _box = new Box3();
const _c = new Color();

/** Linear albedo of a material: the colour it was resolved with (before finish-map scaling), else its colour. */
export function materialAlbedo(m: Material | Material[] | null | undefined, out: [number, number, number]): void {
  const mat = Array.isArray(m) ? m[0] : m;
  const stored = mat?.userData?.['aetherAlbedo'] as unknown;
  if (Array.isArray(stored) && stored.length === 3 && stored.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    out[0] = stored[0] as number;
    out[1] = stored[1] as number;
    out[2] = stored[2] as number;
    return;
  }
  const color = (mat as (Material & { color?: Color }) | undefined)?.color;
  if (color && color.isColor) {
    _c.copy(color);
    out[0] = _c.r;
    out[1] = _c.g;
    out[2] = _c.b;
    return;
  }
  out[0] = out[1] = out[2] = 0.5;
}

/** An emissive pane of a window: the picture of the sky beyond the glass, not a surface light stops at. */
export function isDaylightPane(m: Material | Material[] | null | undefined): boolean {
  const mat = (Array.isArray(m) ? m[0] : m) as (Material & { emissive?: Color; emissiveIntensity?: number }) | undefined;
  const e = mat?.emissive;
  if (!e || !e.isColor || !((mat?.emissiveIntensity ?? 0) > 0.5)) return false;
  return 0.2126 * e.r + 0.7152 * e.g + 0.0722 * e.b > 0.4;
}

/** A furniture box proxy in the trace input: its corners and its 12 triangles `[tri, tri + 12)`. */
export interface TraceProxy {
  lo: V3;
  hi: V3;
  tri: number;
}

/**
 * The trace input of a building: shell meshes as their real triangles (glass left out), furniture and fixtures
 * as boxes. Returns null when nothing usable is there. `bounds` receives the shell's world box; `proxies` (when
 * given) receives the boxes, so a bake of the furniture's own surfaces can leave a box out of its rays.
 */
export function collectTraceInput(parts: readonly VolumePart[], bounds: Box3, proxies?: TraceProxy[]): Required<TraceInput> | null {
  const pos: number[] = [];
  const alb: number[] = [];
  const two: number[] = [];
  const a: [number, number, number] = [0.5, 0.5, 0.5];
  bounds.makeEmpty();
  let tris = 0;
  const full = (): boolean => tris >= MAX_TRACE_TRIANGLES;
  for (const part of parts) {
    if (full()) break;
    if (SHELL_ROLES.has(part.role)) {
      for (const vm of part.meshes) {
        if (vm.seeThrough || full()) continue;
        const mesh = vm.mesh;
        // The daylight pane of a window (an emissive card behind the frame that stands for the sky outside) lets the light pass.
        if (part.role === 'window' && isDaylightPane(mesh.material)) continue;
        if ((mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) continue;
        const g = mesh.geometry as BufferGeometry;
        const p = g.getAttribute('position');
        if (!p) continue;
        materialAlbedo(mesh.material, a);
        _m.copy(mesh.matrixWorld);
        const index = g.getIndex();
        const count = index ? index.count : p.count;
        for (let i = 0; i + 2 < count && !full(); i += 3) {
          for (let k = 0; k < 3; k++) {
            const vi = index ? index.getX(i + k) : i + k;
            _v.fromBufferAttribute(p, vi).applyMatrix4(_m);
            pos.push(_v.x, _v.y, _v.z);
            bounds.expandByPoint(_v);
          }
          alb.push(a[0], a[1], a[2]);
          two.push(vm.doubleSided ? 1 : 0);
          tris++;
        }
      }
    } else if (PROXY_ROLES.has(part.role) && !(part.kind && SOFT_KINDS.has(part.kind))) {
      _box.setFromObject(part.object);
      if (_box.isEmpty()) continue;
      const sx = _box.max.x - _box.min.x;
      const sy = _box.max.y - _box.min.y;
      const sz = _box.max.z - _box.min.z;
      const dims = [sx, sy, sz].sort((p, q) => q - p);
      if ((dims[0] as number) < MIN_PROXY || (dims[1] as number) < MIN_PROXY || (dims[2] as number) < 0.05 || (dims[0] as number) > 12) continue;
      let r = 0;
      let gg = 0;
      let b = 0;
      let n = 0;
      for (const vm of part.meshes) {
        if (vm.seeThrough) continue;
        materialAlbedo(vm.mesh.material, a);
        r += a[0];
        gg += a[1];
        b += a[2];
        n++;
      }
      const col: [number, number, number] = n > 0 ? [r / n, gg / n, b / n] : [0.5, 0.5, 0.5];
      // Shrunk a little: a sofa's box is fuller than the sofa.
      const sh = 0.08;
      const lo: V3 = [_box.min.x + sx * sh, _box.min.y, _box.min.z + sz * sh];
      // A piece with a slim frame standing over its body (a four-poster's canopy) is a box only as high as most of its surface reaches.
      const hi: V3 = [_box.max.x - sx * sh, Math.min(_box.max.y - sy * sh * 0.5, Math.max(_box.min.y + 0.3, surfaceTop(part, SOLID_SHARE))), _box.max.z - sz * sh];
      proxies?.push({ lo, hi, tri: tris });
      tris += pushBox(pos, alb, two, lo, hi, col);
    }
  }
  if (tris === 0) return null;
  return { positions: Float32Array.from(pos), albedo: Float32Array.from(alb), twoSided: Uint8Array.from(two) };
}

/** Share of a piece's surface that lies under the top of its box proxy. */
export const SOLID_SHARE = 0.9;

/** Height (world metres) below which `share` of the piece's surface area (by triangle centre) lies; +Infinity without geometry. */
export function surfaceTop(part: VolumePart, share: number): number {
  const ys: number[] = [];
  const as: number[] = [];
  let total = 0;
  const p0 = new Vector3();
  const p1 = new Vector3();
  const p2 = new Vector3();
  for (const vm of part.meshes) {
    if (vm.seeThrough || (vm.mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) continue;
    const g = vm.mesh.geometry as BufferGeometry;
    const p = g.getAttribute('position');
    if (!p) continue;
    const index = g.getIndex();
    const count = index ? index.count : p.count;
    for (let i = 0; i + 2 < count; i += 3) {
      p0.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(vm.mesh.matrixWorld);
      p1.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1).applyMatrix4(vm.mesh.matrixWorld);
      p2.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2).applyMatrix4(vm.mesh.matrixWorld);
      p1.sub(p0);
      p2.sub(p0);
      const cy = p0.y + (p1.y + p2.y) / 3;
      const area = p1.cross(p2).length() / 2;
      if (!(area > 0)) continue;
      ys.push(cy);
      as.push(area);
      total += area;
    }
  }
  if (ys.length === 0) return Number.POSITIVE_INFINITY;
  const order = ys.map((_, i) => i).sort((a, b) => (ys[a] as number) - (ys[b] as number));
  let run = 0;
  for (const i of order) {
    run += as[i] as number;
    if (run >= total * share) return ys[i] as number;
  }
  return ys[order[order.length - 1] as number] as number;
}

function pushBox(pos: number[], alb: number[], two: number[], lo: V3, hi: V3, col: readonly number[]): number {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const quads: number[][][] = [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
  ];
  for (const [a, b, c, d] of quads) {
    pos.push(...(a as number[]), ...(b as number[]), ...(c as number[]), ...(a as number[]), ...(c as number[]), ...(d as number[]));
    for (let k = 0; k < 2; k++) {
      alb.push(col[0] as number, col[1] as number, col[2] as number);
      two.push(0);
    }
  }
  return 12;
}

/** Minimal worker surface (tests inject fakes). */
export interface VolumeWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
}

function defaultWorker(): VolumeWorkerLike {
  return new Worker(new URL('../environment/light-volume.worker.ts', import.meta.url), { type: 'module', name: 'aether-light-volume' }) as unknown as VolumeWorkerLike;
}

/** What a bake is gathered from (see {@link LightVolumeController}). */
export type VolumeGather = () => { parts: VolumePart[]; lighting: VolumeLighting; groundY: number } | null;

/** Options of {@link LightVolumeController}. */
export interface LightVolumeOptions {
  /** Worker factory; null bakes on the main thread in time slices. Default: a module worker when available. */
  createWorker?: (() => VolumeWorkerLike) | null;
  /** False while the building is still streaming in or growing (a bake waits). Default: always settled. */
  settled?: () => boolean;
  /** Called after a new volume was uploaded to the light. */
  onUpload?: () => void;
  /** Persistent store of finished bakes; null for none. Default: IndexedDB when available. */
  cache?: VolumeCache | null;
  /** Bakes quicker than this (ms) are not stored. Default {@link CACHE_MIN_BAKE_MS}. */
  cacheMinMs?: number;
  /**
   * Folder of bundled volume files (`<base><key>.lvol`, listed in `<base>index.json` as `{ "volumes": [...] }`: a cooked
   * package's baked light), looked up before the cache and the bake. Null: none.
   */
  staticBase?: string | null;
  fetchBytes?: (url: string, json?: boolean) => Promise<Uint8Array | null>;
}

/** Bake state and the light that shows it (see the module comment). */
export class LightVolumeController {
  readonly light = new LightVolume();
  /** Main-thread bake (no worker). */
  private baker: LightVolumeBaker | null = null;
  /** Worker bake in flight. */
  private job: { id: number; grid: VolumeGrid; lookup?: boolean } | null = null;
  private readonly cache: VolumeCache | null;
  private readonly cacheMinMs: number;
  /** Cache key of the bake in flight (stored when it finishes slowly enough to be worth it). */
  private bakeKey: string | null = null;
  private bakingGrid: VolumeGrid | null = null;
  /** Sun keys of the bake in flight. */
  private bakingKeys: V3[] = [];
  private grid: VolumeGrid | null = null;
  /** The volume for the live light (what the GPU holds): {@link base} with the parts combined into its light floats. */
  private data: Float32Array | null = null;
  /** The bake: visibility and free distances (light floats zero), the parts, and the sun keys they were baked for. */
  private base: Float32Array | null = null;
  private parts: Float32Array | null = null;
  private keys: V3[] = [];
  /** The live light (`relight`) and its weights per part. */
  private live: RelightLighting | null = null;
  private coeffs: Float32Array = new Float32Array(0);
  /** Volumes handed to the worker or baked here since the controller was made (a bundled or cached one never counts). */
  bakesStarted = 0;
  /** Where the volume on screen came from. */
  source: 'bake' | 'cache' | 'static' | null = null;
  private staticIndex: Promise<Set<string>> | null = null;
  private staticBase: string | null;
  private readonly fetchBytes: (url: string, json?: boolean) => Promise<Uint8Array | null>;
  private pending = false;
  private enabled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly scratch = new Float32Array(FLOATS_PER_PROBE);
  private readonly bounds = new Box3();
  /** World box of the building shell of the volume on screen. */
  readonly shellBounds = new Box3();
  private readonly pendingBounds = new Box3();
  private bakeStarted = 0;
  private bakeWork = 0;
  private triangles = 0;
  private probes = 0;
  private worker: VolumeWorkerLike | null = null;
  private workerFailed = false;
  private readonly factory: (() => VolumeWorkerLike) | null;
  /** The `volume` slot of the page's worker budget, held while the worker bakes (null with an injected worker: tests). */
  private readonly slot: WorkerSlot | null;
  private readonly settled: () => boolean;
  private readonly onUpload: () => void;
  private nextId = 1;
  private disposed = false;
  /** Lamps of the volume on screen at full strength (the eye's exposure counts their direct light, at the live scale). */
  private lamps: VolumeLamp[] = [];
  private pendingLamps: VolumeLamp[] = [];
  /** The last finished bake: probes, triangles, work time on the main thread (ms) and wall time (ms). */
  lastBake: { probes: number; triangles: number; workMs: number; wallMs: number; spacing: number; worker: boolean; cached?: boolean } | null = null;

  /** `gather` is called when a bake starts: the parts, the lighting and the building's ground height (null: nothing to bake). */
  constructor(private readonly gather: VolumeGather, opts: LightVolumeOptions = {}) {
    this.light.visible = false;
    this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
    this.slot = opts.createWorker === undefined && this.factory ? new WorkerSlot('volume') : null;
    this.settled = opts.settled ?? (() => true);
    this.onUpload = opts.onUpload ?? (() => undefined);
    this.cache = opts.cache === undefined ? createIdbVolumeCache() : opts.cache;
    this.cacheMinMs = opts.cacheMinMs ?? CACHE_MIN_BAKE_MS;
    this.staticBase = opts.staticBase ?? null;
    this.fetchBytes = opts.fetchBytes ?? defaultFetch;
  }

  /** Where bundled volume files are served (a cooked package's baked light), or null; the next bake looks there first. */
  setStaticBase(base: string | null): void {
    if (base === this.staticBase) return;
    this.staticBase = base;
    this.staticIndex = null;
  }

  /** The volume on screen as a `.lvol` file and its key (`light-volume-asset.ts`), or null. */
  async asset(): Promise<{ key: string; bytes: Uint8Array } | null> {
    const key = this.key;
    const g = this.grid;
    if (!key || !g || !this.base || !this.parts) return null;
    return { key, bytes: await packVolumeAsset({ key, grid: g, keys: this.keys, data: this.base, light: this.parts }) };
  }

  /**
   * The light changed (the hour, the sun, the sky, the lamps' daylight scale): the parts are weighted again and the bounce
   * sub-volumes re-uploaded. Never a bake; a few milliseconds.
   */
  relight(l: RelightLighting): void {
    this.live = l;
    const g = this.grid, base = this.base, parts = this.parts, data = this.data;
    if (!g || !base || !parts || !data || this.disposed) return;
    this.coeffs = relightCoefficients(this.keys, l, this.coeffs);
    combineVolume(g.nx * g.ny * g.nz, base, parts, partCount(this.keys.length), this.coeffs, data);
    this.light.setBakeLight(g, data);
  }

  /** Turn the volume on (a world with buildings) or off. Off drops the bake. */
  setEnabled(on: boolean): void {
    if (on === this.enabled || this.disposed) return;
    this.enabled = on;
    this.light.visible = on;
    if (!on) {
      this.cancel();
      this.pending = false;
      this.grid = null;
      this.data = null;
      this.base = null;
      this.parts = null;
      this.light.clearBake();
      this.shellBounds.makeEmpty();
    } else {
      this.invalidate();
    }
  }

  get active(): boolean {
    return this.enabled;
  }

  /** The building or its lighting changed: bake again once it has settled ({@link SETTLE_SECONDS} of quiet). */
  invalidate(): void {
    if (!this.enabled || this.disposed) return;
    this.cancel();
    this.pending = true;
    this.schedule(SETTLE_SECONDS * 1000);
  }

  private schedule(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, ms);
  }

  /** Timer work: start a settled bake, or advance a main-thread bake by one slice. */
  private tick(): void {
    if (!this.enabled || this.disposed) return;
    if (this.pending) {
      if (!this.settled()) {
        this.schedule(200);
        return;
      }
      this.pending = false;
      this.start();
    }
    const b = this.baker;
    if (!b || !this.bakingGrid) return;
    const t0 = performance.now();
    const finished = b.step(BAKE_SLICE_MS);
    this.bakeWork += performance.now() - t0;
    if (!finished) {
      // Yield to the frame loop between slices.
      this.schedule(4);
      return;
    }
    this.baker = null;
    this.accept(this.bakingGrid, b.data, b.light, this.bakingKeys, 'bake', false);
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.baker = null;
    this.bakingGrid = null;
    this.bakeKey = null;
    if (this.job && this.worker && !this.job.lookup) {
      // A stale multi-second bake would hold the worker: replace it.
      this.worker.terminate();
      this.worker = null;
    }
    this.job = null;
    this.slot?.release();
  }

  /** A bake is pending or running. */
  get baking(): boolean {
    return this.enabled && (this.pending || this.baker !== null || this.job !== null);
  }

  /** The finished volume on screen, its parts and sun keys (the lightmap bake reads them for the bounces it does not trace), or null. */
  get bakedVolume(): { grid: VolumeGrid; data: Float32Array; light: Float32Array; keys: readonly V3[] } | null {
    return this.enabled && this.grid && this.base && this.parts ? { grid: this.grid, data: this.base, light: this.parts, keys: this.keys } : null;
  }

  /** A finished bake is on screen. */
  get ready(): boolean {
    return this.enabled && this.data !== null;
  }

  /** Share of the current bake done (1 when idle). */
  get progress(): number {
    if (this.baker) return this.baker.progress;
    return this.pending || this.job ? 0 : 1;
  }

  /** Run a pending or running bake to completion now on this thread (stills, tests). True when a volume is ready. */
  finishNow(): boolean {
    if (!this.enabled || this.disposed) return false;
    if (this.job) {
      this.cancel();
      this.pending = true;
    }
    if (this.pending) {
      this.cancel();
      this.pending = false;
      this.start(true);
    }
    const b = this.baker;
    if (b && this.bakingGrid) {
      const t0 = performance.now();
      b.run();
      this.bakeWork += performance.now() - t0;
      this.baker = null;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.accept(this.bakingGrid, b.data, b.light, this.bakingKeys, 'bake', false);
    }
    return this.ready;
  }

  private accept(grid: VolumeGrid, data: Float32Array, light: Float32Array, keys: readonly V3[], source: 'bake' | 'cache' | 'static', worker: boolean): void {
    const wallMs = Math.round(performance.now() - this.bakeStarted);
    this.lastBake = { probes: this.probes, triangles: this.triangles, workMs: Math.round(this.bakeWork), wallMs, spacing: grid.spacing, worker, ...(source !== 'bake' ? { cached: true } : {}) };
    if (this.cache && this.bakeKey && source === 'bake' && wallMs >= this.cacheMinMs) {
      const both = new Float32Array(data.length + light.length);
      both.set(data);
      both.set(light, data.length);
      void this.cache.put(this.bakeKey, both);
    }
    this.shownKey = this.bakeKey;
    this.bakeKey = null;
    this.grid = grid;
    this.base = data;
    this.parts = light;
    this.keys = keys.slice();
    this.source = source;
    this.data = new Float32Array(data.length);
    this.coeffs = relightCoefficients(this.keys, this.live ?? NO_LIGHT, this.coeffs);
    combineVolume(grid.nx * grid.ny * grid.nz, data, light, partCount(this.keys.length), this.coeffs, this.data);
    this.bakingGrid = null;
    this.shellBounds.copy(this.pendingBounds);
    this.lamps = this.pendingLamps;
    this.light.setBake(grid, this.data);
    this.onUpload();
  }

  private start(inline = false): void {
    const t0 = performance.now();
    const g = this.gather();
    if (!g) return;
    this.live = g.lighting.live;
    const input = collectTraceInput(g.parts, this.bounds);
    if (!input || this.bounds.isEmpty()) return;
    const min = this.bounds.min;
    const max = this.bounds.max;
    const grid = planVolumeGrid([min.x, Math.max(min.y, g.groundY - 0.5), min.z], [max.x, max.y, max.z]);
    if (!grid) return;
    this.pendingBounds.copy(this.bounds);
    this.bakingGrid = grid;
    this.bakeStarted = t0;
    this.triangles = input.albedo.length / 3;
    this.probes = grid.nx * grid.ny * grid.nz;
    const keys = sunKeyDirections();
    this.bakingKeys = keys;
    const lamps = g.lighting.lamps.slice(0, MAX_LAMPS).map((l) => ({ position: [...l.position] as [number, number, number], color: [...l.color] as [number, number, number], range: l.range }));
    const ground = { y: g.groundY, albedo: g.lighting.groundAlbedo };
    this.pendingLamps = g.lighting.lamps.slice(0, MAX_LAMPS).map((l) => ({ position: [...l.position] as [number, number, number], color: [...l.color] as [number, number, number], range: l.range, ...(l.room ? { room: [...l.room] as [number, number, number, number, number, number] } : {}) }));
    this.bakeWork = performance.now() - t0;
    // The key holds the geometry and what the bake reads, not the light it is shown in: the hour never changes it.
    this.bakeKey = volumeFileKey(grid, input, [ground, lamps, keys]);
    if ((this.cache || this.staticBase) && !inline) {
      // The same building was baked before (a cooked package, an earlier visit): take it, bake only on a miss.
      const id = this.nextId++;
      const grid0 = grid;
      const key = this.bakeKey;
      this.job = { id, grid, lookup: true };
      void this.lookup(key, grid0, keys).then((hit) => {
        if (this.disposed || !this.enabled || this.job?.id !== id) return;
        this.job = null;
        if (hit) {
          this.accept(grid0, hit.data, hit.light, keys, hit.source, false);
          return;
        }
        this.dispatch(input, grid0, keys, ground, lamps);
      });
      return;
    }
    this.dispatch(input, grid, keys, ground, lamps, inline);
  }

  /** The key of the volume on screen (a cooked package names its file after it), or null. */
  get key(): string | null {
    return this.data ? this.shownKey : null;
  }
  private shownKey: string | null = null;

  /** A stored volume for `key`: the bundled file first, then the cache. */
  private async lookup(key: string, grid: VolumeGrid, keys: readonly V3[]): Promise<{ data: Float32Array; light: Float32Array; source: 'static' | 'cache' } | null> {
    const probes = grid.nx * grid.ny * grid.nz;
    const PF = volumeLightFloats(keys.length);
    if (this.staticBase) {
      const have = await this.staticKeys();
      if (have.has(key)) {
        const bytes = await this.fetchBytes(`${this.staticBase}${key}.lvol`);
        const a = bytes ? await unpackVolumeAsset(bytes) : null;
        if (a && a.key === key && a.grid.nx === grid.nx && a.grid.ny === grid.ny && a.grid.nz === grid.nz && a.keys.length === keys.length) return { data: a.data, light: a.light, source: 'static' };
        if (a) log.warn(`bundled light volume ${key} does not fit this building`);
      } else if (have.size === 1) {
        // The package's only volume, baked for this building elsewhere (the editor's publish, geometry a hair off): taken when
        // its grid and sun keys are this building's.
        const only = [...have][0] as string;
        const bytes = await this.fetchBytes(`${this.staticBase}${only}.lvol`);
        const a = bytes ? await unpackVolumeAsset(bytes) : null;
        const fits = (x: number, y: number): boolean => Math.abs(x - y) < 1e-3;
        if (a && a.grid.nx === grid.nx && a.grid.ny === grid.ny && a.grid.nz === grid.nz && fits(a.grid.spacing, grid.spacing) && a.grid.min.every((v, i) => fits(v, grid.min[i] as number)) && a.keys.length === keys.length) return { data: a.data, light: a.light, source: 'static' };
      }
    }
    if (this.cache) {
      const hit = await this.cache.get(key, probes * (FLOATS_PER_PROBE + PF));
      if (hit && hit.length === probes * (FLOATS_PER_PROBE + PF)) return { data: hit.slice(0, probes * FLOATS_PER_PROBE), light: hit.slice(probes * FLOATS_PER_PROBE), source: 'cache' };
    }
    return null;
  }

  /** The volume keys of the bundled folder (empty without an index). Fetched once. */
  private staticKeys(): Promise<Set<string>> {
    this.staticIndex ??= (async () => {
      const bytes = await this.fetchBytes(`${this.staticBase}index.json`, true);
      try {
        const raw = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as { volumes?: unknown }) : null;
        return new Set(Array.isArray(raw?.volumes) ? raw.volumes.filter((k): k is string => typeof k === 'string' && VOLUME_FILE_KEY.test(k)) : []);
      } catch {
        return new Set<string>();
      }
    })();
    return this.staticIndex;
  }

  /** Bake `input` in the worker, or on this thread in slices when there is none (or `inline`). */
  private dispatch(input: Required<TraceInput>, grid: VolumeGrid, keys: V3[], ground: { y: number; albedo: V3 }, lamps: VolumeLamp[], inline = false): void {
    const w = inline ? null : this.ensureWorker();
    if (w && this.slot && !this.slot.held) {
      // The bake waits for a slot of the page's worker budget (more urgent work goes first); still "baking" meanwhile.
      const wait = this.nextId++;
      this.job = { id: wait, grid, lookup: true };
      const go = (): void => {
        if (this.disposed || !this.enabled || this.job?.id !== wait) {
          this.slot?.release();
          return;
        }
        this.job = null;
        this.dispatch(input, grid, keys, ground, lamps);
      };
      if (!this.slot.claim(go)) return;
      this.job = null;
    }
    this.bakingKeys = keys;
    this.bakesStarted++;
    if (w) {
      const id = this.nextId++;
      const req: VolumeRequest = { type: 'bake', id, grid, positions: input.positions, albedo: input.albedo, twoSided: input.twoSided, sunKeys: keys, ground, lamps };
      try {
        w.postMessage(req, [input.positions.buffer, input.albedo.buffer, input.twoSided.buffer]);
        this.job = { id, grid };
        return;
      } catch (e) {
        this.dropWorker(`could not post a light-volume bake: ${e instanceof Error ? e.message : String(e)}`);
        // The buffers may have been detached by a failed transfer: gather again for the main-thread bake.
        this.bakeKey = null;
        this.start(true);
        return;
      }
    }
    const scene = new TraceScene(input);
    this.baker = new LightVolumeBaker({ grid, scene, sunKeys: keys, ground, lamps });
    if (!inline) this.schedule(0);
  }

  private ensureWorker(): VolumeWorkerLike | null {
    if (this.worker) return this.worker;
    if (this.workerFailed || !this.factory) return null;
    try {
      const w = this.factory();
      w.onmessage = (e: MessageEvent) => this.onReply(e.data);
      w.onerror = () => {
        const lost = this.job !== null;
        this.dropWorker('the light-volume worker failed');
        // Bake the lost job on the main thread instead.
        if (lost && this.enabled) {
          this.pending = true;
          this.schedule(0);
        }
      };
      this.worker = w;
      return w;
    } catch (e) {
      this.dropWorker(`no light-volume worker: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private dropWorker(why: string): void {
    log.warn(why);
    this.workerFailed = true;
    this.worker?.terminate();
    this.worker = null;
    this.job = null;
    this.slot?.release();
  }

  private onReply(raw: unknown): void {
    const job = this.job;
    if (!job || this.disposed) return;
    // A late answer to a cancelled job is not this job's.
    if ((raw as { id?: unknown } | null)?.id !== job.id) return;
    const reply = parseVolumeReply(raw, job.grid, this.bakingKeys.length);
    this.job = null;
    this.slot?.release();
    if (!reply) {
      log.warn('malformed light-volume reply ignored');
      return;
    }
    if (!reply.ok) {
      log.warn(`light-volume bake failed: ${reply.error}`);
      return;
    }
    if (!this.enabled) return;
    this.accept(job.grid, reply.data, reply.light, this.bakingKeys, 'bake', true);
  }

  /**
   * What the volume gives an eye at `x, y, z`: mean sky visibility over six directions, the mean bounce luminance
   * and the mean direct light of nearby lamps on the same storey, and the red and blue of the room's light (sky through
   * the windows and the bounce, which carries the lamps' light off the walls: the white balance; null without a bake or
   * outside the volume's box).
   */
  eyeSample(x: number, y: number, z: number): { vis: number; bounce: number; lamps: number; r: number; b: number } | null {
    const g = this.grid;
    const d = this.data;
    if (!g || !d || !Number.isFinite(x + y + z)) return null;
    const ex = g.spacing * (g.nx - 1);
    const ey = g.spacing * (g.ny - 1);
    const ez = g.spacing * (g.nz - 1);
    if (x < g.min[0] || y < g.min[1] || z < g.min[2] || x > g.min[0] + ex || y > g.min[1] + ey || z > g.min[2] + ez) return null;
    let vis = 0;
    let bounce = 0;
    let red = 0;
    let blue = 0;
    const amb = this.live?.ambient;
    const ambR = amb ? Math.max(0, amb.a[0] + amb.b[0] * 0.5) : 1;
    const ambB = amb ? Math.max(0, amb.a[2] + amb.b[2] * 0.5) : 1;
    const lampScale = this.live ? Math.max(0, this.live.lampScale) : 1;
    for (const n of SIX) {
      const s = sampleVolume(g, d, x, y, z, n, this.scratch);
      vis += s.vis;
      bounce += 0.2126 * s.bounce[0] + 0.7152 * s.bounce[1] + 0.0722 * s.bounce[2];
      red += s.bounce[0] + s.vis * ambR;
      blue += s.bounce[2] + s.vis * ambB;
    }
    // Lamps within a few metres on this storey (no occlusion test: a coarse but cheap stand-in for the room's lamps).
    let lamps = 0;
    for (const l of this.lamps) {
      // A lamp confined to a room lights the eye only in that room.
      const rm = l.room;
      if (rm && (x < rm[0] || y < rm[1] || z < rm[2] || x > rm[3] || y > rm[4] || z > rm[5])) continue;
      const dx = l.position[0] - x;
      const dy = l.position[1] - y;
      const dz = l.position[2] - z;
      if (Math.abs(dy) > EYE_LAMP_STOREY) continue;
      const d2 = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(d2);
      if (d > Math.min(EYE_LAMP_REACH, l.range) || d < 1e-3) continue;
      const f = 1 - (d / l.range) ** 4;
      // Mean over the six axis directions of the cosine term: (|lx| + |ly| + |lz|) / 6 of a unit light vector.
      const cos = (Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) / (6 * d);
      const lum = 0.2126 * l.color[0] + 0.7152 * l.color[1] + 0.0722 * l.color[2];
      lamps += (lum * lampScale * f * f * cos) / Math.max(0.25, d2);
    }
    return { vis: vis / 6, bounce: bounce / 6, lamps, r: red / 6, b: blue / 6 };
  }

  dispose(): void {
    this.cancel();
    this.slot?.dispose();
    this.disposed = true;
    this.enabled = false;
    this.worker?.terminate();
    this.worker = null;
    this.data = null;
    this.light.dispose();
  }
}

/** No light at all (a volume shown before the renderer said what the light is reads no bounce until it does). */
const NO_LIGHT: RelightLighting = { sun: null, ambient: { a: [0, 0, 0], b: [0, 0, 0] }, lampScale: 0 };

/** A bundled volume file's name (`light-volume-cache.ts` `volumeFileKey`). */
const VOLUME_FILE_KEY = /^lv\d+-[0-9a-f]{32}$/;

async function defaultFetch(url: string, json = false): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    // A dev server answers a missing file with its index page: only a binary answer can be a volume, only JSON an index.
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (json ? !/json/i.test(type) : /html|json|text/i.test(type)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength >= 16 && buf.byteLength <= VOLUME_MAX_ASSET_BYTES ? buf : null;
  } catch {
    return null;
  }
}

const SIX: readonly V3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

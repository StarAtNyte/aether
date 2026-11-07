/**
 * Drives the baked lightmap of a building: when to bake, the worker, the cache, applying it to the meshes and taking it back.
 *
 * The lightmap needs the finished light volume (its later bounces, see `environment/lightmap.ts`), so it starts only once
 * the volume is on screen. A key over everything the bake reads (the surfaces, the trace scene, the volume, the light, the
 * plan) names the result: a static file of a bundled world, then the browser cache, then the worker, in that order. Whatever
 * comes first is applied: the atlas goes to the GPU and the baked meshes get their coordinates.
 *
 * Rules the controller keeps:
 * - It never blocks a frame: gathering and applying run in slices of a few milliseconds, the bake is in a worker (no worker:
 *   no bake), and an unapplied or failed lightmap just leaves the light volume lighting the building.
 * - Any change to the building or its light drops the lightmap at once (geometry put back) and starts over once the volume has.
 * - Baking is visible ({@link status}) and can be cancelled; a cancelled bake is not started again for the same building.
 * - Baked light is re-lightable (`environment/relight.ts`): the key holds the building, never the hour, so a change of the
 *   time of day, the sky or the lamps' daylight scale keeps the lightmap and only re-weights its parts (uniforms of the light).
 * - Nothing bakes on its own. A viewer (the player) only loads what the cooked package ships ({@link LightmapOptions.autoLoad});
 *   the editor draws real-time light and bakes only when asked ({@link request}: the "Preview baked light" action, the
 *   assistant's `bake_light`), and only where baking is allowed ({@link LightmapOptions.bakeAllowed}).
 * - The bake takes a `bake` slot of the page's worker budget (@aether/core worker-scheduler) before it starts, and parks the
 *   worker between slices (giving the slot back) while the scheduler asks it to yield: the first picture, a drag, the view
 *   moving, or more urgent work waiting for a core.
 */
import { Box3, type BufferGeometry, type Mesh } from 'three';
import { WorkerSlot } from '@aether/core';
import { log } from '../log';
import { LIGHTMAP_ATTRIBUTE, LightVolume } from '../environment/light-volume-light';
import { MAX_TRACE_TRIANGLES, partsField, partsFieldSliced, type TraceInput, type V3, type VolumeGrid } from '../environment/light-volume';
import { partCount, RELIGHT_VERSION } from '../environment/relight';
import {
  LIGHTMAP_VERSION,
  LIGHTMAP_MAX_TRIANGLES,
  meshTriangleCount,
  planLightmap,
  type LightmapMesh,
  type LightmapPlan,
  type LightmapQuality,
} from '../environment/lightmap';
import { LIGHTMAP_MAX_ASSET_BYTES, contentHash, contentHashSliced, lightmapKey, packAsset, stackAtlas, unpackAsset, unstackAtlas, type LightmapAssetMeta } from '../environment/lightmap-asset';
import { LIGHTMAP_CACHE_MIN_BAKE_MS, createIdbLightmapCache, type LightmapCache } from '../environment/lightmap-cache';
import { VOLUME_BAKE_VERSION } from '../environment/light-volume-cache';
import { decodeImage, encodeImage } from '../environment/lightmap-codec';
import { parseLightmapReply, type LightmapRequest } from '../environment/lightmap-protocol';
import { collectTraceInput, type TraceProxy, type VolumeLighting, type VolumePart } from './light-volume-controller';
import { refreshProgram, type LightmapSource } from '../sync/lightmap-uv';
import { expandWithLightmap, lightmapEligible, mergeMeshData, worldMeshData } from './lightmap-geometry';

/** Quiet time (s) after the volume is up before an automatic bake starts. */
export const LIGHTMAP_SETTLE_SECONDS = 1.2;
/** Milliseconds of main-thread work per slice while gathering and applying. */
export const LIGHTMAP_SLICE_MS = 5;

export type LightmapState = 'off' | 'idle' | 'waiting' | 'baking' | 'applied' | 'failed' | 'cancelled';

/** What the studio shows. */
export interface LightmapStatus {
  state: LightmapState;
  /** 0..1 while baking. */
  progress: number;
  quality: LightmapQuality;
  samples: number;
  /** A sentence for a tooltip or the assistant ("Baked light: 41 000 texels in 38 s", "no worker"). */
  message: string;
}

/** The scene as the renderer hands it over when a bake starts. */
export interface LightmapScene {
  /** The building's own meshes except the walls (the members of merges included, hidden ones too), in priority order. */
  meshes: Mesh[];
  /**
   * The walls, one entry per wall in a stable order, with the meshes the view draws for it. A wall the view has sectioned (`cut`:
   * cutaway, lowered, cut open) draws other geometry than the wall as built: it keeps the light volume's light, and it neither
   * enters the key of the building nor changes which bundled file matches, so a world opened in the cutaway still finds its file.
   */
  walls?: Array<{ meshes: Mesh[]; cut: boolean }>;
  parts: VolumePart[];
  lighting: VolumeLighting;
  groundY: number;
}

export interface LightmapWorkerLike {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface LightmapOptions {
  /** Called when a bake starts: the scene (null: nothing to bake). */
  gather: () => LightmapScene | null;
  /** The building as built (no wall sectioned by the view), for a bake made for a viewer ({@link LightmapController.bakeJob}); default `gather`. */
  gatherBuilt?: () => LightmapScene | null;
  /** The finished light volume on screen with its re-lightable parts, or null. */
  volume: () => { grid: VolumeGrid; data: Float32Array; light: Float32Array; keys: readonly V3[] } | null;
  /** The world has stopped changing (geometry built, no grow-in). */
  settled?: () => boolean;
  /** A lightmap was applied or taken away: redraw, re-adapt. */
  onChange?: () => void;
  /** Merged building geometry carries the coordinates of `source` (null: none). The renderer routes it to the scene sync. */
  attach?: (source: LightmapSource | null) => void;
  /** The status changed. */
  onStatus?: (s: LightmapStatus) => void;
  /**
   * Whether a lightmap nobody asked for is looked up and applied (a bundled file, the cache): the player's cooked worlds. Never a
   * bake. Default false (the editor draws real-time light until "Preview baked light").
   */
  autoLoad?: () => boolean;
  /** Whether {@link LightmapController.request} may bake (false: a request only looks up stored files). Default true. */
  bakeAllowed?: boolean;
  /** Quality of an automatic bake. */
  autoQuality?: () => LightmapQuality;
  createWorker?: (() => LightmapWorkerLike) | null;
  cache?: LightmapCache | null;
  /**
   * Folder of the bundled lightmap files (`<base><key>.lmap`, listed in `<base>index.json` as `{ "keys": [...] }`), or null.
   * The index is fetched once: a world without bundled light costs one request, never one per bake.
   */
  staticBase?: string | null;
  fetchBytes?: (url: string, json?: boolean) => Promise<Uint8Array | null>;
}

const _box = new Box3();

/** Numbers as integers in steps of 1 / `perUnit` (two runs that differ by less than a step hash the same, unless one sits on a step edge). */
function quantize(values: Float32Array, perUnit: number): Int32Array {
  const out = new Int32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.round((values[i] as number) * perUnit);
  return out;
}

function defaultWorker(): LightmapWorkerLike {
  return new Worker(new URL('../environment/lightmap.worker.ts', import.meta.url), { type: 'module' }) as unknown as LightmapWorkerLike;
}

async function defaultFetch(url: string, json = false): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    // A dev server answers a missing file with its index page: only a binary answer can be a lightmap, only JSON an index.
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (json ? !/json/i.test(type) : /html|json|text/i.test(type)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength >= 16 && buf.byteLength <= LIGHTMAP_MAX_ASSET_BYTES * 4 ? buf : null;
  } catch {
    return null;
  }
}

/** One entry of the bake: a mesh, or all the meshes of one wall merged (so the entries do not depend on how a view splits a wall). */
interface Slot {
  meshes: Mesh[];
  /** Triangles of each mesh of the slot (they add up to the slot's triangle count). */
  tris: number[];
  wall: boolean;
  /** A sectioned wall: nothing of it is baked or applied. */
  cut: boolean;
}

interface Prepared {
  slots: Slot[];
  data: LightmapMesh[];
  input: Required<TraceInput>;
  proxies: TraceProxy[];
  grid: VolumeGrid;
  /** The volume's visibility and free distances, its parts and sun keys. */
  volume: Float32Array;
  volumeLight: Float32Array;
  keys: readonly V3[];
  lighting: VolumeLighting;
  groundY: number;
  /** Hash of the arrays (filled on first use). */
  content?: string;
}

export class LightmapController implements LightmapSource {
  private enabled = false;
  private gen = 0;
  private state: LightmapState = 'off';
  private message = '';
  private progressValue = 0;
  private plan: LightmapPlan = planLightmap('medium');
  /** Whether the plan was chosen by a request (the assistant, the user) rather than by the automatic policy. */
  private requested = false;
  /** The request may bake where baking is otherwise not allowed (the cook). */
  private forced = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private worker: LightmapWorkerLike | null = null;
  private workerFailed = false;
  private jobId = 0;
  private job: { id: number; gen: number; key: string; triCounts: number[]; started: number; prepared: Prepared; parkedMs: number; parkedAt: number } | null = null;
  /** The `bake` slot of the page's worker budget (null with an injected worker: tests). */
  private readonly slot: WorkerSlot | null;
  private yieldTimer: ReturnType<typeof setInterval> | null = null;
  /** Meshes that draw themselves with their own copy of the geometry → the geometry they had. */
  private readonly swapped = new Map<Mesh, { original: BufferGeometry; clone: BufferGeometry }>();
  /** Baked coordinates of every baked mesh of the building (merged members too). */
  private readonly uvs = new Map<Mesh, Float32Array>();
  private suppressed: string | null = null;
  /** The world turned baked light off (`environment.lightBake.quality: 'off'`). */
  private off = false;
  /** The applied lightmap was baked for an earlier light: a new bake may replace it. */
  private stale = false;
  private lastKey: string | null = null;
  private appliedKey: string | null = null;
  private appliedBytes: Uint8Array | null = null;
  private disposed = false;
  /** A bake is scheduled or being decided (gathering, looking for a stored lightmap): not final yet. */
  private looking = false;
  /** A bundled or cached file is being given to the surfaces (a few slices): not a bake, so no status pill, but not final either. */
  private applying = false;
  /** What the last key was made of (a bundled file that does not match: compare this with the one it was baked from). */
  keyInputs: { content: string; scalars: string } | null = null;
  keyParts: string[] | null = null;
  /** Bakes handed to the worker since the controller was made (a bundled or cached lightmap never counts). */
  bakesStarted = 0;
  private readonly cache: LightmapCache | null;
  private readonly factory: (() => LightmapWorkerLike) | null;
  /** The last finished bake or load: what it was and what it cost. */
  lastBake: { key: string; source: 'bake' | 'cache' | 'static'; texels: number; rays: number; meshes: number; triangles: number; wallMs: number; size: number; bytes: number } | null = null;

  constructor(readonly light: LightVolume, private readonly opts: LightmapOptions) {
    this.cache = opts.cache === undefined ? createIdbLightmapCache() : opts.cache;
    this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
    this.slot = opts.createWorker === undefined && this.factory ? new WorkerSlot('bake') : null;
  }

  get status(): LightmapStatus {
    return { state: this.state, progress: this.progressValue, quality: this.plan.quality, samples: this.plan.samples, message: this.message };
  }

  /** A bake is waiting for the volume, gathering, or running (captures that want the final light wait for it). */
  get baking(): boolean {
    return this.enabled && (this.state === 'baking' || this.state === 'waiting' || this.looking || this.applying);
  }

  /** A lightmap is applied to the building. */
  get ready(): boolean {
    return this.enabled && this.state === 'applied' && this.uvs.size > 0;
  }

  /** Meshes that carry the lightmap. */
  get meshCount(): number {
    return this.swapped.size;
  }

  /** Surfaces carry baked coordinates (the light node must stay in the scene even when the volume is cut). */
  get hasMeshes(): boolean {
    return this.enabled && this.uvs.size > 0;
  }

  /** {@link LightmapSource}: a merge asks for the coordinates of one of its members. */
  uv(mesh: Mesh): Float32Array | null {
    return this.uvs.get(mesh) ?? null;
  }

  /** {@link LightmapSource}: a baked member left its merge and draws itself. */
  standalone(mesh: Mesh): void {
    const u = this.uvs.get(mesh);
    if (!u || this.swapped.has(mesh)) return;
    const original = mesh.geometry;
    const tris = original.index ? original.index.count / 3 : original.getAttribute('position').count / 3;
    if (tris * 6 !== u.length) return;
    const clone = expandWithLightmap(original, u);
    mesh.geometry = clone;
    this.swapped.set(mesh, { original, clone });
    refreshProgram(mesh);
  }

  /** The bytes of the applied lightmap (the `.lmap` file: save it with the project, ship it with a bundled world). */
  get asset(): Uint8Array | null {
    return this.appliedBytes;
  }

  get key(): string | null {
    return this.appliedKey ?? this.lastKey;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled || this.disposed) return;
    this.enabled = on;
    if (!on) {
      this.drop();
      this.setState('off', '');
    } else {
      this.setState('idle', '');
      this.schedule(LIGHTMAP_SETTLE_SECONDS * 1000);
    }
  }

  /**
   * The building changed (`geometry`): the lightmap goes at once and the volume's light shows until a new one is ready. Only its
   * light changed (`light`: the hour, a lamp): the lightmap stays on screen, like the previous volume does, until the new one is
   * ready, so dragging the sun does not flicker between two lightings.
   */
  invalidate(kind: 'geometry' | 'light' = 'geometry'): void {
    if (!this.enabled || this.disposed) return;
    if (kind === 'geometry') {
      const had = this.uvs.size > 0;
      this.drop();
      this.setState('idle', '');
      if (had) this.opts.onChange?.();
    } else {
      this.stop();
      this.stale = true;
      if (this.state === 'baking' || this.state === 'waiting') this.setState(this.uvs.size > 0 ? 'applied' : 'idle', '');
    }
    this.suppressed = null;
  }

  /** The light volume has a new bake: a lightmap can follow (automatic policy permitting). */
  volumeChanged(): void {
    if (!this.enabled || this.disposed) return;
    this.schedule(LIGHTMAP_SETTLE_SECONDS * 1000);
  }

  /**
   * The host's verdict on an automatic bake may have changed (the quality tier rose from low): a building the automatic policy
   * left without a lightmap is looked at again. Before this, a world opened on the low tier stayed idle ("no baked light for
   * this building yet") after a switch to ultra, because nothing scheduled another look. Running, applied, cancelled, failed and
   * requested bakes are left as they are.
   */
  policyChanged(): void {
    if (!this.enabled || this.disposed || this.off || this.requested || this.looking || this.applying) return;
    if (this.state !== 'idle') return;
    this.schedule(LIGHTMAP_SETTLE_SECONDS * 1000);
  }

  /** An automatic look is scheduled or a result is being applied (not a running bake: see {@link status}). */
  get deciding(): boolean {
    return this.enabled && !this.disposed && (this.looking || this.applying);
  }

  /**
   * Bake now at this quality (the editor's "Preview baked light", the cook). Replaces a running or applied bake. Where baking is
   * not allowed a request only looks for a stored lightmap, unless `force` (the cook's own page).
   */
  request(quality: LightmapQuality, samples?: number, force = false): void {
    if (!this.enabled || this.disposed) return;
    this.drop();
    this.requested = true;
    this.forced = force;
    this.off = false;
    this.suppressed = null;
    this.plan = planLightmap(quality, samples);
    this.setState('waiting', 'waiting for the light volume');
    this.schedule(0);
  }

  /** Stop a running or waiting bake (the building keeps the light volume). */
  cancel(): void {
    if (!this.enabled || (this.state !== 'baking' && this.state !== 'waiting')) return;
    this.suppressed = this.lastKey ?? '*';
    this.stop();
    this.setState(this.uvs.size > 0 ? 'applied' : 'cancelled', 'bake cancelled');
  }

  /** The world turned baked light off: the building goes back to the light volume alone. */
  clear(): void {
    this.drop();
    this.off = true;
    this.requested = false;
    if (this.enabled) this.setState('idle', 'baked light is off for this world');
  }

  /** Back to the automatic policy (the world no longer asks for a quality). */
  reset(): void {
    if (!this.requested && !this.off) return;
    this.drop();
    this.off = false;
    this.requested = false;
    this.suppressed = null;
    if (this.enabled) {
      this.setState('idle', '');
      this.schedule(LIGHTMAP_SETTLE_SECONDS * 1000);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.drop();
    this.slot?.dispose();
    this.worker?.terminate();
    this.worker = null;
  }

  private setState(state: LightmapState, message: string, progress = 0): void {
    this.state = state;
    this.message = message;
    this.progressValue = progress;
    this.opts.onStatus?.(this.status);
  }

  private schedule(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.looking = !this.off;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.begin().finally(() => {
        if (this.timer === null) this.looking = false;
      });
    }, ms);
  }

  private cancelJob(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.looking = false;
    if (this.job && this.worker) {
      // A stale multi-second bake would hold the worker: replace it.
      this.worker.terminate();
      this.worker = null;
    }
    this.endJob();
  }

  /** No bake runs: the slot goes back and the yield watch stops. */
  private endJob(): void {
    this.job = null;
    if (this.yieldTimer !== null) clearInterval(this.yieldTimer);
    this.yieldTimer = null;
    this.slot?.release();
  }

  /**
   * While a bake runs: park the worker (and give the slot back) when the scheduler asks it to yield, resume it once a slot
   * is granted again.
   */
  private watchYield(id: number): void {
    const slot = this.slot;
    if (!slot) return;
    if (this.yieldTimer !== null) clearInterval(this.yieldTimer);
    const post = (on: boolean): void => {
      try {
        this.worker?.postMessage({ type: 'pause', on });
      } catch {
        // the worker is gone: its error handler ends the job
      }
    };
    this.yieldTimer = setInterval(() => {
      const job = this.job;
      if (!job || job.id !== id) return;
      if (job.parkedAt < 0) {
        if (!slot.mustYield) return;
        job.parkedAt = performance.now();
        post(true);
        slot.release();
        return;
      }
      const resume = (): void => {
        const j = this.job;
        if (!j || j.id !== id) {
          slot.release();
          return;
        }
        if (j.parkedAt < 0) return;
        j.parkedMs += performance.now() - j.parkedAt;
        j.parkedAt = -1;
        post(false);
      };
      if (slot.claim(resume)) resume();
    }, 250);
  }

  /** Running work stops (a result still in flight is ignored). */
  private stop(): void {
    this.gen++;
    this.applying = false;
    this.cancelJob();
  }

  /** Back to the light volume: running work stops, geometry is restored, the atlas is switched off. */
  private drop(): void {
    this.stop();
    const had = this.uvs.size > 0;
    this.uvs.clear();
    // Merged geometry loses its coordinates (rebuilt without), standalone meshes get their own geometry back.
    if (had) this.opts.attach?.(null);
    for (const [mesh, s] of this.swapped) {
      if (mesh.geometry === s.clone) {
        mesh.geometry = s.original;
        refreshProgram(mesh);
      }
      s.clone.dispose();
    }
    this.swapped.clear();
    this.light.clearLightmap();
    this.appliedKey = null;
    this.appliedBytes = null;
    this.stale = false;
  }

  // --- start ---------------------------------------------------------------------------------------------------------

  private async begin(): Promise<void> {
    if (!this.enabled || this.disposed) return;
    const gen = this.gen;
    if (this.off || this.state === 'baking' || (this.state === 'applied' && !this.stale)) return;
    const auto = !this.requested;
    if (this.opts.settled && !this.opts.settled()) {
      this.schedule(250);
      return;
    }
    const vol = this.opts.volume();
    if (!vol) {
      if (this.requested) {
        this.setState('waiting', 'waiting for the light volume');
        this.schedule(400);
      }
      return;
    }
    // Nothing is looked up for a world nobody asked baked light of, unless the host loads stored light on its own (the player).
    if (auto && !(this.opts.autoLoad?.() ?? false)) {
      this.setState('idle', '');
      return;
    }
    if (auto) this.plan = planLightmap(this.opts.autoQuality?.() ?? 'medium');
    const scene = this.opts.gather();
    if (!scene) {
      this.setState('idle', 'no building to bake');
      return;
    }
    const prepared = await this.prepare(scene, vol, gen);
    if (!prepared || gen !== this.gen || !this.enabled) return;
    const key = this.keyOf(prepared, this.plan);
    this.lastKey = key;
    if (this.suppressed === '*' || this.suppressed === key) return;
    if (this.appliedKey === key) {
      this.stale = false;
      return;
    }
    // Bundled file, then cache, then the bake. Without a request any quality that is bundled will do (the best first).
    const candidates = auto ? (['high', 'medium', 'low'] as const).map((q) => this.keyOf(prepared, planLightmap(q))) : [key];
    if (auto && !candidates.includes(key)) candidates.push(key);
    const hit = await this.lookup(candidates);
    if (gen !== this.gen || !this.enabled) return;
    if (hit) {
      if (await this.applyAsset(hit.bytes, prepared, hit.source, gen)) return;
    }
    if (auto || (this.opts.bakeAllowed === false && !this.forced)) {
      this.setState('idle', 'no baked light for this building yet');
      return;
    }
    this.startBake(prepared, key, gen);
  }

  /** Gather the surfaces in world space and the trace scene, a few milliseconds at a time. */
  private async prepare(scene: LightmapScene, vol: { grid: VolumeGrid; data: Float32Array; light: Float32Array; keys: readonly V3[] }, gen: number): Promise<Prepared | null> {
    const slots: Slot[] = [];
    const data: LightmapMesh[] = [];
    let triangles = 0;
    let until = performance.now() + LIGHTMAP_SLICE_MS;
    const pause = async (): Promise<boolean> => {
      if (performance.now() <= until) return true;
      await new Promise<void>((r) => setTimeout(r, 0));
      until = performance.now() + LIGHTMAP_SLICE_MS;
      return gen === this.gen && this.enabled;
    };
    for (const mesh of scene.meshes) {
      if (!lightmapEligible(mesh)) continue;
      const g = mesh.geometry;
      const n = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      if (triangles + n > LIGHTMAP_MAX_TRIANGLES) continue;
      const d = worldMeshData(mesh);
      const count = meshTriangleCount(d);
      slots.push({ meshes: [mesh], tris: [count], wall: false, cut: false });
      data.push(d);
      triangles += count;
      if (!(await pause())) return null;
    }
    for (const wall of scene.walls ?? []) {
      const parts: LightmapMesh[] = [];
      const carried: Mesh[] = [];
      const tris: number[] = [];
      if (!wall.cut) {
        for (const mesh of wall.meshes) {
          if (!lightmapEligible(mesh)) continue;
          const g = mesh.geometry;
          const n = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
          if (triangles + n > LIGHTMAP_MAX_TRIANGLES) continue;
          const d = worldMeshData(mesh);
          parts.push(d);
          carried.push(mesh);
          tris.push(meshTriangleCount(d));
          triangles += tris[tris.length - 1] as number;
        }
      }
      slots.push({ meshes: carried, tris, wall: true, cut: wall.cut });
      data.push(mergeMeshData(parts));
      if (!(await pause())) return null;
    }
    if (slots.every((sl) => sl.meshes.length === 0)) {
      this.setState('idle', 'no surface can carry a lightmap');
      return null;
    }
    const proxies: TraceProxy[] = [];
    const input = collectTraceInput(scene.parts, _box, proxies);
    if (!input || input.albedo.length / 3 > MAX_TRACE_TRIANGLES) {
      this.setState('idle', 'no building to trace');
      return null;
    }
    return { slots, data, input, proxies, grid: vol.grid, volume: vol.data, volumeLight: vol.light, keys: vol.keys, lighting: scene.lighting, groundY: scene.groundY };
  }

  /** The key of this building and light for `plan` (the geometry is hashed once per bake attempt). */
  private keyOf(p: Prepared, plan: LightmapPlan): string {
    if (!p.content) {
      // The walls are in the trace input as built; their drawn meshes (which a view may section) are left out. The numbers are
      // rounded (2 cm, 1 % albedo) and the probe volume's floats are left out (it is a function of the trace and the light, which
      // the key holds): two backends build the same building a fraction of a millimetre apart (a chair box 0.5 mm lower), and the
      // file must match on both.
      const arrays: ArrayBufferView[] = [quantize(p.input.positions, 50), quantize(p.input.albedo, 100), p.input.twoSided];
      p.data.forEach((d, i) => {
        if (!p.slots[i]?.wall) arrays.push(quantize(d.positions, 50), quantize(d.normals, 50));
      });
      p.content = contentHash(arrays);
      // Diagnostics (set `globalThis.__AETHER_KEYDEBUG` before the world opens): one hash per array, to see which one differs between two runs.
      if ((globalThis as { __AETHER_KEYDEBUG?: boolean }).__AETHER_KEYDEBUG) this.keyParts = arrays.map((a, i) => `${i < 3 ? ['trace', 'albedo', 'twoSided'][i] : `mesh${i - 3}`}:${contentHash([a]).slice(0, 8)}:${(a as { length?: number }).length}`);
    }
    const lamps = p.lighting.lamps.map((l) => [l.position, l.color, l.range, l.room ?? null]);
    // The building and what the bake reads, never the light it is shown in (re-lightable: the hour does not change the key). The
    // rays per texel are not in it either: a stored bake with at least the rays asked for will do (see `applyAsset`), so a
    // cooked package's bake (more rays than any plan's default) is found by the plan alone.
    const scalars = [VOLUME_BAKE_VERSION, RELIGHT_VERSION, plan.size, plan.density, p.data.map((d, i) => (p.slots[i]?.wall ? -1 : meshTriangleCount(d))), p.grid, p.keys, p.lighting.groundAlbedo, p.groundY, lamps];
    this.keyInputs = { content: p.content, scalars: JSON.stringify(scalars) };
    return lightmapKey(p.content, scalars);
  }

  private async lookup(keys: readonly string[]): Promise<{ bytes: Uint8Array; source: 'static' | 'cache' } | null> {
    const base = this.opts.staticBase;
    if (base) {
      const have = await this.staticKeys();
      for (const key of keys) {
        if (!have.has(key)) continue;
        const bytes = await (this.opts.fetchBytes ?? defaultFetch)(`${base}${key}.lmap`);
        if (bytes) return { bytes, source: 'static' };
      }
      // A package baked for this one building elsewhere (the editor's publish: its geometry sub-millimetre off the cooked
      // geometry's, so the key differs): its only file, which `applyAsset` takes only if every mesh's triangle count matches.
      if (have.size === 1 && !this.requested) {
        const only = [...have][0] as string;
        const bytes = await (this.opts.fetchBytes ?? defaultFetch)(`${base}${only}.lmap`);
        if (bytes) return { bytes, source: 'static' };
      }
    }
    if (this.cache) {
      for (const key of keys) {
        const bytes = await this.cache.get(key);
        if (bytes) return { bytes, source: 'cache' };
      }
    }
    return null;
  }

  private index: Promise<Set<string>> | null = null;

  /** The keys of the bundled lightmaps (empty when there is no index). */
  private staticKeys(): Promise<Set<string>> {
    this.index ??= (async () => {
      const bytes = await (this.opts.fetchBytes ?? defaultFetch)(`${this.opts.staticBase}index.json`, true);
      try {
        const raw = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as { keys?: unknown }) : null;
        return new Set(Array.isArray(raw?.keys) ? raw.keys.filter((k): k is string => typeof k === 'string' && /^lm\d+-[0-9a-f]{32}$/.test(k)) : []);
      } catch {
        return new Set<string>();
      }
    })();
    return this.index;
  }

  // --- the bake --------------------------------------------------------------------------------------------------------

  private ensureWorker(): LightmapWorkerLike | null {
    if (this.worker) return this.worker;
    if (this.workerFailed || !this.factory) return null;
    try {
      const w = this.factory();
      w.onmessage = (e: MessageEvent) => this.onReply(e.data);
      w.onerror = () => {
        const lost = this.job !== null;
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        this.endJob();
        if (lost) this.setState('failed', 'the lightmap worker failed; the light volume stays');
      };
      this.worker = w;
      return w;
    } catch (e) {
      log.warn(`no lightmap worker: ${e instanceof Error ? e.message : String(e)}`);
      this.workerFailed = true;
      return null;
    }
  }

  private startBake(p: Prepared, key: string, gen: number): void {
    const w = this.ensureWorker();
    if (!w) {
      this.setState('failed', 'no worker for the bake; the light volume stays');
      return;
    }
    // The bake starts holding a slot of the page's worker budget; until one is free it shows as a bake at 0.
    const slot = this.slot;
    if (slot && !slot.held) {
      const go = (): void => {
        if (gen !== this.gen || !this.enabled || this.disposed || this.job) {
          if (!this.job) slot.release();
          return;
        }
        this.startBake(p, key, gen);
      };
      if (!slot.claim(go)) {
        this.setState('baking', 'waiting for a free worker', 0);
        return;
      }
    }
    const id = ++this.jobId;
    const triCounts = p.data.map((d) => meshTriangleCount(d));
    const req = this.request0(p, id, this.plan);
    const transfer: Transferable[] = [req.positions.buffer, req.albedo.buffer, req.twoSided.buffer, req.proxies.buffer, req.field.buffer, req.codes.buffer];
    for (const m of req.meshes) {
      transfer.push(m.positions.buffer, m.normals.buffer);
      if (m.index) transfer.push(m.index.buffer);
    }
    try {
      w.postMessage(req, transfer);
    } catch (e) {
      this.workerFailed = true;
      this.worker?.terminate();
      this.worker = null;
      this.endJob();
      this.setState('failed', `could not start the bake: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.job = { id, gen, key, triCounts, started: performance.now(), prepared: p, parkedMs: 0, parkedAt: -1 };
    this.bakesStarted++;
    this.setState('baking', 'baking light', 0);
    this.watchYield(id);
  }

  /** The worker's request for prepared surfaces and a plan (copies of every array: the request is transferred). */
  private request0(p: Prepared, id: number, plan: LightmapPlan, fields?: { field: Float32Array; stride: number; codes: Float32Array }): LightmapRequest {
    const proxyArr = new Float32Array(p.proxies.length * 7);
    p.proxies.forEach((b, i) => proxyArr.set([...b.lo, ...b.hi, b.tri], i * 7));
    const l = p.lighting;
    return {
      type: 'bake',
      id,
      maxSize: plan.size,
      density: plan.density,
      samples: plan.samples,
      meshes: p.data.map((d) => ({ positions: d.positions.slice(), normals: d.normals.slice(), index: d.index ? d.index.slice() : null })),
      positions: p.input.positions.slice(),
      albedo: p.input.albedo.slice(),
      twoSided: p.input.twoSided.slice(),
      proxies: proxyArr,
      grid: p.grid,
      ...(fields ?? partsField(p.grid.nx * p.grid.ny * p.grid.nz, p.volume, p.volumeLight, partCount(p.keys.length))),
      sunKeys: p.keys.map((k) => [k[0], k[1], k[2]] as V3),
      ground: { y: p.groundY, albedo: l.groundAlbedo },
      lamps: l.lamps.slice(0, 64).map((x) => ({ position: [...x.position] as V3, color: [...x.color] as V3, range: x.range })),
    };
  }

  /**
   * What a bake of this building at `quality` would be given, without baking (a bake made elsewhere: scripts/blender-bake.ts
   * through the cook): the worker's request, the key its file must carry and the triangle count of every offered mesh (the
   * file's `tris`). Null while there is no finished volume or no building.
   */
  async bakeJob(quality: LightmapQuality, samples?: number): Promise<{ key: string; request: LightmapRequest; triCounts: number[] } | null> {
    if (!this.enabled || this.disposed) return null;
    const vol = this.opts.volume();
    const scene = vol ? (this.opts.gatherBuilt ?? this.opts.gather)() : null;
    if (!vol || !scene) return null;
    const plan = planLightmap(quality, samples);
    const p = await this.prepare(scene, vol, this.gen);
    if (!p) return null;
    // The geometry's hash in slices (the same arrays and order as keyOf's).
    if (!p.content) {
      const own = p.data.map((d, i) => (p.slots[i]?.wall ? null : d)).filter((d): d is LightmapMesh => d !== null);
      const fixed = [() => quantize(p.input.positions, 50), () => quantize(p.input.albedo, 100), () => p.input.twoSided];
      p.content = await contentHashSliced((i) => (i < 3 ? fixed[i]!() : i - 3 < own.length * 2 ? quantize((i - 3) % 2 === 0 ? own[(i - 3) >> 1]!.positions : own[(i - 3) >> 1]!.normals, 50) : null));
    }
    const key = this.keyOf(p, plan);
    // Built in slices (the volume's field is tens of megabytes): the page stays responsive while a publish takes the job.
    await new Promise((r) => setTimeout(r, 0));
    const fields = await partsFieldSliced(p.grid.nx * p.grid.ny * p.grid.nz, p.volume, p.volumeLight, partCount(p.keys.length));
    await new Promise((r) => setTimeout(r, 0));
    return { key, request: this.request0(p, 0, plan, fields), triCounts: p.data.map((d) => meshTriangleCount(d)) };
  }

  /**
   * Apply a finished `.lmap` made elsewhere (scripts/blender-bake.ts) as if this controller had baked it: it must match the
   * building (key, triangle counts, sun keys). True when applied.
   */
  async applyFile(bytes: Uint8Array): Promise<boolean> {
    if (!this.enabled || this.disposed) return false;
    const vol = this.opts.volume();
    const scene = vol ? this.opts.gather() : null;
    if (!vol || !scene) return false;
    const gen = this.gen;
    const p = await this.prepare(scene, vol, gen);
    if (!p) return false;
    this.requested = true;
    this.forced = true;
    return this.applyAsset(bytes, p, 'static', gen);
  }

  private onReply(raw: unknown): void {
    const job = this.job;
    if (!job || this.disposed || job.gen !== this.gen) return;
    if ((raw as { id?: unknown } | null)?.id !== job.id) return;
    const reply = parseLightmapReply(raw, job.triCounts, job.prepared.keys.length);
    if (!reply) {
      log.warn('malformed lightmap reply ignored');
      this.endJob();
      this.setState('failed', 'the bake returned something unusable; the light volume stays');
      return;
    }
    if (reply.type === 'progress') {
      this.progressValue = reply.value;
      this.opts.onStatus?.(this.status);
      return;
    }
    this.endJob();
    if (job.parkedMs > 0) log.info(`lightmap: the bake was parked for ${Math.round(job.parkedMs)} ms (worker scheduler)`);
    if (!reply.ok) {
      log.warn(`lightmap bake failed: ${reply.error}`);
      this.setState('failed', `bake failed: ${reply.error}`);
      return;
    }
    void this.finishBake(job, reply);
  }

  private async finishBake(job: NonNullable<LightmapController['job']>, r: Extract<ReturnType<typeof parseLightmapReply>, { ok: true }>): Promise<void> {
    const wallMs = Math.round(performance.now() - job.started);
    const meta: LightmapAssetMeta = {
      version: LIGHTMAP_VERSION,
      key: job.key,
      size: r.size,
      layers: r.layers,
      scales: Array.from(r.scales),
      keys: job.prepared.keys.map((k) => [k[0], k[1], k[2]] as [number, number, number]),
      quality: this.plan.quality,
      samples: this.plan.samples,
      density: r.density,
      charts: r.charts,
      texels: r.texels,
      rays: r.rays,
      bakeMs: wallMs,
      tris: r.uv.map((u, i) => (u ? (job.triCounts[i] as number) : -1)),
      image: 'raw',
    };
    const rows = r.layers + 1;
    const stacked = stackAtlas(r.rgba, r.size, r.layers);
    // WebP when the browser can encode it (lossless first, a fraction of the raw size), else PNG, else the raw atlas.
    let image: Uint8Array = stacked;
    for (const q of [1, 0.95, 0.9, 0.8]) {
      const webp = await encodeImage(stacked, r.size, rows, 'webp', q);
      if (!webp) break;
      image = webp;
      meta.image = 'webp';
      if (webp.byteLength < LIGHTMAP_MAX_ASSET_BYTES * 0.75) break;
    }
    if (meta.image === 'raw') {
      const png = await encodeImage(stacked, r.size, rows, 'png', 1);
      if (png) {
        image = png;
        meta.image = 'png';
      }
    }
    if (job.gen !== this.gen || !this.enabled) return;
    const uvQ = r.uv.map((u) => (u ? Uint16Array.from(u, (v) => Math.max(0, Math.min(65535, Math.round(v * 65535)))) : null));
    const bytes = packAsset(meta, uvQ, image);
    if (bytes.byteLength > LIGHTMAP_MAX_ASSET_BYTES) {
      // Too large to keep (raw atlas on a browser without WebP): it is still applied this session, just not stored.
      log.warn(`lightmap file is ${bytes.byteLength} B (cap ${LIGHTMAP_MAX_ASSET_BYTES}): not cached`);
    } else if (this.cache && wallMs >= LIGHTMAP_CACHE_MIN_BAKE_MS && !job.prepared.slots.some((sl) => sl.cut)) void this.cache.put(job.key, bytes);
    this.applyDecoded(meta, r.rgba, r.uv, job.prepared, 'bake', bytes, wallMs, job.gen);
  }

  // --- applying --------------------------------------------------------------------------------------------------------

  /** Apply a stored file (bundled or cached); false when it does not match this building. */
  private async applyAsset(bytes: Uint8Array, p: Prepared, source: 'static' | 'cache', gen: number): Promise<boolean> {
    const asset = unpackAsset(bytes);
    if (!asset) return false;
    const triCounts = p.data.map((d) => meshTriangleCount(d));
    // A sectioned wall is not baked here, so its triangle count is not compared (nor is its slot applied).
    if (asset.meta.tris.length !== triCounts.length || asset.meta.tris.some((t, i) => t !== -1 && t !== triCounts[i] && !p.slots[i]?.cut)) return false;
    let rgba: Uint8Array | null;
    const parts = asset.meta.layers;
    // The parts must be the ones of the volume on screen (same sun keys): its bounce is what the lightmap's surfaces sit beside.
    if (asset.meta.keys.length !== p.keys.length) return false;
    // A request for more rays than the stored bake has bakes again.
    if (this.requested && !this.forced && asset.meta.samples < this.plan.samples) return false;
    if (this.forced && source === 'cache') return false;
    if (asset.meta.image === 'raw') rgba = unstackAtlas(asset.image, asset.meta.size, parts);
    else {
      const stacked = await decodeImage(asset.image, asset.meta.size, parts + 1, asset.meta.image);
      rgba = stacked ? unstackAtlas(stacked, asset.meta.size, parts) : null;
    }
    if (!rgba || gen !== this.gen || !this.enabled) return false;
    const uv = asset.uv.map((u) => (u ? Float32Array.from(u, (v) => v / 65535) : null));
    if (!this.requested && (asset.meta.quality === 'low' || asset.meta.quality === 'medium' || asset.meta.quality === 'high')) this.plan = planLightmap(asset.meta.quality, asset.meta.samples);
    this.applyDecoded(asset.meta, rgba, uv, p, source, bytes, 0, gen);
    return true;
  }

  private applyDecoded(meta: LightmapAssetMeta, rgba: Uint8Array, uv: Array<Float32Array | null>, p: Prepared, source: 'bake' | 'cache' | 'static', bytes: Uint8Array, wallMs: number, gen: number): void {
    if (gen !== this.gen || !this.enabled) return;
    // A file from the bundle or the cache is not a bake: the pill (state 'baking' / 'waiting') stays away, the status keeps its state.
    if (source === 'bake') this.setState('baking', 'applying baked light', 1);
    else this.applying = true;
    this.light.setLightmap(rgba, meta.size, meta.scales, meta.keys);
    // The same surfaces re-baked (another hour) have the same coordinates: nothing is rebuilt, only the atlas changed.
    let same = this.uvs.size > 0;
    const next = new Map<Mesh, Float32Array>();
    for (let i = 0; i < p.slots.length; i++) {
      const u = uv[i];
      const slot = p.slots[i] as Slot;
      if (!u || slot.cut) continue;
      // A wall's coordinates are one list for all its meshes: split by triangle ranges (six floats a triangle).
      if (u.length !== slot.tris.reduce((a, b) => a + b, 0) * 6) continue;
      let at = 0;
      slot.meshes.forEach((mesh, k) => {
        const len = (slot.tris[k] as number) * 6;
        next.set(mesh, slot.meshes.length === 1 ? u : u.subarray(at, at + len));
        at += len;
      });
    }
    for (const [mesh, u] of next) {
      const old = this.uvs.get(mesh);
      if (!old || old.length !== u.length) same = false;
      else if (same) for (let k = 0; k < u.length; k++) if (old[k] !== u[k]) { same = false; break; }
    }
    if (same && next.size === this.uvs.size) {
      this.finishApply(meta, source, bytes, wallMs, next.size, gen);
      return;
    }
    // New coordinates: take the old ones away first, then give merged geometry and standalone meshes the new ones.
    const restore = (): void => {
      for (const [mesh, s] of this.swapped) {
        if (mesh.geometry === s.clone) {
          mesh.geometry = s.original;
          refreshProgram(mesh);
        }
        s.clone.dispose();
      }
      this.swapped.clear();
    };
    restore();
    this.uvs.clear();
    for (const [m, u] of next) this.uvs.set(m, u);
    this.opts.attach?.(this);
    // Members that draw themselves right now (not merged) get their own copies, a few at a time.
    const pending = [...next.keys()].filter((m) => m.layers.isEnabled(0));
    const run = async (): Promise<void> => {
      let until = performance.now() + LIGHTMAP_SLICE_MS;
      for (const mesh of pending) {
        if (gen !== this.gen || !this.enabled) return;
        this.standalone(mesh);
        if (performance.now() > until) {
          await new Promise<void>((r) => setTimeout(r, 0));
          until = performance.now() + LIGHTMAP_SLICE_MS;
        }
      }
      if (gen !== this.gen || !this.enabled) return;
      this.finishApply(meta, source, bytes, wallMs, next.size, gen);
    };
    void run();
  }

  private finishApply(meta: LightmapAssetMeta, source: 'bake' | 'cache' | 'static', bytes: Uint8Array, wallMs: number, meshes: number, gen: number): void {
    this.applying = false;
    if (gen !== this.gen || !this.enabled) return;
    this.appliedKey = meta.key;
    this.appliedBytes = bytes;
    this.stale = false;
    let triangles = 0;
    for (const u of this.uvs.values()) triangles += u.length / 6;
    this.lastBake = { key: meta.key, source, texels: meta.texels, rays: meta.rays, meshes, triangles, wallMs: wallMs || meta.bakeMs, size: meta.size, bytes: bytes.byteLength };
    const how = source === 'bake' ? `baked in ${(wallMs / 1000).toFixed(1)} s` : source === 'cache' ? 'from the cache' : 'from the bundled file';
    this.setState('applied', `baked light on ${meshes} meshes (${meta.texels} texels, ${meta.size} px atlas, ${meta.samples} rays), ${how}`, 1);
    this.opts.onChange?.();
  }
}

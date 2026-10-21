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
import { Box3, Color, Matrix4, Vector3, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';
import { FLOATS_PER_PROBE, LightVolumeBaker, MAX_TRACE_TRIANGLES, planVolumeGrid, sampleVolume, TraceScene, type TraceInput, type VolumeBakeInput, type VolumeGrid, type VolumeLamp, type V3 } from '../environment/light-volume';
import { LightVolume } from '../environment/light-volume-light';
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
const EYE_LAMP_REACH = 7;
const EYE_LAMP_STOREY = 2.4;

/** Arch roles whose real geometry the rays hit. */
export const SHELL_ROLES: ReadonlySet<string> = new Set(['wall', 'room', 'ceiling', 'roof', 'stair', 'door', 'window', 'opening', 'column']);
/** Arch roles that become box proxies (their bounding box, their mean colour). */
export const PROXY_ROLES: ReadonlySet<string> = new Set(['furniture', 'fixture']);

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
  object: Object3D;
  meshes: readonly VolumeMesh[];
}

/** Light and ground the bake uses, read from the environment rig. */
export interface VolumeLighting {
  sun: VolumeBakeInput['sun'];
  ambient: VolumeBakeInput['ambient'];
  groundAlbedo: V3;
  lamps: readonly VolumeLamp[];
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

/**
 * The trace input of a building: shell meshes as their real triangles (glass left out), furniture and fixtures
 * as boxes. Returns null when nothing usable is there. `bounds` receives the shell's world box.
 */
export function collectTraceInput(parts: readonly VolumePart[], bounds: Box3): Required<TraceInput> | null {
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
    } else if (PROXY_ROLES.has(part.role)) {
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
      const hi: V3 = [_box.max.x - sx * sh, _box.max.y - sy * sh * 0.5, _box.max.z - sz * sh];
      tris += pushBox(pos, alb, two, lo, hi, col);
    }
  }
  if (tris === 0) return null;
  return { positions: Float32Array.from(pos), albedo: Float32Array.from(alb), twoSided: Uint8Array.from(two) };
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
}

/** Bake state and the light that shows it (see the module comment). */
export class LightVolumeController {
  readonly light = new LightVolume();
  /** Main-thread bake (no worker). */
  private baker: LightVolumeBaker | null = null;
  /** Worker bake in flight. */
  private job: { id: number; grid: VolumeGrid } | null = null;
  private bakingGrid: VolumeGrid | null = null;
  private grid: VolumeGrid | null = null;
  private data: Float32Array | null = null;
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
  private readonly settled: () => boolean;
  private readonly onUpload: () => void;
  private nextId = 1;
  private disposed = false;
  /** Lamps of the volume on screen (the eye's exposure counts their direct light). */
  private lamps: VolumeLamp[] = [];
  private pendingLamps: VolumeLamp[] = [];
  /** The last finished bake: probes, triangles, work time on the main thread (ms) and wall time (ms). */
  lastBake: { probes: number; triangles: number; workMs: number; wallMs: number; spacing: number; worker: boolean } | null = null;

  /** `gather` is called when a bake starts: the parts, the lighting and the building's ground height (null: nothing to bake). */
  constructor(private readonly gather: VolumeGather, opts: LightVolumeOptions = {}) {
    this.light.visible = false;
    this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
    this.settled = opts.settled ?? (() => true);
    this.onUpload = opts.onUpload ?? (() => undefined);
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
    this.accept(this.bakingGrid, b.data, false);
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.baker = null;
    this.bakingGrid = null;
    if (this.job && this.worker) {
      // A stale multi-second bake would hold the worker: replace it.
      this.worker.terminate();
      this.worker = null;
    }
    this.job = null;
  }

  /** A bake is pending or running. */
  get baking(): boolean {
    return this.enabled && (this.pending || this.baker !== null || this.job !== null);
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
      this.accept(this.bakingGrid, b.data, false);
    }
    return this.ready;
  }

  private accept(grid: VolumeGrid, data: Float32Array, worker: boolean): void {
    this.lastBake = { probes: this.probes, triangles: this.triangles, workMs: Math.round(this.bakeWork), wallMs: Math.round(performance.now() - this.bakeStarted), spacing: grid.spacing, worker };
    this.grid = grid;
    this.data = data;
    this.bakingGrid = null;
    this.shellBounds.copy(this.pendingBounds);
    this.lamps = this.pendingLamps;
    this.light.setBake(grid, data);
    this.onUpload();
  }

  private start(inline = false): void {
    const t0 = performance.now();
    const g = this.gather();
    if (!g) return;
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
    const lamps = g.lighting.lamps.slice(0, MAX_LAMPS).map((l) => ({ position: [...l.position] as [number, number, number], color: [...l.color] as [number, number, number], range: l.range }));
    const ground = { y: g.groundY, albedo: g.lighting.groundAlbedo };
    this.pendingLamps = lamps.map((l) => ({ position: [...l.position] as [number, number, number], color: [...l.color] as [number, number, number], range: l.range }));
    this.bakeWork = performance.now() - t0;
    const w = inline ? null : this.ensureWorker();
    if (w) {
      const id = this.nextId++;
      const req: VolumeRequest = { type: 'bake', id, grid, positions: input.positions, albedo: input.albedo, twoSided: input.twoSided, sun: g.lighting.sun, ambient: g.lighting.ambient, ground, lamps };
      try {
        w.postMessage(req, [input.positions.buffer, input.albedo.buffer, input.twoSided.buffer]);
        this.job = { id, grid };
        return;
      } catch (e) {
        this.dropWorker(`could not post a light-volume bake: ${e instanceof Error ? e.message : String(e)}`);
        // The buffers may have been detached by a failed transfer: gather again for the main-thread bake.
        this.start(true);
        return;
      }
    }
    const scene = new TraceScene(input);
    this.baker = new LightVolumeBaker({ grid, scene, sun: g.lighting.sun, ambient: g.lighting.ambient, ground, lamps });
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
  }

  private onReply(raw: unknown): void {
    const job = this.job;
    if (!job || this.disposed) return;
    // A late answer to a cancelled job is not this job's.
    if ((raw as { id?: unknown } | null)?.id !== job.id) return;
    const reply = parseVolumeReply(raw, job.grid);
    this.job = null;
    if (!reply) {
      log.warn('malformed light-volume reply ignored');
      return;
    }
    if (!reply.ok) {
      log.warn(`light-volume bake failed: ${reply.error}`);
      return;
    }
    if (!this.enabled) return;
    this.accept(job.grid, reply.data, true);
  }

  /**
   * What the volume gives an eye at `x, y, z`: mean sky visibility over six directions, the mean bounce luminance
   * and the mean direct light of nearby lamps on the same storey (null without a bake or outside the volume's box).
   */
  eyeSample(x: number, y: number, z: number): { vis: number; bounce: number; lamps: number } | null {
    const g = this.grid;
    const d = this.data;
    if (!g || !d || !Number.isFinite(x + y + z)) return null;
    const ex = g.spacing * (g.nx - 1);
    const ey = g.spacing * (g.ny - 1);
    const ez = g.spacing * (g.nz - 1);
    if (x < g.min[0] || y < g.min[1] || z < g.min[2] || x > g.min[0] + ex || y > g.min[1] + ey || z > g.min[2] + ez) return null;
    let vis = 0;
    let bounce = 0;
    for (const n of SIX) {
      const s = sampleVolume(g, d, x, y, z, n, this.scratch);
      vis += s.vis;
      bounce += 0.2126 * s.bounce[0] + 0.7152 * s.bounce[1] + 0.0722 * s.bounce[2];
    }
    // Lamps within a few metres on this storey (no occlusion test: a coarse but cheap stand-in for the room's lamps).
    let lamps = 0;
    for (const l of this.lamps) {
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
      lamps += (lum * f * f * cos) / Math.max(0.25, d2);
    }
    return { vis: vis / 6, bounce: bounce / 6, lamps };
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    this.enabled = false;
    this.worker?.terminate();
    this.worker = null;
    this.data = null;
    this.light.dispose();
  }
}

const SIX: readonly V3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/**
 * ChunkStreamer — keeps the chunks around a centre point generated, meshed
 * and drawn, nearest first, and forgets the far ones.
 *
 * Per frame ({@link update}) it walks a precomputed spiral of chunk offsets
 * (sorted by distance, no allocation) and tops up the worker pool:
 *
 * 1. remeshes chunks made dirty by block edits — urgently, ahead of
 *    everything else, so an edit shows within a frame or two;
 * 2. generates missing chunks within `viewDistance + 1` (meshing a chunk
 *    needs its eight neighbours for light and ambient occlusion), from a
 *    saved copy when the player changed it, otherwise from the seed;
 * 3. meshes generated chunks within `viewDistance` whose neighbours exist;
 * 4. unloads chunks beyond `viewDistance + 2` (hysteresis), handing
 *    modified ones to `onEvict` first so they can be saved.
 *
 * The pool's capacity bounds the queue, so moving quickly never builds a
 * backlog of jobs for places already left behind. Mesh replies that are
 * older than the chunk (it changed meanwhile) are re-requested.
 */
import type { ChunkData } from './chunk';
import { CHUNK, chunkKey, keyX, keyZ } from './constants';
import type { ChunkMesh } from './mesher';
import type { VoxelJobPool } from './pool';
import type { ChunkSlot, VoxelWorld } from './world';

/** Where meshes go (the render layer) and where evicted chunks go (the save). */
export interface StreamerSink {
  /** A chunk mesh is ready (null: the chunk has no geometry / was removed). */
  onMesh(key: number, cx: number, cz: number, mesh: ChunkMesh | null): void;
  /** A chunk left the loaded area (its mesh must go too). */
  onUnload(key: number, cx: number, cz: number): void;
  /** A modified chunk is about to be unloaded (save it). */
  onEvict?(slot: ChunkSlot): void;
}

/** A saved copy of a chunk, if one exists (null: generate from the seed). */
export type SavedChunkSource = (cx: number, cz: number) => Promise<{ chunk: ChunkData; top: number } | null> | null;

/** Streamer options. */
export interface StreamerOptions {
  viewDistance: number;
  /** Finite world: chunks outside ±border blocks are never requested (0 = endless). */
  border?: number;
  saved?: SavedChunkSource;
}

/** Most chunks the streamer keeps loaded whatever the view distance (memory bound). */
export const MAX_LOADED_CHUNKS = 1400;

interface MeshState {
  /** Slot version the current/last mesh request was made for (−1: none). */
  requested: number;
  /** Slot version of the mesh on screen (−1: none). */
  shown: number;
  pending: boolean;
}

/** Spiral of offsets within radius r, nearest first (Chebyshev rings, Euclidean order inside). */
function spiral(r: number): Int16Array {
  const pts: Array<[number, number, number]> = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) pts.push([dx, dz, dx * dx + dz * dz]);
  pts.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  const out = new Int16Array(pts.length * 2);
  pts.forEach((p, i) => {
    out[i * 2] = p[0];
    out[i * 2 + 1] = p[1];
  });
  return out;
}

/** See the module docs. */
export class ChunkStreamer {
  private viewDistance: number;
  private border: number;
  private readonly saved: SavedChunkSource | undefined;
  private offsets: Int16Array;
  private centerCx = 0;
  private centerCz = 0;
  private readonly generating = new Set<number>();
  private readonly meshes = new Map<number, MeshState>();
  private readonly neighbours: Array<ChunkData | null> = [null, null, null, null, null, null, null, null, null];
  private readonly tops = new Int32Array(9);
  private epoch = 0;
  private lastSweepCx = Number.NaN;
  private lastSweepCz = Number.NaN;
  private disposed = false;
  /** Main-thread milliseconds spent in the last {@link update}. */
  lastUpdateMs = 0;

  constructor(
    private readonly world: VoxelWorld,
    private readonly pool: VoxelJobPool,
    private readonly sink: StreamerSink,
    opts: StreamerOptions,
  ) {
    this.viewDistance = clampView(opts.viewDistance);
    this.border = Math.max(0, opts.border ?? 0);
    this.saved = opts.saved;
    this.offsets = spiral(this.viewDistance + 1);
  }

  /** Chunks loaded within the view distance that have a mesh on screen. */
  get meshedCount(): number {
    let n = 0;
    for (const m of this.meshes.values()) if (m.shown >= 0) n++;
    return n;
  }

  /** True when every chunk within the view distance is generated and meshed and nothing is pending. */
  get settled(): boolean {
    if (this.generating.size > 0) return false;
    const r = this.viewDistance;
    for (let i = 0; i < this.offsets.length; i += 2) {
      const dx = this.offsets[i] as number;
      const dz = this.offsets[i + 1] as number;
      if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
      const cx = this.centerCx + dx;
      const cz = this.centerCz + dz;
      if (!this.inWorld(cx, cz)) continue;
      const slot = this.world.slot(cx, cz);
      if (!slot) return false;
      const m = this.meshes.get(slot.key);
      if (!m || m.pending || m.shown !== slot.version) return false;
    }
    return this.world.dirty.size === 0;
  }

  /** Current view distance (chunks). */
  get distance(): number {
    return this.viewDistance;
  }

  /** Change the view distance (2…16). */
  setViewDistance(n: number): void {
    const v = clampView(n);
    if (v === this.viewDistance) return;
    this.viewDistance = v;
    this.offsets = spiral(v + 1);
  }

  /** Move the streaming centre to world block position (x, z). */
  setCenter(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.centerCx = Math.floor(x / CHUNK);
    this.centerCz = Math.floor(z / CHUNK);
  }

  /** Forget everything (new terrain configuration): every mesh is removed and chunks regenerate. */
  reset(border = this.border): void {
    this.epoch++;
    this.border = Math.max(0, border);
    for (const slot of [...this.world.chunks.values()]) this.unload(slot, false);
    this.world.dirty.clear();
    this.generating.clear();
    this.meshes.clear();
  }

  private inWorld(cx: number, cz: number): boolean {
    const b = this.border;
    if (b <= 0) return true;
    return cx * CHUNK < b && cz * CHUNK < b && (cx + 1) * CHUNK > -b && (cz + 1) * CHUNK > -b;
  }

  /** Schedule work for this frame. Cheap: bounded by the pool's free capacity. */
  update(): void {
    if (this.disposed) return;
    const t0 = now();
    const pool = this.pool;
    // 1. Edits first (urgent remeshes).
    if (this.world.dirty.size > 0) {
      for (const key of this.world.dirty) {
        const slot = this.world.chunks.get(key);
        if (slot) {
          const m = this.state(key);
          m.requested = -1;
          if (!m.pending) this.requestMesh(slot, true);
        }
      }
      this.world.dirty.clear();
    }
    const vd = this.viewDistance;
    const offs = this.offsets;
    // 2 + 3. Walk outward, generating and meshing nearest first.
    for (let i = 0; i < offs.length && pool.pending < pool.capacity; i += 2) {
      const dx = offs[i] as number;
      const dz = offs[i + 1] as number;
      const cx = this.centerCx + dx;
      const cz = this.centerCz + dz;
      if (!this.inWorld(cx, cz)) continue;
      const slot = this.world.slot(cx, cz);
      if (!slot) {
        this.requestGenerate(cx, cz);
        continue;
      }
      if (Math.abs(dx) > vd || Math.abs(dz) > vd) continue;
      const m = this.meshes.get(slot.key);
      if (m && (m.pending || m.requested === slot.version)) continue;
      if (!this.neighboursReady(cx, cz)) continue;
      this.requestMesh(slot, false);
    }
    // 4. Unload far chunks (and anything over the hard cap, farthest first).
    const keep = vd + 2;
    if (this.centerCx !== this.lastSweepCx || this.centerCz !== this.lastSweepCz || this.world.chunks.size > MAX_LOADED_CHUNKS) {
      this.lastSweepCx = this.centerCx;
      this.lastSweepCz = this.centerCz;
      for (const slot of this.world.chunks.values()) {
        const d = Math.max(Math.abs(slot.cx - this.centerCx), Math.abs(slot.cz - this.centerCz));
        if (d > keep) this.unload(slot, true);
        else if (d > vd) this.hide(slot.key, slot.cx, slot.cz);
      }
    }
    this.lastUpdateMs = now() - t0;
  }

  private state(key: number): MeshState {
    let m = this.meshes.get(key);
    if (!m) {
      m = { requested: -1, shown: -1, pending: false };
      this.meshes.set(key, m);
    }
    return m;
  }

  private neighboursReady(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.inWorld(nx, nz)) continue;
        if (!this.world.slot(nx, nz)) return false;
      }
    }
    return true;
  }

  private requestGenerate(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.generating.has(key)) return;
    this.generating.add(key);
    const epoch = this.epoch;
    const fromSave = this.saved?.(cx, cz) ?? null;
    const job = fromSave ? fromSave.then((s) => s ?? this.pool.generate(cx, cz)).then((s) => (s ? { ...s, saved: true } : null)) : this.pool.generate(cx, cz).then((g) => (g ? { chunk: g.chunk, top: g.top, saved: false } : null));
    job
      .then((g) => {
        if (this.disposed || epoch !== this.epoch) return;
        this.generating.delete(key);
        if (!g) return;
        // Too far by now: drop it (it will be generated again if we come back).
        const keep = this.viewDistance + 2;
        if (Math.abs(cx - this.centerCx) > keep || Math.abs(cz - this.centerCz) > keep) return;
        this.world.put(cx, cz, g.chunk, g.top, g.saved);
        // Neighbours meshed without this chunk get its light/AO border now.
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const n = this.world.slot(cx + dx, cz + dz);
            if (!n) continue;
            const m = this.meshes.get(n.key);
            if (m && m.shown >= 0) m.requested = -1;
          }
        }
      })
      .catch(() => {
        if (epoch === this.epoch) this.generating.delete(key);
      });
  }

  private requestMesh(slot: ChunkSlot, urgent: boolean): void {
    const m = this.state(slot.key);
    const version = slot.version;
    m.requested = version;
    m.pending = true;
    const nb = this.neighbours;
    const tops = this.tops;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = (dz + 1) * 3 + (dx + 1);
        const n = this.world.slot(slot.cx + dx, slot.cz + dz);
        nb[k] = n ? n.data : null;
        tops[k] = n ? n.top : -1;
      }
    }
    const epoch = this.epoch;
    const { cx, cz, key } = slot;
    this.pool
      .mesh(cx, cz, nb, tops, urgent)
      .then((mesh) => {
        if (this.disposed || epoch !== this.epoch) return;
        m.pending = false;
        const cur = this.world.chunks.get(key);
        if (!mesh || !cur || this.meshes.get(key) !== m) return;
        this.sink.onMesh(key, cx, cz, mesh);
        m.shown = version;
        // The chunk changed while meshing: ask again (urgently if it was an edit).
        if (cur.version !== version || m.requested === -1) {
          m.requested = -1;
          this.requestMesh(cur, true);
        }
      })
      .catch(() => {
        if (epoch === this.epoch) m.pending = false;
      });
    for (let k = 0; k < 9; k++) nb[k] = null;
  }

  /** Out of view but still loaded (hysteresis): drop the mesh, keep the blocks. */
  private hide(key: number, cx: number, cz: number): void {
    const m = this.meshes.get(key);
    if (!m || m.shown < 0) return;
    this.meshes.delete(key);
    this.sink.onUnload(key, cx, cz);
  }

  private unload(slot: ChunkSlot, evict: boolean): void {
    if (evict && slot.modified) this.sink.onEvict?.(slot);
    this.world.remove(slot.cx, slot.cz);
    this.meshes.delete(slot.key);
    this.sink.onUnload(slot.key, slot.cx, slot.cz);
  }

  /** Stop streaming (pending results are ignored). */
  dispose(): void {
    this.disposed = true;
    this.epoch++;
  }
}

function clampView(n: number): number {
  return Number.isFinite(n) ? Math.max(2, Math.min(16, Math.round(n))) : 6;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export { keyX, keyZ };

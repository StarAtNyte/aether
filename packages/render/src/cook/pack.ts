/**
 * Packing a cooked package (cook/format.ts): geometry-cache entries into packs per grid cell, nearest the opening first,
 * program sets per tier, and the manifest. One implementation for both cooks: scripts/cook.ts (a headless recording, in
 * Node) and the editor's publish (the publisher's browser, apps/studio/src/publish/cook-publish.ts). Storage is the
 * caller's: entries are read and packs written through callbacks.
 */
import type { AssetShape, Entity, ProceduralShape, WorldDoc } from '@aether/core';
import { proceduralOutputKey } from '@aether/procgen';
import type { RenderTier } from '../gpu/finishing';
import { assignCell, cellBounds, partitionFor, PERSISTENT_CELL, type CellPartition } from '../streaming/cell-grid';
import { COOK_FORMAT, cookPackageId, PACK_TARGET_BYTES, sha256Hex, type CookCell, type CookedProgramSet, type CookFile, type CookManifest, type CookProfile, type StartMode } from './format';

/** What a recording of a world gives the packer. */
export interface CookRecording {
  world: WorldDoc;
  irHash: string;
  genVersion: string;
  startMode: StartMode;
  opening: CookManifest['opening'];
  /** Tour stops (the IR's own, or computed by the renderer when cooking); absent: none recorded. */
  views?: CookManifest['views'];
}

/** Render tiers in manifest order. */
export const COOK_TIERS: readonly RenderTier[] = ['low', 'medium', 'high', 'ultra'];

/** World XZ of an entity: its position plus its parents' (rotation and scale of parents ignored: placement only). */
export function worldXZ(world: WorldDoc, id: string): [number, number] | null {
  let x = 0, z = 0;
  let e: Entity | undefined = world.entities[id];
  for (let depth = 0; e && depth < 64; depth++) {
    const p = e.transform.position;
    x += Number(p[0]);
    z += Number(p[2]);
    e = e.parent ? world.entities[e.parent] : undefined;
  }
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null;
}

/** The world's grid (streaming/cell-grid.ts), from its top-level entities; null when nothing is placed. */
export function partitionOf(world: WorldDoc): CellPartition | null {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const e of Object.values(world.entities)) {
    if (!e || e.template || e.parent) continue;
    const x = Number(e.transform.position[0]), z = Number(e.transform.position[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return maxX >= minX ? partitionFor([minX, minZ], [maxX, maxZ]) : null;
}

/** The procedural shape a library asset stands for (a generator asset), or null: the scene's resolution of `asset` shapes. */
export type AssetShapeResolver = (shape: AssetShape) => ProceduralShape | null;

/**
 * Every procedural output the world draws, with the entity that places it: procedural entities (spawn templates included),
 * the pieces of scatter layers, and generator assets when `asset` resolves them (the scene's catalog).
 */
export function worldOutputShapes(world: WorldDoc, asset?: AssetShapeResolver): Array<{ id: string; shape: ProceduralShape }> {
  const out: Array<{ id: string; shape: ProceduralShape }> = [];
  for (const [id, e] of Object.entries(world.entities)) {
    if (!e) continue;
    const s = e.shape;
    if (s.kind === 'procedural') out.push({ id, shape: s as ProceduralShape });
    else if (s.kind === 'scatter' && s.of.kind === 'procedural') out.push({ id, shape: s.of as ProceduralShape });
    else if (s.kind === 'asset' && asset) {
      const p = asset(s as AssetShape);
      if (p) out.push({ id, shape: p });
    }
  }
  return out;
}

/** Geometry-cache key (geometry/ddc.ts `ddcKey`) of every procedural output of the world ({@link worldOutputShapes}), with the ids that use it. */
export async function worldOutputKeys(world: WorldDoc, genVersion: string, asset?: AssetShapeResolver): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const memo = new Map<string, string>();
  for (const { id, shape } of worldOutputShapes(world, asset)) {
    const k = proceduralOutputKey(shape, world);
    let hex = memo.get(k);
    if (hex === undefined) memo.set(k, (hex = await sha256Hex(`gen\u0000${genVersion}\u0000${k}`)));
    let ids = out.get(hex);
    if (!ids) out.set(hex, (ids = []));
    ids.push(id);
  }
  return out;
}

/** Options of {@link packGeometry}. */
export interface PackGeometryOptions {
  /** Geometry-cache keys recorded (64 hex). */
  keys: Iterable<string>;
  /** The stored bytes of an entry (null: gone, skipped). */
  read(key: string): Promise<Uint8Array | null>;
  /** Check an entry: the bytes it decodes to; throws on a malformed one (left out). Omitted: not checked. */
  decode?(bytes: Uint8Array): Promise<number>;
  /** Write a pack (`packs/<nnnn>.bin`): the parts in order, `bytes` in all. */
  writePack(file: string, parts: Uint8Array[], bytes: number): Promise<void> | void;
  /** Pack size target ({@link PACK_TARGET_BYTES}). */
  packTarget?: number;
  /** Entries larger than this are left out (a viewer generates them). Default: no limit. */
  maxEntryBytes?: number;
  /** Called after each entry (progress). */
  onEntry?(done: number, total: number): void;
  signal?: AbortSignal;
  /** Resolves generator assets, so their outputs are placed in the cell of the entity that uses them. */
  asset?: AssetShapeResolver;
}

/** What {@link packGeometry} made. */
export interface PackedGeometry {
  partition: CookManifest['partition'];
  cells: CookCell[];
  packs: CookFile[];
  entries: CookManifest['entries'];
  stats: {
    /** Entries that did not decode, or were missing. */
    malformed: number;
    /** Entries over `maxEntryBytes`. */
    tooLarge: number;
    /** Entries in the persistent cell (no top-level entity places them). */
    unplaced: number;
    /** Keys whose bytes equal an earlier entry's (stored once) and their bytes. */
    shared: number;
    sharedBytes: number;
    decodedBytes: number;
  };
}

/**
 * Pack the entries: each to the cell of the nearest entity that uses it (to the opening view), outputs no top-level entity
 * places to the persistent cell; cells nearest the opening first; packs cut at the target; identical entries stored once.
 */
export async function packGeometry(rec: CookRecording, opts: PackGeometryOptions): Promise<PackedGeometry> {
  const world = rec.world;
  const target = opts.packTarget ?? PACK_TARGET_BYTES;
  const keys = new Set(opts.keys);
  const grid = partitionOf(world);
  const eye = rec.opening ? [rec.opening.position[0], rec.opening.position[2]] : [0, 0];
  const placed = new Map<string, { cell: string; d: number; x: number; z: number }>();
  for (const [hex, ids] of await worldOutputKeys(world, rec.genVersion, opts.asset)) {
    if (!keys.has(hex)) continue;
    for (const id of ids) {
      const e = world.entities[id]!;
      const xz = e.template ? null : worldXZ(world, id);
      const cell = xz && grid ? assignCell(grid, xz[0], xz[1], 0) : PERSISTENT_CELL;
      const d = xz ? Math.hypot(xz[0] - (eye[0] as number), xz[1] - (eye[1] as number)) : -1;
      const prev = placed.get(hex);
      if (!prev || (prev.cell === PERSISTENT_CELL && cell !== PERSISTENT_CELL) || (cell !== PERSISTENT_CELL && d < prev.d)) placed.set(hex, { cell, d, x: xz?.[0] ?? 0, z: xz?.[1] ?? 0 });
    }
  }
  const byCell = new Map<string, Array<{ hex: string; d: number; x: number; z: number }>>();
  for (const hex of keys) {
    const p = placed.get(hex) ?? { cell: PERSISTENT_CELL, d: -1, x: 0, z: 0 };
    let list = byCell.get(p.cell);
    if (!list) byCell.set(p.cell, (list = []));
    list.push({ hex, d: p.d, x: p.x, z: p.z });
  }
  const cellDist = (key: string): number => {
    if (key === PERSISTENT_CELL || !grid) return -1;
    const b = cellBounds(grid, key);
    return Math.hypot((b[0] + b[2]) / 2 - (eye[0] as number), (b[1] + b[3]) / 2 - (eye[1] as number));
  };
  const cellKeys = [...byCell.keys()].sort((a, b) => cellDist(a) - cellDist(b));

  const packs: CookFile[] = [];
  const cells: CookCell[] = [];
  const entries: CookManifest['entries'] = {};
  const stats: PackedGeometry['stats'] = { malformed: 0, tooLarge: 0, unplaced: byCell.get(PERSISTENT_CELL)?.length ?? 0, shared: 0, sharedBytes: 0, decodedBytes: 0 };
  const stored = new Map<string, [number, number, number]>();
  let done = 0;
  for (const key of cellKeys) {
    const list = (byCell.get(key) ?? []).sort((a, b) => a.d - b.d);
    const cellIndex = cells.length;
    const cell: CookCell = { key, bounds: null, entries: 0, bytes: 0, packs: [] };
    let chunk: Uint8Array[] = [];
    let size = 0;
    const flush = async (): Promise<void> => {
      if (size === 0) return;
      const file = `packs/${String(packs.length).padStart(4, '0')}.bin`;
      await opts.writePack(file, chunk, size);
      cell.packs.push(packs.length);
      packs.push({ file, bytes: size });
      chunk = [];
      size = 0;
    };
    for (const it of list) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('aborted', 'AbortError');
      opts.onEntry?.(done++, keys.size);
      const body = await opts.read(it.hex);
      if (!body) {
        stats.malformed++;
        continue;
      }
      if (opts.maxEntryBytes !== undefined && body.byteLength > opts.maxEntryBytes) {
        stats.tooLarge++;
        continue;
      }
      if (opts.decode) {
        try {
          stats.decodedBytes += await opts.decode(body);
        } catch {
          stats.malformed++;
          continue;
        }
      }
      const content = await bytesHex(body);
      const first = stored.get(content);
      if (first) {
        entries[it.hex] = [first[0], first[1], first[2], cellIndex];
        stats.shared++;
        stats.sharedBytes += body.byteLength;
        continue;
      }
      if (size > 0 && size + body.byteLength > target) await flush();
      const pad = (8 - (body.byteLength % 8)) % 8;
      entries[it.hex] = [packs.length, size, body.byteLength, cellIndex];
      stored.set(content, [packs.length, size, body.byteLength]);
      chunk.push(body);
      if (pad) chunk.push(new Uint8Array(pad));
      size += body.byteLength + pad;
      cell.entries++;
      cell.bytes += body.byteLength;
      if (key !== PERSISTENT_CELL && it.d >= 0) {
        const b = cell.bounds ?? [it.x, it.z, it.x, it.z];
        cell.bounds = [Math.min(b[0], it.x), Math.min(b[1], it.z), Math.max(b[2], it.x), Math.max(b[3], it.z)];
      }
    }
    await flush();
    if (cell.entries > 0) cells.push(cell);
  }
  return { partition: grid ? { cellSize: grid.cellSize, origin: [grid.origin[0], grid.origin[1]] } : null, cells, packs, entries, stats };
}

async function bytesHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** A recorded run of programs: pairs of hashes and their sources. */
export interface RecordedPairs {
  pairs: ReadonlyArray<[string, string]>;
  sources: Readonly<Record<string, string>>;
}

/**
 * The program set of a tier: the load's own programs first, in the order it used them (`boot`, all of them), then `rest`
 * (the stored set's entries, most recent first, or the session's later pairs) that are not among them. Null when neither
 * has a pair.
 */
export function programSetBody(tier: RenderTier, boot: RecordedPairs | null, rest: RecordedPairs | null): Omit<CookedProgramSet, 'format'> | null {
  const sources: Record<string, string> = {};
  const pairs: Array<[string, string]> = [];
  const have = new Set<string>();
  const push = (hv: string, hf: string, v: string | undefined, f: string | undefined): void => {
    if (v === undefined || f === undefined || have.has(`${hv}:${hf}`)) return;
    have.add(`${hv}:${hf}`);
    sources[hv] = v;
    sources[hf] = f;
    pairs.push([hv, hf]);
  };
  for (const [hv, hf] of boot?.pairs ?? []) push(hv, hf, boot!.sources[hv], boot!.sources[hf]);
  const bootCount = pairs.length;
  for (const [hv, hf] of rest?.pairs ?? []) push(hv, hf, rest!.sources[hv], rest!.sources[hf]);
  return pairs.length > 0 ? { tier, boot: bootCount, pairs, sources } : null;
}

/** The profile of a start mode, when nothing names one. */
export function profileForStartMode(startMode: StartMode): CookProfile {
  return startMode === 'play' ? 'game' : startMode === 'walkthrough' ? 'walkthrough' : 'showcase';
}

/** The manifest of a cook. */
export async function cookManifest(rec: CookRecording, profile: CookProfile, geometry: Pick<PackedGeometry, 'partition' | 'cells' | 'packs' | 'entries'>, programs: CookManifest['programs'], cookedAt: string = new Date().toISOString()): Promise<CookManifest> {
  const id = await cookPackageId(rec.irHash, rec.genVersion);
  return {
    format: COOK_FORMAT,
    irHash: rec.irHash,
    genVersion: rec.genVersion,
    dir: `${id}/`,
    cookedAt,
    world: { id: rec.world.id, name: rec.world.name, entities: Object.keys(rec.world.entities).length },
    opening: rec.opening,
    startMode: rec.startMode,
    ...(rec.views && rec.views.length > 0 ? { views: rec.views } : {}),
    profile,
    partition: geometry.partition,
    cells: geometry.cells,
    packs: geometry.packs,
    entries: geometry.entries,
    programs,
    lightmap: null,
  };
}

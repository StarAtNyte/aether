/**
 * Cell streaming (docs/ARCHITECTURE-STREAMING.md, stage 4b): which grid cells of a world are resident around the
 * streaming sources (the camera, the orbit focus, the player). Cells inside the load ring load, nearest and in view
 * first, a few at a time; a cell unloads once it has stayed past the ring plus one cell for the unload delay
 * (hysteresis), so a camera that wanders along a ring edge does not load and unload the same cell.
 *
 * Only static scenery streams. An entity stays resident for the whole visit (the persistent layer) when it has behaviour,
 * a light, a character, a physics body that moves, an interaction, effects, a building role, a joint or an owner; when
 * another entity places a scatter on it or is attached to it; when it is a landmark or scenery; and when its size cannot
 * be told before it is generated (terrain, streets, a generator without size parameters). Its children follow it. Logic,
 * rules and the document stay whole: only the scene nodes of far static entities are taken down and rebuilt.
 *
 * Sizes before generation come from the shape: a primitive's size, a library model's catalogue size, a generator's size
 * parameters, the area or points of a scatter. Each is widened (roofs, eaves, rotation), and replaced by the real bounds
 * once the entity has been built ({@link CellStreamer.learn}).
 */
import type { AssetShape, Entity, EntityId, WorldDoc } from '@aether/core';
import { assignCell, partitionFor, type CellPartition } from './cell-grid';

/** Size of a library model a shape places (metres, its fit applied), or null when unknown. */
export type AssetSize = (shape: AssetShape) => readonly [number, number, number] | null;

/** XZ box: [minX, minZ, maxX, maxZ]. */
export type XZBox = [number, number, number, number];

/** A streaming source this frame: a point on the XZ plane, and optionally where it looks. */
export interface StreamSource {
  x: number;
  z: number;
  /** Unit XZ direction the view looks along (frustum bonus), absent for a point source. */
  dir?: [number, number];
}

/** Tunables of {@link CellStreamer}. */
export interface CellStreamingConfig {
  /** Cells whose box comes within this distance of a source load (metres). */
  loadRadius: number;
  /** Extra distance past the load radius before a cell may unload (metres; the hysteresis band). */
  unloadMargin: number;
  /** How long a cell stays past the unload distance before it unloads (ms). */
  unloadDelayMs: number;
  /** Most cells loading at once (each is a batch of generation and mounts). */
  maxLoading: number;
  /**
   * Cells within this distance of a source are resident whatever the budget (metres; ring R0). Past it, cells load in
   * order of urgency while their geometry fits {@link budgetBytes}.
   */
  nearRadius: number;
  /** Geometry bytes the streamed cells may hold (the persistent layer is not counted); Infinity: no budget. */
  budgetBytes: number;
  /** A cell stays at least this long once loaded before the budget may evict it for a more urgent one (ms). */
  minResidentMs: number;
  /** Bytes assumed for a member entity until its cell has been measured or estimated otherwise. */
  entityBytes: number;
  /**
   * Load and near radii of a cell that has an HLOD proxy (metres; hlod.ts): past them the proxy draws instead of the
   * full detail, so they are smaller than {@link loadRadius} and {@link nearRadius}.
   */
  proxyLoadRadius: number;
  proxyNearRadius: number;
  /**
   * Within this distance a proxied cell that is not in yet holds the view while the camera moves on its own (a walk, an
   * orbit), and loads without waiting its turn; after a camera jump the whole {@link proxyNearRadius} holds it.
   */
  proxyHoldRadius: number;
  /** How long a proxied cell stays past its unload distance before it unloads (ms): its proxy covers it at once. */
  proxyUnloadDelayMs: number;
  /** Most proxied cells loading at once (each load's arrays become garbage on upload: spread out, the heap stays low). */
  proxyMaxLoading: number;
}

/** Load ring by render tier, in base cells (section 3.2: R1 at 4 cells, scaled by tier). */
const TIER_RING: Readonly<Record<string, number>> = { low: 3, medium: 4, high: 4.5, ultra: 5 };

/** The streaming tunables of a world with base cell `cellSize` drawn at `tier`, with a streamed-geometry budget. */
export function streamingConfig(cellSize: number, tier: string, budgetBytes = Number.POSITIVE_INFINITY): CellStreamingConfig {
  const ring = TIER_RING[tier] ?? 4;
  return {
    loadRadius: cellSize * ring, nearRadius: cellSize * 1.5 * (ring / 4), unloadMargin: cellSize, unloadDelayMs: 5000, maxLoading: 2,
    budgetBytes, minResidentMs: 4000, entityBytes: 1 << 20,
    // A cell with a proxy is full detail within 1.5 cells (scaled by tier), the near ring, whatever the budget (stage 5,
    // §3.2 R0/R1): a proxy drops pieces under 35 cm (flowers, pots, railings), which still read at that distance. Within
    // half a cell a cell still loading holds the view (a jump: the whole near ring, see WorldRenderer.nearHeld).
    proxyLoadRadius: cellSize * 1.5 * (ring / 4), proxyNearRadius: cellSize * 1.5 * (ring / 4), proxyHoldRadius: cellSize * 0.5 * (ring / 4), proxyUnloadDelayMs: 1500, proxyMaxLoading: 1,
  };
}

/**
 * Streamed geometry budget (section 3.2): 256 MB of full-detail geometry on an integrated GPU or in low-memory mode,
 * 768 MB on a discrete GPU.
 */
export function streamingBudget(integrated: boolean): number {
  return (integrated ? 256 : 768) * 1024 * 1024;
}

/** The world's grid from its top-level entities (as scene-sync and the cook fix it); null when nothing is placed. */
export function worldPartition(world: WorldDoc): CellPartition | null {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const id in world.entities) {
    const e = world.entities[id];
    if (!e || e.template || e.parent) continue;
    const x = Number(e.transform.position[0]), z = Number(e.transform.position[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return maxX >= minX ? partitionFor([minX, minZ], [maxX, maxZ]) : null;
}

/** Generators whose output spans the world or is seen from everywhere: always resident. */
const PERSISTENT_GENERATORS = /terrain|ground|mountain|island|backdrop|sky|ocean|sea|water|river|lake|street|road|path|bridge|cliff|hill|range|land/;
/** Tags of things seen from afar or framed: always resident. */
const PERSISTENT_TAGS: ReadonlySet<string> = new Set(['landmark', 'focus', 'hero', 'scenery', 'backdrop', 'waterfall', 'temple', 'statue', 'monument', 'tower', 'lighthouse', 'castle', 'cathedral', 'church', 'shrine', 'pagoda', 'bridge', 'terrain', 'water']);

/** Generator size parameters: the value times the factor is a horizontal extent (metres). */
const SIZE_PARAMS: Readonly<Record<string, number>> = {
  width: 1, depth: 1, length: 1, size: 1, span: 1, diameter: 1, footprint: 1, extent: 1,
  radius: 2, outerRadius: 2, r: 2,
  halfLength: 2, halfWidth: 2, halfDepth: 2, halfSize: 2,
  // A tree's or a statue's crown spreads with its height.
  height: 0.6,
};

/** Smallest extent assumed for anything that streams (metres). */
const MIN_EXTENT = 4;

/** The larger horizontal side of the shape of `e` before it is generated (metres, scale applied), or null when unknown. */
export function estimateExtent(e: Entity, assetSize?: AssetSize): number | null {
  const s = e.transform.scale;
  const k = Math.max(Math.abs(Number(s[0])), Math.abs(Number(s[2])), 1e-6);
  if (!Number.isFinite(k)) return null;
  const shape = e.shape;
  let extent: number | null = null;
  switch (shape.kind) {
    case 'primitive': {
      const z = shape.size;
      extent = Math.max(Number(z[0]), Number(z[2]));
      break;
    }
    case 'asset': {
      const size = assetSize?.(shape) ?? null;
      extent = size ? Math.max(size[0], size[2]) : null;
      break;
    }
    case 'procedural': {
      // A tile of a long feature (a street, a wall: its `extent` parameter) is bounded whatever its generator's name.
      const tile = shape.params['extent'];
      const tiled = typeof tile === 'number' && Number.isFinite(tile) && tile > 0;
      if (PERSISTENT_GENERATORS.test(shape.generator) && !tiled) return null;
      // A tile's extent is its own; the whole feature's size parameters (its length) do not apply to it.
      extent = tiled ? tile : paramExtent(shape.params);
      break;
    }
    case 'scatter': {
      if (shape.onSurface !== undefined) return null;
      const of = shape.of;
      const piece = of.kind === 'primitive' ? Math.max(Number(of.size[0]), Number(of.size[2])) : PERSISTENT_GENERATORS.test(of.generator) ? null : paramExtent(of.params) ?? MIN_EXTENT;
      if (piece === null) return null;
      const scale = Math.max(1, Number(shape.scaleRange[1]) || 1);
      if (shape.points && shape.points.length > 0) {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const p of shape.points) {
          minX = Math.min(minX, Number(p[0])); maxX = Math.max(maxX, Number(p[0]));
          minZ = Math.min(minZ, Number(p[2])); maxZ = Math.max(maxZ, Number(p[2]));
        }
        // Points are local: the extent is twice the farthest from the entity, so the box stays centred on it.
        extent = 2 * Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ)) + piece * scale;
      } else {
        extent = Math.max(Number(shape.area[0]), Number(shape.area[1])) + piece * scale;
      }
      break;
    }
    default:
      return null;
  }
  if (extent === null || !Number.isFinite(extent) || extent < 0) return null;
  return Math.max(MIN_EXTENT, extent * k);
}

function paramExtent(params: Readonly<Record<string, unknown>>): number | null {
  let best = -1;
  for (const key in params) {
    const f = SIZE_PARAMS[key];
    const v = params[key];
    if (f === undefined || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    best = Math.max(best, v * f);
  }
  return best > 0 ? best : null;
}

/** Why an entity cannot stream (it stays resident), or null when it can (shape aside). */
function pinnedReason(e: Entity): string | null {
  if (e.template) return 'template';
  if (e.behaviors.length > 0) return 'behaviour';
  if (e.light) return 'light';
  if (e.npc || e.character) return 'character';
  if (e.interact) return 'interact';
  if (e.vfx) return 'vfx';
  if (e.joint) return 'joint';
  if (e.arch) return 'arch';
  if (e.attachedTo !== undefined) return 'attached';
  if (e.physics && e.physics.body !== 'static') return 'body';
  if (e.visible === false) return 'hidden';
  for (const t of e.tags) if (PERSISTENT_TAGS.has(t)) return 'tag';
  return null;
}

/** One streamable top-level entity. */
export interface StreamEntity {
  id: EntityId;
  cell: string;
  box: XZBox;
}

/** The streaming plan of a world: its streamable top-level entities, and the reasons the others stay. */
export interface StreamPlan {
  entities: Map<EntityId, StreamEntity>;
  /** Top-level entities that stay resident, by reason (diagnostics). */
  pinned: Record<string, number>;
}

/** World XZ of `id`: its position plus its parents' (as cook/pack.ts `worldXZ`). */
function worldXZ(world: WorldDoc, id: EntityId): [number, number] | null {
  let x = 0, z = 0;
  let e: Entity | undefined = world.entities[id];
  for (let depth = 0; e && depth < 64; depth++) {
    x += Number(e.transform.position[0]);
    z += Number(e.transform.position[2]);
    e = e.parent ? world.entities[e.parent] : undefined;
  }
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null;
}

/**
 * Which top-level entities of `world` stream, the cell each goes to and its estimated XZ box. A top-level entity streams
 * with all its descendants, so any pinned descendant pins it.
 */
export function planStreaming(world: WorldDoc, partition: CellPartition, assetSize?: AssetSize): StreamPlan {
  const entities = new Map<EntityId, StreamEntity>();
  const pinned: Record<string, number> = {};
  const pin = (why: string): void => void (pinned[why] = (pinned[why] ?? 0) + 1);
  const all = world.entities;
  // Top-level ancestor of every entity, and what pins a family.
  const topOf = (id: EntityId): EntityId => {
    let cur = id;
    for (let depth = 0; depth < 64; depth++) {
      const p = all[cur]?.parent;
      if (!p || !all[p]) return cur;
      cur = p;
    }
    return cur;
  };
  const familyPinned = new Map<EntityId, string>();
  const referenced = new Set<EntityId>();
  const children = new Map<EntityId, EntityId[]>();
  for (const id in all) {
    const e = all[id];
    if (!e) continue;
    if (e.attachedTo !== undefined) referenced.add(e.attachedTo);
    if (e.shape.kind === 'scatter' && e.shape.onSurface !== undefined) referenced.add(e.shape.onSurface);
    if (e.parent === null || e.template) continue;
    const top = topOf(id);
    let list = children.get(top);
    if (!list) children.set(top, (list = []));
    list.push(id);
    const why = pinnedReason(e);
    if (why) familyPinned.set(top, why);
  }
  for (const id of referenced) familyPinned.set(topOf(id), 'surface');
  for (const id in all) {
    const e = all[id];
    if (!e || e.parent !== null || e.template) continue;
    const why = familyPinned.get(id) ?? pinnedReason(e);
    if (why) { pin(why); continue; }
    if (e.shape.kind === 'none' || e.shape.kind === 'mesh' || e.shape.kind === 'model') { pin('shape'); continue; }
    let extent = estimateExtent(e, assetSize);
    // Children widen the family's box by their offsets (their own sizes are not known before generation).
    let reach = 0;
    const own = worldXZ(world, id);
    for (const cid of children.get(id) ?? []) {
      const c = all[cid];
      if (!c) continue;
      const xz = worldXZ(world, cid);
      if (!xz || !own) { extent = null; break; }
      const ce = estimateExtent(c, assetSize) ?? MIN_EXTENT;
      reach = Math.max(reach, Math.hypot(xz[0] - own[0], xz[1] - own[1]) + ce);
    }
    if (extent === null) { pin('size'); continue; }
    const xz = worldXZ(world, id);
    if (!xz) { pin('position'); continue; }
    // Half the extent, widened for rotation (the diagonal of a square), eaves and overhangs, and the children's reach.
    const half = Math.max(extent * 0.75 + 2, reach);
    const cell = assignCell(partition, xz[0], xz[1], half * 2);
    if (cell === 'p') { pin('large'); continue; }
    entities.set(id, { id, cell, box: [xz[0] - half, xz[1] - half, xz[0] + half, xz[1] + half] });
  }
  return { entities, pinned };
}

interface CellState {
  key: string;
  members: EntityId[];
  box: XZBox;
  resident: boolean;
  loading: boolean;
  /** When the cell was first seen past the unload distance (ms), or null. */
  farSince: number | null;
  /** When it last became resident (ms). */
  since: number;
  /** Geometry bytes: measured once loaded, else estimated. */
  bytes: number;
  measured: boolean;
  /** The cell has an HLOD proxy (its rings are the proxy rings). */
  proxied: boolean;
  /** The box is the cell's exact bounds (from its proxy): building its members does not widen it. */
  exact: boolean;
}

/** Distance on XZ from (x, z) to the nearest point of `b`. */
export function boxDistance(b: Readonly<XZBox>, x: number, z: number): number {
  const dx = Math.max(b[0] - x, 0, x - b[2]);
  const dz = Math.max(b[1] - z, 0, z - b[3]);
  return Math.hypot(dx, dz);
}

/** What one {@link CellStreamer.update} decided. */
export interface StreamChange {
  /** Cells to load now, most urgent first. */
  load: string[];
  /** Cells to unload now (left behind, or evicted by the budget for a more urgent cell). */
  unload: string[];
}

/** How much more urgent (in quarter load rings) a waiting cell must be to evict a resident one for the budget. */
const EVICT_MARGIN = 1;

/**
 * Residency of the cells of one world around its streaming sources. Pure bookkeeping: the caller builds and takes down
 * the scene nodes, reports when a cell finished loading ({@link loaded}) and what its geometry weighs ({@link setBytes}).
 */
export class CellStreamer {
  private readonly cells = new Map<string, CellState>();
  private readonly cellOf = new Map<EntityId, CellState>();
  /** Loads, unloads and budget evictions so far (diagnostics). */
  loads = 0;
  unloads = 0;
  evictions = 0;

  constructor(plan: StreamPlan, private readonly config: CellStreamingConfig) {
    for (const se of plan.entities.values()) {
      let c = this.cells.get(se.cell);
      if (!c) this.cells.set(se.cell, (c = { key: se.cell, members: [], box: [...se.box], resident: false, loading: false, farSince: null, since: 0, bytes: 0, measured: false, proxied: false, exact: false }));
      c.members.push(se.id);
      c.box = union(c.box, se.box);
      c.bytes += config.entityBytes;
      this.cellOf.set(se.id, c);
    }
  }

  /** Whether entity `id` (a top-level entity) should have scene nodes now. Entities outside the plan always do. */
  resident(id: EntityId): boolean {
    const c = this.cellOf.get(id);
    return !c || c.resident;
  }

  /** Whether `id` is streamed (in the plan). */
  streams(id: EntityId): boolean {
    return this.cellOf.has(id);
  }

  /** Cell key of streamed entity `id`. */
  cellOfEntity(id: EntityId): string | undefined {
    return this.cellOf.get(id)?.key;
  }

  /** Members of cell `key`. */
  members(key: string): readonly EntityId[] {
    return this.cells.get(key)?.members ?? [];
  }

  /** Every cell key. */
  keys(): IterableIterator<string> {
    return this.cells.keys();
  }

  /** Box of cell `key` (its members' estimated or learnt boxes). */
  box(key: string): Readonly<XZBox> | null {
    return this.cells.get(key)?.box ?? null;
  }

  /** The real XZ bounds of a built entity: its cell's box widens to hold them (never shrinks; an exact box stays). */
  learn(id: EntityId, box: XZBox): void {
    const c = this.cellOf.get(id);
    if (!c || c.exact || !box.every(Number.isFinite) || box[2] < box[0] || box[3] < box[1]) return;
    c.box = union(c.box, box);
  }

  /**
   * Cell `key` has an HLOD proxy whose bounds are `box` (the cell's content as cooked): the cell takes that box, and the
   * proxy rings. Without one (`box` null) it is back to the full-detail rings and its estimated box stays.
   */
  setProxy(key: string, box: Readonly<XZBox> | null): void {
    const c = this.cells.get(key);
    if (!c) return;
    if (box && box.every(Number.isFinite) && box[2] >= box[0] && box[3] >= box[1]) {
      c.box = [box[0], box[1], box[2], box[3]];
      c.exact = true;
      c.proxied = true;
    } else c.proxied = false;
  }

  /** Whether cell `key` is resident (its full detail wanted). */
  isResident(key: string): boolean {
    return this.cells.get(key)?.resident ?? false;
  }

  /** Whether cell `key` draws with a proxy when not resident. */
  proxied(key: string): boolean {
    return this.cells.get(key)?.proxied ?? false;
  }

  /**
   * Whether a proxied cell within the proxy near ring of `sources` is not drawn at full detail yet (not resident, or still
   * loading) within `radius` (the near ring by default): its proxy would sit next to the eye.
   */
  nearPending(sources: readonly StreamSource[], radius = this.config.proxyNearRadius): boolean {
    const r = radius;
    for (const c of this.cells.values()) {
      if (!c.proxied || (c.resident && !c.loading)) continue;
      if (this.distance(c, sources) <= r) return true;
    }
    return false;
  }

  /** The hold radius of proxied cells (metres; {@link CellStreamingConfig.proxyHoldRadius}). */
  get holdRadius(): number {
    return this.config.proxyHoldRadius;
  }

  private loadRadiusOf(c: CellState): number {
    return c.proxied ? this.config.proxyLoadRadius : this.config.loadRadius;
  }

  private nearRadiusOf(c: CellState): number {
    return c.proxied ? this.config.proxyNearRadius : this.config.nearRadius;
  }

  /** The geometry of cell `key` weighs `bytes`: `measured` once it was built (a later estimate does not replace that). */
  setBytes(key: string, bytes: number, measured: boolean): void {
    const c = this.cells.get(key);
    if (!c || !Number.isFinite(bytes) || bytes < 0 || (c.measured && !measured)) return;
    c.bytes = bytes;
    c.measured = measured;
  }

  /** A cell's load finished (its members are built). */
  loaded(key: string): void {
    const c = this.cells.get(key);
    if (c) c.loading = false;
  }

  /** Keys of the cells loading now. */
  loadingKeys(): string[] {
    const out: string[] = [];
    for (const c of this.cells.values()) if (c.loading) out.push(c.key);
    return out;
  }

  /** Cells loading now. */
  get loading(): number {
    let n = 0;
    for (const c of this.cells.values()) if (c.loading) n++;
    return n;
  }

  /** Geometry bytes of the resident cells (measured or estimated). */
  get residentBytes(): number {
    let b = 0;
    for (const c of this.cells.values()) if (c.resident) b += c.bytes;
    return b;
  }

  /** Counts for diagnostics. */
  stats(): { cells: number; resident: number; loading: number; entities: number; residentEntities: number; residentMB: number; budgetMB: number; loads: number; unloads: number; evictions: number } {
    let resident = 0, loading = 0, residentEntities = 0;
    for (const c of this.cells.values()) {
      if (c.resident) { resident++; residentEntities += c.members.length; }
      if (c.loading) loading++;
    }
    const mb = (b: number): number => (Number.isFinite(b) ? Math.round(b / 1048576) : -1);
    return { cells: this.cells.size, resident, loading, entities: this.cellOf.size, residentEntities, residentMB: mb(this.residentBytes), budgetMB: mb(this.config.budgetBytes), loads: this.loads, unloads: this.unloads, evictions: this.evictions };
  }

  private makeResident(c: CellState, nowMs: number): void {
    c.resident = true;
    c.loading = true;
    c.farSince = null;
    c.since = nowMs;
    this.loads++;
  }

  private evict(c: CellState): void {
    c.resident = false;
    c.farSince = null;
    this.unloads++;
    this.evictions++;
  }

  /**
   * Make resident the cells the first picture needs around `sources` (the opening view): those within the near ring, then
   * the most urgent ones within the load ring while they fit the budget. Returns their keys.
   */
  primeAround(sources: readonly StreamSource[], nowMs = 0): string[] {
    const { budgetBytes } = this.config;
    const ranked: Array<{ c: CellState; d: number; u: number }> = [];
    for (const c of this.cells.values()) {
      if (c.resident) continue;
      const d = this.distance(c, sources);
      if (d <= this.loadRadiusOf(c)) ranked.push({ c, d, u: this.urgency(c, sources, d) });
    }
    ranked.sort((a, b) => a.u - b.u);
    let bytes = this.residentBytes;
    const out: string[] = [];
    for (const { c, d } of ranked) {
      if (d > this.nearRadiusOf(c) && bytes + c.bytes > budgetBytes) continue;
      this.makeResident(c, nowMs);
      bytes += c.bytes;
      out.push(c.key);
    }
    return out;
  }

  /** XZ distance from (x, z) to cell `key`'s box (Infinity for an unknown cell). */
  distanceTo(key: string, x: number, z: number): number {
    const c = this.cells.get(key);
    return c ? boxDistance(c.box, x, z) : Number.POSITIVE_INFINITY;
  }

  private distance(c: CellState, sources: readonly StreamSource[]): number {
    let d = Infinity;
    for (const s of sources) d = Math.min(d, boxDistance(c.box, s.x, s.z));
    return d;
  }

  /** Load order: distance in quarter load rings, two steps sooner when in front of a source that looks. */
  private urgency(c: CellState, sources: readonly StreamSource[], d: number): number {
    let ahead = 0;
    const b = c.box;
    for (const s of sources) {
      if (!s.dir || ahead) continue;
      if (boxDistance(b, s.x, s.z) === 0) { ahead = 1; break; }
      // The centre or any corner of the box within 60 degrees of the view direction.
      const pts: ReadonlyArray<readonly [number, number]> = [[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], [b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]];
      for (const [px, pz] of pts) {
        const cx = px - s.x, cz = pz - s.z;
        const len = Math.hypot(cx, cz);
        if (len > 1e-6 && (cx * s.dir[0] + cz * s.dir[1]) / len > 0.5) { ahead = 1; break; }
      }
    }
    return d / Math.max(1, this.config.loadRadius / 4) - 2 * ahead;
  }

  /**
   * Residency around `sources` at time `nowMs`: the cells to load (bounded by `maxLoading` and the budget) and to unload
   * (past the ring and the hysteresis band for the unload delay, or evicted by the budget for a more urgent cell).
   */
  update(sources: readonly StreamSource[], nowMs: number): StreamChange {
    const { unloadMargin, unloadDelayMs, maxLoading, budgetBytes, minResidentMs } = this.config;
    const want: Array<{ c: CellState; d: number; u: number }> = [];
    const kept: Array<{ c: CellState; d: number; u: number }> = [];
    const unload: string[] = [];
    let loading = 0, proxiedLoading = 0;
    for (const c of this.cells.values()) {
      if (c.loading) {
        loading++;
        if (c.proxied) proxiedLoading++;
      }
      const d = this.distance(c, sources);
      const loadRadius = this.loadRadiusOf(c);
      if (!c.resident) {
        if (d <= loadRadius) want.push({ c, d, u: this.urgency(c, sources, d) });
        continue;
      }
      // A proxied cell's hysteresis band is half a ring step (its full detail is what the memory goes to).
      if (d <= loadRadius + (c.proxied ? unloadMargin / 2 : unloadMargin)) {
        c.farSince = null;
        kept.push({ c, d, u: this.urgency(c, sources, d) });
        continue;
      }
      // A cell still loading finishes first (its builds are in flight).
      if (!c.loading) {
        c.farSince ??= nowMs;
        if (nowMs - c.farSince >= (c.proxied ? this.config.proxyUnloadDelayMs : unloadDelayMs)) {
          c.resident = false;
          c.farSince = null;
          this.unloads++;
          unload.push(c.key);
          continue;
        }
      }
      kept.push({ c, d, u: Number.POSITIVE_INFINITY });
    }
    want.sort((a, b) => a.u - b.u);
    // Eviction candidates, least urgent first.
    kept.sort((a, b) => b.u - a.u);
    let bytes = 0;
    for (const k of kept) bytes += k.c.bytes;
    const evictable = (k: { c: CellState; d: number }): boolean => k.c.resident && !k.c.loading && k.d > this.nearRadiusOf(k.c) && nowMs - k.c.since >= minResidentMs;
    const load: string[] = [];
    for (const w of want) {
      if (loading >= maxLoading) break;
      // The nearest cells load at once (a proxy must never sit next to the eye); the rest of the proxied ones one at a time.
      if (w.c.proxied && proxiedLoading >= this.config.proxyMaxLoading && w.d > this.config.proxyHoldRadius) continue;
      if (w.d > this.nearRadiusOf(w.c)) {
        // Make room: evict resident cells past the near ring, loaded long enough, clearly less urgent than this one.
        while (bytes + w.c.bytes > budgetBytes) {
          const v = kept.find((k) => evictable(k) && k.u > w.u + EVICT_MARGIN);
          if (!v) break;
          this.evict(v.c);
          bytes -= v.c.bytes;
          unload.push(v.c.key);
        }
        // The most urgent cell that does not fit waits; the ones after it are less urgent.
        if (bytes + w.c.bytes > budgetBytes) break;
      }
      this.makeResident(w.c, nowMs);
      bytes += w.c.bytes;
      loading++;
      if (w.c.proxied) proxiedLoading++;
      load.push(w.c.key);
    }
    // Over budget with nothing waiting (a cell measured heavier than its estimate): drop the least urgent.
    while (bytes > budgetBytes) {
      const v = kept.find(evictable);
      if (!v) break;
      this.evict(v.c);
      bytes -= v.c.bytes;
      unload.push(v.c.key);
    }
    return { load, unload };
  }
}

function union(a: XZBox, b: Readonly<XZBox>): XZBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Decoded and prepared geometry per stored byte of a cooked entry (Lisbon Hills: 104 MB stored, about 620 MB drawn). */
const COOKED_EXPANSION = 6;

/**
 * Estimated geometry bytes of each cell of `streamer` from a cooked package's cells (`cells` of the manifest: the stored
 * bytes of the outputs placed in each level-0 cell): a level-0 cell's bytes are shared among the top-level entities placed
 * in it, and a streamed cell holds its members' shares. Cells without cooked bytes keep their default.
 */
export function cookedCellBytes(world: WorldDoc, partition: CellPartition, streamer: CellStreamer, cells: ReadonlyArray<{ key: string; bytes: number }>): void {
  const stored = new Map<string, number>();
  for (const c of cells) if (c.key !== 'p') stored.set(c.key, c.bytes);
  const share = new Map<EntityId, string>();
  const count = new Map<string, number>();
  for (const id in world.entities) {
    const e = world.entities[id];
    if (!e || e.parent !== null || e.template) continue;
    const xz = worldXZ(world, id);
    if (!xz) continue;
    const key = assignCell(partition, xz[0], xz[1], 0);
    share.set(id, key);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  for (const key of streamer.keys()) {
    let bytes = 0;
    let known = false;
    for (const id of streamer.members(key)) {
      const k = share.get(id);
      const b = k === undefined ? undefined : stored.get(k);
      if (k === undefined || b === undefined) continue;
      known = true;
      bytes += (b * COOKED_EXPANSION) / Math.max(1, count.get(k) ?? 1);
    }
    if (known) streamer.setBytes(key, bytes, false);
  }
}

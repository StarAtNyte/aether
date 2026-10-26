/**
 * Architectural view modes for parametric buildings (entities with
 * `arch` metadata, see @aether/arch):
 *
 * - walls: `up` (as built), `cutaway` (exterior walls facing the camera are
 *   sectioned at sill height so rooms read from outside, like a doll's
 *   house), `down` (every wall sectioned low: a furnished plan in 3D);
 * - levels: `stacked`, `exploded` (storeys and roof lift apart, animated) or
 *   `solo` (only the selected storey);
 * - x-ray: walls, floors, ceilings and roofs turn to translucent glass while
 *   furniture and lights stay solid;
 * - section: a horizontal cut at a height above the ground floor (the
 *   renderer clips the scene; walls are rebuilt up to the cut with a dark
 *   cap, the architectural poche).
 *
 * Lowered walls are not scaled: they are regenerated with the wall
 * generator's view-only `cut` param (a runtime override of this view, never
 * written to the document), so window holes fill in, doorways stay open and
 * the cut face gets its cap. Ceiling fittings and wall-mounted pieces on
 * lowered walls hide their geometry (their light keeps shining).
 *
 * Everything here is view state: the document, physics and logic never see
 * it. The decision per entity is a pure function ({@link archDecision},
 * unit-tested); {@link ArchView} applies it to the scene graph without
 * allocating per frame and restores every touched object when a mode ends.
 */
import { Box3, DoubleSide, MeshStandardMaterial, type Material, type Mesh, type Object3D, type PerspectiveCamera } from 'three';
import type { Entity } from '@aether/core';
import { furnitureByKind } from '@aether/arch';
import type { SceneSync } from '../sync/scene-sync';
import type { EntityNode } from '../sync/entity-node';

/** Wall display mode. */
export type WallMode = 'up' | 'cutaway' | 'down';
/** Storey display mode. */
export type LevelMode = 'stacked' | 'exploded' | 'solo';
/** How a piece is mounted (from the furniture catalogue), or null for structure. */
export type ArchMount = 'floor' | 'wall' | 'ceiling' | 'surface' | null;

/** The architectural view state. */
export interface ArchViewState {
  walls: WallMode;
  levels: LevelMode;
  /** Storey shown by `solo` (0 = ground floor). */
  level: number;
  xray: boolean;
  /** Section cut height in metres above the building's ground floor, or null. */
  section: number | null;
}

/** Default view: the building as built. */
export const DEFAULT_ARCH_VIEW: Readonly<ArchViewState> = Object.freeze({ walls: 'up', levels: 'stacked', level: 0, xray: false, section: null });

/** Height of walls sectioned by the cutaway (a window-sill line). */
export const CUTAWAY_WALL_HEIGHT = 1.05;
/** Keep a cutaway wall's state near its facing plane instead of rebuilding on small camera reversals. */
export function cameraFacingWall(distance: number, previous: boolean): boolean {
  return distance > (previous ? -0.3 : 0.3);
}
/** Height of walls in `down` mode (a plan in 3D). */
export const DOWN_WALL_HEIGHT = 0.3;
/** Extra lift per storey in the exploded view (metres). */
export const EXPLODE_GAP = 3.4;
/** Extra lift of the roof over the top storey in the exploded view. */
export const EXPLODE_ROOF_GAP = 2.2;
/** Seconds the explode / collapse animation takes. */
export const EXPLODE_SECONDS = 0.9;
/** Distance (metres, beyond half the wall thickness) within which a wall-mounted piece belongs to a wall. */
export const WALL_MOUNT_REACH = 0.45;
/** The section's wall cut sits this far below the clipping plane, so its cap is never clipped. */
const SECTION_CAP_OFFSET = 0.004;

/** What a view does to one building entity. */
export interface ArchDecision {
  hidden: boolean;
  /** Section height of a wall (metres above its base), or null to keep the built height. */
  lowered: number | null;
  /** Drawn as translucent x-ray glass. */
  xray: boolean;
}

/** Context of one entity for {@link archDecision}. */
export interface ArchEntityContext {
  role: string;
  /** Storey index of the entity (from its level ancestor; 0 for site works). */
  level: number;
  /** Exterior wall whose outside faces the camera (cutaway candidates). */
  facesCamera: boolean;
  /** The host wall of a window / door / opening is lowered (or, for a wall-mounted piece, the wall it hangs on). */
  hostLowered: boolean;
  /** Mounting of furniture / fixtures / lights (null for structure). */
  mount?: ArchMount;
  /** Walls: height above the wall base where the section plane crosses it (null: no section). */
  sectionAt?: number | null;
}

/** Roles drawn translucent by the x-ray. */
const XRAY_ROLES: ReadonlySet<string> = new Set(['wall', 'room', 'ceiling', 'roof', 'window', 'opening', 'door', 'railing', 'stair', 'column']);
/** Roles of building contents that may hang on a wall or from the ceiling. */
const MOUNTED_ROLES: ReadonlySet<string> = new Set(['furniture', 'fixture', 'light', 'switch']);

/** True when the view looks into the building from above (ceilings and roofs would block it). */
export function looksInside(state: Readonly<ArchViewState>): boolean {
  return state.walls !== 'up' || state.levels !== 'stacked' || state.section !== null;
}

/** Pure per-entity decision of the view state. */
export function archDecision(state: Readonly<ArchViewState>, ctx: ArchEntityContext): ArchDecision {
  const r = ctx.role;
  const out: ArchDecision = { hidden: false, lowered: null, xray: state.xray && XRAY_ROLES.has(r) };
  if (state.levels === 'solo' && ctx.level !== state.level && r !== 'building' && r !== 'site' && r !== 'pool') out.hidden = true;
  const looking = looksInside(state);
  // Seen from above, ceilings and the roof would hide everything the view is for.
  if (looking && (r === 'ceiling' || r === 'roof')) out.hidden = true;
  if (r === 'wall') {
    let cut: number | null = null;
    if (state.walls === 'down') cut = DOWN_WALL_HEIGHT;
    else if (state.walls === 'cutaway' && ctx.facesCamera) cut = CUTAWAY_WALL_HEIGHT;
    const s = ctx.sectionAt ?? null;
    if (s !== null && Number.isFinite(s)) cut = cut === null ? s : Math.min(cut, s);
    if (cut !== null && cut <= 0.05) {
      out.hidden = true;
      cut = null;
    }
    out.lowered = cut;
  }
  if ((r === 'window' || r === 'opening' || r === 'door') && ctx.hostLowered) out.hidden = true;
  if (MOUNTED_ROLES.has(r)) {
    // Ceiling fittings float once ceilings are gone; pieces on a sectioned wall would hang in the air.
    if (looking && ctx.mount === 'ceiling') out.hidden = true;
    if (ctx.mount === 'wall' && ctx.hostLowered) out.hidden = true;
  }
  return out;
}

/** Lift of storey `level` (and the roof) in the exploded view at animation progress `t` (0..1). */
export function explodeLift(level: number, isRoof: boolean, t: number): number {
  const e = t * t * (3 - 2 * t);
  return (level * EXPLODE_GAP + (isRoof ? EXPLODE_ROOF_GAP : 0)) * e;
}

/**
 * Distance in plan from a point to a wall segment that starts at (ax, az)
 * and runs `len` metres along the unit direction (dx, dz).
 */
export function distanceToWall(px: number, pz: number, ax: number, az: number, dx: number, dz: number, len: number): number {
  const t = Math.max(0, Math.min(len, (px - ax) * dx + (pz - az) * dz));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

interface WallInfo {
  node: Readonly<EntityNode>;
  level: number;
  height: number;
  length: number;
  thickness: number;
  exterior: boolean;
  /** Building centre (world x, z) the outside points away from. */
  cx: number;
  cz: number;
  /** Current section height of this wall (null: full height) — updated on apply. */
  cut: number | null;
  facing: boolean;
}

interface LevelInfo {
  node: Readonly<EntityNode>;
  index: number;
  baseY: number;
}

interface Member {
  node: Readonly<EntityNode>;
  role: string;
  level: number;
  wall: string | null;
  roof: boolean;
  mount: ArchMount;
  /** Wall-mounted pieces: the index of the wall they hang on in `walls`, or -1. */
  hostWall: number;
}

/** Applies {@link ArchViewState} to the buildings of a {@link SceneSync}. */
export class ArchView {
  private state: ArchViewState = { ...DEFAULT_ARCH_VIEW };
  private dirty = true;
  private explode = 0;
  private walls: WallInfo[] = [];
  private levels: LevelInfo[] = [];
  /** Building entities per node with their storey index. */
  private members: Member[] = [];
  private readonly lowered = new Set<Readonly<EntityNode>>();
  private readonly hidden = new Set<Readonly<EntityNode>>();
  private readonly lifted = new Set<Readonly<EntityNode>>();
  private readonly swapped = new Map<Mesh, Material | Material[]>();
  private readonly xrayMaterial: MeshStandardMaterial;
  private readonly loweredIds = new Set<string>();
  private camX = Number.NaN;
  private camZ = Number.NaN;
  private indexed = false;
  /** Lowest floor (world y) of the buildings: the section height's zero. */
  private baseY = 0;
  private hasBuildings = false;
  private levelCount = 0;

  constructor(private readonly sync: SceneSync) {
    this.xrayMaterial = new MeshStandardMaterial({ color: '#cfe0f2', roughness: 0.25, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });
    this.xrayMaterial.name = 'aether:xray';
  }

  /** Current state (copy). */
  get value(): ArchViewState {
    return { ...this.state };
  }

  /** True when the world has at least one building (indexes first when needed). */
  get active(): boolean {
    if (!this.indexed) this.index();
    return this.hasBuildings;
  }

  /** Number of storeys of the tallest building (0 without buildings). */
  get storeys(): number {
    if (!this.indexed) this.index();
    return this.levelCount;
  }

  /** World height of the section plane, or null when off. */
  get sectionY(): number | null {
    return this.state.section === null ? null : this.baseY + this.state.section;
  }

  /** True while the explode animation runs. */
  get animating(): boolean {
    const target = this.state.levels === 'exploded' ? 1 : 0;
    return Math.abs(this.explode - target) > 1e-3;
  }

  /** Change the view (partial). */
  set(patch: Partial<ArchViewState>): void {
    const next = { ...this.state, ...patch };
    if (next.walls !== 'up' && next.walls !== 'cutaway' && next.walls !== 'down') next.walls = 'up';
    if (next.levels !== 'stacked' && next.levels !== 'exploded' && next.levels !== 'solo') next.levels = 'stacked';
    next.xray = next.xray === true;
    if (next.section !== null && !(typeof next.section === 'number' && Number.isFinite(next.section) && next.section >= -1 && next.section <= 400)) next.section = null;
    next.level = Math.max(-8, Math.min(200, Math.round(Number.isFinite(next.level) ? next.level : 0)));
    this.state = next;
    this.dirty = true;
  }

  /** The scene changed (entities added, removed or rebuilt): re-index on the next update. */
  invalidate(): void {
    this.indexed = false;
    this.dirty = true;
  }

  private index(): void {
    this.indexed = true;
    const facing = new Map(this.walls.map(w => [w.node, w.facing]));
    this.walls = [];
    this.levels = [];
    this.members = [];
    // Forget nodes that left the scene (their objects are gone with them).
    const gone = (n: Readonly<EntityNode>): boolean => this.sync.node(n.id) !== n;
    for (const set of [this.lowered, this.hidden, this.lifted]) for (const n of set) if (gone(n)) set.delete(n);
    for (const mesh of this.swapped.keys()) if (mesh.parent === null) this.swapped.delete(mesh);
    const levelOf = new Map<string, number>();
    let base = Number.POSITIVE_INFINITY;
    let top = -1;
    this.sync.root.updateMatrixWorld(true);
    this.sync.forEachNode((node) => {
      const a = node.entity.arch;
      if (!a || a.role !== 'level') return;
      const index = a.level ?? 0;
      levelOf.set(node.id, index);
      top = Math.max(top, index);
      base = Math.min(base, node.object.matrixWorld.elements[13] as number);
      this.levels.push({ node, index, baseY: node.entity.transform.position[1] });
    });
    this.hasBuildings = this.levels.length > 0;
    this.levelCount = top + 1;
    this.baseY = Number.isFinite(base) ? base : 0;
    if (!this.hasBuildings) return;
    this.sync.forEachNode((node) => {
      const a = node.entity.arch;
      if (!a || a.role === 'level' || a.role === 'building') return;
      const level = node.entity.parent !== null ? (levelOf.get(node.entity.parent) ?? 0) : 0;
      const kind = a.kind ?? '';
      const mount = MOUNTED_ROLES.has(a.role) && kind ? ((furnitureByKind(kind)?.mount as ArchMount | undefined) ?? null) : null;
      this.members.push({ node, role: a.role, level, wall: a.wall ?? null, roof: a.role === 'roof', mount, hostWall: -1 });
    });
    const centres = new Map<string, [number, number]>();
    for (const m of this.members) {
      if (m.role !== 'wall') continue;
      const p = m.node.entity.parent ?? '';
      let centre = centres.get(p);
      if (!centre) {
        centre = roomCentre(this.sync, p) ?? [0, 0];
        centres.set(p, centre);
      }
      const e = m.node.entity;
      this.walls.push({ node: m.node, level: m.level, height: wallNumber(e, 'height', 3), length: wallNumber(e, 'length', 0), thickness: wallNumber(e, 'thickness', 0.15), exterior: e.arch?.kind === 'exterior', cx: centre[0], cz: centre[1], cut: null, facing: facing.get(m.node) ?? false });
    }
    // Wall-mounted pieces: find the wall each one hangs on (same storey, nearest within reach).
    for (const m of this.members) {
      if (m.mount !== 'wall') continue;
      const me = m.node.object.matrixWorld.elements;
      const px = me[12] as number;
      const pz = me[14] as number;
      let best = -1;
      let bestD = Number.POSITIVE_INFINITY;
      this.walls.forEach((w, i) => {
        if (w.level !== m.level) return;
        const we = w.node.object.matrixWorld.elements;
        const d = distanceToWall(px, pz, we[12] as number, we[14] as number, we[0] as number, we[2] as number, w.length);
        if (d < w.thickness / 2 + WALL_MOUNT_REACH && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      m.hostWall = best;
    }
  }

  /**
   * Bring the scene in line with the state. Cheap when nothing changed;
   * returns true when something visible changed (redraw).
   */
  update(camera: PerspectiveCamera, dt: number): boolean {
    if (!this.indexed) this.index();
    if (!this.hasBuildings) return this.restoreAll();
    let changed = false;
    const target = this.state.levels === 'exploded' ? 1 : 0;
    if (this.explode !== target) {
      const step = Math.min(1, Math.max(0, dt) / EXPLODE_SECONDS);
      this.explode = target > this.explode ? Math.min(target, this.explode + step) : Math.max(target, this.explode - step);
      if (!(dt > 0)) this.explode = target;
      changed = true;
      this.applyLift();
    }
    if (this.state.walls === 'cutaway' && (Math.abs(camera.position.x - this.camX) > 0.05 || Math.abs(camera.position.z - this.camZ) > 0.05)) this.dirty = true;
    if (!this.dirty) return changed;
    this.dirty = false;
    this.camX = camera.position.x;
    this.camZ = camera.position.z;
    this.applyLift();
    const sectionY = this.sectionY;
    // Walls first (openings and wall-mounted pieces follow their host).
    this.loweredIds.clear();
    for (const w of this.walls) {
      const facing = w.exterior && this.facesCamera(w, camera);
      // The storey's resting height: an exploded storey's lift (also while it animates back) is not part of the cut.
      const wallBase = (w.node.object.matrixWorld.elements[13] as number) - explodeLift(w.level, false, this.explode);
      const sectionAt = sectionY === null ? null : sectionY - wallBase - SECTION_CAP_OFFSET;
      const d = archDecision(this.state, { role: 'wall', level: w.level, facesCamera: facing, hostLowered: false, sectionAt: sectionAt !== null && sectionAt < w.height ? sectionAt : null });
      const cut = d.lowered !== null && d.lowered < w.height ? round3(d.lowered) : null;
      this.setLowered(w, cut);
      this.setHidden(w.node, d.hidden);
      this.setXray(w.node, d.xray);
      if (cut !== null || d.hidden) this.loweredIds.add(w.node.id);
    }
    for (const m of this.members) {
      if (m.role === 'wall') continue;
      const host = m.mount === 'wall' ? (m.hostWall >= 0 ? (this.walls[m.hostWall]?.node.id ?? null) : null) : m.wall;
      const d = archDecision(this.state, { role: m.role, level: m.level, facesCamera: false, hostLowered: host !== null && this.loweredIds.has(host), mount: m.mount });
      this.setHidden(m.node, d.hidden);
      this.setXray(m.node, d.xray);
    }
    for (const l of this.levels) this.setHidden(l.node, this.state.levels === 'solo' && l.index !== this.state.level, true);
    this.sync.root.updateMatrixWorld(true);
    return true;
  }

  private facesCamera(w: WallInfo, camera: PerspectiveCamera): boolean {
    const e = w.node.object.matrixWorld.elements;
    // Wall frame: +X along the wall from its start, +Z across it.
    const mx = (e[12] as number) + (e[0] as number) * w.length * 0.5;
    const mz = (e[14] as number) + (e[2] as number) * w.length * 0.5;
    let nx = e[8] as number;
    let nz = e[10] as number;
    if (nx * (mx - w.cx) + nz * (mz - w.cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    w.facing = cameraFacingWall(nx * (camera.position.x - mx) + nz * (camera.position.z - mz), w.facing);
    return w.facing;
  }

  private applyLift(): void {
    const t = this.explode;
    for (const l of this.levels) {
      const lift = explodeLift(l.index, false, t);
      const el = l.node.object.matrix.elements;
      el[13] = l.baseY + lift;
      if (lift !== 0) this.lifted.add(l.node);
      else this.lifted.delete(l.node);
      l.node.object.matrixWorldNeedsUpdate = true;
    }
    for (const m of this.members) {
      if (!m.roof) continue;
      const extra = explodeLift(0, true, t);
      const el = m.node.object.matrix.elements;
      el[13] = m.node.entity.transform.position[1] + extra;
      if (extra !== 0) this.lifted.add(m.node);
      else this.lifted.delete(m.node);
      m.node.object.matrixWorldNeedsUpdate = true;
    }
    this.sync.root.updateMatrixWorld(true);
  }

  /** Section a wall at `cut` metres (null restores the document wall). Regenerates only on change. */
  private setLowered(w: WallInfo, cut: number | null): void {
    const node = w.node;
    const shape = node.entity.shape;
    const current = shape.kind === 'procedural' && typeof shape.params['cut'] === 'number' ? (shape.params['cut'] as number) : null;
    w.cut = cut;
    if (cut === null) {
      if (this.lowered.delete(node) && current !== null) this.sync.restoreNode(node.id);
      return;
    }
    this.lowered.add(node);
    if (current !== cut) this.sync.setProperty(node.id, 'shape.params.cut', cut);
  }

  private setHidden(node: Readonly<EntityNode>, hide: boolean, whole = false): void {
    const o: Object3D = whole ? node.object : node.content;
    if (hide) {
      // Always enforce: the grow-in animation shows content groups again when it settles.
      this.hidden.add(node);
      o.visible = false;
    } else if (this.hidden.delete(node)) {
      o.visible = true;
    }
  }

  private setXray(node: Readonly<EntityNode>, on: boolean): void {
    for (const b of node.bindings) {
      const mesh = b.mesh;
      if (on) {
        if (mesh.material !== this.xrayMaterial) {
          this.swapped.set(mesh, mesh.material);
          mesh.material = this.xrayMaterial;
          mesh.castShadow = false;
        }
      } else {
        const orig = this.swapped.get(mesh);
        if (orig !== undefined) {
          if (mesh.material === this.xrayMaterial) {
            mesh.material = orig;
            mesh.castShadow = node.entity.castShadow !== false && !b.seeThrough;
          }
          this.swapped.delete(mesh);
        }
      }
    }
  }

  /** Undo every change (no buildings left, or disposal). Returns true when something changed. */
  restoreAll(): boolean {
    let changed = false;
    for (const n of this.lowered) {
      this.sync.restoreNode(n.id);
      changed = true;
    }
    this.lowered.clear();
    for (const n of this.hidden) {
      n.content.visible = true;
      n.object.visible = n.entity.visible !== false;
      changed = true;
    }
    this.hidden.clear();
    for (const [mesh, mat] of this.swapped) {
      if (mesh.material === this.xrayMaterial) mesh.material = mat;
      changed = true;
    }
    this.swapped.clear();
    for (const n of this.lifted) {
      n.object.matrix.elements[13] = n.entity.transform.position[1];
      n.object.matrixWorldNeedsUpdate = true;
      changed = true;
    }
    this.lifted.clear();
    if (changed) this.sync.root.updateMatrixWorld(true);
    return changed;
  }

  /** Restore the scene and free the x-ray material. */
  dispose(): void {
    this.restoreAll();
    this.xrayMaterial.dispose();
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function wallNumber(e: Entity, key: string, fallback: number): number {
  const p = e.shape.kind === 'procedural' ? e.shape.params : undefined;
  const v = p?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Centre (world x, z) of the rooms on level `levelId`, from their slab bounds. */
const _bb = new Box3();
const _all = new Box3();

function roomCentre(sync: SceneSync, levelId: string): [number, number] | null {
  _all.makeEmpty();
  sync.forEachNode((n) => {
    if (n.entity.parent !== levelId || n.entity.arch?.role !== 'room' || n.entity.arch.kind === 'terrace') return;
    _bb.setFromObject(n.content);
    if (!_bb.isEmpty()) _all.union(_bb);
  });
  return _all.isEmpty() ? null : [(_all.min.x + _all.max.x) / 2, (_all.min.z + _all.max.z) / 2];
}

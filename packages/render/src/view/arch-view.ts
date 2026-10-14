/**
 * Architectural view modes for parametric buildings (entities with
 * `arch` metadata, see @aether/arch):
 *
 * - walls: `up` (as built), `cutaway` (exterior walls facing the camera drop
 *   to a low sill so rooms read from outside, like a doll's house), `down`
 *   (every wall low: a furnished plan in 3D);
 * - levels: `stacked`, `exploded` (storeys and roof lift apart, animated) or
 *   `solo` (only the selected storey);
 * - x-ray: walls, floors, ceilings and roofs turn to translucent glass while
 *   furniture and lights stay solid;
 * - section: a horizontal cut at a height above the ground floor (the
 *   renderer clips the scene; this module only tracks the height).
 *
 * Everything here is view state: the document, physics and logic never see
 * it. The decision per entity is a pure function ({@link archDecision},
 * unit-tested); {@link ArchView} applies it to the scene graph without
 * allocating per frame and restores every touched object when a mode ends.
 */
import { Box3, DoubleSide, MeshStandardMaterial, type Material, type Mesh, type Object3D, type PerspectiveCamera } from 'three';
import type { Entity } from '@aether/core';
import type { SceneSync } from '../sync/scene-sync';
import type { EntityNode } from '../sync/entity-node';

/** Wall display mode. */
export type WallMode = 'up' | 'cutaway' | 'down';
/** Storey display mode. */
export type LevelMode = 'stacked' | 'exploded' | 'solo';

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

/** Height of walls lowered by the cutaway (a window-sill line). */
export const CUTAWAY_WALL_HEIGHT = 1.05;
/** Height of walls in `down` mode (a plan in 3D). */
export const DOWN_WALL_HEIGHT = 0.32;
/** Extra lift per storey in the exploded view (metres). */
export const EXPLODE_GAP = 3.4;
/** Extra lift of the roof over the top storey in the exploded view. */
export const EXPLODE_ROOF_GAP = 2.2;
/** Seconds the explode / collapse animation takes. */
export const EXPLODE_SECONDS = 0.9;

/** What a view does to one building entity. */
export interface ArchDecision {
  hidden: boolean;
  /** Lowered wall height (metres), or null to keep the built height. */
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
  /** The host wall of a window / door / opening is lowered. */
  hostLowered: boolean;
}

/** Roles drawn translucent by the x-ray. */
const XRAY_ROLES: ReadonlySet<string> = new Set(['wall', 'room', 'ceiling', 'roof', 'window', 'opening', 'door', 'railing', 'stair', 'column']);

/** Pure per-entity decision of the view state. */
export function archDecision(state: Readonly<ArchViewState>, ctx: ArchEntityContext): ArchDecision {
  const r = ctx.role;
  const out: ArchDecision = { hidden: false, lowered: null, xray: state.xray && XRAY_ROLES.has(r) };
  if (state.levels === 'solo' && ctx.level !== state.level && r !== 'building' && r !== 'site' && r !== 'pool') out.hidden = true;
  const looking = state.walls !== 'up' || state.levels === 'solo' || state.section !== null;
  // Seen from above, ceilings and the roof would hide everything the view is for.
  if (looking && (r === 'ceiling' || r === 'roof')) out.hidden = true;
  if (state.levels === 'exploded' && r === 'ceiling') out.hidden = true;
  if (r === 'wall') {
    if (state.walls === 'down') out.lowered = DOWN_WALL_HEIGHT;
    else if (state.walls === 'cutaway' && ctx.facesCamera) out.lowered = CUTAWAY_WALL_HEIGHT;
  }
  if ((r === 'window' || r === 'opening' || r === 'door') && ctx.hostLowered) out.hidden = true;
  return out;
}

/** Lift of storey `level` (and the roof) in the exploded view at animation progress `t` (0..1). */
export function explodeLift(level: number, isRoof: boolean, t: number): number {
  const e = t * t * (3 - 2 * t);
  return (level * EXPLODE_GAP + (isRoof ? EXPLODE_ROOF_GAP : 0)) * e;
}

interface WallInfo {
  node: Readonly<EntityNode>;
  level: number;
  height: number;
  exterior: boolean;
  /** Building centre (world x, z) the outside points away from. */
  cx: number;
  cz: number;
}

interface LevelInfo {
  node: Readonly<EntityNode>;
  index: number;
  baseY: number;
}

/** Applies {@link ArchViewState} to the buildings of a {@link SceneSync}. */
export class ArchView {
  private state: ArchViewState = { ...DEFAULT_ARCH_VIEW };
  private dirty = true;
  private explode = 0;
  private walls: WallInfo[] = [];
  private levels: LevelInfo[] = [];
  /** Building entities per node with their storey index. */
  private members: Array<{ node: Readonly<EntityNode>; role: string; level: number; wall: string | null; roof: boolean }> = [];
  private readonly lowered = new Set<Readonly<EntityNode>>();
  private readonly hidden = new Set<Readonly<EntityNode>>();
  private readonly lifted = new Set<Readonly<EntityNode>>();
  private readonly swapped = new Map<Mesh, Material | Material[]>();
  private readonly xrayMaterial: MeshStandardMaterial;
  private camX = Number.NaN;
  private camZ = Number.NaN;
  private indexed = false;
  /** Lowest floor (world y) of the buildings: the section height's zero. */
  private baseY = 0;
  private hasBuildings = false;

  constructor(private readonly sync: SceneSync) {
    this.xrayMaterial = new MeshStandardMaterial({ color: '#cfe0f2', roughness: 0.25, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });
    this.xrayMaterial.name = 'aether:xray';
  }

  /** Current state (copy). */
  get value(): ArchViewState {
    return { ...this.state };
  }

  /** True when the world has at least one building (after the last index). */
  get active(): boolean {
    return this.hasBuildings;
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
    if (next.section !== null && !(Number.isFinite(next.section) && next.section >= -1 && next.section <= 400)) next.section = null;
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
    this.walls = [];
    this.levels = [];
    this.members = [];
    const levelOf = new Map<string, number>();
    let base = Number.POSITIVE_INFINITY;
    this.sync.root.updateMatrixWorld(true);
    this.sync.forEachNode((node) => {
      const a = node.entity.arch;
      if (!a) return;
      if (a.role === 'level') {
        levelOf.set(node.id, a.level ?? 0);
        base = Math.min(base, node.object.matrixWorld.elements[13] as number);
        this.levels.push({ node, index: a.level ?? 0, baseY: node.entity.transform.position[1] });
      }
    });
    this.hasBuildings = this.levels.length > 0;
    this.baseY = Number.isFinite(base) ? base : 0;
    if (!this.hasBuildings) return;
    this.sync.forEachNode((node) => {
      const a = node.entity.arch;
      if (!a || a.role === 'level' || a.role === 'building') return;
      const level = node.entity.parent !== null ? (levelOf.get(node.entity.parent) ?? 0) : 0;
      const roof = a.role === 'roof';
      this.members.push({ node, role: a.role, level, wall: a.wall ?? null, roof });
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
      const params = m.node.entity.shape.kind === 'procedural' ? m.node.entity.shape.params : undefined;
      const h = typeof params?.['height'] === 'number' ? (params['height'] as number) : 3;
      this.walls.push({ node: m.node, level: m.level, height: h, exterior: m.node.entity.arch?.kind === 'exterior', cx: centre[0], cz: centre[1] });
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
    // Walls first (openings follow their host).
    const loweredWalls = new Set<string>();
    for (const w of this.walls) {
      const facing = w.exterior && this.facesCamera(w, camera);
      const d = archDecision(this.state, { role: 'wall', level: w.level, facesCamera: facing, hostLowered: false });
      this.setLowered(w.node, d.lowered === null ? null : Math.min(1, d.lowered / Math.max(0.1, w.height)));
      if (d.lowered !== null) loweredWalls.add(w.node.id);
    }
    for (const m of this.members) {
      const d = archDecision(this.state, { role: m.role, level: m.level, facesCamera: false, hostLowered: m.wall !== null && loweredWalls.has(m.wall) });
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
    const len = wallLength(w.node.entity);
    const mx = (e[12] as number) + (e[0] as number) * len * 0.5;
    const mz = (e[14] as number) + (e[2] as number) * len * 0.5;
    let nx = e[8] as number;
    let nz = e[10] as number;
    if (nx * (mx - w.cx) + nz * (mz - w.cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return nx * (camera.position.x - mx) + nz * (camera.position.z - mz) > 0.3;
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

  private setLowered(node: Readonly<EntityNode>, scaleY: number | null): void {
    const c = node.content;
    if (scaleY === null) {
      if (this.lowered.delete(node)) {
        c.scale.set(1, 1, 1);
        c.updateMatrix();
      }
      return;
    }
    c.scale.set(1, scaleY, 1);
    c.updateMatrix();
    this.lowered.add(node);
  }

  private setHidden(node: Readonly<EntityNode>, hide: boolean, whole = false): void {
    const o: Object3D = whole ? node.object : node.content;
    if (hide) {
      if (!this.hidden.has(node)) {
        this.hidden.add(node);
        o.visible = false;
      }
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
          if (mesh.material === this.xrayMaterial) mesh.material = orig;
          this.swapped.delete(mesh);
        }
      }
    }
  }

  /** Undo every change (no buildings left, or disposal). Returns true when something changed. */
  restoreAll(): boolean {
    let changed = false;
    for (const n of this.lowered) {
      n.content.scale.set(1, 1, 1);
      n.content.updateMatrix();
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

function wallLength(e: Entity): number {
  const p = e.shape.kind === 'procedural' ? e.shape.params : undefined;
  return typeof p?.['length'] === 'number' ? (p['length'] as number) : 0;
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

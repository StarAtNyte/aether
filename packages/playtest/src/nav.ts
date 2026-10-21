/**
 * Navigation graph for the playtest bot, sampled from the physics world
 * itself (so it sees exactly the geometry the player collides with).
 *
 * - **Nodes** are standable feet positions: a grid of downward rays finds
 *   every floor level of every cell, keeping surfaces that are flat enough,
 *   have head room, clear side walls and are not inside a hazard.
 * - **Walk edges** join neighbouring nodes at a climbable height difference
 *   with nothing in between (one knee-height ray, one ground-continuity ray);
 *   they are computed on demand and cached as bits.
 * - **Jump / drop edges** leave ledges: candidates in a cone of open air or
 *   a short step up are filtered analytically (ballistic reach of the
 *   player's speed and jump speed) and a path's jumps are then **validated
 *   by simulating the real character controller** (lazy validation), so a
 *   gap the player cannot clear is never planned through.
 *
 * Search is Dijkstra on typed arrays with a binary heap. Nothing here
 * allocates per expansion beyond the small candidate lists of ledge nodes.
 */
import type { Vec3 } from '@aether/core';
import { CharacterController, type PhysicsWorld } from '@aether/physics';
import { touches, type HazardZone } from './goals';
import type { RideInfo } from './lifts';
import { PLAYER_CAPSULE } from './host';
import { PLAYTEST_LIMITS } from './types';

/** Player abilities that shape the graph. */
export interface NavParams {
  radius: number;
  height: number;
  stepHeight: number;
  maxSlopeDeg: number;
  /** Horizontal speed (m/s). */
  speed: number;
  /** Initial jump speed (m/s). */
  jumpSpeed: number;
  /** Gravity magnitude (m/s²). */
  gravity: number;
}

/** Kind of an edge. */
export enum EdgeKind {
  Walk = 0,
  Jump = 1,
  Drop = 2,
  /** Standing on a vertical lift that carries the player up to a landing. */
  Ride = 3,
}

/**
 * A doorway the grid might miss: a snug opening leaves only a few
 * centimetres of slack, so the grid is given nodes on the doorway's axis.
 */
export interface NavPortal {
  /** Centre of the opening on the floor. */
  center: Vec3;
  /** Horizontal unit vector through the opening (perpendicular to the leaf). */
  normal: [number, number];
  /** Half thickness of the wall / frame the opening cuts. */
  halfThickness: number;
}

/** Bounds and settings of a graph build. */
export interface NavBuildInput {
  pw: PhysicsWorld;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Rays start here. */
  topY: number;
  /** Rays stop here. */
  bottomY: number;
  params: NavParams;
  hazards: readonly HazardZone[];
  /** Doorways that get nodes on their own axis (see {@link NavPortal}). */
  portals?: readonly NavPortal[];
  /** Cooperative cancellation / yielding hook, called now and then while building. */
  tick?: () => Promise<void> | void;
}

/** Maximum jump height (m) for the given abilities. */
export function jumpHeight(p: NavParams): number {
  return (p.jumpSpeed * p.jumpSpeed) / (2 * p.gravity);
}

/**
 * Longest horizontal distance (m) a jump from one foot height can cover
 * while landing `dy` metres above (positive) or below (negative) the take-off
 * point; 0 when the landing is higher than the jump can reach.
 */
export function jumpReach(p: NavParams, dy: number): number {
  const disc = p.jumpSpeed * p.jumpSpeed - 2 * p.gravity * dy;
  if (disc < 0) return 0;
  const t = (p.jumpSpeed + Math.sqrt(disc)) / p.gravity;
  return p.speed * t;
}

/** Longest horizontal distance for a plain drop (no jump) down `-dy` metres. */
export function dropReach(p: NavParams, dy: number): number {
  if (dy >= 0) return 0;
  return p.speed * Math.sqrt((2 * -dy) / p.gravity);
}

/** Cells per side of the blocks the far landing scan prunes by (see {@link NavGraph.linksOf}). */
const BLOCK = 8;

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];
const OPPOSITE = [1, 0, 3, 2, 5, 4, 7, 6] as const;

const PARK: Vec3 = [0, -5000, 0];
/** The grid is sized for about this many cells (about 1 s of ray casts). */
const NAV_TARGET_CELLS = 90_000;

/** A candidate jump or drop from a ledge node. */
export interface LinkEdge {
  to: number;
  kind: EdgeKind.Jump | EdgeKind.Drop | EdgeKind.Ride;
  cost: number;
  /** Lift rides: how to board and ride. */
  ride?: RideInfo;
  /** 0 = not validated, 1 = simulated OK, 2 = simulated and failed. */
  state: 0 | 1 | 2;
}

/** Result of a Dijkstra run. */
/**
 * Where a search is headed: discs (centre x / z and radius, m) that hold every target node.
 * The distance to the nearest disc bounds the cost of getting to a target from below.
 */
export interface TargetDiscs {
  count: number;
  x: Float64Array;
  z: Float64Array;
  r: Float64Array;
}

/** Discs round groups of target nodes (one disc per group). */
export function targetDiscs(g: NavGraph, groups: ReadonlyArray<readonly number[]>): TargetDiscs {
  const n = groups.filter((nodes) => nodes.length > 0).length;
  const out: TargetDiscs = { count: n, x: new Float64Array(n), z: new Float64Array(n), r: new Float64Array(n) };
  let k = 0;
  for (const nodes of groups) {
    if (nodes.length === 0) continue;
    let cx = 0;
    let cz = 0;
    for (const v of nodes) {
      cx += g.px[v] as number;
      cz += g.pz[v] as number;
    }
    cx /= nodes.length;
    cz /= nodes.length;
    let r = 0;
    for (const v of nodes) r = Math.max(r, Math.hypot((g.px[v] as number) - cx, (g.pz[v] as number) - cz));
    out.x[k] = cx;
    out.z[k] = cz;
    out.r[k] = r + 1e-3;
    k++;
  }
  return out;
}

/**
 * Weight on the A* estimate. A walk edge costs at least its grid step, but a doorway node
 * may sit anywhere in its cell, so an edge between neighbouring cells can span up to √5
 * steps of ground (corner to far corner): a straight-line estimate scaled by 0.44 never
 * exceeds the true cost (jumps and drops cost at least their span), so the search stays exact.
 */
const ESTIMATE_SCALE = 0.44;

export interface SearchResult {
  /** Node reached first among the targets, or -1. */
  hit: number;
  dist: Float64Array;
  parent: Int32Array;
  /** Nodes expanded. */
  expanded: number;
}

/** The navigation graph (see the module docs). */
export class NavGraph {
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly x0: number;
  readonly z0: number;
  readonly params: NavParams;
  readonly count: number;
  /** Feet position of each node. */
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  /** Vertical component of the surface normal. */
  readonly ny: Float32Array;
  /** CSR over cells: nodes of cell c are `cellFirst[c] … cellFirst[c + 1]`. */
  readonly cellFirst: Int32Array;
  /** Nodes blocked at planning time (doors that cannot open now, hazards). */
  readonly blocked: Uint8Array;
  /**
   * Extra cost per node, as a multiple of the step onto it (0 = none): the ground near a hostile
   * character is dearer, so routes bend round it. All zero unless a caller paints it.
   */
  readonly danger: Float32Array;
  /** Multiplier on jump, drop and ride costs (1 = none): raised while enemies hunt the player, when a jump means standing still to land. */
  linkScale = 1;
  private readonly known: Uint8Array;
  private readonly okBits: Uint8Array;
  /** Cached walk targets per node and direction (`-2` = not computed). */
  private readonly targetCache: Int32Array;
  /** Searches run (informational). */
  searches = 0;
  /** Nodes expanded over all searches (informational). */
  expandedTotal = 0;
  private readonly links = new Map<number, LinkEdge[]>();
  /** Undirected-agnostic bad edges (`from * count + to`) found by execution. */
  private readonly bad = new Set<number>();
  private readonly pw: PhysicsWorld;
  private heapKey: Float64Array;
  private heapNode: Int32Array;
  private heapSize = 0;
  private readonly distBuf: Float64Array;
  private readonly parentBuf: Int32Array;
  private readonly kindBuf: Uint8Array;
  /** A* estimates of the running search (-1: not computed yet) and its targets. */
  private readonly estBuf: Float64Array;
  private estimate: TargetDiscs | null = null;
  private walker: CharacterController | null = null;
  private readonly spawnY: number;
  /** Hurting volumes: a jump or drop whose arc passes through one is not a way (the river under a leap). */
  private readonly hazards: readonly HazardZone[];
  /** Blocks of {@link BLOCK}×{@link BLOCK} cells: columns and rows, and the lowest node height in each (Infinity when empty). */
  private readonly nbx: number;
  private readonly nbz: number;
  private readonly blockMinY: Float32Array;

  private constructor(
    input: NavBuildInput,
    cell: number,
    nx: number,
    nz: number,
    px: number[],
    py: number[],
    pz: number[],
    ny: number[],
    cellFirst: Int32Array,
  ) {
    this.pw = input.pw;
    this.params = input.params;
    this.hazards = input.hazards;
    this.cell = cell;
    this.nx = nx;
    this.nz = nz;
    this.x0 = input.minX;
    this.z0 = input.minZ;
    this.count = px.length;
    this.px = Float32Array.from(px);
    this.py = Float32Array.from(py);
    this.pz = Float32Array.from(pz);
    this.ny = Float32Array.from(ny);
    this.cellFirst = cellFirst;
    this.blocked = new Uint8Array(this.count);
    this.danger = new Float32Array(this.count);
    this.known = new Uint8Array(this.count);
    this.okBits = new Uint8Array(this.count);
    this.targetCache = new Int32Array(this.count * 8).fill(-2);
    this.heapKey = new Float64Array(1024);
    this.heapNode = new Int32Array(1024);
    this.distBuf = new Float64Array(this.count);
    this.parentBuf = new Int32Array(this.count);
    this.kindBuf = new Uint8Array(this.count);
    this.estBuf = new Float64Array(this.count);
    this.spawnY = input.topY;
    // The lowest surface per block of cells: a far landing scan skips a block no jump or drop can reach (on open
    // land with relief, most of the 14 m around a ledge), which made the scan the bulk of a search.
    this.nbx = Math.ceil(nx / BLOCK);
    this.nbz = Math.ceil(nz / BLOCK);
    this.blockMinY = new Float32Array(this.nbx * this.nbz).fill(Infinity);
    for (let cz = 0; cz < nz; cz++) {
      for (let cx = 0; cx < nx; cx++) {
        const c = cz * nx + cx;
        const b = Math.floor(cz / BLOCK) * this.nbx + Math.floor(cx / BLOCK);
        for (let i = cellFirst[c] as number; i < (cellFirst[c + 1] as number); i++) if ((this.py[i] as number) < (this.blockMinY[b] as number)) this.blockMinY[b] = this.py[i] as number;
      }
    }
  }

  /** Sample the graph. Never throws for odd geometry; returns an empty graph when nothing is standable. */
  static async build(input: NavBuildInput): Promise<NavGraph> {
    const { pw, params } = input;
    const w = Math.max(0.5, input.maxX - input.minX);
    const d = Math.max(0.5, input.maxZ - input.minZ);
    // Small areas (rooms, corridors, doorways) get the finest grid, big open fields a coarser one.
    let cell = Math.max(0.1, Math.ceil(Math.sqrt((w * d) / NAV_TARGET_CELLS) * 20) / 20);
    cell = Math.min(cell, 1);
    while ((w / cell) * (d / cell) > PLAYTEST_LIMITS.MAX_NAV_CELLS) cell += 0.05;
    const nx = Math.max(1, Math.ceil(w / cell));
    const nz = Math.max(1, Math.ceil(d / cell));
    const px: number[] = [];
    const py: number[] = [];
    const pz: number[] = [];
    const ny: number[] = [];
    const cellFirst = new Int32Array(nx * nz + 1);
    // The capsule plus the controller's skin: a gap narrower than this cannot be walked through.
    const r = params.radius + 0.025;
    // Doorway axis nodes, by cell, added after the grid's own nodes of that cell.
    const extras = new Map<number, Array<{ x: number; y: number; z: number; n: number }>>();
    for (const portal of input.portals ?? []) {
      for (const e of portalNodes(pw, portal, params)) {
        const cx = Math.floor((e.x - input.minX) / cell);
        const cz = Math.floor((e.z - input.minZ) / cell);
        if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
        const key = cz * nx + cx;
        const list = extras.get(key);
        if (list) list.push(e);
        else extras.set(key, [e]);
      }
    }
    const slopeMin = Math.cos((params.maxSlopeDeg * Math.PI) / 180);
    const down: Vec3 = [0, -1, 0];
    const origin: Vec3 = [0, 0, 0];
    let work = 0;
    for (let cz = 0; cz < nz; cz++) {
      for (let cx = 0; cx < nx; cx++) {
        cellFirst[cz * nx + cx] = px.length;
        const x = input.minX + (cx + 0.5) * cell;
        const z = input.minZ + (cz + 0.5) * cell;
        let y = input.topY;
        let layers = 0;
        for (let guard = 0; guard < 48 && layers < 8 && px.length < PLAYTEST_LIMITS.MAX_NAV_NODES; guard++) {
          origin[0] = x;
          origin[1] = y;
          origin[2] = z;
          const hit = pw.raycast(origin, down, y - input.bottomY);
          if (!hit) break;
          if (hit.distance < 1e-4) {
            y -= 0.25;
            continue;
          }
          const sy = hit.point[1];
          y = sy - 0.02;
          const isGround = hit.id === null;
          if (hit.normal[1] >= slopeMin && standable(pw, x, sy, z, params, r, input.hazards)) {
            px.push(x);
            py.push(sy);
            pz.push(z);
            ny.push(hit.normal[1]);
            layers++;
          }
          if (isGround) break;
        }
        const ex = extras.get(cz * nx + cx);
        if (ex) {
          const first = cellFirst[cz * nx + cx] as number;
          for (const e of ex) {
            let dup = false;
            for (let k = first; k < px.length && !dup; k++) dup = Math.abs((px[k] as number) - e.x) < 0.03 && Math.abs((pz[k] as number) - e.z) < 0.03 && Math.abs((py[k] as number) - e.y) < 0.1;
            if (!dup) {
              px.push(e.x);
              py.push(e.y);
              pz.push(e.z);
              ny.push(e.n);
            }
          }
        }
        work++;
        if (input.tick && work % 400 === 0) await input.tick();
      }
    }
    cellFirst[nx * nz] = px.length;
    return new NavGraph(input, cell, nx, nz, px, py, pz, ny, cellFirst);
  }

  /** Cell index of a world x/z (clamped inside), or -1 when outside the grid. */
  cellAt(x: number, z: number): number {
    const cx = Math.floor((x - this.x0) / this.cell);
    const cz = Math.floor((z - this.z0) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return -1;
    return cz * this.nx + cx;
  }

  /** Nearest node to `p` (horizontally within `maxH`, vertically within `maxV`), or -1. */
  nearest(p: Readonly<Vec3>, maxH = 1.5, maxV = 2.5): number {
    const rc = Math.ceil(maxH / this.cell);
    const cx0 = Math.floor((p[0] - this.x0) / this.cell);
    const cz0 = Math.floor((p[2] - this.z0) / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let dz = -rc; dz <= rc; dz++) {
      for (let dx = -rc; dx <= rc; dx++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
        const c = cz * this.nx + cx;
        for (let i = this.cellFirst[c] as number; i < (this.cellFirst[c + 1] as number); i++) {
          const ddx = (this.px[i] as number) - p[0];
          const ddz = (this.pz[i] as number) - p[2];
          const ddy = (this.py[i] as number) - p[1];
          const h = Math.hypot(ddx, ddz);
          if (h > maxH || Math.abs(ddy) > maxV) continue;
          // Prefer the surface the feet are on over a farther one at the same spot.
          const score = h + Math.abs(ddy) * 1.5;
          if (score < bestD) {
            bestD = score;
            best = i;
          }
        }
      }
    }
    return best;
  }

  /** Feet position of a node. */
  pos(i: number, out: Vec3 = [0, 0, 0]): Vec3 {
    out[0] = this.px[i] as number;
    out[1] = this.py[i] as number;
    out[2] = this.pz[i] as number;
    return out;
  }

  /** Block or unblock every node whose feet are inside the box. Returns the number changed. */
  setBlocked(min: Readonly<Vec3>, max: Readonly<Vec3>, value: boolean): number {
    let n = 0;
    const cx0 = Math.max(0, Math.floor((min[0] - this.x0) / this.cell));
    const cx1 = Math.min(this.nx - 1, Math.floor((max[0] - this.x0) / this.cell));
    const cz0 = Math.max(0, Math.floor((min[2] - this.z0) / this.cell));
    const cz1 = Math.min(this.nz - 1, Math.floor((max[2] - this.z0) / this.cell));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * this.nx + cx;
        for (let i = this.cellFirst[c] as number; i < (this.cellFirst[c + 1] as number); i++) {
          const y = this.py[i] as number;
          if (y < min[1] || y > max[1]) continue;
          const v = value ? 1 : 0;
          if (this.blocked[i] !== v) {
            this.blocked[i] = v;
            n++;
          }
        }
      }
    }
    return n;
  }

  /** Mark an edge as unusable (execution found it blocked). */
  markBad(from: number, to: number): void {
    this.bad.add(from * this.count + to);
    const links = this.links.get(from);
    if (links) for (const l of links) if (l.to === to) l.state = 2;
  }

  /** Forget the bad edges (a door opened, the world changed). */
  clearBad(): void {
    this.bad.clear();
    for (const list of this.links.values()) for (const l of list) if (l.state === 2) l.state = 0;
  }

  // ---------------------------------------------------------------------
  // Walk edges
  // ---------------------------------------------------------------------

  private walkTarget(i: number, d: number): number {
    const key = i * 8 + d;
    const hit = this.targetCache[key] as number;
    if (hit !== -2) return hit;
    const v = this.computeWalkTarget(i, d);
    this.targetCache[key] = v;
    return v;
  }

  private computeWalkTarget(i: number, d: number): number {
    const dir = DIRS[d] as readonly [number, number];
    const c = this.cellOf(i);
    const cx = (c % this.nx) + dir[0];
    const cz = Math.floor(c / this.nx) + dir[1];
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return -1;
    const nc = cz * this.nx + cx;
    const dist = this.cell * (dir[0] !== 0 && dir[1] !== 0 ? Math.SQRT2 : 1);
    const flat = (this.ny[i] as number) > 0.995;
    const yi = this.py[i] as number;
    let best = -1;
    let bestD = Infinity;
    for (let j = this.cellFirst[nc] as number; j < (this.cellFirst[nc + 1] as number); j++) {
      const dy = (this.py[j] as number) - yi;
      const flatJ = (this.ny[j] as number) > 0.995;
      const allowed = flat && flatJ ? this.params.stepHeight + 0.05 : Math.max(this.params.stepHeight + 0.05, dist * Math.tan((this.params.maxSlopeDeg * 0.8 * Math.PI) / 180) + 0.1);
      if (Math.abs(dy) <= allowed && Math.abs(dy) < bestD) {
        bestD = Math.abs(dy);
        best = j;
      }
    }
    return best;
  }

  private cellOf(i: number): number {
    const cx = Math.floor(((this.px[i] as number) - this.x0) / this.cell);
    const cz = Math.floor(((this.pz[i] as number) - this.z0) / this.cell);
    return cz * this.nx + cx;
  }

  private walkOk(i: number, d: number, j: number): boolean {
    const bit = 1 << d;
    if ((this.known[i] as number) & bit) return ((this.okBits[i] as number) & bit) !== 0;
    const ok = this.checkWalk(i, j);
    this.known[i] = (this.known[i] as number) | bit;
    if (ok) this.okBits[i] = (this.okBits[i] as number) | bit;
    const rb = 1 << (OPPOSITE[d] as number);
    this.known[j] = (this.known[j] as number) | rb;
    if (ok) this.okBits[j] = (this.okBits[j] as number) | rb;
    return ok;
  }

  private checkWalk(i: number, j: number): boolean {
    const ax = this.px[i] as number, ay = this.py[i] as number, az = this.pz[i] as number;
    const bx = this.px[j] as number, by = this.py[j] as number, bz = this.pz[j] as number;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return true;
    const low = Math.min(ay, by);
    const o: Vec3 = [ax, Math.max(ay, by) + this.params.stepHeight + 0.15, az];
    const dir: Vec3 = [dx / len, 0, dz / len];
    // Something between the two cells at knee height (above the step they climb)?
    if (this.pw.raycast(o, dir, len)) return false;
    // A second ray near the head catches low lintels the head-room test of the nodes missed in the middle.
    o[1] = low + this.params.height * 0.9;
    if (this.pw.raycast(o, dir, len)) return false;
    // Ground continuity in the middle (a gap narrower than a cell, a hole).
    const mid: Vec3 = [ax + dx / 2, Math.max(ay, by) + 0.6, az + dz / 2];
    const g = this.pw.raycast(mid, [0, -1, 0], 0.6 + Math.abs(ay - by) + this.params.stepHeight + 0.5);
    if (!g) return false;
    return g.point[1] >= low - 0.35 && g.point[1] <= Math.max(ay, by) + 0.35;
  }

  // ---------------------------------------------------------------------
  // Jump / drop edges
  // ---------------------------------------------------------------------

  /**
   * The far landing scan's offsets (the same for every node): for each cell offset in the square of radius `rc`,
   * the directions it may be reached from (a bit per DIRS index: the cell's own direction and its two angular
   * neighbours; 0 outside the ring), its angle and its 16-way bin. Computed once instead of per node and cell.
   */
  private farTable(): { rc: number; stride: number; span: number; accept: Uint8Array; ang: Float64Array; bin: Uint8Array } {
    if (this.far) return this.far;
    const p = this.params;
    const R = Math.min(Math.max(jumpReach(p, 0), dropReach(p, -30)) * 0.95 + this.cell, 14);
    const rc = Math.ceil(R / this.cell);
    // Far landings are sampled every ~0.25 m, however fine the grid is.
    const stride = Math.max(1, Math.round(0.25 / this.cell));
    const span = 2 * rc + 1;
    const accept = new Uint8Array(span * span);
    const ang = new Float64Array(span * span);
    const bin = new Uint8Array(span * span);
    for (let dz = -rc; dz <= rc; dz++) {
      for (let dx = -rc; dx <= rc; dx++) {
        const k = (dz + rc) * span + (dx + rc);
        const a = Math.atan2(dz, dx);
        ang[k] = a;
        bin[k] = ((Math.round(((a + Math.PI) / (Math.PI * 2)) * 16) % 16) + 16) % 16;
        const dist2 = dx * dx + dz * dz;
        if (dist2 < 2 || dist2 > rc * rc) continue;
        const sector = ((Math.round((a / (Math.PI * 2)) * 8) % 8) + 8) % 8;
        // Map the sector to the DIRS index (E, W, S(z+), N(z-), diagonals).
        const dirIdx = sectorToDir(sector);
        accept[k] = (1 << dirIdx) | (1 << neighbourDir(dirIdx, 1)) | (1 << neighbourDir(dirIdx, -1));
      }
    }
    this.far = { rc, stride, span, accept, ang, bin };
    return this.far;
  }
  private far: { rc: number; stride: number; span: number; accept: Uint8Array; ang: Float64Array; bin: Uint8Array } | null = null;

  /** Jump and drop candidates leaving node `i` (cached). */
  linksOf(i: number): LinkEdge[] {
    const cached = this.links.get(i);
    if (cached) return cached;
    const out: LinkEdge[] = [];
    this.links.set(i, out);
    const p = this.params;
    const maxUp = jumpHeight(p) * 0.85;
    const yi = this.py[i] as number;
    const xi = this.px[i] as number;
    const zi = this.pz[i] as number;
    const c0 = this.cellOf(i);
    const cx0 = c0 % this.nx;
    const cz0 = Math.floor(c0 / this.nx);
    const seen = new Set<number>();
    // A wall between take-off and landing makes it no jump at all (checked at chest height at both ends).
    const clearLine = (j: number): boolean => {
      const bx = this.px[j] as number, by = this.py[j] as number, bz = this.pz[j] as number;
      const dx = bx - xi, dz = bz - zi;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) return true;
      const top = Math.max(yi, by) + 1;
      return !this.pw.raycast([xi, top, zi], [dx / len, 0, dz / len], len);
    };
    // The arc of the leap (or fall) must not pass through a hazard: the game would stop the player there.
    const arcClear = (j: number, kind: EdgeKind.Jump | EdgeKind.Drop): boolean => {
      if (this.hazards.length === 0) return true;
      const bx = this.px[j] as number, by = this.py[j] as number, bz = this.pz[j] as number;
      const g = Math.max(0.1, p.gravity);
      const vy = kind === EdgeKind.Jump ? p.jumpSpeed : 0;
      const disc = vy * vy - 2 * g * (by - yi);
      if (disc < 0) return true;
      const T = (vy + Math.sqrt(disc)) / g;
      const q: Vec3 = [0, 0, 0];
      for (let k = 1; k < 10; k++) {
        const tau = (T * k) / 10;
        const f = k / 10;
        q[0] = xi + (bx - xi) * f;
        q[1] = yi + vy * tau - (g * tau * tau) / 2;
        q[2] = zi + (bz - zi) * f;
        if (this.hazards.some((h) => touches(h.touch, q))) return false;
      }
      return true;
    };
    const consider = (j: number, kind: EdgeKind.Jump | EdgeKind.Drop, cost: number): boolean => {
      if (seen.has(j)) return false;
      seen.add(j);
      if (!clearLine(j) || !arcClear(j, kind)) return false;
      {
        out.push({ to: j, kind, cost, state: this.bad.has(i * this.count + j) ? 2 : 0 });
      }
      return true;
    };
    // Which of the 8 directions are ground-less (a ledge) and open (no wall at knee height)?
    const open: boolean[] = [];
    let anyOpen = false;
    for (let d = 0; d < 8; d++) {
      const hasWalk = this.walkTarget(i, d) >= 0 && this.walkOk(i, d, this.walkTarget(i, d));
      let isOpen = false;
      if (!hasWalk) {
        const dir = DIRS[d] as readonly [number, number];
        const l = Math.hypot(dir[0], dir[1]);
        const o: Vec3 = [xi, yi + p.stepHeight + 0.2, zi];
        isOpen = !this.pw.raycast(o, [dir[0] / l, 0, dir[1] / l], Math.max(this.cell * 1.2, p.radius + 0.25));
      }
      open.push(isOpen);
      if (isOpen) anyOpen = true;
    }
    // Short hops up onto a ledge or box within about half a metre.
    const near = Math.max(2, Math.ceil(0.55 / this.cell));
    for (let dz = -near; dz <= near; dz++) {
      for (let dx = -near; dx <= near; dx++) {
        if (dx === 0 && dz === 0) continue;
        const cx = cx0 + dx, cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
        const c = cz * this.nx + cx;
        for (let j = this.cellFirst[c] as number; j < (this.cellFirst[c + 1] as number); j++) {
          const dy = (this.py[j] as number) - yi;
          if (dy <= p.stepHeight + 0.05 || dy > maxUp) continue;
          const h = Math.hypot((this.px[j] as number) - xi, (this.pz[j] as number) - zi);
          if (h <= jumpReach(p, dy) * 0.8) consider(j, EdgeKind.Jump, h + 1.5 + dy);
        }
      }
    }
    if (anyOpen) {
      const table = this.farTable();
      const { rc, stride, span } = table;
      let openBits = 0;
      for (let d = 0; d < 8; d++) if (open[d]) openBits |= 1 << d;
      type Cand = { j: number; kind: EdgeKind.Jump | EdgeKind.Drop; cost: number; ang: number };
      const bins: Cand[][] = Array.from({ length: 16 }, () => []);
      // Blocks whose every node is out of reach (too high, or too far for the deepest drop into them) are skipped
      // whole: the candidates are exactly those of a cell-by-cell scan, in the same order.
      const skip = new Map<number, boolean>();
      const blockOut = (cx: number, cz: number): boolean => {
        const bx = Math.floor(cx / BLOCK);
        const bz = Math.floor(cz / BLOCK);
        const b = bz * this.nbx + bx;
        const known = skip.get(b);
        if (known !== undefined) return known;
        const low = (this.blockMinY[b] as number) - yi;
        let out = !Number.isFinite(low) || low > maxUp;
        if (!out) {
          const x0 = this.x0 + bx * BLOCK * this.cell;
          const z0 = this.z0 + bz * BLOCK * this.cell;
          const hx = Math.max(0, x0 - xi, xi - (x0 + BLOCK * this.cell));
          const hz = Math.max(0, z0 - zi, zi - (z0 + BLOCK * this.cell));
          const hMin = Math.hypot(hx, hz);
          const reach = Math.max(jumpReach(p, low) * 0.9 - 0.25, low < 0 ? dropReach(p, low) * 0.9 - 0.25 : 0);
          out = hMin > reach + 1e-6;
        }
        skip.set(b, out);
        return out;
      };
      for (let dz = -rc; dz <= rc; dz += stride) {
        for (let dx = -rc; dx <= rc; dx += stride) {
          const bcx = cx0 + dx, bcz = cz0 + dz;
          if (bcx >= 0 && bcz >= 0 && bcx < this.nx && bcz < this.nz && blockOut(bcx, bcz)) {
            // On to the first column of the next block on this row (keeping the stride's alignment).
            const next = (Math.floor(bcx / BLOCK) + 1) * BLOCK - cx0;
            dx = -rc + Math.ceil((next + rc) / stride) * stride - stride;
            continue;
          }
          const k = (dz + rc) * span + (dx + rc);
          // Inside the ring, in an open direction (or next to one).
          if (((table.accept[k] as number) & openBits) === 0) continue;
          const ang = table.ang[k] as number;
          const cx = cx0 + dx, cz = cz0 + dz;
          if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
          const c = cz * this.nx + cx;
          for (let j = this.cellFirst[c] as number; j < (this.cellFirst[c + 1] as number); j++) {
            const dy = (this.py[j] as number) - yi;
            if (dy > maxUp) continue;
            const h = Math.hypot((this.px[j] as number) - xi, (this.pz[j] as number) - zi);
            if (h < Math.max(this.cell * 1.4, 0.45)) continue;
            const reachJ = jumpReach(p, dy) * 0.9 - 0.25;
            const reachD = dy < 0 ? dropReach(p, dy) * 0.9 - 0.25 : 0;
            if (h > Math.max(reachJ, reachD)) continue;
            const kind = h <= reachD ? EdgeKind.Drop : EdgeKind.Jump;
            const cost = h + (kind === EdgeKind.Jump ? 1.5 : 0.3) + (dy < 0 ? -dy * 0.35 : dy * 1.0);
            (bins[table.bin[k] as number] as Cand[]).push({ j, kind, cost, ang });
          }
        }
      }
      for (const b of bins) {
        b.sort((a, c) => a.cost - c.cost);
        // Nearest few per direction; a farther landing on a different level is also kept.
        let kept = 0;
        const levels: number[] = [];
        for (const cand of b) {
          const lvl = Math.round((this.py[cand.j] as number) / 0.5);
          if (levels.includes(lvl) && kept >= 2) continue;
          levels.push(lvl);
          if (consider(cand.j, cand.kind, cand.cost) && ++kept >= 5) break;
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------

  private push(key: number, node: number): void {
    if (this.heapSize === this.heapKey.length) {
      const nk = new Float64Array(this.heapKey.length * 2);
      nk.set(this.heapKey);
      this.heapKey = nk;
      const nn = new Int32Array(this.heapNode.length * 2);
      nn.set(this.heapNode);
      this.heapNode = nn;
    }
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.heapKey[p] as number) <= key) break;
      this.heapKey[i] = this.heapKey[p] as number;
      this.heapNode[i] = this.heapNode[p] as number;
      i = p;
    }
    this.heapKey[i] = key;
    this.heapNode[i] = node;
  }

  private pop(): number {
    const top = this.heapNode[0] as number;
    const key = this.heapKey[--this.heapSize] as number;
    const node = this.heapNode[this.heapSize] as number;
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.heapSize) break;
      if (c + 1 < this.heapSize && (this.heapKey[c + 1] as number) < (this.heapKey[c] as number)) c++;
      if ((this.heapKey[c] as number) >= key) break;
      this.heapKey[i] = this.heapKey[c] as number;
      this.heapNode[i] = this.heapNode[c] as number;
      i = c;
    }
    this.heapKey[i] = key;
    this.heapNode[i] = node;
    return top;
  }

  /**
   * Dijkstra from `from`. Stops at the first popped node for which
   * `isTarget` is true (or runs to exhaustion when it is omitted). The
   * returned arrays are reused by the next call.
   *
   * With `toward` (the discs round the targets, see {@link TargetDiscs}) it is A*: the
   * frontier grows towards the targets instead of evenly in every direction, and the
   * first target popped is still the cheapest one (the estimate never exceeds the
   * true cost). `dist` is then exact only for the nodes on the way.
   */
  search(from: number, isTarget?: (node: number) => boolean, maxCost = Infinity, toward?: TargetDiscs): SearchResult {
    const dist = this.distBuf;
    const parent = this.parentBuf;
    dist.fill(Infinity);
    parent.fill(-1);
    this.heapSize = 0;
    this.searches++;
    dist[from] = 0;
    const est = toward && toward.count > 0 && maxCost === Infinity ? toward : null;
    this.estimate = est;
    if (est) this.estBuf.fill(-1);
    this.push(est ? this.estimateOf(from, est) : 0, from);
    let expanded = 0;
    while (this.heapSize > 0) {
      const key = this.heapKey[0] as number;
      const u = this.pop();
      if (key > (dist[u] as number) + (est ? (this.estBuf[u] as number) : 0)) continue;
      if (key > maxCost) break;
      expanded++;
      this.expandedTotal++;
      if (isTarget && isTarget(u)) {
        this.estimate = null;
        return { hit: u, dist, parent, expanded };
      }
      this.expand(u, dist, parent);
    }
    this.estimate = null;
    return { hit: -1, dist, parent, expanded };
  }

  /** The A* estimate of node `u` (cached for the search): a lower bound of the cost from it to the nearest target. */
  private estimateOf(u: number, t: TargetDiscs): number {
    const cached = this.estBuf[u] as number;
    if (cached >= 0) return cached;
    const x = this.px[u] as number;
    const z = this.pz[u] as number;
    let best = Infinity;
    for (let k = 0; k < t.count; k++) {
      const d = Math.hypot(x - (t.x[k] as number), z - (t.z[k] as number)) - (t.r[k] as number);
      if (d < best) best = d;
    }
    const h = Math.max(0, best) * ESTIMATE_SCALE;
    this.estBuf[u] = h;
    return h;
  }

  /**
   * Walk neighbours of `u`. An edge exists when either end picks the other
   * as its neighbour in that direction, so edges are always two-way.
   */
  private forEachWalk(u: number, cb: (v: number, cost: number) => void): void {
    const c = this.cellOf(u);
    const ccx = c % this.nx;
    const ccz = Math.floor(c / this.nx);
    for (let d = 0; d < 8; d++) {
      const dir = DIRS[d] as readonly [number, number];
      const step = this.cell * (dir[0] !== 0 && dir[1] !== 0 ? Math.SQRT2 : 1);
      const v = this.walkTarget(u, d);
      if (v >= 0 && this.blocked[v] === 0 && (this.bad.size === 0 || !this.bad.has(u * this.count + v)) && this.walkOk(u, d, v)) {
        cb(v, (step + Math.abs((this.py[v] as number) - (this.py[u] as number)) * 0.3) * (1 + (this.danger[v] as number)));
      }
      const cx = ccx + dir[0];
      const cz = ccz + dir[1];
      if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
      const nc = cz * this.nx + cx;
      const back = OPPOSITE[d] as number;
      for (let w = this.cellFirst[nc] as number; w < (this.cellFirst[nc + 1] as number); w++) {
        if (w === v || this.blocked[w] === 1 || this.walkTarget(w, back) !== u) continue;
        if (this.bad.size > 0 && this.bad.has(u * this.count + w)) continue;
        if (this.walkOk(w, back, u)) cb(w, (step + Math.abs((this.py[w] as number) - (this.py[u] as number)) * 0.3) * (1 + (this.danger[w] as number)));
      }
    }
  }

  private expand(u: number, dist: Float64Array, parent: Int32Array): void {
    const du = dist[u] as number;
    this.forEachWalk(u, (v, cost) => {
      const nd = du + cost;
      if (nd < (dist[v] as number)) {
        dist[v] = nd;
        parent[v] = u;
        this.kindBuf[v] = EdgeKind.Walk;
        this.push(this.estimate ? nd + this.estimateOf(v, this.estimate) : nd, v);
      }
    });
    for (const l of this.linksOf(u)) {
      if (l.state === 2 || this.blocked[l.to] === 1) continue;
      // A jump or a drop crosses the ground between its ends: it pays the dearer end, so it is no shortcut through an enemy's reach.
      const nd = du + l.cost * this.linkScale * (1 + Math.max(this.danger[u] as number, this.danger[l.to] as number));
      if (nd < (dist[l.to] as number)) {
        dist[l.to] = nd;
        parent[l.to] = u;
        this.kindBuf[l.to] = l.kind;
        this.push(this.estimate ? nd + this.estimateOf(l.to, this.estimate) : nd, l.to);
      }
    }
  }

  /** Kind of the edge that last improved `node` in the previous search. */
  kindTo(node: number): EdgeKind {
    return this.kindBuf[node] as EdgeKind;
  }

  /** Node path from the search source to `node` (inclusive), following `parent`. */
  pathTo(parent: Int32Array, node: number): number[] {
    const out: number[] = [];
    for (let n = node; n >= 0 && out.length < 100_000; n = parent[n] as number) out.push(n);
    return out.reverse();
  }

  /** Kind of the edge between two path-adjacent nodes. */
  edgeKind(a: number, b: number): EdgeKind {
    const l = this.links.get(a)?.find((e) => e.to === b);
    return l ? l.kind : EdgeKind.Walk;
  }

  /** Validation state of the jump edge a→b (0 for walk edges). */
  linkOf(a: number, b: number): LinkEdge | undefined {
    return this.links.get(a)?.find((e) => e.to === b);
  }

  /** Neighbours of a node as plain indices (walk + usable links) — for analysis. */
  forEachEdge(u: number, cb: (v: number) => void): void {
    this.forEachWalk(u, (v) => cb(v));
    for (const l of this.linksOf(u)) if (l.state !== 2 && this.blocked[l.to] !== 1) cb(l.to);
  }

  // ---------------------------------------------------------------------
  // Jump validation by simulation
  // ---------------------------------------------------------------------

  private walkerFor(): CharacterController {
    if (!this.walker) {
      this.walker = new CharacterController(this.pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: PARK, id: 'nav-probe' });
    }
    return this.walker;
  }

  /**
   * Simulate the jump or drop a→b with the real character controller and
   * report whether it lands on b. Sets the link's state.
   */
  validateLink(a: number, b: number, speed: number, jumpSpeed: number): boolean {
    const link = this.linkOf(a, b);
    if (!link) return true;
    if (link.state === 1) return true;
    if (link.state === 2) return false;
    const ch = this.walkerFor();
    const ax = this.px[a] as number, ay = this.py[a] as number, az = this.pz[a] as number;
    const bx = this.px[b] as number, by = this.py[b] as number, bz = this.pz[b] as number;
    ch.teleport([ax, ay + 0.02, az]);
    const dt = 1 / 60;
    // Two idle ticks so the controller knows it stands on the ground (a jump needs that).
    for (let k = 0; k < 2; k++) ch.move({ forward: 0, right: 0, jump: false, yawDeg: 0 }, dt, speed, jumpSpeed);
    let ok = false;
    let airborne = false;
    for (let t = 0; t < (this.params.gravity < 6 ? 600 : 240); t++) {
      const p = ch.position;
      const dx = bx - p[0], dz = bz - p[2];
      const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      const near = Math.hypot(dx, dz);
      ch.move({ forward: near < 0.1 ? 0 : airThrust(near, speed, this.params.gravity, !ch.grounded), right: 0, jump: link.kind === EdgeKind.Jump && t === 0, yawDeg: yaw }, dt, speed, jumpSpeed);
      const q = ch.position;
      // Through a hazard on the way (the water of the river it leaps): the game would stop it there.
      if (this.hazards.some((h) => touches(h.touch, q))) {
        ok = false;
        break;
      }
      if (!ch.grounded) airborne = true;
      const landed = ch.grounded && ch.verticalSpeed <= 0.01 && (airborne || t > 12);
      if (landed) {
        ok = Math.hypot(bx - q[0], bz - q[2]) <= Math.max(this.cell * 1.7, 0.4) && Math.abs(by - q[1]) <= 0.5;
        if (ok || airborne || t > 30) break;
      }
      if (q[1] < Math.min(ay, by) - 40) break;
    }
    ch.teleport(PARK);
    link.state = ok ? 1 : 2;
    if (!ok) this.bad.add(a * this.count + b);
    return ok;
  }

  /**
   * Add a one-way edge `from → to` that rides a lift: `from` is a node beside
   * the platform at its lowest stop, `to` a node level with it at its highest.
   * The ride is performed by playing it (the bot waits for the lift by its
   * clock), so it is never validated by the probe character. `cost` is the
   * span plus the expected wait.
   */
  addRide(from: number, to: number, info: RideInfo, cost: number): void {
    const list = this.linksOf(from);
    if (list.some((l) => l.to === to)) return;
    list.push({ to, kind: EdgeKind.Ride, cost, state: 1, ride: info });
  }

  /** Release the probe character. */
  dispose(): void {
    this.walker?.dispose();
    this.walker = null;
  }

  /** Highest ray start the graph was built with. */
  get topY(): number {
    return this.spawnY;
  }
}

/**
 * Forward input while crossing a jump. In low gravity a jump hangs for seconds
 * and full speed overshoots the landing, so the thrust eases off over the last
 * stretch; at normal gravity it is full speed all the way (unchanged).
 */
export function airThrust(near: number, speed: number, gravity: number, airborne: boolean): number {
  if (!airborne || gravity >= 6) return 1;
  return Math.max(0.12, Math.min(1, near / (speed * 0.9)));
}

function sectorToDir(sector: number): number {
  // sector 0 = +x, 1 = +x+z, 2 = +z, 3 = -x+z, 4 = -x, 5 = -x-z, 6 = -z, 7 = +x-z
  switch (sector) {
    case 0: return 0;
    case 1: return 4;
    case 2: return 2;
    case 3: return 7;
    case 4: return 1;
    case 5: return 5;
    case 6: return 3;
    default: return 6;
  }
}

function neighbourDir(dirIdx: number, delta: 1 | -1): number {
  // Angular neighbours in the circular order of the 8 directions.
  const order = [0, 4, 2, 7, 1, 5, 3, 6];
  const k = order.indexOf(dirIdx);
  return order[(k + delta + 8) % 8] as number;
}

/**
 * Nodes along the axis of a doorway, laterally shifted to wherever the player's
 * capsule fits through the whole opening (a few centimetres of choice).
 */
function portalNodes(pw: PhysicsWorld, portal: NavPortal, p: NavParams): Array<{ x: number; y: number; z: number; n: number }> {
  return portalScan(pw, portal, p, p.radius + 0.025);
}

/**
 * The widest capsule radius (to 1 cm) that gets through a doorway, or 0 when
 * not even a thin one does. The player needs `params.radius` plus the
 * controller's skin; anything less is a doorway the player cannot use.
 */
export function doorFitRadius(pw: PhysicsWorld, portal: NavPortal, p: NavParams): number {
  const need = p.radius + 0.025;
  if (portalScan(pw, portal, p, need).length > 0) return need;
  return fitSearch(pw, portal, p, need);
}

/**
 * Room to spare (m per side) a doorway leaves around the player's body:
 * 0 or less when the body just fits or does not, up to 0.25 for a wide door.
 */
export function doorSlack(pw: PhysicsWorld, portal: NavPortal, p: NavParams): number {
  const need = p.radius + 0.025;
  if (portalScan(pw, portal, p, need).length === 0) return fitSearch(pw, portal, p, need) - need;
  let lo = need;
  let hi = need + 0.25;
  if (portalScan(pw, portal, p, hi).length > 0) return 0.25;
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    if (portalScan(pw, portal, p, mid).length > 0) lo = mid;
    else hi = mid;
  }
  return lo - need;
}

function fitSearch(pw: PhysicsWorld, portal: NavPortal, p: NavParams, need: number): number {
  let lo = 0.05;
  let hi = need;
  if (portalScan(pw, portal, p, lo).length === 0) return 0;
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    if (portalScan(pw, portal, p, mid).length > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

function portalScan(pw: PhysicsWorld, portal: NavPortal, p: NavParams, radius: number): Array<{ x: number; y: number; z: number; n: number }> {
  const step = 0.08;
  const reach = 0.9;
  const K = Math.ceil(reach / step);
  const tx = -portal.normal[1];
  const tz = portal.normal[0];
  const span = portal.halfThickness + 0.3;
  const slopeMin = Math.cos((p.maxSlopeDeg * Math.PI) / 180);
  const down: Vec3 = [0, -1, 0];
  const lateral: number[] = [0];
  for (let i = 1; i <= 16; i++) lateral.push(i * 0.01, -i * 0.01);
  for (const l of lateral) {
    const pts: Array<{ x: number; y: number; z: number; n: number; ok: boolean; a: number }> = [];
    for (let k = -K; k <= K; k++) {
      const a = k * step;
      const x = portal.center[0] + portal.normal[0] * a + tx * l;
      const z = portal.center[2] + portal.normal[1] * a + tz * l;
      const hit = pw.raycast([x, portal.center[1] + 1.0, z], down, 1.7);
      const ok = hit !== null && hit.normal[1] >= slopeMin && pw.capsuleFree([x, hit.point[1], z], radius, p.height - 0.04, p.stepHeight + 0.01);
      pts.push({ x, y: hit ? hit.point[1] : portal.center[1], z, n: hit ? hit.normal[1] : 1, ok, a });
    }
    if (pts.some((q) => Math.abs(q.a) <= span && !q.ok)) continue;
    // Keep the run of valid points around the centre.
    const mid = K;
    let lo = mid;
    let hi = mid;
    while (lo - 1 >= 0 && (pts[lo - 1] as { ok: boolean }).ok) lo--;
    while (hi + 1 < pts.length && (pts[hi + 1] as { ok: boolean }).ok) hi++;
    return pts.slice(lo, hi + 1).map((q) => ({ x: q.x, y: q.y, z: q.z, n: q.n }));
  }
  return [];
}

function standable(pw: PhysicsWorld, x: number, sy: number, z: number, p: NavParams, r: number, hazards: readonly HazardZone[]): boolean {
  const feet: Vec3 = [x, sy, z];
  for (const h of hazards) {
    // Keep a body width away from the hurting volume.
    if (touches({ ...h.touch, margin: h.touch.margin + r + 0.1 }, feet)) return false;
  }
  // The capsule itself must fit: head room, bed edges, shelves and walls beside it.
  if (!pw.capsuleFree(feet, r, p.height - 0.04, p.stepHeight + 0.01)) return false;
  return true;
}

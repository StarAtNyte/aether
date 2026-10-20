/**
 * Hostile characters as the bot sees them: where each one is now, how far
 * its bite reaches and which way it patrols. A person playing a game with a
 * wolf pack keeps out of their reach, routes round their beat and waits for
 * a gap before grabbing something they are guarding; the bot does the same
 * through three measures kept here:
 *
 * - `paint` writes a cost field onto the walking map (dear inside an
 *   attack reach, cheaper further out, a little extra along patrol routes),
 *   so routes bend round the pack instead of through it;
 * - `clearance` is how far a point is from the nearest reach (negative:
 *   inside it), used to decide when to step away;
 * - `escape` picks the heading, among sixteen, that keeps most clearance
 *   while still making some progress towards where the bot wants to go.
 *
 * Everything is read from the running simulation at fixed steps, so the
 * same world always plays the same way.
 */
import type { Entity, EntityId, Vec3, WorldDoc } from '@aether/core';
import { resolveNpc, type NpcInfo } from '@aether/logic';
import type { NavGraph } from './nav';

/** One hostile character. */
export interface Threat {
  readonly id: EntityId;
  /** Centre-to-centre distance at which its attack lands on the player (m). */
  readonly reach: number;
  /** Its running speed (m/s). */
  readonly runSpeed: number;
  /** How far it sees (m). */
  readonly sight: number;
  /** Patrol route on the ground (x, z pairs), empty when it has none. */
  readonly route: Float32Array;
  x: number;
  y: number;
  z: number;
  live: boolean;
  /** It is after the player right now (chasing or attacking). */
  hunting: boolean;
}

/** Where the simulation keeps the characters (the session's NPC system and host). */
export interface ThreatSource {
  info(id: EntityId): NpcInfo | undefined;
  y(id: EntityId): number | undefined;
}

/** Ground cost inside an attack reach, as a multiple of a normal step. */
const CORE_COST = 40;
/** Peak cost of the ring around a reach. */
const RING_COST = 10;
/** Cost added along a patrol route. */
const ROUTE_COST = 3;
/** Width of the ring round a reach (m); wider while the character hunts the player. */
const RING = 3.5;
const RING_HUNTING = 5;
/** Margin added to the reach before the ground counts as inside it (m). */
export const CORE_MARGIN = 0.6;

const DIRS = 16;
const DIR_X = new Float32Array(DIRS);
const DIR_Z = new Float32Array(DIRS);
for (let i = 0; i < DIRS; i++) {
  DIR_X[i] = Math.sin((i / DIRS) * Math.PI * 2);
  DIR_Z[i] = Math.cos((i / DIRS) * Math.PI * 2);
}

/** The hostile characters of a world and their live positions. */
export class ThreatWatch {
  readonly list: Threat[];
  private readonly probe: Vec3 = [0, 0, 0];

  private constructor(list: Threat[]) {
    this.list = list;
  }

  /** Characters that attack the player (named enemies, or guard / predator / sentinel archetypes); null when there are none. */
  static of(world: WorldDoc, playerRadius: number): ThreatWatch | null {
    const list: Threat[] = [];
    for (const id in world.entities) {
      const e = world.entities[id] as Entity;
      const spec = e.npc;
      if (e.template || !spec) continue;
      const eff = resolveNpc(spec);
      if (!eff.enemies.has('player') || eff.allies.has('player')) continue;
      // Only characters that can hurt: an attack, or a body that can stand in the way while it chases.
      const route = new Float32Array(spec.waypoints.length * 2);
      spec.waypoints.forEach((w, i) => {
        route[i * 2] = w[0];
        route[i * 2 + 1] = w[2];
      });
      const p = e.transform.position;
      list.push({
        id,
        reach: eff.attackRange + spec.radius + playerRadius,
        runSpeed: eff.stationary ? 0 : spec.runSpeed,
        sight: spec.perception.sight,
        route,
        x: p[0],
        y: p[1],
        z: p[2],
        live: true,
        hunting: false,
      });
    }
    return list.length > 0 ? new ThreatWatch(list) : null;
  }

  /** Read every character's position and mode from the running simulation. */
  update(src: ThreatSource): void {
    for (const t of this.list) {
      const info = src.info(t.id);
      if (!info || info.dead) {
        t.live = false;
        t.hunting = false;
        continue;
      }
      t.live = true;
      t.x = info.x;
      t.z = info.z;
      const y = src.y(t.id);
      if (y !== undefined) t.y = y;
      t.hunting = info.mode === 'chase' || info.mode === 'attack' || info.target === 'player';
    }
  }

  /** Distance from (x, z) to the nearest live reach, minus the reach (negative: inside). Infinity when none is live. */
  clearance(x: number, y: number, z: number): number {
    let best = Infinity;
    for (const t of this.list) {
      if (!t.live || Math.abs(t.y - y) > 3) continue;
      const d = Math.hypot(t.x - x, t.z - z) - t.reach;
      if (d < best) best = d;
    }
    return best;
  }

  /** The nearest live threat to (x, z) on the same level, or null. */
  nearest(x: number, y: number, z: number): Threat | null {
    let best: Threat | null = null;
    let bd = Infinity;
    for (const t of this.list) {
      if (!t.live || Math.abs(t.y - y) > 3) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** Whether some live character hunts the player within `range` of (x, z). */
  huntedWithin(x: number, y: number, z: number, range: number): boolean {
    for (const t of this.list) if (t.live && t.hunting && Math.abs(t.y - y) <= 3 && Math.hypot(t.x - x, t.z - z) <= range) return true;
    return false;
  }

  /** Whether a calm (not hunting) character's reach, grown by `margin`, covers (x, z). */
  guarded(x: number, y: number, z: number, margin: number): Threat | null {
    for (const t of this.list) {
      if (!t.live || t.hunting || Math.abs(t.y - y) > 3) continue;
      if (Math.hypot(t.x - x, t.z - z) < t.reach + margin) return t;
    }
    return null;
  }

  /** Write the cost field onto the walking map (the previous field is cleared). */
  paint(g: NavGraph): void {
    const danger = g.danger;
    danger.fill(0);
    for (const t of this.list) {
      if (!t.live) continue;
      const core = t.reach + CORE_MARGIN;
      const outer = core + (t.hunting ? RING_HUNTING : RING);
      this.forNodes(g, t.x, t.z, outer, t.y, (n, d) => {
        const add = d < core ? CORE_COST : RING_COST * ((outer - d) / (outer - core));
        danger[n] = (danger[n] as number) + add;
      });
      // A calm character walks its beat: the route itself is dearer (it will be back).
      if (!t.hunting && t.route.length >= 4) {
        const n = t.route.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          if (n === 2 && i === 1) break;
          this.forSegment(g, t.route[i * 2] as number, t.route[i * 2 + 1] as number, t.route[j * 2] as number, t.route[j * 2 + 1] as number, t.y, 1.4, (node) => {
            danger[node] = (danger[node] as number) + ROUTE_COST;
          });
        }
      }
    }
  }

  /**
   * The heading (degrees, 0 faces −Z, as the bot steers) that keeps the most clearance one stride ahead
   * while staying on the walking map, leaning towards (gx, gz) when that costs little. Null when no
   * direction is open.
   */
  escape(g: NavGraph, pos: Readonly<Vec3>, gx: number, gz: number, stride: number, open?: (dx: number, dz: number, dist: number) => boolean): number | null {
    const p = this.probe;
    let gdx = gx - pos[0];
    let gdz = gz - pos[2];
    const gl = Math.hypot(gdx, gdz);
    if (gl > 1e-6) {
      gdx /= gl;
      gdz /= gl;
    } else {
      gdx = 0;
      gdz = 0;
    }
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < DIRS; i++) {
      const dx = DIR_X[i] as number;
      const dz = DIR_Z[i] as number;
      p[0] = pos[0] + dx * stride;
      p[1] = pos[1];
      p[2] = pos[2] + dz * stride;
      const n = g.nearest(p, Math.max(0.6, g.cell * 1.5), 0.6);
      if (n < 0 || g.blocked[n] === 1) continue;
      // Half a stride further too: a ledge or a wall right behind the first step is no escape.
      p[0] = pos[0] + dx * stride * 1.6;
      p[2] = pos[2] + dz * stride * 1.6;
      if (g.nearest(p, Math.max(0.6, g.cell * 1.5), 0.8) < 0) continue;
      // Nothing solid in the way (a post or a rock the walking map squeezes past is no escape at a run).
      if (open && !open(dx, dz, stride)) continue;
      const clear = Math.min(this.clearance(pos[0] + dx * stride, pos[1], pos[2] + dz * stride), 6);
      const score = clear + 0.6 * (dx * gdx + dz * gdz);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    return (Math.atan2(-(DIR_X[best] as number), -(DIR_Z[best] as number)) * 180) / Math.PI;
  }

  private forNodes(g: NavGraph, x: number, z: number, r: number, y: number, cb: (node: number, d: number) => void): void {
    const cx0 = Math.max(0, Math.floor((x - r - g.x0) / g.cell));
    const cx1 = Math.min(g.nx - 1, Math.floor((x + r - g.x0) / g.cell));
    const cz0 = Math.max(0, Math.floor((z - r - g.z0) / g.cell));
    const cz1 = Math.min(g.nz - 1, Math.floor((z + r - g.z0) / g.cell));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * g.nx + cx;
        for (let n = g.cellFirst[c] as number; n < (g.cellFirst[c + 1] as number); n++) {
          if (Math.abs((g.py[n] as number) - y) > 3) continue;
          const d = Math.hypot((g.px[n] as number) - x, (g.pz[n] as number) - z);
          if (d < r) cb(n, d);
        }
      }
    }
  }

  private forSegment(g: NavGraph, ax: number, az: number, bx: number, bz: number, y: number, w: number, cb: (node: number) => void): void {
    const cx0 = Math.max(0, Math.floor((Math.min(ax, bx) - w - g.x0) / g.cell));
    const cx1 = Math.min(g.nx - 1, Math.floor((Math.max(ax, bx) + w - g.x0) / g.cell));
    const cz0 = Math.max(0, Math.floor((Math.min(az, bz) - w - g.z0) / g.cell));
    const cz1 = Math.min(g.nz - 1, Math.floor((Math.max(az, bz) + w - g.z0) / g.cell));
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * g.nx + cx;
        for (let n = g.cellFirst[c] as number; n < (g.cellFirst[c + 1] as number); n++) {
          if (Math.abs((g.py[n] as number) - y) > 3) continue;
          const px = (g.px[n] as number) - ax;
          const pz = (g.pz[n] as number) - az;
          const t = len2 > 1e-9 ? Math.max(0, Math.min(1, (px * vx + pz * vz) / len2)) : 0;
          if (Math.hypot(px - vx * t, pz - vz * t) < w) cb(n);
        }
      }
    }
  }
}

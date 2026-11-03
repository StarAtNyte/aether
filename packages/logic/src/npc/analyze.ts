/**
 * Static checks of the NPCs in a world document: do they stand on walkable
 * floor, are all patrol points reachable, are the dialogue trees and the
 * items they trade consistent. Used by the `npcs` verification test and by
 * the agent's self-checks. Deterministic and bounded (one grid per level and
 * body size, one path search per waypoint).
 */
import { resolveSelector, worldTransform, type Dialogue, type DialogueEffect, type Entity, type NpcSpec, type Vec3, type WorldDoc } from '@aether/core';
import { zoneShapeOf } from '../bounds';
import { DialogueSession } from './dialogue';
import { NavGrid, NAV_MAX_PATH } from './nav';
import { groupLayerPoints, hasBuildings, NavLayers, NavRoute, type LayerPoint } from './layers';
import { buildNavFor, type BoundsProvider } from './obstacles';

/** Result of {@link analyzeNpcs}. */
export interface NpcAnalysis {
  /** Problems that make an NPC unable to do its job. */
  errors: string[];
  /** Suspicious but playable. */
  warnings: string[];
  /** NPCs examined. */
  npcs: number;
}

/** Larger than the runtime budget: the check should be exact. */
const ANALYSIS_EXPANSIONS = 60_000;
const MAX_LISTED = 4;

function feetOf(e: Entity, y: number): number {
  return e.shape.kind === 'primitive' ? y - zoneShapeOf(e).half[1] : y;
}

/** Keys a world can ever hold: initial state plus everything rules and dialogues write. */
function writableKeys(world: WorldDoc): Set<string> {
  const keys = new Set<string>(Object.keys(world.state));
  for (const r of world.rules) {
    for (const a of r.then) if ((a.do === 'set' || a.do === 'add') && typeof a.key === 'string') keys.add(a.key);
  }
  const fx = (list: readonly DialogueEffect[]): void => {
    for (const f of list) {
      if (f.do === 'set' || f.do === 'add') keys.add(f.key);
      else if (f.do === 'give' || f.do === 'take') keys.add(f.item);
      else if (f.do === 'openDoor') keys.add(`${f.target}-unlocked`);
    }
  };
  for (const id of Object.keys(world.entities)) {
    const tree = (world.entities[id] as Entity).npc?.dialogue;
    if (!tree) continue;
    for (const n of Object.values(tree.nodes)) {
      fx(n.effects);
      for (const c of n.choices) fx(c.effects);
    }
  }
  return keys;
}

function checkDialogue(id: string, tree: Dialogue, keys: ReadonlySet<string>, out: NpcAnalysis): void {
  const reach = DialogueSession.reachable(tree);
  const lost = Object.keys(tree.nodes).filter((n) => !reach.has(n));
  if (lost.length > 0) out.warnings.push(`${id}: dialogue node(s) ${lost.slice(0, MAX_LISTED).join(', ')} can never be reached`);
  const missing = new Set<string>();
  for (const [nid, n] of Object.entries(tree.nodes)) {
    for (const c of n.choices) {
      for (const cond of c.if) {
        const base = cond.key;
        if (!keys.has(base) && !base.includes('.')) missing.add(`'${base}' (needed by '${c.text.slice(0, 30)}' in ${nid})`);
      }
    }
    for (const v of n.variants) for (const cond of v.if) if (!keys.has(cond.key) && !cond.key.includes('.')) missing.add(`'${cond.key}'`);
  }
  if (missing.size > 0) out.warnings.push(`${id}: dialogue reads state the world never sets: ${[...missing].slice(0, MAX_LISTED).join(', ')}`);
}

/** Where an NPC stands and where it walks (waypoints, routine stops), on the floors and stairs of a building. */
function checkLayered(id: string, spec: NpcSpec, pos: Readonly<Vec3>, feet: number, layers: NavLayers, route: NavRoute, out: NpcAnalysis): void {
  const level = layers.levelAt(pos[0], feet, pos[2]);
  const grid = layers.grids[level] as NavGrid;
  const rings = Math.max(3, Math.ceil(1.5 / grid.cell));
  if (grid.nearest(pos[0], pos[2], rings) < 0) {
    out.errors.push(`${id}: stands on ground it cannot walk on (no clear floor within 1.5 m of [${pos[0].toFixed(1)}, ${pos[2].toFixed(1)}]); move it onto open floor`);
    return;
  }
  if (!grid.walkable(pos[0], pos[2])) out.warnings.push(`${id}: starts inside a solid or too close to a wall; it will be nudged out`);
  const bad: string[] = [];
  const cut: string[] = [];
  const places: Array<[string, Readonly<Vec3>]> = [...spec.waypoints.map((w, i) => [`waypoint #${i}`, w] as [string, Readonly<Vec3>]), ...(spec.routine ?? []).map((r, i) => [`routine stop #${i}${r.name ? ` (${r.name})` : ''}`, r.at] as [string, Readonly<Vec3>])];
  for (const [label, w] of places) {
    const wl = layers.levelAt(w[0], w[1], w[2]);
    const g = layers.grids[wl] as NavGrid;
    if (g.nearest(w[0], w[2], Math.max(3, Math.ceil(1.5 / g.cell))) < 0) {
      bad.push(`${label} [${w[0].toFixed(1)}, ${w[1].toFixed(1)}, ${w[2].toFixed(1)}]`);
      continue;
    }
    if (!layers.route(level, pos[0], pos[2], wl, w[0], w[2], route)) cut.push(`${label} [${w[0].toFixed(1)}, ${w[1].toFixed(1)}, ${w[2].toFixed(1)}]`);
  }
  if (bad.length > 0) out.errors.push(`${id}: ${bad.slice(0, MAX_LISTED).join(', ')} is not on walkable floor`);
  if (cut.length > 0) out.errors.push(`${id}: ${cut.slice(0, MAX_LISTED).join(', ')} cannot be reached from where it stands (walled off, across a gap, or on a floor no stair reaches)`);
}

/**
 * Examine the NPCs matched by `target` ("*" = all). Entities without an `npc`
 * spec are ignored.
 */
export function analyzeNpcs(world: WorldDoc, opts: { target?: string; bounds?: BoundsProvider } = {}): NpcAnalysis {
  const out: NpcAnalysis = { errors: [], warnings: [], npcs: 0 };
  let ids: string[];
  try {
    ids = resolveSelector(world, opts.target ?? '*');
  } catch {
    ids = [];
  }
  const npcs = ids.filter((id) => {
    const e = world.entities[id];
    return e !== undefined && e.npc !== undefined && !e.template;
  });
  out.npcs = npcs.length;
  const grids = new Map<string, NavGrid>();
  const keys = writableKeys(world);
  const tags = new Set<string>();
  for (const e of Object.values(world.entities)) for (const t of e.tags) tags.add(t);
  const scratch = new Float32Array(NAV_MAX_PATH * 2);
  // In a world with buildings the floors and stairs are checked as the runtime walks them (layered grids).
  const buildings = hasBuildings(world);
  const layerSets = new Map<number, NavLayers | null>();
  const route = new NavRoute();
  // NPCs of one size share floor grids, grouped by where they walk in a place too large for one fine grid (as the runtime does).
  let grouping: ReturnType<typeof groupLayerPoints> | null = null;
  if (buildings) {
    const entries = npcs.map((other) => {
      const oe = world.entities[other] as Entity;
      const os = oe.npc as NpcSpec;
      const points: LayerPoint[] = [];
      try {
        const op = worldTransform(world, other).position;
        points.push({ x: op[0], y: feetOf(oe, op[1]), z: op[2] });
      } catch {
        // No transform: it is skipped below.
      }
      for (const w of os.waypoints) points.push({ x: w[0], y: w[1], z: w[2] });
      for (const r of os.routine ?? []) points.push({ x: r.at[0], y: r.at[1], z: r.at[2] });
      return { size: `${Math.round(os.radius * 4)}|${Math.round(os.height * 2)}`, points };
    });
    grouping = groupLayerPoints(world, entries);
  }
  for (const [n, id] of npcs.entries()) {
    const e = world.entities[id] as Entity;
    const spec = e.npc as NpcSpec;
    let pos: Vec3;
    try {
      pos = worldTransform(world, id).position;
    } catch {
      continue;
    }
    const feet = feetOf(e, pos[1]);
    if (buildings && grouping) {
      const gi = grouping.of[n] as number;
      let layers = layerSets.get(gi);
      if (layers === undefined) {
        const group = grouping.groups[gi];
        layers = group ? NavLayers.build(world, { radius: spec.radius, height: spec.height, points: group.points, local: group.local }, opts.bounds) : null;
        layerSets.set(gi, layers);
      }
      if (layers) {
        checkLayered(id, spec, pos, feet, layers, route, out);
        if (spec.archetype === 'guard' && spec.waypoints.length === 0 && spec.wander <= 0 && !spec.routine?.length) out.warnings.push(`${id}: a guard without waypoints stands at its post`);
        if (spec.waypoints.length === 1) out.warnings.push(`${id}: a single waypoint gives nothing to patrol between`);
        if ((spec.archetype === 'guard' || spec.archetype === 'predator' || spec.archetype === 'sentinel') && !spec.attack) out.warnings.push(`${id}: ${spec.archetype} has no attack, so catching the player does nothing`);
        for (const t of spec.fears) if (!tags.has(t)) out.warnings.push(`${id}: fears '${t}' but nothing in the world has that tag`);
        if (spec.dialogue) checkDialogue(id, spec.dialogue, keys, out);
        continue;
      }
    }
    const level = Math.round(feet / 1.5);
    const key = `${level}|${Math.round(spec.radius * 4)}|${Math.round(spec.height * 2)}`;
    let grid = grids.get(key);
    if (!grid) {
      const points: Vec3[] = [];
      for (const other of npcs) {
        const oe = world.entities[other] as Entity;
        const op = worldTransform(world, other).position;
        if (Math.round(feetOf(oe, op[1]) / 1.5) !== level) continue;
        points.push(op);
        for (const w of (oe.npc as NpcSpec).waypoints) points.push(w);
      }
      points.push(world.player.spawn);
      grid = buildNavFor(world, { refY: level * 1.5, radius: spec.radius, height: spec.height, points }, opts.bounds);
      grids.set(key, grid);
    }
    const start = grid.nearest(pos[0], pos[2], 3);
    if (start < 0) {
      out.errors.push(`${id}: stands on ground it cannot walk on (no clear floor within 1.5 m of [${pos[0].toFixed(1)}, ${pos[2].toFixed(1)}]); move it onto open floor`);
      continue;
    }
    if (!grid.walkable(pos[0], pos[2])) out.warnings.push(`${id}: starts inside a solid or too close to a wall; it will be nudged out`);
    const bad: string[] = [];
    const cut: string[] = [];
    spec.waypoints.forEach((w, i) => {
      const cell = (grid as NavGrid).nearest(w[0], w[2], 3);
      if (cell < 0) {
        bad.push(`#${i} [${w[0].toFixed(1)}, ${w[2].toFixed(1)}]`);
        return;
      }
      const n = (grid as NavGrid).findPath(pos[0], pos[2], w[0], w[2], scratch, ANALYSIS_EXPANSIONS);
      if (n === 0) cut.push(`#${i} [${w[0].toFixed(1)}, ${w[2].toFixed(1)}]`);
    });
    if (bad.length > 0) out.errors.push(`${id}: waypoint ${bad.slice(0, MAX_LISTED).join(', ')} is not on walkable floor`);
    if (cut.length > 0) out.errors.push(`${id}: waypoint ${cut.slice(0, MAX_LISTED).join(', ')} cannot be reached from where it stands (walled off or across a gap)`);
    if (spec.archetype === 'guard' && spec.waypoints.length === 0 && spec.wander <= 0) out.warnings.push(`${id}: a guard without waypoints stands at its post`);
    if (spec.waypoints.length === 1) out.warnings.push(`${id}: a single waypoint gives nothing to patrol between`);
    if ((spec.archetype === 'guard' || spec.archetype === 'predator' || spec.archetype === 'sentinel') && !spec.attack) {
      out.warnings.push(`${id}: ${spec.archetype} has no attack, so catching the player does nothing`);
    }
    for (const t of spec.fears) if (!tags.has(t)) out.warnings.push(`${id}: fears '${t}' but nothing in the world has that tag`);
    if (spec.dialogue) checkDialogue(id, spec.dialogue, keys, out);
  }
  return out;
}

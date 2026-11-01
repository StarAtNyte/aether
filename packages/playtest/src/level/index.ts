/**
 * Level tools: the assistant decides where things go in a game or an outdoor
 * world, the code measures. Same shape as the architecture design tools
 * (`(document, input) -> patches + facts | refusal`), for terrain and levels:
 *
 * - `query_level`: ground height and slope at points, clearance around a spot,
 *   sight lines, whether the player can reach a point (the verified-playable
 *   bot's own walking map, jumps and lifts included), every objective's reach,
 *   and a one-screen summary of the level.
 * - `place_level_items`: pickups, goals, checkpoints, hazards, enemies, props.
 *   Each item is snapped to the ground at its x,z, refused when it would be
 *   buried in something solid or has nothing under it, and (for what the player
 *   has to get to) refused with the distance and height gap when it cannot be
 *   reached. Accepted items commit as one undo step.
 *
 * Every input is validated with zod and bounded; nothing is evaluated.
 */
import { Entity, carryPatches, dependencyIndex, findWaterBodies, worldTransform, isLifeSpecies, LIFE_SPECIES_IDS, MAX_LIFE_COUNT, planLife, validateWorld, type Patch, type Vec3, type WorldDoc } from '@aether/core';
import { PhysicsWorld, entityBounds, initPhysics, type Aabb, type ColliderProvider } from '@aether/physics';
import { z } from 'zod';
import { deriveGoals } from '../goals';
import { unsupportedReason } from '../agent';
import { withProbe } from './probe-cache';
import { levelColliders, setLevelColliders, setLevelSurfaces, type LevelSurfaces } from './colliders';
import { reviewLevel, type LevelReview } from './review';
import { floatingText, measureGrounding, shouldRest, subtreeBounds, surfaceWorld } from './grounding';

export { clearProbeCache, probeCacheStats, PROBE_TTL_MS } from './probe-cache';
export { LIFE_SPECIES, LIFE_SPECIES_IDS, MAX_LIFE_COUNT, planLife, type LifePlan, type LifeProbe, type LifeRequest } from '@aether/core';
export { reviewLevel, scoreLevel, type LevelFinding, type LevelPose, type LevelReview } from './review';
export { measureGrounding, groundingOf, surfaceWorld, shouldRest, supportBelow, floatingText, FLOAT_TOLERANCE, type FloatingObject, type GroundingReport } from './grounding';

/** Names of the level tools. */
export const LEVEL_TOOL_NAMES = ['query_level', 'place_level_items'] as const;
export type LevelToolName = (typeof LEVEL_TOOL_NAMES)[number];

/** True when `name` is a level tool. */
export function isLevelTool(name: string): name is LevelToolName {
  return (LEVEL_TOOL_NAMES as readonly string[]).includes(name);
}

/** Limits of the level tools. */
export const LEVEL_LIMITS = Object.freeze({ MAX_POINTS: 24, MAX_ITEMS: 40, COORD: 5000, MAX_TEXT: 6000, SLOPE_LIMIT_DEG: 55, MAX_RAYS: 4000 });

const Coord = z.number().finite().min(-LEVEL_LIMITS.COORD).max(LEVEL_LIMITS.COORD);
const Point3 = z.tuple([Coord, Coord, Coord]);
const Slug = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);

const XZ = z.object({ x: Coord, z: Coord, below: Coord.optional() });

/** Inputs of `query_level`. */
export const QueryLevelInput = z.discriminatedUnion('op', [
  z.object({ op: z.literal('summary') }),
  z.object({ op: z.literal('ground'), points: z.array(XZ).min(1).max(LEVEL_LIMITS.MAX_POINTS) }),
  z.object({ op: z.literal('clearance'), x: Coord, z: Coord, radius: z.number().min(0.1).max(3).default(0.4), height: z.number().min(0.3).max(6).default(1.8), below: Coord.optional() }),
  z.object({ op: z.literal('sightline'), from: Point3, to: Point3 }),
  z.object({ op: z.literal('reach'), points: z.array(z.object({ x: Coord, y: Coord.optional(), z: Coord })).min(1).max(12) }),
  z.object({ op: z.literal('objectives') }),
  z.object({ op: z.literal('review') }),
  // Objects that should rest on something but hover above it (ids: only those).
  z.object({ op: z.literal('grounding'), ids: z.array(Slug).max(LEVEL_LIMITS.MAX_POINTS).optional() }),
]);
export type QueryLevelInput = z.infer<typeof QueryLevelInput>;

/** Roles an item can have; they set sensible defaults and decide whether reach is checked. */
export const ItemRole = z.enum(['pickup', 'goal', 'checkpoint', 'hazard', 'enemy', 'prop', 'decor', 'life']);
export type ItemRole = z.infer<typeof ItemRole>;

const LevelItem = z.object({
  id: Slug,
  role: ItemRole.default('prop'),
  x: Coord,
  z: Coord,
  /** Metres between the ground and the item's bottom (default 0.8 for pickups and goals, else 0). */
  above: z.number().min(-5).max(500).optional(),
  /** Measure the ground below this height (for a bridge, a roof, a second level). */
  below: Coord.optional(),
  /** Yaw in degrees. */
  yaw: z.number().finite().min(-3600).max(3600).default(0),
  /** The entity (shape, name, material, behaviors, physics, tags, npc …); position is set by the tool. Omit it to move an existing item. */
  entity: z.record(z.string(), z.unknown()).optional(),
  /** State key a pickup raises (default "score"). */
  key: z.string().min(1).max(40).optional(),
  /** Require the player to be able to reach it (default: pickup, goal, checkpoint and enemy). */
  reach: z.boolean().optional(),
  /** role "life": the species (deer, cat, bird, crow, seagull, hawk, parrot, butterfly, fish, koi, duck, ...), how many (up to 24) and the radius (m) of the area they share around x,z. */
  species: z.string().min(1).max(24).optional(),
  count: z.number().int().min(1).max(MAX_LIFE_COUNT).default(1),
  radius: z.number().min(1).max(150).default(8),
  /** role "life": a bird sits on the solid surface at x,z instead of flying. */
  perch: z.boolean().optional(),
});
type LevelItem = z.infer<typeof LevelItem>;

/** Inputs of `place_level_items`. */
export const PlaceLevelInput = z.object({ items: z.array(LevelItem).min(1).max(LEVEL_LIMITS.MAX_ITEMS), message: z.string().max(120).optional() });
export type PlaceLevelInput = z.infer<typeof PlaceLevelInput>;

/** The result of one level tool call (patches commit as one undo step). */
export interface LevelToolResult {
  ok: boolean;
  text: string;
  patches: Patch[];
  message: string;
  accepted: number;
  refused: number;
  /** Structured result of `query_level review` (findings and the cameras of the review renders). */
  data?: LevelReview;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;

function clip(text: string): string {
  return text.length > LEVEL_LIMITS.MAX_TEXT ? `${text.slice(0, LEVEL_LIMITS.MAX_TEXT)}\n… (cut)` : text;
}

function refuse(text: string, message = 'Level'): LevelToolResult {
  return { ok: false, text: clip(text), patches: [], message, accepted: 0, refused: 1 };
}

function issues(error: z.ZodError): string {
  return error.issues.slice(0, 6).map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
}

/** Run one level tool against `world`. Never throws except for wasm failures. */
export async function runLevelTool(world: WorldDoc, name: LevelToolName, rawInput: unknown, opts: { colliders?: ColliderProvider; surfaces?: LevelSurfaces } = {}): Promise<LevelToolResult> {
  setLevelColliders(opts.colliders);
  setLevelSurfaces(opts.surfaces);
  try {
    await initPhysics();
    return name === 'query_level' ? await runQuery(world, rawInput) : await runPlace(world, rawInput);
  } catch (e) {
    return refuse(`${name} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  } finally {
    setLevelColliders(undefined);
    setLevelSurfaces(undefined);
  }
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/** The solid surfaces of a world, for rays. */
class Ground {
  readonly pw: PhysicsWorld;
  readonly top: number;
  rays = 0;

  private constructor(pw: PhysicsWorld, readonly world: WorldDoc, top: number) {
    this.pw = pw;
    this.top = top;
  }

  static async open(world: WorldDoc): Promise<Ground> {
    const pw = await PhysicsWorld.create(world, { fixedDt: 1 / 60, ...levelColliders() });
    let top = 20;
    let count = 0;
    for (const id in world.entities) {
      const e = world.entities[id] as Entity;
      if (e.template || !e.physics || e.physics.sensor || e.physics.collider === 'none') continue;
      if (++count > 20_000) break;
      const b: Aabb | null = entityBounds(world, id);
      if (b && Number.isFinite(b.max[1])) top = Math.max(top, b.max[1] + 2);
    }
    return new Ground(pw, world, Math.min(top, 2000));
  }

  /** Highest solid surface at (x, z) at or below `below`, with its slope; `own` (an object being moved) is not a surface. */
  surface(x: number, z: number, below?: number, own?: ReadonlySet<string>): { y: number; slopeDeg: number; id: string | null } | null {
    if (this.rays++ > LEVEL_LIMITS.MAX_RAYS) return null;
    const y0 = below !== undefined ? below : this.top;
    const hit = own && own.size > 0 ? (this.pw.raycastAll([x, y0, z], [0, -1, 0], y0 + 500, 16).find((h) => h.id === null || !own.has(h.id)) ?? null) : this.pw.raycast([x, y0, z], [0, -1, 0], y0 + 500);
    if (!hit) return null;
    const ny = Math.max(-1, Math.min(1, hit.normal[1]));
    return { y: hit.point[1], slopeDeg: (Math.acos(ny) * 180) / Math.PI, id: hit.id };
  }

  /** Distance to the first solid thing along a direction, or `max` when clear. */
  ray(origin: Vec3, dir: Vec3, max: number): { distance: number; id: string | null } | null {
    if (this.rays++ > LEVEL_LIMITS.MAX_RAYS) return null;
    const hit = this.pw.raycast(origin, dir, max);
    return hit ? { distance: hit.distance, id: hit.id } : null;
  }

  label(id: string | null): string {
    if (id === null) return 'the ground';
    const e = this.world.entities[id];
    return e?.name && e.name !== id ? `${e.name} (${id})` : id;
  }

  dispose(): void {
    this.pw.dispose();
  }
}

function slopeWord(deg: number): string {
  return deg < 8 ? 'flat' : deg < 25 ? 'gentle' : deg < 45 ? 'steep' : 'a cliff';
}

// ---------------------------------------------------------------------------
// query_level
// ---------------------------------------------------------------------------

async function runQuery(world: WorldDoc, rawInput: unknown): Promise<LevelToolResult> {
  const input = QueryLevelInput.safeParse(rawInput);
  if (!input.success) return refuse(`Invalid query_level input: ${issues(input.error)}. Send {"op":"summary"|"ground"|"clearance"|"sightline"|"reach"|"objectives"|"review"|"grounding", …}.`);
  const q = input.data;
  const lines: string[] = [];
  switch (q.op) {
    case 'grounding': {
      // Against the surfaces as drawn: a hill with no body still holds up what rests on it.
      const g = await Ground.open(surfaceWorld(world));
      try {
        const only = q.ids ? new Set(q.ids) : undefined;
        const r = measureGrounding(world, g.pw, only);
        if (r.floating.length === 0) lines.push(`Grounding: all ${r.checked} object(s) that should rest on something touch it (within 0.12 m).`);
        else {
          lines.push(`Grounding: ${r.floating.length} of ${r.checked} object(s) hover above what is under them:`);
          for (const f of r.floating.slice(0, 20)) lines.push(`- ${floatingText(f, (id) => g.label(id))}. Fix: lower it ${Number.isFinite(f.gap) ? `by ${r2(f.gap)} m ` : ''}(place_level_items {"id":"${f.id}","x":${r2(f.origin[0])},"z":${r2(f.origin[2])}} snaps it onto the surface), or tag it "floating" if it hovers on purpose.`);
        }
      } finally {
        g.dispose();
      }
      break;
    }
    case 'ground': {
      const g = await Ground.open(world);
      try {
        for (const p of q.points) {
          const s = g.surface(p.x, p.z, p.below);
          lines.push(s ? `(${p.x}, ${p.z}): top surface y=${r2(s.y)} on ${g.label(s.id)}, slope ${r1(s.slopeDeg)} deg (${slopeWord(s.slopeDeg)})${s.slopeDeg > LEVEL_LIMITS.SLOPE_LIMIT_DEG ? ', too steep to stand on' : ''}` : `(${p.x}, ${p.z}): nothing below: open air`);
        }
      } finally {
        g.dispose();
      }
      break;
    }
    case 'clearance': {
      const g = await Ground.open(world);
      try {
        const s = g.surface(q.x, q.z, q.below);
        if (!s) {
          lines.push(`(${q.x}, ${q.z}): nothing below: open air`);
          break;
        }
        let free = 6;
        let nearest: { d: number; id: string | null; deg: number } | null = null;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          for (const h of [0.5, 1.4]) {
            const hit = g.ray([q.x, s.y + h, q.z], [Math.cos(a), 0, Math.sin(a)], 6);
            if (hit && hit.distance < free) {
              free = hit.distance;
              nearest = { d: hit.distance, id: hit.id, deg: Math.round((a * 180) / Math.PI) };
            }
          }
        }
        const up = g.ray([q.x, s.y + 0.05, q.z], [0, 1, 0], 12);
        const headroom = up ? up.distance : 12;
        const fits = free >= q.radius && headroom >= q.height;
        lines.push(`(${q.x}, ${q.z}): ground y=${r2(s.y)}, slope ${r1(s.slopeDeg)} deg; free radius ${r1(free)} m${nearest ? ` (nearest obstacle ${g.label(nearest.id)} toward ${nearest.deg} deg)` : ' (nothing within 6 m)'}; headroom ${up ? `${r1(headroom)} m under ${g.label(up.id)}` : 'open sky'}. A ${q.radius} m radius, ${q.height} m tall body ${fits ? 'fits' : 'does NOT fit'}.`);
      } finally {
        g.dispose();
      }
      break;
    }
    case 'sightline': {
      const g = await Ground.open(world);
      try {
        const d: Vec3 = [q.to[0] - q.from[0], q.to[1] - q.from[1], q.to[2] - q.from[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        if (len < 1e-6) {
          lines.push('The two points are the same.');
          break;
        }
        const hit = g.ray(q.from, [d[0] / len, d[1] / len, d[2] / len], len);
        lines.push(hit ? `Blocked by ${g.label(hit.id)} ${r1(hit.distance)} m along the line (of ${r1(len)} m).` : `Clear: nothing solid between the points (${r1(len)} m).`);
      } finally {
        g.dispose();
      }
      break;
    }
    case 'reach': {
      const g = await Ground.open(world);
      try {
        await withProbe(world, (probe) => {
          if (!probe.ok) {
            lines.push(`Reach cannot be measured: ${probe.problem}`);
            return;
          }
          for (const p of q.points) {
            const y = p.y ?? g.surface(p.x, p.z)?.y;
            if (y === undefined) {
              lines.push(`(${p.x}, ${p.z}): nothing below, so nobody can stand there`);
              continue;
            }
            const a = probe.reachFrom([p.x, y, p.z]);
            lines.push(a ? (a.reachable ? `(${p.x}, ${r1(y)}, ${p.z}): the player CAN get there from the spawn` : `(${p.x}, ${r1(y)}, ${p.z}): NOT reachable: ${a.reason}${a.nearest ? `; nearest standable spot ${a.nearest.map(r1).join(', ')}` : ''}`) : 'not measurable');
          }
        });
      } finally {
        g.dispose();
      }
      break;
    }
    case 'objectives': {
      await withProbe(world, (probe) => {
        if (!probe.ok) {
          lines.push(`Reach cannot be measured: ${probe.problem}`);
          return;
        }
        const all = probe.objectives();
        if (all.length === 0) lines.push('This level has no objectives yet (no pickups, goal, zones to enter or conversations the game needs).');
        const bad = all.filter((o) => !o.reachable);
        lines.push(`${all.length} objectives, ${all.length - bad.length} reachable on foot.`);
        for (const o of all.slice(0, 40)) lines.push(`- ${o.label} [${o.kind}${o.required ? ', required' : ''}] at ${o.position.map(r1).join(', ')}: ${o.reachable ? 'reachable' : `NOT reachable: ${o.reason}${o.nearest ? `; nearest standable spot ${o.nearest.map(r1).join(', ')}` : ''}`}`);
        if (all.length > 40) lines.push(`… and ${all.length - 40} more`);
      });
      break;
    }
    case 'summary': {
      lines.push(...(await levelSummary(world)));
      break;
    }
    case 'review': {
      const review = await reviewLevel(world);
      lines.push(`Level review: score ${review.score}/100, ${review.findings.length} finding${review.findings.length === 1 ? '' : 's'}.`);
      for (const f of review.findings.slice(0, 20)) lines.push(`- [${f.severity}] ${f.message} Fix: ${f.fix}.`);
      return { ok: true, text: clip(lines.join('\n')), patches: [], message: 'Level review', accepted: 0, refused: 0, data: review };
    }
  }
  return { ok: true, text: clip(lines.join('\n')), patches: [], message: 'Level query', accepted: 0, refused: 0 };
}

async function levelSummary(world: WorldDoc): Promise<string[]> {
  const out: string[] = [];
  const goals = deriveGoals(world);
  const spawn = world.player.spawn;
  out.push(`Player: ${world.player.mode}, spawn ${spawn.map(r1).join(', ')}, speed ${world.player.moveSpeed} m/s, jump ${world.player.jumpSpeed} m/s, gravity ${world.environment.gravity.map(r1).join(', ')}.`);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  let solids = 0;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || !e.physics || e.physics.sensor || e.physics.collider === 'none') continue;
    const b = entityBounds(world, id);
    if (!b || solids++ > 20_000) continue;
    minX = Math.min(minX, b.min[0]);
    maxX = Math.max(maxX, b.max[0]);
    minZ = Math.min(minZ, b.min[2]);
    maxZ = Math.max(maxZ, b.max[2]);
    minY = Math.min(minY, b.min[1]);
    maxY = Math.max(maxY, b.max[1]);
  }
  out.push(solids > 0 ? `Solid geometry spans x ${r1(minX)}..${r1(maxX)}, z ${r1(minZ)}..${r1(maxZ)}, y ${r1(minY)}..${r1(maxY)} (${solids} solid entities).` : 'No solid geometry besides the ground.');
  out.push(world.environment.ground ? `Ground plane at y=0 (${world.environment.ground.size} m).` : 'No ground plane: leave nothing to fall off by accident.');
  out.push(`Win: ${goals.winDefined ? 'defined' : 'NOT defined'}; ${goals.objectives.length} objectives (${goals.objectives.filter((o) => o.required).length} required); ${goals.hazards.length} hazard volumes; ${goals.doors.length} doors; ${goals.movers.length} moving platforms.`);
  const why = unsupportedReason(world);
  if (why) {
    out.push(`Reach: cannot be measured (${why}).`);
    return out;
  }
  await withProbe(world, (probe) => {
    if (!probe.ok) {
      out.push(`Reach: ${probe.problem}`);
      return;
    }
    const all = probe.objectives();
    const bad = all.filter((o) => !o.reachable);
    out.push(`Reach: ${all.length - bad.length} of ${all.length} objectives can be reached on foot${bad.length > 0 ? `; NOT reachable: ${bad.slice(0, 8).map((o) => `${o.label} (${o.reason})`).join('; ')}` : ''}.`);
  });
  return out;
}

// ---------------------------------------------------------------------------
// place_level_items
// ---------------------------------------------------------------------------

/** Most animals one call adds. */
const LIFE_LIMIT = 60;

const REACH_BY_DEFAULT: ReadonlySet<ItemRole> = new Set<ItemRole>(['pickup', 'goal', 'checkpoint', 'enemy']);

function primitiveHalfHeight(e: Record<string, unknown>): number {
  const shape = e['shape'] as { kind?: unknown; size?: unknown } | undefined;
  if (!shape || shape.kind !== 'primitive' || !Array.isArray(shape.size)) return 0;
  const sy = typeof shape.size[1] === 'number' ? (shape.size[1] as number) : 0;
  const scale = (e['transform'] as { scale?: unknown } | undefined)?.scale;
  const k = Array.isArray(scale) && typeof scale[1] === 'number' ? Math.abs(scale[1] as number) : 1;
  return (sy * k) / 2;
}

function roleDefaults(item: LevelItem): Record<string, unknown> {
  switch (item.role) {
    case 'pickup':
      return { behaviors: [{ type: 'collectible', params: { scoreKey: item.key ?? 'score', value: 1 } }, { type: 'spin', params: { axis: [0, 1, 0], speed: 90 } }], physics: { body: 'static', sensor: true } };
    case 'goal':
      return { behaviors: [{ type: 'goal', params: { text: 'You win!' } }], physics: { body: 'static', sensor: true } };
    case 'checkpoint':
      return { behaviors: [{ type: 'checkpoint', params: {} }], physics: { body: 'static', sensor: true } };
    case 'hazard':
      return { behaviors: [{ type: 'hazard', params: { mode: 'respawn' } }], physics: { body: 'static', sensor: true } };
    case 'enemy':
      return { physics: { body: 'kinematic' } };
    case 'prop':
      return { physics: { body: 'static' } };
    case 'decor':
      return { physics: { body: 'static', collider: 'none' } };
    case 'life':
      return {};
  }
}

/** True for something with a body to stand on its own bottom (not a light, an invisible zone or a sensor). */
function bodyOf(e: Entity | undefined): boolean {
  return !!e && e.visible && e.shape.kind !== 'none' && !e.physics?.sensor;
}

interface Candidate {
  item: LevelItem;
  entity: Entity;
  wantReach: boolean;
  isMove: boolean;
  position: Vec3;
}

async function runPlace(world: WorldDoc, rawInput: unknown): Promise<LevelToolResult> {
  const input = PlaceLevelInput.safeParse(rawInput);
  if (!input.success) return refuse(`Invalid place_level_items input: ${issues(input.error)}. Send {"items":[{"id","role","x","z","above"?,"entity":{"shape":{…},"name"?,"material"?}}]}.`);
  const items = input.data.items;
  const refused: string[] = [];
  const notes: string[] = [];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const ground = await Ground.open(world);
  // Props and decor rest on what is drawn (a hill with no body, a mesh larger than its collider); what the
  // player must reach stands on the colliders.
  const restsOnDrawn = (item: LevelItem, existing: Entity | null): boolean => (item.role === 'prop' || item.role === 'decor') && (!existing || shouldRest(existing));
  let drawn: Ground | null = null;
  try {
    if (items.some((it) => restsOnDrawn(it, Object.hasOwn(world.entities, it.id) ? (world.entities[it.id] as Entity) : null))) drawn = await Ground.open(surfaceWorld(world));
  } catch {
    drawn = null;
  }
  const water = findWaterBodies(world);
  const deps = dependencyIndex(world);
  let lifeEntities = 0;
  try {
    for (const item of items) {
      if (seen.has(item.id)) {
        refused.push(`${item.id}: the id is used twice in this call. Give each item its own id.`);
        continue;
      }
      seen.add(item.id);
      if (item.role === 'life') {
        const species = item.species ?? '';
        if (!isLifeSpecies(species)) {
          refused.push(`${item.id}: role "life" needs "species", one of ${LIFE_SPECIES_IDS.join(', ')}.`);
          continue;
        }
        if (lifeEntities + item.count > LIFE_LIMIT) {
          refused.push(`${item.id}: at most ${LIFE_LIMIT} animals per call; send the rest in another call.`);
          continue;
        }
        const plan = planLife({ id: item.id, species, count: item.count, x: item.x, z: item.z, radius: item.radius, ...(item.below !== undefined ? { below: item.below } : {}), ...(item.perch !== undefined ? { perch: item.perch } : {}), yaw: item.yaw }, {
          surface: (x, z, below) => ground.surface(x, z, below),
          clear: (x, y, z, r) =>
            !ground.pw.overlapsSphere([x, y, z], r).some((id) => {
              const o = world.entities[id];
              return o?.physics && !o.physics.sensor && o.physics.collider !== 'none';
            }),
          water,
        });
        for (const m of plan.placed) {
          if (Object.hasOwn(world.entities, m.id) || seen.has(m.id)) {
            refused.push(`${m.id}: that id already exists. Use another group id.`);
            continue;
          }
          const parsed = Entity.safeParse(m.entity);
          if (!parsed.success) {
            refused.push(`${m.id}: the animal is not valid: ${issues(parsed.error)}.`);
            continue;
          }
          seen.add(m.id);
          lifeEntities++;
          candidates.push({ item, entity: parsed.data, wantReach: false, isMove: false, position: m.position });
        }
        if (plan.summary) notes.push(plan.summary);
        refused.push(...plan.refused);
        continue;
      }
      const existing = Object.hasOwn(world.entities, item.id) ? (world.entities[item.id] as Entity) : null;
      const isMove = existing !== null && item.entity === undefined;
      if (existing && !isMove) {
        refused.push(`${item.id}: that id already exists. To move it, send {id,x,z} without "entity"; to change it use apply_patches.`);
        continue;
      }
      if (!existing && item.entity === undefined) {
        refused.push(`${item.id}: nothing to place. Send "entity" with at least a "shape" (primitive, generator or asset).`);
        continue;
      }
      // A moved object is measured without itself, its parts and what belongs to it (its plinth, light and
      // zone move with it): it must not stand on its own old position.
      const own = isMove ? deps.closure([item.id]) : undefined;
      const surface = (drawn && restsOnDrawn(item, existing) ? drawn : ground).surface(item.x, item.z, item.below, own);
      if (!surface) {
        refused.push(`${item.id}: nothing under (${item.x}, ${item.z}): it would hang in open air. Pick a spot over terrain or a platform, or measure first with query_level ground.`);
        continue;
      }
      const standing = item.role === 'pickup' || item.role === 'goal' || item.role === 'checkpoint' || item.role === 'enemy';
      if (standing && surface.slopeDeg > LEVEL_LIMITS.SLOPE_LIMIT_DEG) {
        refused.push(`${item.id}: the ground at (${item.x}, ${item.z}) is ${r1(surface.slopeDeg)} deg (${slopeWord(surface.slopeDeg)}): nobody can stand there. Move it toward flatter ground (query_level ground shows slopes).`);
        continue;
      }
      const base = existing ? (structuredClone(existing) as Record<string, unknown>) : { ...roleDefaults(item), ...(item.entity as Record<string, unknown>), id: item.id };
      if (!existing) {
        // Role defaults fill what the entity leaves out (behaviors and physics of a pickup, goal …).
        const given = item.entity as Record<string, unknown>;
        const defaults = roleDefaults(item);
        for (const k of ['behaviors', 'physics']) if (given[k] === undefined && defaults[k] !== undefined) base[k] = defaults[k];
      }
      const above = item.above ?? (item.role === 'pickup' || item.role === 'goal' || item.role === 'checkpoint' ? 0.8 : 0);
      // How far the origin sits above the bottom: measured on the object itself when it exists (a group, a
      // centred primitive, a model whose origin is not at its base), else half a primitive's height.
      const ownBox = existing && own ? subtreeBounds(world, [...own].filter((id) => bodyOf(world.entities[id]))) : null;
      const lift = ownBox ? worldTransform(world, item.id).position[1] - ownBox.min[1] : primitiveHalfHeight(base);
      const y = r2(surface.y + above + lift);
      const position: Vec3 = [r2(item.x), y, r2(item.z)];
      const tr = (base['transform'] as Record<string, unknown> | undefined) ?? {};
      const rot = Array.isArray(tr['rotation']) ? (tr['rotation'] as number[]) : [0, 0, 0];
      base['transform'] = { ...tr, position, rotation: [rot[0] ?? 0, item.yaw !== 0 || !existing ? item.yaw : (rot[1] ?? 0), rot[2] ?? 0] };
      const parsed = Entity.safeParse(base);
      if (!parsed.success) {
        refused.push(`${item.id}: the entity is not valid: ${issues(parsed.error)}.`);
        continue;
      }
      const entity = parsed.data;
      // Buried in something solid? (Its own body does not count: only what is already there.)
      const solidShape = entity.physics && !entity.physics.sensor && entity.physics.collider !== 'none';
      if (!existing && (item.role === 'pickup' || item.role === 'goal' || item.role === 'checkpoint' || item.role === 'enemy')) {
        const near = ground.pw.overlapsSphere(position, 0.3).filter((id) => id !== item.id);
        const block = near.find((id) => {
          const o = world.entities[id];
          return o?.physics && !o.physics.sensor && o.physics.collider !== 'none';
        });
        if (block) {
          refused.push(`${item.id}: its spot (${position.join(', ')}) is inside ${ground.label(block)}. Move it 1-2 m aside or raise "above".`);
          continue;
        }
      }
      if (item.role === 'prop' && solidShape === false) notes.push(`${item.id} has no solid body; the player will walk through it`);
      candidates.push({ item, entity, wantReach: item.reach ?? REACH_BY_DEFAULT.has(item.role), isMove: existing !== null, position });
    }
  } finally {
    ground.dispose();
    drawn?.dispose();
  }

  // Reach: measured once on the level with every accepted item in it.
  let kept = candidates;
  const needReach = candidates.filter((c) => c.wantReach);
  if (needReach.length > 0) {
    const work = structuredClone(world) as WorldDoc;
    for (const c of candidates) work.entities[c.entity.id] = c.entity;
    const valid = validateWorld(work);
    if (valid.ok && !unsupportedReason(valid.world)) {
      const dropped = new Set<string>();
      await withProbe(valid.world, (probe) => {
        if (!probe.ok) {
          notes.push(`reach was not checked: ${probe.problem}`);
          return;
        }
        for (const c of needReach) {
          const a = probe.reachFrom(c.position);
          if (a && !a.reachable) {
            dropped.add(c.entity.id);
            refused.push(`${c.entity.id}: the player cannot get to (${c.position.map(r1).join(', ')}): ${a.reason}.${a.nearest ? ` Nearest standable spot ${a.nearest.map(r1).join(', ')}: move it there, add a platform, ramp or lift, or lower it.` : ''}`);
          }
        }
      });
      kept = candidates.filter((c) => !dropped.has(c.entity.id));
    } else if (!valid.ok) {
      notes.push('reach was not checked: the level with the new items did not validate');
    } else {
      notes.push(`reach was not checked: ${unsupportedReason(valid.world) ?? 'unsupported view'}`);
    }
  }

  const patches: Patch[] = kept.map((c) => (c.isMove ? { op: 'update', id: c.entity.id, set: { transform: c.entity.transform } } : { op: 'add', entity: c.entity }));
  // What belongs to a moved object (its light, goal zone, plinth) goes with it, unless this call places it too.
  const moves = kept.filter((c) => c.isMove);
  let carried: Array<{ id: string; owner: string }> = [];
  if (moves.length > 0) {
    const entities = { ...world.entities };
    for (const c of moves) entities[c.entity.id] = c.entity;
    const carry = carryPatches(world, { ...world, entities }, moves.map((c) => c.entity.id), new Set(kept.map((c) => c.entity.id)));
    patches.push(...carry.patches);
    carried = carry.carried;
  }
  const lines: string[] = [];
  if (kept.length > 0) lines.push(`Placed ${kept.length} item(s): ${kept.slice(0, 20).map((c) => `${c.entity.id} at ${c.position.map(r1).join(', ')}`).join('; ')}.`);
  if (carried.length > 0) lines.push(`Moved with their owner: ${carried.slice(0, 12).map((c) => `${c.id} (belongs to ${c.owner})`).join(', ')}.`);
  if (refused.length > 0) {
    lines.push(`${refused.length} item(s) were refused, nothing was placed for them. Fix and resend only these:`);
    for (const r of refused.slice(0, 20)) lines.push(`- ${r}`);
  }
  for (const n of notes.slice(0, 5)) lines.push(`Note: ${n}.`);
  return {
    ok: kept.length > 0 || refused.length === 0,
    text: clip(lines.join('\n') || 'No change.'),
    patches,
    message: input.data.message?.trim() || `Place ${kept.length} level item${kept.length === 1 ? '' : 's'}`,
    accepted: kept.length,
    refused: refused.length,
  };
}

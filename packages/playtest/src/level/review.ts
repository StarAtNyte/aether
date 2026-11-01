/**
 * Level review: the checks a level designer would run before showing a game, as findings the assistant
 * can fix with the level tools, plus the camera poses of the renders it should look at (an overview of
 * the whole level, the player's first view, a close look at the worst problem).
 *
 * Everything is measured on the document: reach comes from the verified-playable bot's walking map,
 * heights from ray casts. Nothing here plays the game: that is the bot's job once the review is done.
 */
import { entityBounds, type Aabb } from '@aether/physics';
import { floatingText, groundingOf } from './grounding';
import type { Entity, Vec3, WorldDoc } from '@aether/core';
import { deriveGoals } from '../goals';
import { roamTargets, unsupportedReason } from '../agent';
import { withProbe } from './probe-cache';
import { levelSurfaces, type LevelSurfaces } from './colliders';

/** One problem found in a level. */
export interface LevelFinding {
  code: 'spawn' | 'box_terrain' | 'flat_surfaces' | 'low_detail' | 'repetition' | 'no_win' | 'unreachable_required' | 'unreachable_optional' | 'unreachable_target' | 'first_reward_far' | 'unmeasured' | 'floating';
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Entities involved (ids). */
  entities: string[];
  /** What to do about it. */
  fix: string;
  /** Where the problem is. */
  at?: Vec3;
}

/** A camera for a review render. */
export interface LevelPose {
  name: string;
  label: string;
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** The result of {@link reviewLevel}. */
export interface LevelReview {
  /** False for a world with no gameplay in it (scenery): there is nothing to review as a level. */
  applicable: boolean;
  findings: LevelFinding[];
  poses: LevelPose[];
  /** 0..100: 100 minus 25 per error and 6 per warning. */
  score: number;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Score of a finding list. */
export function scoreLevel(findings: readonly LevelFinding[]): number {
  let s = 100;
  for (const f of findings) s -= f.severity === 'error' ? 25 : f.severity === 'warning' ? 6 : 0;
  return Math.max(0, s);
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Objects that should rest on something but hover: an error from half a metre (plainly in the air), a warning
 * below. Measured with rays against the drawn surfaces (see grounding.ts); tagged "floating" things are left alone.
 */
async function groundingFindings(world: WorldDoc, out: LevelFinding[]): Promise<void> {
  try {
    const report = await groundingOf(world);
    const label = (id: string | null): string => {
      if (id === null) return 'the ground';
      const e = world.entities[id];
      return e?.name && e.name !== id ? `${e.name} (${id})` : id;
    };
    for (const f of report.floating.slice(0, 12)) {
      const lower = Number.isFinite(f.gap) ? `lower it by ${r2(f.gap)} m (its position y to ${r2(f.origin[1] - f.gap)})` : 'move it over solid ground';
      out.push({
        code: 'floating',
        // Over open air is often a sky level on purpose (a rock under a floating island): a warning for the eyes to judge.
        severity: Number.isFinite(f.gap) && f.gap >= 0.5 ? 'error' : 'warning',
        message: `${floatingText(f, label)}.`,
        entities: [f.id],
        at: f.at,
        fix: `${lower}: place_level_items {"id":"${f.id}","x":${r2(f.origin[0])},"z":${r2(f.origin[2])}} snaps it onto the surface there; if it is meant to hover, tag it "floating"`,
      });
    }
  } catch {
    /* no physics here: grounding is not measured */
  }
}

/** The box around everything solid that is not scenery far away (backdrop-tagged entities are left out). */
function solidExtent(world: WorldDoc): { min: Vec3; max: Vec3 } | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let count = 0;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || e.tags.includes('backdrop') || !e.physics || e.physics.sensor || e.physics.collider === 'none') continue;
    if (++count > 20_000) break;
    const b: Aabb | null = entityBounds(world, id);
    if (!b || !Number.isFinite(b.max[0] + b.min[0] + b.max[2] + b.min[2])) continue;
    // A 400 m ground slab does not describe the level.
    if (b.max[0] - b.min[0] > 600 || b.max[2] - b.min[2] > 600) continue;
    minX = Math.min(minX, b.min[0]);
    maxX = Math.max(maxX, b.max[0]);
    minY = Math.min(minY, b.min[1]);
    maxY = Math.max(maxY, b.max[1]);
    minZ = Math.min(minZ, b.min[2]);
    maxZ = Math.max(maxZ, b.max[2]);
  }
  return count === 0 ? null : { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** True when the world has something to play: objectives, a win or lose rule, or gameplay behaviours. */
function hasGameplay(world: WorldDoc, derived: boolean): boolean {
  if (derived) return true;
  if (world.rules.some((r) => r.enabled && r.then.some((a) => a.do === 'win' || a.do === 'lose'))) return true;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (!e.template && e.behaviors.some((b) => b.enabled && (b.type === 'collectible' || b.type === 'goal' || b.type === 'checkpoint'))) return true;
  }
  return false;
}

/** The one-line fix for a box-collider terrain, with the corrected generator source in full when it is short enough to send back to write_generator as it stands. */
function boxFix(world: WorldDoc, id: string): string {
  const gid = (world.entities[id]?.shape as { generator?: string }).generator ?? '';
  const gen = Object.hasOwn(world.generators, gid) ? world.generators[gid] : undefined;
  const head = `edit the generator "${gid}": call api.autoColliders("trimesh") so it collides with the surface it draws`;
  if (!gen || gen.source.length > 6000) return head;
  const fixed = gen.source.replace(/autoColliders\(\s*(['"]box['"])?\s*\)/, 'autoColliders("trimesh")');
  return `${head}. Call write_generator with id "${gid}" and exactly this source (only that call changed):\n${fixed}`;
}

/** Least surface (m2) and flat share at which a world reads as a toy: the gate fails it until its surfaces carry real finishes. */
const FLAT_MIN_AREA = 400;
const FLAT_MAX_SHARE = 0.5;

/**
 * The surface gate: most of what the custom generators draw is a plain colour (no finish, texture set or preset), which is the
 * toy look. An error, so the review loop cannot approve it; the fix names the worst generators and the finishes to use.
 */
function flatSurfaceFinding(s: LevelSurfaces | undefined): LevelFinding | null {
  if (!s || s.area < FLAT_MIN_AREA || s.flatShare <= FLAT_MAX_SHARE) return null;
  const worst = s.generators.filter((g) => g.flatArea > 0).slice(0, 5);
  const list = worst.map((g) => `"${g.generator}" (${Math.round(g.flatArea)} m2 flat, used by ${g.entities.length})`).join(', ');
  return {
    code: 'flat_surfaces',
    severity: 'error',
    message: `${Math.round(s.flatShare * 100)}% of the surface the custom generators draw is a plain colour with no finish or texture, which reads as a toy: ${list}`,
    entities: worst.flatMap((g) => g.entities).slice(0, 12),
    fix: 'give every piece a real surface: pass a finish in each api.add(mesh, {finish, color}) call, e.g. plaster / paint for walls, facade for windowed fronts, roof-tile or slate for roofs, cobble / asphalt / gravel for streets and plazas, limestone / stone / brick for masonry, grass / rock / soil with splat for terrain, oak / brushed-metal for trim. Colour stays a tint. Edit the generator with write_generator, then run query_level review again.',
  };
}

/** Surface (m2 across all its entities) below which a generator's detail is not worth a finding, and the triangle density that reads as bare slabs. */
const DETAIL_MIN_AREA = 600;
const DETAIL_MIN_TRIS_PER_M2 = 1;
/** Identical copies of one piece, in one group, from which the repetition is a finding. */
const REPEAT_MIN = 6;
const REPEAT_EXEMPT_TAGS = ['terrain', 'land', 'roads', 'road', 'street', 'stairs', 'fence', 'wall', 'water', 'quay', 'promenade'];

/**
 * The detail pass: a generator drawn as bare slabs (no bevels, trim, cornices, reveals or relief, so few triangles per m2) and the
 * same piece repeated unchanged many times are what make a place read as made from a kit. Warnings: the loop pushes each back once
 * and the agent may say why it stands.
 */
function detailFindingsOf(world: WorldDoc, s: LevelSurfaces | undefined): LevelFinding[] {
  const out: LevelFinding[] = [];
  if (!s) return out;
  const exempt = (id: string): boolean => (world.entities[id]?.tags ?? []).some((t) => REPEAT_EXEMPT_TAGS.includes(t.toLowerCase()));
  const bare = (s.detail ?? []).filter((d) => d.trisPerM2 < DETAIL_MIN_TRIS_PER_M2 && d.area * d.entities.length >= DETAIL_MIN_AREA && !d.entities.every(exempt)).slice(0, 4);
  if (bare.length > 0) {
    out.push({
      code: 'low_detail',
      severity: 'warning',
      message: `drawn as bare slabs, with almost no modelled detail: ${bare.map((d) => `"${d.generator}" (${d.trisPerM2.toFixed(1)} triangles per m2, used by ${d.entities.length})`).join(', ')}`,
      entities: bare.flatMap((d) => d.entities).slice(0, 12),
      fix: 'model the small things a real one has: bevel the edges with api.roundedBox(w, h, d, radius) instead of api.box, a cornice and string course, window reveals with sills and lintels, door surrounds and steps, roof eaves and chimneys, balcony rails, downpipes, worn plinths. Add them as extra api.add parts with their own finish, then run query_level review again.',
    });
  }
  const reps = (s.repeats ?? []).filter((r) => r.count >= REPEAT_MIN && !r.entities.every(exempt)).slice(0, 4);
  if (reps.length > 0) {
    out.push({
      code: 'repetition',
      severity: 'warning',
      message: `the same piece repeated unchanged: ${reps.map((r) => `"${r.generator}" x${r.count}`).join(', ')}`,
      entities: reps.flatMap((r) => r.entities).slice(0, 12),
      fix: 'vary the copies: different params (size, colour, variant), a random yaw and scale between 0.9 and 1.15, a different library model for some, and leave gaps; a row of identical pieces reads as a kit.',
    });
  }
  return out;
}

/** Terrain or land entities made by a custom generator that asks for the default box collider: a flat slab, not the surface. */
function boxTerrain(world: WorldDoc): string[] {
  const out: string[] = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || e.shape.kind !== 'procedural' || !e.tags.some((t) => t === 'terrain' || t === 'land')) continue;
    const gen = Object.hasOwn(world.generators, e.shape.generator) ? world.generators[e.shape.generator] : undefined;
    if (!gen) continue;
    if (/autoColliders\(\s*(['"]box['"])?\s*\)/.test(gen.source) && !/api\.collider\(/.test(gen.source)) out.push(id);
  }
  return out;
}

/** Review a game or outdoor level. Never throws for odd documents. */
export async function reviewLevel(world: WorldDoc): Promise<LevelReview> {
  const findings: LevelFinding[] = [];
  const goals = deriveGoals(world);
  const gameplay = hasGameplay(world, goals.objectives.length > 0 || goals.winDefined);
  // A free-roam place checks every walkable piece; a game checks only the homes and rooms a visitor should be able to walk into.
  const targets = gameplay ? roamTargets(world).filter((t) => t.enterable) : roamTargets(world);
  const flat = flatSurfaceFinding(levelSurfaces());
  const detailFindings = detailFindingsOf(world, levelSurfaces());
  if (!gameplay && targets.length === 0 && boxTerrain(world).length === 0 && !flat && detailFindings.length === 0) return { applicable: false, findings: [], poses: [], score: 100 };
  const spawn = world.player.spawn;
  const why = unsupportedReason(world);
  const boxed = gameplay ? [] : boxTerrain(world);
  for (const id of boxed) {
    findings.push({
      code: 'box_terrain',
      severity: 'error',
      message: `${world.entities[id]?.name ?? id} (${id}) is terrain or land whose generator collides as one box (autoColliders with the default or "box"): the player stands on, or is buried in, a flat slab at its highest point, never on its real surface`,
      entities: [id],
      fix: boxFix(world, id),
    });
  }
  if (flat) findings.push(flat);
  findings.push(...detailFindings);
  if (!gameplay) {
    // A place to walk around in (a town, a plaza, a campus): nothing to win, but the player must be able to stand, walk and get to the things in it.
  } else if (!goals.winDefined && goals.objectives.length > 0) {
    findings.push({ code: 'no_win', severity: 'error', message: 'nothing in this level ends the game: there are objectives but no goal and no winning rule', entities: [], fix: 'place a goal with place_level_items (role "goal") or add a win rule (addRule with a win action)' });
  } else if (!goals.winDefined) {
    findings.push({ code: 'no_win', severity: 'error', message: 'the level has no goal, pickup or winning rule: there is nothing to play yet', entities: [], fix: 'place pickups and a goal with place_level_items and add a win rule' });
  }
  if (why) {
    findings.push({ code: 'unmeasured', severity: 'info', message: `reach cannot be measured here: ${why}`, entities: [], fix: 'none' });
  } else {
    await withProbe(world, (probe) => {
      if (!probe.ok) {
        findings.push({ code: 'spawn', severity: 'error', message: probe.problem || 'the player has nowhere to stand at the spawn point', entities: [], at: [spawn[0], spawn[1], spawn[2]], fix: 'move player.spawn to open ground (query_level ground and clearance tell where)' });
        return;
      }
      for (const t of targets) {
        const a = probe.reachFrom(t.position);
        if (!a || a.reachable) continue;
        const near = a.nearest ? ` The nearest standable spot is ${a.nearest.map(r1).join(', ')}.` : '';
        findings.push({
          code: 'unreachable_target',
          severity: 'error',
          message: `${t.label} at ${t.position.map(r1).join(', ')} cannot be reached on foot from the spawn: ${a.reason}.${near}`,
          entities: [t.id],
          at: t.position,
          fix: t.enterable ? 'make it a home you can walk into: a doorway the player fits through (at least 1.2 m wide and 2.2 m high), a floor inside at the doorstep level, and a shell that is not one solid collider (give the generator api.autoColliders("trimesh") or separate wall colliders, never a box over the whole dome); then furnish it and light it' : t.drivable ? 'put the car on a road within a short walk of the spawn (place_level_items {id,x,z} snaps it onto the surface), and make sure the road and the way to it are solid ground' : 'make the way there solid ground (a street, stairs or ramp with a collider; a slope over about 45 degrees cannot be walked) or move the spawn onto the connected ground',
        });
      }
      const all = probe.objectives();
      for (const o of all) {
        if (o.reachable) continue;
        const near = o.nearest ? ` The nearest standable spot is ${o.nearest.map(r1).join(', ')}.` : '';
        findings.push({
          code: o.required ? 'unreachable_required' : 'unreachable_optional',
          severity: o.required ? 'error' : 'warning',
          message: `${o.label} at ${o.position.map(r1).join(', ')} cannot be reached on foot: ${o.reason}.${near}`,
          entities: o.id.includes(':') ? [o.id.slice(o.id.indexOf(':') + 1)] : [],
          at: o.position,
          fix: 'move it within reach with place_level_items ({id,x,z}), or add a ramp, stairs, a platform or a lift that gets the player there',
        });
      }
      // Pacing: a first reward within a short walk of the spawn.
      const pickups = all.filter((o) => o.kind === 'collect' && o.reachable);
      if (pickups.length >= 3) {
        const nearest = Math.min(...pickups.map((o) => Math.hypot(o.position[0] - spawn[0], o.position[2] - spawn[2])));
        if (nearest > 35) findings.push({ code: 'first_reward_far', severity: 'warning', message: `the nearest pickup is ${r1(nearest)} m from the spawn: the first reward comes too late`, entities: [], fix: 'put a pickup within 10 to 20 m of the spawn' });
      }
    });
  }

  // Grounding: props, landmarks and buildings set in the air above the terrain they should stand on.
  await groundingFindings(world, findings);

  // The renders: the whole level from above and behind, the player's first view, the worst problem up close.
  const poses: LevelPose[] = [];
  const ext = solidExtent(world);
  if (ext) {
    const cx = (ext.min[0] + ext.max[0]) / 2;
    const cz = (ext.min[2] + ext.max[2]) / 2;
    const size = Math.max(ext.max[0] - ext.min[0], ext.max[2] - ext.min[2], 20);
    const cy = Math.max(0, (ext.min[1] + ext.max[1]) / 2);
    poses.push({ name: 'overview', label: 'the whole level from above and in front', position: [r1(cx), r1(cy + size * 0.75), r1(cz + size * 0.8)], target: [r1(cx), r1(cy), r1(cz)], fov: 55 });
  }
  poses.push({ name: 'player-view', label: "the player's first view from the spawn", position: [r1(spawn[0]), r1(spawn[1] + 2.2), r1(spawn[2] + 5)], target: [r1(spawn[0]), r1(spawn[1] + 1.6), r1(spawn[2] - 14)], fov: 70 });
  const worst = findings.find((f) => f.at !== undefined && f.severity !== 'info');
  if (worst?.at) {
    const [x, y, z] = worst.at;
    poses.push({ name: 'problem', label: 'the problem spot, from 8 m away', position: [r1(x + 6), r1(y + 5), r1(z + 6)], target: [r1(x), r1(y + 0.5), r1(z)], fov: 60 });
  }
  return { applicable: true, findings, poses, score: scoreLevel(findings) };
}

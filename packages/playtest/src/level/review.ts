/**
 * Level review: the checks a level designer would run before showing a game, as findings the assistant
 * can fix with the level tools, plus the camera poses of the renders it should look at (an overview of
 * the whole level, the player's first view, a close look at the worst problem).
 *
 * Everything is measured on the document: reach comes from the verified-playable bot's walking map,
 * heights from ray casts. Nothing here plays the game: that is the bot's job once the review is done.
 */
import { entityBounds, PhysicsWorld, type Aabb } from '@aether/physics';
import { floatingText, measureGrounding } from './grounding';
import type { Entity, Vec3, WorldDoc } from '@aether/core';
import { deriveGoals } from '../goals';
import { unsupportedReason } from '../agent';
import { withProbe } from './probe-cache';

/** One problem found in a level. */
export interface LevelFinding {
  code: 'spawn' | 'no_win' | 'unreachable_required' | 'unreachable_optional' | 'first_reward_far' | 'unmeasured' | 'floating';
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
 * below. Measured with rays against the colliders (see grounding.ts); tagged "floating" things are left alone.
 */
async function groundingFindings(world: WorldDoc, out: LevelFinding[]): Promise<void> {
  let pw: PhysicsWorld | null = null;
  try {
    pw = await PhysicsWorld.create(world, { fixedDt: 1 / 60 });
    const report = measureGrounding(world, pw);
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
  } finally {
    pw?.dispose();
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

/** Review a game or outdoor level. Never throws for odd documents. */
export async function reviewLevel(world: WorldDoc): Promise<LevelReview> {
  const findings: LevelFinding[] = [];
  const goals = deriveGoals(world);
  if (!hasGameplay(world, goals.objectives.length > 0 || goals.winDefined)) return { applicable: false, findings: [], poses: [], score: 100 };
  const spawn = world.player.spawn;
  const why = unsupportedReason(world);
  if (!goals.winDefined && goals.objectives.length > 0) {
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

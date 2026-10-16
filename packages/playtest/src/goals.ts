/**
 * Goal derivation: reads a World IR document and works out what a player
 * has to do to finish it — pick up the collectibles that count, reach the
 * goal or the zones that end the game, open the doors in the way — plus the
 * things to avoid (hazards). Pure document analysis: no physics needed.
 *
 * The analysis follows the same semantics as `@aether/logic`: `collectible`
 * adds `value` to its `scoreKey`, `goal` wins on touch, `door` opens by
 * proximity, a key press or a state key, rules react to state and zones.
 * A collectible is **required** when its state key is (transitively) read by
 * a winning rule or by a door; otherwise it is a bonus and an unreachable
 * bonus is only a caution.
 */
import { compare, resolveSelector, rotateVec3, worldTransform, type Action, type Condition, type Dialogue, type DialogueCondition, type DialogueEffect, type Entity, type EntityId, type Json, type Rule, type Vec3, type WorldDoc } from '@aether/core';
import { insideZone, zoneShapeOf, type ZoneShape } from '@aether/logic';
import { entityBounds, type Aabb } from '@aether/physics';
import { PLAYTEST_LIMITS, type Objective } from './types';

/** Quaternion [x, y, z, w]. */
type Quat = [number, number, number, number];

/** The volume that triggers an objective when the player's feet enter it. */
export interface TouchVolume {
  shape: ZoneShape;
  center: Vec3;
  rot: Quat;
  margin: number;
}

/** An objective with the volume that completes it. */
export interface GoalObjective extends Objective {
  touch: TouchVolume;
  /** Rooms: a floor outline and height band; standing inside it (a hand's breadth from the walls) visits the room. */
  region?: { poly: Array<[number, number]>; y0: number; y1: number };
  /** Only the state-key reading of the logic completes it (no entity to watch). */
  completes: 'destroyed' | 'state' | 'game-over';
  /** `talk` objectives: the conversation that gets what the game needs from this character. */
  talk?: TalkPlan;
  /** `goal` objectives: the goal is switched on by a rule, so touching it before then does not count. */
  gated?: boolean;
  /** `press` objectives: the key the player presses (as the rule names it) while standing here. */
  pressKey?: string;
}

/** How to get what the game needs out of a character's dialogue tree. */
export interface TalkPlan {
  npc: EntityId;
  name: string;
  /** Choice texts to pick, in order, from the start of the conversation. */
  steps: string[];
  /** Conditions on the chosen options: the conversation only works while they hold. */
  needs: DialogueCondition[];
  /** State keys the conversation sets that the game needs (a talk is done when they hold). */
  writes: string[];
  /** The conversation itself ends the game with a win. */
  wins: boolean;
  /** Distance (m) within which the character will talk. */
  range: number;
}

/** How a door opens (mirrors the `door` behavior parameters). */
export interface DoorInfo {
  id: EntityId;
  trigger: 'proximity' | 'state' | 'key';
  stateKey: string;
  key: string;
  radius: number;
  startOpen: boolean;
  /** Seconds the leaf takes to open. */
  duration: number;
  center: Vec3;
  /** The entity's own position (what the door's radius is measured from). */
  origin: Vec3;
  /** Horizontal unit vector through the opening (perpendicular to the closed leaf). */
  normal: [number, number];
  /** Closed pose bounds (null when the door has no geometry). */
  bounds: Aabb | null;
  enabled: boolean;
}

/** A damaging volume the bot keeps out of. */
export interface HazardZone {
  id: EntityId;
  /** The volume that hurts (the logic's own containment test, with its reach). */
  touch: TouchVolume;
  /** `lose` ends the game, `respawn`/`damage` move or hurt the player. */
  mode: string;
}

/** What a document asks of the player. */
export interface GoalModel {
  objectives: GoalObjective[];
  doors: DoorInfo[];
  hazards: HazardZone[];
  /** A way to win exists (a winning rule or a `goal` entity). */
  winDefined: boolean;
  /** State keys that must rise for the game to be won (transitively). */
  requiredKeys: Set<string>;
  /** Longest `timer` trigger in seconds (a "survive" style win), or 0. */
  timerSeconds: number;
  /** The document uses sandboxed scripts (their goals cannot be derived statically). */
  hasScripts: boolean;
  /** Entities that move on their own (lifts, platforms, orbiting parts): the bot plans on their starting pose. */
  movers: EntityId[];
  /** State keys a pickup can raise → total producible amount. */
  producible: Map<string, number>;
}

const TOUCH_MARGIN_DEFAULT = 0.5;

function num(v: Json | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: Json | undefined, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function behaviorOf(e: Entity, type: string): { params: Record<string, Json> } | undefined {
  const b = e.behaviors.find((x) => x.type === type && x.enabled);
  return b ? { params: b.params } : undefined;
}

function pose(world: WorldDoc, id: EntityId): { position: Vec3; quaternion: Quat } | null {
  try {
    const t = worldTransform(world, id);
    return { position: [t.position[0], t.position[1], t.position[2]], quaternion: [t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]] };
  } catch {
    return null;
  }
}

function touchOf(world: WorldDoc, e: Entity, margin: number): TouchVolume | null {
  const p = pose(world, e.id);
  if (!p) return null;
  return { shape: zoneShapeOf(e), center: p.position, rot: p.quaternion, margin };
}

/** Distance (m) from a point to the nearest edge of a polygon. */
function edgeDistance(poly: ReadonlyArray<readonly [number, number]>, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as readonly [number, number];
    const b = poly[(i + 1) % poly.length] as readonly [number, number];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz)));
  }
  return best;
}

function insidePolygon(poly: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as readonly [number, number];
    const b = poly[j] as readonly [number, number];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** True when `feet` stands in a room's region at least `inset` metres inside its outline. */
export function inRegion(region: NonNullable<GoalObjective['region']>, feet: Readonly<Vec3>, inset = 0): boolean {
  if (feet[1] < region.y0 || feet[1] > region.y1) return false;
  if (!insidePolygon(region.poly, feet[0], feet[2])) return false;
  return inset <= 0 || edgeDistance(region.poly, feet[0], feet[2]) >= inset;
}

/** True when `feet` is inside the touch volume of an objective. */
export function touches(v: TouchVolume, feet: Readonly<Vec3>): boolean {
  return insideZone(v.shape, v.center, v.rot, feet, v.margin);
}

function doorNormal(q: Quat): [number, number] {
  const v = rotateVec3(q, [0, 0, 1]);
  const l = Math.hypot(v[0], v[2]);
  return l < 1e-6 ? [0, 1] : [v[0] / l, v[2] / l];
}

function doorCentre(fallback: Vec3, b: Aabb | null): Vec3 {
  return b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : fallback;
}

/** Keys a condition list reads. */
function conditionKeys(conds: readonly Condition[]): string[] {
  return conds.map((c) => c.key.split('.')[0] as string);
}

function baseKey(key: string): string {
  return key.split('.')[0] as string;
}

/** State keys an action list writes (set / add). */
function writtenKeys(actions: readonly Action[]): string[] {
  const out: string[] = [];
  for (const a of actions) if (a.do === 'set' || a.do === 'add') out.push(baseKey(a.key));
  return out;
}

function hasAction(rule: Rule, kind: Action['do']): boolean {
  return rule.then.some((a) => a.do === kind);
}

/** Add the state keys a rule reads to `into`. */
function readKeys(rule: Rule): string[] {
  const keys = conditionKeys(rule.if);
  if (rule.when.on === 'state') keys.push(baseKey(rule.when.key));
  return keys;
}

/**
 * Derive what the player has to do in `world`. Bounded: at most
 * {@link PLAYTEST_LIMITS.MAX_OBJECTIVES} objectives.
 */
export function deriveGoals(world: WorldDoc): GoalModel {
  const objectives: GoalObjective[] = [];
  const doors: DoorInfo[] = [];
  const hazards: HazardZone[] = [];
  const producible = new Map<string, number>();
  let hasScripts = Object.keys(world.scripts).length > 0;
  const movers: EntityId[] = [];
  let winDefined = false;
  let timerSeconds = 0;

  // --- required state keys: read by a winning rule, then pulled in transitively ---
  const required = new Set<string>();
  const winRules = world.rules.filter((r) => r.enabled && hasAction(r, 'win'));
  if (winRules.length > 0) winDefined = true;
  for (const r of winRules) for (const k of readKeys(r)) required.add(k);
  // A rule that switches a goal on gates the win just as much as a winning rule does: what it reads is required.
  for (const r of world.rules) {
    if (r.enabled && r.then.some((a) => a.do === 'enableBehavior' && a.enabled && a.behavior === 'goal')) for (const k of readKeys(r)) required.add(k);
  }
  for (const r of world.rules) {
    if (r.enabled && r.when.on === 'timer') timerSeconds = Math.max(timerSeconds, r.when.at);
  }

  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template) continue;
    if (e.behaviors.some((b) => b.type === 'script' && b.enabled)) hasScripts = true;
    if (e.physics?.body === 'kinematic' && e.behaviors.some((b) => b.enabled && (b.type === 'patrol' || b.type === 'orbit' || b.type === 'follow' || b.type === 'conveyor'))) movers.push(id);
    const d = behaviorOf(e, 'door');
    if (d) {
      const trigger = str(d.params['trigger'], 'proximity');
      const stateKey = str(d.params['stateKey'], '');
      const p = pose(world, id);
      doors.push({
        id,
        trigger: trigger === 'state' || trigger === 'key' ? trigger : 'proximity',
        stateKey,
        key: str(d.params['key'], 'e').toLowerCase(),
        radius: num(d.params['radius'], 3),
        startOpen: d.params['startOpen'] === true,
        duration: Math.max(0.05, num(d.params['duration'], 1)),
        center: doorCentre(p ? p.position : [0, 0, 0], entityBounds(world, id)),
        origin: p ? p.position : [0, 0, 0],
        normal: doorNormal(p ? p.quaternion : [0, 0, 0, 1]),
        bounds: entityBounds(world, id),
        enabled: true,
      });
      if (trigger === 'state' && stateKey) required.add(baseKey(stateKey));
    }
    const h = behaviorOf(e, 'hazard');
    if (h) {
      const t = touchOf(world, e, Math.max(0, num(h.params['margin'], 0.25)));
      if (t) hazards.push({ id, touch: t, mode: str(h.params['mode'], 'lose') });
    }
  }
  // Rules that raise a required key make their own triggers required (a zone, another counter …).
  let grew = true;
  for (let guard = 0; grew && guard < 16; guard++) {
    grew = false;
    for (const r of world.rules) {
      if (!r.enabled) continue;
      if (!writtenKeys(r.then).some((k) => required.has(k))) continue;
      for (const k of readKeys(r)) {
        if (!required.has(k)) {
          required.add(k);
          grew = true;
        }
      }
    }
  }

  // Event chains: a win rule may wait for an event another rule emits, often when the player presses a
  // key at a place ("press E at the bell once every chapter is told"). The emitting rules' conditions
  // are required too, and a key rule on the chain becomes a `press` objective.
  const wantedEvents = new Set<string>();
  for (const r of winRules) if (r.when.on === 'event') wantedEvents.add(r.when.name);
  const pressRules = new Map<string, Rule>();
  for (let guard = 0; guard < 16; guard++) {
    let changed = false;
    for (const r of world.rules) {
      if (!r.enabled) continue;
      const emits = r.then.some((a) => a.do === 'emit' && wantedEvents.has(a.event));
      const wins = hasAction(r, 'win');
      const feeds = writtenKeys(r.then).some((k) => required.has(k));
      if (r.when.on === 'key' && (emits || wins || feeds) && !pressRules.has(r.id)) {
        pressRules.set(r.id, r);
        changed = true;
      }
      if (!emits) continue;
      for (const k of readKeys(r)) {
        if (!required.has(k)) {
          required.add(k);
          changed = true;
        }
      }
      if (r.when.on === 'event' && !wantedEvents.has(r.when.name)) {
        wantedEvents.add(r.when.name);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const r of pressRules.values()) {
    winDefined = winDefined || hasAction(r, 'win') || r.then.some((a) => a.do === 'emit');
    for (const k of conditionKeys(r.if)) required.add(k);
  }

  // Goals a rule switches on later still end the game once they are on.
  const gatedGoals = new Set<string>();
  for (const r of world.rules) {
    if (!r.enabled) continue;
    for (const a of r.then) {
      if (a.do === 'enableBehavior' && a.enabled && a.behavior === 'goal') for (const gid of resolveSelector(world, a.target)) gatedGoals.add(gid);
    }
  }

  const add = (o: GoalObjective): void => {
    if (objectives.length < PLAYTEST_LIMITS.MAX_OBJECTIVES) objectives.push(o);
  };

  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template) continue;
    const c = behaviorOf(e, 'collectible');
    if (c) {
      const key = baseKey(str(c.params['scoreKey'], 'score') || 'score');
      const t = touchOf(world, e, Math.max(0, num(c.params['margin'], TOUCH_MARGIN_DEFAULT)));
      if (t) {
        const value = num(c.params['value'], 1);
        if (value > 0) producible.set(key, (producible.get(key) ?? 0) + value);
        add({ id: `collect:${id}`, kind: 'collect', label: e.name && e.name !== 'Coin' ? `${e.name} (${id})` : id, entity: id, position: t.center, required: false, key, touch: t, completes: 'destroyed' });
      }
    }
    const gated = gatedGoals.has(id);
    const g = behaviorOf(e, 'goal') ?? (gated ? { params: e.behaviors.find((x) => x.type === 'goal')?.params ?? {} } : undefined);
    if (g) {
      winDefined = true;
      const t = touchOf(world, e, Math.max(0, num(g.params['margin'], TOUCH_MARGIN_DEFAULT)));
      if (t) add({ id: `goal:${id}`, kind: 'goal', label: e.name ? `${e.name} (${id})` : id, entity: id, position: t.center, required: true, touch: t, completes: 'game-over', ...(gated && !behaviorOf(e, 'goal') ? { gated: true } : {}) });
    }
    const plate = behaviorOf(e, 'pressurePlate');
    if (plate) {
      const key = str(plate.params['stateKey'], '');
      if (key && required.has(baseKey(key))) {
        const t = touchOf(world, e, 0);
        if (t) add({ id: `plate:${id}`, kind: 'plate', label: e.name ? `${e.name} (${id})` : id, entity: id, position: t.center, required: true, key: baseKey(key), touch: t, completes: 'state' });
      }
    }
  }

  // Key presses on the chain: the player stands where the rule's conditions hold (a pressure plate) and presses the key.
  for (const r of pressRules.values()) {
    if (r.when.on !== 'key') continue;
    const wanted = new Set(conditionKeys(r.if));
    const plate = objectives.find((o) => o.kind === 'plate' && o.key !== undefined && wanted.has(o.key));
    if (!plate && wanted.size > 0) continue;
        const t: TouchVolume = plate ? plate.touch : { shape: { kind: 'cylinder', half: [1, 1.5, 1] }, center: [world.player.spawn[0], world.player.spawn[1], world.player.spawn[2]], rot: [0, 0, 0, 1], margin: 0 };
    add({ id: `press:${r.id}`, kind: 'press', label: `press ${r.when.key.toUpperCase()}${plate ? ` at ${plate.label}` : ''}`, ...(plate?.entity !== undefined ? { entity: plate.entity } : {}), position: t.center, required: true, touch: t, completes: 'state', pressKey: r.when.key });
  }

  // Zones that rules react to (enter): winning zones and zones feeding a required key.
  const seenZones = new Set<string>();
  for (const r of world.rules) {
    if (!r.enabled || r.when.on !== 'enter') continue;
    const wins = hasAction(r, 'win');
    const feeds = writtenKeys(r.then).some((k) => required.has(k));
    if (!wins && !feeds) continue;
    if (r.when.who !== 'player' && r.when.who !== '*') continue;
    for (const zid of resolveSelector(world, r.when.zone)) {
      if (seenZones.has(zid)) continue;
      seenZones.add(zid);
      const e = world.entities[zid] as Entity;
      if (objectives.some((o) => o.entity === zid && (o.kind === 'goal' || o.kind === 'zone'))) continue;
      const t = touchOf(world, e, 0);
      if (t) add({ id: `zone:${zid}`, kind: 'zone', label: e.name ? `${e.name} (${zid})` : zid, entity: zid, position: t.center, required: true, touch: t, completes: wins ? 'game-over' : 'state' });
    }
  }

  // Characters whose conversation the game depends on (a key bought, a door unlocked, a win granted).
  const talkers: Array<{ e: Entity; plan: NonNullable<ReturnType<typeof planDialogue>> }> = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || !e.npc?.dialogue) continue;
    const plan = planDialogue(e.npc.dialogue, required);
    if (plan) talkers.push({ e, plan });
  }
  if (talkers.length > 0) {
    // What the chosen options need (coins to pay with …) is needed by the game too.
    for (const t of talkers) for (const c of t.plan.needs) required.add(baseKey(c.key));
    for (const t of talkers) if (t.plan.wins) winDefined = true;
  }
  for (const { e, plan } of talkers) {
    const p = pose(world, e.id);
    const spec = e.npc;
    if (!p || !spec) continue;
    const range = spec.talkRange;
    add({
      id: `talk:${e.id}`,
      kind: 'talk',
      label: `talk to ${e.name || e.id}`,
      entity: e.id,
      position: p.position,
      required: true,
      touch: { shape: { kind: 'cylinder', half: [range * 0.7, 1.5, range * 0.7] }, center: p.position, rot: [0, 0, 0, 1], margin: 0 },
      completes: 'state',
      talk: { npc: e.id, name: e.name || e.id, steps: plan.steps, needs: plan.needs, writes: plan.writes, wins: plan.wins, range },
    });
  }

  const noWin = !winDefined;
  for (const o of objectives) {
    if (o.kind === 'collect') o.required = noWin || (o.key !== undefined && required.has(o.key));
  }
  return { objectives, doors, hazards, winDefined, requiredKeys: required, timerSeconds, hasScripts, movers, producible };
}

/** The threshold a winning `state` rule waits for, per key (largest), for repair messages. */
export function winThresholds(world: WorldDoc): Array<{ ruleId: string; key: string; op: string; value: number }> {
  const out: Array<{ ruleId: string; key: string; op: string; value: number }> = [];
  for (const r of world.rules) {
    if (!r.enabled || !hasAction(r, 'win')) continue;
    if (r.when.on === 'state' && typeof r.when.value === 'number') out.push({ ruleId: r.id, key: baseKey(r.when.key), op: r.when.op, value: r.when.value });
  }
  return out;
}

/** Position of an entity in the world (centre), or null. */
export function entityPosition(world: WorldDoc, id: EntityId): Vec3 | null {
  return pose(world, id)?.position ?? null;
}

// ---------------------------------------------------------------------------
// Characters (entity.npc): conversations the game depends on
// ---------------------------------------------------------------------------

/** State keys one dialogue effect writes. */
function effectKeys(fx: DialogueEffect): string[] {
  switch (fx.do) {
    case 'set':
    case 'add':
      return [baseKey(fx.key)];
    case 'give':
    case 'take':
      return [baseKey(fx.item)];
    case 'openDoor':
      return [baseKey(`${fx.target}-unlocked`)];
    default:
      return [];
  }
}

/** Keys the effect list writes, and whether it wins the game. */
function effectsWrite(list: readonly DialogueEffect[], wanted: ReadonlySet<string>): { keys: string[]; wins: boolean } {
  const keys: string[] = [];
  let wins = false;
  for (const fx of list) {
    for (const k of effectKeys(fx)) if (wanted.has(k)) keys.push(k);
    if (fx.do === 'win') wins = true;
  }
  return { keys, wins };
}

/**
 * The shortest sequence of choices through `tree` that makes the conversation
 * write one of `wanted` (or win). Conditions are not evaluated here: they are
 * returned so the bot can wait until they hold. Null when no path does.
 */
export function planDialogue(tree: Dialogue, wanted: ReadonlySet<string>): { steps: string[]; needs: DialogueCondition[]; writes: string[]; wins: boolean } | null {
  type Item = { node: string; steps: string[]; needs: DialogueCondition[] };
  const seen = new Set<string>();
  const queue: Item[] = [{ node: tree.start, steps: [], needs: [] }];
  for (let head = 0; head < queue.length && head < 400; head++) {
    const it = queue[head] as Item;
    if (seen.has(it.node) || !Object.hasOwn(tree.nodes, it.node)) continue;
    seen.add(it.node);
    const node = tree.nodes[it.node];
    if (!node) continue;
    const here = effectsWrite(node.effects, wanted);
    if (here.keys.length > 0 || here.wins) return { steps: it.steps, needs: it.needs, writes: here.keys, wins: here.wins };
    for (const c of node.choices) {
      const fx = effectsWrite(c.effects, wanted);
      const steps = [...it.steps, c.text];
      const needs = [...it.needs, ...c.if];
      if (fx.keys.length > 0 || fx.wins) return { steps, needs, writes: fx.keys, wins: fx.wins };
      if (c.next !== null) queue.push({ node: c.next, steps, needs });
    }
    if (node.choices.length === 0 && node.next !== null) queue.push({ node: node.next, steps: it.steps, needs: it.needs });
  }
  return null;
}

/** True when every condition holds for the values `read` returns. */
export function needsHold(needs: readonly DialogueCondition[], read: (key: string) => unknown): boolean {
  for (const c of needs) {
    const v = read(c.key);
    if (v === undefined || v === null || !compare(v as string | number | boolean, c.op, c.value)) return false;
  }
  return true;
}

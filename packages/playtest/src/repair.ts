/**
 * Self-repair: when the bot finds a defect, propose the smallest patch that
 * removes it, apply it, and run the bot again — until the game passes or a
 * round cap is hit. Every repair is one small batch of ordinary World IR
 * patches (so it is undoable like any other edit) with a one-sentence
 * explanation for the user.
 *
 * What gets repaired (and how):
 * - a pickup/goal that cannot be reached → first a flight of steps (or blocks
 *   to jump) up to what it stands on, kept only when the bot then gets there;
 *   else the platform it sits on moves closer (with whatever stands on it)
 *   when that is a small structure; else the pickup itself moves to the
 *   nearest standable spot, but never one that belongs to something (a
 *   shrine's goal zone stays at the shrine, and the result says why);
 * - a door that nothing can ever unlock → it opens by proximity;
 * - a door that does not react to the player → proximity with a usable radius;
 * - a win target that needs more pickups than exist → the target is lowered;
 * - a game nothing ever ends → a rule that wins when everything is collected;
 * - a player spawning inside geometry → the spawn moves onto open floor;
 * - a countdown that runs out before the bot (given all the time) can finish
 *   → the countdown gets the time that was measured, with a margin;
 * - enemies that bring the player down before the game can be won → they
 *   chase more slowly and hit softer, in a few gentler steps, each one played
 *   by the bot first; only a step the bot then wins is applied.
 *
 * Findings without a safe automatic fix (soft-locks, "stuck", falls) are
 * reported, never "repaired" by guessing.
 */
import { applyPatches, dependencyIndex, rotateVec3, worldTransform, type Entity, type EntityId, type Json, type PatchInput, type Rule, type Vec3, type WorldDoc } from '@aether/core';
import { entityBounds, type Aabb } from '@aether/physics';
import { playtest, walkthrough } from './agent';
import { deriveGoals, winThresholds } from './goals';
import type { Finding, PlaytestOptions, PlaytestReport } from './types';

/** One proposed repair. */
export interface RepairProposal {
  /** Stable id, e.g. `unreachable:high`. */
  id: string;
  code: Finding['code'];
  /** One plain sentence for the user, past tense ("Moved …"). */
  sentence: string;
  patches: PatchInput[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const MAX_SUPPORT_FOOTPRINT = 8;
const MAX_RIDERS = 12;
const NEAR_GAP = 1.2;

function size(b: Aabb): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

function solid(e: Entity): boolean {
  return !e.template && e.physics !== undefined && !e.physics.sensor && e.physics.collider !== 'none' && e.shape.kind !== 'none' && e.shape.kind !== 'scatter';
}

/** The highest solid entity whose top lies under `p` (within reach), excluding `skip`. */
function supportOf(world: WorldDoc, p: Readonly<Vec3>, skip: EntityId): { id: EntityId; bounds: Aabb } | null {
  let best: { id: EntityId; bounds: Aabb } | null = null;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (id === skip || !solid(e) || e.physics?.body === 'dynamic') continue;
    const b = entityBounds(world, id);
    if (!b) continue;
    if (p[0] < b.min[0] - 0.3 || p[0] > b.max[0] + 0.3 || p[2] < b.min[2] - 0.3 || p[2] > b.max[2] + 0.3) continue;
    if (b.max[1] > p[1] + 0.6 || b.max[1] < p[1] - 8) continue;
    if (!best || b.max[1] > best.bounds.max[1]) best = { id, bounds: b };
  }
  return best;
}

function patchPosition(id: EntityId, position: Vec3): PatchInput {
  return { op: 'update', id, set: { transform: { position: [r2(position[0]), r2(position[1]), r2(position[2])] } } };
}

function label(world: WorldDoc, id: EntityId): string {
  const e = world.entities[id];
  return e && e.name && e.name !== id ? `${e.name} (${id})` : id;
}

function repairUnreachable(world: WorldDoc, f: Finding): RepairProposal | null {
  const id = f.entities[0];
  const pos = f.position;
  const d = f.data;
  if (!id || !pos || !d || typeof d['nodeX'] !== 'number' || typeof d['nodeY'] !== 'number' || typeof d['nodeZ'] !== 'number') return null;
  const e = world.entities[id];
  if (!e || e.parent !== null || e.locked) return null;
  const node: Vec3 = [d['nodeX'], d['nodeY'], d['nodeZ']];
  const support = supportOf(world, pos, id);
  if (support && !(world.entities[support.id] as Entity).locked) {
    const sb = support.bounds;
    const sz = size(sb);
    const sup = world.entities[support.id] as Entity;
    if (sz[0] <= MAX_SUPPORT_FOOTPRINT && sz[2] <= MAX_SUPPORT_FOOTPRINT && sup.parent === null && sup.physics?.body !== 'kinematic') {
      const riders: EntityId[] = [];
      for (const rid in world.entities) {
        const r = world.entities[rid] as Entity;
        if (rid === support.id || r.template || r.parent !== null) continue;
        const p = r.transform.position;
        if (p[0] >= sb.min[0] - 0.2 && p[0] <= sb.max[0] + 0.2 && p[2] >= sb.min[2] - 0.2 && p[2] <= sb.max[2] + 0.2 && p[1] >= sb.max[1] - 0.3 && p[1] <= sb.max[1] + 3.5) riders.push(rid);
      }
      if (riders.length <= MAX_RIDERS && !riders.some((rid) => (world.entities[rid] as Entity).locked)) {
        const cx = (sb.min[0] + sb.max[0]) / 2;
        const cz = (sb.min[2] + sb.max[2]) / 2;
        const toNode = [node[0] - cx, node[2] - cz];
        const dist = Math.hypot(toNode[0] as number, toNode[1] as number);
        const ux = dist > 1e-6 ? (toNode[0] as number) / dist : 0;
        const uz = dist > 1e-6 ? (toNode[1] as number) / dist : 0;
        const extent = Math.abs(ux) * (sz[0] / 2) + Math.abs(uz) * (sz[2] / 2);
        const move = Math.max(0, dist - extent - NEAR_GAP);
        const dy = Math.min(0, Math.max(-60, node[1] + 0.9 - sb.max[1]));
        if (move > 0.05 || dy < -0.05) {
          const delta: Vec3 = [ux * move, dy, uz * move];
          const patches: PatchInput[] = [support.id, ...riders].map((eid) => {
            const p = (world.entities[eid] as Entity).transform.position;
            return patchPosition(eid, [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]]);
          });
          const how = move > 0.05 && dy < -0.05 ? 'closer and lower' : move > 0.05 ? 'closer' : 'lower';
          const what = riders.length > 0 ? `${label(world, support.id)} with ${riders.length === 1 ? label(world, riders[0] as EntityId) : `${riders.length} things`} on it` : label(world, support.id);
          return { id: `unreachable:${id}`, code: 'unreachable_objective', sentence: `Moved ${what} ${how} so ${label(world, id)} can be reached.`, patches };
        }
      }
    }
  }
  // A goal that belongs to something (the shrine's goal zone) stays with it: it is made reachable instead
  // (steps up to it, see `stepsRepair`), never moved away from what it stands for.
  if (dependencyIndex(world).ownerOf(id)) return null;
  // Otherwise bring the objective itself down to the nearest place the player can stand.
  const above = support ? Math.min(1.5, Math.max(0.4, pos[1] - support.bounds.max[1])) : Math.min(1.5, Math.max(0.4, pos[1]));
  const to: Vec3 = [node[0], node[1] + above, node[2]];
  return { id: `unreachable:${id}:self`, code: 'unreachable_objective', sentence: `Moved ${label(world, id)} to ${r2(to[0])},${r2(to[2])}, where the player can reach it.`, patches: [patchPosition(id, to)] };
}

function repairDoorLocked(world: WorldDoc, f: Finding): RepairProposal | null {
  const door = f.entities[0];
  const d = f.data;
  if (!door || !d) return null;
  const e = world.entities[door];
  if (!e || e.locked) return null;
  // Only when nothing can ever unlock it; a door whose key is merely out of reach is fixed by moving the key.
  if (typeof d['producers'] === 'number' && d['producers'] > 0) return null;
  const behaviors = e.behaviors.map((b) => (b.type === 'door' ? { ...b, params: { ...b.params, trigger: 'proximity', radius: Math.max(typeof b.params['radius'] === 'number' ? (b.params['radius'] as number) : 0, 3) } } : b));
  return { id: `door:${door}`, code: 'door_locked', sentence: `Made ${label(world, door)} open when you walk up to it, because nothing in the game could unlock it.`, patches: [{ op: 'update', id: door, set: { behaviors: behaviors as unknown as Json } }] };
}

function repairDoorStuck(world: WorldDoc, f: Finding): RepairProposal | null {
  const door = f.entities[0];
  if (!door) return null;
  const e = world.entities[door];
  if (!e || e.locked) return null;
  const behaviors = e.behaviors.map((b) => (b.type === 'door' ? { ...b, params: { ...b.params, trigger: 'proximity', radius: 3.5, who: 'player' } } : b));
  return { id: `door:${door}`, code: 'door_stuck', sentence: `Made ${label(world, door)} open as soon as you step up to it.`, patches: [{ op: 'update', id: door, set: { behaviors: behaviors as unknown as Json } }] };
}

function repairThreshold(world: WorldDoc, f: Finding): RepairProposal | null {
  const d = f.data;
  if (!d || typeof d['ruleId'] !== 'string' || typeof d['available'] !== 'number' || typeof d['needed'] !== 'number' || typeof d['key'] !== 'string') return null;
  const available = d['available'];
  if (available <= 0) return null;
  const th = winThresholds(world).find((t) => t.ruleId === d['ruleId']);
  if (!th) return null;
  const rule = world.rules.find((r) => r.id === d['ruleId']);
  if (!rule) return null;
  return {
    id: `threshold:${th.ruleId}`,
    code: 'unwinnable',
    sentence: `Lowered the win target from ${th.value} to ${available}, because only ${available} ${th.key === 'score' ? 'pickups' : `"${th.key}"`} can ever be collected.`,
    patches: [{ op: 'updateRule', id: th.ruleId, set: { when: { value: available } } }],
  };
}

function repairNoWin(world: WorldDoc): RepairProposal | null {
  const goals = deriveGoals(world);
  const totals = new Map<string, number>();
  for (const o of goals.objectives) if (o.kind === 'collect' && o.key) totals.set(o.key, (totals.get(o.key) ?? 0) + 1);
  let key = '';
  let n = 0;
  for (const [k, v] of totals) {
    if (v > n) {
      key = k;
      n = v;
    }
  }
  if (!key || n === 0) return null;
  const id = world.rules.some((r) => r.id === 'win-all') ? 'win-all-collected' : 'win-all';
  const rule: Rule = {
    id,
    description: 'Win when every pickup has been collected',
    when: { on: 'state', key, op: '>=', value: n },
    if: [],
    then: [{ do: 'sound', sound: 'win' }, { do: 'win', text: 'You collected everything!' }],
    once: true,
    enabled: true,
  };
  return { id: 'no-win', code: 'no_win_condition', sentence: `Added a win rule: you win once all ${n} pickups are collected.`, patches: [{ op: 'addRule', rule }] };
}

/** Door leaf ids of the building compiler: `<building>-l<level>-d<index>-leaf`. */
const LEAF_ID = /^(.*)-l(\d+)-d(\d+)-leaf$/;

function numParam(v: Json | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A building door too narrow for the player: widen the door, its frame, the
 * opening cut in the wall and the building plan it was compiled from, so the
 * plan and the walls stay in step.
 */
function repairNarrowDoor(world: WorldDoc, f: Finding): RepairProposal | null {
  const leafId = f.entities[0];
  if (!leafId) return null;
  const m = LEAF_ID.exec(leafId);
  const leaf = world.entities[leafId];
  if (!m || !leaf || leaf.locked || leaf.shape.kind !== 'procedural') return null;
  const frame = world.entities[leafId.slice(0, -'-leaf'.length)];
  const wall = leaf.arch?.wall !== undefined ? world.entities[leaf.arch.wall] : undefined;
  if (!frame || frame.shape.kind !== 'procedural' || !wall || wall.shape.kind !== 'procedural' || wall.locked) return null;
  const oldW = numParam(frame.shape.params['width']);
  const leafW = numParam(leaf.shape.params['width']);
  const openings = wall.shape.params['openings'];
  if (oldW === null || leafW === null || !Array.isArray(openings)) return null;
  const newW = Math.max(0.9, r2(oldW + 0.1));
  // Which opening of the wall is this door? The door-kind one nearest its position along the wall.
  let doorLocal = 0;
  try {
    const wt = worldTransform(world, wall.id);
    const dt = worldTransform(world, leafId);
    const inv: [number, number, number, number] = [-wt.quaternion[0], -wt.quaternion[1], -wt.quaternion[2], wt.quaternion[3]];
    doorLocal = rotateVec3(inv, [dt.position[0] - wt.position[0], dt.position[1] - wt.position[1], dt.position[2] - wt.position[2]])[0];
  } catch {
    return null;
  }
  let best = -1;
  let bestD = Infinity;
  openings.forEach((o, i) => {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return;
    const rec = o as Record<string, Json>;
    if (rec['kind'] !== 'door' || numParam(rec['width']) === null || numParam(rec['offset']) === null) return;
    if (Math.abs((rec['width'] as number) - oldW) > 1e-3) return;
    const d = Math.abs((rec['offset'] as number) - doorLocal);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0 || bestD > 0.25) return null;
  const newOpenings = openings.map((o, i) => (i === best ? { ...(o as Record<string, Json>), width: newW } : o));
  const patches: PatchInput[] = [
    { op: 'update', id: wall.id, set: { shape: { params: { openings: newOpenings as Json } } } },
    { op: 'update', id: frame.id, set: { shape: { params: { width: newW } } } },
    { op: 'update', id: leafId, set: { shape: { params: { width: r2(leafW + (newW - oldW)) } } } },
  ];
  // Keep the building plan in step so a later re-compile does not undo the repair.
  const building = world.entities[m[1] as string];
  const plan = building?.arch?.plan;
  if (building && !building.locked && plan !== null && typeof plan === 'object' && !Array.isArray(plan) && Array.isArray((plan as Record<string, Json>)['levels'])) {
    const levels = structuredClone((plan as Record<string, Json>)['levels']) as Json[];
    const level = levels[Number(m[2])];
    const doors = level !== null && typeof level === 'object' && !Array.isArray(level) ? (level as Record<string, Json>)['doors'] : undefined;
    const door = Array.isArray(doors) ? doors[Number(m[3])] : undefined;
    if (door !== undefined && door !== null && typeof door === 'object' && !Array.isArray(door) && numParam((door as Record<string, Json>)['width']) !== null) {
      (door as Record<string, Json>)['width'] = newW;
      patches.push({ op: 'update', id: building.id, set: { arch: { plan: { levels } } } });
    }
  }
  const where = leaf.arch?.room !== undefined ? world.entities[leaf.arch.room] : undefined;
  const name = where?.name && where.name !== where.id ? `the ${where.name.toLowerCase()} door` : `door ${leafId}`;
  return { id: `narrow:${leafId}`, code: 'door_blocked', sentence: `Widened ${name} from ${r2(oldW)} m to ${newW} m so the player's body fits through.`, patches };
}

function repairSpawn(world: WorldDoc, f: Finding): RepairProposal | null {
  const inside = f.entities[0];
  const spawn = world.player.spawn;
  if (inside) {
    const b = entityBounds(world, inside);
    if (b && !(world.entities[inside] as Entity).locked) {
      const to: Vec3 = [spawn[0], b.max[1] + 0.3, spawn[2]];
      return { id: 'spawn', code: 'spawn_blocked', sentence: `Moved the player start on top of ${label(world, inside)}, out of the solid.`, patches: [{ op: 'setPlayer', set: { spawn: [r2(to[0]), r2(to[1]), r2(to[2])] } }] };
    }
  }
  // No floor under the spawn: put it on the nearest top surface.
  let best: { id: EntityId; top: Vec3; d: number } | null = null;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (!solid(e) || e.physics?.body === 'dynamic') continue;
    const b = entityBounds(world, id);
    if (!b) continue;
    const sz = size(b);
    if (sz[0] < 1.5 || sz[2] < 1.5) continue;
    const c: Vec3 = [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];
    const dist = Math.hypot(c[0] - spawn[0], c[2] - spawn[2]);
    if (!best || dist < best.d) best = { id, top: c, d: dist };
  }
  if (!best) return null;
  return { id: 'spawn', code: 'spawn_blocked', sentence: `Moved the player start onto ${label(world, best.id)}, where there is floor to stand on.`, patches: [{ op: 'setPlayer', set: { spawn: [r2(best.top[0]), r2(best.top[1] + 0.3), r2(best.top[2])] } }] };
}

/**
 * Propose repairs for the errors of a report, most important first. Pure:
 * it reads the document and the report, nothing else.
 */
export function proposeRepairs(world: WorldDoc, report: PlaytestReport): RepairProposal[] {
  const out: RepairProposal[] = [];
  const order: Array<Finding['code']> = ['spawn_blocked', 'door_blocked', 'door_stuck', 'door_locked', 'unwinnable', 'unreachable_objective', 'no_win_condition'];
  // Tight doors the bot squeezed through are cautions, not defects; they are widened only when they blocked something.
  const errors = report.findings.filter((f) => f.severity === 'error');
  for (const code of order) {
    for (const f of errors) {
      if (f.code !== code) continue;
      let p: RepairProposal | null = null;
      switch (code) {
        case 'spawn_blocked': p = repairSpawn(world, f); break;
        case 'door_blocked': p = repairNarrowDoor(world, f); break;
        case 'door_stuck': p = repairDoorStuck(world, f); break;
        case 'door_locked': p = repairDoorLocked(world, f); break;
        case 'unwinnable': p = repairThreshold(world, f); break;
        case 'unreachable_objective': p = repairUnreachable(world, f); break;
        case 'no_win_condition': p = repairNoWin(world); break;
        default: break;
      }
      if (p && !out.some((x) => x.id === p.id)) out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Countdown repair
// ---------------------------------------------------------------------------

/** The world-state key of a countdown that loses the game at zero, with its start value. */
export function countdownOf(world: WorldDoc): { key: string; start: number; ruleId: string } | null {
  for (const r of world.rules) {
    if (!r.enabled || !r.then.some((a) => a.do === 'lose') || r.when.on !== 'state') continue;
    if (r.when.op !== '<=' && r.when.op !== '<' && r.when.op !== '==') continue;
    const key = r.when.key;
    const start = world.state[key];
    if (typeof start !== 'number' || start <= 0) continue;
    const ticks = world.rules.some((t) => t.enabled && t.then.some((a) => a.do === 'add' && a.key === key && a.amount < 0));
    if (ticks) return { key, start, ruleId: r.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** One round of {@link selfRepair}. */
export interface RepairRound {
  report: PlaytestReport;
  /** The repair applied after this round (null when the round passed or nothing could be done). */
  repair: RepairProposal | null;
}

/** Result of {@link selfRepair}. */
export interface SelfRepairResult {
  /** The world after all applied repairs. */
  world: WorldDoc;
  /** The last report (with a replay trace when recording was on). */
  report: PlaytestReport;
  rounds: RepairRound[];
  /** Repairs that were applied, in order. */
  applied: RepairProposal[];
  /** The world passes the bot now. */
  passed: boolean;
  /** One plain sentence about what happened. */
  sentence: string;
}

/** Options of {@link selfRepair}. */
export interface SelfRepairOptions {
  /** Most repair rounds (default 4, max 8). */
  maxRounds?: number;
  /** Play a world (default: the in-process bot). The studio runs it in a worker. */
  run?: (world: WorldDoc, round: number) => Promise<PlaytestReport>;
  /**
   * Apply a repair (default: `applyPatches`). Return the new world, or null
   * when it could not be applied. The studio commits through its history.
   */
  apply?: (proposal: RepairProposal, world: WorldDoc) => Promise<WorldDoc | null> | WorldDoc | null;
  /** Called after each round. */
  onRound?: (round: RepairRound, index: number) => void;
  /** Options of the default runner. */
  playtest?: PlaytestOptions;
  /** Walk a building instead of playing a game (default: the default runner picks by the report kind you pass). */
  kind?: 'game' | 'walkthrough';
  signal?: AbortSignal;
}

/** Strip the heavy trace from a report kept in the round list. */
function slim(report: PlaytestReport): PlaytestReport {
  const { trace: _trace, ...rest } = report;
  return rest;
}

/**
 * Play, repair, play again — until the bot wins or the round cap is hit.
 * The last (passing) run is returned with its replay trace.
 */
export async function selfRepair(world: WorldDoc, opts: SelfRepairOptions = {}): Promise<SelfRepairResult> {
  const maxRounds = Math.max(1, Math.min(8, Math.round(opts.maxRounds ?? 4)));
  const bot = opts.kind === 'walkthrough' ? walkthrough : playtest;
  const run = opts.run ?? ((w: WorldDoc) => bot(w, { ...opts.playtest, ...(opts.signal ? { signal: opts.signal } : {}) }));
  const apply =
    opts.apply ??
    ((p: RepairProposal, w: WorldDoc): WorldDoc | null => {
      const r = applyPatches(w, p.patches);
      return r.errors.length === 0 && r.applied.length === p.patches.length ? r.world : null;
    });
  let current = world;
  const rounds: RepairRound[] = [];
  const applied: RepairProposal[] = [];
  const tried = new Set<string>();
  let report = await run(current, 0);
  for (let i = 0; i < maxRounds; i++) {
    if (report.status === 'passed' || report.status === 'unsupported') {
      const round: RepairRound = { report: slim(report), repair: null };
      rounds.push(round);
      opts.onRound?.(round, i);
      break;
    }
    const proposals = proposeRepairs(current, report).filter((p) => !tried.has(p.id + JSON.stringify(p.patches)));
    let proposal: RepairProposal | null = proposals[0] ?? null;
    // An objective out of reach keeps its place when steps can bring the player to it.
    // (A platform brought closer keeps the objective on it; moving the objective itself is the last resort.)
    if (!proposal || proposal.id.endsWith(':self')) proposal = (await stepsRepair(current, report, run, tried)) ?? proposal;
    if (!proposal) proposal = await countdownRepair(current, report, run);
    if (!proposal) proposal = await enemyRepair(current, report, run, tried);
    let next: WorldDoc | null = null;
    if (proposal) {
      tried.add(proposal.id + JSON.stringify(proposal.patches));
      next = await apply(proposal, current);
    }
    const round: RepairRound = { report: slim(report), repair: next ? proposal : null };
    rounds.push(round);
    opts.onRound?.(round, i);
    if (!next || !proposal) break;
    applied.push(proposal);
    current = next;
    report = await run(current, i + 1);
  }
  const passed = report.status === 'passed';
  return { world: current, report, rounds, applied, passed, sentence: sentenceOf(passed, applied, report, current) };
}

async function countdownRepair(world: WorldDoc, report: PlaytestReport, run: (w: WorldDoc, round: number) => Promise<PlaytestReport>): Promise<RepairProposal | null> {
  if (!report.findings.some((f) => f.code === 'lost')) return null;
  const cd = countdownOf(world);
  if (!cd) return null;
  // Give the bot all the time it wants and measure what it needed.
  const roomy: WorldDoc = structuredClone(world);
  roomy.state[cd.key] = Math.min(100_000, Math.max(cd.start * 10, 600));
  const measured = await run(roomy, -1);
  if (measured.status !== 'passed') return null;
  const needed = measured.seconds;
  const start = Math.ceil(needed * 1.5 + 5);
  if (start <= cd.start) return null;
  return {
    id: `countdown:${cd.key}`,
    code: 'lost',
    sentence: `Raised the time limit from ${Math.round(cd.start)} s to ${start} s, because the bot needed ${Math.ceil(needed)} s to finish.`,
    patches: [{ op: 'setState', key: cd.key, value: start }],
  };
}

/** Hostile NPCs (they go after the player: named enemies, or guard / predator / sentinel archetypes) of a world. */
function hostileNpcs(world: WorldDoc): Array<[EntityId, NonNullable<Entity['npc']>]> {
  const out: Array<[EntityId, NonNullable<Entity['npc']>]> = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    const n = e.npc;
    if (e.template || !n || !(n.enemies.includes('player') || n.archetype === 'predator' || n.archetype === 'guard' || n.archetype === 'sentinel')) continue;
    out.push([id, n]);
  }
  return out;
}

/** Gentler steps tried in order: chase speed as a share of the player's speed, and the share of the damage kept. */
const ENEMY_STEPS: ReadonlyArray<{ chase: number; damage: number }> = [
  { chase: 0.6, damage: 0.5 },
  { chase: 0.5, damage: 0.5 },
  { chase: 0.45, damage: 0.34 },
];

/** Patches that slow every hostile NPC to `chase` x the player's speed and keep `damage` of its attack. */
function enemyPatches(world: WorldDoc, step: { chase: number; damage: number }): PatchInput[] {
  const player = Math.max(1, world.player.moveSpeed);
  const patches: PatchInput[] = [];
  for (const [id, npc] of hostileNpcs(world)) {
    const runSpeed = r2(Math.min(npc.runSpeed, player * step.chase));
    const speed = r2(Math.min(npc.speed, runSpeed * 0.6));
    const attack = npc.attack ? { ...npc.attack, damage: Math.max(1, Math.round(npc.attack.damage * step.damage)) } : undefined;
    if (runSpeed === npc.runSpeed && speed === npc.speed && (!attack || attack.damage === npc.attack?.damage)) continue;
    patches.push({ op: 'update', id, set: { npc: { ...npc, runSpeed, speed, ...(attack ? { attack } : {}) } as unknown as Json } });
  }
  return patches;
}

/**
 * The game was lost and hostile NPCs exist: try gentler enemies (slower chase, softer hits) one step at a time and
 * apply the first step the bot then wins. Nothing changes when no step helps (the loss stays reported).
 */
async function enemyRepair(world: WorldDoc, report: PlaytestReport, run: (w: WorldDoc, round: number) => Promise<PlaytestReport>, tried: ReadonlySet<string>): Promise<RepairProposal | null> {
  if (!report.findings.some((f) => f.code === 'lost')) return null;
  const hostile = hostileNpcs(world);
  if (hostile.length === 0) return null;
  for (const step of ENEMY_STEPS) {
    const patches = enemyPatches(world, step);
    if (patches.length === 0) continue;
    const id = `enemies:${step.chase}:${step.damage}`;
    if (tried.has(id + JSON.stringify(patches))) continue;
    const trial = applyPatches(world, patches);
    if (trial.errors.length > 0) return null;
    const measured = await run(trial.world, -1);
    if (measured.status !== 'passed') continue;
    const [firstId, first] = hostile[0] as [EntityId, NonNullable<Entity['npc']>];
    const group = /s$/.test(first.faction) ? first.faction.replace(/-/g, ' ') : hostile.every(([, n]) => n.role === first.role) && /^[a-z]+$/i.test(first.role) && !/s$/.test(first.role) ? `${first.role}s` : 'enemies';
    const who = hostile.length === 1 ? label(world, firstId) : `the ${group}`;
    const to = r2(Math.min(first.runSpeed, Math.max(1, world.player.moveSpeed) * step.chase));
    return {
      id,
      code: 'lost',
      sentence: `Made ${who} slower (chase ${r2(first.runSpeed)} → ${to} m/s) and softer-hitting, because they brought the player down before the game could be won.`,
      patches,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Steps up to an objective
// ---------------------------------------------------------------------------

/** Step kinds tried in order: walkable stairs, then blocks to jump up (both within the bot's and the player's reach). */
const STEP_KINDS: ReadonlyArray<{ riser: number; tread: number; width: number; word: string }> = [
  { riser: 0.25, tread: 0.42, width: 1.6, word: 'steps' },
  { riser: 0.6, tread: 0.9, width: 1.8, word: 'blocks to jump up' },
];
/** Most steps in one flight (a 6 m climb in stairs, 15 m in blocks). */
const MAX_STEPS = 24;

/** Where a ray from the support's centre toward `to` leaves its footprint (a cylinder by its radius, else its box). */
function edgeToward(world: WorldDoc, support: { id: EntityId; bounds: Aabb }, to: Readonly<Vec3>): { edge: [number, number]; dir: [number, number] } | null {
  const b = support.bounds;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const dx = to[0] - cx;
  const dz = to[2] - cz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uz = dz / len;
  const hx = (b.max[0] - b.min[0]) / 2;
  const hz = (b.max[2] - b.min[2]) / 2;
  const e = world.entities[support.id] as Entity;
  const round = e.shape.kind === 'primitive' && (e.shape.primitive === 'cylinder' || e.shape.primitive === 'sphere' || e.shape.primitive === 'cone');
  const t = round ? Math.min(hx, hz) : Math.min(Math.abs(ux) > 1e-6 ? hx / Math.abs(ux) : Infinity, Math.abs(uz) > 1e-6 ? hz / Math.abs(uz) : Infinity);
  return { edge: [cx + ux * t, cz + uz * t], dir: [ux, uz] };
}

/** One flight of steps from the floor at `node` up to the top of `support`, on the side facing the node. */
function flightPatches(world: WorldDoc, objective: EntityId, support: { id: EntityId; bounds: Aabb }, node: Readonly<Vec3>, kind: (typeof STEP_KINDS)[number]): PatchInput[] | null {
  const top = support.bounds.max[1];
  const rise = top - node[1];
  if (rise <= 0.4) return null;
  const n = Math.max(1, Math.round(rise / kind.riser) - 1);
  if (n > MAX_STEPS) return null;
  const riser = rise / (n + 1);
  const side = edgeToward(world, support, node);
  if (!side) return null;
  const [ux, uz] = side.dir;
  const yaw = r2((Math.atan2(ux, uz) * 180) / Math.PI);
  const base = node[1] - 1;
  const patches: PatchInput[] = [];
  for (let k = 0; k < n; k++) {
    const stepTop = top - (k + 1) * riser;
    const d = kind.tread * (k + 0.5) - 0.05;
    const h = stepTop - base;
    patches.push({
      op: 'add',
      entity: {
        id: `${objective}-steps-${k + 1}`,
        name: k === 0 ? `Steps to ${(world.entities[objective] as Entity).name || objective}` : '',
        attachedTo: support.id,
        tags: ['steps'],
        transform: { position: [r2(side.edge[0] + ux * d), r2(base + h / 2), r2(side.edge[1] + uz * d)], rotation: [0, yaw, 0], scale: [1, 1, 1] },
        shape: { kind: 'primitive', primitive: 'box', size: [kind.width, r2(h), kind.tread] },
        material: { preset: 'stone', color: '#8d8a84' },
        physics: { body: 'static' },
      },
    });
  }
  return patches;
}

/**
 * An objective sits on something the player cannot climb (a summit 3 m above its last terrace): build a flight
 * of steps (or blocks to jump) from the nearest place the player reaches up to it, keeping the objective where
 * it is, and keep the flight only when the bot then reaches it. Null when no flight helps; the objective is then
 * moved only when it belongs to nothing (see {@link repairUnreachable}).
 */
async function stepsRepair(world: WorldDoc, report: PlaytestReport, run: (w: WorldDoc, round: number) => Promise<PlaytestReport>, tried: ReadonlySet<string>): Promise<RepairProposal | null> {
  for (const f of report.findings) {
    if (f.code !== 'unreachable_objective' || f.severity !== 'error') continue;
    const id = f.entities[0];
    const pos = f.position;
    const d = f.data;
    if (!id || !pos || !d || typeof d['nodeX'] !== 'number' || typeof d['nodeY'] !== 'number' || typeof d['nodeZ'] !== 'number') continue;
    if (!Object.hasOwn(world.entities, id) || Object.hasOwn(world.entities, `${id}-steps-1`)) continue;
    const node: Vec3 = [d['nodeX'], d['nodeY'], d['nodeZ']];
    const support = supportOf(world, pos, id);
    if (!support) continue;
    for (const kind of STEP_KINDS) {
      const patches = flightPatches(world, id, support, node, kind);
      if (!patches) continue;
      const pid = `steps:${id}:${kind.riser}`;
      if (tried.has(pid + JSON.stringify(patches))) continue;
      const trial = applyPatches(world, patches);
      if (trial.errors.length > 0) continue;
      const measured = await run(trial.world, -1);
      const still = measured.findings.some((g) => g.code === 'unreachable_objective' && g.entities[0] === id);
      if (still) continue;
      return { id: pid, code: 'unreachable_objective', sentence: `Built ${patches.length} ${kind.word} up ${label(world, support.id)} so ${label(world, id)} can be reached where it is.`, patches };
    }
  }
  return null;
}

const lowerFirst = (t: string): string => t.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());

/** Objectives left out of reach because they belong to something: say so instead of moving them. */
function heldNote(world: WorldDoc, report: PlaytestReport): string {
  const deps = dependencyIndex(world);
  const out: string[] = [];
  for (const f of report.findings) {
    const id = f.entities[0];
    if (f.code !== 'unreachable_objective' || f.severity !== 'error' || !id || !Object.hasOwn(world.entities, id)) continue;
    const owner = deps.ownerOf(id);
    if (!owner) continue;
    out.push(`I left ${label(world, id)} at ${label(world, owner.owner)}, where it belongs, instead of moving it to where the bot can get; steps did not get the bot there either. Add a way up (a ramp, stairs or a lift) or lower what it stands on.`);
    if (out.length >= 2) break;
  }
  return out.length > 0 ? ` ${out.join(' ')}` : '';
}

function sentenceOf(passed: boolean, applied: readonly RepairProposal[], report: PlaytestReport, world: WorldDoc): string {
  if (passed && applied.length === 0) return report.summary;
  if (passed) return `I fixed ${applied.length === 1 ? 'a problem' : `${applied.length} problems`} so ${report.kind === 'walkthrough' ? 'every room can be reached' : 'it can be won'}: ${applied.map((a) => lowerFirst(a.sentence)).join('; ')}.`;
  const tried = applied.length > 0 ? ` I tried: ${applied.map((a) => lowerFirst(a.sentence)).join('; ')}.` : '';
  return `${report.summary}${tried}${heldNote(world, report)}`;
}

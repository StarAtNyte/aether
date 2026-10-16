/**
 * Self-repair: when the bot finds a defect, propose the smallest patch that
 * removes it, apply it, and run the bot again — until the game passes or a
 * round cap is hit. Every repair is one small batch of ordinary World IR
 * patches (so it is undoable like any other edit) with a one-sentence
 * explanation for the user.
 *
 * What gets repaired (and how):
 * - a pickup/goal that cannot be reached → the platform it sits on moves
 *   closer (with whatever stands on it) when that is a small structure,
 *   otherwise the pickup itself moves to the nearest standable spot;
 * - a door that nothing can ever unlock → it opens by proximity;
 * - a door that does not react to the player → proximity with a usable radius;
 * - a win target that needs more pickups than exist → the target is lowered;
 * - a game nothing ever ends → a rule that wins when everything is collected;
 * - a player spawning inside geometry → the spawn moves onto open floor;
 * - a countdown that runs out before the bot (given all the time) can finish
 *   → the countdown gets the time that was measured, with a margin.
 *
 * Findings without a safe automatic fix (soft-locks, "stuck", falls) are
 * reported, never "repaired" by guessing.
 */
import { applyPatches, rotateVec3, worldTransform } from '@aether/core';
import { entityBounds } from '@aether/physics';
import { playtest, walkthrough } from './agent';
import { deriveGoals, winThresholds } from './goals';
const r2 = (v) => Math.round(v * 100) / 100;
const MAX_SUPPORT_FOOTPRINT = 8;
const MAX_RIDERS = 12;
const NEAR_GAP = 1.2;
function size(b) {
    return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}
function solid(e) {
    return !e.template && e.physics !== undefined && !e.physics.sensor && e.physics.collider !== 'none' && e.shape.kind !== 'none' && e.shape.kind !== 'scatter';
}
/** The highest solid entity whose top lies under `p` (within reach), excluding `skip`. */
function supportOf(world, p, skip) {
    let best = null;
    for (const id in world.entities) {
        const e = world.entities[id];
        if (id === skip || !solid(e) || e.physics?.body === 'dynamic')
            continue;
        const b = entityBounds(world, id);
        if (!b)
            continue;
        if (p[0] < b.min[0] - 0.3 || p[0] > b.max[0] + 0.3 || p[2] < b.min[2] - 0.3 || p[2] > b.max[2] + 0.3)
            continue;
        if (b.max[1] > p[1] + 0.6 || b.max[1] < p[1] - 8)
            continue;
        if (!best || b.max[1] > best.bounds.max[1])
            best = { id, bounds: b };
    }
    return best;
}
function patchPosition(id, position) {
    return { op: 'update', id, set: { transform: { position: [r2(position[0]), r2(position[1]), r2(position[2])] } } };
}
function label(world, id) {
    const e = world.entities[id];
    return e && e.name && e.name !== id ? `${e.name} (${id})` : id;
}
function repairUnreachable(world, f) {
    const id = f.entities[0];
    const pos = f.position;
    const d = f.data;
    if (!id || !pos || !d || typeof d['nodeX'] !== 'number' || typeof d['nodeY'] !== 'number' || typeof d['nodeZ'] !== 'number')
        return null;
    const e = world.entities[id];
    if (!e || e.parent !== null || e.locked)
        return null;
    const node = [d['nodeX'], d['nodeY'], d['nodeZ']];
    const support = supportOf(world, pos, id);
    if (support && !world.entities[support.id].locked) {
        const sb = support.bounds;
        const sz = size(sb);
        const sup = world.entities[support.id];
        if (sz[0] <= MAX_SUPPORT_FOOTPRINT && sz[2] <= MAX_SUPPORT_FOOTPRINT && sup.parent === null && sup.physics?.body !== 'kinematic') {
            const riders = [];
            for (const rid in world.entities) {
                const r = world.entities[rid];
                if (rid === support.id || r.template || r.parent !== null)
                    continue;
                const p = r.transform.position;
                if (p[0] >= sb.min[0] - 0.2 && p[0] <= sb.max[0] + 0.2 && p[2] >= sb.min[2] - 0.2 && p[2] <= sb.max[2] + 0.2 && p[1] >= sb.max[1] - 0.3 && p[1] <= sb.max[1] + 3.5)
                    riders.push(rid);
            }
            if (riders.length <= MAX_RIDERS && !riders.some((rid) => world.entities[rid].locked)) {
                const cx = (sb.min[0] + sb.max[0]) / 2;
                const cz = (sb.min[2] + sb.max[2]) / 2;
                const toNode = [node[0] - cx, node[2] - cz];
                const dist = Math.hypot(toNode[0], toNode[1]);
                const ux = dist > 1e-6 ? toNode[0] / dist : 0;
                const uz = dist > 1e-6 ? toNode[1] / dist : 0;
                const extent = Math.abs(ux) * (sz[0] / 2) + Math.abs(uz) * (sz[2] / 2);
                const move = Math.max(0, dist - extent - NEAR_GAP);
                const dy = Math.min(0, Math.max(-60, node[1] + 0.9 - sb.max[1]));
                if (move > 0.05 || dy < -0.05) {
                    const delta = [ux * move, dy, uz * move];
                    const patches = [support.id, ...riders].map((eid) => {
                        const p = world.entities[eid].transform.position;
                        return patchPosition(eid, [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]]);
                    });
                    const how = move > 0.05 && dy < -0.05 ? 'closer and lower' : move > 0.05 ? 'closer' : 'lower';
                    const what = riders.length > 0 ? `${label(world, support.id)} with ${riders.length === 1 ? label(world, riders[0]) : `${riders.length} things`} on it` : label(world, support.id);
                    return { id: `unreachable:${id}`, code: 'unreachable_objective', sentence: `Moved ${what} ${how} so ${label(world, id)} can be reached.`, patches };
                }
            }
        }
    }
    // Otherwise bring the objective itself down to the nearest place the player can stand.
    const above = support ? Math.min(1.5, Math.max(0.4, pos[1] - support.bounds.max[1])) : Math.min(1.5, Math.max(0.4, pos[1]));
    const to = [node[0], node[1] + above, node[2]];
    return { id: `unreachable:${id}`, code: 'unreachable_objective', sentence: `Moved ${label(world, id)} to ${r2(to[0])},${r2(to[2])}, where the player can reach it.`, patches: [patchPosition(id, to)] };
}
function repairDoorLocked(world, f) {
    const door = f.entities[0];
    const d = f.data;
    if (!door || !d)
        return null;
    const e = world.entities[door];
    if (!e || e.locked)
        return null;
    // Only when nothing can ever unlock it; a door whose key is merely out of reach is fixed by moving the key.
    if (typeof d['producers'] === 'number' && d['producers'] > 0)
        return null;
    const behaviors = e.behaviors.map((b) => (b.type === 'door' ? { ...b, params: { ...b.params, trigger: 'proximity', radius: Math.max(typeof b.params['radius'] === 'number' ? b.params['radius'] : 0, 3) } } : b));
    return { id: `door:${door}`, code: 'door_locked', sentence: `Made ${label(world, door)} open when you walk up to it, because nothing in the game could unlock it.`, patches: [{ op: 'update', id: door, set: { behaviors: behaviors } }] };
}
function repairDoorStuck(world, f) {
    const door = f.entities[0];
    if (!door)
        return null;
    const e = world.entities[door];
    if (!e || e.locked)
        return null;
    const behaviors = e.behaviors.map((b) => (b.type === 'door' ? { ...b, params: { ...b.params, trigger: 'proximity', radius: 3.5, who: 'player' } } : b));
    return { id: `door:${door}`, code: 'door_stuck', sentence: `Made ${label(world, door)} open as soon as you step up to it.`, patches: [{ op: 'update', id: door, set: { behaviors: behaviors } }] };
}
function repairThreshold(world, f) {
    const d = f.data;
    if (!d || typeof d['ruleId'] !== 'string' || typeof d['available'] !== 'number' || typeof d['needed'] !== 'number' || typeof d['key'] !== 'string')
        return null;
    const available = d['available'];
    if (available <= 0)
        return null;
    const th = winThresholds(world).find((t) => t.ruleId === d['ruleId']);
    if (!th)
        return null;
    const rule = world.rules.find((r) => r.id === d['ruleId']);
    if (!rule)
        return null;
    return {
        id: `threshold:${th.ruleId}`,
        code: 'unwinnable',
        sentence: `Lowered the win target from ${th.value} to ${available}, because only ${available} ${th.key === 'score' ? 'pickups' : `"${th.key}"`} can ever be collected.`,
        patches: [{ op: 'updateRule', id: th.ruleId, set: { when: { value: available } } }],
    };
}
function repairNoWin(world) {
    const goals = deriveGoals(world);
    const totals = new Map();
    for (const o of goals.objectives)
        if (o.kind === 'collect' && o.key)
            totals.set(o.key, (totals.get(o.key) ?? 0) + 1);
    let key = '';
    let n = 0;
    for (const [k, v] of totals) {
        if (v > n) {
            key = k;
            n = v;
        }
    }
    if (!key || n === 0)
        return null;
    const id = world.rules.some((r) => r.id === 'win-all') ? 'win-all-collected' : 'win-all';
    const rule = {
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
function numParam(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
/**
 * A building door too narrow for the player: widen the door, its frame, the
 * opening cut in the wall and the building plan it was compiled from, so the
 * plan and the walls stay in step.
 */
function repairNarrowDoor(world, f) {
    const leafId = f.entities[0];
    if (!leafId)
        return null;
    const m = LEAF_ID.exec(leafId);
    const leaf = world.entities[leafId];
    if (!m || !leaf || leaf.locked || leaf.shape.kind !== 'procedural')
        return null;
    const frame = world.entities[leafId.slice(0, -'-leaf'.length)];
    const wall = leaf.arch?.wall !== undefined ? world.entities[leaf.arch.wall] : undefined;
    if (!frame || frame.shape.kind !== 'procedural' || !wall || wall.shape.kind !== 'procedural' || wall.locked)
        return null;
    const oldW = numParam(frame.shape.params['width']);
    const leafW = numParam(leaf.shape.params['width']);
    const openings = wall.shape.params['openings'];
    if (oldW === null || leafW === null || !Array.isArray(openings))
        return null;
    const newW = Math.max(0.9, r2(oldW + 0.1));
    // Which opening of the wall is this door? The door-kind one nearest its position along the wall.
    let doorLocal = 0;
    try {
        const wt = worldTransform(world, wall.id);
        const dt = worldTransform(world, leafId);
        const inv = [-wt.quaternion[0], -wt.quaternion[1], -wt.quaternion[2], wt.quaternion[3]];
        doorLocal = rotateVec3(inv, [dt.position[0] - wt.position[0], dt.position[1] - wt.position[1], dt.position[2] - wt.position[2]])[0];
    }
    catch {
        return null;
    }
    let best = -1;
    let bestD = Infinity;
    openings.forEach((o, i) => {
        if (typeof o !== 'object' || o === null || Array.isArray(o))
            return;
        const rec = o;
        if (rec['kind'] !== 'door' || numParam(rec['width']) === null || numParam(rec['offset']) === null)
            return;
        if (Math.abs(rec['width'] - oldW) > 1e-3)
            return;
        const d = Math.abs(rec['offset'] - doorLocal);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    });
    if (best < 0 || bestD > 0.25)
        return null;
    const newOpenings = openings.map((o, i) => (i === best ? { ...o, width: newW } : o));
    const patches = [
        { op: 'update', id: wall.id, set: { shape: { params: { openings: newOpenings } } } },
        { op: 'update', id: frame.id, set: { shape: { params: { width: newW } } } },
        { op: 'update', id: leafId, set: { shape: { params: { width: r2(leafW + (newW - oldW)) } } } },
    ];
    // Keep the building plan in step so a later re-compile does not undo the repair.
    const building = world.entities[m[1]];
    const plan = building?.arch?.plan;
    if (building && !building.locked && plan !== null && typeof plan === 'object' && !Array.isArray(plan) && Array.isArray(plan['levels'])) {
        const levels = structuredClone(plan['levels']);
        const level = levels[Number(m[2])];
        const doors = level !== null && typeof level === 'object' && !Array.isArray(level) ? level['doors'] : undefined;
        const door = Array.isArray(doors) ? doors[Number(m[3])] : undefined;
        if (door !== undefined && door !== null && typeof door === 'object' && !Array.isArray(door) && numParam(door['width']) !== null) {
            door['width'] = newW;
            patches.push({ op: 'update', id: building.id, set: { arch: { plan: { levels } } } });
        }
    }
    const where = leaf.arch?.room !== undefined ? world.entities[leaf.arch.room] : undefined;
    const name = where?.name && where.name !== where.id ? `the ${where.name.toLowerCase()} door` : `door ${leafId}`;
    return { id: `narrow:${leafId}`, code: 'door_blocked', sentence: `Widened ${name} from ${r2(oldW)} m to ${newW} m so the player's body fits through.`, patches };
}
function repairSpawn(world, f) {
    const inside = f.entities[0];
    const spawn = world.player.spawn;
    if (inside) {
        const b = entityBounds(world, inside);
        if (b && !world.entities[inside].locked) {
            const to = [spawn[0], b.max[1] + 0.3, spawn[2]];
            return { id: 'spawn', code: 'spawn_blocked', sentence: `Moved the player start on top of ${label(world, inside)}, out of the solid.`, patches: [{ op: 'setPlayer', set: { spawn: [r2(to[0]), r2(to[1]), r2(to[2])] } }] };
        }
    }
    // No floor under the spawn: put it on the nearest top surface.
    let best = null;
    for (const id in world.entities) {
        const e = world.entities[id];
        if (!solid(e) || e.physics?.body === 'dynamic')
            continue;
        const b = entityBounds(world, id);
        if (!b)
            continue;
        const sz = size(b);
        if (sz[0] < 1.5 || sz[2] < 1.5)
            continue;
        const c = [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];
        const dist = Math.hypot(c[0] - spawn[0], c[2] - spawn[2]);
        if (!best || dist < best.d)
            best = { id, top: c, d: dist };
    }
    if (!best)
        return null;
    return { id: 'spawn', code: 'spawn_blocked', sentence: `Moved the player start onto ${label(world, best.id)}, where there is floor to stand on.`, patches: [{ op: 'setPlayer', set: { spawn: [r2(best.top[0]), r2(best.top[1] + 0.3), r2(best.top[2])] } }] };
}
/**
 * Propose repairs for the errors of a report, most important first. Pure:
 * it reads the document and the report, nothing else.
 */
export function proposeRepairs(world, report) {
    const out = [];
    const order = ['spawn_blocked', 'door_blocked', 'door_stuck', 'door_locked', 'unwinnable', 'unreachable_objective', 'no_win_condition'];
    // Tight doors the bot squeezed through are cautions, not defects; they are widened only when they blocked something.
    const errors = report.findings.filter((f) => f.severity === 'error');
    for (const code of order) {
        for (const f of errors) {
            if (f.code !== code)
                continue;
            let p = null;
            switch (code) {
                case 'spawn_blocked':
                    p = repairSpawn(world, f);
                    break;
                case 'door_blocked':
                    p = repairNarrowDoor(world, f);
                    break;
                case 'door_stuck':
                    p = repairDoorStuck(world, f);
                    break;
                case 'door_locked':
                    p = repairDoorLocked(world, f);
                    break;
                case 'unwinnable':
                    p = repairThreshold(world, f);
                    break;
                case 'unreachable_objective':
                    p = repairUnreachable(world, f);
                    break;
                case 'no_win_condition':
                    p = repairNoWin(world);
                    break;
                default: break;
            }
            if (p && !out.some((x) => x.id === p.id))
                out.push(p);
        }
    }
    return out;
}
// ---------------------------------------------------------------------------
// Countdown repair
// ---------------------------------------------------------------------------
/** The world-state key of a countdown that loses the game at zero, with its start value. */
export function countdownOf(world) {
    for (const r of world.rules) {
        if (!r.enabled || !r.then.some((a) => a.do === 'lose') || r.when.on !== 'state')
            continue;
        if (r.when.op !== '<=' && r.when.op !== '<' && r.when.op !== '==')
            continue;
        const key = r.when.key;
        const start = world.state[key];
        if (typeof start !== 'number' || start <= 0)
            continue;
        const ticks = world.rules.some((t) => t.enabled && t.then.some((a) => a.do === 'add' && a.key === key && a.amount < 0));
        if (ticks)
            return { key, start, ruleId: r.id };
    }
    return null;
}
/** Strip the heavy trace from a report kept in the round list. */
function slim(report) {
    const { trace: _trace, ...rest } = report;
    return rest;
}
/**
 * Play, repair, play again — until the bot wins or the round cap is hit.
 * The last (passing) run is returned with its replay trace.
 */
export async function selfRepair(world, opts = {}) {
    const maxRounds = Math.max(1, Math.min(8, Math.round(opts.maxRounds ?? 4)));
    const bot = opts.kind === 'walkthrough' ? walkthrough : playtest;
    const run = opts.run ?? ((w) => bot(w, { ...opts.playtest, ...(opts.signal ? { signal: opts.signal } : {}) }));
    const apply = opts.apply ??
        ((p, w) => {
            const r = applyPatches(w, p.patches);
            return r.errors.length === 0 && r.applied.length === p.patches.length ? r.world : null;
        });
    let current = world;
    const rounds = [];
    const applied = [];
    const tried = new Set();
    let report = await run(current, 0);
    for (let i = 0; i < maxRounds; i++) {
        if (report.status === 'passed' || report.status === 'unsupported') {
            const round = { report: slim(report), repair: null };
            rounds.push(round);
            opts.onRound?.(round, i);
            break;
        }
        const proposals = proposeRepairs(current, report).filter((p) => !tried.has(p.id + JSON.stringify(p.patches)));
        let proposal = proposals[0] ?? null;
        if (!proposal)
            proposal = await countdownRepair(current, report, run);
        let next = null;
        if (proposal) {
            tried.add(proposal.id + JSON.stringify(proposal.patches));
            next = await apply(proposal, current);
        }
        const round = { report: slim(report), repair: next ? proposal : null };
        rounds.push(round);
        opts.onRound?.(round, i);
        if (!next || !proposal)
            break;
        applied.push(proposal);
        current = next;
        report = await run(current, i + 1);
    }
    const passed = report.status === 'passed';
    return { world: current, report, rounds, applied, passed, sentence: sentenceOf(passed, applied, report) };
}
async function countdownRepair(world, report, run) {
    if (!report.findings.some((f) => f.code === 'lost'))
        return null;
    const cd = countdownOf(world);
    if (!cd)
        return null;
    // Give the bot all the time it wants and measure what it needed.
    const roomy = structuredClone(world);
    roomy.state[cd.key] = Math.min(100_000, Math.max(cd.start * 10, 600));
    const measured = await run(roomy, -1);
    if (measured.status !== 'passed')
        return null;
    const needed = measured.seconds;
    const start = Math.ceil(needed * 1.5 + 5);
    if (start <= cd.start)
        return null;
    return {
        id: `countdown:${cd.key}`,
        code: 'lost',
        sentence: `Raised the time limit from ${Math.round(cd.start)} s to ${start} s, because the bot needed ${Math.ceil(needed)} s to finish.`,
        patches: [{ op: 'setState', key: cd.key, value: start }],
    };
}
const lowerFirst = (t) => t.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
function sentenceOf(passed, applied, report) {
    if (passed && applied.length === 0)
        return report.summary;
    if (passed)
        return `I fixed ${applied.length === 1 ? 'a problem' : `${applied.length} problems`} so ${report.kind === 'walkthrough' ? 'every room can be reached' : 'it can be won'}: ${applied.map((a) => lowerFirst(a.sentence)).join('; ')}.`;
    const tried = applied.length > 0 ? ` I tried: ${applied.map((a) => lowerFirst(a.sentence)).join('; ')}.` : '';
    return `${report.summary}${tried}`;
}

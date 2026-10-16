/**
 * Generic playtest bot for generated games. It knows nothing about any one
 * theme: it reads the world document, finds the objectives (entities with a
 * `collectible` or `goal` behavior), builds a graph of the walkable surfaces
 * (static or kinematic boxes and cylinders that are not hazards) and plays
 * with keyboard-like input through the real physics and logic runtime.
 *
 * A bot that fails proves nothing about a human player; a bot that wins is a
 * constructive proof that the game can be won. The report therefore counts
 * wins as a lower bound on winnability.
 */
import { worldTransform } from '@aether/core';
import { Bot } from '../../apps/studio/test/showcase/bot';
/** Gravity used for the jump envelope (m/s^2). */
const G = 9.81;
/** Simulated seconds the bot may play. */
export const PLAY_SECONDS = 150;
function hasBehavior(e, type) {
    return e.behaviors.some((b) => b.type === type && b.enabled !== false);
}
function pose(world, e) {
    try {
        return worldTransform(world, e.id).position;
    }
    catch {
        return e.transform.position;
    }
}
function surfaces(world) {
    const out = [];
    for (const e of Object.values(world.entities)) {
        if (e.parent !== null || !e.visible || e.shape.kind !== 'primitive' || !e.physics || e.physics.sensor)
            continue;
        if (e.physics.body !== 'static' && e.physics.body !== 'kinematic')
            continue;
        if (hasBehavior(e, 'hazard') || e.tags.includes('backdrop'))
            continue;
        const prim = e.shape.primitive;
        if (prim !== 'box' && prim !== 'cylinder')
            continue;
        const tilt = Math.max(Math.abs(e.transform.rotation[0]), Math.abs(e.transform.rotation[2])) % 180;
        if (tilt > 5 && tilt < 175)
            continue;
        const p = pose(world, e);
        const s = e.transform.scale;
        const hx = (e.shape.size[0] * s[0]) / 2;
        const hz = ((prim === 'cylinder' ? e.shape.size[0] : e.shape.size[2]) * (prim === 'cylinder' ? s[0] : s[2])) / 2;
        const hy = (e.shape.size[1] * s[1]) / 2;
        if (hx < 0.3 || hz < 0.3 || hx > 60 || hz > 60)
            continue;
        out.push({ id: e.id, x: p[0], z: p[2], hx, hz, top: p[1] + hy, hy, kin: e.physics.body === 'kinematic' });
    }
    return out;
}
const inside = (s, x, z, margin = 0) => Math.abs(x - s.x) <= s.hx + margin && Math.abs(z - s.z) <= s.hz + margin;
function gap(a, b) {
    const dx = Math.max(0, Math.abs(a.x - b.x) - a.hx - b.hx);
    const dz = Math.max(0, Math.abs(a.z - b.z) - a.hz - b.hz);
    return Math.hypot(dx, dz);
}
/** Highest surface under (x, z) whose top is at or below `y + tolerance`. */
function supportAt(list, x, z, y, tolerance = 0.9) {
    let best;
    for (const s of list)
        if (inside(s, x, z, 0.1) && s.top <= y + tolerance && (!best || s.top > best.top))
            best = s;
    return best;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Breadth-first route over surfaces, `from` to `to` (inclusive), or null. */
function route(list, from, to, maxGap, maxRise) {
    const prev = new Map([[from.id, null]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
        const a = queue[i];
        if (a.id === to.id) {
            const path = [];
            for (let c = a; c; c = prev.get(c.id))
                path.unshift(c);
            return path;
        }
        for (const b of list) {
            if (prev.has(b.id) || b.top - a.top > maxRise || gap(a, b) > maxGap)
                continue;
            prev.set(b.id, a);
            queue.push(b);
        }
    }
    return null;
}
/** The score a win rule waits for, and how much the world can award. */
function winExplanation(world, reached) {
    const rules = world.rules;
    const wins = rules.filter((r) => JSON.stringify(r.then).includes('"win"'));
    if (wins.length === 0)
        return 'no rule or goal in this world ends the game with a win';
    const parts = [];
    for (const r of wins) {
        const when = r.when;
        if (when.on === 'state' && typeof when.key === 'string') {
            const key = when.key;
            let available = 0;
            let collected = 0;
            for (const e of Object.values(world.entities)) {
                const c = e.behaviors.find((b) => b.type === 'collectible' && (b.params['scoreKey'] ?? 'score') === key);
                if (!c)
                    continue;
                const v = typeof c.params['value'] === 'number' ? c.params['value'] : 1;
                available += v;
                if (reached.has(e.id))
                    collected += v;
            }
            parts.push(`win rule '${r.id}' needs ${key} ${when.op ?? '>='} ${JSON.stringify(when.value)}; the world has ${available} collectible ${key} in total, the bot collected ${collected}`);
        }
        else
            parts.push(`win rule '${r.id}' waits for ${JSON.stringify(r.when).slice(0, 80)}`);
    }
    return parts.join('; ');
}
/**
 * Play `world` for up to {@link PLAY_SECONDS} simulated seconds and report
 * whether the bot won. Call `initPhysics()` (and `initScripting()` for
 * script-driven worlds) first.
 */
export async function playtest(world) {
    const t0 = performance.now();
    const bot = await Bot.play(world);
    const reached = new Set();
    const failed = [];
    let jumpsNeeded = 0;
    try {
        const all = Object.values(world.entities);
        const collectibles = all.filter((e) => e.parent === null && hasBehavior(e, 'collectible'));
        const goals = all.filter((e) => e.parent === null && hasBehavior(e, 'goal'));
        const list = surfaces(world);
        const jumpSpeed = world.player.jumpSpeed > 0 ? world.player.jumpSpeed : 6;
        const maxRise = (jumpSpeed * jumpSpeed) / (2 * G) * 0.92;
        const maxGap = world.player.moveSpeed * ((2 * jumpSpeed) / G) * 0.55;
        // Settle onto the ground before planning (the capsule spawns above it).
        bot.step(0.8);
        // Height of a surface right now (moving platforms are read from the physics world).
        const live = (s) => {
            if (!s.kin)
                return s.top;
            const st = bot.pw.getState(s.id);
            return st ? st.position[1] + s.hy : s.top;
        };
        // Walk toward (x, z); when something is in the way, sidestep it (alternating sides, wider each time) and retry.
        const travel = (x, z, radius, jump) => {
            const giveUpAt = bot.time + 14;
            for (let attempt = 0; attempt < 6 && bot.outcome === null && bot.time < Math.min(PLAY_SECONDS, giveUpAt); attempt++) {
                if (bot.walkTo(x, z, { radius, timeout: attempt === 0 ? 12 : 5, jump }))
                    return true;
                const here = bot.position;
                const dx = x - here[0];
                const dz = z - here[2];
                const d = Math.hypot(dx, dz) || 1;
                const side = attempt % 2 === 0 ? 1 : -1;
                const off = 3 + attempt * 1.5;
                bot.walkTo(here[0] + (-dz / d) * off * side, here[2] + (dx / d) * off * side, { radius: 0.8, timeout: 4 });
            }
            return Math.hypot(x - bot.position[0], z - bot.position[2]) <= radius;
        };
        const goTo = (e) => {
            const p = pose(world, e);
            const target = supportAt(list, p[0], p[2], p[1]);
            let lastEdge = '';
            let repeats = 0;
            // Re-plan from wherever the bot actually is after every hop, so a miss or a fall is recovered from.
            for (let step = 0; target && step < 60 && bot.outcome === null && bot.time < PLAY_SECONDS; step++) {
                const here = bot.position;
                // Standing on the ground (no surface under the feet): a small virtual pad at the bot's position.
                const start = supportAt(list, here[0], here[2], here[1], 0.5) ?? { id: '__here', x: here[0], z: here[2], hx: 1.5, hz: 1.5, top: here[1], hy: 0, kin: false };
                if (start.id === target.id)
                    break;
                const path = route(list, start, target, maxGap, maxRise);
                if (!path || path.length < 2)
                    return false;
                const a = path[0];
                const b = path[1];
                const edge = `${a.id}>${b.id}`;
                repeats = edge === lastEdge ? repeats + 1 : 0;
                lastEdge = edge;
                if (repeats >= 4)
                    return false;
                // A moving platform: board or leave it when it is level with the other side.
                if (a.kin || b.kin)
                    bot.waitUntil(() => Math.abs(live(a) - live(b)) <= 0.6, 25);
                // Stand at the edge of `a` closest to `b`, then jump across.
                const ex = clamp(b.x, a.x - a.hx + 0.5, a.x + a.hx - 0.5);
                const ez = clamp(b.z, a.z - a.hz + 0.5, a.z + a.hz - 0.5);
                if (a.id !== '__here')
                    bot.walkTo(ex, ez, { radius: 0.5, timeout: 12 });
                const nx = clamp(ex, b.x - b.hx + 0.6, b.x + b.hx - 0.6);
                const nz = clamp(ez, b.z - b.hz + 0.6, b.z + b.hz - 0.6);
                bot.walkTo(nx, nz, { radius: 0.5, timeout: 5, jump: true });
            }
            if (bot.outcome !== null)
                return true;
            return travel(p[0], p[2], 0.6, p[1] > bot.position[1] + 0.6);
        };
        // Pick up the nearest remaining collectible first, then go for the goal.
        const remaining = [...collectibles];
        while (remaining.length > 0 && bot.outcome === null && bot.time < PLAY_SECONDS) {
            const here = bot.position;
            remaining.sort((a, b) => {
                const pa = pose(world, a);
                const pb = pose(world, b);
                return Math.hypot(pa[0] - here[0], pa[2] - here[2]) - Math.hypot(pb[0] - here[0], pb[2] - here[2]);
            });
            const next = remaining.shift();
            if (goTo(next)) {
                // A pickup that is still there was missed (it floats above foot level): hop like a player would.
                let hops = 0;
                for (; hops < 3 && bot.outcome === null && bot.host.getTransform(next.id) !== undefined; hops++) {
                    const p = pose(world, next);
                    bot.walkTo(p[0], p[2], { radius: 0.3, timeout: 3, jump: true });
                }
                if (bot.outcome === null && bot.host.getTransform(next.id) !== undefined)
                    failed.push({ id: next.id, at: pose(world, next), position: [...bot.position] });
                else {
                    reached.add(next.id);
                    if (hops > 0)
                        jumpsNeeded++;
                }
            }
            else
                failed.push({ id: next.id, at: pose(world, next), position: [...bot.position] });
        }
        for (const g of goals) {
            if (bot.outcome !== null || bot.time >= PLAY_SECONDS)
                break;
            if (goTo(g)) {
                // Touching a goal ends the game; give the end-of-game rules a moment.
                if (bot.outcome === null)
                    bot.waitUntil(() => bot.outcome !== null, 1);
                if (bot.outcome === 'win')
                    reached.add(g.id);
                else
                    failed.push({ id: g.id, at: pose(world, g), position: [...bot.position] });
            }
            else
                failed.push({ id: g.id, at: pose(world, g), position: [...bot.position] });
        }
        // Let timers and end-of-game rules run.
        if (bot.outcome === null)
            bot.waitUntil(() => bot.outcome !== null, 4);
        const outcome = bot.outcome;
        const finalState = Object.fromEntries(Object.keys(world.state).map((k) => [k, bot.state(k)]));
        const fmt = (v) => `(${v.map((n) => n.toFixed(1)).join(', ')})`;
        let summary;
        if (outcome === 'win')
            summary = 'bot won';
        else {
            const bits = [];
            if (failed.length > 0)
                bits.push(`the bot could not reach ${failed.slice(0, 2).map((f) => `'${f.id}' at ${fmt(f.at)} (stuck near ${fmt(f.position)})`).join(', ')}${failed.length > 2 ? ` and ${failed.length - 2} more` : ''}`);
            if (outcome === 'lose')
                bits.push('the game was lost (time ran out or a hazard)');
            if (failed.length === 0)
                bits.push(winExplanation(world, reached));
            summary = bits.join('; ');
        }
        return { won: outcome === 'win', outcome, seconds: Math.round(bot.time * 10) / 10, reached: [...reached], failed, summary, finalState, jumpPickups: jumpsNeeded, wallMs: Math.round(performance.now() - t0) };
    }
    finally {
        bot.dispose();
    }
}
/** True when the world has something a bot can win: a win action in a rule or a goal behavior. */
export function isWinnableKind(world) {
    if (world.rules.some((r) => JSON.stringify(r.then).includes('"win"')))
        return true;
    return Object.values(world.entities).some((e) => hasBehavior(e, 'goal'));
}

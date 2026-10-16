/**
 * Level review: the checks a level designer would run before showing a game, as findings the assistant
 * can fix with the level tools, plus the camera poses of the renders it should look at (an overview of
 * the whole level, the player's first view, a close look at the worst problem).
 *
 * Everything is measured on the document: reach comes from the verified-playable bot's walking map,
 * heights from ray casts. Nothing here plays the game: that is the bot's job once the review is done.
 */
import { entityBounds } from '@aether/physics';
import { deriveGoals } from '../goals';
import { unsupportedReason } from '../agent';
import { withProbe } from './probe-cache';
const r1 = (n) => Math.round(n * 10) / 10;
/** Score of a finding list. */
export function scoreLevel(findings) {
    let s = 100;
    for (const f of findings)
        s -= f.severity === 'error' ? 25 : f.severity === 'warning' ? 6 : 0;
    return Math.max(0, s);
}
/** The box around everything solid that is not scenery far away (backdrop-tagged entities are left out). */
function solidExtent(world) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let count = 0;
    for (const id in world.entities) {
        const e = world.entities[id];
        if (e.template || e.tags.includes('backdrop') || !e.physics || e.physics.sensor || e.physics.collider === 'none')
            continue;
        if (++count > 20_000)
            break;
        const b = entityBounds(world, id);
        if (!b || !Number.isFinite(b.max[0] + b.min[0] + b.max[2] + b.min[2]))
            continue;
        // A 400 m ground slab does not describe the level.
        if (b.max[0] - b.min[0] > 600 || b.max[2] - b.min[2] > 600)
            continue;
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
function hasGameplay(world, derived) {
    if (derived)
        return true;
    if (world.rules.some((r) => r.enabled && r.then.some((a) => a.do === 'win' || a.do === 'lose')))
        return true;
    for (const id in world.entities) {
        const e = world.entities[id];
        if (!e.template && e.behaviors.some((b) => b.enabled && (b.type === 'collectible' || b.type === 'goal' || b.type === 'checkpoint')))
            return true;
    }
    return false;
}
/** Review a game or outdoor level. Never throws for odd documents. */
export async function reviewLevel(world) {
    const findings = [];
    const goals = deriveGoals(world);
    if (!hasGameplay(world, goals.objectives.length > 0 || goals.winDefined))
        return { applicable: false, findings: [], poses: [], score: 100 };
    const spawn = world.player.spawn;
    const why = unsupportedReason(world);
    if (!goals.winDefined && goals.objectives.length > 0) {
        findings.push({ code: 'no_win', severity: 'error', message: 'nothing in this level ends the game: there are objectives but no goal and no winning rule', entities: [], fix: 'place a goal with place_level_items (role "goal") or add a win rule (addRule with a win action)' });
    }
    else if (!goals.winDefined) {
        findings.push({ code: 'no_win', severity: 'error', message: 'the level has no goal, pickup or winning rule: there is nothing to play yet', entities: [], fix: 'place pickups and a goal with place_level_items and add a win rule' });
    }
    if (why) {
        findings.push({ code: 'unmeasured', severity: 'info', message: `reach cannot be measured here: ${why}`, entities: [], fix: 'none' });
    }
    else {
        await withProbe(world, (probe) => {
            if (!probe.ok) {
                findings.push({ code: 'spawn', severity: 'error', message: probe.problem || 'the player has nowhere to stand at the spawn point', entities: [], at: [spawn[0], spawn[1], spawn[2]], fix: 'move player.spawn to open ground (query_level ground and clearance tell where)' });
                return;
            }
            const all = probe.objectives();
            for (const o of all) {
                if (o.reachable)
                    continue;
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
                if (nearest > 35)
                    findings.push({ code: 'first_reward_far', severity: 'warning', message: `the nearest pickup is ${r1(nearest)} m from the spawn: the first reward comes too late`, entities: [], fix: 'put a pickup within 10 to 20 m of the spawn' });
            }
        });
    }
    // The renders: the whole level from above and behind, the player's first view, the worst problem up close.
    const poses = [];
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

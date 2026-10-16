/**
 * Static checks of the NPCs in a world document: do they stand on walkable
 * floor, are all patrol points reachable, are the dialogue trees and the
 * items they trade consistent. Used by the `npcs` verification test and by
 * the agent's self-checks. Deterministic and bounded (one grid per level and
 * body size, one path search per waypoint).
 */
import { resolveSelector, worldTransform } from '@aether/core';
import { zoneShapeOf } from '../bounds';
import { DialogueSession } from './dialogue';
import { NavGrid, NAV_MAX_PATH } from './nav';
import { buildNavFor } from './obstacles';
/** Larger than the runtime budget: the check should be exact. */
const ANALYSIS_EXPANSIONS = 60_000;
const MAX_LISTED = 4;
function feetOf(e, y) {
    return e.shape.kind === 'primitive' ? y - zoneShapeOf(e).half[1] : y;
}
/** Keys a world can ever hold: initial state plus everything rules and dialogues write. */
function writableKeys(world) {
    const keys = new Set(Object.keys(world.state));
    for (const r of world.rules) {
        for (const a of r.then)
            if ((a.do === 'set' || a.do === 'add') && typeof a.key === 'string')
                keys.add(a.key);
    }
    const fx = (list) => {
        for (const f of list) {
            if (f.do === 'set' || f.do === 'add')
                keys.add(f.key);
            else if (f.do === 'give' || f.do === 'take')
                keys.add(f.item);
            else if (f.do === 'openDoor')
                keys.add(`${f.target}-unlocked`);
        }
    };
    for (const id of Object.keys(world.entities)) {
        const tree = world.entities[id].npc?.dialogue;
        if (!tree)
            continue;
        for (const n of Object.values(tree.nodes)) {
            fx(n.effects);
            for (const c of n.choices)
                fx(c.effects);
        }
    }
    return keys;
}
function checkDialogue(id, tree, keys, out) {
    const reach = DialogueSession.reachable(tree);
    const lost = Object.keys(tree.nodes).filter((n) => !reach.has(n));
    if (lost.length > 0)
        out.warnings.push(`${id}: dialogue node(s) ${lost.slice(0, MAX_LISTED).join(', ')} can never be reached`);
    const missing = new Set();
    for (const [nid, n] of Object.entries(tree.nodes)) {
        for (const c of n.choices) {
            for (const cond of c.if) {
                const base = cond.key;
                if (!keys.has(base) && !base.includes('.'))
                    missing.add(`'${base}' (needed by '${c.text.slice(0, 30)}' in ${nid})`);
            }
        }
        for (const v of n.variants)
            for (const cond of v.if)
                if (!keys.has(cond.key) && !cond.key.includes('.'))
                    missing.add(`'${cond.key}'`);
    }
    if (missing.size > 0)
        out.warnings.push(`${id}: dialogue reads state the world never sets: ${[...missing].slice(0, MAX_LISTED).join(', ')}`);
}
/**
 * Examine the NPCs matched by `target` ("*" = all). Entities without an `npc`
 * spec are ignored.
 */
export function analyzeNpcs(world, opts = {}) {
    const out = { errors: [], warnings: [], npcs: 0 };
    let ids;
    try {
        ids = resolveSelector(world, opts.target ?? '*');
    }
    catch {
        ids = [];
    }
    const npcs = ids.filter((id) => {
        const e = world.entities[id];
        return e !== undefined && e.npc !== undefined && !e.template;
    });
    out.npcs = npcs.length;
    const grids = new Map();
    const keys = writableKeys(world);
    const tags = new Set();
    for (const e of Object.values(world.entities))
        for (const t of e.tags)
            tags.add(t);
    const scratch = new Float32Array(NAV_MAX_PATH * 2);
    for (const id of npcs) {
        const e = world.entities[id];
        const spec = e.npc;
        let pos;
        try {
            pos = worldTransform(world, id).position;
        }
        catch {
            continue;
        }
        const feet = feetOf(e, pos[1]);
        const level = Math.round(feet / 1.5);
        const key = `${level}|${Math.round(spec.radius * 4)}|${Math.round(spec.height * 2)}`;
        let grid = grids.get(key);
        if (!grid) {
            const points = [];
            for (const other of npcs) {
                const oe = world.entities[other];
                const op = worldTransform(world, other).position;
                if (Math.round(feetOf(oe, op[1]) / 1.5) !== level)
                    continue;
                points.push(op);
                for (const w of oe.npc.waypoints)
                    points.push(w);
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
        if (!grid.walkable(pos[0], pos[2]))
            out.warnings.push(`${id}: starts inside a solid or too close to a wall; it will be nudged out`);
        const bad = [];
        const cut = [];
        spec.waypoints.forEach((w, i) => {
            const cell = grid.nearest(w[0], w[2], 3);
            if (cell < 0) {
                bad.push(`#${i} [${w[0].toFixed(1)}, ${w[2].toFixed(1)}]`);
                return;
            }
            const n = grid.findPath(pos[0], pos[2], w[0], w[2], scratch, ANALYSIS_EXPANSIONS);
            if (n === 0)
                cut.push(`#${i} [${w[0].toFixed(1)}, ${w[2].toFixed(1)}]`);
        });
        if (bad.length > 0)
            out.errors.push(`${id}: waypoint ${bad.slice(0, MAX_LISTED).join(', ')} is not on walkable floor`);
        if (cut.length > 0)
            out.errors.push(`${id}: waypoint ${cut.slice(0, MAX_LISTED).join(', ')} cannot be reached from where it stands (walled off or across a gap)`);
        if (spec.archetype === 'guard' && spec.waypoints.length === 0 && spec.wander <= 0)
            out.warnings.push(`${id}: a guard without waypoints stands at its post`);
        if (spec.waypoints.length === 1)
            out.warnings.push(`${id}: a single waypoint gives nothing to patrol between`);
        if ((spec.archetype === 'guard' || spec.archetype === 'predator' || spec.archetype === 'sentinel') && !spec.attack) {
            out.warnings.push(`${id}: ${spec.archetype} has no attack, so catching the player does nothing`);
        }
        for (const t of spec.fears)
            if (!tags.has(t))
                out.warnings.push(`${id}: fears '${t}' but nothing in the world has that tag`);
        if (spec.dialogue)
            checkDialogue(id, spec.dialogue, keys, out);
    }
    return out;
}

/**
 * A copy-on-write draft of a world. Ops mutate the draft in plain code
 * ("entity.material.color = …"); the minimal patch list is then
 * `patchesBetween(before, draft.done())`, so a small edit is always exactly
 * the property-level difference, never a regeneration.
 */
import { hasOwn, isForbiddenKey } from '@aether/core';
/** Deep clone of JSON-like data. */
export function clone(v) {
    return structuredClone(v);
}
/** Set a dotted path in an object, creating plain objects on the way (prototype-safe). */
export function setPath(target, path, value) {
    const keys = path.split('.');
    let cur = target;
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (isForbiddenKey(k))
            return;
        const next = hasOwn(cur, k) ? cur[k] : undefined;
        if (typeof next !== 'object' || next === null || Array.isArray(next)) {
            const fresh = {};
            cur[k] = fresh;
            cur = fresh;
        }
        else
            cur = next;
    }
    const last = keys[keys.length - 1];
    if (!isForbiddenKey(last))
        cur[last] = value;
}
/** Leaves of a nested object as dotted paths (arrays and non-plain values are leaves). */
export function leafPaths(obj, prefix = '', out = {}) {
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        const p = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'object' && v !== null && !Array.isArray(v))
            leafPaths(v, p, out);
        else
            out[p] = v;
    }
    return out;
}
/** Copy-on-write world draft. */
export class Draft {
    base;
    /** The working world (entities map is private to the draft). */
    world;
    owned = new Set();
    constructor(base) {
        this.base = base;
        this.world = { ...base, entities: { ...base.entities }, environment: base.environment, player: base.player, rules: base.rules, state: base.state, hud: base.hud };
    }
    /** Replace the whole working world (after an op that recompiled part of it). Entities stay copy-on-write. */
    replace(next) {
        this.world = { ...next, entities: { ...next.entities } };
        this.owned.clear();
    }
    /** A writable entity (cloned on first access). */
    entity(id) {
        const e = this.world.entities[id];
        if (!e)
            throw new RangeError(`unknown entity ${id}`);
        if (!this.owned.has(id)) {
            this.owned.add(id);
            this.world.entities[id] = clone(e);
        }
        return this.world.entities[id];
    }
    /** Add a new entity. */
    add(e) {
        this.owned.add(e.id);
        this.world.entities[e.id] = e;
    }
    /** Remove an entity (and optionally its descendants). */
    remove(id, recursive = true) {
        const removed = [];
        const stack = [id];
        while (stack.length > 0) {
            const cur = stack.pop();
            if (!hasOwn(this.world.entities, cur))
                continue;
            removed.push(cur);
            delete this.world.entities[cur];
            if (recursive)
                for (const e of Object.values(this.world.entities))
                    if (e.parent === cur)
                        stack.push(e.id);
        }
        return removed;
    }
    /** Edit the environment. */
    env(fn) {
        const e = clone(this.world.environment);
        fn(e);
        this.world.environment = e;
    }
    /** Edit the player spec. */
    player(fn) {
        const p = clone(this.world.player);
        fn(p);
        this.world.player = p;
    }
    /** The finished world (a new object when anything changed). */
    done() {
        return this.world;
    }
}

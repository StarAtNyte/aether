import { LIMITS } from './limits';
import { deepEqual, hasOwn, isPlainObject } from './json';
import { eulerDegToQuat, quatMultiply, rotateVec3 } from './math';
import { isEntityId } from './ids';
/** Look up an entity by id without touching the prototype chain. */
export function getEntity(world, id) {
    return hasOwn(world.entities, id) ? world.entities[id] : undefined;
}
const TAG_SELECTOR = /^#[^\s#]{1,64}$/;
/**
 * True when `s` is a syntactically valid selector:
 * an entity id, "#tag", "player" or "*".
 */
export function isValidSelector(s) {
    return s === '*' || s === 'player' || TAG_SELECTOR.test(s) || isEntityId(s);
}
/**
 * Resolve a selector to entity ids (document order). Templates are never
 * returned. "player" resolves to `ctx.playerId`, then `world.player.controls`,
 * then an entity literally called "player". Unknown or malformed selectors
 * resolve to `[]`.
 */
export function resolveSelector(world, selector, ctx) {
    const live = (id) => {
        if (id === undefined)
            return [];
        const e = getEntity(world, id);
        return e && !e.template ? [id] : [];
    };
    if (selector === '*') {
        const out = [];
        for (const id of Object.keys(world.entities))
            if (!world.entities[id].template)
                out.push(id);
        return out;
    }
    if (selector === 'player') {
        const viaCtx = live(ctx?.playerId);
        if (viaCtx.length > 0)
            return viaCtx;
        const viaControls = live(world.player.controls);
        return viaControls.length > 0 ? viaControls : live('player');
    }
    if (selector.startsWith('#')) {
        if (!TAG_SELECTOR.test(selector))
            return [];
        const tag = selector.slice(1);
        const out = [];
        for (const id of Object.keys(world.entities)) {
            const e = world.entities[id];
            if (!e.template && e.tags.includes(tag))
                out.push(id);
        }
        return out;
    }
    return live(selector);
}
/** Direct children of `id` (document order). */
export function childrenOf(world, id) {
    const out = [];
    for (const cid of Object.keys(world.entities))
        if (world.entities[cid].parent === id)
            out.push(cid);
    return out;
}
/**
 * Compose the parent chain into a world transform (T·R·S per level, parent
 * first). Scale composes component-wise, which is exact for uniform scales and
 * the usual approximation for non-uniform scales under rotation.
 * Throws `RangeError` for an unknown id or a broken (cyclic / too deep) chain.
 */
export function worldTransform(world, id) {
    const chain = [];
    let cur = getEntity(world, id);
    if (!cur)
        throw new RangeError(`worldTransform: unknown entity '${id}'`);
    while (cur) {
        chain.push(cur);
        if (chain.length > LIMITS.MAX_HIERARCHY_DEPTH + 1)
            throw new RangeError(`worldTransform: parent chain of '${id}' is cyclic or too deep`);
        const parentId = cur.parent;
        cur = parentId === null ? undefined : getEntity(world, parentId);
    }
    const position = [0, 0, 0];
    const quaternion = [0, 0, 0, 1];
    const scale = [1, 1, 1];
    const local = [0, 0, 0, 1];
    const offset = [0, 0, 0];
    for (let i = chain.length - 1; i >= 0; i--) {
        const t = chain[i].transform;
        offset[0] = t.position[0] * scale[0];
        offset[1] = t.position[1] * scale[1];
        offset[2] = t.position[2] * scale[2];
        rotateVec3(quaternion, offset, offset);
        position[0] += offset[0];
        position[1] += offset[1];
        position[2] += offset[2];
        quatMultiply(quaternion, eulerDegToQuat(t.rotation, local), quaternion);
        scale[0] *= t.scale[0];
        scale[1] *= t.scale[1];
        scale[2] *= t.scale[2];
    }
    return { position, quaternion, scale };
}
function getPath(root, segments) {
    let cur = root;
    for (const seg of segments) {
        if (Array.isArray(cur)) {
            if (!/^\d+$/.test(seg))
                return undefined;
            cur = cur[Number(seg)];
        }
        else if (isPlainObject(cur)) {
            cur = hasOwn(cur, seg) ? cur[seg] : undefined;
        }
        else {
            return undefined;
        }
        if (cur === undefined)
            return undefined;
    }
    return cur;
}
/**
 * Read a state variable:
 * - "score"            → `world.state.score`
 * - "door-1.open"      → `world.entities['door-1'].state.open` (entity wins over a same-named world key)
 * - "door-1.stats.hp"  → nested lookup inside entity state
 * - "stats.hp"         → nested lookup inside `world.state.stats` when no entity "stats" exists
 */
export function readStateKey(world, key) {
    const dot = key.indexOf('.');
    if (dot > 0) {
        const entity = getEntity(world, key.slice(0, dot));
        if (entity)
            return getPath(entity.state, key.slice(dot + 1).split('.'));
    }
    if (hasOwn(world.state, key))
        return world.state[key];
    return dot > 0 ? getPath(world.state, key.split('.')) : undefined;
}
/**
 * Type-safe comparison used by rule conditions and tests. No coercion:
 * - numbers compare numerically; strings compare lexicographically (ordering ops);
 * - booleans, null, arrays and objects support only `==`/`!=` (deep equality);
 * - mismatched types are never equal and never ordered;
 * - `undefined` (missing variable) only satisfies `!=`.
 */
export function compare(a, op, b) {
    if (op === '==')
        return a !== undefined && deepEqual(a, b);
    if (op === '!=')
        return a === undefined || !deepEqual(a, b);
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) || Number.isNaN(b))
            return false;
        switch (op) {
            case '>': return a > b;
            case '<': return a < b;
            case '>=': return a >= b;
            case '<=': return a <= b;
        }
    }
    if (typeof a === 'string' && typeof b === 'string') {
        switch (op) {
            case '>': return a > b;
            case '<': return a < b;
            case '>=': return a >= b;
            case '<=': return a <= b;
        }
    }
    return false;
}

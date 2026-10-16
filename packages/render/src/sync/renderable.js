/**
 * Which entities of a world are drawn: everything except templates and the
 * descendants of templates (templates are blueprints for `spawn` actions).
 */
import { LIMITS } from '@aether/core';
/** Ids of the entities that should be rendered. O(n) with memoization; cycle-safe. */
export function renderableIds(world) {
    const entities = world.entities;
    const memo = new Map();
    const maxDepth = LIMITS.MAX_HIERARCHY_DEPTH + 1;
    const visit = (id) => {
        const chain = [];
        let cur = id;
        let result = true;
        while (cur !== null) {
            const known = memo.get(cur);
            if (known !== undefined) {
                result = known;
                break;
            }
            const e = Object.hasOwn(entities, cur) ? entities[cur] : undefined;
            if (!e)
                break; // missing parent: treat as root
            if (e.template || chain.length > maxDepth || chain.includes(cur)) {
                result = false;
                break;
            }
            chain.push(cur);
            cur = e.parent;
        }
        for (const c of chain)
            memo.set(c, result);
        return result;
    };
    const out = new Set();
    for (const id of Object.keys(entities))
        if (visit(id))
            out.add(id);
    return out;
}

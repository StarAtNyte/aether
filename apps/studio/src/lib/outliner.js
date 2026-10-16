/** Most rows produced (defensive; LIMITS caps entities anyway). */
export const MAX_ROWS = 20_000;
const MAX_DEPTH = 64;
/** Icon category for an entity. */
export function rowKind(e) {
    if (e.template)
        return 'template';
    if (e.light)
        return 'light';
    switch (e.shape.kind) {
        case 'scatter':
            return 'scatter';
        case 'procedural':
            return 'procedural';
        case 'primitive':
            return 'primitive';
        case 'model':
            return 'model';
        case 'mesh':
            return 'mesh';
        default:
            return 'group';
    }
}
/** Does an entity match the search text? "#tag" matches tags; otherwise id, name, description, generator. */
export function matchesFilter(e, filter) {
    const f = filter.trim().toLowerCase();
    if (!f)
        return true;
    if (f.startsWith('#')) {
        const tag = f.slice(1);
        return e.tags.some((t) => t.toLowerCase().includes(tag));
    }
    if (e.id.includes(f) || e.name.toLowerCase().includes(f))
        return true;
    if (e.description && e.description.toLowerCase().includes(f))
        return true;
    if (e.shape.kind === 'procedural' && e.shape.generator.toLowerCase().includes(f))
        return true;
    return e.tags.some((t) => t.toLowerCase().includes(f));
}
/**
 * Rows memoized by (immutable) entity object: unchanged entities keep the same
 * row object across commits, so memoized row components skip re-rendering.
 */
const rowCache = new WeakMap();
function toRow(e, depth, childCount) {
    const hit = rowCache.get(e);
    if (hit && hit.depth === depth && hit.childCount === childCount)
        return hit;
    const row = createRow(e, depth, childCount);
    rowCache.set(e, row);
    return row;
}
function createRow(e, depth, childCount) {
    return {
        id: e.id,
        name: e.name || e.id,
        depth,
        kind: rowKind(e),
        tags: e.tags,
        childCount,
        visible: e.visible,
        locked: e.locked === true,
        dynamic: e.physics?.body === 'dynamic',
        hasBehaviors: e.behaviors.length > 0,
    };
}
/**
 * Build visible rows. With a filter, matches are listed flat (depth 0);
 * otherwise the hierarchy is shown, skipping children of collapsed ids.
 */
export function buildOutlinerRows(world, filter, collapsed) {
    const entities = world.entities;
    const children = new Map();
    const roots = [];
    for (const id of Object.keys(entities)) {
        const e = entities[id];
        const p = e.parent;
        if (p !== null && Object.prototype.hasOwnProperty.call(entities, p)) {
            const list = children.get(p);
            if (list)
                list.push(id);
            else
                children.set(p, [id]);
        }
        else
            roots.push(id);
    }
    const rows = [];
    if (filter.trim()) {
        for (const id of Object.keys(entities)) {
            const e = entities[id];
            if (matchesFilter(e, filter))
                rows.push(toRow(e, 0, children.get(id)?.length ?? 0));
            if (rows.length >= MAX_ROWS)
                break;
        }
        return rows;
    }
    // Iterative DFS (no recursion depth issues), preserving document order.
    const stack = [];
    for (let i = roots.length - 1; i >= 0; i--)
        stack.push([roots[i], 0]);
    const seen = new Set();
    while (stack.length > 0 && rows.length < MAX_ROWS) {
        const [id, depth] = stack.pop();
        if (seen.has(id))
            continue;
        seen.add(id);
        const e = entities[id];
        const kids = children.get(id) ?? [];
        rows.push(toRow(e, depth, kids.length));
        if (kids.length > 0 && !collapsed.has(id) && depth < MAX_DEPTH) {
            for (let i = kids.length - 1; i >= 0; i--)
                stack.push([kids[i], depth + 1]);
        }
    }
    return rows;
}
/** Visible slice of a fixed-row-height list (virtualization). */
export function visibleRange(count, rowHeight, scrollTop, viewportHeight, overscan = 8) {
    if (count <= 0 || rowHeight <= 0)
        return { start: 0, end: 0 };
    const start = Math.min(count, Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan));
    const end = Math.min(count, Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight) + overscan);
    return { start, end: Math.max(start, end) };
}

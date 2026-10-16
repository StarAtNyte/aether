/** Most groups annotated at once. */
export const MAX_PLAN_MARKS = 8;
/** Seconds the annotations stay up. */
export const PLAN_MARK_SECONDS = 3.2;
const BACKDROP = new Set(['terrain', 'mountain', 'island', 'cloud', 'grass-tuft', 'water']);
/** Group key and display name of an entity (null: not worth naming). */
export function planKey(e) {
    if (e.template || !e.visible || e.shape.kind === 'none')
        return null;
    if (e.shape.kind === 'procedural' && BACKDROP.has(e.shape.generator))
        return null;
    const raw = e.name
        .replace(/[#№]\s*\d+$/u, '')
        .replace(/[\s_-]*\(?\d+\)?$/u, '')
        .trim();
    let name = raw;
    if (!name) {
        if (e.shape.kind === 'procedural')
            name = e.shape.generator.replace(/[-_]+/g, ' ');
        else if (e.shape.kind === 'asset')
            name = (e.shape.id.split(/[/:]/).pop() ?? '').replace(/[-_]+/g, ' ');
        else if (e.shape.kind === 'scatter')
            name = 'scatter';
        else if (e.shape.kind === 'primitive')
            name = e.shape.primitive;
    }
    name = name.slice(0, 40).trim();
    if (!name)
        return null;
    return { key: name.toLowerCase(), name: name.charAt(0).toUpperCase() + name.slice(1) };
}
/**
 * Annotations for the top-level entities `after` adds to `before` (all of
 * them for a first world), largest groups first, at most
 * {@link MAX_PLAN_MARKS}. A group's label sits above the centroid of its
 * members' positions.
 */
export function planMarks(before, after) {
    const groups = new Map();
    for (const id of Object.keys(after.entities)) {
        if (before && Object.prototype.hasOwnProperty.call(before.entities, id))
            continue;
        const e = after.entities[id];
        if (!e || e.parent !== null)
            continue;
        const k = planKey(e);
        if (!k)
            continue;
        const p = e.transform.position;
        const g = groups.get(k.key) ?? { name: k.name, count: 0, x: 0, y: 0, z: 0, top: -Infinity };
        g.count++;
        g.x += p[0];
        g.y += p[1];
        g.z += p[2];
        g.top = Math.max(g.top, p[1]);
        groups.set(k.key, g);
    }
    return [...groups.entries()]
        .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
        .slice(0, MAX_PLAN_MARKS)
        .map(([key, g]) => ({
        id: `plan:${key}`,
        name: g.name,
        metric: g.count > 1 ? `×${g.count}` : 'new',
        position: [g.x / g.count, Math.max(g.y / g.count, g.top) + 1.4, g.z / g.count],
        tone: 'plan',
    }));
}

/**
 * Patches that take a world back to an earlier state of itself: the compare loop keeps the best round and
 * rolls the room back to it when a round made things worse. Only entities are restored (the photo flow
 * edits nothing else after the shell exists).
 */
import { hasOwn, stableStringify } from '@aether/core';
/**
 * Patches that turn `current` into `target` for the entities of both. Entities that exist only in `current`
 * are removed, those only in `target` are added (parents first), and a changed entity is replaced (removed and
 * added again) unless it has children, in which case its fields are updated in place.
 */
export function restorePatches(current, target) {
    const parents = new Set();
    for (const e of Object.values(current.entities))
        if (e.parent)
            parents.add(e.parent);
    const removes = [];
    const adds = [];
    const updates = [];
    for (const e of Object.values(current.entities)) {
        if (!hasOwn(target.entities, e.id))
            removes.push({ op: 'remove', id: e.id });
    }
    for (const t of Object.values(target.entities)) {
        const c = hasOwn(current.entities, t.id) ? current.entities[t.id] : undefined;
        if (!c) {
            adds.push(t);
            continue;
        }
        if (stableStringify(c) === stableStringify(t))
            continue;
        if (parents.has(t.id)) {
            const set = {};
            for (const [k, v] of Object.entries(t))
                if (k !== 'id')
                    set[k] = v;
            for (const k of Object.keys(c))
                if (k !== 'id' && !hasOwn(t, k))
                    set[k] = null;
            updates.push({ op: 'update', id: t.id, set });
        }
        else {
            removes.push({ op: 'remove', id: t.id });
            adds.push(t);
        }
    }
    // Parents before children.
    const placed = new Set(Object.keys(current.entities).filter((id) => hasOwn(target.entities, id) && !removes.some((r) => r.id === id)));
    const ordered = [];
    let pending = adds.slice();
    for (let guard = 0; pending.length > 0 && guard < 64; guard++) {
        const next = [];
        for (const e of pending) {
            if (!e.parent || placed.has(e.parent) || !pending.some((p) => p.id === e.parent)) {
                ordered.push(e);
                placed.add(e.id);
            }
            else
                next.push(e);
        }
        if (next.length === pending.length) {
            ordered.push(...next);
            break;
        }
        pending = next;
    }
    return [...removes, ...ordered.map((entity) => ({ op: 'add', entity })), ...updates];
}

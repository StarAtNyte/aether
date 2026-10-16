/** Search and sort for project lists (pure). */
import { fuzzyScore } from '../lib/fuzzy';
/** Sort labels in menu order. */
export const PROJECT_SORTS = [
    ['updated', 'Last updated'],
    ['name', 'Name'],
    ['created', 'Date created'],
];
/** True for a valid sort key (e.g. one read back from storage). */
export function isProjectSort(v) {
    return v === 'updated' || v === 'name' || v === 'created';
}
/** Sorted copy: newest first for dates, A→Z (locale-aware, numeric) for names; ties by id. */
export function sortProjects(list, sort) {
    const out = [...list];
    out.sort((a, b) => {
        let d = 0;
        if (sort === 'name')
            d = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
        else if (sort === 'created')
            d = b.createdAt - a.createdAt;
        else
            d = b.updatedAt - a.updatedAt;
        return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out;
}
/** Projects whose name fuzzy-matches `query`, best match first; all of them (in order) for an empty query. */
export function searchProjects(list, query) {
    const q = query.trim();
    if (q === '')
        return [...list];
    const scored = [];
    list.forEach((p, i) => {
        const s = fuzzyScore(q, p.name);
        if (s !== null)
            scored.push({ p, s, i });
    });
    scored.sort((a, b) => b.s - a.s || a.i - b.i);
    return scored.map((x) => x.p);
}

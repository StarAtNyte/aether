import { isPlainObject } from './json';
/** Most entities reported (keeps prompts small). */
const MAX_MARKED = 48;
/** Most paths kept per entity. */
const MAX_PATHS = 8;
/** Dotted property paths of an update `set`, two levels deep ("transform.position", "material.color", "visible"). */
export function updatePaths(set) {
    const out = [];
    for (const key of Object.keys(set)) {
        const v = set[key];
        if (isPlainObject(v) && key !== 'state') {
            const sub = Object.keys(v);
            if (sub.length === 0)
                out.push(key);
            for (const k of sub)
                out.push(`${key}.${k}`);
        }
        else
            out.push(key);
    }
    return out;
}
/**
 * Marks of the user edits among the latest `maxCommits` commits (newest
 * first). Renames are followed, so marks use current ids; removed entities
 * are dropped.
 */
export function userEditMarks(commits, opts = {}) {
    const marks = new Map();
    const alias = new Map();
    const removed = new Set();
    const current = (id) => alias.get(id) ?? id;
    const limit = Math.max(0, Math.min(commits.length, opts.maxCommits ?? 40));
    const add = (rawId, paths, age) => {
        const id = current(rawId);
        if (removed.has(id) || (opts.exists && !opts.exists(id)))
            return;
        let m = marks.get(id);
        if (!m) {
            if (marks.size >= MAX_MARKED)
                return;
            m = { paths: [], age };
            marks.set(id, m);
        }
        for (const p of paths)
            if (m.paths.length < MAX_PATHS && !m.paths.includes(p))
                m.paths.push(p);
    };
    for (let age = 0; age < limit; age++) {
        const c = commits[age];
        const user = c.source === 'user';
        for (let i = c.patches.length - 1; i >= 0; i--) {
            const p = c.patches[i];
            switch (p.op) {
                case 'rename':
                    alias.set(p.id, current(p.newId));
                    if (user)
                        add(p.id, ['id'], age);
                    break;
                case 'remove':
                    if (!alias.has(p.id))
                        removed.add(p.id);
                    break;
                case 'update':
                    if (user)
                        add(p.id, updatePaths(p.set), age);
                    break;
                case 'add':
                    if (user)
                        add(p.entity.id, ['added'], age);
                    break;
                default:
                    break;
            }
        }
    }
    return marks;
}
/** Paths of `marked` that the update `set` would overwrite ("transform" overlaps "transform.position"). */
export function overlappingPaths(marked, set) {
    const touched = updatePaths(set);
    const out = [];
    for (const m of marked) {
        if (m === 'added' || m === 'id')
            continue;
        if (touched.some((t) => t === m || t.startsWith(`${m}.`) || m.startsWith(`${t}.`)))
            out.push(m);
    }
    return out;
}

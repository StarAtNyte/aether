/** Search and sort for project lists (pure). */
import { fuzzyScore } from '../lib/fuzzy';
import type { ProjectMeta } from './model';

/** Sort keys offered on the Projects page. */
export type ProjectSort = 'updated' | 'name' | 'created';

/** Sort labels in menu order. */
export const PROJECT_SORTS: ReadonlyArray<[ProjectSort, string]> = [
  ['updated', 'Last updated'],
  ['name', 'Name'],
  ['created', 'Date created'],
];

/** True for a valid sort key (e.g. one read back from storage). */
export function isProjectSort(v: unknown): v is ProjectSort {
  return v === 'updated' || v === 'name' || v === 'created';
}

/** Sorted copy: newest first for dates, A→Z (locale-aware, numeric) for names; ties by id. */
export function sortProjects(list: readonly ProjectMeta[], sort: ProjectSort): ProjectMeta[] {
  const out = [...list];
  out.sort((a, b) => {
    let d = 0;
    if (sort === 'name') d = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    else if (sort === 'created') d = b.createdAt - a.createdAt;
    else d = b.updatedAt - a.updatedAt;
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/** Projects whose name fuzzy-matches `query`, best match first; all of them (in order) for an empty query. */
export function searchProjects(list: readonly ProjectMeta[], query: string): ProjectMeta[] {
  const q = query.trim();
  if (q === '') return [...list];
  const scored: Array<{ p: ProjectMeta; s: number; i: number }> = [];
  list.forEach((p, i) => {
    const s = fuzzyScore(q, p.name);
    if (s !== null) scored.push({ p, s, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map((x) => x.p);
}

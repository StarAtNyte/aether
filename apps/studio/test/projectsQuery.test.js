import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../src/lib/fuzzy';
import { formatRelative, formatTimestamp } from '../src/lib/relativeTime';
import { PROJECTS_SCHEMA_VERSION } from '../src/projects/model';
import { isProjectSort, searchProjects, sortProjects } from '../src/projects/query';
function meta(id, name, createdAt, updatedAt) {
    return { v: PROJECTS_SCHEMA_VERSION, id, name, createdAt, updatedAt, openedAt: updatedAt, template: null, entityCount: 1, hasThumbnail: false };
}
describe('relative time', () => {
    const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
    it('formats recent times compactly', () => {
        expect(formatRelative(now, now)).toBe('Just now');
        expect(formatRelative(now - 30_000, now)).toBe('Just now');
        expect(formatRelative(now - 5 * 60_000, now)).toBe('5m ago');
        expect(formatRelative(now - 2 * 3600_000, now)).toBe('2h ago');
        expect(formatRelative(now - 30 * 3600_000, now)).toBe('Yesterday');
        expect(formatRelative(now - 3 * 86400_000, now)).toBe('3d ago');
    });
    it('switches to calendar dates after a week and shows the year when it differs', () => {
        expect(formatRelative(new Date(2026, 2, 4).getTime(), now)).toBe('Mar 4');
        expect(formatRelative(new Date(2025, 2, 4).getTime(), now)).toBe('Mar 4, 2025');
    });
    it('treats future and invalid times as now', () => {
        expect(formatRelative(now + 60_000, now)).toBe('Just now');
        expect(formatRelative(Number.NaN, now)).toBe('Just now');
        expect(formatTimestamp(Number.NaN)).toBe('');
        expect(formatTimestamp(new Date(2026, 2, 4, 9, 5).getTime())).toBe('4 Mar 2026, 09:05');
    });
});
describe('fuzzy matching', () => {
    it('matches subsequences, rejects others, scores substrings and word starts higher', () => {
        expect(fuzzyScore('', 'anything')).toBe(0);
        expect(fuzzyScore('xyz', 'lakeside camp')).toBeNull();
        const sub = fuzzyScore('camp', 'lakeside camp') ?? 0;
        const fuzzy = fuzzyScore('lcp', 'lakeside camp') ?? 0;
        expect(sub).toBeGreaterThan(fuzzy);
        expect(fuzzyScore('lak', 'Lakeside camp') ?? 0).toBeGreaterThan(fuzzyScore('sid', 'Lakeside camp') ?? 0);
        expect(fuzzyScore('LAKE', 'lakeside')).not.toBeNull();
    });
    it('filters best-first, stable for ties, with a limit', () => {
        const items = ['Domino run', 'Coin island', 'Asteroid field', 'Obstacle course'];
        expect(fuzzyFilter(items, 'o', (s) => s, 2)).toHaveLength(2);
        expect(fuzzyFilter(items, 'coin', (s) => s)).toEqual(['Coin island']);
        expect(fuzzyFilter(items, '', (s) => s)).toEqual(items);
    });
    it('caps hostile query length', () => {
        expect(() => fuzzyScore('a'.repeat(10_000), 'a'.repeat(10_000))).not.toThrow();
    });
});
describe('project search and sort', () => {
    const list = [meta('aaaaaaaa', 'Zeta', 3, 30), meta('bbbbbbbb', 'alpha', 1, 50), meta('cccccccc', 'Beta 10', 2, 40), meta('dddddddd', 'Beta 9', 4, 40)];
    it('sorts by updated (newest first, ties by id), name (natural, case-insensitive) and created', () => {
        expect(sortProjects(list, 'updated').map((p) => p.name)).toEqual(['alpha', 'Beta 10', 'Beta 9', 'Zeta']);
        expect(sortProjects(list, 'name').map((p) => p.name)).toEqual(['alpha', 'Beta 9', 'Beta 10', 'Zeta']);
        expect(sortProjects(list, 'created').map((p) => p.name)).toEqual(['Beta 9', 'Zeta', 'Beta 10', 'alpha']);
        expect(list[0]?.name).toBe('Zeta');
    });
    it('searches by fuzzy name, keeping order for an empty query', () => {
        expect(searchProjects(list, '').map((p) => p.id)).toEqual(list.map((p) => p.id));
        expect(searchProjects(list, 'beta').map((p) => p.name)).toEqual(['Beta 10', 'Beta 9']);
        expect(searchProjects(list, 'nope')).toEqual([]);
    });
    it('validates sort keys', () => {
        expect(isProjectSort('name')).toBe(true);
        expect(isProjectSort('evil')).toBe(false);
        expect(isProjectSort(undefined)).toBe(false);
    });
});

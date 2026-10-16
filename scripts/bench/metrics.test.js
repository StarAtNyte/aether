import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { changedLeaves, estimateTokens, formatRate, isFix, isRegression, jsonTokens, leaves, mean, median, percentile, projectedLatencyMs, rate, realtimeMultiple, round, scoreChange, worldChanges } from './metrics';
function world(entities, extra = {}) {
    return { ...createWorld(), entities: entities, ...extra };
}
const ent = (x, color = '#fff', scale = 1) => ({ id: 'e', transform: { position: [x, 0, 0], scale: [scale, scale, scale] }, material: { color } });
describe('statistics', () => {
    it('estimates tokens as ceil(chars / 4)', () => {
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('abcde')).toBe(2);
        expect(jsonTokens({ a: 1 })).toBe(estimateTokens('{"a":1}'));
    });
    it('computes mean, median and interpolated percentiles', () => {
        expect(mean([])).toBe(0);
        expect(mean([1, 2, 3, 4])).toBe(2.5);
        expect(median([5, 1, 3])).toBe(3);
        expect(median([1, 2, 3, 4])).toBe(2.5);
        expect(percentile([10, 20, 30, 40, 50], 90)).toBeCloseTo(46);
        expect(percentile([7], 99)).toBe(7);
        expect(percentile([], 50)).toBe(0);
        expect(percentile([1, 2], 500)).toBe(2);
    });
    it('gives Wilson intervals that bracket the rate and stay within [0, 1]', () => {
        const r = rate(8, 10);
        expect(r.rate).toBe(0.8);
        expect(r.lo).toBeGreaterThan(0.4);
        expect(r.lo).toBeLessThan(0.8);
        expect(r.hi).toBeGreaterThan(0.8);
        expect(r.hi).toBeLessThanOrEqual(1);
        const zero = rate(0, 20);
        expect(zero.lo).toBe(0);
        expect(zero.hi).toBeGreaterThan(0);
        const all = rate(20, 20);
        expect(all.hi).toBe(1);
        expect(all.lo).toBeLessThan(1);
        expect(rate(0, 0)).toEqual({ k: 0, n: 0, rate: 0, lo: 0, hi: 0 });
        expect(formatRate(rate(0, 0))).toContain('n/a');
        expect(formatRate(rate(3, 4))).toMatch(/^3\/4 \(75%, 95% CI \d+-\d+%\)$/);
    });
    it('converts simulated time and wall time into a realtime multiple', () => {
        expect(realtimeMultiple(10, 500)).toBe(20);
        expect(realtimeMultiple(10, 0)).toBe(0);
        expect(round(1.2345, 2)).toBe(1.23);
    });
    it('projects latency from measured compute plus an assumed generation rate', () => {
        expect(projectedLatencyMs(100, 600, 60)).toBe(10_100);
        expect(projectedLatencyMs(100, 600, 0)).toBe(100);
    });
    it('classifies regressions and fixes', () => {
        expect(isRegression({ before: true, after: false })).toBe(true);
        expect(isRegression({ before: false, after: false })).toBe(false);
        expect(isFix({ before: false, after: true })).toBe(true);
        expect(isFix({ before: true, after: true })).toBe(false);
    });
});
describe('leaf diffs', () => {
    it('flattens objects and arrays to dotted paths and keeps empty containers', () => {
        const l = leaves({ a: { b: [1, { c: 2 }] }, e: [], o: {}, n: null });
        expect([...l.keys()].sort()).toEqual(['a.b.0', 'a.b.1.c', 'e', 'n', 'o']);
        expect(l.get('a.b.1.c')).toBe(2);
    });
    it('lists added, removed and modified leaves, and none for equal values', () => {
        expect(changedLeaves({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([]);
        expect(changedLeaves({ a: 1, b: [1, 2] }, { a: 2, b: [1, 2, 3], c: 1 })).toEqual(['a', 'b.2', 'c']);
        expect(changedLeaves({ a: { x: 1 } }, { a: {} })).toEqual(['a', 'a.x']);
    });
    it('caps the number of leaves', () => {
        const big = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
        expect(leaves(big, 10).size).toBe(10);
    });
});
describe('worldChanges', () => {
    it('reports added, removed and modified entities and changed sections', () => {
        const a = world({ keep: ent(0), gone: ent(1), tint: ent(2) }, { name: 'one' });
        const b = world({ keep: ent(0), tint: ent(2, '#f00'), fresh: ent(3) }, { name: 'two' });
        const c = worldChanges(a, b);
        expect(c.added).toEqual(['fresh']);
        expect(c.removed).toEqual(['gone']);
        expect(Object.keys(c.modified)).toEqual(['tint']);
        expect(c.modified['tint']).toEqual(['material.color']);
        expect(c.sections.meta).toEqual(['name']);
        expect(c.sections.environment).toBeUndefined();
    });
    it('is empty for identical worlds', () => {
        const a = world({ x: ent(0) });
        const c = worldChanges(a, structuredClone(a));
        expect(c.added).toEqual([]);
        expect(c.removed).toEqual([]);
        expect(c.modified).toEqual({});
        expect(c.sections).toEqual({});
    });
});
describe('scoreChange', () => {
    const recolor = { targets: ['tent-1', 'tent-2'], allowedPaths: [/^material\.color$/] };
    it('accepts a precise recolor with zero collateral', () => {
        const a = world({ 'tent-1': ent(0), 'tent-2': ent(1), 'tree-1': ent(2) });
        const b = world({ 'tent-1': ent(0, '#f00'), 'tent-2': ent(1, '#f00'), 'tree-1': ent(2) });
        const s = scoreChange(worldChanges(a, b), recolor);
        expect(s.satisfied).toBe(true);
        expect(s.collateralLeaves).toBe(0);
        expect(s.collateralEntities).toBe(0);
        expect(s.totalLeaves).toBe(2);
    });
    it('reports partial completion when only some of the named objects changed', () => {
        const a = world({ 'tent-1': ent(0), 'tent-2': ent(1) });
        const half = scoreChange(worldChanges(a, world({ 'tent-1': ent(0, '#f00'), 'tent-2': ent(1) })), recolor);
        expect(half.satisfied).toBe(false);
        expect(half.completion).toBe(0.5);
        const full = scoreChange(worldChanges(a, world({ 'tent-1': ent(0, '#f00'), 'tent-2': ent(1, '#f00') })), recolor);
        expect(full.completion).toBe(1);
        expect(scoreChange(worldChanges(a, a), recolor).completion).toBe(0);
        const removed = scoreChange(worldChanges(a, world({ 'tent-2': ent(1) })), { targets: ['tent-1', 'tent-2'], expectRemoved: ['tent-1', 'tent-2'] });
        expect(removed.completion).toBe(0.5);
    });
    it('is unsatisfied when a target did not change', () => {
        const a = world({ 'tent-1': ent(0), 'tent-2': ent(1) });
        const b = world({ 'tent-1': ent(0, '#f00'), 'tent-2': ent(1) });
        expect(scoreChange(worldChanges(a, b), recolor).satisfied).toBe(false);
    });
    it('counts unrequested property changes, removals and additions as collateral', () => {
        const a = world({ 'tent-1': ent(0), 'tent-2': ent(1), 'tree-1': ent(2), 'rock-1': ent(5) });
        const b = world({ 'tent-1': ent(0, '#f00', 2), 'tent-2': ent(1, '#f00'), 'tree-1': ent(9), 'bush-1': ent(4) });
        const s = scoreChange(worldChanges(a, b), recolor);
        expect(s.satisfied).toBe(true);
        // tent-1 scale (3 leaves), tree-1 position.0, rock-1 removed, bush-1 added
        expect(s.collateralLeaves).toBe(3 + 1 + 1 + 1);
        expect(s.collateralEntities).toBe(4);
        expect(s.collateralRemoved).toBe(1);
        expect(s.collateralAdded).toBe(1);
        expect(s.examples.length).toBeGreaterThan(0);
    });
    it('scores removals', () => {
        const a = world({ 'tent-1': ent(0), 'tree-1': ent(2) });
        const b = world({ 'tree-1': ent(2) });
        expect(scoreChange(worldChanges(a, b), { targets: ['tent-1'], expectRemoved: ['tent-1'] })).toMatchObject({ satisfied: true, collateralLeaves: 0 });
        const c = world({});
        expect(scoreChange(worldChanges(a, c), { targets: ['tent-1'], expectRemoved: ['tent-1'] })).toMatchObject({ satisfied: true, collateralRemoved: 1 });
        expect(scoreChange(worldChanges(a, a), { targets: ['tent-1'], expectRemoved: ['tent-1'] }).satisfied).toBe(false);
    });
    it('scores additions by id pattern and minimum count', () => {
        const a = world({ 'tree-1': ent(2) });
        const b = world({ 'tree-1': ent(2), 'rock-1': ent(3), 'rock-2': ent(4), 'bush-1': ent(5) });
        const intent = { targets: [], expectAdded: { min: 2, match: /^rock-/ } };
        const s = scoreChange(worldChanges(a, b), intent);
        expect(s.satisfied).toBe(true);
        expect(s.collateralAdded).toBe(1);
        expect(scoreChange(worldChanges(a, b), { targets: [], expectAdded: { min: 3, match: /^rock-/ } }).satisfied).toBe(false);
    });
    it('scores section edits and flags changes outside the allowed paths', () => {
        const a = world({ x: ent(0) });
        const env = { ...a.environment, timeOfDay: 22 };
        const b = { ...a, environment: env, name: 'renamed' };
        const intent = { targets: [], allowedSections: { environment: [/^timeOfDay$/] }, requireSections: ['environment'] };
        const s = scoreChange(worldChanges(a, b), intent);
        expect(s.satisfied).toBe(true);
        expect(s.collateralLeaves).toBe(1);
        expect(scoreChange(worldChanges(a, a), intent).satisfied).toBe(false);
    });
    it('never counts an empty intent as satisfied', () => {
        const a = world({ x: ent(0) });
        expect(scoreChange(worldChanges(a, a), { targets: [] }).satisfied).toBe(false);
    });
});

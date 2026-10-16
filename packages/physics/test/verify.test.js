import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { summarizeReport, verify } from '../src/index';
import { ball, box, dominoes, world } from './helpers';
describe('verify — domino benchmark', () => {
    it('passes `topples` for 30 dominoes at 0.4m spacing', async () => {
        const report = await verify(dominoes(30, 0.4), { budgetMs: 10_000 });
        expect(report.results[0]?.message).toMatch(/all 30 toppled/);
        expect(report.results[0]?.passed).toBe(true);
        expect(report.passed).toBe(true);
        expect(report.results[0]?.atTime ?? 99).toBeLessThan(10);
    });
    it('fails `topples` at 1.2m spacing with an actionable message', async () => {
        const report = await verify(dominoes(30, 1.2), { budgetMs: 10_000 });
        expect(report.passed).toBe(false);
        const r = report.results[0];
        expect(r?.passed).toBe(false);
        expect(r?.message).toMatch(/^1\/30 toppled within 10s; not: domino-1/);
        expect(report.simulatedSeconds).toBeCloseTo(10, 1);
    });
});
describe('verify — test kinds', () => {
    it('evaluates stable, noOverlap, moves, staysAbove and reaches', async () => {
        const doc = world([
            box('crate', [0, 0.5, 5], [1, 1, 1]),
            ball('ball', [-5, 3, 0], 0.3, { body: 'dynamic', initialVelocity: [4, 0, 0] }),
            { id: 'goal', shape: { kind: 'primitive', primitive: 'box', size: [1, 2, 4] }, transform: { position: [3, 1, 0] }, physics: { body: 'static', sensor: true } },
            box('pit', [20, 5, 0], [1, 1, 1]),
        ], {
            environment: { ground: { material: { preset: 'grass' }, size: 30 } },
            tests: [
                { id: 'rest', kind: 'stable', target: 'crate', seconds: 1 },
                { id: 'clear', kind: 'noOverlap' },
                { id: 'rolls', kind: 'moves', target: 'ball', distance: 2 },
                { id: 'safe', kind: 'staysAbove', target: 'crate', y: 0, within: 2 },
                { id: 'goal', kind: 'reaches', target: 'ball', zone: 'goal', within: 5 },
                { id: 'sphere', kind: 'reaches', target: 'ball', zone: { center: [0, 0.3, 0], radius: 1.5 }, within: 5 },
                { id: 'falls', kind: 'staysAbove', target: 'pit', y: -1, within: 5 },
                { id: 'nobody', kind: 'moves', target: '#ghost' },
            ],
        });
        const report = await verify(doc, { budgetMs: 10_000 });
        const by = Object.fromEntries(report.results.map((r) => [r.id, r]));
        expect(by.rest?.passed).toBe(true);
        expect(by.clear?.passed).toBe(true);
        expect(by.rolls?.passed).toBe(true);
        expect(by.safe?.passed).toBe(true);
        expect(by.goal?.passed).toBe(true);
        expect(by.sphere?.passed).toBe(true);
        expect(by.falls?.passed).toBe(false);
        expect(by.falls?.message).toMatch(/pit fell to y=/);
        expect(by.nobody?.passed).toBe(false);
        expect(by.nobody?.message).toMatch(/matched no entities/);
        expect(report.results.map((r) => r.id)).toEqual(['rest', 'clear', 'rolls', 'safe', 'goal', 'sphere', 'falls', 'nobody']);
    });
    it('fails noOverlap/stable for interpenetrating stacks and reports diagnostics', async () => {
        const doc = world([box('a', [0, 0.5, 0], [1, 1, 1]), box('b', [0, 1.2, 0], [1, 1, 1])], {
            tests: [{ id: 'clear', kind: 'noOverlap' }, { id: 'rest', kind: 'stable', target: '*', seconds: 1, maxDrift: 0.05 }],
        });
        const report = await verify(doc);
        expect(report.results[0]?.passed).toBe(false);
        expect(report.results[0]?.message).toMatch(/a\/b by 0\.3m/);
        expect(report.results[1]?.passed).toBe(false);
        expect(report.diagnostics.some((d) => d.code === 'overlap' && d.severity === 'error')).toBe(true);
        expect(report.passed).toBe(false);
        expect(summarizeReport(report)).toMatch(/^PHYSICS VERIFY FAIL: 0\/2 tests passed/);
    });
    it('runs logic hooks for `eventually` and falls back to world state without one', async () => {
        const doc = world([box('button', [0, 0.5, 0], [1, 1, 1], { body: 'static', sensor: true }), ball('ball', [0, 4, 0], 0.3)], {
            state: { score: 0, ready: true },
            tests: [
                { id: 'scored', kind: 'eventually', condition: { key: 'score', op: '>=', value: 1 }, within: 3 },
                { id: 'ready', kind: 'eventually', condition: { key: 'ready', op: '==', value: true } },
            ],
        });
        let ticks = 0;
        const logic = (pw) => {
            let score = 0;
            expect(pw.has('ball')).toBe(true);
            return {
                tick: (_dt, _pw, events) => {
                    ticks++;
                    for (const e of events)
                        if (e.type === 'sensorEnter' && e.a === 'button')
                            score++;
                },
                readState: (key) => (key === 'score' ? score : undefined),
            };
        };
        const report = await verify(doc, { logic });
        expect(report.results[0]?.passed).toBe(true);
        expect(report.results[1]?.passed).toBe(true);
        expect(report.results[1]?.atTime).toBe(0);
        expect(ticks).toBeGreaterThan(10);
        const without = await verify(doc, { maxSeconds: 3 });
        expect(without.results[0]?.passed).toBe(false);
        expect(without.results[0]?.message).toMatch(/score was 0; expected >= 1 within 3s \(no logic hook/);
        const broken = await verify(doc, { logic: () => ({ tick: () => { throw new Error('boom'); }, readState: () => undefined }) });
        expect(broken.results[0]?.message).toMatch(/logic error: boom/);
    });
    it('respects the wall-clock budget and maxSeconds', async () => {
        const heavy = dominoes(30, 0.4);
        const t0 = performance.now();
        const report = await verify(heavy, { budgetMs: 25 });
        const elapsed = performance.now() - t0;
        expect(elapsed).toBeLessThan(1000);
        expect(report.passed).toBe(false);
        expect(report.results[0]?.message).toMatch(/inconclusive: wall-clock budget of 25ms/);
        expect(report.simulatedSeconds).toBeLessThan(10);
        const short = await verify(heavy, { maxSeconds: 1, budgetMs: 5000 });
        expect(short.simulatedSeconds).toBeCloseTo(1, 1);
        expect(short.results[0]?.message).toMatch(/not decided/);
    });
    it('handles worlds without tests', async () => {
        const report = await verify(createWorld({}));
        expect(report).toMatchObject({ passed: true, results: [], simulatedSeconds: 0 });
        expect(summarizeReport(report)).toMatch(/PASS: no tests/);
    });
});
describe('verify cooperative scheduling', () => {
    it('yields to the event loop between stepping slices without changing the result', async () => {
        let ticks = 0;
        let running = true;
        const pump = () => {
            if (!running)
                return;
            ticks++;
            setImmediate(pump);
        };
        setImmediate(pump);
        const sliced = await verify(dominoes(30, 0.4), { budgetMs: 10_000, sliceMs: 1 });
        running = false;
        const unsliced = await verify(dominoes(30, 0.4), { budgetMs: 10_000, sliceMs: 0 });
        expect(ticks).toBeGreaterThan(1);
        expect(sliced.passed).toBe(unsliced.passed);
        expect(sliced.simulatedSeconds).toBe(unsliced.simulatedSeconds);
        expect(sliced.results.map((r) => r.passed)).toEqual(unsliced.results.map((r) => r.passed));
    });
});

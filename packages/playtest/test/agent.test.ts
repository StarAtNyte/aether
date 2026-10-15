import { describe, expect, it } from 'vitest';
import { playtest } from '../src';
import { coin, gameWorld, goalAt, slab, winAt } from './helpers';

describe('playtest: a solvable coin game', () => {
  it('collects every coin and wins', async () => {
    const world = gameWorld(
      [coin('c1', [4, 1, 0]), coin('c2', [4, 1, 6]), coin('c3', [-5, 1, 6])],
      { rules: [winAt(3)], state: { score: 0 } },
    );
    const report = await playtest(world);
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(report.status).toBe('passed');
    expect(report.won).toBe(true);
    expect(report.objectives.filter((o) => o.status === 'done')).toHaveLength(3);
    expect(report.trace?.frames).toBeGreaterThan(5);
    expect(report.summary).toMatch(/^Verified playable/);
  }, 60_000);

  it('reaches a goal on a platform it has to jump up to', async () => {
    const world = gameWorld(
      [slab('step1', [4, 0.6, 0], [3, 1.2, 3]), slab('step2', [7.5, 1.1, 0], [3, 2.2, 3]), goalAt('exit', [7.5, 3.3, 0])],
      {},
    );
    const report = await playtest(world);
    expect(report.status).toBe('passed');
    expect(report.outcome).toBe('win');
  }, 60_000);
});

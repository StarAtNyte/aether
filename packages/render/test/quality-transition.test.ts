import { describe, expect, it } from 'vitest';
import { QualityTransition, TRANSITION_MAX_MS, TRANSITION_QUIET_MS } from '../src/view/quality-transition';

const busy = { programs: true, light: false };
const light = { programs: false, light: true };
const quiet = { programs: false, light: false };

/** Feed `work` every 16 ms from `t0` for `ms`; returns the time reached. */
function run(q: QualityTransition, work: typeof quiet, t0: number, ms: number): number {
  let t = t0;
  for (; t < t0 + ms; t += 16) q.update(work, t);
  return t;
}

describe('quality tier transition', () => {
  it('is idle until a tier is chosen and reports nothing', () => {
    const q = new QualityTransition();
    expect(q.state).toBeNull();
    expect(q.update(busy, 0)).toBe(false);
    expect(q.state).toBeNull();
  });

  it('low to ultra: holds through the program rebuild and the light, then ends once quiet', () => {
    const q = new QualityTransition();
    q.begin('ultra', 1000);
    expect(q.state).toEqual({ tier: 'ultra', stage: 'programs', since: 1000 });
    let t = run(q, busy, 1000, 3000);
    expect(q.state?.stage).toBe('programs');
    // The programs are linked; the lightmap gets its look.
    t = run(q, light, t, 1500);
    expect(q.state?.stage).toBe('light');
    t = run(q, quiet, t, TRANSITION_QUIET_MS + 50);
    expect(q.state).toBeNull();
    expect(q.timedOut).toBe(0);
  });

  it('ultra to low: a short quiet gap between the rebuild and the bake decision does not end it early', () => {
    const q = new QualityTransition();
    q.begin('low', 0);
    let t = run(q, busy, 0, 500);
    t = run(q, quiet, t, TRANSITION_QUIET_MS / 2);
    expect(q.state).not.toBeNull();
    t = run(q, light, t, 300);
    t = run(q, quiet, t, TRANSITION_QUIET_MS / 2);
    expect(q.state).not.toBeNull();
    run(q, quiet, t, TRANSITION_QUIET_MS);
    expect(q.state).toBeNull();
  });

  it('auto to ultra with nothing to rebuild ends after the quiet time', () => {
    const q = new QualityTransition();
    q.begin('ultra', 0);
    run(q, quiet, 0, TRANSITION_QUIET_MS + 40);
    expect(q.state).toBeNull();
  });

  it('rapid toggles: the newest tier wins and the bound restarts from the last choice', () => {
    const q = new QualityTransition();
    q.begin('ultra', 0);
    run(q, busy, 0, 200);
    q.begin('low', 200);
    run(q, busy, 200, 100);
    q.begin('ultra', 300);
    expect(q.state).toEqual({ tier: 'ultra', stage: 'programs', since: 300 });
    expect(q.started).toBe(3);
    // Still busy past the first choice's bound: not yet timed out, counted from 300.
    q.update(busy, TRANSITION_MAX_MS + 100);
    expect(q.state?.tier).toBe('ultra');
    q.update(quiet, TRANSITION_MAX_MS + 200);
    q.update(quiet, TRANSITION_MAX_MS + 200 + TRANSITION_QUIET_MS);
    expect(q.state).toBeNull();
  });

  it('never stays stuck: work that never finishes ends at the bound', () => {
    const q = new QualityTransition();
    q.begin('ultra', 0);
    expect(q.update(busy, TRANSITION_MAX_MS - 1)).toBe(false);
    expect(q.state).not.toBeNull();
    expect(q.update(busy, TRANSITION_MAX_MS)).toBe(true);
    expect(q.state).toBeNull();
    expect(q.timedOut).toBe(1);
  });

  it('reports a change when the stage moves and when it ends', () => {
    const q = new QualityTransition();
    q.begin('high', 0);
    expect(q.update(busy, 10)).toBe(false);
    expect(q.update(light, 20)).toBe(true);
    expect(q.update(quiet, 30)).toBe(false);
    expect(q.update(quiet, 30 + TRANSITION_QUIET_MS)).toBe(true);
    q.begin('low', 1000);
    q.end();
    expect(q.state).toBeNull();
  });
});

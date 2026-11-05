import { describe, expect, it } from 'vitest';
import { FRAME_BUDGET_MS, FrameBudget, MOTION_HOLD_MS } from '../src/streaming/frame-budget';

function clocked() {
  let t = 1000;
  const budget = new FrameBudget(() => t);
  return { budget, advance: (ms: number) => void (t += ms) };
}

describe('FrameBudget', () => {
  it('gives 8 ms a frame at rest and 2 ms while the view moves', () => {
    const { budget, advance } = clocked();
    budget.beginFrame(false);
    expect(budget.mode).toBe('rest');
    expect(budget.sliceMs()).toBe(FRAME_BUDGET_MS.rest);
    budget.spend(5);
    expect(budget.sliceMs()).toBe(3);
    budget.spend(3);
    expect(budget.sliceMs()).toBe(0);
    expect(budget.delayMs()).toBeGreaterThan(0);
    advance(5);
    budget.beginFrame(true);
    expect(budget.mode).toBe('moving');
    expect(budget.sliceMs()).toBe(FRAME_BUDGET_MS.moving);
    // Motion holds a moment after the last moving frame, then the rest budget comes back.
    advance(MOTION_HOLD_MS - 10);
    budget.beginFrame(false);
    expect(budget.mode).toBe('moving');
    advance(20);
    budget.beginFrame(false);
    expect(budget.mode).toBe('rest');
  });

  it('refills without frames once a frame of time has passed (the page draws on demand)', () => {
    const { budget, advance } = clocked();
    budget.beginFrame(false);
    budget.spend(20);
    expect(budget.sliceMs()).toBe(0);
    const wait = budget.delayMs();
    expect(wait).toBeGreaterThan(0);
    advance(wait);
    expect(budget.sliceMs()).toBe(FRAME_BUDGET_MS.rest);
    expect(budget.delayMs()).toBe(0);
  });

  it('works in long slices behind the load screen and while something waits on the scene', async () => {
    const { budget } = clocked();
    budget.setLoading(true);
    budget.spend(500);
    expect(budget.mode).toBe('loading');
    expect(budget.sliceMs()).toBe(FRAME_BUDGET_MS.loading);
    expect(budget.delayMs()).toBe(0);
    budget.setLoading(false);
    expect(budget.mode).toBe('rest');
    let release!: () => void;
    const wait = budget.hurry(new Promise<void>((r) => (release = r)));
    expect(budget.mode).toBe('loading');
    release();
    await wait;
    await Promise.resolve();
    expect(budget.mode).toBe('rest');
  });
});

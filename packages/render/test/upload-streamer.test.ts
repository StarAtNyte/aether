import { describe, expect, it } from 'vitest';
import { BufferGeometry, Group, Mesh } from 'three';
import { FrameBudget } from '../src/streaming/frame-budget';
import { SCAN_INTERVAL_MS, UploadStreamer } from '../src/streaming/upload-streamer';

function harness(stepsPerGeometry: number) {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const budget = new FrameBudget(() => t);
  const done = new Map<object, number>();
  let blocked = false;
  const root = new Group();
  const streamer = new UploadStreamer(root, {
    budget,
    blocked: () => blocked,
    now: () => t,
    setTimeout: (fn, ms) => timers.push({ at: t + ms, fn }),
    step: (g) => {
      // Each step costs a millisecond of main thread.
      t += 1;
      const n = (done.get(g as object) ?? 0) + 1;
      done.set(g as object, n);
      return n >= stepsPerGeometry;
    },
  });
  const run = (untilMs: number): void => {
    while (timers.length) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0]!;
      if (next.at > untilMs) break;
      timers.shift();
      t = Math.max(t, next.at);
      next.fn();
    }
  };
  return { root, streamer, budget, done, run, setBlocked: (b: boolean) => void (blocked = b), time: () => t, timers };
}

describe('UploadStreamer', () => {
  it('uploads new geometry in steps within the frame budget', () => {
    const h = harness(5);
    const a = new Mesh(new BufferGeometry());
    const b = new Mesh(new BufferGeometry());
    h.root.add(a, b);
    h.budget.beginFrame(false);
    h.streamer.invalidate();
    // Within one rest frame (8 ms) at most 8 steps of 1 ms run.
    h.run(5);
    const first = [...h.done.values()].reduce((s, n) => s + n, 0);
    expect(first).toBeLessThanOrEqual(9);
    expect(first).toBeGreaterThan(0);
    h.run(200);
    expect(h.done.get(a.geometry)).toBe(5);
    expect(h.done.get(b.geometry)).toBe(5);
    expect(h.streamer.pending).toBe(0);
  });

  it('waits while programs link, skips disposed geometry and scans again after a change', () => {
    const h = harness(2);
    const a = new Mesh(new BufferGeometry());
    h.root.add(a);
    h.setBlocked(true);
    h.streamer.invalidate();
    h.run(100);
    expect(h.done.size).toBe(0);
    h.setBlocked(false);
    h.run(200);
    expect(h.done.get(a.geometry)).toBe(2);
    const b = new Mesh(new BufferGeometry());
    const c = new Mesh(new BufferGeometry());
    h.root.add(b, c);
    // Scanned while programs link, then disposed before its turn.
    h.setBlocked(true);
    h.streamer.invalidate();
    h.run(200 + SCAN_INTERVAL_MS * 2);
    expect(h.streamer.pending).toBe(2);
    c.geometry.dispose();
    h.setBlocked(false);
    h.run(400 + SCAN_INTERVAL_MS * 2);
    expect(h.done.get(b.geometry)).toBe(2);
    expect(h.done.has(c.geometry)).toBe(false);
  });
});

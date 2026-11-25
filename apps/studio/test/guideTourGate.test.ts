/**
 * The guided tour waits for everything (tour-gate.ts): every full model in, nothing left to prepare, the guide ready;
 * a press meanwhile arms it and it starts by itself after a short "Ready"; a stall never holds it past a minute.
 */
import { describe, expect, it } from 'vitest';
import { prepLabel } from '../src/player/guide/GuideUI';
import { READY_BEAT_MS, TOUR_WAIT_MS, TourGate, type GateInput } from '../src/player/guide/tour-gate';

const input = (now: number, done: number, total: number, more: Partial<GateInput> = {}): GateInput => ({ now, upgrades: { done, total }, busy: false, guideReady: true, ...more });

describe('tour gate', () => {
  it('is ready at once when nothing upgrades and the guide is ready', () => {
    const g = new TourGate();
    expect(g.update(input(0, 0, 0))).toBe(false);
    expect(g.prep).toEqual({ ready: true, percent: 100, armed: false, starting: false });
    expect(g.request(10)).toBe(true);
    expect(prepLabel(g.prep)).toBeNull();
  });

  it('waits for the upgrades, the renderer and the guide, reading their progress', () => {
    const g = new TourGate();
    g.update(input(0, 0, 4, { guideReady: false }));
    expect(g.prep.ready).toBe(false);
    expect(g.prep.percent).toBe(0);
    expect(prepLabel(g.prep)).toBe('Preparing the tour… 0%');
    g.update(input(1000, 2, 4, { guideReady: false }));
    expect(g.prep.percent).toBe(40);
    g.update(input(2000, 4, 4, { guideReady: false }));
    expect(g.prep).toMatchObject({ ready: false, percent: 80 });
    // All in, the guide ready, but the renderer still prepares: 99% at most, not ready.
    g.update(input(3000, 4, 4, { busy: true }));
    expect(g.prep).toMatchObject({ ready: false, percent: 99 });
    g.update(input(3100, 4, 4));
    expect(g.prep).toMatchObject({ ready: true, percent: 100 });
    // Once ready it stays ready (a model streaming in later does not take the tour away).
    g.update(input(3200, 4, 5, { busy: true }));
    expect(g.prep.ready).toBe(true);
  });

  it('a press while preparing arms the tour: it starts by itself after the "Ready" beat', () => {
    const g = new TourGate();
    g.update(input(0, 1, 3));
    expect(g.request(500)).toBe(false);
    expect(g.prep).toMatchObject({ armed: true, starting: false });
    // A second press does not start it either.
    expect(g.request(800)).toBe(false);
    expect(g.update(input(1000, 2, 3))).toBe(false);
    expect(prepLabel(g.prep)).toBe('Preparing the tour… 75%');
    // Everything in at 2 s: "Ready", then off READY_BEAT_MS later (once).
    expect(g.update(input(2000, 3, 3))).toBe(false);
    expect(g.prep).toMatchObject({ ready: true, armed: true, starting: true });
    expect(prepLabel(g.prep)).toBe('Ready');
    expect(g.update(input(2000 + READY_BEAT_MS - 1, 3, 3))).toBe(false);
    expect(g.update(input(2000 + READY_BEAT_MS, 3, 3))).toBe(true);
    expect(g.prep).toMatchObject({ ready: true, armed: false, starting: false });
    expect(g.update(input(5000, 3, 3))).toBe(false);
    expect(prepLabel(g.prep)).toBeNull();
  });

  it('an armed tour holds while the visitor types or waits for an answer', () => {
    const g = new TourGate();
    g.update(input(0, 0, 1));
    g.request(0);
    g.update(input(100, 1, 1));
    expect(g.update(input(100 + READY_BEAT_MS * 3, 1, 1, { hold: true }))).toBe(false);
    expect(g.prep.armed).toBe(true);
    expect(g.update(input(100 + READY_BEAT_MS * 4, 1, 1))).toBe(true);
  });

  it('a dismissed card disarms it', () => {
    const g = new TourGate();
    g.update(input(0, 0, 2));
    g.request(0);
    g.disarm();
    expect(g.update(input(100, 2, 2))).toBe(false);
    expect(g.update(input(100 + READY_BEAT_MS, 2, 2))).toBe(false);
    expect(g.prep).toMatchObject({ ready: true, armed: false });
  });

  it('a stalled upgrade does not hold the tour past TOUR_WAIT_MS after the reveal', () => {
    const g = new TourGate();
    g.update(input(10_000, 3, 7));
    g.request(11_000);
    expect(g.update(input(10_000 + TOUR_WAIT_MS - 1, 6, 7))).toBe(false);
    expect(g.prep.ready).toBe(false);
    expect(g.update(input(10_000 + TOUR_WAIT_MS, 6, 7))).toBe(false);
    expect(g.prep).toMatchObject({ ready: true, starting: true });
    expect(g.update(input(10_000 + TOUR_WAIT_MS + READY_BEAT_MS, 6, 7))).toBe(true);
  });

  it('reads the weighted fraction: the bar moves while a file loads, never goes back, reaches 100 only when ready', () => {
    const g = new TourGate();
    const at = (now: number, fraction: number, done = 0, more: Partial<GateInput> = {}) => {
      g.update({ ...input(now, done, 4, more), fraction });
      return g.prep.percent;
    };
    // Four copies, none settled, but the first file is 50% through: (0.5 * 4 + guide 1) / 5 = 60%.
    expect(at(0, 0, 0, { guideReady: false })).toBe(0);
    expect(at(500, 0.125, 0, { guideReady: false })).toBe(10);
    expect(at(1000, 0.5, 0)).toBe(60);
    // A backwards fraction (more files queued late) does not lower the number.
    expect(at(1500, 0.3, 0)).toBe(60);
    // The fraction is what counts (a settled copy is whole in it); a lower reading never lowers the number.
    expect(at(2000, 0.75, 3)).toBe(80);
    expect(at(2200, 0.4, 3)).toBe(80);
    expect(at(2500, 1, 4, { busy: true })).toBe(99);
    expect(g.prep.ready).toBe(false);
    expect(at(2600, 1, 4)).toBe(100);
    expect(g.prep.ready).toBe(true);
  });

  it('a failed file counts as done, so the bar reaches the end', () => {
    const g = new TourGate();
    g.update({ ...input(0, 1, 2), fraction: 0.5 });
    expect(g.prep.percent).toBe(66);
    // The second file failed: settled, so done = total although its fraction was low.
    g.update({ ...input(1000, 2, 2), fraction: 1 });
    expect(g.prep.ready).toBe(true);
  });
});

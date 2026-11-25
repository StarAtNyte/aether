/**
 * The guided tour waits for everything (tour-gate.ts): every full model in, nothing left to prepare, the guide ready;
 * a press meanwhile arms it and it starts by itself after a short "Ready"; a stall never holds it past a minute.
 */
import { describe, expect, it } from 'vitest';
import { prepLabel } from '../src/player/guide/GuideUI';
import { READY_BEAT_MS, SLOW_AFTER_MS, START_NOW_AFTER_MS, TOUR_WAIT_MS, TourGate, prepStatus, type GateInput } from '../src/player/guide/tour-gate';

const input = (now: number, done: number, total: number, more: Partial<GateInput> = {}): GateInput => ({ now, upgrades: { done, total }, busy: false, guideReady: true, ...more });

describe('tour gate', () => {
  it('is ready at once when nothing upgrades and the guide is ready', () => {
    const g = new TourGate();
    expect(g.update(input(0, 0, 0))).toBe(false);
    expect(g.prep).toMatchObject({ ready: true, percent: 100, armed: false, starting: false, step: null, canSkip: false });
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

  it('waits while the picture is still being lowered for this machine, but never past the cap', () => {
    const g = new TourGate();
    g.update(input(0, 4, 4, { settling: true }));
    g.update(input(3000, 4, 4, { settling: true }));
    expect(g.prep).toMatchObject({ ready: false, percent: 99 });
    g.update(input(3100, 4, 4, { settling: false }));
    expect(g.prep.ready).toBe(true);
    const h = new TourGate();
    h.update(input(0, 4, 4, { settling: true }));
    h.update(input(60_000, 4, 4, { settling: true }));
    expect(h.prep.ready).toBe(true);
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

  it('offers "Start now" after a few seconds, and only while waiting', () => {
    const g = new TourGate();
    g.update(input(1000, 0, 5));
    expect(g.prep.canSkip).toBe(false);
    g.update(input(1000 + START_NOW_AFTER_MS - 1, 1, 5));
    expect(g.prep.canSkip).toBe(false);
    g.update(input(1000 + START_NOW_AFTER_MS, 1, 5));
    expect(g.prep.canSkip).toBe(true);
    g.update(input(20_000, 5, 5));
    expect(g.prep).toMatchObject({ ready: true, canSkip: false });
  });

  it('skip starts at once when the guide is ready, whatever is still loading, and the models carry on', () => {
    const g = new TourGate();
    g.update(input(0, 1, 5));
    expect(g.skip(7000)).toBe(true);
    expect(g.prep).toMatchObject({ ready: true, percent: 100, armed: false, canSkip: false });
    // Later frames: still ready, nothing starts twice, the models still coming do not take it back.
    expect(g.update(input(7100, 2, 5, { busy: true }))).toBe(false);
    expect(g.prep.ready).toBe(true);
    expect(g.skip(7200)).toBe(true);
  });

  it('skip with the guide not ready arms the tour: it starts the moment she is, with no "Ready" beat', () => {
    const g = new TourGate();
    g.update(input(0, 1, 5, { guideReady: false }));
    expect(g.skip(7000)).toBe(false);
    expect(g.prep).toMatchObject({ ready: false, armed: true, skipped: true, canSkip: false });
    expect(g.update(input(8000, 2, 5, { guideReady: false }))).toBe(false);
    expect(prepStatus(g.prep, 'Ava')?.text).toBe('Starting as soon as Ava is ready');
    // She is ready; the models are not (busy): it goes at once.
    expect(g.update(input(9000, 2, 5, { busy: true }))).toBe(true);
    expect(g.prep).toMatchObject({ ready: true, armed: false });
    expect(g.update(input(9100, 2, 5))).toBe(false);
  });

  it('an armed skip still holds while the visitor types', () => {
    const g = new TourGate();
    g.update(input(0, 1, 5, { guideReady: false }));
    g.skip(7000);
    expect(g.update(input(8000, 1, 5, { hold: true }))).toBe(false);
    expect(g.update(input(8100, 1, 5))).toBe(true);
  });

  it('flags a wait with no progress for a while as slow, and clears it when it moves', () => {
    const g = new TourGate();
    g.update({ ...input(0, 0, 4), fraction: 0.1 });
    g.update({ ...input(SLOW_AFTER_MS - 1, 0, 4), fraction: 0.1 });
    expect(g.prep.slow).toBe(false);
    g.update({ ...input(SLOW_AFTER_MS, 0, 4), fraction: 0.1 });
    expect(g.prep.slow).toBe(true);
    g.update({ ...input(SLOW_AFTER_MS + 100, 0, 4), fraction: 0.3 });
    expect(g.prep.slow).toBe(false);
  });

  it('names the step from the real state', () => {
    const g = new TourGate();
    g.update(input(0, 3, 13, { guideReady: false }));
    expect(g.prep.step).toBe('models');
    expect(prepStatus(g.prep, 'Ava')).toEqual({ text: 'Loading the models in full detail', count: '3 of 13', slow: null });
    g.update(input(1000, 13, 13, { guideReady: false }));
    expect(g.prep.step).toBe('guide');
    expect(prepStatus(g.prep, 'Ava')?.text).toBe('Ava is getting ready');
    g.update(input(2000, 13, 13, { busy: true }));
    expect(g.prep.step).toBe('finishing');
    expect(prepStatus(g.prep)?.text).toBe('Almost there');
    // The slow note rides on a step.
    g.update(input(2000 + SLOW_AFTER_MS, 13, 13, { busy: true }));
    expect(prepStatus(g.prep)?.slow).toMatch(/This device is taking a while/);
    expect(prepStatus(g.prep)?.slow).toMatch(/start now/);
    g.update(input(20_000, 13, 13));
    expect(prepStatus(g.prep)).toBeNull();
    g.update(input(20_100, 13, 13));
  });

  it('the status reads "Ready" while an armed tour starts, and nothing once it may', () => {
    const g = new TourGate();
    g.update(input(0, 0, 1));
    g.request(0);
    g.update(input(100, 1, 1));
    expect(prepStatus(g.prep)).toEqual({ text: 'Ready', count: null, slow: null });
  });
});

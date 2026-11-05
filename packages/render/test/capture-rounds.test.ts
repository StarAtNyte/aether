import { describe, expect, it } from 'vitest';
import { captureUntilComplete } from '../src/view/capture-rounds';

/** A fake capture: each pass holds back the draws whose objects are still queued; `settle` prepares `perSettle` of them. */
function scene(objects: number, perSettle: number) {
  let queued = objects;
  let settles = 0;
  const pass = async () => {
    const held = queued;
    // Drawn objects are black where held back: the image is the share actually drawn.
    return { images: (objects - held) / objects, held };
  };
  const settle = async () => {
    settles++;
    queued = Math.max(0, queued - perSettle);
  };
  return { pass, settle, settles: () => settles };
}

describe('captureUntilComplete', () => {
  it('returns the pass after the priming one when preparation drained in between', async () => {
    const s = scene(100, 1000);
    const done = await captureUntilComplete(s.pass, s.settle);
    expect(done).toMatchObject({ images: 1, held: 0, passes: 2 });
    expect(s.settles()).toBe(1);
  });

  it('draws again while draws are held back, instead of returning a black picture', async () => {
    // Preparation is slow (a busy machine, a compile walk holding the queue): one settle prepares only a third.
    const s = scene(90, 30);
    const done = await captureUntilComplete(s.pass, s.settle);
    expect(done.held).toBe(0);
    expect(done.images).toBe(1);
    expect(done.passes).toBe(4);
  });

  it('gives up after the round limit with what it has', async () => {
    const s = scene(100, 0);
    const done = await captureUntilComplete(s.pass, s.settle, 3);
    expect(done.passes).toBe(4);
    expect(done.held).toBe(100);
  });
});

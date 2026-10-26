import { describe, expect, it } from 'vitest';
import { FrameInvalidation } from '../src/view/frame-invalidation';

describe('redraw activity and quality phase', () => {
  it('does not interpret resource completion as new motion or animation', () => {
    const frame = new FrameInvalidation();
    frame.clear();
    for (let i = 0; i < 20; i++) {
      frame.prepared();
      expect(frame.dirty).toBe(true);
      expect(frame.motion).toBe(false);
      expect(frame.animating).toBe(false);
      frame.clear();
    }
  });
  it('retains real input when resource completion arrives before the next frame', () => {
    const frame = new FrameInvalidation();frame.clear();
    frame.change();frame.prepared();
    expect(frame.motion).toBe(true);
    frame.clear();frame.prepared();frame.change();
    expect(frame.motion).toBe(true);
  });
  it('retains self-animation without treating it as camera motion', () => {
    const frame = new FrameInvalidation();frame.clear();
    frame.animate();frame.prepared();
    expect(frame.motion).toBe(false);
    expect(frame.animating).toBe(true);
    frame.clear();
    expect(frame.dirty || frame.motion || frame.animating).toBe(false);
  });
});

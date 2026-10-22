import { describe, expect, it } from 'vitest';
import { CLOSER_TOOL, cropBox, lookCloser } from '../src/photo/closer';

describe('look_closer helpers', () => {
  it('clamps boxes to the picture, orders them and widens slivers', () => {
    expect(cropBox([0.5, 0.5, 0.2, 0.2])).toEqual([0.2, 0.2, 0.5, 0.5]);
    const [x0, , x1] = cropBox([0.4, 0.1, 0.41, 0.5]);
    expect(x1 - x0).toBeGreaterThanOrEqual(0.0799);
    const [a, , b] = cropBox([-1, 0, 0.01, 1]);
    expect(a).toBe(0);
    expect(b).toBeGreaterThanOrEqual(0.08);
    expect(cropBox([0.99, 0.99, 2, 2]).every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('refuses an empty or malformed request and says what is unavailable', async () => {
    const deps = { photoUrl: 'data:image/png;base64,AA==', renderUrl: null, compose: undefined, plan: undefined, roomLine: '' };
    expect((await lookCloser(deps, {})).isError).toBe(true);
    expect((await lookCloser(deps, { regions: [{ box: [0, 0] }] })).isError).toBe(true);
    const r = await lookCloser(deps, { side_by_side: true, plan: true });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('not available');
  });

  it('is advertised with its three modes', () => {
    expect(CLOSER_TOOL.description).toContain('side_by_side');
    expect(CLOSER_TOOL.description).toContain('plan');
  });
});

import { describe, expect, it } from 'vitest';
import { depthAdvisoryText, estimateRoomFromDepth, type DisparityMap } from '../src/photo';

/**
 * A synthetic box room seen by a level pinhole camera: floor, ceiling, far wall and side walls, rendered as the inverse depth
 * the network would give (scaled and shifted, as it does). The true size is known, so the estimator can be checked.
 */
function boxRoom(w: number, d: number, h: number, camY: number, fovDeg: number, camZ = 0.4, W = 160, H = 120): DisparityMap {
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const data = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const dx = (((i + 0.5) / W - 0.5) * 2 * tan);
      const dy = ((0.5 - (j + 0.5) / H) * 2 * tan * H) / W;
      // ray (dx, dy, 1) from the camera at height camY, x centre, camZ metres from the near wall
      let t = Infinity;
      if (dy < 0) t = Math.min(t, -camY / dy);
      if (dy > 0) t = Math.min(t, (h - camY) / dy);
      if (dx > 0) t = Math.min(t, (w / 2) / dx);
      if (dx < 0) t = Math.min(t, (-w / 2) / dx);
      t = Math.min(t, d - camZ);
      data[j * W + i] = 1 / (t + 1.2) + 0.05; // affine-shifted inverse depth, up to scale
    }
  }
  return { width: W, height: H, data };
}

describe('estimateRoomFromDepth', () => {
  it('recovers a 4 x 6 x 2.5 m room within 20% from the standard ceiling', () => {
    const e = estimateRoomFromDepth(boxRoom(4, 6, 2.5, 1.4, 75));
    expect(e).not.toBeNull();
    expect(e!.scale.basis).toBe('ceiling');
    expect(e!.height.value).toBeGreaterThan(2.3);
    expect(e!.height.value).toBeLessThan(2.8);
    expect(Math.abs(e!.width.value - 4) / 4).toBeLessThan(0.3);
    expect(Math.abs(e!.depth.value - 6) / 6).toBeLessThan(0.3);
    expect(e!.width.low).toBeLessThanOrEqual(e!.width.value);
    expect(e!.width.high).toBeGreaterThanOrEqual(e!.width.value);
  });

  it('pins the scale to an anchor: a 3.0 m ceiling room read with a door of known height', () => {
    // 3.0 m high room; a 2.05 m door on the far wall would span rows between the floor line and 2.05 m up.
    const map = boxRoom(4, 6, 3, 1.4, 75);
    const withCeiling = estimateRoomFromDepth(map)!;
    // far wall at 5.6 m ahead (d - camZ); floor line row and the row 2.05 m above it
    const tan = Math.tan((75 * Math.PI) / 360);
    const rowAt = (y: number): number => 0.5 - ((y - 1.4) / 5.6) / (2 * tan * (120 / 160));
    const anchor = { name: 'door', sizeM: 2.05, axis: 'height' as const, box: [0.4, rowAt(2.05), 0.6, rowAt(0)] as const };
    const e = estimateRoomFromDepth(map, { anchor })!;
    expect(e.scale.basis).toBe('anchor');
    expect(withCeiling.height.value).toBeLessThan(2.8); // the standard-ceiling guess misses a 3 m room
    expect(e.height.value).toBeGreaterThan(withCeiling.height.value + 0.05); // the anchor moves it toward 3 m (the synthetic shift is not the estimator's)
    expect(e.height.value).toBeLessThan(3.4);
  });

  it('says so when there is no structure', () => {
    const flat: DisparityMap = { width: 40, height: 30, data: new Float32Array(40 * 30).fill(0.5) };
    expect(estimateRoomFromDepth(flat)).toBeNull();
    expect(estimateRoomFromDepth({ width: 4, height: 4, data: new Float32Array(16) })).toBeNull();
  });

  it('words the estimate next to the model reading, with its caveats', () => {
    const e = estimateRoomFromDepth(boxRoom(4, 6, 2.5, 1.4, 75))!;
    const t = depthAdvisoryText(e, { width: 3.3, depth: 5, ceiling: 2.5 });
    expect(t).toContain('Your reading: 3.3 m wide, 5 m deep');
    expect(t).toContain('advisory');
    expect(t).toContain('lower bound');
  });
});

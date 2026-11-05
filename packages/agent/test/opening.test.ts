import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { openingCandidates, openingPatch, openingPictureScore, wantsOpening } from '../src/opening';

const place = (): WorldDoc =>
  createWorld({
    player: { spawn: [0, 1, 30] },
    entities: {
      ground: { id: 'ground', tags: ['ground'], transform: { position: [0, -0.5, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [120, 1, 120] } },
      tower: { id: 'tower', tags: ['focus'], transform: { position: [0, 10, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [4, 20, 4] } },
      house: { id: 'house', transform: { position: [12, 3, 8] }, shape: { kind: 'primitive', primitive: 'box', size: [6, 6, 6] } },
    },
  });

/** An RGBA picture filled by `fn(x, y)` (grey levels). */
function picture(w: number, h: number, fn: (x: number, y: number) => number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    data.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

describe('opening view of a built world', () => {
  it('offers eye-level candidates facing the landmark, with exact poses', () => {
    const views = openingCandidates(place());
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      expect(v.pose.clear).toBeUndefined();
      expect(v.pose.position[1]).toBeLessThanOrEqual(8);
      // Faces the tower.
      const dx = v.pose.target[0] - v.pose.position[0];
      const dz = v.pose.target[2] - v.pose.position[2];
      const tx = 0 - v.pose.position[0];
      const tz = 0 - v.pose.position[2];
      expect((dx * tx + dz * tz) / (Math.hypot(dx, dz) * Math.hypot(tx, tz))).toBeGreaterThan(0.99);
    }
  });

  it('turns down black, washed-out and wall-filled pictures and prefers detail', () => {
    expect(openingPictureScore(picture(64, 36, () => 2))).toBeNull();
    expect(openingPictureScore(picture(64, 36, () => 252))).toBeNull();
    expect(openingPictureScore(picture(64, 36, (x, y) => (y < 8 ? 200 : 120)))).toBeNull();
    const plain = openingPictureScore(picture(64, 36, (x, y) => (y < 12 ? 200 : 80 + ((x * 7) % 40))));
    const rich = openingPictureScore(picture(64, 36, (x, y) => (y < 12 ? 200 : 60 + ((x * 37 + y * 53) % 120))));
    expect(plain).not.toBeNull();
    expect(rich).toBeGreaterThan(plain as number);
  });

  it('stores the chosen view with setMeta, once per new world', () => {
    const world = place();
    const view = openingCandidates(world)[0]!;
    const r = applyPatches(world, [openingPatch(view)]);
    expect(r.errors).toEqual([]);
    expect(r.world.opening?.position).toEqual(view.pose.position);
    expect(wantsOpening(createWorld({}), world)).toBe(true);
    expect(wantsOpening(world, world)).toBe(false);
    expect(wantsOpening(createWorld({}), r.world)).toBe(false);
  });
});

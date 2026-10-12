import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { composeScatterMatrices, MAX_SCATTER_INSTANCES, primitiveLift, scatterPlacements, type ScatterParams } from '../src/geometry/scatter';
// Agreement test against the physics placement (render instances must sit where colliders are).
import { scatterInstances } from '../../physics/src/scatter';

const base: ScatterParams = { count: 500, area: [40, 20], seed: 7, scaleRange: [0.8, 1.2], randomYaw: true };

describe('scatterPlacements', () => {
  it('is deterministic and respects count, area and scale range', () => {
    const a = scatterPlacements(base);
    const b = scatterPlacements(base);
    expect(a.count).toBe(500);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.yaw)).toEqual(Array.from(b.yaw));
    for (let i = 0; i < a.count; i++) {
      expect(Math.abs(a.x[i] as number)).toBeLessThanOrEqual(20);
      expect(Math.abs(a.z[i] as number)).toBeLessThanOrEqual(10);
      expect(a.scale[i]).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(a.scale[i]).toBeLessThanOrEqual(1.2 + 1e-6);
    }
    expect(scatterPlacements({ ...base, seed: 8 }).x[0]).not.toBe(a.x[0]);
  });

  it('matches @aether/physics placements exactly (with and without minSpacing)', () => {
    for (const shape of [base, { ...base, minSpacing: 1.5, count: 300 }, { ...base, randomYaw: false }]) {
      const mine = scatterPlacements(shape);
      const theirs = scatterInstances(shape);
      expect(mine.count).toBe(theirs.length);
      theirs.forEach((inst, i) => {
        expect(mine.x[i]).toBeCloseTo(inst.position[0], 4);
        expect(mine.z[i]).toBeCloseTo(inst.position[2], 4);
        expect(mine.scale[i]).toBeCloseTo(inst.scale, 5);
        expect(((mine.yaw[i] as number) * 180) / Math.PI).toBeCloseTo(inst.yawDeg, 3);
      });
    }
  });

  it('enforces minSpacing when the area allows it', () => {
    const p = scatterPlacements({ ...base, count: 100, area: [100, 100], minSpacing: 4 });
    let violations = 0;
    for (let i = 0; i < p.count; i++) {
      for (let j = i + 1; j < p.count; j++) {
        if (Math.hypot((p.x[i] as number) - (p.x[j] as number), (p.z[i] as number) - (p.z[j] as number)) < 4 - 1e-4) violations++;
      }
    }
    expect(violations).toBe(0);
  });

  it('caps counts and tolerates hostile input', () => {
    expect(scatterPlacements({ ...base, count: 10_000_000 }, 1000).count).toBe(1000);
    expect(scatterPlacements({ ...base, count: 10_000_000 }).count).toBe(MAX_SCATTER_INSTANCES);
    const weird = scatterPlacements({ count: Number.NaN, area: [Number.NaN, Infinity], seed: 1, scaleRange: [Number.NaN, 2], randomYaw: true });
    expect(weird.count).toBe(0);
    const p = scatterPlacements({ count: 5, area: [Number.NaN, 4], seed: 1, scaleRange: [-5, -5], randomYaw: true, minSpacing: -1 });
    expect(Array.from(p.x).every((x) => x === 0)).toBe(true);
    expect(Array.from(p.scale).every((s) => s >= 1e-3)).toBe(true);
  });

  it('lays out 200k instances quickly (benchmark)', () => {
    const t0 = performance.now();
    const p = scatterPlacements({ ...base, count: 200_000, area: [400, 400] });
    const m = composeScatterMatrices(p, 0.5);
    const ms = performance.now() - t0;
    expect(m.length).toBe(200_000 * 16);
    expect(ms).toBeLessThan(1500);
  });

  it('lays out 20k instances with minSpacing in O(n)', () => {
    const t0 = performance.now();
    const p = scatterPlacements({ ...base, count: 20_000, area: [300, 300], minSpacing: 1 });
    expect(p.count).toBe(20_000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('composeScatterMatrices', () => {
  it('writes yaw/scale/translation matrices identical to Matrix4.compose', () => {
    const p = scatterPlacements({ ...base, count: 20 });
    const m = composeScatterMatrices(p, 0.5, (x, z) => x * 0.1 + z * 0.2);
    const ref = new Matrix4();
    const q = new Quaternion();
    for (let i = 0; i < p.count; i++) {
      const s = p.scale[i] as number;
      const y = (p.x[i] as number) * 0.1 + (p.z[i] as number) * 0.2;
      q.setFromAxisAngle(new Vector3(0, 1, 0), p.yaw[i] as number);
      ref.compose(new Vector3(p.x[i], y + 0.5 * s, p.z[i]), q, new Vector3(s, s, s));
      const got = Array.from(m.subarray(i * 16, i * 16 + 16));
      ref.elements.forEach((v, k) => expect(got[k]).toBeCloseTo(v, 4));
    }
  });

  it('ignores NaN surface samples (y = 0) and reuses the output buffer', () => {
    const p = scatterPlacements({ ...base, count: 4 });
    const out = new Float32Array(64);
    const m = composeScatterMatrices(p, 0, () => Number.NaN, out);
    expect(m).toBe(out);
    for (let i = 0; i < 4; i++) expect(m[i * 16 + 13]).toBe(0);
  });
});

describe('primitiveLift', () => {
  it('matches physics resting heights', () => {
    expect(primitiveLift('box', [1, 2, 1])).toBe(1);
    expect(primitiveLift('sphere', [3, 1, 1])).toBe(1.5);
    expect(primitiveLift('capsule', [1, 3, 1])).toBe(1.5);
    expect(primitiveLift('plane', [5, 1, 5])).toBe(0.01);
    expect(primitiveLift('torus', [2, 0.5, 2])).toBe(1);
  });
});

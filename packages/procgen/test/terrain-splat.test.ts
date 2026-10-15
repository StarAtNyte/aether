/**
 * Layered terrain: every terrain generator paints its heightfield with four
 * layer weights per vertex (grass, rock, dry ground, snow) next to the vertex
 * colours, and the output validator guards the new array.
 */
import { describe, expect, it } from 'vitest';
import { generateBuiltinSync, validateOutput } from '../src/index';
import { sanitizeMaterial } from '../src/material';

const CASES: Array<[string, Record<string, number | string>]> = [
  ['terrain', { size: 80, height: 30, resolution: 48, variant: 0 }],
  ['terrain', { size: 80, height: 10, resolution: 48, variant: 3 }],
  ['terrain', { size: 120, height: 14, resolution: 48, variant: 4 }],
  ['island', { size: 60, height: 8, resolution: 48 }],
  ['mountain', { size: 90, height: 40, resolution: 48 }],
];

describe('terrain layer weights', () => {
  for (const [id, params] of CASES) {
    it(`${id} ${JSON.stringify(params)} carries normalised weights and a splat material`, () => {
      const out = generateBuiltinSync(id, params, 11);
      const part = out.parts[0]!;
      expect(part.material.splat).toBe(true);
      expect(part.material.vertexColors).toBe(true);
      const n = part.positions.length / 3;
      expect(part.splat).toBeInstanceOf(Float32Array);
      expect(part.splat!.length).toBe(n * 4);
      const used = new Float32Array(4);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const w = part.splat![i * 4 + k]!;
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
          sum += w;
          used[k]! += w;
        }
        expect(sum).toBeCloseTo(1, 4);
      }
      // Grass dominates a landscape; every generator shows at least one other layer.
      expect(used[0]!).toBeGreaterThan(0);
      expect(used[1]! + used[2]! + used[3]!).toBeGreaterThan(0);
      expect(validateOutput(out).ok).toBe(true);
    });
  }

  it('puts rock on steep faces and snow only on high, gentle ground', () => {
    const out = generateBuiltinSync('mountain', { size: 90, height: 60, resolution: 64, snowLine: 0.6 }, 5);
    const part = out.parts[0]!;
    const n = part.positions.length / 3;
    let steepRock = 0;
    let steep = 0;
    let snowLow = 0;
    let snowHigh = 0;
    const maxY = out.bounds.max[1];
    for (let i = 0; i < n; i++) {
      const slope = 1 - part.normals[i * 3 + 1]!;
      const y = part.positions[i * 3 + 1]!;
      if (slope > 0.5) {
        steep++;
        steepRock += part.splat![i * 4 + 1]!;
      }
      const snow = part.splat![i * 4 + 3]!;
      if (y < maxY * 0.4) snowLow += snow;
      else if (y > maxY * 0.8) snowHigh += snow;
    }
    expect(snowLow).toBe(0);
    expect(snowHigh).toBeGreaterThan(0);
    if (steep > 0) expect(steepRock / steep).toBeGreaterThan(0.5);
  });

  it('keeps splat out of other generators', () => {
    const out = generateBuiltinSync('rock', {}, 1);
    for (const p of out.parts) expect(p.splat).toBeUndefined();
  });
});

describe('validating the splat array', () => {
  const base = () => generateBuiltinSync('terrain', { size: 20, height: 4, resolution: 16, variant: 0 }, 2);

  it('rejects a wrong length, NaN and weights above 1', () => {
    const bad = base();
    bad.parts[0]!.splat = new Float32Array(10);
    expect(validateOutput(bad).ok).toBe(false);
    const nan = base();
    nan.parts[0]!.splat![0] = Number.NaN;
    expect(validateOutput(nan).ok).toBe(false);
    const big = base();
    big.parts[0]!.splat![3] = 5;
    expect(validateOutput(big).ok).toBe(false);
  });

  it('accepts a part without weights (drawn with its vertex colours)', () => {
    const o = base();
    delete o.parts[0]!.splat;
    expect(validateOutput(o).ok).toBe(true);
  });

  it('sanitizes the material flag as a boolean', () => {
    expect(sanitizeMaterial({ splat: true }).splat).toBe(true);
    expect(() => sanitizeMaterial({ splat: 'yes' })).toThrow(/splat|true or false/);
  });
});

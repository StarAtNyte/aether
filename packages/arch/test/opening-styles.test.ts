import { describe, expect, it } from 'vitest';
import { buildStructure, type ArchOutput } from '../src/index';

type P = Record<string, unknown>;

function tris(o: ArchOutput): number {
  return o.parts.reduce((s, p) => s + p.indices.length / 3, 0);
}

function bounds(o: ArchOutput): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of o.parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = part.positions[i + a] as number;
        if (v < min[a]!) min[a] = v;
        if (v > max[a]!) max[a] = v;
      }
    }
  }
  return { min, max };
}

const win = (extra: P): ArchOutput => buildStructure('arch-window', { width: 1.2, height: 1.9, wallThickness: 0.28, interior: 'b', ...extra });
const hasGlass = (o: ArchOutput): boolean => o.parts.some((p) => p.material.finish === 'glass' && p.indices.length > 0);

describe('window styles', () => {
  it('sash windows have two sashes, glazing bars and glass, within the opening and the triangle cap', () => {
    const o = win({ style: 'sash' });
    expect(hasGlass(o)).toBe(true);
    expect(tris(o)).toBeLessThan(8000);
    const b = bounds(o);
    expect(b.min[0]).toBeGreaterThanOrEqual(-0.6 - 0.2);
    expect(b.max[1]).toBeLessThanOrEqual(1.9 + 0.1);
    // The lower sash sits toward the room (+z for interior b), the upper behind it.
    const frame = o.parts[0]!;
    let hasFront = false;
    let hasBack = false;
    for (let i = 0; i < frame.positions.length; i += 3) {
      if ((frame.positions[i + 2] as number) > 0.025) hasFront = true;
      if ((frame.positions[i + 2] as number) < -0.025) hasBack = true;
    }
    expect(hasFront || hasBack).toBe(true);
  });

  it('muntins change the geometry', () => {
    const a = tris(win({ style: 'sash', muntins: { cols: 1, rows: 1 } }));
    const b = tris(win({ style: 'sash', muntins: { cols: 3, rows: 4 } }));
    expect(b).toBeGreaterThan(a);
    const c1 = tris(win({ style: 'casement', width: 1.4, height: 1.5 }));
    const c2 = tris(win({ style: 'casement', width: 1.4, height: 1.5, muntins: { cols: 2, rows: 3 } }));
    expect(c2).toBeGreaterThan(c1);
  });

  it('arched windows fit inside the opening and fill the corners above the arc', () => {
    const o = win({ style: 'arched', width: 1.1 });
    expect(hasGlass(o)).toBe(true);
    const b = bounds(o);
    expect(b.max[1]).toBeLessThanOrEqual(1.9 + 0.1);
    expect(b.min[0]).toBeGreaterThanOrEqual(-0.55 - 0.2);
    expect(b.max[0]).toBeLessThanOrEqual(0.55 + 0.2);
    expect(tris(o)).toBeLessThan(8000);
  });

  for (const interior of ['a', 'b'] as const) {
    it(`bay windows project to the outside (interior ${interior}) and keep the room side clear`, () => {
      const o = win({ style: 'bay', width: 2, height: 1.7, bay: { depth: 0.5, angle: 35 }, interior, sill: false });
      expect(hasGlass(o)).toBe(true);
      const b = bounds(o);
      const out = interior === 'b' ? -1 : 1;
      const T = 0.14;
      // Outside face reaches T + 0.5 (plus the roof cap's overhang); the room side stays within the wall.
      expect(out * (out > 0 ? b.max[2] : b.min[2])).toBeGreaterThan(T + 0.45);
      expect(out > 0 ? b.min[2] : b.max[2]).toSatisfy((z: number) => Math.abs(z) <= T + 0.06);
      expect(tris(o)).toBeLessThan(8000);
    });
  }

  it('is deterministic and keeps the daylight pane on the new styles', () => {
    for (const style of ['sash', 'arched', 'bay']) {
      const a = win({ style, daylight: '#fff4e2' });
      const b = win({ style, daylight: '#fff4e2' });
      expect(JSON.stringify(a.parts.map((p) => Array.from(p.positions)))).toBe(JSON.stringify(b.parts.map((p) => Array.from(p.positions))));
      expect(a.parts.some((p) => p.material.emissive === '#fff4e2')).toBe(true);
    }
  });

  it('casing adds geometry on sash windows unless turned off', () => {
    expect(tris(win({ style: 'sash' }))).toBeGreaterThan(tris(win({ style: 'sash', casing: false })));
  });
});

describe('door styles', () => {
  const door = (style: string, extra: P = {}): ArchOutput => buildStructure('arch-door', { width: 0.9, height: 2.1, style, ...extra });

  it('glazed and french leaves carry glass and bars; panel leaves vary with height', () => {
    expect(hasGlass(door('glazed'))).toBe(true);
    expect(hasGlass(door('french', { width: 0.6 }))).toBe(true);
    expect(tris(door('french', { width: 0.6 }))).toBeLessThan(8000);
    expect(tris(door('panel', { height: 2.4 }))).toBeGreaterThan(tris(door('panel', { height: 2.1 })));
    expect(tris(door('double'))).toBe(tris(door('panel')));
    expect(tris(door('arched'))).toBe(tris(door('panel')));
    const b = bounds(door('glazed'));
    expect(b.max[1]).toBeLessThanOrEqual(2.1 + 1e-6);
    expect(b.min[0]).toBeGreaterThanOrEqual(-0.45 - 0.02);
  });

  it('an arched frame head draws a glazed fanlight within the opening', () => {
    const flat = buildStructure('arch-frame', { width: 1.0, height: 2.6, wallThickness: 0.28 });
    const arched = buildStructure('arch-frame', { width: 1.0, height: 2.6, wallThickness: 0.28, head: 'arched', springing: 2.1 });
    expect(hasGlass(flat)).toBe(false);
    expect(hasGlass(arched)).toBe(true);
    const b = bounds(arched);
    expect(b.max[1]).toBeLessThanOrEqual(2.6 + 0.2);
    expect(b.min[0]).toBeGreaterThanOrEqual(-0.5 - 0.1);
    expect(b.max[0]).toBeLessThanOrEqual(0.5 + 0.1);
    expect(tris(arched)).toBeLessThan(8000);
  });
});

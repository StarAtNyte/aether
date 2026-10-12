import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/engine/FixedStepper';
import { MAX_TRACKED, TransformTable } from '../src/engine/TransformTable';
import { axesFromKeys, wrapDeg } from '../src/engine/input';

describe('FixedStepper', () => {
  it('turns frame deltas into whole fixed steps', () => {
    const s = new FixedStepper(1 / 60, 5, 0.1);
    expect(s.advance(1 / 60)).toBe(1);
    expect(s.advance(1 / 120)).toBe(0);
    expect(s.advance(1 / 120)).toBe(1);
    expect(s.alpha).toBeLessThan(1e-6 + 1e-3);
  });

  it('clamps stalls and drops the backlog (spiral-of-death guard)', () => {
    const s = new FixedStepper(1 / 60, 5, 0.1);
    expect(s.advance(10)).toBe(5);
    expect(s.advance(0)).toBe(0);
  });

  it('ignores bad deltas and rejects bad construction', () => {
    const s = new FixedStepper(0.01, 4, 0.1);
    expect(s.advance(Number.NaN)).toBe(0);
    expect(s.advance(-1)).toBe(0);
    expect(() => new FixedStepper(0, 1, 1)).toThrow(RangeError);
  });

  it('is accurate over many frames', () => {
    const s = new FixedStepper(1 / 60, 5, 0.1);
    let steps = 0;
    for (let i = 0; i < 1440; i++) steps += s.advance(1 / 144);
    expect(steps).toBeGreaterThanOrEqual(599);
    expect(steps).toBeLessThanOrEqual(600);
  });
});

describe('TransformTable', () => {
  it('stores, reads and swap-removes poses', () => {
    const t = new TransformTable();
    t.ensure('a', [1, 2, 3], [0, 0, 0, 1]);
    t.ensure('b', [4, 5, 6]);
    t.write('c', [7, 8, 9], [0, 1, 0, 0]);
    expect(t.order).toEqual(['a', 'b', 'c']);
    expect(t.packed.length).toBe(21);
    t.remove('a');
    expect(t.order).toEqual(['c', 'b']);
    const pos: [number, number, number] = [0, 0, 0];
    const q: [number, number, number, number] = [0, 0, 0, 0];
    expect(t.read('c', pos, q)).toBe(true);
    expect(pos).toEqual([7, 8, 9]);
    expect(q).toEqual([0, 1, 0, 0]);
    expect(t.read('a', pos, q)).toBe(false);
    expect(t.packed.length).toBe(14);
  });

  it('grows its buffer and ignores non-finite writes', () => {
    const t = new TransformTable();
    for (let i = 0; i < 500; i++) t.ensure(`e-${i}`, [i, 0, 0]);
    expect(t.size).toBe(500);
    expect(t.packed[499 * 7]).toBe(499);
    t.write('e-1', [Number.NaN, 0, 0], [0, 0, 0, 1]);
    const pos: [number, number, number] = [0, 0, 0];
    t.read('e-1', pos, [0, 0, 0, 1]);
    expect(pos[0]).toBe(1);
    t.clear();
    expect(t.size).toBe(0);
    expect(t.packed.length).toBe(0);
    expect(MAX_TRACKED).toBeGreaterThan(1000);
  });

  it('does not allocate when rewriting existing slots', () => {
    const t = new TransformTable();
    for (let i = 0; i < 1000; i++) t.ensure(`e-${i}`);
    const buf = t.packed;
    const p: [number, number, number] = [1, 1, 1];
    const q = [0, 0, 0, 1];
    const t0 = performance.now();
    for (let f = 0; f < 200; f++) for (let i = 0; i < 1000; i++) t.write(t.order[i] as string, p, q);
    expect(t.packed).toBe(buf);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('input mapping', () => {
  it('maps WASD/arrows/space/E', () => {
    expect(axesFromKeys(new Set(['KeyW', 'KeyD', 'Space', 'KeyE']))).toEqual({ forward: 1, right: 1, turn: 0, jump: true, action: true });
    expect(axesFromKeys(new Set(['KeyW', 'ArrowUp']))).toMatchObject({ forward: 1 });
    expect(axesFromKeys(new Set(['KeyS', 'KeyA', 'ArrowLeft']))).toEqual({ forward: -1, right: -1, turn: -1, jump: false, action: false });
    expect(axesFromKeys(new Set())).toEqual({ forward: 0, right: 0, turn: 0, jump: false, action: false });
  });

  it('wraps angles', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(180)).toBe(180);
    expect(wrapDeg(720)).toBe(0);
    expect(wrapDeg(Number.NaN)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  childrenOf,
  compare,
  createWorld,
  eulerDegToQuat,
  isValidSelector,
  quatMultiply,
  quatToEulerDeg,
  readStateKey,
  resolveSelector,
  rng,
  rotateVec3,
  worldTransform,
  type Quat,
  type Vec3,
} from '../src/index';
import { sampleWorld } from './helpers';

const S = Math.SQRT1_2;

function expectQuat(actual: Quat, expected: Quat, digits = 9): void {
  // q and -q are the same rotation
  const sign = actual[0] * expected[0] + actual[1] * expected[1] + actual[2] * expected[2] + actual[3] * expected[3] < 0 ? -1 : 1;
  for (let i = 0; i < 4; i++) expect(actual[i]! * sign).toBeCloseTo(expected[i]!, digits);
}

/** Independent reference: rotation matrix Rx·Ry·Rz (three.js 'XYZ') → quaternion. */
function referenceQuat([x, y, z]: Vec3): Quat {
  const r = Math.PI / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * r), Math.sin(x * r), Math.cos(y * r), Math.sin(y * r), Math.cos(z * r), Math.sin(z * r)];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (a: number[][], b: number[][]): number[][] => a.map((row, i) => row.map((_, j) => a[i]!.reduce((s, _v, k) => s + a[i]![k]! * b[k]![j]!, 0)));
  const m = mul(mul(Rx, Ry), Rz);
  const [m11, m12, m13] = m[0]!;
  const [m21, m22, m23] = m[1]!;
  const [m31, m32, m33] = m[2]!;
  const trace = m11! + m22! + m33!;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m32! - m23!) * s, (m13! - m31!) * s, (m21! - m12!) * s, 0.25 / s];
  }
  if (m11! > m22! && m11! > m33!) {
    const s = 2 * Math.sqrt(1 + m11! - m22! - m33!);
    return [0.25 * s, (m12! + m21!) / s, (m13! + m31!) / s, (m32! - m23!) / s];
  }
  if (m22! > m33!) {
    const s = 2 * Math.sqrt(1 + m22! - m11! - m33!);
    return [(m12! + m21!) / s, 0.25 * s, (m23! + m32!) / s, (m13! - m31!) / s];
  }
  const s = 2 * Math.sqrt(1 + m33! - m11! - m22!);
  return [(m13! + m31!) / s, (m23! + m32!) / s, 0.25 * s, (m21! - m12!) / s];
}

describe('eulerDegToQuat / quatToEulerDeg', () => {
  it('matches known three.js values', () => {
    expectQuat(eulerDegToQuat([0, 0, 0]), [0, 0, 0, 1]);
    expectQuat(eulerDegToQuat([90, 0, 0]), [S, 0, 0, S]);
    expectQuat(eulerDegToQuat([0, 90, 0]), [0, S, 0, S]);
    expectQuat(eulerDegToQuat([0, 0, 90]), [0, 0, S, S]);
    expectQuat(eulerDegToQuat([90, 90, 0]), [0.5, 0.5, 0.5, 0.5]);
    expectQuat(eulerDegToQuat([180, 0, 0]), [1, 0, 0, 0]);
  });

  it('agrees with an independent matrix-based reference', () => {
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const e: Vec3 = [r() * 720 - 360, r() * 720 - 360, r() * 720 - 360];
      expectQuat(eulerDegToQuat(e), referenceQuat(e), 9);
    }
  });

  it('round-trips (as rotations) for random angles and gimbal lock', () => {
    const r = rng(11);
    const cases: Vec3[] = [[0, 90, 0], [10, -90, 30], [45, 90, 45], [0, 0, 0], [179.9, 0, -179.9]];
    for (let i = 0; i < 300; i++) cases.push([r() * 360 - 180, r() * 178 - 89, r() * 360 - 180]);
    for (const e of cases) {
      const q = eulerDegToQuat(e);
      const back = quatToEulerDeg(q);
      expectQuat(eulerDegToQuat(back), q, 6);
      // away from gimbal lock the angles themselves round-trip
      if (Math.abs(e[1]) < 89) for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(e[k]!, 6);
    }
  });

  it('handles unnormalized and degenerate quaternions', () => {
    const e = quatToEulerDeg([0, 0, 2 * S, 2 * S]);
    expect(e[2]).toBeCloseTo(90, 9);
    expect(quatToEulerDeg([0, 0, 0, 0])).toEqual([0, 0, 0]);
    expect(quatToEulerDeg([Number.NaN, 0, 0, 1])).toEqual([0, 0, 0]);
    expect(Object.is(quatToEulerDeg([0, 0, 0, 1])[0], -0)).toBe(false);
  });

  it('quatMultiply and rotateVec3 compose rotations', () => {
    const qx = eulerDegToQuat([90, 0, 0]);
    const qy = eulerDegToQuat([0, 90, 0]);
    const v = rotateVec3(quatMultiply(qy, qx), [0, 1, 0]);
    // X by 90: (0,1,0) -> (0,0,1); then Y by 90: (0,0,1) -> (1,0,0)
    expect(v[0]).toBeCloseTo(1, 9);
    expect(v[1]).toBeCloseTo(0, 9);
    expect(v[2]).toBeCloseTo(0, 9);
    const out: Quat = [...qx];
    quatMultiply(out, qy, out); // aliasing is safe
    expectQuat(out, quatMultiply(qx, qy));
  });
});

describe('worldTransform', () => {
  it('composes the parent chain', () => {
    const w = createWorld({
      entities: {
        a: { id: 'a', transform: { position: [10, 0, 0], rotation: [0, 90, 0], scale: [2, 2, 2] } },
        b: { id: 'b', parent: 'a', transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [0.5, 1, 1] } },
        c: { id: 'c', parent: 'b', transform: { position: [0, 3, 0] } },
      },
    });
    const b = worldTransform(w, 'b');
    // (1,0,0) scaled by 2 -> (2,0,0), rotated 90° about Y -> (0,0,-2), + (10,0,0)
    expect(b.position[0]).toBeCloseTo(10, 9);
    expect(b.position[1]).toBeCloseTo(0, 9);
    expect(b.position[2]).toBeCloseTo(-2, 9);
    expectQuat(b.quaternion, [0, S, 0, S]);
    expect(b.scale).toEqual([1, 2, 2]);
    const c = worldTransform(w, 'c');
    expect(c.position[1]).toBeCloseTo(6, 9);
    expect(worldTransform(w, 'a').position).toEqual([10, 0, 0]);
  });
  it('throws for unknown ids and does not leak prototype members', () => {
    const w = createWorld({});
    expect(() => worldTransform(w, 'nope')).toThrow(RangeError);
    expect(() => worldTransform(w, 'constructor')).toThrow(RangeError);
  });
});

describe('selectors', () => {
  const w = createWorld({
    player: { controls: 'hero' },
    entities: {
      hero: { id: 'hero', tags: ['player-ish'] },
      c1: { id: 'c1', tags: ['coin'] },
      c2: { id: 'c2', tags: ['coin'] },
      tpl: { id: 'tpl', tags: ['coin'], template: true },
      player: { id: 'player' },
    },
  });

  it('resolves ids, tags, player and *', () => {
    expect(resolveSelector(w, 'c1')).toEqual(['c1']);
    expect(resolveSelector(w, '#coin')).toEqual(['c1', 'c2']);
    expect(resolveSelector(w, '*')).toEqual(['hero', 'c1', 'c2', 'player']);
    expect(resolveSelector(w, 'player')).toEqual(['hero']);
    expect(resolveSelector(w, 'player', { playerId: 'c2' })).toEqual(['c2']);
    expect(resolveSelector(createWorld({ entities: { player: { id: 'player' } } }), 'player')).toEqual(['player']);
    expect(resolveSelector(createWorld({}), 'player')).toEqual([]);
  });

  it('excludes templates and ignores unknown / malformed selectors', () => {
    expect(resolveSelector(w, 'tpl')).toEqual([]);
    expect(resolveSelector(w, 'missing')).toEqual([]);
    expect(resolveSelector(w, '#')).toEqual([]);
    expect(resolveSelector(w, '# x')).toEqual([]);
    expect(resolveSelector(w, 'constructor')).toEqual([]);
    expect(resolveSelector(w, '__proto__')).toEqual([]);
  });

  it('validates selector syntax', () => {
    for (const ok of ['*', 'player', '#coin', '#a-b_c', 'car-1']) expect(isValidSelector(ok)).toBe(true);
    for (const bad of ['', '#', '# x', 'Car', 'a b', '##x', 'constructor']) expect(isValidSelector(bad)).toBe(false);
  });

  it('childrenOf lists direct children only', () => {
    const s = sampleWorld();
    expect(childrenOf(s, 'car')).toEqual(['wheel']);
    expect(childrenOf(s, 'wheel')).toEqual(['hub']);
    expect(childrenOf(s, 'hub')).toEqual([]);
  });
});

describe('readStateKey / compare', () => {
  const w = createWorld({
    state: { score: 5, 'flag.x': true, stats: { hp: 3, list: [1, 2] } },
    entities: { 'door-1': { id: 'door-1', state: { open: false, nested: { a: 'b' } } } },
  });
  it('reads world and entity state', () => {
    expect(readStateKey(w, 'score')).toBe(5);
    expect(readStateKey(w, 'door-1.open')).toBe(false);
    expect(readStateKey(w, 'door-1.nested.a')).toBe('b');
    expect(readStateKey(w, 'door-1.missing')).toBeUndefined();
    expect(readStateKey(w, 'flag.x')).toBe(true);
    expect(readStateKey(w, 'stats.hp')).toBe(3);
    expect(readStateKey(w, 'stats.list.1')).toBe(2);
    expect(readStateKey(w, 'stats.list.x')).toBeUndefined();
    expect(readStateKey(w, 'nope')).toBeUndefined();
    expect(readStateKey(w, 'constructor')).toBeUndefined();
    expect(readStateKey(w, 'door-1.constructor')).toBeUndefined();
    expect(readStateKey(w, 'stats.__proto__')).toBeUndefined();
  });
  it('compares with type safety', () => {
    expect(compare(5, '>', 3)).toBe(true);
    expect(compare(5, '<=', 5)).toBe(true);
    expect(compare(5, '<', 3)).toBe(false);
    expect(compare(5, '>=', 6)).toBe(false);
    expect(compare('b', '>', 'a')).toBe(true);
    expect(compare('5', '==', 5)).toBe(false);
    expect(compare('5', '>', 3)).toBe(false);
    expect(compare(true, '==', true)).toBe(true);
    expect(compare(true, '>', false)).toBe(false);
    expect(compare(null, '==', null)).toBe(true);
    expect(compare([1, { a: 2 }], '==', [1, { a: 2 }])).toBe(true);
    expect(compare({ a: 1 }, '!=', { a: 2 })).toBe(true);
    expect(compare(undefined, '==', 0)).toBe(false);
    expect(compare(undefined, '!=', 0)).toBe(true);
    expect(compare(undefined, '<', 0)).toBe(false);
    expect(compare(Number.NaN, '<', 1)).toBe(false);
  });
});

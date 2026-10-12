import { describe, expect, it, vi } from 'vitest';
import {
  createWorld,
  deepEqual,
  Emitter,
  hashString,
  inspectUntrusted,
  isEntityId,
  rng,
  slugify,
  stableStringify,
  uniqueId,
} from '../src/index';

describe('rng', () => {
  it('is deterministic per seed and in [0,1)', () => {
    const a = rng(42);
    const b = rng(42);
    const seq = Array.from({ length: 1000 }, () => a());
    expect(seq).toEqual(Array.from({ length: 1000 }, () => b()));
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds, including negative / fractional / huge / non-finite seeds', () => {
    const first = (s: number): number => rng(s)();
    const values = [0, 1, 2, -1, 0.5, 2 ** 40, 2 ** 40 + 1].map(first);
    expect(new Set(values).size).toBe(values.length);
    expect(first(Number.NaN)).toBe(first(0));
    expect(first(Number.POSITIVE_INFINITY)).toBe(first(0));
  });

  it('is roughly uniform', () => {
    const r = rng(7);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r() * 10)]!++;
    for (const b of buckets) expect(Math.abs(b - n / 10)).toBeLessThan(n / 100);
  });
});

describe('hashString (FNV-1a 32)', () => {
  it('matches reference vectors', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });
  it('hashes UTF-8 bytes (non-ASCII and astral)', () => {
    // FNV-1a over UTF-8 bytes of "é" (0xC3 0xA9)
    let h = 0x811c9dc5;
    for (const byte of [0xc3, 0xa9]) h = Math.imul(h ^ byte, 0x01000193);
    expect(hashString('é')).toBe(h >>> 0);
    expect(hashString('😀')).not.toBe(hashString('😁'));
    expect(hashString('x')).toBeGreaterThanOrEqual(0);
  });
});

describe('slugify / uniqueId / isEntityId', () => {
  it('slugifies names', () => {
    expect(slugify('Red Car!')).toBe('red-car');
    expect(slugify('  Ünïcödé   Tower  ')).toBe('unicode-tower');
    expect(slugify('___')).toBe('entity');
    expect(slugify('')).toBe('entity');
    expect(slugify('constructor')).toBe('constructor-entity');
    expect(slugify('a'.repeat(100))).toHaveLength(64);
    expect(isEntityId(slugify('x--y--' + 'z'.repeat(80)))).toBe(true);
  });

  it('derives unused ids', () => {
    const w = createWorld({ entities: { tree: { id: 'tree' }, 'tree-2': { id: 'tree-2' } } });
    expect(uniqueId(w, 'rock')).toBe('rock');
    expect(uniqueId(w, 'Tree')).toBe('tree-3');
    expect(uniqueId(w, 'tree-2')).toBe('tree-3');
    expect(uniqueId(w, 'tree', new Set(['tree-3']))).toBe('tree-4');
    const long = 'b'.repeat(64);
    const w2 = createWorld({ entities: { [long]: { id: long } } });
    const id = uniqueId(w2, long);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(isEntityId(id)).toBe(true);
    expect(id).not.toBe(long);
  });

  it('isEntityId rejects reserved and malformed ids', () => {
    expect(isEntityId('ok-1')).toBe(true);
    expect(isEntityId('Bad')).toBe(false);
    expect(isEntityId('-x')).toBe(false);
    expect(isEntityId('constructor')).toBe(false);
    expect(isEntityId('prototype')).toBe(false);
  });
});

describe('stableStringify / deepEqual', () => {
  it('sorts keys and follows JSON conventions', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(stableStringify([undefined, Number.NaN, Number.POSITIVE_INFINITY])).toBe('[null,null,null]');
    expect(stableStringify({ toJSON: () => ({ z: 1, y: 2 }) })).toBe('{"y":2,"z":1}');
    expect(stableStringify('x"y')).toBe('"x\\"y"');
    expect(stableStringify(null)).toBe('null');
  });
  it('is insensitive to key order and throws on cycles / bigint', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    expect(() => stableStringify(cyc)).toThrow(TypeError);
    expect(() => stableStringify(10n)).toThrow(TypeError);
    const shared = { x: 1 };
    expect(stableStringify([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });
  it('deepEqual handles arrays, objects, NaN and undefined keys', () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe('inspectUntrusted', () => {
  it('rejects prototype-pollution keys at any depth', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const v = JSON.parse(`{"a":{"b":[{"${key}":{"polluted":true}}]}}`);
      const r = inspectUntrusted(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.path).toBe(`a.b.0.${key}`);
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
  it('enforces depth, node and string limits and rejects exotic values', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(inspectUntrusted(deep).ok).toBe(false);
    expect(inspectUntrusted(new Array(50).fill(0), { maxNodes: 10 }).ok).toBe(false);
    expect(inspectUntrusted('x'.repeat(200_001)).ok).toBe(false);
    expect(inspectUntrusted({ f: () => 1 }).ok).toBe(false);
    expect(inspectUntrusted({ d: new Date() }).ok).toBe(false);
    expect(inspectUntrusted({ m: new Map() }).ok).toBe(false);
    expect(inspectUntrusted({ s: Symbol('x') }).ok).toBe(false);
    const cyc: Record<string, unknown> = {};
    cyc['c'] = cyc;
    expect(inspectUntrusted(cyc).ok).toBe(false);
    expect(inspectUntrusted({ a: [1, 'x', true, null, { b: 2 }] })).toEqual({ ok: true, nodes: 8 });
  });
});

describe('Emitter', () => {
  it('delivers typed events and unsubscribes', () => {
    const em = new Emitter<{ a: number; b: string }>();
    const got: number[] = [];
    const off = em.on('a', (n) => got.push(n));
    em.emit('a', 1);
    off();
    off();
    em.emit('a', 2);
    expect(got).toEqual([1]);
    expect(em.listenerCount('a')).toBe(0);
  });
  it('is safe against (un)subscription during emit and isolates throwing listeners', () => {
    const em = new Emitter<{ e: number }>();
    const calls: string[] = [];
    const offB = em.on('e', () => calls.push('b'));
    em.on('e', () => {
      calls.push('a');
      offB();
      throw new Error('boom');
    });
    em.on('e', () => calls.push('c'));
    // reorder: 'b' was subscribed first
    expect(() => em.emit('e', 1)).toThrow('boom');
    expect(calls).toEqual(['b', 'a', 'c']);
    calls.length = 0;
    expect(() => em.emit('e', 2)).toThrow('boom');
    expect(calls).toEqual(['a', 'c']);
    em.clear();
    const spy = vi.fn();
    em.emit('e', 3);
    expect(spy).not.toHaveBeenCalled();
    expect(em.listenerCount('e')).toBe(0);
  });
});

import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, digest, fromBase64Url, hashJson, hashQuantized, sha256, toBase64Url, toHex } from '../src/hash';

describe('sha256', () => {
  it('matches node:crypto for every length around the block boundaries and for a large input', () => {
    for (let n = 0; n <= 200; n++) {
      const data = randomBytes(n);
      expect(toHex(sha256(data))).toBe(createHash('sha256').update(data).digest('hex'));
    }
    const big = randomBytes(1_000_003);
    expect(toHex(sha256(big))).toBe(createHash('sha256').update(big).digest('hex'));
  });

  it('matches the published test vectors', () => {
    expect(toHex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(digest(new Uint8Array(0))).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('canonicalJson', () => {
  it('sorts keys, drops undefined members and normalises -0', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: -0 }] })).toBe('{"a":[2,{"c":0}],"b":1}');
  });

  it('is independent of key insertion order', () => {
    expect(hashJson({ x: 1, y: { p: 1, q: 2 } })).toBe(hashJson({ y: { q: 2, p: 1 }, x: 1 }));
  });

  it('rejects values that cannot be hashed reproducibly', () => {
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson({ a: Infinity })).toThrow();
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    expect(() => canonicalJson(cyc)).toThrow();
    expect(() => canonicalJson({ f: () => 1 })).toThrow();
  });

  it('allows a shared (non-cyclic) reference twice', () => {
    const shared = { k: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}');
  });
});

describe('base64url', () => {
  it('round-trips and rejects malformed text', () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n);
      expect(Array.from(fromBase64Url(toBase64Url(b)) as Uint8Array)).toEqual(Array.from(b));
    }
    expect(fromBase64Url('a+b')).toBeNull();
    expect(fromBase64Url('a')).toBeNull();
  });
});

describe('hashQuantized', () => {
  it('ignores sub-millimetre noise and notices real change', () => {
    expect(hashQuantized([1.0001, 2, 3])).toBe(hashQuantized([1.0002, 2, 3]));
    expect(hashQuantized([1.0, 2, 3])).not.toBe(hashQuantized([1.01, 2, 3]));
  });

  it('hashes non-finite values as a sentinel instead of throwing', () => {
    expect(hashQuantized([NaN])).toBe(hashQuantized([Infinity]));
  });
});

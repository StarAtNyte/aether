import { describe, expect, it } from 'vitest';
import { generateBuiltinSync, validateOutput, type GeneratorOutput, type MeshPart } from '@aether/procgen';
import { partToBufferGeometry, prepareOutputParts, preparePart } from '../src/geometry/buffer-geometry';
import { prepareSoft } from '../src/geometry/soften';
import { encodeOutput } from '../src/geometry/ddc';
import { codecReady, decodeEntry, decodeInner, encodeEntry, encodeInner, isCompressedEntry, packEntry } from '../src/geometry/ddc-codec';
import { checkOutputShape, outputTransfer } from '../src/geometry/gen-protocol';
import { LaneCookSource } from '../src/cook/lane-source';

function builtin(id: string, seed = 7): GeneratorOutput {
  const v = validateOutput(generateBuiltinSync(id, {}, seed));
  if (!v.ok) throw new Error(v.error);
  prepareOutputParts(v.output.parts);
  for (const p of v.output.parts) prepareSoft(p, preparePart);
  return v.output;
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(b.length).toBe(a.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

/** Largest angle (degrees) between matching normals. */
function maxAngle(a: Float32Array, b: Float32Array): number {
  expect(b.length).toBe(a.length);
  let worst = 0;
  for (let i = 0; i < a.length; i += 3) {
    const la = Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!), lb = Math.hypot(b[i]!, b[i + 1]!, b[i + 2]!);
    if (la === 0 && lb === 0) continue;
    const d = (a[i]! * b[i]! + a[i + 1]! * b[i + 1]! + a[i + 2]! * b[i + 2]!) / (la * lb);
    worst = Math.max(worst, (Math.acos(Math.min(1, d)) * 180) / Math.PI);
  }
  return worst;
}

/** The same triangles in the same order and winding, each possibly rotated. */
function sameTriangles(a: ArrayLike<number>, b: ArrayLike<number>): void {
  expect(b.length).toBe(a.length);
  for (let t = 0; t < a.length; t += 3) {
    const x = [a[t], a[t + 1], a[t + 2]].join(',');
    const rots = [0, 1, 2].map((r) => [b[t + r], b[t + ((r + 1) % 3)], b[t + ((r + 2) % 3)]].join(','));
    expect(rots).toContain(x);
  }
}

describe('compressed geometry-cache entries', () => {
  it('round-trips generator outputs within the stated precision, far smaller than format 1', async () => {
    for (const id of ['classical-temple', 'boulder', 'tree-broadleaf', 'terrain']) {
      const out = builtin(id);
      const v1 = encodeOutput(out).bytes;
      const enc = await encodeEntry(out, true);
      const buf = await enc.blob.arrayBuffer();
      expect(isCompressedEntry(buf)).toBe(true);
      expect(enc.bytes).toBeLessThan(v1 / 2);
      const back = await decodeEntry(buf);
      expect(checkOutputShape(back)).toBe(true);
      out.parts.forEach((p, i) => {
        const q = back.parts[i] as MeshPart;
        expect(maxDiff(p.positions, q.positions)).toBeLessThanOrEqual(2 ** -12 + 1e-6);
        expect(maxAngle(p.normals, q.normals)).toBeLessThan(0.1);
        if (p.uvs) expect(maxDiff(p.uvs, q.uvs!)).toBeLessThanOrEqual(2 ** -17 + 1e-6);
        if (p.colors) expect(maxDiff(p.colors, q.colors!)).toBeLessThanOrEqual(2 ** -13 + 1e-6);
        expect(Array.from(q.indices)).toEqual(Array.from(p.indices));
        expect(q.material).toEqual(p.material);
        const r = p.prepared!, s = q.prepared!;
        expect(s.indices.constructor).toBe(r.indices.constructor);
        expect(Array.from(s.indices)).toEqual(Array.from(r.indices));
        if (r.splitIndices) expect(Array.from(s.splitIndices!)).toEqual(Array.from(s.indices));
        expect(maxDiff(r.uvs, s.uvs)).toBeLessThanOrEqual(2 ** -17 + 1e-6);
        expect(Array.from(s.bounds!)).toEqual(Array.from(r.bounds!));
        expect(s.kit).toBe(r.kit);
        // Arrays shared in the output stay shared.
        if (r.positions === p.positions) expect(s.positions).toBe(q.positions);
        const g = partToBufferGeometry(q);
        expect(g.getAttribute('position').count).toBe(r.positions.length / 3);
      });
      expect(back.bounds).toEqual(out.bounds);
      expect(back.colliders.length).toBe(out.colliders.length);
      const bufs = outputTransfer(back);
      expect(new Set(bufs).size).toBe(bufs.length);
    }
  });

  it('stores far coordinates, non-finite values and non-unit normals without loss', async () => {
    const positions = new Float32Array([5000.123, 1, 2, 5001.5, 1, 2, 5000, 3, 2.25]);
    const normals = new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 1, 0]);
    const colors = new Float32Array([NaN, 0, 1, 0.5, 0.25, 0.125, 1, 1, 1]);
    const out = { parts: [{ positions, normals, colors, indices: new Uint32Array([0, 1, 2]), material: {} }], colliders: [], bounds: { min: [0, 0, 0], max: [1, 1, 1] }, stats: { ms: 1, triangles: 1 } } as unknown as GeneratorOutput;
    const back = await decodeEntry(await (await encodeEntry(out, true)).blob.arrayBuffer());
    const q = back.parts[0]!;
    expect(Array.from(q.positions)).toEqual(Array.from(positions));
    expect(maxDiff(normals, q.normals)).toBeLessThanOrEqual(2 ** -15);
    expect(Number.isNaN(q.colors![0])).toBe(true);
    expect(Array.from(q.colors!).slice(1)).toEqual(Array.from(colors).slice(1));
  });

  it('gives the lanes the same arrays a later visit reads back', async () => {
    await codecReady();
    const out = builtin('classical-temple');
    const inner = encodeInner(out);
    const first = decodeInner(inner.inner);
    const later = await decodeEntry(await (await packEntry(inner)).blob.arrayBuffer());
    first.parts.forEach((p, i) => {
      const q = later.parts[i] as MeshPart;
      expect(Array.from(q.positions)).toEqual(Array.from(p.positions));
      expect(Array.from(q.normals)).toEqual(Array.from(p.normals));
      expect(Array.from(q.indices)).toEqual(Array.from(p.indices));
      expect(Array.from(q.prepared!.uvs)).toEqual(Array.from(p.prepared!.uvs));
    });
  });

  it('reads format 1 entries, writes them with the switch off, and rejects malformed ones', async () => {
    const out = builtin('boulder');
    const v1 = await encodeOutput(out).blob.arrayBuffer();
    expect(isCompressedEntry(v1)).toBe(false);
    expect((await decodeEntry(v1)).parts.length).toBe(out.parts.length);
    const off = await (await encodeEntry(out, false)).blob.arrayBuffer();
    expect(isCompressedEntry(off)).toBe(false);
    const good = new Uint8Array(await (await encodeEntry(out, true)).blob.arrayBuffer());
    await expect(decodeEntry(good.slice(0, good.byteLength >> 1).buffer)).rejects.toThrow();
    const wrong = good.slice();
    new DataView(wrong.buffer).setUint32(4, 12, true);
    await expect(decodeEntry(wrong.buffer)).rejects.toThrow();
    await expect(decodeEntry(new ArrayBuffer(4))).rejects.toThrow();
  });

  it('is read from a cooked pack by the lanes', async () => {
    const a = new Uint8Array(await (await encodeEntry(builtin('boulder', 1), true)).blob.arrayBuffer());
    const b = new Uint8Array(await (await encodeEntry(builtin('boulder', 2), true)).blob.arrayBuffer());
    const at = Math.ceil(a.byteLength / 8) * 8;
    const pack = new Uint8Array(at + b.byteLength);
    pack.set(a);
    pack.set(b, at);
    const key = (c: string): string => c.repeat(64);
    const src = new LaneCookSource({ packs: ['p0'], entries: { [key('1')]: [0, 0, a.byteLength, 0], [key('2')]: [0, at, b.byteLength, 0] } }, async () => pack.buffer);
    const got = await src.get(key('2'));
    expect(got && checkOutputShape(got.output)).toBe(true);
    expect(Array.from((await src.encoded(key('1')))!)).toEqual(Array.from(a));
  });
});

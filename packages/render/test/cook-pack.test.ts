import { describe, expect, it } from 'vitest';
import type { WorldDoc } from '@aether/core';
import { parseCookManifest } from '../src/cook/format';
import { cookManifest, packGeometry, programSetBody, worldOutputKeys } from '../src/cook/pack';

function world(n: number): WorldDoc {
  const entities: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) entities[`e${i}`] = { id: `e${i}`, name: `e${i}`, transform: { position: [i * 3, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, shape: { kind: 'procedural', generator: 'test-rock', params: { i }, seed: 1 }, material: 'stone', physics: null, tags: [] };
  return { id: 'w', name: 'W', entities, generators: {} } as unknown as WorldDoc;
}

const rec = (w: WorldDoc) => ({ world: w, irHash: 'a'.repeat(64), genVersion: 'gen1.p3.e2', startMode: 'orbit' as const, opening: { position: [0, 2, 0] as [number, number, number], target: [1, 1, 0] as [number, number, number] } });

describe('packing a cook', () => {
  it('cuts packs at the target, stores identical entries once and leaves out entries over the cap', async () => {
    const w = world(6);
    const keys = [...(await worldOutputKeys(w, 'gen1.p3.e2')).keys()];
    const bytes = new Map<string, Uint8Array>();
    keys.forEach((k, i) => bytes.set(k, new Uint8Array(i === 5 ? 500 : 100).fill(i + 1)));
    bytes.set(keys[2]!, new Uint8Array(100).fill(2)); // the same bytes as keys[1]
    const written = new Map<string, number>();
    const g = await packGeometry(rec(w), { keys, read: async (k) => bytes.get(k) ?? null, writePack: (f, _p, n) => void written.set(f, n), packTarget: 210, maxEntryBytes: 400 });
    expect(g.stats.tooLarge).toBe(1);
    expect(g.stats.shared).toBe(1);
    expect(Object.keys(g.entries)).toHaveLength(5);
    expect(g.entries[keys[2]!]!.slice(0, 3)).toEqual(g.entries[keys[1]!]!.slice(0, 3));
    for (const p of g.packs) expect(p.bytes).toBeLessThanOrEqual(210);
    expect([...written.keys()]).toEqual(g.packs.map((p) => p.file));
    const m = await cookManifest(rec(w), 'showcase', g, {});
    expect(parseCookManifest(JSON.parse(JSON.stringify(m))).ok).toBe(true);
  });

  it("puts the load's own programs first, each pair once", () => {
    const s = { a: 'A', b: 'B', c: 'C' };
    const body = programSetBody('low', { pairs: [['a', 'b']], sources: s }, { pairs: [['a', 'b'], ['a', 'c'], ['x', 'c']], sources: s });
    expect(body).toEqual({ tier: 'low', boot: 1, pairs: [['a', 'b'], ['a', 'c']], sources: s });
    expect(programSetBody('low', null, null)).toBeNull();
  });
});

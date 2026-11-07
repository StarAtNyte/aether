import { describe, expect, it } from 'vitest';
import { BoxGeometry, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { createWorld, type EntityInput } from '@aether/core';
import { decodeHlod, encodeHlod, membersKey, positionBounds, type HlodProxy } from '../src/streaming/hlod';
import { compactProxy, dropSmallPieces, ProxyGather, simplifyProxy, loadSimplifier } from '../src/streaming/hlod-bake';
import { CellStreamer, estimateExtent, planStreaming, streamingConfig, worldPartition } from '../src/streaming/cell-streaming';
import { parseCookManifest } from '../src/cook/format';

function proxy(cell: string, n: number): HlodProxy {
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions.set([i * 0.5, (i % 7) * 0.25, -i * 0.125], i * 3);
    normals.set([0, 1, 0], i * 3);
    colors.set([0.2, 0.5, 0.9], i * 3);
  }
  const indices = new Uint32Array(Math.floor((n - 2) / 1) * 3);
  for (let i = 0; i + 2 < n; i++) indices.set([i, i + 1, i + 2], i * 3);
  return { cell, members: ['b', 'a'], bounds: positionBounds(positions), positions, normals, colors, indices: indices.slice(0, (n - 2) * 3) };
}

describe('HLOD proxy file', () => {
  it('round-trips proxies within the quantization', () => {
    const ps = [proxy('0:1,2', 40), proxy('0:3,4', 70_000)];
    const out = decodeHlod(encodeHlod(ps));
    expect(out).toHaveLength(2);
    for (let k = 0; k < 2; k++) {
      const a = ps[k]!, b = out[k]!;
      expect(b.cell).toBe(a.cell);
      expect(b.members).toEqual(a.members);
      expect(b.indices).toEqual(a.indices);
      const ext = Math.max(a.bounds[3] - a.bounds[0], a.bounds[4] - a.bounds[1], a.bounds[5] - a.bounds[2]);
      for (let i = 0; i < a.positions.length; i++) expect(Math.abs(b.positions[i]! - a.positions[i]!)).toBeLessThanOrEqual(ext / 65535 + 1e-6);
      for (let i = 0; i < a.colors.length; i++) expect(Math.abs(b.colors[i]! - a.colors[i]!)).toBeLessThan(0.01);
      expect(b.normals[1]).toBeCloseTo(1, 5);
    }
  });

  it('refuses malformed files', () => {
    const bytes = encodeHlod([proxy('c', 10)]);
    expect(() => decodeHlod(bytes.subarray(0, bytes.length - 8))).toThrow();
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => decodeHlod(bad)).toThrow();
  });

  it('keys members in any order', () => {
    expect(membersKey(['b', 'a'])).toBe(membersKey(['a', 'b']));
  });
});

describe('HLOD bake', () => {
  it('gathers meshes in world space with their albedo and drops small pieces', async () => {
    const g = new ProxyGather();
    const wall = new Mesh(new BoxGeometry(6, 9, 0.3), new MeshStandardMaterial({ color: '#ffffff' }));
    wall.position.set(100, 4.5, 0);
    wall.updateMatrixWorld(true);
    const pot = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshStandardMaterial({ color: '#ff0000' }));
    pot.updateMatrixWorld(true);
    g.addMesh(wall, () => undefined);
    g.addMesh(pot, () => undefined);
    // See-through glass is left out.
    g.addMesh(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ transparent: true, opacity: 0.3 })), () => undefined);
    expect(g.triangles).toBe(24);
    expect(g.skipped).toBe(1);
    const m = g.mesh();
    expect(positionBounds(m.positions)[3]).toBeCloseTo(103, 4);
    const S = await loadSimplifier();
    const kept = dropSmallPieces(m, S.generatePositionRemap(m.positions.slice(), 3), 0.35);
    expect(kept.length).toBe(36);
    const c = compactProxy(m, kept);
    expect(c.positions.length / 3).toBe(24);
    expect(c.colors[0]).toBeCloseTo(1, 3);
  });

  it('simplifies a facade of small boxes to far fewer triangles within the error', async () => {
    const g = new ProxyGather();
    const mat = new MeshStandardMaterial({ color: '#d0c0a0' });
    const box = new BoxGeometry(1, 1, 1);
    // A wall with 200 window frames of thin boards on it.
    const wall = new Mesh(new BoxGeometry(40, 12, 0.4), mat);
    wall.updateMatrixWorld(true);
    g.addMesh(wall, () => undefined);
    for (let i = 0; i < 200; i++) {
      for (const [sx, sy, dx, dy] of [[1, 0.06, 0, 0.7], [1, 0.06, 0, -0.7], [0.06, 1.4, 0.5, 0], [0.06, 1.4, -0.5, 0]] as const) {
        const m = new Mesh(box, mat);
        m.matrixWorld.copy(new Matrix4().makeTranslation(-19 + (i % 20) * 2 + dx, -5 + Math.floor(i / 20) * 1.1 + dy, 0.21).multiply(new Matrix4().makeScale(sx, sy, 0.03)));
        g.addMesh(m, () => undefined);
      }
    }
    const src = g.triangles;
    const out = await simplifyProxy(g.mesh(), { error: 0.08, minSize: 0.35, maxTriangles: 20_000 });
    expect(out.indices.length / 3).toBeLessThan(src / 4);
    expect(out.indices.length / 3).toBeGreaterThanOrEqual(12);
    const b = positionBounds(out.positions);
    expect(b[0]).toBeCloseTo(-20, 1);
    expect(b[3]).toBeCloseTo(20, 1);
  });
});

describe('cell streaming with proxies', () => {
  const house = (id: string, x: number): EntityInput => ({ id, transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'procedural', generator: 'row-house', params: { width: 6, depth: 8 } } });
  function world() {
    const entities: Record<string, EntityInput> = {};
    for (let i = 0; i <= 20; i++) entities[`h${i}`] = house(`h${i}`, -400 + i * 40);
    return createWorld({ entities });
  }

  it('keeps a proxied cell at full detail only within the proxy rings, with its exact box', () => {
    const w = world();
    const p = worldPartition(w)!;
    const plan = planStreaming(w, p);
    const cfg = streamingConfig(p.cellSize, 'medium');
    const plain = new CellStreamer(plan, cfg);
    const proxied = new CellStreamer(plan, cfg);
    for (const k of [...proxied.keys()]) {
      const b = proxied.box(k)!;
      proxied.setProxy(k, [b[0] + 2, b[1] + 2, b[2] - 2, b[3] - 2]);
    }
    const a = plain.primeAround([{ x: 0, z: 0 }]);
    const b = proxied.primeAround([{ x: 0, z: 0 }]);
    expect(b.length).toBeLessThan(a.length);
    for (const k of b) expect(proxied.proxied(k)).toBe(true);
    // An exact box does not widen when its members are built.
    const k0 = [...proxied.keys()][0]!;
    const before = [...proxied.box(k0)!];
    proxied.learn(proxied.members(k0)[0]!, [-9999, -9999, 9999, 9999]);
    expect([...proxied.box(k0)!]).toEqual(before);
    // Cells past the proxy ring unload after the delay.
    for (const k of proxied.loadingKeys()) proxied.loaded(k);
    const far = proxied.update([{ x: 400, z: 0 }], 10_000);
    expect(far.unload.length).toBe(0);
    const later = proxied.update([{ x: 400, z: 0 }], 20_000);
    expect(later.unload.length).toBeGreaterThan(0);
  });
});

describe('tiles of long features', () => {
  it('size a tile by its extent, not the whole feature, and stream a tiled street', () => {
    const w = createWorld({
      entities: {
        k: { id: 'k', shape: { kind: 'procedural', generator: 'kerbs', params: { halfLength: 100, extent: 54 } } },
        s: { id: 's', shape: { kind: 'procedural', generator: 'town-street', params: { length: 184, extent: 50 } } },
        whole: { id: 'whole', shape: { kind: 'procedural', generator: 'town-street', params: { length: 184 } } },
      },
    });
    expect(estimateExtent(w.entities['k']!)).toBe(54);
    expect(estimateExtent(w.entities['s']!)).toBe(50);
    expect(estimateExtent(w.entities['whole']!)).toBeNull();
  });
});

describe('cook manifest hlod', () => {
  const base = { format: 2, irHash: 'a'.repeat(64), genVersion: 'g1', dir: 'x/', world: { id: 'w', name: 'W', entities: 1 }, opening: null, startMode: 'orbit', profile: 'showcase', partition: null, packs: [], cells: [], entries: {}, programs: {}, lightmap: null };
  it('reads a valid hlod field and refuses a bad one', () => {
    const ok = parseCookManifest({ ...base, hlod: { file: 'hlod/proxies.bin', bytes: 10, version: 1, cells: [{ cell: '0:1,1', bounds: [0, 0, 0, 1, 1, 1], triangles: 4 }] } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.manifest.hlod?.cells[0]?.cell).toBe('0:1,1');
    expect(parseCookManifest({ ...base, hlod: { file: '../x', bytes: 10, version: 1, cells: [] } }).ok).toBe(false);
    expect(parseCookManifest({ ...base, hlod: { file: 'hlod/p.bin', bytes: 10, version: 1, cells: [{ cell: 'c', bounds: [0, 0], triangles: 1 }] } }).ok).toBe(false);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { readScene, renderInstanceIds } from '@aether/arch';
import { PHOTO_BUILDING_ID, deriveBuild, memoryCaller, parseRoomDescription, runBuild } from '@aether/arch/photo';
import { partKinds } from '@aether/arch';
import { glbTriangles } from '../src/photo/glb-geometry';
import { toUnitMesh, warmMeshes } from '../src/photo/raster-meshes';

const lib = resolve(__dirname, '../../../assets/lib');
const chair = resolve(lib, 'i/chair-dining-02.lite.006d2586.glb');

describe('real meshes in the instance raster', () => {
  it('normalises triangles to a unit box', () => {
    const m = toUnitMesh({ positions: Float32Array.from([2, 1, 4, 4, 1, 4, 4, 3, 8]), indices: Uint32Array.from([0, 1, 2]) });
    expect(m).not.toBeNull();
    const p = Array.from(m!.positions);
    expect(Math.min(p[0]!, p[3]!, p[6]!)).toBeCloseTo(-0.5);
    expect(Math.max(p[0]!, p[3]!, p[6]!)).toBeCloseTo(0.5);
    expect(Math.min(p[1]!, p[4]!, p[7]!)).toBeCloseTo(0);
    expect(Math.max(p[1]!, p[4]!, p[7]!)).toBeCloseTo(1);
  });

  it('rejects malformed GLB bytes', async () => {
    expect(await glbTriangles(new Uint8Array(10), null)).toBeNull();
    expect(await glbTriangles(new Uint8Array(64).fill(7), null)).toBeNull();
  });

  it.skipIf(!existsSync(chair))('reads a meshopt library model and draws it with fewer pixels than its box', async () => {
    const { MeshoptDecoder } = await import('meshoptimizer');
    const tri = await glbTriangles(new Uint8Array(readFileSync(chair)), MeshoptDecoder as never);
    expect(tri).not.toBeNull();
    expect(tri!.indices.length).toBeGreaterThan(300);
    const parsed = parseRoomDescription(JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json'), 'utf8')) as unknown, partKinds());
    if (!parsed.ok) throw new Error(parsed.error);
    const mem = memoryCaller(createWorld({}));
    await runBuild(mem.world(), deriveBuild({ ...parsed.value, items: [] }), mem.call);
    const placed = await mem.call('place_items', { items: [{ kind: 'chair', room: 'room', id: 'c1', at: [1.8, 2.2] }] });
    expect(placed.ok).toBe(true);
    const w = mem.world();
    const scene = readScene(w, PHOTO_BUILDING_ID)!;
    const id = scene.items.find((i) => i.kind === 'chair')!.id;
    const c = scene.items.find((i) => i.id === id)!.pos;
    const pose = { name: 'p', label: 'p', room: 'x', kind: 'corner', position: [c[0] - 1.6, 1.3, c[2] - 1.6], target: [c[0], 0.5, c[2]], up: [0, 1, 0], fov: 50, hideTops: false } as never;
    const count = (meshes?: Map<string, NonNullable<ReturnType<typeof toUnitMesh>>>): number => {
      const inst = renderInstanceIds(w, PHOTO_BUILDING_ID, pose, 1.5, 256, undefined, meshes);
      const k = inst!.ids.indexOf(id) + 1;
      return k === 0 ? 0 : inst!.buffer.reduce((n, v) => n + (v === k ? 1 : 0), 0);
    };
    const unit = toUnitMesh(tri!)!;
    const withMesh = count(new Map([[id, unit]]));
    expect(withMesh).toBeGreaterThan(0);
    expect(withMesh).toBeLessThan(count() * 1.05 + 5);
    // procedural pieces get their generator's mesh
    const warm = await warmMeshes(w, PHOTO_BUILDING_ID);
    expect(warm.size).toBeGreaterThan(0);
  });
});

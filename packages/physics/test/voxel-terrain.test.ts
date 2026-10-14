import { beforeAll, describe, expect, it } from 'vitest';
import { WorldDoc } from '@aether/core';
import { brickBoxes, initPhysics, PhysicsWorld, type VoxelSolidSource } from '../src/index';

/** Terrain: solid below y = 50, plus a 3-block pillar at (4, 50..52, 4); chunk versions are mutable. */
function source(): VoxelSolidSource & { versions: Map<string, number>; extra: Set<string> } {
  const versions = new Map<string, number>();
  const extra = new Set<string>(['4,50,4', '4,51,4', '4,52,4']);
  return {
    height: 128,
    versions,
    extra,
    isSolid: (x, y, z) => y < 50 || extra.has(`${x},${y},${z}`),
    chunkVersion: (cx, cz) => versions.get(`${cx},${cz}`) ?? 1,
  };
}

describe('voxel terrain colliders', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('merges solid cells into few boxes and never covers air', () => {
    const src = source();
    const full = brickBoxes(src, 0, 40, 0);
    expect(full).toHaveLength(1);
    expect(full[0]).toEqual({ x0: 0, y0: 40, z0: 0, x1: 8, y1: 48, z1: 8 });
    const top = brickBoxes(src, 0, 48, 0);
    let volume = 0;
    for (const b of top) {
      volume += (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0);
      for (let y = b.y0; y < b.y1; y++) for (let z = b.z0; z < b.z1; z++) for (let x = b.x0; x < b.x1; x++) expect(src.isSolid(x, y, z)).toBe(true);
    }
    expect(volume).toBe(2 * 64 + 3);
    expect(top.length).toBeLessThanOrEqual(3);
  });

  it('lets dynamic bodies land on block terrain and follows block edits', async () => {
    const doc = WorldDoc.parse({
      environment: { ground: null },
      entities: {
        crate: { id: 'crate', transform: { position: [10.5, 60, 10.5] }, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, physics: { body: 'dynamic' } },
      },
    });
    const pw = await PhysicsWorld.create(doc);
    const src = source();
    pw.setVoxelTerrain(src);
    for (let i = 0; i < 240; i++) pw.stepFixed();
    const p = pw.getState('crate')?.position;
    expect(p?.[1]).toBeGreaterThan(50.3);
    expect(p?.[1]).toBeLessThan(50.7);
    expect(pw.terrainCounts.bricks).toBeGreaterThan(0);
    expect(pw.terrainCounts.colliders).toBeLessThan(40);
    // Dig a pit under the crate: the chunk version changes and the crate falls in.
    const solid = src.isSolid;
    src.isSolid = (x, y, z) => (x >= 8 && x < 13 && z >= 8 && z < 13 && y >= 45 && y < 50 ? false : solid(x, y, z));
    src.versions.set('0,0', 2);
    for (let i = 0; i < 240; i++) pw.stepFixed();
    expect(pw.getState('crate')?.position[1]).toBeLessThan(46);
    pw.dispose();
  });
});

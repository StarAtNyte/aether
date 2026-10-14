/**
 * Allocation probe of the voxel per-frame paths: the game step (walking,
 * mining, mobs, drops), the collision sweep, ray casts and the streamer's
 * steady-state update must allocate (almost) nothing.
 */
import { describe, expect, it } from 'vitest';
import { VoxelGame as VoxelGameSettings } from '@aether/core';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';
import { createBody, moveBody } from '../src/collide';
import { createInput, VoxelGame } from '../src/game/game';
import { terrainIdentity } from '../src/jobs';
import { VoxelJobPool } from '../src/pool';
import { createHit, raycastVoxels } from '../src/raycast';
import { ChunkStreamer } from '../src/streamer';
import { VoxelWorld } from '../src/world';
import { flatWorld, reg, terrain } from './helpers';

const VOXEL_SRC = /packages\/voxel\/src\//;
const BUDGET = 16;

describe('voxel allocation probe', () => {
  it('game step (walking, mining, mobs, drops) allocates nothing per tick', async () => {
    const world = flatWorld(2, 9, 'grass');
    const g = new VoxelGame({ world, reg, settings: VoxelGameSettings.parse({ mobs: false, mode: 'creative' }), seed: 3, spawn: [0.5, 10, 0.5] });
    g.spawnMob('pig', 5.5, 10.01, 5.5);
    g.spawnMob('sheep', -5.5, 10.01, 5.5);
    g.spawnDrop('stick', 1, 3, 11, 3, false);
    const input = createInput();
    input.pitch = -0.6;
    input.primary = true;
    let t = 0;
    const r = await probeAllocations(
      () => {
        input.forward = Math.sin((t += 0.01)) > 0 ? 1 : -1;
        input.yaw = t;
        g.tick(1 / 60, input);
        g.events.length = 0;
      },
      { iterations: 300, warmup: 2000, match: VOXEL_SRC },
    );
    // Breaking blocks (creative) emits events and rarely spawns nothing; the steady path must stay clean.
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET * 8);
  });

  it('collision sweeps and ray casts allocate nothing', async () => {
    const world = flatWorld(1, 9);
    const b = createBody(0.5, 10.5, 0.5, 0.3, 1.8);
    const hit = createHit();
    const get = (x: number, y: number, z: number): number => world.get(x, y, z);
    const solid = (id: number): boolean => id !== 0;
    let t = 0;
    const r = await probeAllocations(
      () => {
        t += 0.01;
        b.vx = Math.sin(t) * 4;
        b.vz = Math.cos(t) * 4;
        b.vy -= 0.5;
        moveBody(world, b, 1 / 60, true);
        raycastVoxels(get, b.x, b.y + 1.6, b.z, Math.sin(t), -0.7, Math.cos(t), 6, solid, hit);
      },
      { iterations: 600, warmup: 4000, match: VOXEL_SRC },
    );
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
  });

  it('a settled streamer update allocates nothing', async () => {
    const id = terrainIdentity(terrain({ preset: 'flat' }), 1);
    const pool = new VoxelJobPool({ createWorker: null });
    const world = new VoxelWorld(reg);
    pool.configure(id, reg.size - 1);
    const s = new ChunkStreamer(world, pool, { onMesh: () => undefined, onUnload: () => undefined }, { viewDistance: 2 });
    s.setCenter(8, 8);
    while (!s.settled) {
      s.update();
      await new Promise((res) => setTimeout(res, 1));
    }
    const r = await probeAllocations(() => s.update(), { iterations: 500, warmup: 3000, match: VOXEL_SRC });
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
    pool.dispose();
  });
});

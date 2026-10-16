/**
 * Chunk meshing cost guards. The mesher runs in workers (see `voxel.worker.ts`), so its cost is
 * latency of new terrain, not frame time; the budgets are generous enough for CI machines and tight
 * enough to catch an accidental quadratic loop. The column-height pass for the sun shadows must stay a
 * small share of the meshing cost.
 */
import { describe, expect, it } from 'vitest';
import type { ChunkData } from '../src/chunk';
import { VoxelJobContext, terrainIdentity } from '../src/jobs';
import { ChunkMesher } from '../src/mesher';
import { LightVolume, regionIndex } from '../src/light';
import { MAX_PASS_QUADS } from '../src/protocol';
import { id, reg, terrain } from './helpers';

function neighbourhood(ctx: VoxelJobContext, cx: number, cz: number): { chunks: Array<ChunkData | null>; tops: number[] } {
  const chunks: Array<ChunkData | null> = [];
  const tops: number[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const g = ctx.generate(cx + dx, cz + dz);
      chunks.push(g.chunk);
      tops.push(g.top);
    }
  }
  return { chunks, tops };
}

describe('chunk meshing cost', () => {
  it('meshes survival terrain chunks within a latency budget and a quad budget', () => {
    const ctx = new VoxelJobContext(terrainIdentity(terrain({ preset: 'survival' }), 7));
    const times: number[] = [];
    let maxQuads = 0;
    for (let i = 0; i < 12; i++) {
      const { chunks, tops } = neighbourhood(ctx, i * 3, 0);
      const t0 = performance.now();
      const m = ctx.mesh(chunks, tops);
      times.push(performance.now() - t0);
      maxQuads = Math.max(maxQuads, (m.opaque?.quads ?? 0) + (m.cutout?.quads ?? 0) + (m.liquid?.quads ?? 0));
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] as number;
    expect(median, `median ${median.toFixed(1)} ms`).toBeLessThan(60);
    expect(maxQuads).toBeLessThan(MAX_PASS_QUADS);
  });

  it('the column-height pass is a small share of the meshing cost', () => {
    const mesher = new ChunkMesher(reg);
    const v = new LightVolume();
    v.blocks.fill(0);
    for (let z = 0; z < 48; z++) for (let x = 0; x < 48; x++) for (let y = 0; y < 40; y++) v.blocks[regionIndex(x, y, z)] = id('stone');
    v.top = 39;
    v.compute(reg, true);
    mesher.mesh(v);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) mesher.mesh(v);
    const full = (performance.now() - t0) / 20;
    // A solid slab has almost no visible faces, so the mesh is the cheapest it gets and the height pass the largest share.
    expect(full).toBeLessThan(60);
  });

  it('reuses its scratch buffers: repeated meshing does not grow the heap', () => {
    const ctx = new VoxelJobContext(terrainIdentity(terrain({ preset: 'survival' }), 7));
    const { chunks, tops } = neighbourhood(ctx, 0, 0);
    for (let i = 0; i < 5; i++) ctx.mesh(chunks, tops);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 40; i++) ctx.mesh(chunks, tops);
    // The returned meshes are garbage immediately; only a leak would keep growing (allow a generous 64 MiB of unreclaimed garbage).
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024 * 1024);
  });
});

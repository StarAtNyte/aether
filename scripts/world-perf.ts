/**
 * Frame cost of a saved world (`world.json`, e.g. from scripts/brief-probe.ts) on the integrated GPU, at eye height inside its
 * largest room: median and 90th percentile frame interval over a slow walk, plus the renderer's draw calls and triangles.
 *
 *   GEN_GPU=intel npx tsx scripts/world-perf.ts <world.json> [--frames=150]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { readScene } from '@aether/arch';
import { GpuRoom } from './lib/gpu-room';

const [file, ...rest] = process.argv.slice(2);
if (!file) throw new Error('usage: world-perf <world.json> [--frames=N]');
const frames = Number(rest.find((a) => a.startsWith('--frames='))?.slice(9) ?? 150);
const world = createWorld(JSON.parse(readFileSync(resolve(file), 'utf8'))) as WorldDoc;
const building = Object.values(world.entities).find((e) => e.arch?.role === 'building' && !e.parent);
const room = [...(building ? (readScene(world, building.id)?.rooms ?? []) : [])].sort((a, b) => b.area - a.area)[0];
// Without a building the walk is a line through the middle of where the pieces stand (eye height, on foot).
let [x0, z0, x1, z1] = room ? room.bbox : [0, 0, 0, 0];
if (!room) {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const e of Object.values(world.entities)) {
    const [x, , z] = e.transform.position;
    if (Math.abs(x) < 400 && Math.abs(z) < 400) {
      xs.push(x);
      zs.push(z);
    }
  }
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const q = (a: number[], p: number): number => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))] as number;
  [x0, x1, z0, z1] = [q(xs, 0.05), q(xs, 0.95), q(zs, 0.05) + 6, q(zs, 0.95) - 6];
}
const cx = (x0 + x1) / 2;
const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  const r = await gpu.frameCost([cx, 1.6, z1 - 1], [cx, 1.6, z0 + 1], frames);
  process.stdout.write(`${JSON.stringify({ room: room?.key ?? 'open world', ...r }, (k, v) => (['textures', 'geometries'].includes(k) ? undefined : v))}\n`);
} finally {
  await gpu.close();
}

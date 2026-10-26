/**
 * Stills of a saved world (`world.json`, e.g. from scripts/brief-probe.ts) drawn by the real renderer on the integrated GPU
 * (`GEN_GPU=intel`): an overview from outside and eye-height views from inside, with the renderer's own counts (fps, draw calls,
 * triangles, instances) printed before each still.
 *
 *   GEN_GPU=intel npx tsx scripts/world-stills.ts <world.json> <outDir> [--width=960]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom } from './lib/gpu-room';

const [file, outArg, ...rest] = process.argv.slice(2);
if (!file || !outArg) throw new Error('usage: world-stills <world.json> <outDir> [--width=N]');
const width = Number(rest.find((a) => a.startsWith('--width='))?.slice(8) ?? 960);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const world = createWorld(JSON.parse(readFileSync(resolve(file), 'utf8'))) as WorldDoc;
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
const [x0, x1, z0, z1] = [q(xs, 0.02), q(xs, 0.98), q(zs, 0.02), q(zs, 0.98)];
const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
const r = Math.max(8, x1 - x0, z1 - z0);
const views: Array<[string, [number, number, number], [number, number, number], number]> = [
  ['overview', [cx + r * 0.7, r * 0.8, z1 + r * 0.7], [cx, 0.5, cz], 55],
  ['eye-near', [cx, 1.6, z0 + 1.2], [cx, 1.4, z1], 70],
  ['eye-far', [cx, 1.6, z1 - 1.2], [cx, 1.4, z0], 70],
  ['eye-side', [x0 + 1.2, 1.6, cz], [x1, 1.4, cz], 70],
];
const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  for (const [name, position, target, fov] of views) {
    const png = await gpu.still({ position, target, fov }, { width, height: Math.round(width * 0.667) }, 'studio');
    writeFileSync(join(out, `${name}.png`), png);
    process.stdout.write(`wrote ${join(out, `${name}.png`)}\n`);
  }
} finally {
  await gpu.close();
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom } from '../lib/gpu-room';
const [dir, name, outDir, w = '1000'] = process.argv.slice(2);
mkdirSync(outDir!, { recursive: true });
const world = createWorld(JSON.parse(readFileSync(join(dir!, `${name}.json`), 'utf8'))) as WorldDoc;
const dims: Record<string, [number, number]> = { office: [5, 4], workshop: [6, 4.5], kitchen: [5, 4] };
const [W, D] = dims[name!]!;
const views: Array<[string, [number, number, number], [number, number, number], number]> = [
  ['overview', [W - 0.35, 2.55, D - 0.35], [W * 0.4, 0.4, D * 0.3], 85],
  ['eye-door', [W * 0.3, 1.6, D - 0.5], [W * 0.5, 1.0, 0.4], 75],
  ['eye-north', [W * 0.5, 1.6, D - 0.6], [W * 0.5, 0.9, 0.3], 70],
  ['eye-west', [W - 0.9, 1.6, D - 0.5], [0.5, 0.8, D * 0.4], 80],
  ['close', [W * 0.5, 1.5, D * 0.55], [W * 0.5, 0.75, 0.5], 60],
];
const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  const cost = await gpu.frameCost([W * 0.5, 1.6, D - 0.6], [W * 0.5, 1.6, D * 0.5], 90);
  console.log('FRAMECOST', name, JSON.stringify(cost));
  for (const [n, position, target, fov] of views) {
    writeFileSync(join(outDir!, `${name}-${n}.png`), await gpu.still({ position, target, fov }, { width: Number(w), height: Math.round(Number(w) * 0.667) }, 'studio'));
    console.log('wrote', n);
  }
} finally { await gpu.close(); }

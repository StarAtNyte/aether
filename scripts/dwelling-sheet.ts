/**
 * Contact sheet of the village dwellings: every type in a row (and a second row of variants), drawn by the real renderer
 * on the integrated GPU, from the street and from above. Used to look at the houses before a village is built.
 *
 *   GEN_GPU=intel npx tsx scripts/dwelling-sheet.ts <outDir> [--types=a,b] [--variants=0,1] [--width=1200]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom } from './lib/gpu-room';

const [outArg, ...rest] = process.argv.slice(2);
if (!outArg) throw new Error('usage: dwelling-sheet <outDir> [--types=a,b] [--variants=0,1] [--width=N] [--params=JSON]');
const arg = (n: string, d: string): string => rest.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const types = arg('types', 'stone-cottage,timber-frame,mediterranean,machiya,brick-terrace,adobe,nordic').split(',');
const variants = arg('variants', '0,1').split(',').map(Number);
const width = Number(arg('width', '1200'));
const extra = JSON.parse(arg('params', '{}')) as Record<string, unknown>;
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const pitch = 14;
const entities: Record<string, unknown> = {};
types.forEach((t, i) => {
  variants.forEach((v, j) => {
    const id = `${t}-${v}`;
    entities[id] = {
      id,
      name: id,
      transform: { position: [i * pitch, 0, -j * pitch], rotation: [0, 0, 0], scale: [1, 1, 1] },
      shape: { kind: 'procedural', generator: 'furn-dwelling', params: { type: t, variant: v, path: 4, ...extra } },
      physics: { type: 'static' },
    };
  });
});
const world = createWorld({ name: 'dwelling sheet', entities } as never) as WorldDoc;
const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  const cx = ((types.length - 1) * pitch) / 2;
  const cz = (-(variants.length - 1) * pitch) / 2;
  const span = Math.max(types.length * pitch, 30);
  const shots: Array<[string, [number, number, number], [number, number, number], number]> = [
    ['street', [cx, 1.7, 14], [cx, 3, cz], 62],
    ['aerial', [cx + span * 0.1, span * 0.55, 30 + span * 0.15], [cx, 0, cz - 2], 50],
  ];
  types.forEach((t, i) => {
    shots.push([`front-${t}`, [i * pitch + 6, 2.0, 11], [i * pitch, 2.6, 0], 48]);
    shots.push([`corner-${t}`, [i * pitch + 12, 3.2, 12], [i * pitch, 2.2, -1], 46]);
  });
  for (const [name, position, target, fov] of shots) {
    const png = await gpu.still({ position, target, fov }, { width, height: Math.round(width * 0.62) }, 'studio');
    writeFileSync(join(out, `${name}.png`), png);
    process.stdout.write(`wrote ${join(out, `${name}.png`)}\n`);
  }
} finally {
  await gpu.close();
}

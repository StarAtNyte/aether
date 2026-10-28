/**
 * Finish-identity check: boxes of different finishes drawn by the real renderer; each must look like its own finish.
 *   GEN_GPU=intel npx tsx scripts/zz-mat-test.ts <outDir> [row|ground|rev]
 * Scene `row` also checks the picture: the cobble, stone and plain plaster boxes (same colour) must differ in texture
 * (mean luma gradient and spread of their regions) by more than THRESHOLD, else the exit code is 1.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom } from './lib/gpu-room';

const T = (position: [number, number, number]): unknown => ({ position, rotation: [0, 0, 0], scale: [1, 1, 1] });
const box = (id: string, size: [number, number, number], position: [number, number, number], material: Record<string, unknown>): unknown => ({ id, shape: { kind: 'primitive', primitive: 'box', size }, transform: T(position), material, physics: { body: 'static' } });

const SCENES: Record<string, { mats: Array<Record<string, unknown>>; spacing: number }> = {
  row: { mats: [{ finish: 'plaster', color: '#f2e9dc' }, { finish: 'plaster', roughness: 0.95 }, { finish: 'cobble', color: '#cdbfa3' }, { finish: 'stone', color: '#cdbfa3' }, { finish: 'plaster', color: '#cdbfa3' }], spacing: 4 },
  rev: { mats: [{ finish: 'cobble', color: '#cdbfa3' }, { finish: 'stone', color: '#cdbfa3' }, { finish: 'plaster', color: '#cdbfa3' }, { finish: 'plaster', color: '#f2e9dc' }], spacing: 4 },
  solo: { mats: [{ finish: 'cobble', color: '#cdbfa3' }], spacing: 4 },
  ground: { mats: ['grass', 'gravel', 'soil', 'sand', 'rock', 'plaster', 'brick', 'oak', 'stone'].map((finish) => ({ finish })), spacing: 2.6 },
};
const THRESHOLD = 1.5;
const [outArg, which = 'row'] = process.argv.slice(2);
if (!outArg) throw new Error('usage: zz-mat-test <outDir> [row|ground]');
const sc = SCENES[which];
if (!sc) throw new Error(`unknown scene ${which}`);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const n = sc.mats.length;
const ents = sc.mats.map((m, i) => box(`b${i}`, [2.2, 2.2, 0.6], [9 + (i - (n - 1) / 2) * sc.spacing, 1.1, 0], m));
const world = createWorld({ entities: Object.fromEntries((ents as Array<{ id: string }>).map((e) => [e.id, e])) } as never) as WorldDoc;
const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  const png = await gpu.still({ position: [9, 2, 12], target: [9, 1.8, 0], fov: 60 }, { width: 900, height: 500 }, 'studio');
  writeFileSync(join(out, `${which}.png`), png);
  process.stdout.write(`wrote ${join(out, `${which}.png`)}\n`);
  if (which === 'row') {
    // Box centres (px) in the 900x500 still; the regions sit inside each face.
    const stats = await gpu.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
      c.drawImage(bmp, 0, 0);
      return [450 - 295, 450 - 147, 450, 450 + 147, 450 + 295].map((cx) => {
        const w = 44, h = 40, x0 = cx - w / 2, y0 = 255;
        const d = c.getImageData(x0, y0, w, h).data;
        const l = (i: number): number => 0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!;
        let mean = 0, grad = 0;
        for (let i = 0; i < w * h; i++) mean += l(i) / (w * h);
        let sd = 0;
        for (let i = 0; i < w * h; i++) sd += (l(i) - mean) ** 2 / (w * h);
        for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) grad += Math.abs(l(y * w + x) - l(y * w + x - 1)) / (h * (w - 1));
        return { mean, sd: Math.sqrt(sd), grad };
      });
    }, png.toString('base64'));
    process.stdout.write(`regions ${JSON.stringify(stats.map((s) => ({ mean: +s.mean.toFixed(1), sd: +s.sd.toFixed(2), grad: +s.grad.toFixed(2) })))}\n`);
    const [cobble, stone, plaster] = [stats[2]!, stats[3]!, stats[4]!];
    const apart = (a: typeof cobble, b: typeof cobble): number => Math.abs(a.grad - b.grad) + Math.abs(a.sd - b.sd);
    const pairs: Array<[string, number]> = [['cobble/plaster', apart(cobble, plaster)], ['stone/plaster', apart(stone, plaster)], ['cobble/stone', apart(cobble, stone)]];
    for (const [n, v] of pairs) process.stdout.write(`${n}: ${v.toFixed(2)}\n`);
    if (pairs.some(([, v]) => v < THRESHOLD)) {
      process.stdout.write('FAIL: finishes render alike\n');
      process.exitCode = 1;
    }
  }
} finally {
  await gpu.close();
}

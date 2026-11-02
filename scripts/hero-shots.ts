/**
 * Render the hardcore hero shots of one or more worlds (template id or world JSON path) into a 2×2 contact sheet each.
 *   GEN_GPU=intel npx tsx scripts/hero-shots.ts --out=<dir> [--full] <world> [<world> ...]
 * --full renders at full quality (no automatic low-memory mode), one shot per fresh browser so a big world fits.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { heroShots } from '@aether/agent';
import { GpuRoom } from './lib/gpu-room';

const args = process.argv.slice(2);
const out = resolve(args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'probe-out/hero-shots');
const worlds = args.filter((a) => !a.startsWith('--'));
const full = args.includes('--full');
if (full) process.env['AETHER_FULL_QUALITY'] = '1';
await mkdir(out, { recursive: true });
let gpu = await GpuRoom.open({});
try {
  for (const from of worlds) {
    const path = from.endsWith('.json') ? resolve(from) : resolve(`apps/studio/public/templates/worlds/${from}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { world?: WorldDoc };
    const world = createWorld((raw.world ?? raw) as WorldDoc) as WorldDoc;
    const shots = heroShots(world);
    let imgs: Array<string | null | undefined>;
    if (full) {
      imgs = [];
      for (const s of shots) {
        await gpu.close();
        gpu = await GpuRoom.open({});
        await gpu.load(world);
        // The first full-quality frame after a load comes out black while the post-processing chain warms up: keep the second.
        await gpu.capture([{ ...s.pose, hideTops: false }], { width: 1280, height: 720 });
        imgs.push(...(await gpu.capture([{ ...s.pose, hideTops: false }], { width: 1280, height: 720 })));
      }
    } else {
      await gpu.load(world);
      imgs = await gpu.capture(shots.map((s) => ({ ...s.pose, hideTops: false })), { width: 1280, height: 720 });
    }
    const tag = from.endsWith('.json') ? `${basename(dirname(path))}-${basename(path, '.json')}` : from;
    const files: string[] = [];
    for (const [i, d] of imgs.entries()) {
      if (typeof d !== 'string') continue;
      const f = join(out, `${tag}-${shots[i]?.name ?? i}.png`);
      await writeFile(f, Buffer.from(d.slice(d.indexOf(',') + 1), 'base64'));
      files.push(f);
    }
    execFileSync('montage', [...files, '-tile', '2x2', '-geometry', '800x450+4+4', join(out, `${tag}.jpg`)]);
    console.log('wrote', join(out, `${tag}.jpg`));
  }
} finally {
  await gpu.close();
}
process.exit(0);

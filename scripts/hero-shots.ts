/**
 * Render the hardcore hero shots of one or more worlds (template id or world JSON path) into a 2×2 contact sheet each.
 *   GEN_GPU=intel npx tsx scripts/hero-shots.ts --out=<dir> <world> [<world> ...]
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
await mkdir(out, { recursive: true });
const gpu = await GpuRoom.open({});
try {
  for (const from of worlds) {
    const path = from.endsWith('.json') ? resolve(from) : resolve(`apps/studio/public/templates/worlds/${from}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { world?: WorldDoc };
    const world = createWorld((raw.world ?? raw) as WorldDoc) as WorldDoc;
    const shots = heroShots(world);
    await gpu.load(world);
    const imgs = await gpu.capture(shots.map((s) => ({ ...s.pose, hideTops: false })), { width: 1280, height: 720 });
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

/**
 * One photoreal still of a finished photo run (the folder eval-photo wrote: world.json, views.json, textures/), for tuning the look
 * without re-running the room.
 *
 *   GEN_GPU=intel npx tsx scripts/photo-still.ts <runFolder> <out.png> [--env='{"exposure":1.5}'] [--quality=studio|final] [--width=960]
 *   [--view=first|last] [--world=first.world.json]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WorldDoc } from '@aether/core';
import { GpuRoom } from './lib/gpu-room';

const [dirArg, outArg, ...flags] = process.argv.slice(2);
if (!dirArg || !outArg) throw new Error("usage: photo-still <runFolder> <out.png> [--env='{...}'] [--quality=studio|final] [--width=N] [--view=first|last] [--world=file]");
const dir = resolve(dirArg);
const flag = (k: string): string | undefined => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3);
const world = JSON.parse(readFileSync(join(dir, flag('world') ?? 'world.json'), 'utf8')) as WorldDoc;
const env = flag('env') ? (JSON.parse(flag('env') as string) as Record<string, unknown>) : {};
const withEnv = { ...world, environment: { ...world.environment, ...env } } as WorldDoc;
const views = JSON.parse(readFileSync(join(dir, 'views.json'), 'utf8')) as { first: { aspect: number; pose: { position: [number, number, number]; target: [number, number, number]; fov: number } } | null; last: { aspect: number; pose: { position: [number, number, number]; target: [number, number, number]; fov: number } } | null };
const view = (flag('view') === 'first' ? views.first : views.last) ?? views.last ?? views.first;
if (!view) throw new Error('no view');
const width = Math.max(480, Math.min(1920, Number(flag('width') ?? 960)));
const gpu = await GpuRoom.open({ headed: process.env['SHOT_HEADED'] === '1' });
try {
  const tdir = join(dir, 'textures');
  const sets: Array<{ id: string; def: unknown; files: Array<{ tier: number; map: string; bytes: Uint8Array }> }> = [];
  if (existsSync(tdir) && world.textures) {
    for (const [id, def] of Object.entries(world.textures)) {
      const files = readdirSync(tdir).filter((f) => f.startsWith(`${id}.`)).map((f) => {
        const m = /\.(albedo|orm|normal)\.(\d+)\.webp$/.exec(f) as RegExpExecArray;
        return { tier: Number(m[2]), map: m[1] as string, bytes: new Uint8Array(readFileSync(join(tdir, f))) };
      });
      sets.push({ id, def, files });
    }
  }
  await gpu.registerTextures(sets);
  await gpu.load(withEnv);
  if (flag('snap')) await gpu.snap(resolve(flag('snap') as string));
  if (flag('stats')) console.log(JSON.stringify(await gpu.lightVolume()));
  const png = await gpu.still({ position: view.pose.position, target: view.pose.target, fov: view.pose.fov }, { width, height: Math.round(width / Math.max(0.5, Math.min(3, view.aspect))) }, flag('quality') === 'studio' ? 'studio' : 'final');
  writeFileSync(resolve(outArg), png);
  console.log(`wrote ${outArg}`);
} finally {
  await gpu.close();
}

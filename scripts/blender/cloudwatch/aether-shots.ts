/**
 * The Cloudwatch Harbour shot list (design doc: A hero, B stair, C crossing, D harbour) rendered by Aether itself, at the
 * render tier in AETHER_RENDER_TIER (the GpuRoom pins it with AETHER_FULL_QUALITY=1).
 *
 *   STATIC_DIR=<dist> AETHER_FULL_QUALITY=1 AETHER_RENDER_TIER=high npx tsx scripts/blender/cloudwatch/aether-shots.ts --out=<dir>
 *        [--size=1600x900] [--shots=A,B,C,D] [--prefix=high-]
 *
 * The dist must carry the template's models (apps/studio/public/templates/models/cloudwatch-harbour/).
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom } from '../../lib/gpu-room';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/cloudwatch');
const [W, H] = (flag('size') ?? '1600x900').split('x').map(Number) as [number, number];
const only = new Set((flag('shots') ?? 'A,B,C,D').split(','));
const prefix = flag('prefix') ?? '';

/** Blender (x, y, z) to Aether (x, z, -y). */
const toAether = (p: readonly [number, number, number]): [number, number, number] => [p[0], p[2], -p[1]];
/** Vertical field of view of a lens on a 36 mm wide sensor at 16:9. */
const vfov = (lens: number): number => (2 * Math.atan((36 * 9) / 16 / 2 / lens) * 180) / Math.PI;
// Kept in step with scripts/blender/cloudwatch/shots.py (the stair's eye: profile_z(39) + 1.5; the breakwater's end).
const SHOTS: Record<string, { eye: [number, number, number]; target: [number, number, number]; lens: number }> = {
  A: { eye: [2.0, 130.9, 45.65], target: [-50.1, -163.2, 24.6], lens: 20 },
  B: { eye: [-0.6, 39.0, 15.0], target: [0.5, 130.0, 52.0], lens: 24 },
  C: { eye: [3.6, -13.4, 7.55], target: [-177.7, -97.9, 18.0], lens: 22 },
  D: { eye: [51.4, -90.75, 3.2], target: [0.0, 40.0, 16.0], lens: 40 },
  // The sunset itself (not in the design's list: a check of the sun, its bloom and the glitter).
  S: { eye: [2.0, 130.9, 45.65], target: [-81.9, 7.8, 40.4], lens: 30 },
  // The mother and child at the crossing, from across the track (a check of the people).
  P: { eye: [-2.6, -5.6, 7.45], target: [0.2, -12.6, 6.9], lens: 35 },
};

await mkdir(out, { recursive: true });
const raw = JSON.parse(readFileSync(resolve('apps/studio/public/templates/worlds/cloudwatch-harbour.json'), 'utf8')) as { world: WorldDoc };
const world = createWorld(raw.world) as WorldDoc;
const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  const keys = Object.keys(SHOTS).filter((k) => only.has(k));
  const poses = keys.map((k) => ({ position: toAether(SHOTS[k]!.eye), target: toAether(SHOTS[k]!.target), fov: vfov(SHOTS[k]!.lens), hideTops: false }));
  // The first frames after a load warm the post chain: capture once, keep the second.
  await gpu.capture(poses.slice(0, 1), { width: 640, height: 360 });
  const imgs = await gpu.capture(poses, { width: W, height: H });
  for (const [i, d] of imgs.entries()) {
    if (typeof d !== 'string') continue;
    const f = join(out, `${prefix}${keys[i]}.png`);
    await writeFile(f, Buffer.from(d.slice(d.indexOf(',') + 1), 'base64'));
    console.log('wrote', f);
  }
} finally {
  await gpu.close();
}
process.exit(0);

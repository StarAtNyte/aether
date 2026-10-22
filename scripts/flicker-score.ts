/**
 * Camera-orbit flicker score of a world on this machine's GPU: orbit the eye 3 degrees in 0.15 degree steps (live frames, as the
 * studio draws them) and report the second-temporal-difference score and the same-pose score, for one render tier.
 *
 *   AETHER_E2E_GPU=1 npx tsx scripts/flicker-score.ts <world.json> [--tier=ultra] [--eye=x,y,z] [--out=file.json]
 *
 * Run it before and after a render change on the same world; lower is better. Writes the numbers as JSON when `--out` is given.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorldDoc } from '@aether/core';
import { GpuRoom } from './lib/gpu-room';
import { orbitFlicker, stillFlicker } from './bench/flicker';

const [worldArg, ...flags] = process.argv.slice(2);
if (!worldArg) throw new Error('usage: flicker-score <world.json> [--tier=ultra] [--eye=x,y,z] [--out=file]');
const flag = (k: string): string | undefined => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3);
const eye = (flag('eye') ?? '0,1.65,0').split(',').map(Number) as [number, number, number];
const steps = 21;
const W = 480;
const H = 270;

async function main(): Promise<void> {
  const world = JSON.parse(readFileSync(resolve(worldArg as string), 'utf8')) as WorldDoc;
  const gpu = await GpuRoom.open();
  try {
    await gpu.load(world);
    if (flag('tier')) await gpu.setTier(flag('tier') as string);
    const base = 0;
    const poses = Array.from({ length: steps }, (_, i) => ({ x: eye[0], y: eye[1], z: eye[2], yaw: base + ((i * 0.15) * Math.PI) / 180, pitch: -0.05 }));
    const frames = await gpu.liveFrames(poses, { w: W, h: H });
    const again = await gpu.liveFrames([poses[0]!, poses[0]!], { w: W, h: H }, 12);
    const score = { tier: flag('tier') ?? 'auto', orbit: Math.round(orbitFlicker(frames) * 1000) / 1000, still: Math.round(stillFlicker(again[0]!, again[1]!) * 1000) / 1000 };
    console.log(JSON.stringify(score));
    if (flag('out')) writeFileSync(resolve(flag('out') as string), `${JSON.stringify(score)}\n`);
  } finally {
    await gpu.close();
  }
}
void main();

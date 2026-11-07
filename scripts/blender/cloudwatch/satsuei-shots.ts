/**
 * Cloudwatch Harbour through the post chain at the render tier the page runs (the compositing layer of a painted world: diffusion,
 * light rays, flare, dust, fringe, grain, gradient layer, letterbox), under the world's defaults and under shot grades
 * (`renderer.setShotGrade`, uniforms only). `aether-shots.ts` draws the scene directly, without the post chain.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/blender/cloudwatch/satsuei-shots.ts --out=<dir>
 *        [--size=1600x900] [--shots=A,S] [--grades=world,afternoon,golden,dusk,blue,off] [--world=<template json>]
 *
 * Writes `<grade>-<shot>.png` (`world`: no shot grade; `off`: the layer's amounts at zero, the grade and bloom as the world sets them).
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom } from '../../lib/gpu-room';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/cloudwatch-satsuei');
const [W, H] = (flag('size') ?? '1600x900').split('x').map(Number) as [number, number];
const only = (flag('shots') ?? 'A,S').split(',');
const grades = (flag('grades') ?? 'world,afternoon,golden,dusk,blue').split(',');

/** A colour script over one sunset: the shot grades a cinematic animates through (docs/worlds/CLOUDWATCH_HARBOUR.md). */
export const COLOUR_SCRIPT: Record<string, Record<string, number | string> | null> = {
  world: null,
  off: { diffusion: 0, godRays: 0, flare: 0, dust: 0, grain: 0, chroma: 0, gradientAmount: 0 },
  afternoon: { exposureEv: 0.2, temperature: 0.12, saturation: 0.96, contrast: 0.97, gradientTop: '#fff4e0', gradientBottom: '#b8d4e8', gradientAmount: 0.3, godRays: 0.2, flare: 0.12, dust: 0.2, diffusion: 0.25, practicals: 0 },
  golden: { exposureEv: 0.05, temperature: 0.3, saturation: 1.08, gradientTop: '#ffd08a', gradientBottom: '#ff9860', gradientAmount: 0.3, godRays: 0.55, flare: 0.3, dust: 0.35, diffusion: 0.45, bloom: 1.15, practicals: 0.15 },
  dusk: { exposureEv: -0.35, temperature: 0.02, saturation: 1.1, contrast: 1.04, gradientTop: '#b0479a', gradientBottom: '#ff9070', gradientAmount: 0.4, godRays: 0.3, flare: 0.2, dust: 0.2, diffusion: 0.4, practicals: 0.7 },
  blue: { exposureEv: -1.1, temperature: -0.5, saturation: 0.88, contrast: 1.05, gradientTop: '#24358a', gradientBottom: '#6a58a8', gradientAmount: 0.45, godRays: 0, flare: 0, dust: 0.1, diffusion: 0.5, bloom: 1.5, practicals: 1, vignette: 0.25 },
};

/** Blender (x, y, z) to Aether (x, z, -y). */
const toAether = (p: readonly [number, number, number]): [number, number, number] => [p[0], p[2], -p[1]];
const vfov = (lens: number): number => (2 * Math.atan((36 * 9) / 16 / 2 / lens) * 180) / Math.PI;
// The lookout (shot A of the design) and the view toward the sun (S), as in aether-shots.ts.
const SHOTS: Record<string, { eye: [number, number, number]; target: [number, number, number]; lens: number }> = {
  A: { eye: [2.0, 130.9, 45.65], target: [-50.1, -163.2, 24.6], lens: 20 },
  S: { eye: [2.0, 130.9, 45.65], target: [-81.9, 7.8, 40.4], lens: 30 },
  D: { eye: [51.4, -90.75, 3.2], target: [0.0, 40.0, 16.0], lens: 40 },
};

await mkdir(out, { recursive: true });
const raw = JSON.parse(readFileSync(resolve(flag('world') ?? 'apps/studio/public/templates/worlds/cloudwatch-harbour.json'), 'utf8')) as { world: WorldDoc };
const gpu = await GpuRoom.open({});
try {
  await gpu.load(createWorld(raw.world) as WorldDoc);
  // Shot grades are uniforms only: animating through the whole colour script on the live view links no program.
  const links = await gpu.evaluate(async (script) => {
    const r = window.__aether?.simulation?.renderer as unknown as { setShotGrade?(g: unknown): void; renderer: { info: { memory: { programs: number } } } };
    const frames = (n: number): Promise<void> => new Promise((res) => { let k = 0; const f = (): void => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await frames(30);
    const before = r.renderer.info.memory.programs;
    const steps = Object.values(script);
    for (let i = 0; i < 120; i++) {
      const a = steps[Math.floor(i / 20) % steps.length] as Record<string, number | string> | null;
      r.setShotGrade?.(a ? { ...a, letterbox: (i % 40) / 40 } : null);
      await frames(1);
    }
    r.setShotGrade?.(null);
    await frames(10);
    return { before, after: r.renderer.info.memory.programs };
  }, COLOUR_SCRIPT);
  console.log(`programs while animating the colour script: ${links.before} -> ${links.after}`);
  for (const name of grades) {
    if (!(name in COLOUR_SCRIPT)) throw new Error(`unknown grade ${name}`);
    for (const k of only) {
      const s = SHOTS[k];
      if (!s) throw new Error(`unknown shot ${k}`);
      const url = await gpu.evaluate(
        async ([grade, pos, target, fov, w, h]) => {
          const r = window.__aether?.simulation?.renderer as unknown as {
            setShotGrade?(g: unknown): void;
            renderStill(o: unknown): Promise<{ width: number; height: number; data: Uint8Array | Uint8ClampedArray }>;
          };
          r.setShotGrade?.(grade);
          // Twice: the first draw after a pose change primes what the new view needs.
          const opts = { width: w, height: h, pose: { pos, target, fov }, frames: 1 };
          await r.renderStill(opts);
          const img = await r.renderStill(opts);
          const c = new OffscreenCanvas(img.width, img.height);
          c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
          const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(bin);
        },
        [COLOUR_SCRIPT[name] ?? null, toAether(s.eye), toAether(s.target), vfov(s.lens), W, H] as const,
      );
      const f = join(out, `${name}-${k}.png`);
      await writeFile(f, Buffer.from(url, 'base64'));
      console.log('wrote', f);
    }
  }
} finally {
  await gpu.close();
}
process.exit(0);

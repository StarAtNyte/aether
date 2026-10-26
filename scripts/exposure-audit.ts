/**
 * Exposure audit of a saved world (`world.json`): stills at eye height inside its largest room (the studio's own renderer, the
 * trim learned for each pose as the review captures see it), with the histogram of every still (mean luminance, p5, p95, washed
 * share over 247 of 255, crushed share under 8), and a walking check of the live view: the per-room exposure trim is read while
 * the eye stands, then while it walks across the room (it must not move: the trim is only learned at rest).
 *
 *   GEN_GPU=intel npx tsx scripts/exposure-audit.ts <world.json> <outDir> [--width=640] [--live=1]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { readScene } from '@aether/arch';
import { GpuRoom } from './lib/gpu-room';
import { decodePng } from '../tests/e2e/support/png';

const [file, outArg, ...rest] = process.argv.slice(2);
if (!file || !outArg) throw new Error('usage: exposure-audit <world.json> <outDir> [--width=N] [--live=1]');
const width = Number(rest.find((a) => a.startsWith('--width='))?.slice(8) ?? 640);
const live = (rest.find((a) => a.startsWith('--live='))?.slice(7) ?? '1') === '1';
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const world = createWorld(JSON.parse(readFileSync(resolve(file), 'utf8'))) as WorldDoc;
const building = Object.values(world.entities).find((e) => e.arch?.role === 'building' && !e.parent);
const room = [...(building ? (readScene(world, building.id)?.rooms ?? []) : [])].sort((a, b) => b.area - a.area)[0];
if (!room || !building) throw new Error('no building room');
const [x0, z0, x1, z1] = room.bbox;
const [px, pz] = [building.transform.position[0], building.transform.position[2]];
const [cx, cz] = [(x0 + x1) / 2 + px, (z0 + z1) / 2 + pz];
const views: Array<[string, [number, number, number], [number, number, number]]> = [
  ['near', [cx, 1.6, z0 + pz + 0.9], [cx, 1.4, z1 + pz]],
  ['far', [cx, 1.6, z1 + pz - 0.9], [cx, 1.4, z0 + pz]],
  ['left', [x0 + px + 0.9, 1.6, cz], [x1 + px, 1.4, cz]],
  ['right', [x1 + px - 0.9, 1.6, cz], [x0 + px, 1.4, cz]],
];

function stats(png: Buffer): { mean: number; p5: number; p95: number; washed: number; crushed: number } {
  const img = decodePng(png);
  const lum: number[] = [];
  for (let i = 0; i < img.data.length; i += 4 * 5) lum.push(0.2126 * (img.data[i] as number) + 0.7152 * (img.data[i + 1] as number) + 0.0722 * (img.data[i + 2] as number));
  lum.sort((a, b) => a - b);
  const q = (p: number): number => lum[Math.min(lum.length - 1, Math.floor(p * lum.length))] as number;
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  return { mean: Math.round(lum.reduce((s, v) => s + v, 0) / lum.length), p5: Math.round(q(0.05)), p95: Math.round(q(0.95)), washed: r(lum.filter((v) => v > 247).length / lum.length), crushed: r(lum.filter((v) => v < 8).length / lum.length) };
}

const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  const rows: unknown[] = [];
  for (const [name, position, target] of views) {
    const png = await gpu.still({ position, target, fov: 70 }, { width, height: Math.round(width * 0.5625) }, 'studio');
    writeFileSync(join(out, `${name}.png`), png);
    const s = stats(png);
    rows.push({ view: name, ...s });
    process.stdout.write(`${name}: ${JSON.stringify(s)}\n`);
  }
  const mean = Math.round((rows as Array<{ mean: number }>).reduce((a, r) => a + r.mean, 0) / rows.length);
  const washed = Math.round(((rows as Array<{ washed: number }>).reduce((a, r) => a + r.washed, 0) / rows.length) * 1000) / 1000;
  const crushed = Math.round(((rows as Array<{ crushed: number }>).reduce((a, r) => a + r.crushed, 0) / rows.length) * 1000) / 1000;
  let walk: unknown = null;
  if (live) {
    // Live view: stand at the centre, wait until the trim stops changing, then walk across the room and read the trim every frame.
    walk = await gpu.evaluate(async (a: { cx: number; cz: number; z0: number; z1: number }) => {
      const r = window.__aether?.simulation?.renderer as unknown as { setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void; eyeExposure: { trim: number; ev: number } };
      const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
      r.setCameraPose(a.cx, 1.6, a.z0 + 1, 0, 0);
      let last = Number.NaN;
      let steady = 0;
      const t0 = performance.now();
      while (steady < 8 && performance.now() - t0 < 60000) {
        await sleep(1000);
        const t = r.eyeExposure.trim;
        steady = Math.abs(t - last) < 0.01 ? steady + 1 : 0;
        last = t;
      }
      const settled = r.eyeExposure.trim;
      const seen: number[] = [];
      const evs: number[] = [];
      for (let i = 0; i < 90; i++) {
        r.setCameraPose(a.cx, 1.6, a.z0 + 1 + ((a.z1 - a.z0 - 2) * i) / 90, 0, 0);
        await new Promise((res) => requestAnimationFrame(() => res(null)));
        seen.push(r.eyeExposure.trim);
        evs.push(r.eyeExposure.ev);
      }
      return { trimAtRest: Math.round(settled * 100) / 100, trimWhileWalking: { min: Math.round(Math.min(...seen) * 100) / 100, max: Math.round(Math.max(...seen) * 100) / 100 }, roomEv: { min: Math.round(Math.min(...evs) * 100) / 100, max: Math.round(Math.max(...evs) * 100) / 100 }, restedSeconds: Math.round((performance.now() - t0) / 1000) };
    }, { cx, cz, z0: z0 + pz, z1: z1 + pz });
    process.stdout.write(`walk: ${JSON.stringify(walk)}\n`);
  }
  const summary = { world: file, room: room.key, mean, washed, crushed, rows, walk };
  writeFileSync(join(out, 'audit.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(`SUMMARY ${JSON.stringify({ mean, washed, crushed, walk })}\n`);
} finally {
  await gpu.close();
}

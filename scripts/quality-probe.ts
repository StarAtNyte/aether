/**
 * Live-view quality probe of one world: for the hero shots plus a far aerial view, the picture as the studio draws it
 * (colour PNG after the view has settled), the still flicker (two frames from the same pose), the orbit flicker (a slow
 * 0.1 degree orbit, frames taken while the view moves) and the settle curve (how much the picture changes over the first
 * second after the camera stops). Also logs the tier, pixel ratio and resolution scale through the run.
 *
 *   STATIC_DIR=/tmp/q-dist GEN_GPU=intel npx tsx scripts/quality-probe.ts --out=<dir> [--tier=ultra] <world>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { heroShots } from '@aether/agent';
import { GpuRoom } from './lib/gpu-room';
import { orbitFlicker, stillFlicker } from './bench/flicker';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/quality');
const tier = flag('tier') ?? 'ultra';
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) throw new Error('usage: quality-probe --out=<dir> [--tier=ultra] <world>');
const shotsOn = args.includes('--settle-shots');
const W = 640;
const H = 360;

type Pose = { name: string; x: number; y: number; z: number; yaw: number; pitch: number };

function toPose(name: string, p: readonly number[], t: readonly number[]): Pose {
  const dx = (t[0] as number) - (p[0] as number);
  const dy = (t[1] as number) - (p[1] as number);
  const dz = (t[2] as number) - (p[2] as number);
  return { name, x: p[0] as number, y: p[1] as number, z: p[2] as number, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function percentAbove(a: Uint8Array, b: Uint8Array, level: number): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] as number) - (b[i] as number)) > level) n++;
  return (100 * n) / a.length;
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const path = slug!.endsWith('.json') ? resolve(slug!) : resolve(`apps/studio/public/templates/worlds/${slug}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { world?: WorldDoc };
  const world = createWorld((raw.world ?? raw) as WorldDoc) as WorldDoc;
  const shots = heroShots(world);
  const poses: Pose[] = shots.map((s) => toPose(s.name, s.pose.position, s.pose.target));
  // A far aerial view: three times the wide shot's distance from what it looks at, higher up.
  const wide = shots[0];
  if (wide) {
    const p = wide.pose.position;
    const t = wide.pose.target;
    const far = [t[0]! + (p[0]! - t[0]!) * 2.5, t[1]! + Math.max(40, (p[1]! - t[1]!) * 2.5), t[2]! + (p[2]! - t[2]!) * 2.5];
    poses.push(toPose('far-aerial', far, t));
    const drone = [t[0]! + (p[0]! - t[0]!) * 1.6, t[1]! + Math.max(30, (p[1]! - t[1]!) * 1.6), t[2]! + (p[2]! - t[2]!) * 1.6];
    poses.push(toPose('drone', drone, [t[0]!, t[1]! + 10, t[2]!]));
  }
  const gpu = await GpuRoom.open({});
  const report: Record<string, unknown> = { world: slug, tier, poses: {} as Record<string, unknown> };
  const samples: unknown[] = [];
  const stat = async (label: string): Promise<void> => {
    const s = await gpu.evaluate(() => {
      const r = window.__aether?.simulation?.renderer as unknown as { stats(): { resolutionScale: number; fps: number; performanceLevel: number }; memoryStats(): { pixelRatio: number; drawingBuffer: number[]; gpuTier: string }; renderTier?: string } | undefined;
      if (!r) return null;
      const st = r.stats();
      const m = r.memoryStats();
      return { scale: st.resolutionScale, fps: st.fps, level: st.performanceLevel, ratio: m.pixelRatio, buffer: m.drawingBuffer, gpu: m.gpuTier, tier: r.renderTier };
    }, null);
    samples.push({ t: label, ...(s ?? {}) });
  };
  try {
    await gpu.load(world);
    if (tier !== 'auto') await gpu.setTier(tier);
    await gpu.evaluate(async () => { await (window.__aether?.simulation as unknown as { whenFullyLoaded(): Promise<void> }).whenFullyLoaded(); }, null);
    await stat('loaded');
    // The first pose: let the load screen fade and the first chain build.
    await gpu.liveFrames([poses[0]!], { w: 64, h: 36 }, 240);
    if (args.includes('--session')) {
      // 30 s session: 10 s slow orbit, 5 s still, 10 s orbit, 5 s still; tier, pixel ratio and scale logged every second.
      const p = poses.find((q) => q.name === (flag('pose') ?? 'hero-street')) ?? poses[0]!;
      const log = await gpu.evaluate(async (q) => {
        const r = window.__aether?.simulation?.renderer as unknown as { setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void; stats(): { resolutionScale: number; fps: number }; memoryStats(): { pixelRatio: number; drawingBuffer: number[] }; renderTier: string };
        const rows: string[] = [];
        const t0 = performance.now();
        let next = 0;
        while (performance.now() - t0 < 30000) {
          const t = (performance.now() - t0) / 1000;
          const moving = (t < 10) || (t >= 15 && t < 25);
          if (moving) r.setCameraPose(q.x, q.y, q.z, q.yaw + Math.sin(t * 0.6) * 0.25, q.pitch);
          await new Promise((res) => requestAnimationFrame(() => res(null)));
          if (t >= next) {
            next += 1;
            const st = r.stats();
            const m = r.memoryStats();
            rows.push(`${t.toFixed(0)}s ${moving ? 'move' : 'rest'} tier=${r.renderTier} ratio=${m.pixelRatio} scale=${st.resolutionScale} buffer=${m.drawingBuffer.join('x')} fps=${st.fps}`);
          }
        }
        return rows;
      }, p);
      console.log(log.join('\n'));
      writeFileSync(join(out, `${slug}-${tier}-session.txt`), `${log.join('\n')}\n`);
      await gpu.close();
      process.exit(0);
    }
    const timed = flag('timed');
    if (timed) {
      // Timed settle: move for a second, stop, and take the picture as fast as the page allows for two seconds.
      const p = poses.find((q) => q.name === timed) ?? poses[0]!;
      await gpu.liveFrames([p], { w: 64, h: 36 }, 150);
      const moves = Array.from({ length: 20 }, (_, i) => ({ ...p, yaw: p.yaw - ((20 - i) * 0.2 * Math.PI) / 180 }));
      await gpu.liveFrames(moves, { w: 64, h: 36 }, 1);
      await gpu.liveFrames([p], { w: 64, h: 36 }, 1);
      const t0 = Date.now();
      const times: number[] = [];
      for (let i = 0; Date.now() - t0 < 2500; i++) {
        const ms = Date.now() - t0;
        await gpu.snap(join(out, `${slug}-${p.name}-t${String(ms).padStart(4, '0')}.png`));
        times.push(ms);
      }
      console.log('timed', times.join(' '));
      await gpu.close();
      process.exit(0);
    }
    // The aerial poses stay within the orbit's reach (what a visitor can reach): pulled in toward their target when farther.
    const reach = await gpu.evaluate(() => (window.__aether?.simulation?.renderer as unknown as { orbit?: { maxDistance?: number } } | undefined)?.orbit?.maxDistance ?? 0, null);
    if (reach > 0 && wide && !args.includes('--no-reach')) {
      const t = wide.pose.target;
      for (const p of poses) {
        if (p.name !== 'far-aerial' && p.name !== 'drone') continue;
        const d = Math.hypot(p.x - t[0]!, p.y - t[1]!, p.z - t[2]!);
        if (d <= reach) continue;
        const k = reach / d;
        p.x = t[0]! + (p.x - t[0]!) * k;
        p.y = t[1]! + (p.y - t[1]!) * k;
        p.z = t[2]! + (p.z - t[2]!) * k;
      }
      console.log('orbit reach', Math.round(reach));
    }
    const only = flag('only')?.split(',');
    for (const p of poses) {
      if (only && !only.includes(p.name)) continue;
      // Settle long enough for every refinement to finish, then a colour shot and two still frames.
      const settled = await gpu.liveFrames([p, p], { w: W, h: H }, 150);
      await gpu.snap(join(out, `${slug}-${p.name}.png`));
      await stat(`${p.name}:settled`);
      // Settle curve: move a hair, stop, sample at frames 2, 8, 16, 32, 64 after the stop.
      const curve: number[] = [];
      const nudge = { ...p, yaw: p.yaw + 0.002 };
      await gpu.liveFrames([nudge], { w: W, h: H }, 3);
      await gpu.liveFrames([p], { w: W, h: H }, 1);
      let last = (await gpu.liveFrames([p], { w: W, h: H }, 1))[0]!;
      const finalFrame = (settled[1] ?? settled[0]) as Uint8Array;
      for (const n of [2, 8, 16, 32, 64]) {
        last = (await gpu.liveFrames([p], { w: W, h: H }, n))[0]!;
        if (shotsOn) await gpu.snap(join(out, `${slug}-${p.name}-settle-${n}.png`));
        curve.push(Math.round(stillFlicker(last, finalFrame) * 1000) / 1000);
      }
      // Orbit flicker: 0.1 degree steps, 3 frames each (the view counts as moving throughout).
      const orbit = Array.from({ length: 13 }, (_, i) => ({ ...p, yaw: p.yaw + (i * 0.1 * Math.PI) / 180 }));
      const frames = await gpu.liveFrames(orbit, { w: W, h: H }, 3);
      await stat(`${p.name}:orbit`);
      const a = settled[0] as Uint8Array;
      const b = settled[1] as Uint8Array;
      (report['poses'] as Record<string, unknown>)[p.name] = {
        still: Math.round(stillFlicker(a, b) * 1000) / 1000,
        stillOver8: Math.round(percentAbove(a, b, 8) * 1000) / 1000,
        orbit: Math.round(orbitFlicker(frames) * 1000) / 1000,
        settleCurve: curve,
      };
      console.log(p.name, JSON.stringify((report['poses'] as Record<string, unknown>)[p.name]));
    }
    report['samples'] = samples;
    writeFileSync(join(out, `${slug}-${tier}.json`), `${JSON.stringify(report, null, 1)}\n`);
    console.log('wrote', join(out, `${slug}-${tier}.json`));
  } finally {
    await gpu.close();
  }
  process.exit(0);
}
void main();

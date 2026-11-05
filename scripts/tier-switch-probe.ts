/**
 * Quality tier switch probe: opens an interior world, sets a tier through the store (the path the Settings dialog takes),
 * switches tiers, and logs every 250 ms what the renderer says (tier in effect, the transition, the baked light, the
 * reason of the automatic tier), with screenshots of the page over time. Ends with rapid toggles. Fails when anything
 * stays stuck: a transition that does not end, a lightmap left idle on a tier that bakes, a tier that is not the one chosen.
 *
 *   STATIC_DIR=/tmp/tier-dist GEN_GPU=nvidia npx tsx scripts/tier-switch-probe.ts --out=<dir> [--start=low] [world]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { heroShots } from '@aether/agent';
import { GpuRoom } from './lib/gpu-room';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/tier-switch');
const start = flag('start') ?? 'low';
const slug = args.find((a) => !a.startsWith('--')) ?? 'cosy-apartment';

type Sample = { t: number; tier: string; auto: string; reason: string | null; transition: string | null; applying: string | null; lightmap: string; lightmapMsg: string; volume: boolean; level: number };

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const path = slug.endsWith('.json') ? resolve(slug) : resolve(`apps/studio/public/templates/worlds/${slug}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { world?: WorldDoc };
  const world = createWorld((raw.world ?? raw) as WorldDoc) as WorldDoc;
  const shot = heroShots(world)[0];
  const gpu = await GpuRoom.open({});
  const log: Array<Sample & { phase: string }> = [];
  const failures: string[] = [];
  const sample = async (): Promise<Sample> =>
    gpu.evaluate(() => {
      const a = window.__aether!;
      const r = a.simulation!.renderer as unknown as { renderTier: string; autoRenderTier: string; autoTierReason: string | null; qualityTransition: { tier: string; stage: string } | null; lightmapStatus: { state: string; message: string }; lightVolumeReady: boolean; performanceLevel: number };
      const st = a.store.getState() as unknown as { qualityApplying: string | null };
      const tr = r.qualityTransition;
      return { t: performance.now(), tier: r.renderTier, auto: r.autoRenderTier, reason: r.autoTierReason, transition: tr ? `${tr.tier}/${tr.stage}` : null, applying: st.qualityApplying, lightmap: r.lightmapStatus.state, lightmapMsg: r.lightmapStatus.message, volume: r.lightVolumeReady, level: r.performanceLevel };
    }, null);
  const choose = (tier: string): Promise<void> => gpu.evaluate((t) => window.__aether!.store.getState().updateSettings({ renderTier: t as never }), tier);
  /** Watch for `seconds`, screenshots at the given seconds; returns the last sample. */
  const watch = async (phase: string, seconds: number, shots: number[] = []): Promise<Sample> => {
    const t0 = Date.now();
    const due = [...shots];
    let last = await sample();
    while (Date.now() - t0 < seconds * 1000) {
      last = await sample();
      log.push({ phase, ...last });
      const el = (Date.now() - t0) / 1000;
      if (due.length > 0 && el >= (due[0] as number)) {
        const at = due.shift() as number;
        await gpu.snap(join(out, `${phase}-${String(at).replace('.', '_')}s.png`));
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return last;
  };
  /** Wait until the transition is over and the lightmap is not deciding (bounded); returns the last sample. */
  const settle = async (phase: string, maxS: number): Promise<Sample> => {
    const t0 = Date.now();
    let last = await sample();
    while (Date.now() - t0 < maxS * 1000) {
      last = await sample();
      log.push({ phase, ...last });
      if (last.transition === null && last.applying === null && last.lightmap !== 'baking' && last.lightmap !== 'waiting') return last;
      await new Promise((r) => setTimeout(r, 500));
    }
    return last;
  };
  try {
    await choose(start);
    await gpu.load(world);
    await gpu.evaluate(async () => { await (window.__aether?.simulation as unknown as { whenFullyLoaded(): Promise<void> }).whenFullyLoaded(); }, null);
    if (shot) {
      const p = shot.pose.position, t = shot.pose.target;
      const dx = t[0]! - p[0]!, dy = t[1]! - p[1]!, dz = t[2]! - p[2]!;
      await gpu.liveFrames([{ x: p[0]!, y: p[1]!, z: p[2]!, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }], { w: 64, h: 36 }, 60);
    }
    let s = await watch(`${start}-loaded`, 8, [7.5]);
    process.stdout.write(`loaded on ${start}: ${JSON.stringify(s)}\n`);

    // 1. start -> ultra
    await choose('ultra');
    await watch(`${start}-to-ultra`, 4, [0.2, 1, 3]);
    s = await settle(`${start}-to-ultra`, 120);
    await gpu.snap(join(out, `${start}-to-ultra-final.png`));
    process.stdout.write(`${start} -> ultra: ${JSON.stringify(s)}\n`);
    if (s.tier !== 'ultra') failures.push(`${start}->ultra: tier ${s.tier}`);
    if (s.transition !== null || s.applying !== null) failures.push(`${start}->ultra: transition stuck (${s.transition}, ${s.applying})`);
    if (s.lightmap !== 'applied') failures.push(`${start}->ultra: lightmap ${s.lightmap} (${s.lightmapMsg})`);

    // 2. ultra -> low
    await choose('low');
    await watch('ultra-to-low', 3, [0.2, 2.5]);
    s = await settle('ultra-to-low', 60);
    process.stdout.write(`ultra -> low: ${JSON.stringify(s)}\n`);
    if (s.tier !== 'low') failures.push(`ultra->low: tier ${s.tier}`);
    if (s.transition !== null || s.applying !== null) failures.push('ultra->low: transition stuck');

    // 3. auto -> ultra
    await choose('auto');
    s = await settle('to-auto', 60);
    process.stdout.write(`auto: ${JSON.stringify(s)}\n`);
    await choose('ultra');
    s = await settle('auto-to-ultra', 60);
    process.stdout.write(`auto -> ultra: ${JSON.stringify(s)}\n`);
    if (s.tier !== 'ultra' || s.transition !== null) failures.push(`auto->ultra: ${s.tier} ${s.transition}`);

    // 4. rapid toggles, 150 ms apart, ending on ultra
    for (const t of ['low', 'ultra', 'medium', 'low', 'high', 'ultra']) {
      await choose(t);
      await new Promise((r) => setTimeout(r, 150));
    }
    await watch('rapid', 2, [0.5]);
    s = await settle('rapid', 90);
    await gpu.snap(join(out, 'rapid-final.png'));
    process.stdout.write(`rapid toggles -> ultra: ${JSON.stringify(s)}\n`);
    if (s.tier !== 'ultra' || s.transition !== null || s.applying !== null) failures.push(`rapid: ${s.tier} ${s.transition} ${s.applying}`);
    if (s.lightmap !== 'applied') failures.push(`rapid: lightmap ${s.lightmap}`);
  } finally {
    writeFileSync(join(out, 'log.json'), JSON.stringify({ world: slug, start, failures, log }, null, 1));
    await gpu.close();
  }
  process.stdout.write(failures.length ? `FAILED:\n  ${failures.join('\n  ')}\n` : 'OK: every switch completed\n');
  if (failures.length) process.exitCode = 1;
}

void main();

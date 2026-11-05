/**
 * Automatic tier probe: opens a world on the automatic tier (optionally as Firefox, `--firefox`, which takes the cautious
 * start), logs the tier, the ladder level and the reason Settings shows, then orbits the camera continuously and checks that
 * the ladder climbs back while frames are fast.
 *
 *   STATIC_DIR=/tmp/tier-dist GEN_GPU=nvidia npx tsx scripts/tier-climb-probe.ts --out=<dir> [--firefox] [--seconds=60] [world]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom } from './lib/gpu-room';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/tier-climb');
const seconds = Number(flag('seconds') ?? 60);
const firefox = args.includes('--firefox');
const slug = args.find((a) => !a.startsWith('--')) ?? 'cosy-apartment';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const path = slug.endsWith('.json') ? resolve(slug) : resolve(`apps/studio/public/templates/worlds/${slug}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { world?: WorldDoc };
  const world = createWorld((raw.world ?? raw) as WorldDoc) as WorldDoc;
  const gpu = await GpuRoom.open(firefox ? { userAgent: FIREFOX_UA } : {});
  const samples: unknown[] = [];
  const sample = () =>
    gpu.evaluate(() => {
      const a = window.__aether!;
      const r = a.simulation!.renderer as unknown as { renderTier: string; autoTierReason: string | null; performanceLevel: number; gpu: { description: string; tier: string }; stats(): { fps: number } };
      const g = (a.store.getState() as unknown as { gpu?: { render?: { tier: string; reason?: string | null } } }).gpu;
      // The ladder's own view (private fields): its p90 frame rate, the resolution scale it is given, whether frames count.
      const pr = r as unknown as { governor: { fps: number; cautious: boolean }; adaptive: { scale: number; enabled: boolean }; lightVolumeBaking: boolean; qualityHeld: boolean };
      const ladder = { p90: Math.round(pr.governor.fps), cautious: pr.governor.cautious, scale: pr.adaptive.enabled ? Number(pr.adaptive.scale.toFixed(2)) : 0, baking: pr.lightVolumeBaking, held: pr.qualityHeld };
      return { ladder, t: Math.round(performance.now()), tier: r.renderTier, level: r.performanceLevel, reason: r.autoTierReason, fps: Math.round(r.stats().fps), gpu: `${r.gpu.tier}: ${r.gpu.description.slice(0, 60)}`, settings: g?.render ? `${g.render.tier} (${g.render.reason ?? ''})` : null };
    }, null);
  let failed = false;
  try {
    await gpu.evaluate(() => window.__aether!.store.getState().updateSettings({ renderTier: 'auto' }), null);
    await gpu.load(world);
    await gpu.evaluate(async () => { await (window.__aether?.simulation as unknown as { whenFullyLoaded(): Promise<void> }).whenFullyLoaded(); }, null);
    const first = await sample();
    samples.push({ phase: 'loaded', ...first });
    process.stdout.write(`loaded: ${JSON.stringify(first)}\n`);
    // Settings, General tab: the GPU line with the reason.
    await gpu.evaluate(() => (window.__aether!.store.getState() as unknown as { setSettingsOpen?: (v: boolean) => void }).setSettingsOpen?.(true), null);
    await new Promise((r) => setTimeout(r, 800));
    await gpu.evaluate(() => document.querySelector('[aria-label="Graphics quality"]')?.scrollIntoView({ block: 'start' }), null);
    await new Promise((r) => setTimeout(r, 300));
    await gpu.snap(join(out, 'settings-loaded.png'));
    await gpu.evaluate(() => (window.__aether!.store.getState() as unknown as { setSettingsOpen?: (v: boolean) => void }).setSettingsOpen?.(false), null);
    // A slow continuous orbit: frames every animation frame, as while a person walks or turns the view.
    await gpu.evaluate((s) => {
      const r = window.__aether!.simulation!.renderer;
      const t0 = performance.now();
      const step = (): void => {
        const t = (performance.now() - t0) / 1000;
        if (t > s) return;
        const a = t * 0.15;
        r.setCameraPose(Math.sin(a) * 22, 9, Math.cos(a) * 22, a, -0.3);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, seconds);
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await sample();
      samples.push({ phase: 'orbit', ...s });
      process.stdout.write(`  ${Math.round((Date.now() - t0) / 1000)} s: tier ${s.tier}, level ${s.level}, ${s.fps} fps, ${s.reason} ${JSON.stringify(s.ladder)}\n`);
    }
    const last = await sample();
    await gpu.evaluate(() => (window.__aether!.store.getState() as unknown as { setSettingsOpen?: (v: boolean) => void }).setSettingsOpen?.(true), null);
    await new Promise((r) => setTimeout(r, 800));
    await gpu.evaluate(() => document.querySelector('[aria-label="Graphics quality"]')?.scrollIntoView({ block: 'start' }), null);
    await new Promise((r) => setTimeout(r, 300));
    await gpu.snap(join(out, 'settings-after.png'));
    process.stdout.write(`after ${seconds} s of motion: ${JSON.stringify(last)}\n`);
    if (first.gpu.startsWith('discrete') && first.tier === 'low') { failed = true; process.stdout.write('FAILED: a discrete GPU started on low\n'); }
    if (first.gpu.startsWith('discrete') && last.level > 0 && last.fps >= 50) { failed = true; process.stdout.write('FAILED: fast frames but the ladder did not climb back\n'); }
  } finally {
    writeFileSync(join(out, 'log.json'), JSON.stringify({ world: slug, firefox, samples }, null, 1));
    await gpu.close();
  }
  if (failed) process.exitCode = 1;
}

void main();

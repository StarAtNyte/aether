/**
 * Moving-camera noise probe of an editor scene (default: the Scandinavian living room, cutaway walls): lossless PNG frames of a
 * slow orbit and of the held view, for `scripts/shadow-noise-metrics.py` (temporal noise of smooth patches, column periodicity).
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/shadow-noise-probe.ts --out=<dir> [--tier=auto|ultra|...] [--frames=60] [--step=0.4]
 *     [--slug=scandi-living-room] [--hour=10.5] [--bench=<seconds>] [--soft='{...}'] [--level=0..5 (performance ladder level)] [--flags='{"name":value}'] [--size=1600x900] [--wait=1]
 *
 * Writes `<out>/move-NN.png`, `hold-NN.png` and `report.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, HEADLESS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';

const A = process.argv.slice(2);
const arg = (n: string): string | undefined => A.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = resolve(arg('out') ?? 'probe-out/shadow-noise');
const SLUG = arg('slug') ?? 'scandi-living-room';
const TIER = arg('tier') ?? 'auto';
const FRAMES = Number(arg('frames') ?? 60);
const STEP = Number(arg('step') ?? 0.4);
const [W, H] = (arg('size') ?? '1600x900').split('x').map(Number) as [number, number];
const LEVEL = arg('level');
const EDIT = arg('edit');
const SOFT = arg('soft');
const BENCH = Number(arg('bench') ?? 0);
const HOUR = arg('hour');
const FLAGS = arg('flags') ? (JSON.parse(arg('flags')!) as Record<string, unknown>) : {};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer((l) => process.stdout.write(l + '\n'));
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS] });
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await ctx.addInitScript({ content: `try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier='${TIER}'; s.showNavHint=false; s.motion='sharp'; localStorage.setItem(k, JSON.stringify(s)); } catch {}` });
    for (const [k, v] of Object.entries(FLAGS)) await ctx.addInitScript({ content: `globalThis[${JSON.stringify(k)}] = ${JSON.stringify(v)};` });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => process.stdout.write(`pageerror: ${e.message.slice(0, 200)}\n`));
    await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const a = (window as any).__aether; const s = a?.store.getState(); return !!a && a.simulation !== null && s?.loading === null && !s.agentBusy && Object.keys(a.history.current.entities).length > 0; }, null, { timeout: 300_000, polling: 250 });
    await page.evaluate(async () => Promise.race([(window as any).__aether.simulation.whenSynced(), new Promise((r) => setTimeout(r, 60_000))]));
    await page.waitForFunction(() => !/Baking/.test(document.body.innerText) && (window as any).__aether?.simulation?.renderer.animating !== true, null, { timeout: 240_000, polling: 300 }).catch(() => undefined);
    if (HOUR) await page.evaluate((h) => { void (window as any).__aether.studio.commitUser([{ op: 'setEnvironment', set: { timeOfDay: h } }], 'Time of day'); }, Number(HOUR));
    await page.evaluate(() => {
      const a = (window as any).__aether;
      const lids = Object.keys(a.history.current.entities).filter((id: string) => /roof|-ceil$/.test(id));
      if (lids.length) void a.studio.commitUser(lids.map((id: string) => ({ op: 'update', id, set: { visible: false } })), 'Hide the roof');
      a.store.getState().setArch({ walls: 'cutaway' });
      a.store.getState().updateSettings({ showLabels: false, motion: 'sharp' });
    });
    await sleep(3000);
    const cam = async (az: number): Promise<void> => {
      const d = [Math.sin(az) * 1.2, 0.9, -Math.cos(az) * 1.2];
      await page.evaluate(([dd]) => (window as any).__aether.simulation.renderer.frameSphere([2.9, 0.6, 4.9], 3.2, dd, 0), [d] as const);
    };
    const probe = (): Promise<unknown> => page.evaluate(() => { const r = (window as any).__aether.simulation.renderer; return { tier: r.renderTier, choice: r.renderTierChoice, effects: r.activeEffects ?? null, adaptive: r.adaptive?.scale ?? null, level: r.performanceLevel, backend: r.backend }; });
    if (LEVEL) await page.evaluate((lv) => { const r = (window as any).__aether.simulation.renderer; r.governor.level = lv; r.governor.lastMove = performance.now() + 1e9; r.applyPerformance(); }, Number(LEVEL));
    // Soft shadow filter settings for the run (taps, sun angle, minimum penumbra): `{"blockerSamples":3,"filterSamples":6,"sunAngle":0.019,"minPenumbra":0.012}`.
    if (SOFT) await page.evaluate((o) => { const r = (window as any).__aether.simulation.renderer; r.env.softFilter?.set(o); r.requestRender?.(); }, JSON.parse(SOFT));
    const az0 = 0.5;
    await cam(az0);
    await sleep(2500);
    const info = await probe();
    process.stdout.write(`info ${JSON.stringify(info)}\n`);
    if (BENCH > 0) {
      // Frame times of a continuous slow orbit (requestAnimationFrame intervals; the GPU class decides what is measured).
      const dts = (await page.evaluate(async ([seconds, az]) => {
        const r = (window as any).__aether.simulation.renderer;
        const out: number[] = [];
        let last = performance.now();
        const t0 = last;
        let a = az as number;
        await new Promise<void>((done) => {
          const tick = (): void => {
            const now = performance.now();
            out.push(now - last); last = now;
            a += 0.004;
            r.frameSphere([2.9, 0.6, 4.9], 3.2, [Math.sin(a) * 1.2, 0.9, -Math.cos(a) * 1.2], 0);
            if (now - t0 < (seconds as number) * 1000) requestAnimationFrame(tick); else done();
          };
          requestAnimationFrame(tick);
        });
        return out.slice(10);
      }, [BENCH, 0.5] as const)) as number[];
      dts.sort((x, y) => x - y);
      const q = (p: number): number => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))]!;
      process.stdout.write(`bench frames ${dts.length} p50 ${q(0.5).toFixed(2)} ms p95 ${q(0.95).toFixed(2)} ms\n`);
      writeFileSync(join(OUT, 'bench.json'), JSON.stringify({ frames: dts.length, p50: q(0.5), p95: q(0.95) }));
    }
    const clip = await page.evaluate(() => { const c = document.querySelector('.viewport__host canvas')!.getBoundingClientRect(); return { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) }; });
    if (EDIT) {
      // A scene edit (the sofa's colour): frames straight after it, while the baked light settles.
      await page.evaluate(() => { (window as any).__aether.studio.commitUser([{ op: 'update', id: 'home-l0-room-f1', set: { shape: { ...(window as any).__aether.history.current.entities['home-l0-room-f1'].shape, color: '#3d6b4a' } } }], 'Sofa colour'); });
      for (let i = 0; i < 40; i++) { await page.screenshot({ path: join(OUT, `edit-${String(i).padStart(2, '0')}.png`), clip }); await sleep(150); }
    }
    // moving: the camera changes every frame; one shot per step.
    for (let i = 0; i < FRAMES; i++) {
      await cam(az0 + i * (STEP * Math.PI) / 180);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: join(OUT, `move-${String(i).padStart(2, '0')}.png`), clip });
    }
    const moving = await probe();
    // hold: the camera rests, shots one after another.
    await sleep(Number(arg('wait') ?? 1) * 1000);
    for (let i = 0; i < 12; i++) {
      await page.screenshot({ path: join(OUT, `hold-${String(i).padStart(2, '0')}.png`), clip });
      await sleep(120);
    }
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ info, moving, clip, TIER, FLAGS }, null, 1));
    process.stdout.write(`done ${JSON.stringify(moving)}\n`);
  } finally {
    await browser.close();
    await server.stop();
  }
}
main().catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1); });

/**
 * Sun-drag probe: drags the editor's Time of day preview across the day several times (the way the slider does:
 * `studio.previewEnvironment`) and samples the canvas every frame; a frame whose pixels are (nearly) uniform is a blank viewport.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/sun-drag-probe.ts --out=<dir> [--tier=auto] [--slug=scandi-living-room] [--sweeps=4] [--hold=1] [--capture=1]
 *
 * Writes `<out>/report.json` ({ frames, blank: [{ t, hour, sd }] }) and a PNG of each blank frame.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, HEADLESS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';

const A = process.argv.slice(2);
const arg = (n: string): string | undefined => A.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = resolve(arg('out') ?? 'probe-out/sun-drag');
const SLUG = arg('slug') ?? 'scandi-living-room';
const TIER = arg('tier') ?? 'auto';
const SWEEPS = Number(arg('sweeps') ?? 4);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer((l) => process.stdout.write(l + '\n'));
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS] });
  try {
    const ctx = await browser.newContext({ viewport: { width: Number(arg('w') ?? 1600), height: Number(arg('h') ?? 900) }, deviceScaleFactor: Number(arg('dsf') ?? 1) });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await ctx.addInitScript({ content: `try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier='${TIER}'; s.showNavHint=false; localStorage.setItem(k, JSON.stringify(s)); } catch {}` });
    if (arg('capture') === '1') await ctx.addInitScript({ content: 'globalThis.__AETHER_CAPTURE = true;' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => process.stdout.write(`pageerror: ${e.message.slice(0, 200)}\n`));
    page.on('console', (m) => { if (/lost|context|error/i.test(m.text())) process.stdout.write(`console: ${m.text().slice(0, 200)}\n`); });
    await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const a = (window as any).__aether; const s = a?.store.getState(); return !!a && a.simulation !== null && s?.loading === null && !s.agentBusy && Object.keys(a.history.current.entities).length > 0; }, null, { timeout: 300_000, polling: 250 });
    await page.evaluate(async () => Promise.race([(window as any).__aether.simulation.whenSynced(), new Promise((r) => setTimeout(r, 60_000))]));
    await page.waitForFunction(() => !/Baking/.test(document.body.innerText) && (window as any).__aether?.simulation?.renderer.animating !== true, null, { timeout: 240_000, polling: 300 }).catch(() => undefined);
    await sleep(3000);
    // The in-page sampler: each animation frame, draw the viewport canvas to a small 2D canvas and take the luma spread.
    await page.evaluate(() => {
      const w = window as any;
      w.__samples = [];
      const small = document.createElement('canvas');
      small.width = 32; small.height = 18;
      const g = small.getContext('2d', { willReadFrequently: true })!;
      const src = document.querySelector('.viewport__host canvas') as HTMLCanvasElement;
      const tick = (): void => {
        // Sample the canvas through a screen-like readback: only valid straight after a draw, so read in the frame callback.
        try {
          g.drawImage(src, 0, 0, 32, 18);
          const d = g.getImageData(0, 0, 32, 18).data;
          let s = 0, s2 = 0; const n = d.length / 4;
          for (let i = 0; i < d.length; i += 4) { const l = d[i]! * 0.3 + d[i + 1]! * 0.59 + d[i + 2]! * 0.11; s += l; s2 += l * l; }
          const m = s / n;
          w.__samples.push({ t: performance.now(), sd: Math.sqrt(Math.max(0, s2 / n - m * m)), mean: m, hour: w.__hour ?? null });
        } catch { /* tainted or cleared */ }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const clip = await page.evaluate(() => { const c = document.querySelector('.viewport__host canvas')!.getBoundingClientRect(); return { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) }; });
    if (arg('lose') === '1') {
      // A GPU context loss mid-session (what a hung or reset GPU does): how long is the viewport blank, and does it come back?
      const t0 = Date.now();
      await page.evaluate(() => { const c = document.querySelector('.viewport__host canvas') as HTMLCanvasElement; const g = (c.getContext('webgl2') as WebGL2RenderingContext | null); g?.getExtension('WEBGL_lose_context')?.loseContext(); (window as any).__samples.length = 0; });
      await sleep(300);
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        const r = await page.evaluate(() => { const c = document.querySelector('.viewport__host canvas') as HTMLCanvasElement | null; const sm = (window as any).__samples; return { has: !!c, sd: sm.length ? sm[sm.length - 1].sd : null, text: document.body.innerText.slice(0, 0) }; });
        process.stdout.write(`lose +${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(r)}\n`);
        if (r.sd !== null && r.sd > 5) break;
      }
      await page.screenshot({ path: join(OUT, 'after-loss.png') });
      return;
    }
    const hourSeq: number[] = [];
    for (let k = 0; k < SWEEPS; k++) { for (let h = 12; h <= 18; h += 0.25) hourSeq.push(h); for (let h = 18; h <= 22; h += 0.25) hourSeq.push(h); for (let h = 22; h >= 6; h -= 0.5) hourSeq.push(h); for (let h = 6; h <= 12; h += 0.5) hourSeq.push(h); hourSeq.push(-1); }
    let shots = 0;
    for (const h of hourSeq) {
      // -1: the slider is let go (a commit of the last value).
      if (h < 0) { await page.evaluate(() => { const st = (window as any).__aether.studio; st.endEnvironmentPreview(false); st.commitUser([{ op: 'setEnvironment', set: { timeOfDay: 18 } }], 'Time of day'); }); await sleep(1500); continue; }
      await page.evaluate((v) => { (window as any).__hour = v; (window as any).__aether.studio.previewEnvironment({ timeOfDay: v }); }, h);
      await sleep(40);
      const bad = await page.evaluate(() => { const s = (window as any).__samples as Array<{ sd: number }>; const l = s[s.length - 1]; return l ? l.sd < 2 : false; });
      if (bad && shots < 6) { await page.screenshot({ path: join(OUT, `blank-${shots++}-h${h}.png`), clip }); }
    }
    await page.evaluate(() => (window as any).__aether.studio.endEnvironmentPreview(true));
    await sleep(2000);
    const samples = (await page.evaluate(() => (window as any).__samples)) as Array<{ t: number; sd: number; mean: number; hour: number | null }>;
    const blank = samples.filter((s) => s.sd < 2);
    const info = await page.evaluate(() => { const r = (window as any).__aether.simulation.renderer; return { tier: r.renderTier, effects: r.activeEffects ?? null }; });
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ info, frames: samples.length, blankFrames: blank.length, blank: blank.slice(0, 40), minSd: Math.min(...samples.map((s) => s.sd)) }, null, 1));
    process.stdout.write(`frames ${samples.length} blank ${blank.length} minSd ${Math.min(...samples.map((s) => s.sd)).toFixed(1)} ${JSON.stringify(info)}\n`);
  } finally {
    await browser.close();
    await server.stop();
  }
}
main().catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1); });

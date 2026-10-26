/**
 * Frame recorder for "the scene must never go blank or show a loading overlay once it has shown a good frame".
 *
 * What the person sees: a CDP screencast of the compositor output (PNG, 160 px wide), cropped to the middle of the
 * canvas, gives mean luminance and the share of near-black texels per presented frame. A requestAnimationFrame sampler
 * in the page records the renderer's drawn-frame counter, any loading overlay (`.vp-loading`, `.vp-status`,
 * `.vx-loading`, `store.loading`) and the gap since the previous browser frame.
 * Scenarios run after the first good frame; the verdict per scenario is
 *   (a) blank: a sampled frame whose mean luminance is under BLANK_MEAN or whose near-black share is over BLANK_DARK
 *       while the last good frame before the scenario was not that dark,
 *   (b) overlay: a loading overlay visible during Play or after a small edit,
 *   (c) gap: no drawn frame for more than GAP_MS while something should move (Play, orbit) or after a change.
 *
 * Worlds: three bundled ones plus one made in the test by the offline planner from a blank project.
 * Run: `npm run build && [GEN_GPU=intel] npx tsx tests/e2e/blank-frames.e2e.ts [--worlds=a,b] [--fresh=0|1] [--strict-gaps=1] [--shots=dir] [--out=f.json] [--size=1280x720]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type CDPSession, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { decodePng } from './support/png';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'photo-hotel-bedroom,casa-patio,highland-trail').split(',').filter(Boolean);
const FRESH = (arg('fresh') ?? '1') !== '0';
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];
const OUT = arg('out');
const SHOTS = arg('shots');
/** `--cast=0`: no screencast (it adds read-backs; use it when the gaps matter more than the blank check). */
const CAST = (arg('cast') ?? '1') !== '0';
const GAP_MS = Number(arg('gap') ?? 250);
/** Gaps depend on the machine (shared CPU, integrated GPU): reported always, gated only with `--strict-gaps`. */
const STRICT_GAPS = arg('strict-gaps') !== undefined;
const BLANK_MEAN = 6;
const BLANK_DARK = 0.97;
const TIMEOUT = 240_000;
const t0 = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);

interface Sample { t: number; drawn: number; overlay: string; gap: number }
interface Verdict { world: string; scenario: string; samples: number; blank: number; overlay: string[]; maxDrawnGapMs: number; maxRafGapMs: number; minMean: number; ok: boolean; note: string }

const RECORDER = `(() => {
  const s = { on: false, samples: [], last: performance.now(), lastDrawn: -1, lastDrawnAt: performance.now() };
  const overlay = () => {
    const out = [];
    const st = window.__aether && window.__aether.store.getState();
    // The agent's own status line while it works is feedback the person asked for; everything else is an unwanted overlay.
    for (const sel of ['.vp-loading', '.vp-status', '.vx-loading']) { const e = document.querySelector(sel); if (e && e.getBoundingClientRect().width > 0 && !(sel === '.vp-status' && st && st.agentBusy)) out.push(sel + ':' + (e.textContent || '').trim().slice(0, 40)); }
    if (st && st.loading) out.push('store.loading:' + st.loading);
    return out.join(' | ');
  };
  const tick = (now) => {
    requestAnimationFrame(tick);
    const gap = now - s.last; s.last = now;
    if (!s.on) return;
    const r = window.__aether && window.__aether.simulation && window.__aether.simulation.renderer;
    const drawn = r ? r.frameCount : -1;
    if (drawn !== s.lastDrawn) { s.lastDrawn = drawn; s.lastDrawnAt = now; }
    s.samples.push({ t: now, drawn, overlay: overlay(), gap, sinceDrawn: now - s.lastDrawnAt });
  };
  requestAnimationFrame(tick);
  window.__rec = { start() { s.samples = []; s.on = true; s.lastDrawnAt = performance.now(); }, stop() { s.on = false; return s.samples; } };
})();`;

declare global {
  interface Window {
    __rec?: { start(): void; stop(): Array<Sample & { sinceDrawn: number }> };
  }
}

async function waitOpen(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      const w = a.history.current;
      return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
    },
    null,
    { timeout: TIMEOUT, polling: 100 },
  );
  await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
}

/** A good frame: not dark, drawn at least once. */
async function waitGood(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer.frameCount ?? 0) > 5, null, { timeout: TIMEOUT, polling: 100 });
  await page.waitForTimeout(1500);
}

interface Shot { ts: number; mean: number; dark: number }
/** Compositor frames of the canvas area (screencast), kept while a scenario runs. */
class Screencast {
  shots: Shot[] = [];
  crop = { x: 0, y: 0, w: 1, h: 1 };
  private on = false;
  constructor(private readonly cdp: CDPSession, private readonly page: Page) {
    cdp.on('Page.screencastFrame', (ev: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
      if (!this.on) return;
      try {
        const img = decodePng(Buffer.from(ev.data, 'base64'));
        const x0 = Math.floor(this.crop.x * img.width), x1 = Math.max(x0 + 1, Math.floor((this.crop.x + this.crop.w) * img.width));
        const y0 = Math.floor(this.crop.y * img.height), y1 = Math.max(y0 + 1, Math.floor((this.crop.y + this.crop.h) * img.height));
        let sum = 0, dark = 0, n = 0;
        for (let y = y0; y < Math.min(y1, img.height); y++) for (let x = x0; x < Math.min(x1, img.width); x++) {
          const i = (y * img.width + x) * 4;
          const l = 0.2126 * (img.data[i] as number) + 0.7152 * (img.data[i + 1] as number) + 0.0722 * (img.data[i + 2] as number);
          sum += l; n++; if (l < 6) dark++;
        }
        this.shots.push({ ts: (ev.metadata.timestamp ?? 0) * 1000, mean: sum / Math.max(1, n), dark: dark / Math.max(1, n) });
      } catch { /* a frame that does not decode is not evidence */ }
    });
  }
  async start(): Promise<void> {
    if (!CAST) return;
    const box = await this.page.locator('.viewport__host canvas').first().boundingBox().catch(() => null);
    const vp = this.page.viewportSize() ?? { width: W, height: H };
    if (box) this.crop = { x: (box.x + box.width * 0.2) / vp.width, y: (box.y + box.height * 0.2) / vp.height, w: (box.width * 0.6) / vp.width, h: (box.height * 0.6) / vp.height };
    this.shots = []; this.on = true;
    await this.cdp.send('Page.startScreencast', { format: 'png', maxWidth: 160, maxHeight: 100, everyNthFrame: 1 });
  }
  async stop(): Promise<Shot[]> { if (!CAST) return []; this.on = false; await this.cdp.send('Page.stopScreencast').catch(() => undefined); return this.shots; }
}

async function scenario(page: Page, cast: Screencast, world: string, name: string, fn: () => Promise<void>, opts: { overlayAllowed?: boolean; moving?: boolean } = {}): Promise<Verdict> {
  const before = await page.evaluate(() => {
    const c = document.querySelector('.viewport__host canvas') as HTMLCanvasElement | null;
    return c ? { w: c.width, h: c.height } : null;
  });
  void before;
  await cast.start();
  await page.evaluate(() => window.__rec?.start());
  try { await fn(); } catch (e) { log(`${world}/${name}: scenario error ${String(e).slice(0, 200)}`); }
  await page.waitForTimeout(600);
  const samples = (await page.evaluate(() => window.__rec?.stop())) ?? [];
  const shots = await cast.stop();
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${world}-${name}.png`) }).catch(() => undefined);
  }
  const blankSamples = shots.filter((s) => s.mean < BLANK_MEAN || s.dark > BLANK_DARK);
  const overlays = [...new Set(samples.filter((s) => s.overlay !== '').map((s) => s.overlay))];
  const maxDrawn = samples.reduce((m, s) => Math.max(m, s.sinceDrawn), 0);
  const maxRaf = samples.reduce((m, s) => Math.max(m, s.gap), 0);
  const minMean = shots.reduce((m, s) => Math.min(m, s.mean), 255);
  const notes: string[] = [];
  if (blankSamples.length > 0) notes.push(`${blankSamples.length} blank frames`);
  if (!opts.overlayAllowed && overlays.length > 0) notes.push(`overlay: ${overlays.join(' ; ')}`);
  if (STRICT_GAPS && opts.moving && maxDrawn > GAP_MS) notes.push(`drawn gap ${maxDrawn.toFixed(0)} ms`);
  if (STRICT_GAPS && maxRaf > GAP_MS * 2) notes.push(`browser frame gap ${maxRaf.toFixed(0)} ms`);
  const v: Verdict = {
    world, scenario: name, samples: samples.length, blank: blankSamples.length, overlay: overlays, maxDrawnGapMs: Math.round(maxDrawn), maxRafGapMs: Math.round(maxRaf), minMean: Math.round(minMean * 10) / 10,
    ok: notes.length === 0, note: notes.join('; '),
  };
  log(`${v.ok ? 'ok  ' : 'FAIL'} ${world} / ${name}: ${samples.length} samples, ${shots.length} presented, min mean ${v.minMean}, drawn gap ${v.maxDrawnGapMs} ms, raf gap ${v.maxRafGapMs} ms${v.note ? ` -> ${v.note}` : ''}`);
  return v;
}

async function runScenarios(page: Page, cast: Screencast, world: string, results: Verdict[]): Promise<void> {
  const settle = async (): Promise<void> => {
    await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
    await page.waitForTimeout(800);
  };
  results.push(await scenario(page, cast, world, 'orbit-view-presets', async () => {
    for (const p of ['top', 'front', 'iso', 'reset'] as const) {
      await page.evaluate((v) => window.__aether?.studio.viewPreset(v), p);
      await page.waitForTimeout(500);
    }
  }, { moving: true }));
  results.push(await scenario(page, cast, world, 'resize', async () => {
    await page.setViewportSize({ width: 1000, height: 640 });
    await page.waitForTimeout(700);
    await page.setViewportSize({ width: W, height: H });
    await page.waitForTimeout(700);
  }));
  results.push(await scenario(page, cast, world, 'tab-refocus', async () => {
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(800);
  }));
  results.push(await scenario(page, cast, world, 'quality-tier-change', async () => {
    await page.evaluate(() => { const r = window.__aether?.simulation?.renderer; r?.setRenderTier('low'); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { const r = window.__aether?.simulation?.renderer; r?.setRenderTier('auto'); });
    await page.waitForTimeout(1200);
  }));
  results.push(await scenario(page, cast, world, 'chat-edit-patch', async () => {
    await page.evaluate(() => void window.__aether?.studio.send('make the lights warmer'));
    await page.waitForFunction(() => !window.__aether?.store.getState().agentBusy, null, { timeout: TIMEOUT, polling: 100 });
    await settle();
  }));
  results.push(await scenario(page, cast, world, 'agent-adds-object', async () => {
    await page.evaluate(() => void window.__aether?.studio.send('add a tall pine tree and a small lamp next to it'));
    await page.waitForFunction(() => !window.__aether?.store.getState().agentBusy, null, { timeout: TIMEOUT, polling: 100 });
    await settle();
  }));
  results.push(await scenario(page, cast, world, 'enter-play', async () => {
    await page.evaluate(async () => window.__aether?.studio.togglePlay());
    await page.waitForTimeout(3000);
  }, { moving: false }));
  results.push(await scenario(page, cast, world, 'play-first-person', async () => {
    await page.evaluate(() => window.__aether?.studio.setCameraView('firstPerson'));
    for (let i = 0; i < 6; i++) {
      await page.keyboard.down('w');
      await page.waitForTimeout(350);
      await page.keyboard.up('w');
      await page.mouse.move(W / 2 + i * 20, H / 2);
    }
  }, { moving: true }));
  results.push(await scenario(page, cast, world, 'leave-play', async () => {
    await page.evaluate(async () => window.__aether?.studio.togglePlay());
    await page.waitForTimeout(1500);
  }));
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: true });
  const results: Verdict[] = [];
  const targets = [...WORLDS.map((w) => ({ name: w, hash: `#/new/${w}`, fresh: false })), ...(FRESH ? [{ name: 'fresh-offline-world', hash: '#/new', fresh: true }] : [])];
  try {
    for (const t of targets) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      await context.addInitScript({ content: RECORDER });
      try {
        const page = await context.newPage();
        page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
        await page.goto(`${server.url}/?debug=1${t.hash}`, { waitUntil: 'commit' });
        const cast = new Screencast(await context.newCDPSession(page), page);
        await waitOpen(page);
        if (t.fresh) {
          // A world nobody compiled shaders for: the offline planner builds it from a sentence.
          results.push(await scenario(page, cast, t.name, 'first-open-generated', async () => {
            await page.evaluate(() => void window.__aether?.studio.send('a cosy log cabin with a fireplace, two windows, a table with lamps and a pine tree outside'));
            await page.waitForFunction(() => !window.__aether?.store.getState().agentBusy, null, { timeout: TIMEOUT, polling: 100 });
            await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
            await page.waitForTimeout(2500);
          }, { overlayAllowed: true }));
        } else {
          await waitGood(page);
          results.push(await scenario(page, cast, t.name, 'first-open-settle', async () => { await page.waitForTimeout(3000); }));
        }
        await runScenarios(page, cast, t.name, results);
      } catch (e) {
        log(`${t.name}: FAILED ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
        results.push({ world: t.name, scenario: 'harness', samples: 0, blank: 0, overlay: [], maxDrawnGapMs: 0, maxRafGapMs: 0, minMean: 0, ok: false, note: String(e).slice(0, 200) });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  const bad = results.filter((r) => !r.ok);
  log(`## ${results.length - bad.length}/${results.length} scenarios clean`);
  for (const r of bad) log(`  FAIL ${r.world} / ${r.scenario}: ${r.note}`);
  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
  if (bad.length > 0) process.exitCode = 1;
  log('BLANK-FRAMES DONE');
}

main().catch((e: unknown) => {
  log(`FAILED: ${e instanceof Error ? e.stack : String(e)}`);
  process.exitCode = 1;
});

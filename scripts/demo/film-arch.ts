/**
 * The architecture beat rendered frame by frame: a two-storey house in the editor, the wall, storey and section modes driven
 * through the architecture state, every frame drawn by the renderer's exclusive capture session on a fixed clock (the
 * live viewport paints at a few frames a second at this size). A slow orbit runs under every step.
 *
 *   STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-arch.ts --slug=villa-pool --out=<dir> [--w=1920 --h=1080]
 *
 * Writes <out>/f%05d.jpg and <out>/steps.json (the frame each step starts on).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, HEADLESS, SKIP_FIRST_RUN, findChrome, startServer } from '../../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/film6/arch-step'));
const SLUG = arg('slug') ?? 'villa-pool';
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The steps: an architecture-state patch applied at the step's start, and how many frames it runs. */
const STEPS: Array<{ name: string; patch: Record<string, unknown>; frames: number }> = [
  { name: 'exterior', patch: {}, frames: 45 },
  { name: 'cutaway', patch: { walls: 'cutaway' }, frames: 105 },
  { name: 'walls down', patch: { walls: 'down' }, frames: 90 },
  { name: 'walls up', patch: { walls: 'up' }, frames: 40 },
  { name: 'exploded', patch: { levelMode: 'exploded' }, frames: 120 },
  { name: 'one floor', patch: { levelMode: 'solo', level: 0 }, frames: 75 },
  { name: 'upper floor', patch: { level: 1 }, frames: 60 },
];

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(() => undefined);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await ctx.addInitScript({ content: "try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier='ultra'; s.showNavHint=false; s.motion='sharp'; localStorage.setItem(k, JSON.stringify(s)); } catch {}" });
    const page: Page = await ctx.newPage();
    page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
    await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const a = window.__aether; const s = a?.store.getState(); return !!a && a.simulation !== null && s?.loading === null && !s.agentBusy && Object.keys(a.history.current.entities).length > 0; }, null, { timeout: 300_000, polling: 250 });
    await page.evaluate(async () => (window as unknown as { __aether: { simulation: { whenSynced(): Promise<void> } } }).__aether.simulation.whenSynced());
    await page.waitForFunction(() => !/Saving|World-quality pass|Baking/.test(document.body.innerText) && window.__aether?.simulation?.renderer.animating !== true, null, { timeout: 240_000, polling: 400 }).catch(() => undefined);
    await sleep(3000);
    const hour = Number(arg('hour') ?? 17.4);
    const total = await page.evaluate(
      async ({ steps, hour, dist }) => {
        const a = window.__aether!;
        await a.studio.commitUser([{ op: 'setEnvironment', set: { timeOfDay: hour } }], 'Time of day');
        a.store.getState().updateSettings({ showLabels: false, motion: 'sharp' });
        const sim = a.simulation as unknown as { entityBounds(id: string): { min: number[]; max: number[] } | null; whenSynced(): Promise<void>; renderer: unknown };
        await sim.whenSynced();
        let lo = [1e9, 1e9, 1e9];
        let hi = [-1e9, -1e9, -1e9];
        for (const [id, e] of Object.entries(a.history.current.entities) as Array<[string, { arch?: { role?: string } }]>) {
          if (e.arch?.role !== 'wall') continue;
          const b = sim.entityBounds(id);
          if (!b) continue;
          for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, b.min[i]!); hi[i] = Math.max(hi[i]!, b.max[i]!); }
        }
        const c = [0, 1, 2].map((i) => (lo[i]! + hi[i]!) / 2);
        const r = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2;
        const rend = sim.renderer as { setRenderTier(t: string): void; stopTour(): void; preparePost(): Promise<void>; setFixedClock(t: number, dt: number): void; beginCapture(w: number, h: number, o: object): { frame(p: object, o: { dt: number }): Promise<Uint8ClampedArray> } };
        rend.setRenderTier('ultra');
        rend.stopTour();
        await rend.preparePost();
        rend.setFixedClock(0, 0);
        const W = 1920, H = 1080;
        let cap: ReturnType<typeof rend.beginCapture> | null = null;
        for (let tries = 0; !cap && tries < 600; tries++) {
          try { cap = rend.beginCapture(W, H, { vignette: true }); } catch { await new Promise((res) => setTimeout(res, 500)); }
        }
        if (!cap) throw new Error('no capture session');
        const session = cap;
        const cv = new OffscreenCanvas(W, H);
        const ctx2 = cv.getContext('2d')!;
        const img = ctx2.createImageData(W, H);
        const out: string[] = [];
        const marks: Array<{ name: string; frame: number }> = [];
        const n = steps.reduce((s, x) => s + x.frames, 0);
        let k = 0;
        let t = 0;
        const shoot = async (save: boolean): Promise<void> => {
          const u = k / n;
          const az = ((215 + 70 * u) * Math.PI) / 180;
          const el = ((30 + 6 * Math.sin(u * Math.PI)) * Math.PI) / 180;
          const R = r * dist * (1 - 0.08 * Math.sin(u * Math.PI));
          const pos = [c[0]! + R * Math.cos(el) * Math.sin(az), c[1]! + R * Math.sin(el), c[2]! + R * Math.cos(el) * Math.cos(az)];
          rend.setFixedClock(t, 1 / 30);
          const px = await session.frame({ pos, target: c, fov: 40, roll: 0 }, { dt: 1 / 30 });
          t += 1 / 30;
          if (!save) return;
          img.data.set(px);
          ctx2.putImageData(img, 0, 0);
          const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          out.push(btoa(bin));
          k++;
        };
        // Warm up: shaders, post pass and exposure settle before the first saved frame.
        for (let i = 0; i < 24; i++) await shoot(false);
        for (const st of steps) {
          marks.push({ name: st.name, frame: out.length });
          if (Object.keys(st.patch).length) a.store.getState().setArch(st.patch as never);
          await sim.whenSynced();
          for (let f = 0; f < st.frames; f++) await shoot(true);
        }
        (window as unknown as { __frames: string[]; __marks: unknown }).__frames = out;
        (window as unknown as { __marks: unknown }).__marks = marks;
        return out.length;
      },
      { steps: STEPS, hour, dist: Number(arg('dist') ?? 2.6) },
    );
    log(`rendered ${total} frames`);
    writeFileSync(join(OUT, 'steps.json'), JSON.stringify(await page.evaluate(() => (window as unknown as { __marks: unknown }).__marks), null, 1));
    for (let i = 0; i < total; i++) {
      const b64 = await page.evaluate((j) => (window as unknown as { __frames: string[] }).__frames[j]!, i);
      writeFileSync(join(OUT, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(b64, 'base64'));
    }
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
  }
}

main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${String(e).slice(0, 800)}\n`);
  process.exit(1);
});

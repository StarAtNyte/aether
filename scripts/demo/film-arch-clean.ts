/**
 * The architecture beat, clean: a two-storey house in the editor, the wall, storey and section modes driven through the
 * architecture state, every frame one moment of the world (N sub-pixel-jittered draws averaged, no temporal blending, TAA off,
 * AO on, exposure locked, clear weather, no fog, golden hour), raw pixels piped into ffmpeg. The app's own animated transitions
 * (the storeys' explode) advance on the fixed 1/30 s step; wall modes snap in the app and are kept as clean snaps.
 *
 *   scripts/demo/film-arch-clean.sh --out=<dir> --name=arch-cutaway [--slug=villa-pool] [--size=1920x1080] [--sub=8]
 *     [--hour=17] [--dist=2.4] [--elev=30] [--az=215] [--arc=75] [--browser=chrome|headless] [--gpu=intel]
 *
 * Writes <out>/<name>.mkv (lossless master) and <name>.steps.json (the frame each step starts on).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { SKIP_FIRST_RUN, startServer } from '../../tests/e2e/support/env';
import { launchFootageBrowser } from './footage-browser';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const num = (n: string, d: number): number => (arg(n) !== undefined ? Number(arg(n)) : d);
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/film8/master'));
const NAME = arg('name') ?? 'arch-cutaway';
const SLUG = arg('slug') ?? 'villa-pool';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];
const FPS = 30;
const SUB = num('sub', 8);
const QUICK = num('quick', 1);
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The steps: an architecture-state patch applied at the step's start, and how many frames it runs (30 fps). */
const STEPS: Array<{ name: string; patch: Record<string, unknown>; frames: number }> = [
  { name: 'exterior', patch: {}, frames: 60 },
  { name: 'cutaway', patch: { walls: 'cutaway' }, frames: 90 },
  { name: 'walls down', patch: { walls: 'down' }, frames: 60 },
  { name: 'exploded', patch: { walls: 'up', levelMode: 'exploded' }, frames: 90 },
  { name: 'one floor', patch: { levelMode: 'solo', level: 0 }, frames: 60 },
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(() => undefined);
  const browser = await launchFootageBrowser({ browser: arg('browser') ?? 'chrome', gpu: arg('gpu') ?? 'intel', size: [1280, 720] });
  const file = join(OUT, `${NAME}.mkv`);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-an', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgr0', '-g', '1', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise<void>((res, rej) => ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`)))));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await ctx.addInitScript({ content: `globalThis.__AETHER_CAPTURE = { on: true, lodBoost: 2, mirrorScale: 1, shadowMapCap: ${num('shadowcap', 4096)}, lockEye: true };` });
    await ctx.addInitScript({ content: "try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier='ultra'; s.showNavHint=false; s.motion='sharp'; localStorage.setItem(k, JSON.stringify(s)); } catch {}" });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.text().startsWith('arch:')) log(m.text()); });
    page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
    await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const a = window.__aether; const s = a?.store.getState(); return !!a && a.simulation !== null && s?.loading === null && !s.agentBusy && Object.keys(a.history.current.entities).length > 3; }, null, { timeout: 300_000, polling: 500 });
    await page.evaluate(async () => (window as unknown as { __aether: { simulation: { whenSynced(): Promise<void> } } }).__aether.simulation.whenSynced());
    await page.waitForFunction(() => !/Saving|World-quality pass|Baking/.test(document.body.innerText) && window.__aether?.simulation?.renderer.animating !== true, null, { timeout: 240_000, polling: 500 });
    await sleep(3000);
    let n = 0;
    await page.exposeFunction('__sink', async (b64: string) => {
      const buf = Buffer.from(b64, 'base64');
      if (!ff.stdin.write(buf)) await new Promise<void>((r) => ff.stdin.once('drain', () => r()));
      n++;
      if (n % 10 === 0) log(`frame ${n}`);
    });
    const marks = await page.evaluate(
      async ({ steps, hour, dist, elev0, az0, arc, W, H, sub }) => {
        const a = window.__aether!;
        await a.studio.commitUser([{ op: 'setEnvironment', set: { timeOfDay: hour, fog: null, weather: 'clear', sky: 'day' } }], 'Golden hour, clear');
        a.store.getState().updateSettings({ showLabels: false, motion: 'sharp' });
        const sim = a.simulation as unknown as { entityBounds(id: string): { min: number[]; max: number[] } | null; whenSynced(): Promise<void>; renderer: unknown };
        await sim.whenSynced();
        const lo = [1e9, 1e9, 1e9];
        const hi = [-1e9, -1e9, -1e9];
        for (const [id, e] of Object.entries(a.history.current.entities) as Array<[string, { arch?: { role?: string } }]>) {
          if (e.arch?.role !== 'wall') continue;
          const b = sim.entityBounds(id);
          if (!b) continue;
          for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, b.min[i]!); hi[i] = Math.max(hi[i]!, b.max[i]!); }
        }
        const c = [0, 1, 2].map((i) => (lo[i]! + hi[i]!) / 2);
        const r = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2;
        const rend = sim.renderer as {
          setRenderTier(t: string): void; stopTour(): void; preparePost(): Promise<void>; setFixedClock(t: number, dt: number): void; setEffects(e: object): void;
          beginCapture(w: number, h: number, o: object): { frame(p: object, o: object): Promise<Uint8Array>; end(): void };
        };
        rend.setRenderTier('ultra');
        rend.stopTour();
        rend.setEffects({ taa: false });
        await rend.preparePost();
        rend.setFixedClock(0, 0);
        let session: ReturnType<typeof rend.beginCapture> | null = null;
        for (let tries = 0; !session && tries < 600; tries++) {
          try { session = rend.beginCapture(W, H, { vignette: true }); } catch { await new Promise((res) => setTimeout(res, 500)); }
        }
        if (!session) throw new Error('no capture session');
        await rend.preparePost();
        const cap = session;
        const sink = (window as unknown as { __sink(b: string): Promise<void> }).__sink;
        const jit = (i: number): [number, number] => [((0.7548776662 * (i + 1)) % 1) - 0.5, ((0.5698402909 * (i + 1)) % 1) - 0.5];
        const total = steps.reduce((s, x) => s + x.frames, 0);
        let k = 0;
        let t = 0;
        const shoot = async (save: boolean): Promise<void> => {
          const u = k / total;
          const e = u * u * (3 - 2 * u);
          const az = ((az0 + arc * e) * Math.PI) / 180;
          const el = ((elev0 + 4 * Math.sin(u * Math.PI)) * Math.PI) / 180;
          const R = r * dist * (1 - 0.08 * Math.sin(u * Math.PI));
          const pos = [c[0]! + R * Math.cos(el) * Math.sin(az), c[1]! + R * Math.sin(el), c[2]! + R * Math.cos(el) * Math.cos(az)];
          const pose = { pos, target: c, fov: 38, roll: 0 };
          rend.setFixedClock(t, 1 / 30);
          const n = save ? sub : 1;
          const acc = save ? new Uint32Array(W * H * 4) : null;
          for (let s = 0; s < n; s++) {
            // The world (the storeys' animated explode) steps by the frame's time once, with the first draw.
            const px = await cap.frame(pose, { dt: s === 0 ? 1 / 30 : 0, jitter: jit(k * 11 + s) });
            if (acc) for (let i = 0; i < acc.length; i++) acc[i]! += px[i]!;
          }
          t += 1 / 30;
          if (!acc) return;
          const out = new Uint8Array(W * H * 4);
          for (let i = 0; i < out.length; i++) out[i] = i % 4 === 3 ? 255 : Math.round(acc[i]! / n);
          const url = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(new Blob([out])); });
          await sink(url.slice(url.indexOf(',') + 1));
          k++;
        };
        const marks: Array<{ name: string; frame: number }> = [];
        for (let i = 0; i < 6; i++) await shoot(false);
        let frame = 0;
        for (const st of steps) {
          marks.push({ name: st.name, frame });
          if (Object.keys(st.patch).length) a.store.getState().setArch(st.patch as never);
          await sim.whenSynced();
          for (let f = 0; f < st.frames; f++) { await shoot(true); frame++; }
          console.log(`arch: step ${st.name} done at frame ${frame}`);
        }
        cap.end();
        rend.setEffects({});
        return marks;
      },
      { steps: STEPS.map((x) => ({ ...x, frames: Math.max(2, Math.round(x.frames / QUICK)) })), hour: num('hour', 17), dist: num('dist', 2.4), elev0: num('elev', 30), az0: num('az', 215), arc: num('arc', 75), W, H, sub: SUB },
    );
    ff.stdin.end();
    await ffDone;
    writeFileSync(join(OUT, `${NAME}.steps.json`), JSON.stringify({ marks, fps: FPS, size: [W, H], sub: SUB }, null, 1));
    log(`${file}: ${n} frames`);
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
  }
}

main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${String(e).slice(0, 800)}\n`);
  process.exit(1);
});

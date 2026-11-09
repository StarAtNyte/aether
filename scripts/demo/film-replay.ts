/**
 * Build replay for the product film, clean version. A real build by the offline planner (no model call) is replayed in
 * the editor entry by entry (back to the empty world, forward a few patches at a time) and every frame is one moment of
 * the world drawn by the renderer's exclusive capture session on a fixed clock: an average of N sub-pixel-jittered draws
 * of THAT moment only, never a blend of different moments (no temporal anti-aliasing history, no frame blending).
 * Raw pixels go straight into ffmpeg (lossless master), so nothing is squeezed through an encoder or a JPEG.
 *
 *   scripts/demo/film-replay.sh --patches=<patches.json> --out=<dir> --name=villa \
 *     [--core=wall,roof,room] [--size=1920x1080] [--fps=30] [--sub=8] [--hold=14] [--steps=14] [--hour=17.2] \
 *     [--elev=26] [--dist=1.7] [--arc=50] [--az=200] [--fov=40] [--browser=chrome|headless] [--gpu=intel|nvidia-webgpu]
 *
 * `patches.json` is what `film-build.ts --probe=1 --prompt=...` writes (the planner's commits). The camera orbits the
 * building (the entities carrying the `--core` tags) slowly and closely; the hour and the haze are the only changes made
 * to the planner's own environment patch (golden hour, thinner haze); the exposure is locked for the whole replay.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { SKIP_FIRST_RUN, startServer } from '../../tests/e2e/support/env';
import { launchFootageBrowser } from './footage-browser';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const num = (n: string, d: number): number => (arg(n) !== undefined ? Number(arg(n)) : d);
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/film8/master'));
const NAME = arg('name') ?? 'replay';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];
const FPS = num('fps', 30);
const SUB = num('sub', 8);
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function editorReady(page: Page): Promise<void> {
  await page.waitForFunction(() => { const a = window.__aether; const s = a?.store.getState(); return !!a && a.simulation !== null && s?.loading === null && !s.agentBusy; }, null, { timeout: 240_000, polling: 500 });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const commits = JSON.parse(readFileSync(resolve(arg('patches')!), 'utf8')) as Array<{ m: string; patches: unknown[] }>;
  const all = commits.flatMap((c) => c.patches);
  for (const p of all as Array<{ op?: string; set?: { timeOfDay?: number; fog?: { density: number } | null } }>) {
    if (p.op === 'setEnvironment' && p.set) {
      p.set.timeOfDay = num('hour', 17.2);
      if (p.set.fog) p.set.fog = { ...p.set.fog, density: p.set.fog.density * 0.4 };
    }
  }
  // The land first (right after the root entity it hangs under): the replay reads as land, then the building, then the garden.
  const isLand = (p: unknown): boolean => { const e = p as { op?: string; entity?: { tags?: string[]; shape?: { generator?: string } } }; return e.op === 'add' && ((e.entity?.tags ?? []).includes('terrain') || e.entity?.shape?.generator === 'terrain'); };
  const li = all.findIndex(isLand);
  const first = all.findIndex((p) => (p as { op?: string }).op === 'add');
  if (li > first + 1) all.splice(first + 1, 0, ...all.splice(li, 1));
  const steps = num('steps', 14);
  const per = Math.max(1, Math.ceil(all.length / steps));
  const hold = num('hold', 14);
  const server = await startServer(() => undefined);
  const browser = await launchFootageBrowser({ browser: arg('browser') ?? 'chrome', gpu: arg('gpu') ?? 'intel', size: [1280, 720] });
  const file = join(OUT, `${NAME}.mkv`);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-an', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgr0', '-g', '1', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise<void>((res, rej) => ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`)))));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await ctx.addInitScript({ content: `globalThis.__AETHER_CAPTURE = { on: true, lodBoost: ${num('lod', 2)}, mirrorScale: ${num('mirror', 1)}, shadowMapCap: ${num('shadowcap', 4096)}, lockEye: true };` });
    await ctx.addInitScript({ content: "try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier='ultra'; s.showNavHint=false; s.motion='sharp'; localStorage.setItem(k, JSON.stringify(s)); } catch {}" });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.text().startsWith('replay:')) log(m.text()); });
    page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
    await page.goto(`${server.url}/?debug=1#/new/${arg('base') ?? 'scandi-living-room'}`, { waitUntil: 'domcontentloaded' });
    await editorReady(page);
    await sleep(3000);
    await page.evaluate(async (all) => { const a = window.__aether!; a.history.commit(all, 'replay all', 'agent'); await Promise.race([(a.simulation as unknown as { whenSynced(): Promise<void> }).whenSynced(), new Promise((r) => setTimeout(r, 40_000))]); }, all);
    await sleep(5000);
    const tags = (arg('core') ?? 'wall,roof,room,house,stall,plaza,well').split(',');
    const info = await page.evaluate((tags) => {
      const a = window.__aether!;
      const sim = a.simulation as unknown as { entityBounds(id: string): { min: number[]; max: number[] } | null };
      const lo = [1e9, 1e9, 1e9];
      const hi = [-1e9, -1e9, -1e9];
      let n = 0;
      for (const [id, e] of Object.entries(a.history.current.entities) as Array<[string, { tags?: string[] }]>) {
        if (!(e.tags ?? []).some((t) => tags.includes(t))) continue;
        const b = sim.entityBounds(id);
        if (!b || Math.hypot(b.max[0]! - b.min[0]!, b.max[2]! - b.min[2]!) > 70) continue;
        n++;
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, b.min[i]!); hi[i] = Math.max(hi[i]!, b.max[i]!); }
      }
      return { n, c: [0, 1, 2].map((i) => (lo[i]! + hi[i]!) / 2), r: Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2 };
    }, tags);
    log(`${all.length} patches, ${steps} steps; core ${JSON.stringify(info)}`);
    await page.evaluate(() => { const a = window.__aether!; a.history.checkout(a.history.entries()[0]!.id); });
    await sleep(1500);
    let n = 0;
    await page.exposeFunction('__sink', async (b64: string) => {
      const buf = Buffer.from(b64, 'base64');
      if (!ff.stdin.write(buf)) await new Promise<void>((r) => ff.stdin.once('drain', () => r()));
      n++;
      if (n % 5 === 0) log(`frame ${n}`);
    });
    const marks = await page.evaluate(async ({ all, per, hold, c, r, W, H, sub, taaOff, noJitter, az0, arc, elev0, dm, fov }) => {
      const a = window.__aether!;
      const sim = a.simulation as unknown as { renderer: unknown; whenSynced(): Promise<void> };
      const rend = sim.renderer as {
        setRenderTier(t: string): void; stopTour(): void; preparePost(): Promise<void>; setFixedClock(t: number, dt: number): void; setEffects(e: object): void;
        beginCapture(w: number, h: number, o: object): { frame(p: object, o: object): Promise<Uint8Array>; end(): void };
      };
      rend.setRenderTier('ultra');
      rend.stopTour();
      if (taaOff) rend.setEffects({ taa: false });
      await rend.preparePost();
      rend.setFixedClock(0, 0);
      let session: ReturnType<typeof rend.beginCapture> | null = null;
      for (let tries = 0; !session && tries < 600; tries++) {
        try { session = rend.beginCapture(W, H, { vignette: true }); } catch { await new Promise((r) => setTimeout(r, 500)); }
      }
      if (!session) throw new Error('no capture session');
      await rend.preparePost();
      const cap = session;
      const total = (Math.ceil(all.length / per) + 3) * hold;
      let t = 0;
      let k = 0;
      const sink = (window as unknown as { __sink(b: string): Promise<void> }).__sink;
      const jit = (i: number): [number, number] => [((0.7548776662 * (i + 1)) % 1) - 0.5, ((0.5698402909 * (i + 1)) % 1) - 0.5];
      /** One moment of the world: the camera at `u` of the orbit, `sub` jittered draws of it averaged. */
      const shoot = async (u: number, save: boolean): Promise<void> => {
        const e = u * u * (3 - 2 * u);
        const az = ((az0 + arc * e) * Math.PI) / 180;
        const el = ((elev0 - 5 * e) * Math.PI) / 180;
        const dist = r * dm * (1.12 - 0.22 * e);
        const pos = [c[0]! + dist * Math.cos(el) * Math.sin(az), c[1]! + dist * Math.sin(el), c[2]! + dist * Math.cos(el) * Math.cos(az)];
        const pose = { pos, target: [c[0]!, c[1]! - 0.1 * r, c[2]!], fov, roll: 0 };
        rend.setFixedClock(t, 1 / 30);
        const n = save ? sub : 1;
        const acc = save ? new Uint32Array(W * H * 4) : null;
        const tShoot = performance.now();
        for (let s = 0; s < n; s++) {
          // The world steps by the frame's time once (with the first draw); the other draws are the same moment.
          const t1 = performance.now();
          const px = await cap.frame(pose, { dt: s === 0 ? 1 / 30 : 0, ...(noJitter ? {} : { jitter: jit(k * 11 + s) }) });
          const t2 = performance.now();
          if (acc) for (let i = 0; i < acc.length; i++) acc[i]! += px[i]!;
          if (k % 3 === 0) console.log(`replay: draw ${s} ${Math.round(t2 - t1)} ms, accumulate ${Math.round(performance.now() - t2)} ms`);
        }
        const drawMs = Math.round(performance.now() - tShoot);
        t += 1 / 30;
        if (!acc) { if (k % 4 === 0) console.log(`replay: warm draw ${drawMs} ms`); return; }
        if (k % 3 === 0) console.log(`replay: frame ${k} ${n} draws ${drawMs} ms`);
        const out = new Uint8Array(W * H * 4);
        for (let i = 0; i < out.length; i++) out[i] = i % 4 === 3 ? 255 : Math.round(acc[i]! / n);
        const url = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(new Blob([out])); });
        await sink(url.slice(url.indexOf(',') + 1));
      };
      const marks: Array<{ frame: number; step: number }> = [];
      let frame = 0;
      a.history.commit(all.slice(0, 3), 'replay start', 'agent');
      await Promise.race([sim.whenSynced(), new Promise((r) => setTimeout(r, 25_000))]);
      for (let f = 0; f < 8; f++) await shoot(0, false);
      for (let f = 0; f < hold; f++) { await shoot(k++ / total, true); frame++; }
      for (let i = 3; i < all.length; i += per) {
        const ts = performance.now();
        a.history.commit(all.slice(i, i + per), `replay ${i}`, 'agent');
        await Promise.race([sim.whenSynced(), new Promise((r) => setTimeout(r, 25_000))]);
        console.log(`replay: step ${i} synced in ${Math.round(performance.now() - ts)} ms`);
        (rend as unknown as { grow?: { finishAll(): void } }).grow?.finishAll();
        for (let f = 0; f < 8; f++) await shoot(k / total, false);
        marks.push({ frame, step: i });
        for (let f = 0; f < hold; f++) { await shoot(k++ / total, true); frame++; }
      }
      for (let f = 0; f < hold * 2; f++) { await shoot(Math.min(1, k++ / total), true); frame++; }
      session.end();
      rend.setEffects({});
      return marks;
    }, { all, per, hold, c: info.c, r: info.r, W, H, sub: SUB, taaOff: arg('taa') !== '1', noJitter: arg('jitter') === '0', az0: num('az', 200), arc: num('arc', 50), elev0: num('elev', 26), dm: num('dist', 1.7), fov: num('fov', 40) });
    ff.stdin.end();
    await ffDone;
    writeFileSync(join(OUT, `${NAME}.steps.json`), JSON.stringify({ messages: commits.map((c) => c.m), marks, fps: FPS, size: [W, H], sub: SUB }, null, 1));
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

/**
 * The clean footage pipeline: world shots rendered frame by frame in the real player (the published, cooked world,
 * the offline fixed-timestep path of `film-export.ts`) and piped as raw pixels into ffmpeg, never through the in-page
 * encoder. Each output frame can be the average of N sub-frames (sub-pixel jitter and a 180 degree shutter) and the
 * camera path is smoothed and eased. See docs/demo/FOOTAGE-PIPELINE.md.
 *
 *   STATIC_DIR=apps/studio/dist GEN_GPU=intel npx tsx scripts/demo/render-clean.ts --clip=lisbon-drone \
 *     [--mode=clean|legacy] [--size=1920x1080] [--fps=30] [--sub=8] [--shutter=0.5] [--settle=1] [--warmup=24] \
 *     [--trim=0.5] [--from=<frame>] [--to=<frame>] [--browser=chrome|headless] [--gpu=intel|nvidia|nvidia-vulkan|nvidia-webgpu] [--out=<dir>] [--spec=scripts/demo/film/clean-clips.json]
 *
 * `--mode=legacy` reproduces the old capture (one draw per frame, no capture flags); `clean` (default) turns the capture
 * flags on (`__AETHER_CAPTURE`) and uses the sub-frame settings. The output is a lossless master `<out>/<clip>.mkv`
 * (FFV1) and `<clip>.frames.json` (per-frame diagnostics: tier, ladder level, adaptive scale, sun-map draws, eye EV,
 * frame time); `finish-footage.sh` and `footage-metrics.py` take it from there.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page } from 'playwright';
import { startServer } from '../../tests/e2e/support/env';
import { launchFootageBrowser } from './footage-browser';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const num = (n: string, d: number): number => (arg(n) !== undefined ? Number(arg(n)) : d);
const MODE = (arg('mode') ?? 'clean') as 'clean' | 'legacy';
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/film8/master'));
const SPEC = resolve(arg('spec') ?? 'scripts/demo/film/clean-clips.json');
const SCOUTS = resolve(arg('scouts') ?? join(homedir(), '.local/share/aether/demo/film/shots'));
const CLIPS = (arg('clip') ?? '').split(',').filter(Boolean);
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];
const FPS = num('fps', 30);
const SUB = num('sub', MODE === 'clean' ? 8 : 1);
const SHUTTER = num('shutter', 0);
const SETTLE = num('settle', 1);
const WARMUP = num('warmup', MODE === 'clean' ? 24 : 0);
const TRIM = num('trim', 0);
/** Clean mode: temporal anti-aliasing off (no history carried across moments; the sub-frame jitter does the anti-aliasing); `--taa=1` keeps it. */
const EFFECTS = arg('effects') ? (JSON.parse(arg('effects')!) as Record<string, boolean>) : MODE === 'clean' && arg('taa') !== '1' ? { taa: false } : undefined;
/** `--globals='{"__AETHER_LOD_BIAS":false}'`: page globals set before the engine loads (engine experiments). */
const GLOBALS = arg('globals') ? (JSON.parse(arg('globals')!) as Record<string, unknown>) : {};
/** `--matrix=file.json`: one still of frame `--from` per config (`{ name, effects?, sub?, size?, settle? }`), PNGs in `--out`. */
const MATRIX = arg('matrix') ? (JSON.parse(readFileSync(resolve(arg('matrix')!), 'utf8')) as Array<{ name: string; effects?: Record<string, boolean>; sub?: number; size?: [number, number]; settle?: number; flags?: Record<string, unknown>; grade?: Record<string, number> }>) : null;
/** `--bloom-scale=0.55`: every shot's grade bloom times this (a softer glow reads sharper; measured 4.9 to 4.3 on the Lisbon frame at 0.9 to 0.4). */
const BLOOM_SCALE = num('bloom-scale', MODE === 'clean' ? 0.55 : 1);
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}\n`);

type Vec3 = [number, number, number];
interface Entry {
  slug: string;
  settle?: number;
  /** Capture flags for this clip (merged over the mode's defaults). */
  flags?: Record<string, unknown>;
  shots: Array<Record<string, unknown>>;
  /** Render the world's own film (its story, as the player's Render video does) instead of `shots`. */
  own?: boolean;
  /** Smooth the single shot's `tour` window into one camera path instead of six via poses. */
  smooth?: { sigma?: number; ease?: number };
  /** A camera path file (`{ keys: [{ t, pos, target, fov }] }`, as intro-shots.ts writes): one shot over its length, smoothed. */
  pathFile?: string;
  /** Seconds of the path file to use (default all of it). */
  window?: [number, number];
}

/** A scouted tour window as dense keys (seconds from the window's start). */
function tourKeys(slug: string, w: [number, number]): Array<{ t: number; pos: Vec3; target: Vec3; fov: number }> {
  const scout = JSON.parse(readFileSync(join(SCOUTS, `${slug}-scout.json`), 'utf8')) as { samples: Array<{ t: number; pos: Vec3; target: Vec3; fov: number }> };
  const win = scout.samples.filter((x) => x.t >= w[0] && x.t <= w[1]);
  if (win.length < 2) throw new Error(`${slug}: no scout samples in ${w.join('..')}`);
  return win.map((x) => ({ t: x.t - w[0], pos: x.pos, target: x.target, fov: x.fov }));
}

/** The story the player's film runner takes (the schema's defaults filled), plus the camera path of a smoothed tour shot. */
function build(e: Entry): { story: Record<string, unknown> | null; path?: { keys: unknown[]; sigma?: number; ease?: number } } {
  let path: { keys: unknown[]; sigma?: number; ease?: number } | undefined;
  if (e.own) return { story: null };
  if (e.pathFile) {
    const all = (JSON.parse(readFileSync(resolve(e.pathFile.replace(/^~/, homedir())), 'utf8')) as { keys: Array<{ t: number; pos: Vec3; target: Vec3; fov: number }> }).keys;
    const w = e.window ?? [all[0]!.t, all[all.length - 1]!.t];
    const keys = all.filter((k) => k.t >= w[0] && k.t <= w[1]).map((k) => ({ ...k, t: k.t - w[0] }));
    path = { keys, ...(MODE === 'clean' ? (e.smooth ?? {}) : { sigma: 0.001, ease: 0 }) };
    const k0 = keys[0]!;
    e = { ...e, shots: [{ duration: w[1] - w[0], camera: { position: k0.pos, target: k0.target, fov: k0.fov }, ease: 'linear', ...(e.shots[0] ?? {}) }] };
  }
  const shots = e.shots.map((s) => {
    const w = s['tour'] as [number, number] | undefined;
    if (!w) return s;
    const keys = tourKeys(e.slug, w);
    const cam = (x: { pos: Vec3; target: Vec3; fov: number }): object => ({ position: x.pos, target: x.target, fov: x.fov });
    const { tour: _t, ...rest } = s;
    if (e.smooth && e.shots.length === 1 && MODE === 'clean') path = { keys, ...e.smooth };
    const via = [1, 2, 3, 4, 5, 6].map((i) => keys[Math.round((i * (keys.length - 1)) / 7)]!).map(cam);
    return { duration: w[1] - w[0], camera: cam(keys[0]!), cameraTo: cam(keys[keys.length - 1]!), via, ease: 'linear', ...rest };
  });
  const story = {
    letterbox: 0,
    shots: shots.map((s) => ({ ease: 'inOut', shake: 0, transition: 'cut', transitionSeconds: 0, moves: [], music: 'none', ambience: { wind: 0, waves: 0, cicadas: 0, gulls: 0, town: 0 }, ...s })).map((s) => { const g = (s as { grade?: { bloom?: number } }).grade; return g && typeof g.bloom === 'number' ? { ...s, grade: { ...g, bloom: g.bloom * BLOOM_SCALE } } : s; }),
  };
  return { story, ...(path ? { path } : {}) };
}

async function open(browser: Browser, url: string, slug: string, flags: Record<string, unknown>): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  await page.addInitScript({ content: "try { localStorage.setItem('aether.player.mute', '1'); } catch {}" });
  await page.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  if (MODE === 'clean') await page.addInitScript({ content: `globalThis.__AETHER_CAPTURE = ${JSON.stringify({ on: true, lodBoost: 4, mirrorScale: 1, shadowMapCap: 4096, ...flags })};` });
  for (const [k, v] of Object.entries(GLOBALS)) await page.addInitScript({ content: `globalThis[${JSON.stringify(k)}] = ${JSON.stringify(v)};` });
  page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('crash', () => log('page crashed'));
  page.on('console', (m) => {
    const t = m.text();
    if (/quality|tier|ladder|capture/i.test(t) && t.length < 300) log(`console: ${t}`);
  });
  await page.goto(`${url}/play.html#t=${slug}&cook=use&tier=ultra`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 500 });
  await page.waitForFunction(() => !!(window as unknown as { __aetherPlayer?: { simulation: unknown } }).__aetherPlayer?.simulation, null, { timeout: 120_000, polling: 250 });
  return page;
}

async function runMatrix(page: Page, story: Record<string, unknown> | null, path: unknown, e: Entry): Promise<void> {
  let cur: ReturnType<typeof spawn> | null = null;
  await page.exposeFunction('__sink', async (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    if (cur && !cur.stdin!.write(buf)) await new Promise<void>((r) => cur!.stdin!.once('drain', () => r()));
  });
  const f = num('from', 60);
  for (const cfg of MATRIX!) {
    const [w, h] = cfg.size ?? [W, H];
    const file = join(OUT, `${cfg.name}.png`);
    cur = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-', '-frames:v', '1', file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise<void>((res) => cur!.on('exit', () => res()));
    const t = Date.now();
    await page.evaluate(
      async ({ story, path, o }) => {
        const p = (window as unknown as { __aetherPlayer: { world: object; framesModule(): Promise<{ renderStoryFrames(r: unknown, w: object, o: object): Promise<unknown> }>; simulation: { renderer: unknown } } }).__aetherPlayer;
        const m = await p.framesModule();
        await m.renderStoryFrames(p.simulation.renderer, { ...p.world, ...(story ? { story } : {}) }, {
          ...o,
          ...(path ? { path } : {}),
          onFrame: async (_i: number, rgba: Uint8Array) => {
            const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(new Blob([rgba as unknown as BlobPart])); });
            await (window as unknown as { __sink(b: string): Promise<void> }).__sink(url.slice(url.indexOf(',') + 1));
          },
        });
      },
      { story: story && cfg.grade ? { ...story, shots: (story['shots'] as Array<{ grade?: object }>).map((s) => ({ ...s, grade: { ...(s.grade ?? {}), ...cfg.grade } })) } : story, path: path ?? null, o: { fps: FPS, width: w, height: h, tier: 'ultra', subframes: cfg.sub ?? 1, shutter: 0, settle: cfg.settle ?? e.settle ?? SETTLE, warmup: WARMUP || 24, from: f, to: f + 1, ...(cfg.effects ? { effects: cfg.effects } : {}) } },
    );
    cur.stdin!.end();
    await done;
    log(`${cfg.name}: ${file} in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }
}

async function renderClip(browser: Browser, url: string, name: string, e: Entry): Promise<void> {
  const flags = { ...(e.flags ?? {}) };
  const page = await open(browser, url, e.slug, flags);
  await page.waitForTimeout(8000);
  log(`gpu: ${JSON.stringify(await page.evaluate(() => { const r = (window as unknown as { __aetherPlayer: { simulation: { renderer: { gpu?: { description?: string; tier?: string }; backend?: string } } } }).__aetherPlayer.simulation.renderer; const c = document.createElement('canvas').getContext('webgl2'); const d = c?.getExtension('WEBGL_debug_renderer_info'); return { backend: r.backend, description: r.gpu?.description, tier: r.gpu?.tier, webgl: c && d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : null }; }))}`);
  const { story, path } = build(e);
  if (MATRIX) {
    await runMatrix(page, story, path, e);
    await page.close();
    return;
  }
  const frameLog: unknown[] = [];
  const file = join(OUT, `${name}.mkv`);
  const total = story ? (story['shots'] as Array<{ duration: number }>).reduce((a, s) => a + s.duration, 0) : 0;
  const trim = Math.round(TRIM * FPS);
  const from = arg('from') !== undefined ? num('from', 0) : trim;
  const to = arg('to') !== undefined ? num('to', 0) : story ? Math.round(total * FPS) - trim : undefined;
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-an', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgr0', '-g', '1', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise<void>((res, rej) => {
    ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`))));
  });
  let n = 0;
  await page.exposeFunction('__sink', async (b64: string, info: unknown) => {
    const buf = Buffer.from(b64, 'base64');
    if (!ff.stdin.write(buf)) await new Promise<void>((r) => ff.stdin.once('drain', () => r()));
    frameLog.push(info);
    n++;
    if (n % 15 === 0) log(`${name}: frame ${n} (${(info as { ms: number }).ms.toFixed(0)} ms, tier ${(info as { tier: string }).tier}, ladder ${(info as { ladder: number }).ladder})`);
  });
  log(`${name}: ${MODE} ${W}x${H} ${FPS} fps, sub ${SUB}, shutter ${SHUTTER}, frames ${from}..${to}${path ? ', smoothed path' : ''}`);
  const t1 = Date.now();
  await page.evaluate(
    async ({ story, path, o }) => {
      const p = (window as unknown as { __aetherPlayer: { world: object; framesModule(): Promise<{ renderStoryFrames(r: unknown, w: object, o: object): Promise<unknown> }>; simulation: { renderer: unknown } } }).__aetherPlayer;
      const m = await p.framesModule();
      await m.renderStoryFrames(p.simulation.renderer, { ...p.world, ...(story ? { story } : {}) }, {
        ...o,
        ...(path ? { path } : {}),
        onFrame: async (_i: number, rgba: Uint8Array, info: object) => {
          const blob = new Blob([rgba as unknown as BlobPart]);
          const url = await new Promise<string>((res) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.readAsDataURL(blob);
          });
          await (window as unknown as { __sink(b: string, i: object): Promise<void> }).__sink(url.slice(url.indexOf(',') + 1), info);
        },
      });
    },
    { story, path: path ?? null, o: { fps: FPS, width: W, height: H, tier: 'ultra', subframes: SUB, shutter: SHUTTER, settle: e.settle ?? SETTLE, warmup: WARMUP, from, to, ...(EFFECTS ? { effects: EFFECTS } : {}) } },
  );
  ff.stdin.end();
  await ffDone;
  writeFileSync(join(OUT, `${name}.frames.json`), JSON.stringify({ name, mode: MODE, size: [W, H], fps: FPS, sub: SUB, shutter: SHUTTER, from, to, frames: frameLog }));
  log(`${name}: ${file} ${n} frames in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
  await page.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const all = JSON.parse(readFileSync(SPEC, 'utf8')) as Record<string, Entry>;
  const server = await startServer(() => undefined);
  const browser = await launchFootageBrowser({ browser: arg('browser') ?? 'chrome', gpu: arg('gpu') ?? 'intel', size: [1280, 720] });
  try {
    for (const name of CLIPS.length ? CLIPS : Object.keys(all).filter((k) => !k.startsWith('_'))) {
      const e = all[name];
      if (!e) throw new Error(`no clip ${name} in ${SPEC}`);
      try {
        await renderClip(browser, server.url, name, e);
      } catch (err) {
        log(`${name}: FAILED ${String(err).slice(0, 500)}`);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
  }
}

main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${String(e).slice(0, 600)}\n`);
  process.exit(1);
});

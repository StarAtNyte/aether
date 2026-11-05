/**
 * Intro-video shots: one bundled world per run, rendered frame by frame through the studio's own video export (the
 * Publish > Video path: an exclusive capture session, every frame rendered at its exact time, so no dropped frames and no
 * stutter at any frame rate), along a camera move built from the world's opening view or from its live drone tour.
 *
 *   npm run build
 *   GEN_GPU=nvidia npx tsx scripts/demo/intro-shots.ts --world=sanctuary-terraces --move=arc [--seconds=7] [--fps=60]
 *     [--arc=18] [--dolly=0.85] [--rise=0] [--pose=x,y,z,yaw,pitch] [--out=<dir>] [--name=<file stem>]
 *   GEN_GPU=nvidia npx tsx scripts/demo/intro-shots.ts --world=sanctuary-terraces --move=scout [--scout=90]
 *     samples the live drone tour (one pose every 100 ms, a screenshot every 3 s) into <out>/<world>-scout.json
 *   GEN_GPU=nvidia npx tsx scripts/demo/intro-shots.ts --world=sanctuary-terraces --move=drone --from=4 --to=14 [--stretch=1.4]
 *     renders that window of the sampled drone tour, slowed by `stretch`
 *
 * Moves:
 *   arc    from the opening (or `--pose`) camera: orbit `arc` degrees round the look-at point, ease in and out, while
 *          the distance scales by `dolly` and the eye rises by `rise` metres
 *   drone  a window of the scouted drone tour
 * `--drop=<m>` lowers every look-at point (tilts the camera down, e.g. to keep the sky's edge out of a high shot).
 *
 * The page waits for the load gate's `aether:fully-loaded` mark and a few seconds of refinement before any frame.
 * The result is `<out>/<name>.mp4` (or .webm when the browser has no H.264 encoder), 1920x1080 by default.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, HEADLESS, SKIP_FIRST_RUN, findChrome, startServer } from '../../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const num = (n: string, d: number): number => (arg(n) !== undefined ? Number(arg(n)) : d);
const SLUG = arg('world') ?? 'sanctuary-terraces';
const MOVE = arg('move') ?? 'arc';
const SECONDS = num('seconds', 7);
const FPS = num('fps', 60);
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/intro/shots'));
const NAME = arg('name') ?? `${SLUG}-${MOVE}`;
const TIER = arg('tier') ?? 'ultra';
const POSE = arg('pose')?.split(',').map(Number);
const log = (s: string): void => void process.stdout.write(`${s}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Vec3 = [number, number, number];
interface Key { t: number; pos: Vec3; target: Vec3; fov: number; ease: 'linear' | 'ease' }

/** Orbit round the look-at point with a dolly and a rise; keys every 0.5 s (the path spline is Catmull-Rom). */
function arcPath(cam: { pos: Vec3; target: Vec3; fov: number }): Key[] {
  const deg = num('arc', 16);
  const dolly = num('dolly', 0.88);
  const rise = num('rise', 0);
  const lift = num('lift', 0);
  const c = cam.target;
  const dx = cam.pos[0] - c[0];
  const dz = cam.pos[2] - c[2];
  const r0 = Math.hypot(dx, dz);
  const a0 = Math.atan2(dx, dz);
  const keys: Key[] = [];
  const n = Math.max(2, Math.round(SECONDS * 2));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = a0 + ((deg * Math.PI) / 180) * u;
    const r = r0 * (1 + (dolly - 1) * u);
    const y = c[1] + (cam.pos[1] - c[1]) * (1 + (dolly - 1) * u) + rise * u;
    keys.push({ t: u * SECONDS, pos: [c[0] + Math.sin(a) * r, y, c[2] + Math.cos(a) * r], target: [c[0], c[1] + lift * u, c[2]], fov: cam.fov, ease: 'linear' });
  }
  return keys;
}

/** A window of the scouted drone tour, slowed by `stretch`, at most 60 keys. */
function dronePath(): Key[] {
  const scout = JSON.parse(readFileSync(join(OUT, `${SLUG}-scout.json`), 'utf8')) as { samples: Array<{ t: number; pos: Vec3; target: Vec3; fov: number }> };
  const from = num('from', 0);
  const to = num('to', from + SECONDS);
  const stretch = num('stretch', 1);
  const win = scout.samples.filter((s) => s.t >= from && s.t <= to);
  const step = Math.max(1, Math.ceil(win.length / 60));
  const picked = win.filter((_, i) => i % step === 0 || i === win.length - 1);
  return picked.map((s) => ({ t: (s.t - from) * stretch, pos: s.pos, target: s.target, fov: s.fov, ease: 'linear' }));
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
  log(`loading ${SLUG}…`);
  await page.waitForFunction(() => performance.getEntriesByName('aether:fully-loaded').length + performance.getEntriesByName('aether:load-timeout').length > 0, null, { timeout: 300_000, polling: 1000 });
  const timedOut = await page.evaluate(() => performance.getEntriesByName('aether:load-timeout').length > 0);
  if (timedOut) log('WARNING: load gate timed out (aether:load-timeout)');
  await page.getByRole('button', { name: /back to editor/i }).click({ timeout: 3000 }).catch(() => undefined);
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.setPanel('left', false);
    st?.setPanel('right', false);
  });
  await page.addStyleTag({ content: '.viewport > *:not(.viewport__host) { visibility: hidden !important; }' });
  if (POSE && POSE.length === 5) {
    await page.evaluate((p) => (window.__aether?.simulation?.renderer as unknown as { setCameraPose(...a: number[]): void }).setCameraPose(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!), POSE);
  }
  await sleep(8000);
}

async function scout(page: Page): Promise<void> {
  const seconds = num('scout', 90);
  const shots = join(OUT, `${SLUG}-scout`);
  mkdirSync(shots, { recursive: true });
  await page.evaluate(() => {
    const g = window as unknown as { __scout: Array<{ t: number; pos: number[]; target: number[]; fov: number }>; __aether: { simulation: { renderer: { startTour(): boolean; cameraPose(): { pos: number[]; target: number[]; fov: number } } } } };
    g.__scout = [];
    const r = g.__aether.simulation.renderer;
    if (!r.startTour()) throw new Error('nothing to tour');
    const t0 = performance.now();
    const tick = (): void => {
      const p = r.cameraPose();
      g.__scout.push({ t: (performance.now() - t0) / 1000, pos: [...p.pos], target: [...p.target], fov: p.fov });
      if (performance.now() - t0 < 600_000) setTimeout(tick, 100);
    };
    tick();
  });
  for (let s = 0; s < seconds; s += 3) {
    await page.screenshot({ path: join(shots, `t${String(s).padStart(3, '0')}.jpg`), quality: 70, type: 'jpeg' });
    await sleep(3000);
  }
  const samples = await page.evaluate(() => (window as unknown as { __scout: unknown[] }).__scout);
  writeFileSync(join(OUT, `${SLUG}-scout.json`), JSON.stringify({ world: SLUG, samples }));
  log(`scouted ${samples.length} poses; screenshots in ${shots}`);
}

async function render(page: Page): Promise<void> {
  const cam = await page.evaluate(() => (window.__aether?.simulation?.renderer as unknown as { cameraPose(): { pos: Vec3; target: Vec3; fov: number } }).cameraPose());
  log(`opening camera ${JSON.stringify(cam)}`);
  const drop = num('drop', 0);
  const keys = (MOVE === 'drone' ? dronePath() : arcPath(cam)).map((k) => ({ ...k, target: [k.target[0], k.target[1] - drop, k.target[2]] as Vec3 }));
  const duration = keys[keys.length - 1]!.t;
  const path = { v: 1, name: NAME, duration, keys, easeInOut: true };
  writeFileSync(join(OUT, `${NAME}.path.json`), JSON.stringify(path, null, 1));
  log(`rendering ${duration.toFixed(2)} s at ${W}x${H} ${FPS} fps (${keys.length} keys)…`);
  const t0 = Date.now();
  await page.evaluate(
    async ({ path, fps }) => {
      const studio = (window as unknown as { __aether: { studio: { publish: { state: { setState(p: object): void; getState(): { video: object } }; exportVideo(): Promise<void> } } } }).__aether.studio;
      const pub = studio.publish;
      pub.state.setState({
        path,
        video: { ...pub.state.getState().video, preset: '1080p', fps, format: 'mp4', quality: 2, music: null, titles: { title: '', subtitle: '', endText: '', letterbox: false, fades: false } },
      });
      await pub.exportVideo();
    },
    { path, fps: FPS },
  );
  const res = await page.evaluate(() => {
    const s = (window as unknown as { __aether: { studio: { publish: { state: { getState(): { result: { url: string; fileName: string; size: number; detail: string } | null; job: { error: string | null } | null } } } } } }).__aether.studio.publish.state.getState();
    return { result: s.result, error: s.job?.error ?? null };
  });
  if (!res.result) throw new Error(`export failed: ${res.error}`);
  log(`exported in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${res.result.detail}`);
  const parts: Buffer[] = [];
  const CHUNK = 4 * 1024 * 1024;
  for (let at = 0; at < res.result.size; at += CHUNK) {
    const b64 = await page.evaluate(
      async ({ url, at, n }) => {
        const blob = await (await fetch(url)).blob();
        const buf = new Uint8Array(await blob.slice(at, at + n).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { url: res.result.url, at, n: CHUNK },
    );
    parts.push(Buffer.from(b64, 'base64'));
  }
  const ext = res.result.fileName.endsWith('.webm') ? 'webm' : 'mp4';
  const file = join(OUT, `${NAME}.${ext}`);
  writeFileSync(file, Buffer.concat(parts));
  log(`wrote ${file}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(() => undefined);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS] });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await context.addInitScript({ content: `try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier=${JSON.stringify(TIER)}; s.showNavHint=false; localStorage.setItem(k, JSON.stringify(s)); } catch {}` });
    const page = await context.newPage();
    page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
    await open(page, server.url);
    const gpu = await page.evaluate(() => (window.__aether?.simulation?.renderer as unknown as { gpu?: { tier?: string; backend?: string } }).gpu ?? null);
    log(`gpu ${JSON.stringify(gpu)}`);
    if (MOVE === 'scout') await scout(page);
    else await render(page);
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(String(e).slice(0, 600));
  process.exit(1);
});

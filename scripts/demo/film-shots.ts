/**
 * World shots for the product film, rendered frame by frame in the real player from the published (cooked) world: a shot
 * list is handed to the player's own "Render video" path (`film-export.ts`: a fixed film clock, the renderer's exclusive
 * capture at 1920x1080 on the top tier with the live post layer), so every frame is exact and nothing is screen-captured.
 *
 *   STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-shots.ts --only=cold,casa [--fps=30] [--out=<dir>]
 *   STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-shots.ts --scout=lisbon-hills [--seconds=60]
 *
 * Shot lists live in `scripts/demo/film/shots.json`: `{ "<name>": { "slug": "...", "shots": [StoryShot, ...] } }`, each
 * shot in the world's story format (camera / cameraTo / via, hour, grade, ease). No bars, titles or captions are drawn:
 * typography is laid on in the edit (`film-cut.ts`). The film's own sound is rendered but the edit uses its own score.
 *
 * `--scout` opens a world, writes its opening camera and a drone-tour sample every 100 ms to `<out>/<slug>-scout.json`
 * and a screenshot every 3 s, to choose poses from.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, HEADLESS, findChrome, startServer } from '../../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/film/shots'));
const FPS = Number(arg('fps') ?? 30);
const SHOTS = resolve(arg('shots') ?? 'scripts/demo/film/shots.json');
const ONLY = arg('only')?.split(',').filter(Boolean);
const SCOUT = arg('scout');
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}\n`);

type Vec3 = [number, number, number];
interface Entry {
  slug: string;
  fps?: number;
  /** Wait this long after the world is up before the first frame (streaming, foliage, eye adaptation). */
  settle?: number;
  shots: Array<Record<string, unknown>>;
  own?: boolean;
}

/**
 * A shot may name a window of the scouted drone tour instead of poses: `"tour": [from, to]` (seconds of the scout);
 * its camera, cameraTo and up to six via poses come from the samples, `duration` defaults to the window's length.
 */
function fromTour(slug: string, s: Record<string, unknown>): Record<string, unknown> {
  const w = s['tour'] as [number, number] | undefined;
  if (!w) return s;
  const scout = JSON.parse(readFileSync(join(OUT, `${slug}-scout.json`), 'utf8')) as { samples: Array<{ t: number; pos: Vec3; target: Vec3; fov: number }> };
  const win = scout.samples.filter((x) => x.t >= w[0] && x.t <= w[1]);
  if (win.length < 2) throw new Error(`${slug}: no scout samples in ${w.join('..')}`);
  const cam = (x: { pos: Vec3; target: Vec3; fov: number }): object => ({ position: x.pos, target: x.target, fov: x.fov });
  const via = [1, 2, 3, 4, 5, 6].map((i) => win[Math.round((i * (win.length - 1)) / 7)]!).map(cam);
  const { tour: _t, ...rest } = s;
  return { duration: w[1] - w[0], camera: cam(win[0]!), cameraTo: cam(win[win.length - 1]!), via, ease: 'linear', ...rest };
}

/** The schema's defaults, filled here (the player's runner takes a parsed story). */
function story(e: Entry): Record<string, unknown> {
  return {
    letterbox: 0,
    shots: e.shots.map((x) => fromTour(e.slug, x)).map((s) => ({ ease: 'inOut', shake: 0, transition: 'cut', transitionSeconds: 0, moves: [], music: 'none', ambience: { wind: 0, waves: 0, cicadas: 0, gulls: 0, town: 0 }, ...s })),
  };
}

async function open(browser: Browser, url: string, slug: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  await page.addInitScript({ content: "try { localStorage.setItem('aether.player.mute', '1'); } catch {}" });
  await page.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('crash', () => log('page crashed'));
  await page.goto(`${url}/play.html#t=${slug}&cook=use&tier=ultra`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 500 });
  const cook = await page.evaluate(() => (window as unknown as { __aetherCook: { path: string; reason: string | null; startMode: string | null } }).__aetherCook);
  log(`${slug}: ${JSON.stringify(cook)}`);
  await page.waitForFunction(() => !!(window as unknown as { __aetherPlayer?: { simulation: unknown } }).__aetherPlayer?.simulation, null, { timeout: 120_000, polling: 250 });
  return page;
}

async function scout(browser: Browser, url: string, slug: string): Promise<void> {
  const page = await open(browser, url, slug);
  await page.waitForTimeout(6000);
  const dir = join(OUT, `${slug}-scout`);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'open.jpg'), quality: 80, type: 'jpeg' });
  const info = await page.evaluate(() => {
    const p = (window as unknown as { __aetherPlayer: { world: { entities: Record<string, { name?: string; kind?: string; transform: { position: number[] } }>; environment?: unknown }; simulation: { renderer: { cameraPose(): unknown } } } }).__aetherPlayer;
    const ents = Object.entries(p.world.entities);
    const xs = ents.map(([, e]) => e.transform.position);
    const lo = [0, 1, 2].map((i) => Math.min(...xs.map((v) => v[i] ?? 0)));
    const hi = [0, 1, 2].map((i) => Math.max(...xs.map((v) => v[i] ?? 0)));
    return { camera: p.simulation.renderer.cameraPose(), entities: ents.length, bounds: [lo, hi], names: ents.slice(0, 400).map(([id, e]) => [id, e.name ?? '', e.transform.position.map((v) => Math.round(v * 10) / 10)]) };
  });
  const seconds = Number(arg('seconds') ?? 45);
  await page.evaluate(() => {
    const g = window as unknown as { __scout: unknown[]; __aetherPlayer: { simulation: { renderer: { startTour(): boolean; cameraPose(): { pos: number[]; target: number[]; fov: number } } } } };
    g.__scout = [];
    const r = g.__aetherPlayer.simulation.renderer;
    r.startTour();
    const t0 = performance.now();
    const tick = (): void => {
      const c = r.cameraPose();
      g.__scout.push({ t: Math.round(performance.now() - t0) / 1000, pos: c.pos.map((v) => Math.round(v * 100) / 100), target: c.target.map((v) => Math.round(v * 100) / 100), fov: c.fov });
      if (performance.now() - t0 < 300_000) setTimeout(tick, 100);
    };
    tick();
  });
  for (let s = 0; s < seconds; s += 3) {
    await page.screenshot({ path: join(dir, `t${String(s).padStart(3, '0')}.jpg`), quality: 70, type: 'jpeg' });
    await page.waitForTimeout(3000);
  }
  const samples = await page.evaluate(() => (window as unknown as { __scout: unknown[] }).__scout);
  writeFileSync(join(OUT, `${slug}-scout.json`), JSON.stringify({ slug, ...info, samples }));
  log(`scout: ${join(OUT, `${slug}-scout.json`)} (${(samples as unknown[]).length} poses)`);
  await page.close();
}

async function render(browser: Browser, url: string, name: string, e: Entry): Promise<void> {
  const page = await open(browser, url, e.slug);
  await page.waitForTimeout((e.settle ?? 8) * 1000);
  const fps = e.fps ?? FPS;
  // `"own": true` renders the world's own film (its story, sound and all), as the player's Render video does.
  const s = e.own ? null : story(e);
  const t1 = Date.now();
  const done = page.waitForEvent('download', { timeout: 6 * 3600_000 });
  const ticker = setInterval(() => void page.evaluate(() => (window as unknown as { __filmProgress?: unknown }).__filmProgress).then((p) => log(`${name}: ${JSON.stringify(p)}`)).catch(() => undefined), 60_000);
  await page.evaluate(
    async ({ s, fps, name }) => {
      const p = (window as unknown as { __aetherPlayer: { world: object; filmModule(): Promise<{ exportStoryFilm(r: unknown, w: object, o: object): Promise<{ blob: Blob; ext: string; frames: number; ms: number; codec: string }> }>; simulation: { renderer: unknown } } }).__aetherPlayer;
      const film = await p.filmModule();
      const r = await film.exportStoryFilm(p.simulation.renderer, { ...p.world, story: s ?? (p.world as { story?: unknown }).story }, { fps, tier: 'ultra', volume: s ? 0 : 1, music: s ? 0 : 1, format: 'mp4', onProgress: (x: unknown) => ((window as unknown as { __filmProgress: unknown }).__filmProgress = x) });
      (window as unknown as { __filmDone: unknown }).__filmDone = { frames: r.frames, ms: r.ms, codec: r.codec };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.blob);
      a.download = `${name}.${r.ext}`;
      document.body.appendChild(a);
      a.click();
    },
    { s, fps, name },
  );
  const d = await done.finally(() => clearInterval(ticker));
  const file = join(OUT, d.suggestedFilename());
  await d.saveAs(file);
  const info = await page.evaluate(() => (window as unknown as { __filmDone: unknown }).__filmDone);
  log(`${name}: ${file} ${JSON.stringify(info)} in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
  await page.close();
}

/**
 * The film's score: the player's procedural score engine (`story-audio.ts`) rendered offline through the same path as a
 * film's sound, from a cue sheet `[[seconds, cue], ...]` (cues: intro, run, tension, hush, hope, climax, coda, none),
 * with every ambience bed silent. Written as a 48 kHz 16-bit WAV.
 */
async function score(browser: Browser, url: string, file: string): Promise<void> {
  const sheet = JSON.parse(readFileSync(file, 'utf8')) as { slug: string; seconds: number; cues: Array<[number, string]>; name: string };
  const page = await open(browser, url, sheet.slug);
  const shots: Array<Record<string, unknown>> = [];
  const cues = [...sheet.cues, [sheet.seconds, 'none'] as [number, string]];
  for (let i = 0; i + 1 < cues.length; i++) {
    let left = cues[i + 1]![0] - cues[i]![0];
    let first = true;
    while (left > 0.01) {
      const d = Math.min(30, left);
      shots.push({ duration: d, camera: { position: [0, 10, 10], target: [0, 0, 0] }, ...(first ? { music: cues[i]![1] } : {}) });
      first = false;
      left -= d;
    }
  }
  const s = { letterbox: 0, shots: shots.map((x) => ({ ease: 'inOut', shake: 0, transition: 'cut', transitionSeconds: 0, moves: [], ambience: { wind: 0, waves: 0, cicadas: 0, gulls: 0, town: 0 }, ...x })) };
  const done = page.waitForEvent('download', { timeout: 3600_000 });
  await page.evaluate(
    async ({ s, seconds, name }) => {
      const p = (window as unknown as { __aetherPlayer: { world: object; filmModule(): Promise<{ renderFilmAudio(w: object, s: object, sec: number, o: object): Promise<AudioBuffer | null> }> } }).__aetherPlayer;
      const film = await p.filmModule();
      const buf = await film.renderFilmAudio(p.world, s, seconds, { step: 1 / 30, volume: 1, music: 1 });
      if (!buf) throw new Error('no offline audio');
      const n = buf.length;
      const view = new DataView(new ArrayBuffer(44 + n * 4));
      const w4 = (o: number, t: string): void => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
      w4(0, 'RIFF'); view.setUint32(4, 36 + n * 4, true); w4(8, 'WAVE'); w4(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
      view.setUint32(24, buf.sampleRate, true); view.setUint32(28, buf.sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); w4(36, 'data'); view.setUint32(40, n * 4, true);
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      for (let i = 0; i < n; i++) {
        view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i]!)) * 32767, true);
        view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i]!)) * 32767, true);
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
      a.download = `${name}.wav`;
      document.body.appendChild(a);
      a.click();
    },
    { s, seconds: sheet.seconds, name: sheet.name },
  );
  const d = await done;
  const out = join(OUT, d.suggestedFilename());
  await d.saveAs(out);
  log(`score: ${out}`);
  await page.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(() => undefined);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS] });
  try {
    if (arg('score')) {
      await score(browser, server.url, resolve(arg('score')!));
      return;
    }
    if (SCOUT) {
      for (const slug of SCOUT.split(',')) await scout(browser, server.url, slug);
      return;
    }
    const all = JSON.parse(readFileSync(SHOTS, 'utf8')) as Record<string, Entry>;
    for (const [name, e] of Object.entries(all)) {
      if (name.startsWith('_') || (ONLY && !ONLY.includes(name))) continue;
      try {
        await render(browser, server.url, name, e);
      } catch (err) {
        log(`${name}: FAILED ${String(err).slice(0, 400)}`);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
  }
}

void (null as unknown as Vec3);
main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${String(e).slice(0, 600)}\n`);
  process.exit(1);
});

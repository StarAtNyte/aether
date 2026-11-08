/**
 * Render video of a world's short film (`world.story`) in the real player, and checks of the file:
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/story-video.ts --out=<dir> [--slug=cloudwatch-harbour] [--fps=30|60]
 *       [--cook=use|0|local] [--at=9,24,41] [--live-tier=ultra] [--skip-render=<file>]
 *
 * 1. Opens the film (start card: Watch without sound), presses Render video, picks the frame rate and Render, and saves
 *    the download (`<out>/<file>`); the render's report (`window.__aetherFilm`).
 * 2. A/V sync: the file's sound decoded in the page against the film's sound rendered again offline (it is deterministic,
 *    and aligned with the picture by construction: frame i and sample i·rate/fps are the same film time); the lag of the
 *    best cross-correlation is the container's A/V offset. `ffprobe` (inspection only) gives the streams' start, rate and
 *    duration.
 * 3. Frames: the live film in a fresh page (1080p, `--live-tier`, default automatic) plays once from its start and is held at each `--at`
 *    film time: the viewport is shot (`live-*`) and the renderer's own capture of the same moment taken (`capture-*`, the
 *    path the export draws through); the file's frame at that time is decoded in the page (`film-*`). Pixel diffs (mean
 *    absolute error 0..255, PSNR), with the file's frame 3 s later as a control.
 * Writes `report.json`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(arg('out') ?? 'probe-out/story-video');
const slug = arg('slug') ?? 'cloudwatch-harbour';
const fps = Number(arg('fps') ?? 30);
const cook = arg('cook') ?? 'use';
const ats = (arg('at') ?? '9,24,41,63,88').split(',').map(Number);
const skip = arg('skip-render');
const W = 1920;
const H = 1080;
mkdirSync(join(out, 'frames'), { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);
const report: Record<string, unknown> = { slug, fps, cook };

async function open(browser: Browser, tier: string | null = 'ultra'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: W, height: H }, acceptDownloads: true });
  if (process.env['GEN_GPU'] === 'intel') await page.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
  await page.addInitScript({ content: "try { localStorage.setItem('aether.player.mute', '1'); } catch {}" });
  page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 300)}`));
  page.on('crash', () => log('page crashed'));
  page.on('console', (m) => {
    if (m.type() === 'error') log(`console: ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${server.url}/play.html#t=${slug}&cook=${cook}${tier ? `&tier=${tier}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 200_000, polling: 250 });
  await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'story', null, { timeout: 60_000, polling: 250 });
  const gate = await page.evaluate(() => (window as unknown as { __aetherPlayer?: { storyGate?: boolean } }).__aetherPlayer?.storyGate ?? false);
  if (gate) await page.click('[data-testid="pl-story-watch-muted"]');
  await page.waitForFunction(() => !!(window as unknown as { __aetherPlayer?: { story: unknown } }).__aetherPlayer?.story, null, { timeout: 60_000 });
  return page;
}

const staticDir = process.env['STATIC_DIR'] ?? resolve('apps/studio/dist');
const server = await env.startServer(() => undefined);
const browser = await chromium.launch({ executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS });
try {
  // 1. The render, through the player's own button.
  const page = await open(browser);
  report['load'] = await page.evaluate(() => (window as unknown as { __aetherCook?: { path: string; reason: string | null } }).__aetherCook);
  report['webcodecs'] = await page.evaluate(() => ({ video: typeof VideoEncoder !== 'undefined', audio: typeof AudioEncoder !== 'undefined' }));
  let file: string;
  if (skip) {
    file = resolve(skip);
  } else {
    await page.waitForTimeout(2500);
    await page.click('[data-testid="pl-story-render"]');
    await page.click(`[data-testid="pl-film-fps-${fps}"]`);
    const download = page.waitForEvent('download', { timeout: 4 * 3600_000 });
    await page.click('[data-testid="pl-film-start"]');
    const ticker = setInterval(() => {
      void page
        .evaluate(() => (window as unknown as { __aetherPlayer?: { film: { progress: unknown; error: string | null } | null } }).__aetherPlayer?.film ?? null)
        .then((f) => log(`film: ${JSON.stringify(f)}`))
        .catch(() => undefined);
    }, 30_000);
    const d = await download.finally(() => clearInterval(ticker));
    file = join(out, d.suggestedFilename());
    await d.saveAs(file);
    report['render'] = await page.evaluate(() => (window as unknown as { __aetherFilm?: unknown }).__aetherFilm ?? null);
    log(`saved ${file}: ${JSON.stringify(report['render'])}`);
  }
  report['file'] = file;

  // 2. ffprobe (inspection only) and the A/V offset.
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,start_time,duration,nb_frames,sample_rate,channels:format=duration,format_name,bit_rate', '-of', 'json', file]).toString()) as { streams: Array<Record<string, unknown>>; format: Record<string, unknown> };
  const frames = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'json', file]).toString()) as { streams: Array<{ nb_read_packets?: string }> };
  report['ffprobe'] = { ...probe, videoPackets: Number(frames.streams[0]?.nb_read_packets ?? 0) };
  log(`ffprobe: ${JSON.stringify(report['ffprobe'])}`);
  const bytes = readFileSync(file);
  // The checks run in a fresh page (the render's page holds its GPU state and the file).
  await page.close();
  // The live film on the tier `--live-tier` (default: automatic, as a visitor sees it).
  const liveTier = arg('live-tier') ?? null;
  report['liveTier'] = liveTier ?? 'auto';
  const live = await open(browser, liveTier);
  await live.addStyleTag({ content: '.pl-story__controls { display: none !important; }' });
  // The file in the page: copied beside the build the server serves (a Playwright route cannot carry 100 MB).
  const route = `/__film/${basename(file)}`;
  mkdirSync(join(staticDir, '__film'), { recursive: true });
  writeFileSync(join(staticDir, '__film', basename(file)), bytes);
  // In steps (a failure names its step): the file's sound decoded, then the reference rendered again offline.
  log('A/V: decoding the file\'s sound');
  log(`decoded: ${await live.evaluate(`(async () => { const buf = await (await fetch(${JSON.stringify(route)})).arrayBuffer(); const ac = new OfflineAudioContext(2, 48000, 48000); window.__got = await ac.decodeAudioData(buf); return window.__got.duration; })()`)}`);
  log(`reference: ${await live.evaluate(`(async () => { const p = window.__aetherPlayer; const film = await p.filmModule(); const s = film.storyFilmSeconds(p.world.story); window.__ref = await film.renderFilmAudio(p.world, p.world.story, Math.round(s * ${fps}) / ${fps}, { step: 1 / ${fps} }); return window.__ref.duration; })()`)}`);
  const sync = (await live.evaluate(
    `(async () => {
      const p = window.__aetherPlayer;
      const film = await p.filmModule();
      const story = p.world.story;
      const got = window.__got;
      const ref = window.__ref;
      const a = ref.getChannelData(0), b = got.getChannelData(0);
      // Determinism: the sound rendered twice is the same.
      const ref2 = await film.renderFilmAudio(p.world, story, ref.duration, { step: 1 / ${fps} });
      let same = 0; const c2 = ref2.getChannelData(0);
      for (let i = 0; i < a.length; i++) same = Math.max(same, Math.abs(a[i] - c2[i]));
      // Envelope at 1 ms, cross-correlated over +-200 ms on the whole film.
      const env = (x, sr) => { const n = Math.floor(x.length / (sr / 1000)); const o = new Float32Array(n); const k = sr / 1000; for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < k; j++) s += Math.abs(x[i * k + j]); o[i] = s / k; } return o; };
      const ea = env(a, ref.sampleRate), eb = env(b, got.sampleRate);
      const mean = (e) => e.reduce((s, v) => s + v, 0) / e.length;
      const ma = mean(ea), mb = mean(eb);
      let best = -Infinity, lag = 0;
      for (let L = -200; L <= 200; L++) {
        let s = 0, na = 0, nb = 0;
        for (let i = 300; i < ea.length - 300; i++) { const j = i + L; if (j < 0 || j >= eb.length) continue; const u = ea[i] - ma, v = eb[j] - mb; s += u * v; na += u * u; nb += v * v; }
        const r = s / Math.sqrt(na * nb);
        if (r > best) { best = r; lag = L; }
      }
      // Sample-exact lag around the envelope's best (+-2 ms).
      let bestS = -Infinity, lagS = 0;
      const sr = ref.sampleRate, mid = Math.floor(a.length / 2), span = sr * 4;
      for (let L = (lag - 2) * sr / 1000; L <= (lag + 2) * sr / 1000; L++) {
        let s = 0, na = 0, nb = 0;
        for (let i = mid - span; i < mid + span; i++) { const j = i + L; if (j < 0 || j >= b.length) continue; s += a[i] * b[j]; na += a[i] * a[i]; nb += b[j] * b[j]; }
        const r = s / Math.sqrt(na * nb);
        if (r > bestS) { bestS = r; lagS = L; }
      }
      let rms = 0; for (let i = 0; i < a.length; i++) rms += a[i] * a[i];
      return { decodedSeconds: got.duration, referenceSeconds: ref.duration, rms: Math.sqrt(rms / a.length), deterministicMaxDiff: same, envelopeLagMs: lag, envelopeCorr: best, sampleLagMs: lagS * 1000 / sr, sampleCorr: bestS };
    })()`,
  )) as Record<string, number>;
  report['avSync'] = sync;
  log(`A/V: ${JSON.stringify(sync)}`);

  // 3. The file's frames at the film times, decoded in the page.
  const grab = async (p: Page, t: number, name: string): Promise<void> => {
    const png = (await p.evaluate(
      `(async () => {
        let v = window.__filmVideo;
        if (!v) { v = document.createElement('video'); v.muted = true; v.src = ${JSON.stringify(route)}; v.preload = 'auto'; await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('video: ' + (v.error && v.error.message))); setTimeout(() => no(new Error('video: no data (' + v.canPlayType('video/mp4; codecs=\"avc1.64002a\"') + ')')), 30000); }); window.__filmVideo = v; }
        // A paused element in a headless page never presents a frame (no requestVideoFrameCallback): seek, then wait a beat.
        const seeked = new Promise((ok) => { v.onseeked = ok; });
        v.currentTime = ${t} + 0.5 / ${fps};
        await Promise.race([seeked, new Promise((ok) => setTimeout(ok, 15000))]);
        await new Promise((ok) => setTimeout(ok, 150));
        const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        return c.toDataURL('image/png').slice(22);
      })()`,
    )) as string;
    writeFileSync(join(out, 'frames', name), Buffer.from(png, 'base64'));
  };
  await live.waitForTimeout(3000);
  const held: Array<{ at: number; live: number }> = [];
  // The live film plays once from its start (a seek would skip the actions and the tracking history before it), held at
  // each time for the shot and let go again.
  await live.evaluate(() => (window as unknown as { __aetherPlayer: { playStory(at: number): void } }).__aetherPlayer.playStory(0));
  for (const at of [...ats].sort((a, b) => a - b)) {
    const t = (await live.evaluate(
      `new Promise((done) => { const p = window.__aetherPlayer; const tick = () => { const s = p.story; if (s && s.time >= ${at} - 0.5 / 60) { p.pauseStory(true); done(s.time); } else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`,
    )) as number;
    await live.waitForTimeout(900);
    const k = Math.round(t * fps);
    {
      // The renderer's own capture of the held live film (the path the export draws through; no DOM overlay).
      const url = (await live.evaluate(`window.__aetherPlayer.simulation.renderer.screenshot({ width: 1920, height: 1080, mime: 'image/png' })`)) as string;
      writeFileSync(join(out, 'frames', `capture-${at}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    await live.screenshot({ path: join(out, 'frames', `live-${at}.png`) });
    await grab(live, k / fps, `film-${at}.png`);
    await grab(live, k / fps + 3, `control-${at}.png`);
    for (const o of (process.env['FILM_OFFSETS'] ?? '').split(',').filter(Boolean).map(Number)) await grab(live, k / fps + o, `film-${at}@${o}.png`);
    const cam = await live.evaluate(`(() => { const r = window.__aetherPlayer.simulation.renderer; const c = r.perspective; const el = r.domElement; const tp = r.cameraPose().target; return { filmOffset: c.filmOffset, near: c.near, far: c.far, proj: c.projectionMatrix.elements.map((v) => Math.round(v * 1000) / 1000), q: c.quaternion.toArray().map((v) => Math.round(v * 1000) / 1000), parent: c.parent ? c.parent.type + JSON.stringify(c.parent.position) : null, mw: c.matrixWorld.elements.slice(12, 15).map((v) => Math.round(v * 100) / 100), target: tp.map((v) => Math.round(v * 100) / 100), up: c.up.toArray().map((v) => Math.round(v * 1000) / 1000), fov: c.fov, aspect: c.aspect, zoom: c.zoom, view: c.view && c.view.enabled ? [c.view.fullWidth, c.view.fullHeight, c.view.width, c.view.height] : null, canvas: [el.width, el.height, el.clientWidth, el.clientHeight], pos: c.position.toArray().map((v) => Math.round(v * 100) / 100) }; })()`);
    const want = await live.evaluate(`(async () => { const p = window.__aetherPlayer; const m = await p.filmModule(); return m.filmCameraAt(p.simulation.renderer, p.world, ${k}, ${fps}); })()`);
    log(`film camera: ${JSON.stringify(want)}`);
    held.push({ at, live: t, cam, film: want } as never);
    log(`live camera: ${JSON.stringify(cam)}`);
    log(`frame at ${at}: live held at ${t.toFixed(3)} s, file frame ${k}`);
    await live.evaluate(() => (window as unknown as { __aetherPlayer: { pauseStory(on: boolean): void } }).__aetherPlayer.pauseStory(false));
  }
  await live.close();
  report['held'] = held;
  const diff = execFileSync('python3', ['-I', '-c', `
import json, sys
import numpy as np
from PIL import Image
d = sys.argv[1]
bar = int((1080 - 1920 / 2.39) / 2) + 2
out = []
def load(n, crop): 
    a = np.asarray(Image.open(d + '/' + n).convert('RGB')).astype(float)
    return a[bar:1080 - bar - 110] if crop else a
def m(a, b):
    e = np.abs(a - b); mse = ((a - b) ** 2).mean()
    return {'mae': round(float(e.mean()), 2), 'psnr': round(float(10 * np.log10(255 ** 2 / max(mse, 1e-9))), 2), 'over16': round(float((e.max(axis=2) > 16).mean() * 100), 2)}
for at in sys.argv[2].split(','):
    l, f, c = load('live-%s.png' % at, False), load('film-%s.png' % at, False), load('control-%s.png' % at, False)
    # Against the capture: inside the picture (between the bars, above the caption line; the capture has no overlay).
    cf, cc, cl, cp = load('film-%s.png' % at, True), load('control-%s.png' % at, True), load('live-%s.png' % at, True), load('capture-%s.png' % at, True)
    out.append({'at': float(at), 'film_vs_capture': m(cf, cp), 'control_vs_capture': m(cc, cp), 'viewport_vs_capture': m(cl, cp), 'film_vs_viewport': m(f, l), 'control_vs_viewport': m(c, l)})
print(json.dumps(out))
`, join(out, 'frames'), ats.join(',')]).toString();
  report['frames'] = JSON.parse(diff);
  log(`frames: ${diff.trim()}`);
} finally {
  await browser.close();
  await server.stop();
  rmSync(join(staticDir, '__film'), { recursive: true, force: true });
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
log(`report: ${join(out, 'report.json')}`);

/**
 * Record a world's cinematic tour as a video and a README-ready GIF.
 *
 * Opens the built studio on a bundled world (`#/new/<slug>`), waits until the world is fully loaded (the load gate's
 * `aether:fully-loaded` mark), hides the editor chrome, optionally moves the camera to a starting pose, plays the
 * studio's tour (the button in the viewport) and records it with Chrome's screencast. ffmpeg then crops the frames to
 * the viewport and writes `<slug>-tour.mp4` and `<slug>-tour.gif`.
 *
 * Run: `npm run build && npx tsx scripts/record-tour.ts --world=linden-row [--size=1920x1080] [--seconds=20]
 *       [--tier=ultra] [--pose=x,y,z,yaw,pitch] [--gif-width=960] [--fps=12] [--out=docs/screenshots]`
 *
 * Use a machine with a capable GPU and spare memory: a heavy world takes 3-5 GB in Chrome. On a hybrid-graphics laptop
 * set `GEN_GPU=nvidia` (WebGL2 on the discrete GPU, see tests/e2e/support/env.ts). Needs ffmpeg on the PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, HEADLESS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SLUG = arg('world') ?? 'linden-row';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];
const SECONDS = Number(arg('seconds') ?? 20);
const TIER = arg('tier') ?? 'ultra';
const POSE = arg('pose')?.split(',').map(Number);
const GIF_WIDTH = Number(arg('gif-width') ?? 960);
const FPS = Number(arg('fps') ?? 12);
const OUT = resolve(REPO_ROOT, arg('out') ?? 'docs/screenshots');
const log = (s: string): void => void process.stdout.write(`${s}\n`);

async function main(): Promise<void> {
  const frames = mkdtempSync(join(tmpdir(), 'aether-tour-'));
  const server = await startServer(() => undefined);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS] });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await context.addInitScript({ content: `try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier=${JSON.stringify(TIER)}; s.showNavHint=false; localStorage.setItem(k, JSON.stringify(s)); } catch {}` });
    const page = await context.newPage();
    await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    log(`loading ${SLUG} at ${W}x${H}, tier ${TIER}…`);
    await page.waitForFunction(() => performance.getEntriesByName('aether:fully-loaded').length + performance.getEntriesByName('aether:load-timeout').length > 0, null, { timeout: 300_000, polling: 1000 });
    // A game opens on its title card: back to the editor view.
    await page.getByRole('button', { name: /back to editor/i }).click({ timeout: 3000 }).catch(() => undefined);
    await page.evaluate(() => {
      const st = window.__aether?.store.getState();
      st?.setPanel('left', false);
      st?.setPanel('right', false);
    });
    // Only the picture: no toolbars, badges or gizmo.
    await page.addStyleTag({ content: '.viewport > *:not(.viewport__host) { visibility: hidden !important; }' });
    if (POSE && POSE.length === 5) {
      await page.evaluate((p) => (window.__aether?.simulation?.renderer as unknown as { setCameraPose(...a: number[]): void }).setCameraPose(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!), POSE);
    }
    // Let the still picture refine before the tour starts.
    await new Promise((r) => setTimeout(r, 6000));
    const box = await page.locator('.viewport').first().boundingBox();
    if (!box) throw new Error('no viewport on the page');
    const cdp = await context.newCDPSession(page);
    let n = 0;
    cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
      writeFileSync(join(frames, `f${String(n++).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    });
    await page.evaluate(() => (window.__aether as unknown as { studio: { tour(): void } }).studio.tour());
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    await new Promise((r) => setTimeout(r, SECONDS * 1000));
    await cdp.send('Page.stopScreencast');
    log(`${n} frames in ${SECONDS} s`);
    if (n < 2) throw new Error('no frames recorded');
    const crop = `crop=${Math.round(box.width) & ~1}:${Math.round(box.height) & ~1}:${Math.round(box.x)}:${Math.round(box.y)}`;
    const rate = String(n / SECONDS);
    const mp4 = join(OUT, `${SLUG}-tour.mp4`);
    const gif = join(OUT, `${SLUG}-tour.gif`);
    const input = ['-loglevel', 'error', '-y', '-framerate', rate, '-pattern_type', 'glob', '-i', join(frames, 'f*.jpg')];
    execFileSync('ffmpeg', [...input, '-vf', `${crop},fps=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4], { stdio: 'inherit' });
    execFileSync('ffmpeg', [...input, '-vf', `${crop},fps=${FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif], { stdio: 'inherit' });
    log(`wrote ${mp4} (${(statSync(mp4).size / 1048576).toFixed(1)} MB) and ${gif} (${(statSync(gif).size / 1048576).toFixed(1)} MB)`);
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
    rmSync(frames, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});

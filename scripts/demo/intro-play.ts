/**
 * Intro-video play takes, recorded in real time from the built studio with Chrome's screencast (every frame the page
 * paints, with its timestamp): Kestrel Outpost combat with its HUD, or a walk down Linden Row.
 *
 *   npm run build
 *   GEN_GPU=nvidia npx tsx scripts/demo/intro-play.ts --scene=outpost|linden [--seconds=20] [--size=1920x1080] [--out=<dir>]
 *
 * The take starts only after the load gate's `aether:fully-loaded` mark and a settle. Frames are written as JPEGs with
 * their paint times; ffmpeg turns them into a constant 60 fps `<out>/<scene>.mp4` (a frame is held until the next one
 * was painted, so the timing is the real one), and `<out>/<scene>.frames.json` keeps the frame times for a stutter check.
 *
 * Outpost: the driver presses Play on the title card, then turns smoothly onto the nearest raider (a capped turn rate,
 * not a snap), holds the trigger, strafes and reloads, like tests/e2e/outpost.e2e.ts but paced for a camera.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, HEADLESS, SKIP_FIRST_RUN, findChrome, startServer } from '../../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SCENE = arg('scene') ?? 'outpost';
const SECONDS = Number(arg('seconds') ?? 20);
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/intro/shots'));
const TIER = arg('tier') ?? 'ultra';
const log = (s: string): void => void process.stdout.write(`${s}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function loaded(page: Page): Promise<void> {
  await page.waitForFunction(() => performance.getEntriesByName('aether:fully-loaded').length + performance.getEntriesByName('aether:load-timeout').length > 0, null, { timeout: 300_000, polling: 1000 });
  if (await page.evaluate(() => performance.getEntriesByName('aether:load-timeout').length > 0)) log('WARNING: load gate timed out');
}

async function outpost(page: Page, url: string, record: () => Promise<() => Promise<void>>): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/kestrel-outpost`, { waitUntil: 'domcontentloaded' });
  await loaded(page);
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 240_000, polling: 250 });
  const card = page.locator('.title-card');
  await card.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 120_000, polling: 500 }).catch(() => undefined);
  await sleep(3000);
  await card.locator('.title-card__start').click();
  await card.waitFor({ state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-testid="combat-hud"]', { timeout: 30_000 });
  // Let the welcome toast pass before the take.
  await sleep(4500);
  const stop = await record();
  await page.evaluate('window.__name = (f) => f');
  const r = await page.evaluate(async (seconds) => {
    const a = window.__aether!;
    const sim = a.simulation!;
    const logic = sim.logic!;
    const d0 = sim.viewRay.dir;
    let yaw = (Math.atan2(-d0[0], -d0[2]) * 180) / Math.PI;
    let pitch = (Math.asin(d0[1]) * 180) / Math.PI;
    let strafe = 1;
    let strafeT = 0;
    const w0 = performance.now();
    let last = w0;
    let kills = 0;
    await new Promise<void>((done) => {
      const tick = (): void => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (now - w0 > seconds * 1000 || a.store.getState().game.status !== 'playing') return done();
        kills = Number(logic.readState('kills'));
        const eye = sim.viewRay.origin;
        let best: { x: number; y: number; z: number; d: number } | null = null;
        for (const b of logic.npcs.brains) {
          if (b.dead || b.spec.faction !== 'raiders') continue;
          const d = Math.hypot(b.x - eye[0], b.z - eye[2]);
          if (!best || d < best.d) best = { x: b.x, y: b.feetY + b.spec.height * 0.6, z: b.z, d };
        }
        let aimed = false;
        if (best && best.d < 50) {
          const ty = (Math.atan2(-(best.x - eye[0]), -(best.z - eye[2])) * 180) / Math.PI;
          const tp = (Math.atan2(best.y - eye[1], Math.hypot(best.x - eye[0], best.z - eye[2])) * 180) / Math.PI;
          let dy = ((ty - yaw + 540) % 360) - 180;
          const maxTurn = 110 * dt;
          dy = Math.max(-maxTurn, Math.min(maxTurn, dy * Math.min(1, dt * 6)));
          yaw += dy;
          pitch += Math.max(-60 * dt, Math.min(60 * dt, (tp - pitch) * Math.min(1, dt * 6)));
          aimed = Math.abs(((ty - yaw + 540) % 360) - 180) < 6;
        } else {
          yaw += 14 * dt;
          pitch += (-4 - pitch) * Math.min(1, dt * 2);
        }
        sim.setLook(yaw, pitch);
        sim.setVirtualFire(aimed);
        if (now - strafeT > 1800) {
          strafeT = now;
          strafe = -strafe;
        }
        sim.setVirtualStick(0, strafe * 0.5);
        const wpn = sim.weapon;
        if (wpn && wpn.ammo === 0 && wpn.reserve > 0 && !wpn.reloading) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r' }));
          setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', key: 'r' })), 60);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    sim.setVirtualFire(false);
    sim.setVirtualStick(0, 0);
    return { kills, status: a.store.getState().game.status };
  }, SECONDS);
  await stop();
  log(`outpost take: ${JSON.stringify(r)}`);
}

async function linden(page: Page, url: string, record: () => Promise<() => Promise<void>>): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/linden-row`, { waitUntil: 'domcontentloaded' });
  await loaded(page);
  await sleep(6000);
  await page.locator('button.play-btn').first().click();
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
  await sleep(2500);
  await page.getByRole('button', { name: /^Start/ }).first().click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 60_000, polling: 500 }).catch(() => undefined);
  await sleep(4000);
  const stop = await record();
  await page.evaluate('window.__name = (f) => f');
  // A slow walk with a gentle look round: forward on the virtual stick, yaw eased side to side.
  await page.evaluate(async (seconds) => {
    const sim = window.__aether!.simulation!;
    const d0 = sim.viewRay.dir;
    const y0 = (Math.atan2(-d0[0], -d0[2]) * 180) / Math.PI;
    const p0 = Math.max(-8, Math.min(4, (Math.asin(d0[1]) * 180) / Math.PI));
    const w0 = performance.now();
    await new Promise<void>((done) => {
      const tick = (): void => {
        const t = (performance.now() - w0) / 1000;
        if (t > seconds) return done();
        const ramp = Math.min(1, t / 1.5);
        sim.setVirtualStick(0.8 * ramp, 0);
        sim.setLook(y0 + Math.sin(t * 0.35) * 18, p0 + Math.sin(t * 0.21) * 2);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    sim.setVirtualStick(0, 0);
  }, SECONDS);
  await stop();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const frames = join(OUT, `.frames-${SCENE}`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const server = await startServer(() => undefined);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS] });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await context.addInitScript({ content: `try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier=${JSON.stringify(TIER)}; s.showNavHint=false; localStorage.setItem(k, JSON.stringify(s)); } catch {}` });
    const page = await context.newPage();
    page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
    const times: number[] = [];
    const record = async (): Promise<() => Promise<void>> => {
      const cdp = await context.newCDPSession(page);
      cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
        writeFileSync(join(frames, `f${String(times.length).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
        times.push(f.metadata.timestamp ?? Date.now() / 1000);
        void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
      return async () => {
        await cdp.send('Page.stopScreencast');
        await sleep(300);
      };
    };
    if (SCENE === 'outpost') await outpost(page, server.url, record);
    else if (SCENE === 'linden') await linden(page, server.url, record);
    else throw new Error(`unknown scene ${SCENE}`);
    if (times.length < 2) throw new Error('no frames');
    const gaps = times.slice(1).map((t, i) => (t - times[i]!) * 1000);
    const sorted = [...gaps].sort((a, b) => a - b);
    log(`${times.length} frames over ${(times[times.length - 1]! - times[0]!).toFixed(1)} s; gap median ${sorted[sorted.length >> 1]!.toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(1)} ms, max ${sorted[sorted.length - 1]!.toFixed(1)} ms`);
    writeFileSync(join(OUT, `${SCENE}.frames.json`), JSON.stringify({ t0: times[0], gapsMs: gaps.map((g) => Math.round(g * 10) / 10) }));
    const list = times.map((t, i) => `file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${(i + 1 < times.length ? times[i + 1]! - t : 1 / 60).toFixed(6)}`).join('\n');
    writeFileSync(join(frames, 'list.txt'), `${list}\nfile 'f${String(times.length - 1).padStart(5, '0')}.jpg'\n`);
    const mp4 = join(OUT, `${SCENE}.mp4`);
    execFileSync('nice', ['-n', '10', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'), '-vf', 'fps=60', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', mp4], { stdio: 'inherit' });
    log(`wrote ${mp4}`);
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
    rmSync(frames, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(String(e).slice(0, 600));
  process.exit(1);
});

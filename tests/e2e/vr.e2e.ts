/**
 * Immersive VR in the standalone player, on an emulated headset: Meta's Immersive Web Emulation Runtime (`iwer`, a
 * devDependency, injected into this test page only) gives headless Chromium a Quest 3 with two controllers. The suite
 * opens the Rug Exhibition Hall in the player on WebGL2 (`?xr=1`), checks the Enter VR button shows, enters VR, checks
 * the head stands at the walk view's spot and the two eye views are drawn (not black), aims a teleport with the left
 * stick (arc, landing ring) and takes it, snap-turns with the right stick, exits, and checks the walk view stands where
 * the visitor stood. Software rendering only (SwiftShader): slow, but no GPU.
 *
 * Usage: build first (`npm run build -w apps/studio`), serve `apps/studio/dist` (`npx vite preview --port 4290` in
 * apps/studio), then `tsx tests/e2e/vr.e2e.ts [--url=http://localhost:4290] [--out=<dir>]`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { REPO_ROOT, findChrome } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = arg('url') ?? 'http://localhost:4290';
const OUT = resolve(arg('out') ?? join(REPO_ROOT, 'gameplay-out', 'vr'));
const SLUG = arg('world') ?? 'rug-exhibition-hall';
const VIEWPORT = { width: 1280, height: 720 };
/** Software GL only: never the machine's GPU. */
const FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const started = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - started) / 1000).toFixed(1).padStart(7)}s] ${line}\n`);
const checks: Array<{ ok: boolean; what: string }> = [];
function check(ok: unknown, what: string): void {
  checks.push({ ok: !!ok, what });
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

type Stats = { active: boolean; frames: number; posed: number; teleports: number; turns: number; rig: { x: number; y: number; z: number; yaw: number }; head: number[]; aiming: boolean; target: number[] | null; framebufferScale: number };

const vrStats = (page: Page): Promise<Stats | null> => page.evaluate(() => (window.__aetherVR ? (window.__aetherVR.stats as unknown as Stats) : null));

/** Brightness of the screenshot's left and right halves (mean luma 0-255, and the share of pixels that are not near black). */
async function halves(page: Page, png: Buffer): Promise<{ left: { mean: number; lit: number }; right: { mean: number; lit: number } }> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    // No named function in here: tsx would wrap it in a helper the page does not have.
    const out: Array<{ mean: number; lit: number }> = [];
    const w = Math.floor(img.width / 2);
    for (const x0 of [0, w]) {
      const d = g.getImageData(x0, 0, w, img.height).data;
      let sum = 0;
      let lit = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.2126 * (d[i] as number) + 0.7152 * (d[i + 1] as number) + 0.0722 * (d[i + 2] as number);
        sum += y;
        if (y > 12) lit++;
      }
      out.push({ mean: sum / n, lit: lit / n });
    }
    return { left: out[0] as { mean: number; lit: number }, right: out[1] as { mean: number; lit: number } };
  }, png.toString('base64'));
}

async function waitFor<T>(page: Page, fn: string | (() => T | Promise<T>), what: string, timeout = 120_000): Promise<boolean> {
  try {
    await page.waitForFunction(fn, null, { timeout, polling: 250 });
    return true;
  } catch {
    log(`timed out waiting for ${what}`);
    return false;
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const iwer = readFileSync(join(REPO_ROOT, 'node_modules/iwer/build/iwer.min.js'), 'utf8');
  const browser = await chromium.launch({ executablePath: findChrome(), args: FLAGS });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || /\[vr\]/.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
    });
    // The emulated headset, installed over any native WebXR before the page's scripts run.
    await page.addInitScript({ content: iwer });
    await page.addInitScript(() => {
      const W = window as unknown as { IWER: { XRDevice: new (cfg: unknown, opts?: unknown) => { installRuntime(o?: unknown): void }; metaQuest3: unknown }; __xrDevice?: unknown };
      const dev = new W.IWER.XRDevice(W.IWER.metaQuest3, { stereoEnabled: true });
      dev.installRuntime({ forceInstall: true });
      W.__xrDevice = dev;
      // Keep the stacks of errors the page logs (a console message only carries the text).
      const errs: string[] = [];
      (window as unknown as { __errs: string[] }).__errs = errs;
      const original = console.error.bind(console);
      console.error = (...args: unknown[]) => {
        if (errs.length < 20) errs.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' '));
        original(...args);
      };
    });
    const url = `${BASE}/play.html?xr=1#t=${SLUG}&cook=0&tier=low`;
    log(`open ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const exploring = await waitFor(page, () => window.__aetherPlayer?.phase === 'exploring', 'explore mode', 300_000);
    check(exploring, 'the player opens the world in explore mode');
    check((await page.evaluate(() => window.__aetherPlayer?.backend)) === 'webgl2', 'the player booted on WebGL2 (?xr=1)');
    const button = await waitFor(page, () => !!document.querySelector('[data-testid="pl-enter-vr"]'), 'the Enter VR button', 30_000);
    check(button, 'the Enter VR button shows (immersive-vr supported)');
    // Let the first pictures settle a little (SwiftShader).
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(OUT, '1-walk-before.png') });
    const spot = await page.evaluate(() => {
      const c = window.__aetherPlayer?.exploreController as unknown as { viewSpot: { eye: number[]; yaw: number } } | null;
      return c ? c.viewSpot : null;
    });
    log(`walk spot before VR: ${JSON.stringify(spot)}`);

    await page.click('[data-testid="pl-enter-vr"]');
    const entered = await waitFor(page, () => (window.__aetherVR?.stats.posed ?? 0) > 3, 'VR frames', 120_000);
    check(entered, 'entered VR: the session draws tracked frames');
    if (!entered) throw new Error('could not enter VR');
    const s0 = (await vrStats(page)) as Stats;
    log(`in VR: ${JSON.stringify(s0)}`);
    if (spot) {
      check(Math.hypot((s0.head[0] as number) - (spot.eye[0] as number), (s0.head[2] as number) - (spot.eye[2] as number)) < 0.05, `the head stands at the walk spot (head ${s0.head.map((v) => v.toFixed(2)).join(', ')})`);
      check(Math.abs(s0.rig.y - ((spot.eye[1] as number) - 1.6)) < 0.01, 'the play space floor is the walk floor (local-floor, the visitor height on top)');
    }
    const t0 = performance.now();
    const f0 = s0.frames;
    await page.waitForTimeout(5000);
    const s1 = (await vrStats(page)) as Stats;
    const fps = ((s1.frames - f0) * 1000) / (performance.now() - t0);
    log(`emulated XR frame rate (SwiftShader, software): ${fps.toFixed(1)} fps; framebuffer scale ${s1.framebufferScale}`);
    // The view draws in VR (the direct draw's programs may link first: frames are held meanwhile).
    const drawn0 = await page.evaluate(() => window.__aetherPlayer?.simulation?.renderer.frameCount ?? 0);
    const drawing = await waitFor(page, `(window.__aetherPlayer?.simulation?.renderer.frameCount ?? 0) > ${drawn0 + 3}`, 'frames drawn in VR', 60_000);
    log(`renderer: drawn ${await page.evaluate(() => window.__aetherPlayer?.simulation?.renderer.frameCount ?? 0)} (was ${drawn0}), tier ${await page.evaluate(() => window.__aetherPlayer?.simulation?.renderer.renderTier)}, stage ${await page.evaluate(() => window.__aetherPlayer?.simulation?.renderer.processingStage ?? null)}`);
    check(drawing, 'the renderer draws frames inside the XR session');
    if (!drawing) throw new Error('nothing drawn in VR');
    const shot1 = await page.screenshot({ path: join(OUT, '2-vr-stereo.png') });
    const h1 = await halves(page, shot1);
    log(`eye views: ${JSON.stringify(h1)}`);
    check(h1.left.lit > 0.2 && h1.right.lit > 0.2 && h1.left.mean > 15 && h1.right.mean > 15, 'both eye views are drawn (not black)');

    // Teleport: the left controller points forward and down, the stick pushed forward aims, released goes.
    // Aims round the visitor (forward first, then to the sides, steeper) until one lands somewhere to stand.
    let aimed = false;
    for (const [yawDeg, pitchDeg] of [[0, -20], [0, -35], [40, -25], [-40, -25], [90, -25], [-90, -25], [150, -25], [-150, -25], [0, -50]] as const) {
      await page.evaluate(([yd, pd]) => {
        const dev = (window as unknown as { __xrDevice: { controllers: Record<string, { position: { set(x: number, y: number, z: number): void }; quaternion: { set(x: number, y: number, z: number, w: number): void }; updateAxes(id: string, x: number, y: number): void }> } }).__xrDevice;
        const left = dev.controllers['left'];
        if (!left) throw new Error('no left controller');
        left.position.set(-0.2, 1.2, -0.3);
        // Yaw about up, then pitch about the turned right axis: q = qYaw * qPitch.
        const sy = Math.sin((yd * Math.PI) / 360), cy = Math.cos((yd * Math.PI) / 360);
        const sp = Math.sin((pd * Math.PI) / 360), cp = Math.cos((pd * Math.PI) / 360);
        left.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
        left.updateAxes('thumbstick', 0, -1);
      }, [yawDeg, pitchDeg] as const);
      aimed = await waitFor(page, () => window.__aetherVR?.stats.aiming === true && window.__aetherVR.stats.target !== null, `a teleport target (yaw ${yawDeg}, pitch ${pitchDeg})`, 12_000);
      if (aimed) {
        log(`aimed at yaw ${yawDeg}, pitch ${pitchDeg}`);
        break;
      }
      await page.screenshot({ path: join(OUT, `3-miss-${yawDeg}_${pitchDeg}.png`) });
    }
    const sa = await vrStats(page);
    if (!sa) throw new Error('the VR session ended while aiming');
    log(`aiming: target ${JSON.stringify(sa.target)}`);
    // The arc's and the ring's shaders link the first time they show (seconds under SwiftShader).
    await page.waitForTimeout(10_000);
    await page.screenshot({ path: join(OUT, '3-vr-teleport-arc.png') });
    check(aimed, 'the left stick aims an arc onto the floor (a valid landing spot)');
    await page.evaluate(() => {
      const dev = (window as unknown as { __xrDevice: { controllers: Record<string, { updateAxes(id: string, x: number, y: number): void }> } }).__xrDevice;
      dev.controllers['left']?.updateAxes('thumbstick', 0, 0);
    });
    const moved = await waitFor(page, () => (window.__aetherVR?.stats.teleports ?? 0) >= 1, 'the teleport', 60_000);
    await page.waitForTimeout(2500);
    const s2 = (await vrStats(page)) as Stats;
    log(`after teleport: ${JSON.stringify(s2)}`);
    check(moved, 'releasing the stick teleports (once)');
    if (sa.target) check(Math.hypot((s2.head[0] as number) - (sa.target[0] as number), (s2.head[2] as number) - (sa.target[2] as number)) < 0.1 && Math.abs(s2.rig.y - (sa.target[1] as number)) < 0.01, 'the head now stands over the landing spot');
    const shot2 = await page.screenshot({ path: join(OUT, '4-vr-after-teleport.png') });
    const h2 = await halves(page, shot2);
    check(h2.left.lit > 0.2 && h2.right.lit > 0.2, `the view came back from the fade (${JSON.stringify(h2)})`);

    // Snap turn on the right stick.
    await page.evaluate(() => {
      const dev = (window as unknown as { __xrDevice: { controllers: Record<string, { updateAxes(id: string, x: number, y: number): void }> } }).__xrDevice;
      dev.controllers['right']?.updateAxes('thumbstick', 1, 0);
    });
    const turned = await waitFor(page, () => (window.__aetherVR?.stats.turns ?? 0) >= 1, 'a snap turn', 30_000);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const dev = (window as unknown as { __xrDevice: { controllers: Record<string, { updateAxes(id: string, x: number, y: number): void }> } }).__xrDevice;
      dev.controllers['right']?.updateAxes('thumbstick', 0, 0);
    });
    await page.waitForTimeout(1000);
    const s3 = (await vrStats(page)) as Stats;
    const dYaw = Math.atan2(Math.sin(s3.rig.yaw - s2.rig.yaw), Math.cos(s3.rig.yaw - s2.rig.yaw));
    check(turned && s3.turns === 1 && Math.abs(dYaw + Math.PI / 6) < 1e-6, `holding the right stick right snap-turns 30 degrees right, once (turned ${((dYaw * 180) / Math.PI).toFixed(1)} degrees)`);
    check(Math.hypot((s3.head[0] as number) - (s2.head[0] as number), (s3.head[2] as number) - (s2.head[2] as number)) < 1e-3, 'the snap turn turns on the spot (the head stays put)');
    await page.screenshot({ path: join(OUT, '5-vr-after-turn.png') });

    // Exit: the walk view stands where the visitor stood.
    await page.evaluate(() => window.__aetherVR?.exit());
    const back = await waitFor(page, () => !window.__aetherVR && window.__aetherPlayer?.phase === 'exploring', 'the walk view after VR', 60_000);
    check(back, 'exiting VR returns to the walk view');
    await page.waitForTimeout(5000);
    const standing = await page.evaluate(() => {
      const c = window.__aetherPlayer?.exploreController as unknown as { standing: { feet: number[]; yawDeg: number } | null } | null;
      return c?.standing ?? null;
    });
    log(`walk after VR: ${JSON.stringify(standing)}`);
    check(!!standing && Math.hypot((standing.feet[0] as number) - (s3.head[0] as number), (standing.feet[2] as number) - (s3.head[2] as number)) < 0.05 && Math.abs((standing.feet[1] as number) - s3.rig.y) < 0.01, 'the walk view stands where the visitor stood in VR');
    const shot3 = await page.screenshot({ path: join(OUT, '6-walk-after.png') });
    const h3 = await halves(page, shot3);
    check(h3.left.lit > 0.2 && h3.right.lit > 0.2, `the walk view draws again after VR (${JSON.stringify(h3)})`);

    // Safety: frames failing in VR end the session and bring the walk view back with a message (not a frozen headset).
    await page.click('[data-testid="pl-enter-vr"]');
    const again = await waitFor(page, () => (window.__aetherVR?.stats.posed ?? 0) > 2, 'VR again', 60_000);
    check(again, 'entered VR a second time');
    await page.evaluate(() => {
      const r = window.__aetherPlayer?.simulation?.renderer as unknown as { render: (...a: unknown[]) => boolean; __realRender?: unknown };
      r.__realRender = r.render;
      r.render = () => {
        throw new Error('test: rendering broken on purpose');
      };
    });
    const bailed = await waitFor(page, () => !window.__aetherVR && window.__aetherPlayer?.phase === 'exploring', 'VR ending itself', 60_000);
    const toast = await page.evaluate(() => document.querySelector('.pl-toasts')?.textContent ?? '');
    await page.evaluate(() => {
      const r = window.__aetherPlayer?.simulation?.renderer as unknown as { render: unknown; __realRender?: unknown };
      if (r.__realRender) r.render = r.__realRender;
    });
    await page.screenshot({ path: join(OUT, '7-vr-failure-exit.png') });
    check(bailed && /VR stopped/.test(toast), `repeated frame failures in VR end the session with a message (toast: ${JSON.stringify(toast.slice(0, 120))})`);
    const f4 = await page.evaluate(() => window.__aetherPlayer?.simulation?.renderer.frameCount ?? 0);
    const recovered = await waitFor(page, `(window.__aetherPlayer?.simulation?.renderer.frameCount ?? 0) > ${f4 + 2} && window.__aetherPlayer?.phase === 'exploring'`, 'the walk view drawing after the failure', 60_000);
    check(recovered, 'the walk view keeps drawing after VR ended itself');
  } finally {
    const page = browser.contexts()[0]?.pages()[0];
    const stacks = page ? await page.evaluate(() => (window as unknown as { __errs?: string[] }).__errs ?? []).catch(() => [] as string[]) : [];
    if (stacks.length) {
      log(`page error stacks:\n  ${stacks.slice(0, 5).join('\n  ')}`);
      writeFileSync(join(OUT, 'errors.txt'), stacks.join('\n\n'));
    }
    const bad = errors.filter((e) => !/Failed to load resource|GL Driver Message|GPU stall due to ReadPixels|WebGL warning/i.test(e));
    if (bad.length) log(`page errors:\n  ${bad.slice(0, 20).join('\n  ')}`);
    await browser.close();
  }
  const bad = errors.filter((e) => !/Failed to load resource|GL Driver Message|GPU stall due to ReadPixels|WebGL warning/i.test(e));
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ checks, errors: bad }, null, 2));
  log(`${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${OUT}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  log(`error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});

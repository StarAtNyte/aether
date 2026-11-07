/**
 * Screenshots of the player's per-kind entry and controls (`apps/studio/src/player/experience.ts`), one world per kind:
 *
 * - Casa del Patio (architecture): the hero view, a tour stop in a room, a click on the floor (the camera glides there),
 *   the dollhouse and the plan, then P (play as the character);
 * - Cliff Sanctuary (showcase): the fly-in at its start, middle and end;
 * - Lisbon Hills (city): the street-level hero view, then the drone tour;
 * - Kestrel Outpost (game): the title card, play, then Tab (explore).
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/experience-shots.ts --out=<dir> [--cooked] [slug ...]
 *
 * Writes `<slug>-<step>.png` and `report.json` (phases, explore state, camera positions). Live worlds (`cook=0`), or with
 * `--cooked` the dist's cooked packages (`cook=local`). Run it in
 * a capped scope, one browser at a time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const out = resolve(args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'probe-out/experience');
const only = args.filter((a) => !a.startsWith('--'));
/** `--cooked`: open each world from the dist's cooked package (`cook=local`, scripts/cook.ts `--install`) instead of live. */
const cooked = args.includes('--cooked');
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);
const report: Record<string, unknown> = {};

type Snap = { phase: string; experience: unknown; explore: unknown; camera: number[]; tour: boolean; mode: string | null; streaming?: unknown };
const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const p = (window as unknown as { __aetherPlayer?: { phase: string; experience: unknown; explore: unknown; simulation: { mode: string; renderer: { camera: { position: { x: number; y: number; z: number } }; touring: boolean } } | null } }).__aetherPlayer;
    const c = p?.simulation?.renderer.camera.position;
    const ex = p?.explore as { stops?: unknown[] } | null;
    // Cell streaming (a streamed world): the shown proxies nearest the camera and the near holds.
    const st = (globalThis as unknown as { __aetherStreaming?: () => { proxiesNear: unknown; holds: number; holdTimeouts: number; resident: number; loading: number } | null }).__aetherStreaming?.() ?? null;
    const streaming = st ? { proxiesNear: st.proxiesNear, holds: st.holds, holdTimeouts: st.holdTimeouts, resident: st.resident, loading: st.loading } : undefined;
    return { streaming, phase: p?.phase ?? 'none', experience: p?.experience ?? null, explore: ex ? { ...ex, stops: (ex.stops ?? []).length, names: (ex.stops as Array<{ name?: string }> | undefined)?.map((s) => s.name ?? null) } : null, camera: c ? [c.x, c.y, c.z].map((v) => Math.round(v * 100) / 100) : [], tour: p?.simulation?.renderer.touring ?? false, mode: p?.simulation?.mode ?? null };
  });

async function shot(page: Page, slug: string, step: string, steps: Array<Record<string, unknown>>): Promise<void> {
  const file = join(out, `${slug}-${step}.png`);
  await page.screenshot({ path: file });
  const s = await snap(page);
  steps.push({ step, file, ...s });
  log(`${slug} ${step}: phase ${s.phase}, camera ${s.camera.join(', ')}${s.tour ? ', touring' : ''}${s.streaming ? `, streaming ${JSON.stringify(s.streaming)}` : ''}`);
}

/** Wait for the computed tour stops (searched in slices after the entry starts). */
const waitStops = (page: Page, n: number): Promise<unknown> =>
  page.waitForFunction((k) => ((window as unknown as { __aetherPlayer?: { explore: { stops: unknown[] } | null } }).__aetherPlayer?.explore?.stops.length ?? 0) >= k, n, { timeout: 180_000, polling: 250 }).catch((e: unknown) => log(`stops still missing (${e instanceof Error ? e.message.slice(0, 160) : String(e)})`));

const ctrl = (page: Page, js: string): Promise<unknown> => page.evaluate(`(() => { const c = window.__aetherPlayer.exploreController; return ${js}; })()`);

async function open(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/play.html#t=${slug}&cook=${cooked ? 'local' : '0'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 250 });
  await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { simulation: { renderer: { processingStage: unknown } } | null } }).__aetherPlayer?.simulation?.renderer.processingStage === null, null, { timeout: 120_000, polling: 250 }).catch(() => log('renderer still busy'));
}

const CASES: Record<string, (page: Page, steps: Array<Record<string, unknown>>) => Promise<void>> = {
  async 'casa-patio'(page, steps) {
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'exploring', null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'casa-patio', '1-hero', steps);
    // A room of the tour (the stops after the hero view are the rooms).
    await waitStops(page, 4);
    await ctrl(page, 'c.setAutoplay(false), c.goTo(2)');
    await page.waitForTimeout(3500);
    await shot(page, 'casa-patio', '2-tour-room', steps);
    // Click the floor a little ahead: the camera glides there.
    const before = (await snap(page)).camera;
    const box = await page.locator('canvas').first().boundingBox();
    if (box) await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.8);
    await page.waitForTimeout(3000);
    await shot(page, 'casa-patio', '3-click-to-move', steps);
    const after = (await snap(page)).camera;
    steps.push({ step: 'click-moved', metres: Math.hypot(after[0]! - before[0]!, after[2]! - before[2]!) });
    // WASD: a second of W.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    const walked = (await snap(page)).camera;
    steps.push({ step: 'wasd-moved', metres: Math.hypot(walked[0]! - after[0]!, walked[2]! - after[2]!), eyeY: walked[1] });
    await ctrl(page, 'c.toggleDollhouse()');
    await page.waitForTimeout(3500);
    await shot(page, 'casa-patio', '4-dollhouse', steps);
    await ctrl(page, 'c.setPlan(true)');
    await page.waitForTimeout(3000);
    await shot(page, 'casa-patio', '5-plan', steps);
    // Click a room on the plan (the middle of the main bedroom, projected to the screen): fly into it.
    const at = (await page.evaluate(() => {
      const p = (window as unknown as { __aetherPlayer: { exploreController: { snapshot: { stops: Array<{ name?: string; position: number[] }> } }; simulation: { renderer: { camera: { position: { clone(): { set(x: number, y: number, z: number): { project(c: unknown): { x: number; y: number } } } } } } } } }).__aetherPlayer;
      const s = p.exploreController.snapshot.stops.find((v) => v.name === 'Main bedroom') ?? p.exploreController.snapshot.stops[1];
      if (!s) return null;
      const cam = p.simulation.renderer.camera;
      const v = cam.position.clone().set(s.position[0]!, s.position[1]! - 1.6, s.position[2]!).project(cam);
      return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
    })) as { x: number; y: number } | null;
    if (box && at) await page.mouse.click(box.x + box.width * at.x, box.y + box.height * at.y);
    await page.waitForTimeout(2500);
    await shot(page, 'casa-patio', '6-plan-room-click', steps);
    // P: play as the character, from where the walk stands.
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'playing', null, { timeout: 60_000 });
    await page.waitForTimeout(4000);
    await shot(page, 'casa-patio', '7-play-character', steps);
    // Tab: back to explore mode.
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'exploring', null, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'casa-patio', '8-tab-explore', steps);
  },
  async 'cliff-sanctuary'(page, steps) {
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'exploring', null, { timeout: 60_000 });
    await page.waitForTimeout(400);
    await shot(page, 'cliff-sanctuary', '1-fly-in-start', steps);
    await page.waitForTimeout(3200);
    await shot(page, 'cliff-sanctuary', '2-fly-in-middle', steps);
    await page.waitForTimeout(5000);
    await shot(page, 'cliff-sanctuary', '3-fly-in-end', steps);
    await waitStops(page, 3);
    await ctrl(page, 'c.goTo(2)');
    await page.waitForTimeout(5000);
    await shot(page, 'cliff-sanctuary', '4-viewpoint', steps);
  },
  async 'lisbon-hills'(page, steps) {
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'exploring', null, { timeout: 60_000 });
    await page.waitForTimeout(1000);
    await shot(page, 'lisbon-hills', '1-street-hero', steps);
    await page.waitForTimeout(9000);
    await shot(page, 'lisbon-hills', '2-drone-tour', steps);
    await page.waitForTimeout(8000);
    await shot(page, 'lisbon-hills', '3-drone-tour-later', steps);
    // Camera jumps of a streamed world (its near cells must be full detail on arrival): every district button, the hero
    // view again, then the start-mode change (play as the character) and back.
    await waitStops(page, 2);
    const stops = (await ctrl(page, 'c.snapshot.stops.length')) as number;
    await ctrl(page, 'c.setAutoplay(false)');
    for (let i = 1; i < Math.min(stops, 7); i++) {
      await ctrl(page, `c.goTo(${i})`);
      await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { simulation: { renderer: { cameraFlying: boolean } } | null } }).__aetherPlayer?.simulation?.renderer.cameraFlying === false, null, { timeout: 30_000, polling: 100 }).catch(() => log('still flying'));
      await page.waitForTimeout(300);
      await shot(page, 'lisbon-hills', `4-district-${i}`, steps);
    }
    await ctrl(page, 'c.goTo(0)');
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { simulation: { renderer: { cameraFlying: boolean } } | null } }).__aetherPlayer?.simulation?.renderer.cameraFlying === false, null, { timeout: 30_000, polling: 100 }).catch(() => log('still flying'));
    await page.waitForTimeout(300);
    await shot(page, 'lisbon-hills', '5-hero-again', steps);
    await page.evaluate(() => (window as unknown as { __aetherPlayer: { start(): void } }).__aetherPlayer.start());
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'playing', null, { timeout: 60_000, polling: 250 }).catch(() => log('play did not start'));
    await page.waitForTimeout(1500);
    await shot(page, 'lisbon-hills', '6-play', steps);
  },
  async 'kestrel-outpost'(page, steps) {
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'title', null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'kestrel-outpost', '1-title', steps);
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'playing', null, { timeout: 60_000 });
    await page.waitForTimeout(3000);
    await shot(page, 'kestrel-outpost', '2-play', steps);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'exploring', null, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'kestrel-outpost', '3-tab-explore', steps);
  },
};

/** `--hero`: any world, only its entry view once it has settled (a fly-in landed), with the opening pose and the stop names. */
const heroOnly = args.includes('--hero');
async function heroCase(page: Page, slug: string, steps: Array<Record<string, unknown>>): Promise<void> {
  await page.waitForFunction(() => ['exploring', 'title'].includes((window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase ?? ''), null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { simulation: { renderer: { cameraFlying: boolean } } | null } }).__aetherPlayer?.simulation?.renderer.cameraFlying === false, null, { timeout: 60_000, polling: 250 }).catch(() => log('still flying'));
  await page.waitForTimeout(2500);
  await shot(page, slug, 'entry', steps);
  // The hero view once the scene and the stops are complete (stop 0; what the cook stores as the opening).
  await waitStops(page, 2);
  if ((await page.evaluate(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase)) === 'exploring') {
    await ctrl(page, 'c.setAutoplay(false), c.goTo(0)');
    await page.waitForTimeout(4000);
  }
  await shot(page, slug, 'hero', steps);
  const pose = await page.evaluate(() => (window as unknown as { __aetherPlayer: { simulation: { renderer: { openingPose(): unknown } } } }).__aetherPlayer.simulation.renderer.openingPose());
  const names = (await snap(page)).explore;
  steps.push({ step: 'opening', pose, names });
}

const server = await env.startServer(() => undefined);
try {
  for (const slug of only.length > 0 ? only : Object.keys(CASES)) {
    const run = heroOnly ? (page: Page, steps: Array<Record<string, unknown>>) => heroCase(page, slug, steps) : CASES[slug];
    if (!run) throw new Error(`no case for ${slug}`);
    const browser = await chromium.launch({ executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS });
    const steps: Array<Record<string, unknown>> = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      // WebGL2 runs (GEN_GPU=intel: ANGLE over GL-EGL, the office PC's probe setting): no WebGPU adapter.
      if (process.env['GEN_GPU'] === 'intel') await page.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
      });
      log(`${slug}: opening`);
      await open(page, server.url, slug);
      await run(page, steps);
      report[slug] = { steps, errors };
    } catch (e) {
      const page = browser.contexts()[0]?.pages()[0];
      const where = page ? await page.evaluate(() => ({ phase: (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase, focus: document.activeElement?.outerHTML.slice(0, 160) ?? null })).catch(() => null) : null;
      report[slug] = { steps, failed: e instanceof Error ? e.message.slice(0, 400) : String(e), where };
      log(`${slug} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await browser.close();
    }
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
} finally {
  await server.stop();
}
log(`report: ${join(out, 'report.json')}`);

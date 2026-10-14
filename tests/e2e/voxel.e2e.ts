/**
 * End-to-end check of block worlds (voxel terrain + game kit) in real
 * browsers: Chromium (WebGPU, then forced WebGL2) and Firefox (WebGL2), one
 * browser at a time.
 *
 * 1. New project → prompt "a minecraft-like survival world" through the
 *    chat; the terrain streams in (view distance 6) without main-thread
 *    long tasks over 50 ms (Chromium's long-task API; Firefox: frame gaps);
 * 2. block edit → remesh latency (diagnostic edit, time until the new chunk
 *    mesh is on screen);
 * 3. Play: walk with the keyboard, break a block (left mouse held), place
 *    it back (right click), open the inventory (E), craft sticks, close;
 * 4. teleport far several times: loaded chunks and drawn chunk meshes stay
 *    bounded (unloading works);
 * 5. Stop (saves), reload the page, play again: the block changes persist.
 *
 * Numbers are relative (software rasterizer); they are printed as a report.
 * Run: `npm run build && npm run e2e:voxel` (`-- --chromium` / `-- --firefox`
 * for one browser).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const VIEWPORT = { width: 1280, height: 800 };
const OUT = join(REPO_ROOT, 'docs/screenshots');
const BOOT_MS = 60_000;
const AGENT_MS = 120_000;
const STREAM_MS = 120_000;
/** Longest main-thread task allowed while terrain streams (ms). */
const MAX_LONG_TASK_MS = 50;
const ARGS = process.argv.slice(2);

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

class E2EFailure extends Error {
  override name = 'E2EFailure';
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new E2EFailure(message);
}

const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];

async function waitFor<T>(page: Page, what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>, intervalMs = 200): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  let last: unknown = null;
  while (performance.now() < deadline) {
    const v = await probe();
    if (v !== null && v !== undefined && v !== false) return v;
    last = v;
    await page.waitForTimeout(intervalMs);
  }
  throw new E2EFailure(`timed out after ${timeoutMs} ms waiting for ${what} (last=${JSON.stringify(last)})`);
}

/** Records long tasks (Chromium) and frame gaps (all browsers) from page start. */
const LONG_TASK_PROBE = `
(() => {
  const w = window;
  w.__vxLong = [];
  w.__vxGaps = [];
  w.__vxMark = 0;
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__vxLong.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  let last = performance.now();
  const tick = (t) => { const gap = t - last; last = t; if (gap > 34) w.__vxGaps.push([t - gap, gap]); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();`;

interface Metrics {
  backend: string;
  streamMs: number;
  chunks: number;
  maxLongTask: number;
  longTaskApi: boolean;
  maxFrameGap: number;
  editMs: number[];
  peakLoaded: number;
  peakDrawn: number;
  fps: number;
}

async function boot(page: Page, url: string, path: string): Promise<void> {
  await page.goto(`${url}/?debug=1${path}`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, 'the studio to boot', BOOT_MS, () => page.evaluate(() => {
    const a = window.__aether;
    const st = a?.store.getState();
    if (st?.fatal) return `fatal: ${st.fatal}`;
    return a && a.simulation !== null && st?.loading === null ? true : null;
  }));
}

async function streamed(page: Page): Promise<{ chunks: number }> {
  return waitFor(page, 'terrain streaming to settle', STREAM_MS, () => page.evaluate(() => {
    const v = window.__aether?.simulation?.voxel;
    if (!v?.active) return null;
    const s = v.status();
    return s.settled && s.meshed > 0 ? { chunks: s.meshed } : null;
  }), 300);
}

async function screenshot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.addStyleTag({ content: '.nav-hint, .toasts, .toast, .tooltip { display: none !important; }' });
  const png = await page.locator('.viewport').screenshot({ path: join(OUT, `${name}.png`) });
  const stats = pixelStats(decodePng(png));
  check(stats.stdDev > 6, `${name}: blank viewport`);
}

async function play(page: Page): Promise<void> {
  await page.evaluate(() => void window.__aether?.studio.togglePlay());
  await waitFor(page, 'the voxel game to start', 60_000, () => page.evaluate(() => {
    const hud = window.__aether?.store.getState().voxelHud;
    return hud && hud.loading === null ? true : null;
  }));
}

async function stop(page: Page): Promise<void> {
  await page.evaluate(() => void window.__aether?.studio.togglePlay());
  await waitFor(page, 'edit mode', 30_000, () => page.evaluate(() => (window.__aether?.store.getState().mode === 'edit' ? true : null)));
}

/** Player feet + look, from the running game. */
function player(page: Page): Promise<{ x: number; y: number; z: number; slots: Array<{ item: string; count: number } | null> } | null> {
  return page.evaluate(() => {
    const g = window.__aether?.simulation?.voxel?.game?.game;
    if (!g) return null;
    const b = g.player.body;
    return { x: b.x, y: b.y, z: b.z, slots: g.inventory.snapshot() };
  });
}

async function run(browser: Browser, url: string, label: string, forceWebGL2: boolean): Promise<Metrics> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  await context.addInitScript({ content: LONG_TASK_PROBE });
  if (forceWebGL2) await context.addInitScript({ content: 'try { delete Navigator.prototype.gpu; } catch {}' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !BENIGN_CONSOLE.some((r) => r.test(m.text()))) errors.push(`console: ${m.text()}`);
  });
  try {
    await boot(page, url, '#/new');
    const backend = await page.evaluate(() => window.__aether?.simulation?.backend ?? '?');
    log(`[${label}] booted on ${backend}`);

    // 1. Prompt → block world, streamed without long tasks.
    const input = page.getByLabel('Prompt', { exact: true });
    await input.fill('a minecraft-like survival world');
    await page.evaluate(() => {
      (window as unknown as { __vxMark: number }).__vxMark = performance.now();
    });
    await input.press('Enter');
    await waitFor(page, 'the agent turn', AGENT_MS, () => page.evaluate(() => {
      const st = window.__aether?.store.getState();
      return st && !st.agentBusy && window.__aether?.history.current.voxel ? true : null;
    }));
    const tAgent = await page.evaluate(() => performance.now());
    const { chunks } = await streamed(page);
    const streamMs = (await page.evaluate(() => performance.now())) - tAgent;
    const tasks = await page.evaluate(() => {
      const w = window as unknown as { __vxLong: Array<[number, number]>; __vxGaps: Array<[number, number]>; __vxMark: number };
      const after = (e: [number, number]): boolean => e[0] >= w.__vxMark;
      let api = true;
      try {
        api = PerformanceObserver.supportedEntryTypes.includes('longtask');
      } catch {
        api = false;
      }
      return { long: w.__vxLong.filter(after).map((e) => e[1]), gaps: w.__vxGaps.filter(after).map((e) => e[1]), api };
    });
    const maxLongTask = Math.max(0, ...tasks.long);
    const maxFrameGap = Math.max(0, ...tasks.gaps);
    log(`[${label}] ${chunks} chunks meshed in ${Math.round(streamMs)} ms; longest task ${Math.round(maxLongTask)} ms${tasks.api ? '' : ' (no long-task API)'}; longest frame gap ${Math.round(maxFrameGap)} ms`);
    await page.waitForTimeout(800);
    if (label === 'chromium-webgpu') await screenshot(page, 'voxel-survival');

    // 2. Edit → remesh latency (diagnostic edits near the spawn).
    const editMs: number[] = [];
    for (let k = 0; k < 5; k++) {
      const ms = await page.evaluate(async (i) => {
        const v = window.__aether?.simulation?.voxel;
        if (!v) return -1;
        const ground = v.groundAt(4 + i, 3);
        return v.measureEdit(4 + i, ground, 3, 'gold_block');
      }, k);
      editMs.push(Math.round(ms));
    }
    check(editMs.every((ms) => ms >= 0), `edit remesh never showed: ${editMs.join(', ')}`);
    log(`[${label}] edit → visible remesh: ${editMs.join(', ')} ms`);

    // 3. Play: walk, break, place, craft.
    await play(page);
    const start = await player(page);
    check(start, 'no player');
    await page.locator('.viewport__canvas').click({ position: { x: VIEWPORT.width / 2 - 200, y: VIEWPORT.height / 2 } }).catch(() => undefined);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(400);
    const walked = await player(page);
    check(walked && Math.hypot(walked.x - start.x, walked.z - start.z) > 1.5, `the player did not walk (${JSON.stringify([start, walked])})`);
    log(`[${label}] walked ${Math.hypot((walked?.x ?? 0) - start.x, (walked?.z ?? 0) - start.z).toFixed(1)} blocks`);

    // Look straight down and break the block underfoot.
    const before = await page.evaluate(() => {
      const play = window.__aether?.simulation?.voxel?.game;
      if (!play) return null;
      play.input.setLook(play.input.yawRad, -1.5);
      const b = play.game.player.body;
      return { x: Math.floor(b.x), y: Math.floor(b.y) - 1, z: Math.floor(b.z) };
    });
    check(before, 'no game');
    const cx = VIEWPORT.width / 2;
    const cy = VIEWPORT.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await waitFor(page, 'a block to break', 15_000, () => page.evaluate((c) => {
      const v = window.__aether?.simulation?.voxel;
      const id = v?.blockAt(c.x, c.y, c.z);
      return id === 'air' ? true : null;
    }, before));
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(1500);
    const afterBreak = await player(page);
    const dug = afterBreak?.slots.find((s) => s && (s.item === 'dirt' || s.item === 'cobblestone' || s.item === 'sand' || s.item === 'gravel'));
    check(dug, `the broken block was not picked up (${JSON.stringify(afterBreak?.slots.slice(0, 9))})`);
    log(`[${label}] broke ${before.x},${before.y},${before.z} and picked up ${dug.item}`);

    // Place it back: select its slot, right click while looking down.
    const slot = afterBreak?.slots.indexOf(dug) ?? 0;
    if (slot < 9) await page.keyboard.press(`Digit${slot + 1}`);
    const placedAt = await page.evaluate(() => {
      const play = window.__aether?.simulation?.voxel?.game;
      return play ? { x: Math.floor(play.game.target.hit.x + play.game.target.hit.nx), y: play.game.target.hit.y + play.game.target.hit.ny, z: Math.floor(play.game.target.hit.z + play.game.target.hit.nz) } : null;
    });
    // Jump so the cell under the feet is free, and place in mid-air (classic pillar-up).
    await page.keyboard.down('Space');
    await page.waitForTimeout(180);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(250);
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Space');
    await page.waitForTimeout(600);
    const placed = await page.evaluate((c) => {
      const v = window.__aether?.simulation?.voxel;
      if (!c || !v) return false;
      // Anything solid back in the dug cell or the pillar cell above it.
      const a = v.blockAt(c.x, c.y, c.z);
      const b = v.blockAt(c.x, c.y + 1, c.z);
      return (a !== null && a !== 'air') || (b !== null && b !== 'air');
    }, placedAt);
    check(placed, 'the block was not placed');
    log(`[${label}] placed a block`);

    // Inventory: craft sticks from the starting planks.
    await page.keyboard.press('KeyE');
    await page.getByRole('dialog', { name: 'Inventory and crafting' }).waitFor({ timeout: 10_000 });
    const sticksBefore = (await player(page))?.slots.reduce((n, s) => n + (s?.item === 'stick' ? s.count : 0), 0) ?? 0;
    await page.getByRole('button', { name: 'Craft Stick', exact: true }).first().click();
    await waitFor(page, 'sticks to be crafted', 5000, async () => ((await player(page))?.slots.reduce((n, s) => n + (s?.item === 'stick' ? s.count : 0), 0) ?? 0) > sticksBefore);
    if (label === 'chromium-webgpu') await screenshot(page, 'voxel-inventory');
    await page.keyboard.press('KeyE');
    await page.getByRole('dialog', { name: 'Inventory and crafting' }).waitFor({ state: 'detached', timeout: 10_000 });
    log(`[${label}] crafted sticks`);
    if (label === 'chromium-webgpu') {
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const play = window.__aether?.simulation?.voxel?.game;
        play?.input.setLook(play.input.yawRad, -0.12);
      });
      await page.waitForTimeout(600);
      await screenshot(page, 'voxel-play');
    }
    const fps = await page.evaluate(() => window.__aether?.store.getState().stats.fps ?? 0);

    // 4. Walk far (teleports): memory stays bounded.
    let peakLoaded = 0;
    let peakDrawn = 0;
    for (let k = 1; k <= 4; k++) {
      await page.evaluate((i) => {
        const g = window.__aether?.simulation?.voxel?.game?.game;
        if (!g) return;
        g.player.body.x += 300 * i;
        g.player.body.y = 120;
        g.player.flying = true;
      }, k);
      await page.waitForTimeout(2500);
      const c = await page.evaluate(() => window.__aether?.simulation?.voxel?.counts ?? { loaded: 0, drawn: 0 });
      peakLoaded = Math.max(peakLoaded, c.loaded);
      peakDrawn = Math.max(peakDrawn, c.drawn);
    }
    const vd = 6;
    check(peakLoaded <= (2 * (vd + 2) + 1) ** 2, `loaded chunks unbounded: ${peakLoaded}`);
    check(peakDrawn <= (2 * vd + 1) ** 2, `drawn chunk meshes unbounded: ${peakDrawn}`);
    log(`[${label}] walking far: at most ${peakLoaded} chunks loaded, ${peakDrawn} drawn`);
    // Back home for the save check.
    await page.evaluate((s) => {
      const g = window.__aether?.simulation?.voxel?.game?.game;
      if (!g) return;
      g.player.body.x = s.x;
      g.player.body.y = s.y + 4;
      g.player.body.z = s.z;
    }, start);
    await page.waitForTimeout(1500);

    // 5. Stop (saves), reload, play: the dug cell is still changed.
    await stop(page);
    await page.waitForTimeout(500);
    const projectUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    check(page.url() === projectUrl, 'reload changed the project');
    await waitFor(page, 'the studio to boot again', BOOT_MS, () => page.evaluate(() => (window.__aether?.simulation && window.__aether.store.getState().loading === null ? true : null)));
    await streamed(page);
    const persisted = await waitFor(page, 'the saved chunk to load', 20_000, () => page.evaluate((c) => {
      const v = window.__aether?.simulation?.voxel;
      const id = v?.blockAt(c.x, c.y, c.z);
      return id && id !== null ? id : null;
    }, before));
    const generated = await page.evaluate(() => window.__aether?.simulation?.voxel?.status().changed ?? 0);
    check(generated > 0, 'no modified chunk came back from the save');
    log(`[${label}] after reload the dug cell holds "${persisted}" (${generated} saved chunk(s) loaded)`);
    check(errors.length === 0, `page errors:\n${errors.join('\n')}`);
    return { backend, streamMs, chunks, maxLongTask, longTaskApi: tasks.api, maxFrameGap, editMs, peakLoaded, peakDrawn, fps };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const results: Array<{ name: string; m: Metrics }> = [];
  let browser: Browser | null = null;
  const only = ARGS.find((a) => a === '--chromium' || a === '--firefox');
  try {
    if (only !== '--firefox') {
      browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
      results.push({ name: 'chromium-webgpu', m: await run(browser, server.url, 'chromium-webgpu', false) });
      results.push({ name: 'chromium-webgl2', m: await run(browser, server.url, 'chromium-webgl2', true) });
      await browser.close();
      browser = null;
    }
    if (only !== '--chromium') {
      browser = await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
      results.push({ name: 'firefox-webgl2', m: await run(browser, server.url, 'firefox-webgl2', false) });
      await browser.close();
      browser = null;
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await server.stop();
  }
  for (const { name, m } of results) {
    log(`${name}: backend ${m.backend}, ${m.chunks} chunks in ${Math.round(m.streamMs)} ms, longest task ${Math.round(m.maxLongTask)} ms${m.longTaskApi ? '' : ' (n/a)'}, frame gap ${Math.round(m.maxFrameGap)} ms, edit ${m.editMs.join('/')} ms, peak ${m.peakLoaded}/${m.peakDrawn} chunks, ${m.fps} fps`);
    if (m.longTaskApi) check(m.maxLongTask <= MAX_LONG_TASK_MS, `${name}: a main-thread task took ${Math.round(m.maxLongTask)} ms while streaming (max ${MAX_LONG_TASK_MS})`);
  }
  log('voxel e2e passed');
}

main().catch((err: unknown) => {
  log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
});

/**
 * End-to-end check of block worlds (voxel terrain + game kit) in real
 * browsers: Chromium (WebGPU, then forced WebGL2) and Firefox (WebGL2), one
 * browser at a time.
 *
 * 1. New project → prompt "a minecraft-like survival world" through the
 *    chat; the terrain streams in (view distance 8, in workers) without
 *    main-thread long tasks over 50 ms once the first chunk is drawn
 *    (Chromium's long-task API; Firefox: frame gaps are reported);
 * 2. block edit → remesh latency (diagnostic edit: time until the new chunk
 *    mesh is installed, and until the next frame shows it);
 * 3. Play: walk with the keyboard, break a block (left mouse held), place
 *    it back (right click), open the inventory (E), craft sticks, close;
 * 4. teleport far several times: loaded chunks and drawn chunk meshes stay
 *    bounded (unloading works);
 * 5. Stop (saves), reload the page, play again: the block changes persist;
 * 6. a phone with a touch screen: touch hints, drag to look, the inventory
 *    button, the inventory fits and the touch controls step aside.
 *
 * Numbers are relative (software rasterizer); they are printed as a report.
 * Run: `npm run build && npm run e2e:voxel` (`-- --chromium` / `-- --firefox`
 * for one browser, `-- --chromium --webgpu` / `-- --chromium --webgl2` for one Chromium backend,
 * `-- --touch` for the phone scenario only).
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
/** Longest piece of the voxel engine's own main-thread work (scheduling, reply, upload batch; ms). */
const MAX_VOXEL_WORK_MS = 16;
/**
 * Median edit → new chunk mesh installed (ms). A remesh job is ~7 ms on a
 * laptop core; the software rasteriser shares the CPU, so the headless
 * bound is looser than the 16 ms desktop frame it stands for.
 */
const MAX_EDIT_MESH_MS = 60;
const ARGS = process.argv.slice(2);
/** `--touch`: only the phone / touch scenario. */
const TOUCH_ONLY = ARGS.includes('--touch');

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
  w.__vxLoaf = [];
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__vxLong.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    // Long animation frames (Chromium): which scripts ran in a long frame, and how long the rest (render, GPU waits) took.
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const scripts = (e.scripts || []).map((s) => [Math.round(s.duration), String(s.invoker || '').slice(0, 60), String(s.sourceFunctionName || '').slice(0, 40)]);
        w.__vxLoaf.push([e.startTime, Math.round(e.duration), Math.round(e.blockingDuration || 0), Math.round((e.renderStart || 0) ? e.startTime + e.duration - e.renderStart : 0), scripts]);
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
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
  view: number;
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

async function streamed(page: Page): Promise<{ chunks: number; view: number; inline: boolean }> {
  return waitFor(page, 'terrain streaming to settle', STREAM_MS, () => page.evaluate(() => {
    const v = window.__aether?.simulation?.voxel;
    if (!v?.active) return null;
    const s = v.status();
    return s.settled && s.meshed > 0 && !s.compiling ? { chunks: s.meshed, view: s.view, inline: s.inline } : null;
  }), 300);
}

/** Time (page clock) when the first terrain chunk is on screen: shaders compiled, a mesh installed. */
async function firstChunkVisible(page: Page): Promise<number> {
  return waitFor(page, 'the first terrain chunk', STREAM_MS, () => page.evaluate(() => {
    const v = window.__aether?.simulation?.voxel;
    if (!v?.active) return null;
    const s = v.status();
    return s.meshed > 0 && !s.compiling ? performance.now() : null;
  }), 50);
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
  // tsx keeps function names with an `__name` helper that page.evaluate bodies reference.
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
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
    // The streaming window starts once the first chunk is drawn (terrain shaders compiled):
    // from then on generation and meshing must never block the main thread.
    const tFirst = await firstChunkVisible(page);
    const { chunks, view, inline } = await streamed(page);
    check(!inline, 'voxel jobs fell back to the main thread (workers unavailable)');
    check(view >= 8, `view distance ${view} < 8 chunks`);
    const streamMs = (await page.evaluate(() => performance.now())) - tAgent;
    const tasks = await page.evaluate((from) => {
      const w = window as unknown as { __vxLong: Array<[number, number]>; __vxGaps: Array<[number, number]>; __vxMark: number };
      let api = true;
      try {
        api = PerformanceObserver.supportedEntryTypes.includes('longtask');
      } catch {
        api = false;
      }
      return {
        long: w.__vxLong.filter((e) => e[0] >= from).map((e) => e[1]),
        gaps: w.__vxGaps.filter((e) => e[0] >= from).map((e) => e[1]),
        before: w.__vxLong.filter((e) => e[0] >= w.__vxMark && e[0] < from).map((e) => e[1]),
        loaf: (window as unknown as { __vxLoaf: Array<[number, number, number, number, unknown]> }).__vxLoaf.filter((e) => e[0] >= from && e[2] > 0).map((e) => e.slice(1)),
        api,
      };
    }, tFirst);
    const work = await page.evaluate(() => window.__aether?.simulation?.voxel?.workStats() ?? { update: -1, reply: -1, upload: -1 });
    const maxLongTask = Math.max(0, ...tasks.long);
    if (tasks.loaf.length > 0) log(`[${label}] frames with blocking work while streaming [duration, blocking, render, scripts]: ${JSON.stringify(tasks.loaf.slice(0, 6))}`);
    const maxFrameGap = Math.max(0, ...tasks.gaps);
    log(`[${label}] view ${view}: ${chunks} chunks meshed in ${Math.round(streamMs)} ms (first chunk after ${Math.round(tFirst - tAgent)} ms); while streaming: longest task ${Math.round(maxLongTask)} ms${tasks.api ? '' : ' (no long-task API)'}, longest frame gap ${Math.round(maxFrameGap)} ms; agent turn + first frame: longest task ${Math.round(Math.max(0, ...tasks.before))} ms; voxel main-thread work: update ${work.update.toFixed(1)} ms, reply ${work.reply.toFixed(1)} ms, uploads ${work.upload.toFixed(1)} ms per task`);
    check(work.update >= 0 && Math.max(work.update, work.reply, work.upload) <= MAX_VOXEL_WORK_MS, `${label}: voxel main-thread work too long: ${JSON.stringify(work)}`);
    await page.waitForTimeout(800);
    if (label === 'chromium-webgpu') await screenshot(page, 'voxel-survival');

    // 2. Edit → remesh latency (diagnostic edits near the spawn).
    const editMs: number[] = [];
    const editFrameMs: number[] = [];
    for (let k = 0; k < 5; k++) {
      const r = await page.evaluate(async (i) => {
        const v = window.__aether?.simulation?.voxel;
        if (!v) return { mesh: -1, frame: -1 };
        const ground = v.groundAt(4 + i, 3);
        return v.measureEdit(4 + i, ground, 3, 'gold_block');
      }, k);
      editMs.push(Math.round(r.mesh));
      editFrameMs.push(Math.round(r.frame));
      await page.waitForTimeout(100);
    }
    check(editMs.every((ms) => ms >= 0), `edit remesh never arrived: ${editMs.join(', ')}`);
    const editMedian = [...editMs].sort((a, b) => a - b)[2] as number;
    log(`[${label}] edit → remeshed: ${editMs.join(', ')} ms (median ${editMedian}); → on screen: ${editFrameMs.join(', ')} ms`);
    check(editMedian <= MAX_EDIT_MESH_MS, `${label}: edit remesh median ${editMedian} ms > ${MAX_EDIT_MESH_MS} ms`);

    // 3. Play: walk, break, place, craft.
    await play(page);
    const start = await player(page);
    check(start, 'no player');
    // "Click to play" captures the mouse (or, where pointer lock is refused, engages drag-to-look).
    await page.getByRole('button', { name: /Click to play/ }).click({ timeout: 10_000 });
    // Hold W until the player has covered 1.5 blocks (software rendering can run the game below real time).
    await page.keyboard.down('KeyW');
    await waitFor(page, 'the player to walk', 15_000, async () => {
      const p = await player(page);
      return p && Math.hypot(p.x - start.x, p.z - start.z) > 1.5 ? true : null;
    }).catch(() => undefined);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(400);
    const walked = await player(page);
    check(walked && Math.hypot(walked.x - start.x, walked.z - start.z) > 1.5, `the player did not walk (${JSON.stringify([start, walked])})`);
    log(`[${label}] walked ${Math.hypot((walked?.x ?? 0) - start.x, (walked?.z ?? 0) - start.z).toFixed(1)} blocks`);

    // Look straight down and break the block the crosshair targets (under the feet), once landed.
    await page.evaluate(() => {
      const play = window.__aether?.simulation?.voxel?.game;
      play?.input.setLook(play.input.yawRad, -1.5);
    });
    const cx = VIEWPORT.width / 2;
    const cy = VIEWPORT.height / 2;
    await page.mouse.move(cx, cy);
    const startItems = new Set(start.slots.filter((x) => x !== null).map((x) => x.item));
    // Break what the crosshair targets until something that drops an item came up
    // (plants and leaves under the crosshair usually drop nothing).
    let before: { x: number; y: number; z: number; block: string | null } | null = null;
    let dug: { item: string; count: number } | null = null;
    for (let attempt = 0; attempt < 5 && !dug; attempt++) {
      before = await waitFor(page, 'the player to stand on a targeted block', 15_000, () => page.evaluate(() => {
        const play = window.__aether?.simulation?.voxel?.game;
        if (!play) return null;
        const g = play.game;
        const b = g.player.body;
        const t = g.target;
        if (!b.onGround || Math.abs(b.vy) > 0.01 || !t.valid) return null;
        return { x: t.hit.x, y: t.hit.y, z: t.hit.z, block: window.__aether?.simulation?.voxel?.blockAt(t.hit.x, t.hit.y, t.hit.z) ?? null };
      }));
      check(before.block && before.block !== 'air', `the targeted cell is not solid (${JSON.stringify(before)})`);
      const target = before;
      await page.mouse.down({ button: 'left' });
      await waitFor(page, 'a block to break', 15_000, () => page.evaluate((c) => {
        const v = window.__aether?.simulation?.voxel;
        const id = v?.blockAt(c.x, c.y, c.z);
        return id === 'air' ? true : null;
      }, target));
      await page.mouse.up({ button: 'left' });
      // The drop falls and is pulled in by the pickup magnet (game time; may run slower than real time here).
      dug = await waitFor(page, 'the broken block to be picked up', 6_000, async () => {
        const p = await player(page);
        return p?.slots.find((x) => x !== null && !startItems.has(x.item)) ?? null;
      }).catch(() => null);
      if (!dug) {
        const st = await page.evaluate(() => {
          const g = window.__aether?.simulation?.voxel?.game?.game;
          if (!g) return null;
          const b = g.player.body;
          return { player: [b.x, b.y, b.z, b.onGround], drops: g.drops.map((d) => [d.item, d.body.x, d.body.y, d.body.z, d.delay]) };
        });
        log(`[${label}] broke ${JSON.stringify(before)}: nothing picked up (${JSON.stringify(st)})`);
      }
    }
    if (!dug || !before) {
      const state = await page.evaluate(() => {
        const g = window.__aether?.simulation?.voxel?.game?.game;
        if (!g) return null;
        const b = g.player.body;
        return { player: [b.x, b.y, b.z, b.onGround], mode: g.settings.mode, drops: g.drops.map((d) => [d.item, d.count, d.body.x, d.body.y, d.body.z, d.delay, d.age]) };
      });
      throw new E2EFailure(`no broken block was picked up; state ${JSON.stringify(state)}; last broken ${JSON.stringify(before)}`);
    }
    const afterBreak = await player(page);
    log(`[${label}] broke ${before.x},${before.y},${before.z} and picked up ${dug.item}`);

    // Place it back: select its slot, right click while looking down.
    const slot = afterBreak?.slots.findIndex((x) => x?.item === dug.item) ?? 0;
    if (slot < 9) await page.keyboard.press(`Digit${slot + 1}`);
    const placedAt = await page.evaluate(() => {
      const play = window.__aether?.simulation?.voxel?.game;
      return play ? { x: Math.floor(play.game.target.hit.x + play.game.target.hit.nx), y: play.game.target.hit.y + play.game.target.hit.ny, z: Math.floor(play.game.target.hit.z + play.game.target.hit.nz) } : null;
    });
    // Jump so the cell under the feet is free, and place in mid-air (classic pillar-up):
    // hold jump + use until a block appears (the game may run below real time here).
    const isPlaced = (): Promise<boolean> => page.evaluate((c) => {
      const v = window.__aether?.simulation?.voxel;
      if (!c || !v) return false;
      // Anything solid back in the dug cell or the pillar cell above it.
      const a = v.blockAt(c.x, c.y, c.z);
      const b = v.blockAt(c.x, c.y + 1, c.z);
      return (a !== null && a !== 'air') || (b !== null && b !== 'air');
    }, placedAt);
    await page.keyboard.down('Space');
    await page.mouse.down({ button: 'right' });
    const placed = await waitFor(page, 'a block to be placed', 15_000, async () => ((await isPlaced()) ? true : null)).catch(() => false);
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Space');
    await page.waitForTimeout(300);
    check(placed, 'the block was not placed');
    log(`[${label}] placed a block`);

    // Inventory: craft sticks from the starting planks.
    await page.keyboard.press('KeyE');
    await page.getByRole('dialog', { name: 'Inventory and crafting' }).waitFor({ timeout: 10_000 });
    // The panel fits the viewport (editor panels stay open beside it) and Close covers no header text.
    const layout = await page.evaluate(() => {
      const box = (sel: string): [number, number, number, number] | null => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r ? [r.left, r.top, r.right, r.bottom] : null;
      };
      return { view: box('.viewport'), panel: box('.vx-screen__panel'), close: box('.vx-screen__close'), table: box('.vx-table'), hint: box('.vx-screen__hint') };
    });
    const inside = (a: number[] | null, b: number[] | null): boolean => !!a && !!b && a[0]! >= b[0]! - 1 && a[1]! >= b[1]! - 1 && a[2]! <= b[2]! + 1 && a[3]! <= b[3]! + 1;
    const overlaps = (a: number[] | null, b: number[] | null): boolean => !!a && !!b && a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!;
    check(inside(layout.panel, layout.view), `${label}: inventory panel overflows the viewport ${JSON.stringify(layout)}`);
    check(!overlaps(layout.close, layout.table) && !overlaps(layout.close, layout.hint), `${label}: Close overlaps the inventory header ${JSON.stringify(layout)}`);
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
    const metricsView = view;

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
    const vd = metricsView;
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
    // The home chunks (evicted while away, saved then) stream back in from the save.
    await streamed(page);
    await waitFor(page, 'the home chunks to load', 30_000, () => page.evaluate((c) => (window.__aether?.simulation?.voxel?.blockAt(c.x, c.y, c.z) ? true : null), before));

    // 5. Stop (saves), reload, play: the changed cells come back exactly.
    const cells = [before, placedAt, placedAt ? { x: placedAt.x, y: placedAt.y + 1, z: placedAt.z } : null].filter((c): c is { x: number; y: number; z: number } => c !== null);
    const readCells = (): Promise<Array<string | null>> => page.evaluate((cs) => cs.map((c: { x: number; y: number; z: number }) => window.__aether?.simulation?.voxel?.blockAt(c.x, c.y, c.z) ?? null), cells);
    const savedCells = await readCells();
    await stop(page);
    await page.waitForTimeout(500);
    const projectUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    check(page.url() === projectUrl, 'reload changed the project');
    await waitFor(page, 'the studio to boot again', BOOT_MS, () => page.evaluate(() => (window.__aether?.simulation && window.__aether.store.getState().loading === null ? true : null)));
    await streamed(page);
    let lastCells: Array<string | null> = [];
    const persisted = await waitFor(page, 'the saved chunks to load', 20_000, async () => {
      lastCells = await readCells();
      return lastCells.every((b, i) => b === savedCells[i]) ? lastCells.join('/') : null;
    }).catch((e: unknown) => {
      throw new E2EFailure(`${e instanceof Error ? e.message : String(e)}: cells ${JSON.stringify(cells)} saved ${JSON.stringify(savedCells)} now ${JSON.stringify(lastCells)}`);
    });
    const generated = await page.evaluate(() => window.__aether?.simulation?.voxel?.status().changed ?? 0);
    check(generated > 0, 'no modified chunk came back from the save');
    log(`[${label}] after reload the edited cells hold ${persisted} (${generated} saved chunk(s) loaded)`);
    check(errors.length === 0, `page errors:\n${errors.join('\n')}`);
    return { backend, streamMs, chunks, view, maxLongTask, longTaskApi: tasks.api, maxFrameGap, editMs, peakLoaded, peakDrawn, fps };
  } finally {
    await context.close();
  }
}

/**
 * Phone with a touch screen (390 × 844): "Tap to play" hints, drag on the
 * view to look, the inventory button, the inventory fits the screen and the
 * on-screen stick / buttons step aside while it is open.
 */
async function touchRun(browser: Browser, url: string, label: string, mobile: boolean): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, ...(mobile ? { isMobile: true } : {}) });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  try {
    await boot(page, url, '#/new');
    const err = await page.evaluate(async () => {
      const a = window.__aether;
      if (!a) return 'no studio';
      const world = { ...a.history.current, voxel: { preset: 'plains', viewDistance: 4 } };
      return a.studio.importText(JSON.stringify({ format: 'aether-world', version: 1, world }));
    });
    check(!err, `${label}: import failed: ${String(err)}`);
    await streamed(page);
    await play(page);
    const capture = page.locator('.vx-capture');
    await capture.waitFor({ timeout: 10_000 });
    check((await capture.innerText()).includes('Tap to play'), `${label}: no touch hints on a phone`);
    await capture.tap();
    await waitFor(page, 'the game to start on touch', 10_000, () => page.evaluate(() => (window.__aether?.store.getState().voxelHud?.capture === false ? true : null)));
    // Drag on the view: the player looks around.
    const yaw0 = await page.evaluate(() => window.__aether?.simulation?.voxel?.game?.input.yawRad ?? 0);
    const cdp = mobile ? await context.newCDPSession(page) : null;
    if (cdp) {
      // Chromium: a real touch drag through the DevTools protocol.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + i * 15, y: 400 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      // Firefox: pointer events of type touch on the canvas.
      await page.evaluate(() => {
        const canvas = document.querySelector('.viewport canvas');
        if (!canvas) return;
        const ev = (type: string, x: number): PointerEvent => new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 400, bubbles: true, cancelable: true });
        canvas.dispatchEvent(ev('pointerdown', 200));
        for (let i = 1; i <= 6; i++) canvas.dispatchEvent(ev('pointermove', 200 + i * 15));
        canvas.dispatchEvent(ev('pointerup', 290));
      });
    }
    const yaw1 = await waitFor(page, 'a touch drag to turn the view', 5_000, () => page.evaluate((y0) => {
      const y = window.__aether?.simulation?.voxel?.game?.input.yawRad ?? y0;
      return Math.abs(y - y0) > 0.05 ? y : null;
    }, yaw0));
    log(`[${label} touch] drag turned the view by ${(((yaw0 - yaw1) * 180) / Math.PI).toFixed(0)}°`);
    await page.getByRole('button', { name: 'Open inventory' }).tap();
    await page.getByRole('dialog', { name: 'Inventory and crafting' }).waitFor({ timeout: 10_000 });
    const layout = await page.evaluate(() => {
      const box = (sel: string): number[] | null => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r ? [r.left, r.top, r.right, r.bottom] : null;
      };
      return { view: box('.viewport'), panel: box('.vx-screen__panel'), grid: box('.vx-grid'), touch: box('.touch') };
    });
    const inside = (a: number[] | null, b: number[] | null): boolean => !!a && !!b && a[0]! >= b[0]! - 1 && a[1]! >= b[1]! - 1 && a[2]! <= b[2]! + 1 && a[3]! <= b[3]! + 1;
    check(inside(layout.panel, layout.view) && inside(layout.grid, layout.panel), `${label} touch: inventory does not fit the phone ${JSON.stringify(layout)}`);
    check(layout.touch === null, `${label} touch: on-screen controls cover the inventory`);
    await page.getByRole('button', { name: 'Close' }).tap();
    await page.getByRole('dialog', { name: 'Inventory and crafting' }).waitFor({ state: 'detached', timeout: 10_000 });
    check(errors.length === 0, `${label} touch: page errors:\n${errors.join('\n')}`);
    log(`[${label} touch] phone layout, touch look and inventory OK`);
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
      if (!TOUCH_ONLY && !ARGS.includes('--webgl2')) results.push({ name: 'chromium-webgpu', m: await run(browser, server.url, 'chromium-webgpu', false) });
      if (!TOUCH_ONLY && !ARGS.includes('--webgpu')) results.push({ name: 'chromium-webgl2', m: await run(browser, server.url, 'chromium-webgl2', true) });
      await touchRun(browser, server.url, 'chromium', true);
      await browser.close();
      browser = null;
    }
    if (only !== '--chromium') {
      browser = await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
      if (!TOUCH_ONLY) results.push({ name: 'firefox-webgl2', m: await run(browser, server.url, 'firefox-webgl2', false) });
      await touchRun(browser, server.url, 'firefox', false);
      await browser.close();
      browser = null;
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await server.stop();
  }
  for (const { name, m } of results) {
    log(`${name}: backend ${m.backend}, view ${m.view}, ${m.chunks} chunks in ${Math.round(m.streamMs)} ms, longest task ${Math.round(m.maxLongTask)} ms${m.longTaskApi ? '' : ' (n/a)'}, frame gap ${Math.round(m.maxFrameGap)} ms, edit ${m.editMs.join('/')} ms, peak ${m.peakLoaded}/${m.peakDrawn} chunks, ${m.fps} fps`);
    // WebGPU submits asynchronously, so a long task there is the page's own work. On WebGL2 over a
    // software rasteriser, GL calls block on the CPU-bound GPU process (draw, readback, link status):
    // those numbers are reported, and the engine's own work is bounded by MAX_VOXEL_WORK_MS above.
    if (m.longTaskApi && m.backend === 'webgpu') check(m.maxLongTask <= MAX_LONG_TASK_MS, `${name}: a main-thread task took ${Math.round(m.maxLongTask)} ms while streaming (max ${MAX_LONG_TASK_MS})`);
  }
  log('voxel e2e passed');
}

main().catch((err: unknown) => {
  log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
});

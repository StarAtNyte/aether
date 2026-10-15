/**
 * End-to-end check of real-life architecture in real browsers: Chromium
 * (WebGPU, then forced WebGL2) and Firefox (WebGL2), one browser at a time.
 *
 * 1. New project → prompt "a modern two-bedroom apartment" through the chat:
 *    a building arrives, the building bar appears and the view opens as a
 *    cutaway;
 * 2. 3D views from the bar: walls down, x-ray, section cut, daylight study
 *    (golden hour), studio render (ambient occlusion + temporal AA; the
 *    canvas stays non-blank and refinement progresses), back to realtime;
 * 3. the floor plan: one label chip per room, a rectangle room drawn with
 *    the mouse becomes a checked, undoable edit, a door added with the door
 *    tool, both undone;
 * 4. walkthrough: Walk → first person facing the entrance; walk up to the
 *    front door, E opens it, walk in (the player ends up inside); 4 (night),
 *    L (all lights), P (photo mode hides the interface); Esc stops and the
 *    view modes come back.
 *
 * Run: `npm run build && npm run e2e:arch` (`-- --chromium` / `-- --firefox`
 * for one browser, `-- --webgpu` / `-- --webgl2` for one Chromium backend).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const VIEWPORT = { width: 1440, height: 900 };
const BOOT_MS = 60_000;
const AGENT_MS = 120_000;
const ARGS = process.argv.slice(2);
const MIN_CANVAS_STDDEV = 6;
const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];

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

async function canvasStats(page: Page): Promise<{ mean: number; stdDev: number }> {
  const png = await page.locator('.viewport').screenshot();
  return pixelStats(decodePng(png));
}

/** Room entities of the current world. */
function roomCount(page: Page): Promise<number> {
  return page.evaluate(() => Object.values(window.__aether?.history.current.entities ?? {}).filter((e) => e.arch?.role === 'room').length);
}

/** Client coordinates of a plan point on the floor-plan SVG. */
async function planToClient(page: Page, x: number, z: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([px, pz]) => {
      const svg = document.querySelector<SVGSVGElement>('.plan-view__svg');
      const m = svg?.getScreenCTM();
      if (!svg || !m) throw new Error('no plan svg');
      const p = new DOMPoint(px, pz).matrixTransform(m);
      return { x: p.x, y: p.y };
    },
    [x, z] as const,
  );
}

async function run(browser: Browser, url: string, label: string, forceWebGL2: boolean): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  if (forceWebGL2) await context.addInitScript({ content: 'try { delete Navigator.prototype.gpu; } catch {}' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !BENIGN_CONSOLE.some((r) => r.test(m.text()))) errors.push(`console: ${m.text()}`);
  });
  try {
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, 'the studio to boot', BOOT_MS, () =>
      page.evaluate(() => {
        const a = window.__aether;
        const st = a?.store.getState();
        if (st?.fatal) return `fatal: ${st.fatal}`;
        return a && a.simulation !== null && st?.loading === null ? true : null;
      }),
    );
    const backend = await page.evaluate(() => window.__aether?.simulation?.backend ?? '?');
    log(`[${label}] booted on ${backend}`);
    check(!forceWebGL2 || backend === 'webgl2', `[${label}] expected WebGL2, got ${backend}`);

    // 1. Prompt → building, bar, cutaway.
    const input = page.getByLabel('Prompt', { exact: true });
    await input.fill('a modern two-bedroom apartment');
    await input.press('Enter');
    await waitFor(page, 'the building', AGENT_MS, () =>
      page.evaluate(() => {
        const st = window.__aether?.store.getState();
        return st && !st.agentBusy && st.arch.building !== null ? st.arch.building : null;
      }),
    );
    await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
    const bar = page.getByRole('toolbar', { name: 'Building views' });
    await bar.waitFor({ state: 'visible', timeout: 10_000 });
    const opened = await page.evaluate(() => window.__aether?.simulation?.renderer.archViewState.walls);
    check(opened === 'cutaway', `[${label}] the apartment should open as a cutaway, got ${opened}`);
    const rooms = await roomCount(page);
    check(rooms >= 6, `[${label}] expected at least 6 rooms, got ${rooms}`);
    log(`[${label}] apartment: ${rooms} rooms, cutaway view`);

    // 1b. The user's own question about wall decor is answered from the building, not guessed: a generated
    // apartment has no curtain over a door or picture over a window, and the offline planner says so.
    const headBefore = await page.evaluate(() => window.__aether?.history.head ?? '');
    await input.fill('why is the curtain over the door and the painting over the window');
    await input.press('Enter');
    const answer = await waitFor(page, 'the placement answer', AGENT_MS, () =>
      page.evaluate(() => {
        const st = window.__aether?.store.getState();
        const last = st?.chat[st.chat.length - 1];
        return st && !st.agentBusy && last?.role === 'assistant' && last.status === 'done' ? JSON.stringify(last) : null;
      }),
    );
    check(/checked every wall/.test(answer), `[${label}] the placement question should be answered from the walls, got ${answer.slice(0, 300)}`);
    check(!/couldn't map/.test(answer), `[${label}] the offline planner must not give up on the placement question`);
    check((await page.evaluate(() => window.__aether?.history.head ?? '')) === headBefore, `[${label}] a clean building must not be edited by the placement question`);
    log(`[${label}] placement question answered from the wall data`);

    // 2. 3D views.
    await bar.getByRole('button', { name: /^Walls/ }).click();
    await page.getByRole('menuitemradio', { name: 'Walls down' }).or(page.getByRole('menuitemcheckbox', { name: 'Walls down' })).or(page.getByRole('menuitem', { name: 'Walls down' })).first().click();
    await waitFor(page, 'walls down', 5_000, () => page.evaluate(() => window.__aether?.simulation?.renderer.archViewState.walls === 'down'));
    await bar.getByRole('button', { name: 'X-ray' }).click();
    await waitFor(page, 'x-ray', 5_000, () => page.evaluate(() => window.__aether?.simulation?.renderer.archViewState.xray === true));
    await bar.getByRole('button', { name: 'X-ray' }).click();
    await page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'up', section: 1.3 }));
    await waitFor(page, 'the section cut', 5_000, () => page.evaluate(() => window.__aether?.simulation?.renderer.archViewState.section === 1.3));
    await page.evaluate(() => window.__aether?.store.getState().setArch({ section: null, walls: 'cutaway' }));
    await bar.getByRole('button', { name: 'Daylight study' }).click();
    await page.getByRole('button', { name: 'Golden hour' }).click();
    await waitFor(page, 'golden hour', 5_000, () => page.evaluate(() => window.__aether?.store.getState().arch.sunHour === 18.1));
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Studio render' }).click();
    const studio = await waitFor(page, 'the studio render', 30_000, () =>
      page.evaluate(() => {
        const r = window.__aether?.simulation?.renderer;
        const st = window.__aether?.store.getState();
        if (st && !st.arch.studioAvailable) return 'unavailable';
        return r && r.renderQuality === 'studio' && r.refineProgress > 0 ? r.refineProgress : null;
      }),
    );
    check(studio !== 'unavailable', `[${label}] studio render is unavailable`);
    await page.waitForTimeout(1500);
    const still = await canvasStats(page);
    check(still.stdDev >= MIN_CANVAS_STDDEV, `[${label}] studio render looks blank (stddev ${still.stdDev.toFixed(1)})`);
    await bar.getByRole('button', { name: 'Studio render' }).click();
    await waitFor(page, 'realtime render', 10_000, () => page.evaluate(() => window.__aether?.simulation?.renderer.renderQuality === 'realtime'));
    await page.evaluate(() => window.__aether?.store.getState().setArch({ sunHour: null }));
    log(`[${label}] views: walls down, x-ray, section, golden hour, studio render (refine ${(Number(studio) * 100).toFixed(0)}%, stddev ${still.stdDev.toFixed(1)})`);

    // GPU resources stay flat over 20 view / quality cycles (sectioned walls, x-ray, studio pipeline).
    const gpu = (): Promise<{ geometries: number; textures: number; cached: number; materials: number }> =>
      page.evaluate(() => {
        const m = window.__aether!.simulation!.memoryStats();
        return { geometries: m?.geometries ?? 0, textures: m?.textures ?? 0, cached: m?.cachedGeometries ?? 0, materials: m?.materials ?? 0 };
      });
    const cycle = async (): Promise<void> => {
      await page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'down', xray: true, quality: 'studio' }));
      await waitFor(page, 'studio frame', 30_000, () => page.evaluate(() => (window.__aether?.simulation?.renderer.refineProgress ?? 0) > 0 && window.__aether?.simulation?.renderer.renderQuality === 'studio'), 100);
      await page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'cutaway', xray: false, quality: 'realtime' }));
      await page.waitForTimeout(250);
    };
    // The studio pipeline releases its render targets a few frames after it is switched off, later
    // on a loaded machine: read the counts once they have settled (two equal samples, ≤ 10 s).
    const settled = async (): Promise<Awaited<ReturnType<typeof gpu>>> => {
      await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
      let prev = await gpu();
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        const next = await gpu();
        if (JSON.stringify(next) === JSON.stringify(prev)) return next;
        prev = next;
      }
      return prev;
    };
    await cycle();
    const base = await settled();
    for (let i = 0; i < 20; i++) await cycle();
    const after = await settled();
    check(after.textures <= base.textures + 2 && after.geometries <= base.geometries + 8 && after.cached <= base.cached + 4 && after.materials <= base.materials + 4, `[${label}] GPU resources grew over 20 view cycles: ${JSON.stringify(base)} → ${JSON.stringify(after)}`);
    log(`[${label}] 20 view/quality cycles: geometries ${base.geometries}→${after.geometries}, textures ${base.textures}→${after.textures}, cached ${base.cached}→${after.cached}, materials ${base.materials}→${after.materials}`);

    // 3. Floor plan: chips, draw a room, add a door, undo both.
    await bar.getByRole('radio', { name: 'Plan' }).click();
    await page.locator('.plan-view__svg').waitFor({ state: 'visible', timeout: 10_000 });
    const chips = await page.locator('.plan-chip').count();
    check(chips === rooms, `[${label}] expected ${rooms} room labels on the plan, got ${chips}`);
    await page.getByRole('button', { name: 'Rectangle room' }).click();
    // Zoom out so the space beside the building (where the new room goes) is on screen.
    const box = await page.locator('.plan-view__svg').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 2; i++) {
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(150);
      }
    }
    const a = await planToClient(page, 0, 10.6);
    const b = await planToClient(page, 3.6, 13.6);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await waitFor(page, 'the drawn room', 10_000, async () => ((await roomCount(page)) === rooms + 1 ? true : null));
    const passed = await page.evaluate(() => {
      const w = window.__aether?.history.current;
      return w ? Object.values(w.entities).filter((e) => e.arch?.role === 'room').length : 0;
    });
    check(passed === rooms + 1, `[${label}] drawn room missing`);
    await page.getByRole('button', { name: 'Door', exact: true }).click();
    const doorsBefore = await page.evaluate(() => Object.values(window.__aether?.history.current.entities ?? {}).filter((e) => e.arch?.role === 'door' || (e.arch?.role === 'opening' && e.arch.kind === 'opening')).length);
    const wall = await planToClient(page, 5, -0.05);
    await page.mouse.click(wall.x, wall.y);
    await waitFor(page, 'the added door', 10_000, () => page.evaluate((n) => Object.values(window.__aether?.history.current.entities ?? {}).filter((e) => e.arch?.role === 'door' || (e.arch?.role === 'opening' && e.arch.kind === 'opening')).length > n, doorsBefore));
    await page.evaluate(() => {
      window.__aether?.studio.undo();
      window.__aether?.studio.undo();
    });
    await waitFor(page, 'undo', 10_000, async () => ((await roomCount(page)) === rooms ? true : null));
    log(`[${label}] plan: ${chips} labels, drew a room and a door, undone`);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await bar.getByRole('radio', { name: '3D' }).click();
    await page.locator('.plan-view').waitFor({ state: 'detached', timeout: 5_000 });

    // 4. Walkthrough.
    await bar.getByRole('button', { name: 'Walk through' }).click();
    await waitFor(page, 'play mode', 30_000, () => page.evaluate(() => window.__aether?.store.getState().mode === 'play' && window.__aether.studio.arch.walkthrough !== null));
    const view = await page.evaluate(() => ({ cam: window.__aether?.store.getState().cameraView, walls: window.__aether?.simulation?.renderer.archViewState.walls }));
    check(view.cam === 'firstPerson', `[${label}] the walkthrough should start in first person, got ${view.cam}`);
    check(view.walls === 'up', `[${label}] walls should be up while walking, got ${view.walls}`);
    const door = await page.evaluate(() => {
      const w = window.__aether!.history.current;
      const entrance = Object.values(w.entities).find((e) => e.tags.includes('entrance'));
      const doors = Object.values(w.entities).filter((e) => e.arch?.role === 'door' && e.arch.wall === entrance?.arch?.wall);
      return doors[0]?.id ?? null;
    });
    check(door, `[${label}] no front door`);
    await page.locator('.viewport__canvas').focus();
    // Walk up to the door (software rasterizers run at a few frames per second: walk until close).
    const doorDistance = (): Promise<number> =>
      page.evaluate((id) => {
        const w = window.__aether!.history.current;
        const p = window.__aether!.simulation!.playerPosition;
        const e = w.entities[id];
        const b = Object.values(w.entities).find((x) => x.arch?.role === 'building');
        const lvl = e?.parent ? w.entities[e.parent] : undefined;
        if (!p || !e || !b || !lvl) return 99;
        const dx = p[0] - (b.transform.position[0] + lvl.transform.position[0] + e.transform.position[0]);
        const dz = p[2] - (b.transform.position[2] + lvl.transform.position[2] + e.transform.position[2]);
        return Math.hypot(dx, dz);
      }, door);
    await page.keyboard.down('KeyW');
    await waitFor(page, 'the player to reach the door', 20_000, async () => ((await doorDistance()) < 1.45 ? true : null), 100);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the front door to open', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['open'] === true, door));
    const before = await page.evaluate(() => window.__aether?.simulation?.playerPosition?.slice() ?? null);
    // Let the leaf finish its swing (0.85 s of simulated time; software rasterizers step slowly), then walk in.
    const simStart = await page.evaluate(() => window.__aether?.simulation?.logic?.time ?? 0);
    await waitFor(page, 'the door swing', 90_000, () => page.evaluate((t0) => (window.__aether?.simulation?.logic?.time ?? 0) > t0 + 1.2, simStart), 100);
    const insideNow = (): Promise<{ x: number; z: number; inside: boolean } | null> =>
      page.evaluate(() => {
        const w = window.__aether!.history.current;
        const p = window.__aether!.simulation!.playerPosition;
        const b = Object.values(w.entities).find((e) => e.arch?.role === 'building');
        if (!p || !b) return null;
        const plan = b.arch?.plan as { levels: Array<{ rooms: Array<{ rect?: number[] }> }> } | undefined;
        const rects = plan?.levels[0]?.rooms.map((r) => r.rect).filter((r): r is number[] => Array.isArray(r)) ?? [];
        const x = p[0] - b.transform.position[0];
        const z = p[2] - b.transform.position[2];
        return { x, z, inside: rects.some((r) => x > (r[0] as number) + 0.1 && x < (r[2] as number) - 0.1 && z > (r[1] as number) + 0.1 && z < (r[3] as number) - 0.1) };
      });
    await page.keyboard.down('KeyW');
    let inside = await insideNow();
    const walkUntil = performance.now() + 20_000;
    while (!inside?.inside && performance.now() < walkUntil) {
      await page.waitForTimeout(150);
      inside = await insideNow();
    }
    await page.keyboard.up('KeyW');
    check(inside?.inside === true, `[${label}] the player should have walked inside (from ${JSON.stringify(before)} to ${JSON.stringify(inside)})`);
    log(`[${label}] walkthrough: door opened, walked in to (${inside.x.toFixed(1)}, ${inside.z.toFixed(1)})`);
    await page.keyboard.press('Digit4');
    await waitFor(page, 'night', 5_000, () => page.evaluate(() => window.__aether?.studio.arch.walkthrough?.timeOfDay === 22));
    const lit = await page.evaluate(() => window.__aether?.studio.arch.walkthrough?.lightsOn ?? -1);
    check(lit > 0, `[${label}] night should switch the lamps on (${lit})`);
    await page.keyboard.press('KeyL');
    await waitFor(page, 'all lights off', 5_000, () => page.evaluate(() => window.__aether?.studio.arch.walkthrough?.lightsOn === 0));
    await page.keyboard.press('KeyP');
    await waitFor(page, 'photo mode', 5_000, () => page.evaluate(() => document.querySelector('.viewport.is-photo') !== null));
    const photoHud = await page.locator('.walk-hint').count();
    check(photoHud === 0, `[${label}] photo mode should hide the controls`);
    await page.waitForTimeout(1500);
    const night = await canvasStats(page);
    check(night.stdDev >= 3, `[${label}] night walkthrough looks blank (stddev ${night.stdDev.toFixed(1)})`);
    await page.keyboard.press('Escape');
    await waitFor(page, 'edit mode', 30_000, () => page.evaluate(() => window.__aether?.store.getState().mode === 'edit'));
    const back = await page.evaluate(() => ({ walls: window.__aether?.simulation?.renderer.archViewState.walls, photo: window.__aether?.store.getState().arch.photo, quality: window.__aether?.simulation?.renderer.renderQuality }));
    check(back.walls === 'cutaway' && back.photo === false && back.quality === 'realtime', `[${label}] view modes should come back after Stop: ${JSON.stringify(back)}`);
    log(`[${label}] night + lights + photo mode, stopped, cutaway restored`);
    check(errors.length === 0, `[${label}] page errors: ${errors.slice(0, 5).join(' | ')}`);
  } catch (e) {
    // Keep a picture of the failure for diagnosis (outside the repository).
    const shot = join(tmpdir(), `aether-arch-e2e-${label}.png`);
    await page.screenshot({ path: shot }).catch(() => undefined);
    log(`[${label}] failure screenshot: ${shot}`);
    throw e;
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const server = await startServer(log);
  let browser: Browser | null = null;
  const only = ARGS.find((a) => a === '--chromium' || a === '--firefox');
  try {
    if (only !== '--firefox') {
      browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
      if (!ARGS.includes('--webgl2')) await run(browser, server.url, 'chromium-webgpu', false);
      if (!ARGS.includes('--webgpu')) await run(browser, server.url, 'chromium-webgl2', true);
      await browser.close();
      browser = null;
    }
    if (only !== '--chromium') {
      browser = await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
      await run(browser, server.url, 'firefox-webgl2', false);
      await browser.close();
      browser = null;
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await server.stop();
  }
  log('architecture e2e passed');
}

main().catch((err: unknown) => {
  log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
});

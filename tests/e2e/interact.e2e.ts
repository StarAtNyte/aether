/**
 * End-to-end check of interactive rooms in play mode, in real browsers
 * (Chromium WebGPU, forced WebGL2, Firefox WebGL2), one at a time.
 *
 * "a modern two-bedroom apartment" is generated through the chat, then the
 * walkthrough starts and the player aims (crosshair ray) at things:
 * - a kitchen drawer: the prompt reads "E · Open drawer", E slides it out of
 *   the cabinet, E again shuts it;
 * - a cabinet door and the fridge door: E swings them about their hinges and
 *   only the aimed one moves;
 * - the tap: E turns the water on (the stream becomes visible);
 * - a mug on the coffee table: E picks it up (prompt "Drop mug"), a click
 *   throws it across the room, it lands and rests;
 * - the front door and a light switch still work.
 *
 * Run: `npm run build && npm run e2e:interact` (`-- --chromium` / `-- --firefox`
 * for one browser, `-- --webgpu` / `-- --webgl2` for one Chromium backend).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const VIEWPORT = { width: 1280, height: 800 };
const BOOT_MS = 60_000;
const AGENT_MS = 120_000;
const ARGS = process.argv.slice(2);
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

async function waitFor<T>(page: Page, what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>, intervalMs = 150): Promise<T> {
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

/** World centre of an entity's bounds, or null. */
function centreOf(page: Page, id: string): Promise<[number, number, number] | null> {
  return page.evaluate((eid) => {
    const b = window.__aether?.simulation?.entityBounds(eid);
    if (!b) return null;
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as [number, number, number];
  }, id);
}

/** Current pose position of a body in the running physics world. */
function bodyPos(page: Page, id: string): Promise<[number, number, number] | null> {
  return page.evaluate((eid) => {
    const pw = window.__aether?.simulation?.physics;
    if (!pw) return null;
    const p: [number, number, number] = [0, 0, 0];
    const q: [number, number, number, number] = [0, 0, 0, 1];
    return pw.readPose(eid, p, q) ? p : null;
  }, id);
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/** Standing height of the walkthrough player (feet), captured on the first aim. */
let standY: number | null = null;

const prompt = (page: Page): Promise<{ id: string; text: string; hint: string | null } | null> => page.evaluate(() => window.__aether?.store.getState().interact ?? null);

/**
 * Stand about a metre from `id` on whichever side lets the crosshair reach it
 * (the cabinet backs sit against walls) and look at it; resolves with the prompt.
 */
async function aimAt(page: Page, id: string, distanceM = 1.0): Promise<{ id: string; text: string; hint: string | null }> {
  // The body pose is the part's own origin (its front face); the bounds centre of a drawer lies in the cabinet behind it.
  const c = (await bodyPos(page, id)) ?? (await centreOf(page, id));
  check(c, `no pose for ${id}`);
  // Where the player stands: the part's front (its local +Z) first, the compass points as a fallback; feet at the current standing height.
  const floor = standY ?? (standY = await page.evaluate(() => window.__aether?.simulation?.playerPosition?.[1] ?? 0));
  const frontYaw = await page.evaluate((eid) => {
    const pw = window.__aether?.simulation?.physics;
    const p: [number, number, number] = [0, 0, 0];
    const q: [number, number, number, number] = [0, 0, 0, 1];
    return pw && pw.readPose(eid, p, q) ? 2 * Math.atan2(q[1], q[3]) : null;
  }, id);
  const front: Array<readonly [number, number]> = frontYaw === null ? [] : [[Math.sin(frontYaw), Math.cos(frontYaw)], [Math.sin(frontYaw + 0.5), Math.cos(frontYaw + 0.5)], [Math.sin(frontYaw - 0.5), Math.cos(frontYaw - 0.5)]];
  for (const dd of [distanceM, distanceM * 0.75, distanceM * 0.55]) {
    for (const [dx, dz] of [...front, [0, 1], [0, -1], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const) {
      const px = c[0] + dx * dd;
      const pz = c[2] + dz * dd;
      const yaw = (Math.atan2(-(c[0] - px), -(c[2] - pz)) * 180) / Math.PI;
      const pitch = (Math.atan2(c[1] - (floor + 1.55), dd) * 180) / Math.PI;
      const ok = await page.evaluate(([x, y, z, yw, pt]) => window.__aether?.simulation?.placePlayer([x as number, y as number, z as number], yw as number, pt as number) === true, [px, floor + 0.02, pz, yaw, pitch] as const);
      if (!ok) continue;
      // A fresh frame must have looked at the new aim (the prompt is only reported when it changes): wait for a few of them.
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
      await page.waitForTimeout(150);
      const p = await prompt(page);
      if (p && p.id === id) return p;
    }
  }
  const debug = await page.evaluate(() => {
    const sim = window.__aether!.simulation!;
    const m = sim.renderer.camera.matrixWorld.elements;
    const dir: [number, number, number] = [-(m[8] as number), -(m[9] as number), -(m[10] as number)];
    const f = sim.playerPosition;
    const eye: [number, number, number] = f ? [f[0], f[1] + 1.55, f[2]] : [0, 0, 0];
    const o: [number, number, number] = [eye[0] + dir[0] * 0.45, eye[1] + dir[1] * 0.45, eye[2] + dir[2] * 0.45];
    return { feet: f, dir, hits: sim.physics?.raycastAll(o, dir, 4).map((h) => `${h.id}@${h.distance.toFixed(2)}`) };
  });
  throw new E2EFailure(`could not aim at ${id} (centre ${JSON.stringify(c)}); prompt is ${JSON.stringify(await prompt(page))}; last ray ${JSON.stringify(debug)}`);
}

/** The first of `ids` that can be aimed at from standing height in this (randomly laid out) apartment, and its prompt. */
async function firstAimable(page: Page, ids: readonly string[], distanceM: number): Promise<{ id: string; prompt: { id: string; text: string; hint: string | null } }> {
  for (const id of ids) {
    try {
      return { id, prompt: await aimAt(page, id, distanceM) };
    } catch {
      /* hidden behind another piece in this layout: try the next one */
    }
  }
  throw new E2EFailure(`none of ${ids.length} candidates could be aimed at`);
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
    const input = page.getByLabel('Prompt', { exact: true });
    await input.fill('a modern two-bedroom apartment');
    await input.press('Enter');
    await waitFor(page, 'the building', AGENT_MS, () => page.evaluate(() => {
      const st = window.__aether?.store.getState();
      return st && !st.agentBusy && st.arch.building !== null ? true : null;
    }));
    await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
    await page.evaluate(() => {
      window.__aether?.studio.playtest.cancel();
      window.__aether?.studio.playtest.stopReplay();
    });
    const ids = await page.evaluate(() => {
      const w = window.__aether!.history.current;
      const all = Object.values(w.entities);
      const byKind = (kind: string, pred: (id: string) => boolean = () => true): string | null => all.find((e) => e.interact?.kind === kind && pred(e.id))?.id ?? null;
      const fridge = all.find((e) => e.arch?.role === 'part' && /fridge door/i.test(e.name))?.id ?? null;
      const cabinet = all.find((e) => e.arch?.role === 'part' && e.arch.kind === 'door' && /cabinet door/i.test(e.name) && e.behaviors[0]?.type === 'operable')?.id ?? null;
      const mug = all.find((e) => e.interact?.kind === 'pickup' && (e.arch?.kind === 'mug' || e.arch?.kind === 'book'))?.id ?? null;
      // The top drawer of a stack: aiming at the lowest one from standing height clips the handles above it.
      const seat = all.find((e) => e.interact?.kind === 'seat' && (e.arch?.kind === 'sofa' || e.arch?.kind === 'armchair' || e.arch?.kind === 'chair'))?.id ?? null;
      const sash = all.find((e) => e.interact?.kind === 'window')?.id ?? null;
      const front = all.find((e) => e.arch?.role === 'door' && e.tags.includes('entrance'))?.id ?? null;
      const drawers = all.filter((e) => e.interact?.kind === 'drawer').map((e) => e.id).sort((a, b) => Number(/drawer-2$/.test(b)) - Number(/drawer-2$/.test(a)));
      const cabinets = all.filter((e) => e.arch?.role === 'part' && e.arch.kind === 'door' && /cabinet door/i.test(e.name) && e.behaviors[0]?.type === 'operable').map((e) => e.id);
      return { drawers, cabinets, seat, sash, front, drawer: drawers[0] ?? null, cabinet: cabinets[0] ?? null, fridge, tap: byKind('tap'), mug };
    });
    log(`[${label}] interactables: ${JSON.stringify(ids)}`);
    log(`[${label}] kinds: ${JSON.stringify(await page.evaluate(() => { const c: Record<string, number> = {}; for (const e of Object.values(window.__aether!.history.current.entities)) if (e.arch?.kind) c[e.arch.kind] = (c[e.arch.kind] ?? 0) + 1; return c; }))}`);
    check(ids.seat && ids.sash && ids.front && ids.drawer && ids.cabinet && ids.tap && ids.mug, `[${label}] the apartment should have a drawer, cabinet door, fridge door, tap and mug: ${JSON.stringify(ids)}`);

    const ID = ids as { drawers: string[]; cabinets: string[] } & Record<'seat' | 'sash' | 'front' | 'drawer' | 'cabinet' | 'tap' | 'mug', string> & { fridge: string | null };

    // Enter the walkthrough.
    await page.getByRole('toolbar', { name: 'Building views' }).getByRole('button', { name: 'Walk through' }).click();
    await waitFor(page, 'play mode', 30_000, () => page.evaluate(() => window.__aether?.store.getState().mode === 'play' && window.__aether.studio.arch.walkthrough !== null));
    await page.locator('.viewport__canvas').focus();
    await page.waitForTimeout(500);
    standY = null;
    check((await page.locator('[data-testid="interact"] .interact__dot').count()) === 1, `[${label}] the crosshair should be shown in play mode`);

    // Drawer.
    const aimed = await firstAimable(page, ID.drawers, 1.0);
    const drawerId = aimed.id;
    const dShut = await bodyPos(page, drawerId);
    check(dShut, `[${label}] drawer has no body`);
    const dp = aimed.prompt;
    check(/Open/.test(dp.text) && /drawer/i.test(dp.text), `[${label}] drawer prompt: ${dp.text}`);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the drawer to open', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['open'] === true, drawerId));
    const dSimStart = await page.evaluate(() => window.__aether?.simulation?.logic?.time ?? 0);
    await waitFor(page, 'the drawer slide', 90_000, () => page.evaluate((t0) => (window.__aether?.simulation?.logic?.time ?? 0) > t0 + 0.8, dSimStart), 100);
    const dOpen = await bodyPos(page, drawerId);
    check(dOpen && dist(dShut, dOpen) > 0.25, `[${label}] the drawer should slide out (${JSON.stringify(dShut)} -> ${JSON.stringify(dOpen)})`);
    const closing = await aimAt(page, drawerId, 1.3);
    check(closing && /Close/.test(closing.text), `[${label}] aimed at the open drawer the prompt should offer closing: ${closing?.text}`);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the drawer to shut', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['open'] === false, drawerId));
    log(`[${label}] drawer: "${dp.text}" -> slid ${dist(dShut, dOpen).toFixed(2)} m -> closed`);

    // Cabinet door and fridge door: only the aimed one moves.
    const doorTargets: Array<[string, readonly string[]]> = [['cabinet door', ID.cabinets], ['fridge door', ID.fridge ? [ID.fridge] : []]];
    for (const [name, candidates] of doorTargets) {
      if (candidates.length === 0) continue;
      const aimedDoor = await firstAimable(page, candidates, 1.1);
      const id = aimedDoor.id;
      const shut = await bodyPos(page, id);
      check(shut, `[${label}] ${name} has no body`);
      const p = aimedDoor.prompt;
      await page.keyboard.press('KeyE');
      await waitFor(page, `${name} to open`, 10_000, () => page.evaluate((x) => window.__aether?.simulation?.logic?.entityState(x)['open'] === true, id));
      const t0 = await page.evaluate(() => window.__aether?.simulation?.logic?.time ?? 0);
      await waitFor(page, `${name} swing`, 90_000, () => page.evaluate((t) => (window.__aether?.simulation?.logic?.time ?? 0) > t + 1, t0), 100);
      const open = await bodyPos(page, id);
      check(open && dist(shut, open) > 0.1, `[${label}] ${name} should swing (${JSON.stringify(shut)} -> ${JSON.stringify(open)})`);
      const openCount = await page.evaluate(() => {
        const rt = window.__aether!.simulation!.logic!;
        return Object.values(window.__aether!.history.current.entities).filter((e) => e.arch?.role === 'part' && rt.entityState(e.id)['open'] === true).length;
      });
      check(openCount === 1, `[${label}] exactly one part should be open, got ${openCount}`);
      // The leaf has swung away from where it was: aim at it again (the prompt now offers closing).
      const closeP = await aimAt(page, id, 1.1);
      check(/Close/.test(closeP.text), `[${label}] ${name} prompt while open: ${closeP.text}`);
      await page.keyboard.press('KeyE');
      log(`[${label}] ${name}: "${p.text}" swung ${dist(shut, open).toFixed(2)} m`);
      await waitFor(page, `${name} to shut`, 10_000, () => page.evaluate((x) => window.__aether?.simulation?.logic?.entityState(x)['open'] === false, id));
    }

    // A window casement: aimed at, E swings it inward on its hinge; the prompt then offers closing.
    const sashShut = await bodyPos(page, ID.sash);
    check(sashShut, `[${label}] the casement has no body`);
    const wp = await aimAt(page, ID.sash, 1.2);
    check(/Open/.test(wp.text) && /window/.test(wp.text), `[${label}] window prompt: ${wp.text}`);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the window to open', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['open'] === true, ID.sash));
    const w0 = await page.evaluate(() => window.__aether?.simulation?.logic?.time ?? 0);
    await waitFor(page, 'the window swing', 90_000, () => page.evaluate((t) => (window.__aether?.simulation?.logic?.time ?? 0) > t + 1.2, w0), 100);
    const sashOpen = await bodyPos(page, ID.sash);
    check(sashOpen && dist(sashShut, sashOpen) > 0.15, `[${label}] the casement should swing (${JSON.stringify(sashShut)} -> ${JSON.stringify(sashOpen)})`);
    const wc = await aimAt(page, ID.sash, 1.2);
    check(/Close/.test(wc.text), `[${label}] open window prompt: ${wc.text}`);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the window to shut', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['open'] === false, ID.sash));
    log(`[${label}] window: "${wp.text}" swung ${dist(sashShut, sashOpen).toFixed(2)} m`);

    // The front door: a hinged leaf on a physics joint; aimed at, E swings it open on its hinge and again shuts it.
    const yawOf = (id: string): Promise<number | null> =>
      page.evaluate((eid) => {
        const pw = window.__aether?.simulation?.physics;
        const p: [number, number, number] = [0, 0, 0];
        const q: [number, number, number, number] = [0, 0, 0, 1];
        return pw && pw.readPose(eid, p, q) ? (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI : null;
      }, id);
    const yawShut = await yawOf(ID.front);
    check(yawShut !== null, `[${label}] the front door has no body`);
    const fp = await aimAt(page, ID.front, 1.5);
    check(/Open/.test(fp.text) && /door/.test(fp.text), `[${label}] front door prompt: ${fp.text}`);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the front door to open', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['open'] === true, ID.front));
    const f0 = await page.evaluate(() => window.__aether?.simulation?.logic?.time ?? 0);
    await waitFor(page, 'the door swing', 90_000, () => page.evaluate((t) => (window.__aether?.simulation?.logic?.time ?? 0) > t + 2, f0), 100);
    const yawOpen = await yawOf(ID.front);
    const swung = Math.abs((((yawOpen ?? 0) - (yawShut ?? 0) + 540) % 360) - 180);
    check(180 - swung > 60, `[${label}] the front door should swing open on its hinge (${yawShut} -> ${yawOpen})`);
    await aimAt(page, ID.front, 1.5);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the front door to shut', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['open'] === false, ID.front));
    log(`[${label}] front door: "${fp.text}" swung ${(180 - swung).toFixed(0)} deg on its joint`);

    // Tap.
    const tp = await aimAt(page, ID.tap, 0.9);
    check(/Turn on/.test(tp.text), `[${label}] tap prompt: ${tp.text}`);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the tap to run', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['on'] === true, ID.tap));
    log(`[${label}] tap: "${tp.text}" -> running`);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the tap to stop', 10_000, () => page.evaluate((id) => window.__aether?.simulation?.logic?.entityState(id)['on'] === false, ID.tap));

    // Mug: pick up, carry, throw.
    const mugStart = await bodyPos(page, ID.mug);
    check(mugStart, `[${label}] mug has no body`);
    const mp = await aimAt(page, ID.mug, 0.9);
    check(/Pick up/.test(mp.text), `[${label}] mug prompt: ${mp.text}`);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the mug to be carried', 10_000, async () => {
      const p = await prompt(page);
      return p && /Drop/.test(p.text) && p.hint === 'Click · Throw' ? true : null;
    });
    // Turn on the spot: the carried mug swings round to stay in front of the player.
    const feetRaw = await page.evaluate(() => window.__aether?.simulation?.playerPosition?.slice() ?? null);
    check(feetRaw, `[${label}] no player`);
    const feet = feetRaw as [number, number, number];
    // Some directions are blocked by the counter or a wall (the prop is held short of it): any free one proves it follows.
    let carried: [number, number, number] | null = null;
    let hold: [number, number, number] = [0, 0, 0];
    let followed = false;
    for (const yaw of [137, 227, 317, 47]) {
      await page.evaluate(([x, y, z, yw]) => window.__aether?.simulation?.placePlayer([x as number, y as number, z as number], yw as number, -10), [feet[0], feet[1], feet[2], yaw] as const);
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      hold = [feet[0] - Math.sin((yaw * Math.PI) / 180) * 1.1, feet[1] + 1.4, feet[2] - Math.cos((yaw * Math.PI) / 180) * 1.1];
      // A software rasterizer steps the simulation slowly: give the mug a few seconds to swing round.
      for (let waited = 0; waited < 6000; waited += 300) {
        await page.waitForTimeout(300);
        carried = await bodyPos(page, ID.mug);
        if (carried && dist(carried, hold) < 0.6) break;
      }
      if (carried && dist(carried, hold) < 0.6) {
        followed = true;
        break;
      }
    }
    check(followed && carried, `[${label}] the carried mug should follow the aim point (at ${JSON.stringify(carried)}, expected near ${JSON.stringify(hold)})`);
    const canvasBox = await page.locator('.viewport__canvas').boundingBox();
    check(canvasBox, `[${label}] no canvas`);
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    const t1 = await page.evaluate(() => window.__aether?.simulation?.logic?.time ?? 0);
    await waitFor(page, 'the throw to land', 90_000, () => page.evaluate((t) => (window.__aether?.simulation?.logic?.time ?? 0) > t + 2, t1), 100);
    const landed = await bodyPos(page, ID.mug);
    check(landed && dist(landed, carried) > 1, `[${label}] the thrown mug should fly (${JSON.stringify(carried)} -> ${JSON.stringify(landed)})`);
    check(landed[1] > -0.1, `[${label}] the mug fell through the floor (${landed[1]})`);
    const after = await prompt(page);
    check(after === null || !/Drop/.test(after.text), `[${label}] nothing should be carried after the throw`);
    log(`[${label}] mug: picked up, carried, thrown ${dist(landed, carried).toFixed(1)} m`);

    // Sitting: E on a sofa or chair seats the player (capsule off, eye lowered); walking input stands them up in front of it.
    const sp = await aimAt(page, ID.seat, 1.3);
    check(/Sit on/.test(sp.text), `[${label}] seat prompt: ${sp.text}`);
    const eyeStanding = await page.evaluate(() => window.__aether?.simulation?.renderer.camera.position.y ?? 0);
    await page.keyboard.press('KeyE');
    await waitFor(page, 'the player to sit', 10_000, () => page.evaluate(() => window.__aether?.simulation?.isSitting === true));
    // The seated eye arrives with the next drawn frames (a software rasterizer draws a few per second).
    await waitFor(page, 'the eye to drop', 30_000, () => page.evaluate((y) => ((window.__aether?.simulation?.renderer.camera.position.y ?? y) < y - 0.3 ? true : null), eyeStanding), 200).catch(() => undefined);
    const eyeSeated = await page.evaluate(() => window.__aether?.simulation?.renderer.camera.position.y ?? 0);
    check(eyeSeated < eyeStanding - 0.3, `[${label}] the eye should drop when sitting (${eyeStanding.toFixed(2)} -> ${eyeSeated.toFixed(2)})`);
    const stand = await prompt(page);
    check(stand && /Stand up/.test(stand.text), `[${label}] sitting prompt: ${stand?.text}`);
    await page.keyboard.down('KeyW');
    await waitFor(page, 'the player to stand', 10_000, () => page.evaluate(() => window.__aether?.simulation?.isSitting === false));
    await page.keyboard.up('KeyW');
    log(`[${label}] seat: "${sp.text}", eye ${eyeStanding.toFixed(2)} -> ${eyeSeated.toFixed(2)} m, stood up by walking`);

    await page.keyboard.press('Escape');
    await waitFor(page, 'edit mode', 30_000, () => page.evaluate(() => window.__aether?.store.getState().mode === 'edit'));
    check(errors.length === 0, `[${label}] page errors: ${errors.slice(0, 5).join(' | ')}`);
  } catch (e) {
    const shot = join(tmpdir(), `aether-interact-e2e-${label}.png`);
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
  log('interaction e2e passed');
}

main().catch((err: unknown) => {
  log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
});

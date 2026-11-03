/**
 * Plays Kestrel Outpost (the arena shooter template) in a real browser, start to game over and back.
 *
 * Opening the template must go straight into play mode with the game's title card (a `launch` template). The driver
 * presses Play, then fights through the studio's own controls: it turns the camera onto the nearest raider
 * (`setLook`, computed from the play camera's eye), holds the trigger (`setVirtualFire`), strafes, and reloads with R.
 * It checks that the wave counter advances, raiders die, the player's health drops when they are hit and the HUD shows
 * ammunition; then it stops firing and stands in the open until the game is lost, and restarts from the game-over
 * screen (back to the title card). Then the published game: a share link opened in the standalone player, with the
 * weapon HUD, a fight to the game-over screen and its score, and the touch Fire button. Screenshots of each stage are written to the output folder.
 *
 * Run: `STATIC_DIR=<built studio> npx tsx tests/e2e/outpost.e2e.ts [--out=<dir>]`
 * (`AETHER_E2E_GPU=1` for the machine's GPU; software GL by default). The driver counts game seconds, so a slow
 * renderer takes longer instead of failing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { validateWorld } from '@aether/core';
import { encodeShare } from '../../apps/studio/src/publish/share';
import { CHROME_ARGS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const OUT_ARG = ARGS.find((a) => a.startsWith('--out='));
const OUT = resolve(OUT_ARG ? OUT_ARG.slice(6) : join(REPO_ROOT, 'gameplay-out', 'outpost'));
const SLUG = 'kestrel-outpost';
const VIEWPORT = { width: 1280, height: 720 };
const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i, /Failed to load resource/i];
const WALL_CAP_MS = Number(process.env['AETHER_OUTPOST_WALL_CAP_MS'] ?? 25 * 60_000);

const started = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - started) / 1000).toFixed(1).padStart(7)}s] ${line}\n`);
}

class Failure extends Error {
  override name = 'OutpostFailure';
}
function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Failure(message);
}

interface Snap {
  mode: string;
  status: string;
  intro: boolean;
  hud: Record<string, string>;
  combat: { ammo: number; reserve: number; reloading: boolean; hits: number; kills: number } | null;
  time: number;
  text: string;
  score?: number;
  best?: number;
}

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const st = window.__aether?.store.getState();
    const g = st?.game;
    const c = st?.combat ?? null;
    return {
      mode: st?.mode ?? '',
      status: g?.status ?? '',
      intro: g?.intro ?? false,
      hud: { ...(g?.hud ?? {}) },
      combat: c ? { ammo: c.ammo, reserve: c.reserve, reloading: c.reloading, hits: c.hits, kills: c.kills } : null,
      time: window.__aether?.simulation?.logic?.time ?? 0,
      text: g?.text ?? '',
      ...(g?.score !== undefined ? { score: g.score } : {}),
      ...(g?.best !== undefined ? { best: g.best } : {}),
    };
  });
}

/**
 * Fight for `gameSeconds` (or until `until` holds, or the game ends). Returns what was seen: the highest wave, the most
 * kills, the lowest health and how many shots were fired.
 */
async function fight(page: Page, gameSeconds: number, fire: boolean, until: string): Promise<{ wave: number; kills: number; minHealth: number; shots: number; status: string; elapsed: number }> {
  await page.evaluate('window.__name = (f) => f');
  return page.evaluate(
    async ({ budget, fire, until, wallCap }) => {
      const a = window.__aether;
      const sim = a?.simulation;
      if (!a || !sim) throw new Error('no simulation');
      const logic = (): NonNullable<typeof sim.logic> => sim.logic as NonNullable<typeof sim.logic>;
      const num = (k: string): number => Number(logic().readState(k));
      const t0 = logic().time;
      const w0 = performance.now();
      let wave = 0;
      let kills = 0;
      let minHealth = 100;
      let strafe = 1;
      let strafeT = 0;
      let lastT = t0;
      while (performance.now() - w0 < wallCap) {
        const st = a.store.getState().game;
        if (st.status !== 'playing') break;
        const t = logic().time;
        if (t - t0 > budget) break;
        wave = Math.max(wave, num('wave'));
        kills = Math.max(kills, num('kills'));
        minHealth = Math.min(minHealth, num('health'));
        if (until === 'wave2' && wave >= 2 && kills >= 3) break;
        const eye = sim.viewRay.origin;
        let best: { x: number; y: number; z: number; d: number } | null = null;
        for (const b of logic().npcs.brains) {
          if (b.dead || b.spec.faction !== 'raiders') continue;
          const d = Math.hypot(b.x - eye[0], b.z - eye[2]);
          if (!best || d < best.d) best = { x: b.x, y: b.feetY + b.spec.height * 0.6, z: b.z, d };
        }
        if (fire && best && best.d < 45) {
          const dx = best.x - eye[0];
          const dy = best.y - eye[1];
          const dz = best.z - eye[2];
          const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
          const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
          sim.setLook(yaw, pitch);
          sim.setVirtualFire(true);
        } else sim.setVirtualFire(false);
        // A little side-to-side movement while fighting, standing still otherwise.
        if (t - strafeT > 1.6) {
          strafeT = t;
          strafe = -strafe;
        }
        sim.setVirtualStick(0, fire ? strafe * 0.6 : 0);
        if (fire && sim.weapon && sim.weapon.ammo === 0 && sim.weapon.reserve > 0 && !sim.weapon.reloading) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r' }));
        if (t !== lastT) lastT = t;
        await new Promise((r) => setTimeout(r, 30));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', key: 'r' }));
      }
      sim.setVirtualFire(false);
      sim.setVirtualStick(0, 0);
      return { wave, kills, minHealth, shots: sim.weapon?.shots ?? 0, status: a.store.getState().game.status, elapsed: logic().time - t0 };
    },
    { budget: gameSeconds, fire, until, wallCap: WALL_CAP_MS },
  );
}

/** Play the published game (share link → /play): weapon HUD, a fight, the game-over screen with the score, touch fire. */
async function publishedPlayer(browser: Browser, url: string, errors: string[]): Promise<Record<string, unknown>> {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/studio/public/templates/worlds', `${SLUG}.json`), 'utf8')) as { world: unknown };
  const v = validateWorld(raw.world);
  check(v.ok, 'the template world is valid');
  const share = await encodeShare(v.world, { title: 'Kestrel Outpost' });
  check(share.fits, 'the world fits a share link');
  const link = `${url}/play#w=${share.value}`;
  const out: Record<string, unknown> = {};
  for (const touch of [false, true]) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`player pageerror: ${e.message}`));
    try {
      await page.goto(link, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('pl-title').waitFor({ timeout: 240_000 });
      await page.waitForFunction(() => window.__aetherPlayer?.phase === 'title', null, { timeout: 120_000 });
      await page.evaluate(() => window.__aetherPlayer?.start());
      await page.waitForFunction(() => window.__aetherPlayer?.phase === 'playing', null, { timeout: 60_000 });
      await page.waitForSelector('[data-testid="combat-hud"]', { timeout: 30_000 });
      const ammo0 = (await page.getByTestId('combat-ammo').textContent()) ?? '';
      check(/30\s*\/\s*150/.test(ammo0.replace(/[^0-9/ ]/g, ' ')), `the player's weapon HUD shows a full magazine (${ammo0})`);
      if (touch) {
        const fire = page.getByTestId('touch-fire');
        check(await fire.isVisible(), 'the touch Fire button shows');
        const box = await fire.boundingBox();
        check(box !== null, 'the Fire button has a box');
        await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
        // A held press: pointerdown, a moment, pointerup.
        await fire.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true });
        await page.waitForTimeout(700);
        await fire.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
        const shots = await page.evaluate(() => window.__aetherPlayer?.simulation?.weapon?.shots ?? 0);
        check(shots > 0, `touch Fire shoots (${shots} shots)`);
        // Let the scene finish drawing before the picture.
        await page.waitForFunction(() => window.__aetherPlayer?.simulation?.renderer.animating === false, null, { timeout: 60_000, polling: 500 }).catch(() => undefined);
        await page.waitForTimeout(3000);
        await page.screenshot({ path: join(OUT, '8-player-touch.png') });
        out['touchShots'] = shots;
        continue;
      }
      // Fight until a raider is down, then stand in the open until the game is lost.
      await page.evaluate('window.__name = (f) => f');
      const end = await page.evaluate(async (wallCap) => {
        const h = window.__aetherPlayer;
        const sim = h?.simulation;
        if (!h || !sim) throw new Error('no player simulation');
        const w0 = performance.now();
        let kills = 0;
        while (performance.now() - w0 < wallCap && h.phase === 'playing') {
          kills = Number(sim.logic?.readState('kills') ?? 0);
          const eye = sim.viewRay.origin;
          let best: { x: number; y: number; z: number; d: number } | null = null;
          for (const b of sim.logic?.npcs.brains ?? []) {
            if (b.dead || b.spec.faction !== 'raiders') continue;
            const d = Math.hypot(b.x - eye[0], b.z - eye[2]);
            if (!best || d < best.d) best = { x: b.x, y: b.feetY + b.spec.height * 0.6, z: b.z, d };
          }
          if (best && (kills < 2 || best.d < 80)) {
            const dx = best.x - eye[0];
            const dy = best.y - eye[1];
            const dz = best.z - eye[2];
            sim.setLook((Math.atan2(-dx, -dz) * 180) / Math.PI, (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI);
            // Two raiders down: stop shooting and walk into the rest, so the game ends quickly.
            sim.setVirtualFire(kills < 2 && best.d < 45);
            sim.setVirtualStick(kills >= 2 ? 1 : 0, 0);
          } else sim.setVirtualFire(false);
          await new Promise((r) => setTimeout(r, 30));
        }
        sim.setVirtualFire(false);
        sim.setVirtualStick(0, 0);
        return { phase: h.phase, kills };
      }, WALL_CAP_MS);
      await page.waitForTimeout(1200);
      check(end.phase === 'over', `the published game ended (${end.phase})`);
      check(end.kills >= 1, `raiders died in the published game (${end.kills})`);
      const score = page.locator('[data-testid="game-over-score"]');
      await score.waitFor({ timeout: 10_000 });
      out['gameOver'] = { ...end, score: await score.textContent() };
      await page.screenshot({ path: join(OUT, '7-player-game-over.png') });
      log(`published player: ${JSON.stringify(out['gameOver'])}`);
    } finally {
      await ctx.close();
    }
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const errors: string[] = [];
  const result: Record<string, unknown> = {};
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    // The integrated GPU draws through WebGL2 (its only WebGPU adapter would be the software one).
    if (process.env['GEN_GPU'] === 'intel') await context.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !BENIGN_CONSOLE.some((re) => re.test(m.text()))) errors.push(`console: ${m.text().slice(0, 200)}`);
    });

    // 1. Opening the template launches the game: play mode with the title card, no click on Play in the editor.
    log(`opening ${SLUG}…`);
    await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 240_000, polling: 250 });
    const card = page.locator('.title-card');
    await card.waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 120_000, polling: 500 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    const title = (await card.locator('.title-card__title').textContent()) ?? '';
    const button = ((await card.locator('.title-card__start').textContent()) ?? '').trim();
    check(title.includes('Kestrel Outpost'), `title card shows "${title}"`);
    check(button === 'Play', `the start button reads "${button}"`);
    check((await card.locator('.title-card__controls li').count()) >= 4, 'the title card lists the controls');
    await page.screenshot({ path: join(OUT, '1-start-screen.png') });
    log(`start screen: "${title}", button "${button}"`);
    const early = await page.locator('.toast__text').allTextContents();
    check(!early.some((t) => /Raiders are moving/.test(t)), `the welcome message showed under the title card (${early.join(' | ')})`);

    // 2. Play.
    await card.locator('.title-card__start').click();
    await card.waitFor({ state: 'detached', timeout: 15_000 });
    await page.locator('.toast__text', { hasText: 'Raiders are moving' }).first().waitFor({ timeout: 20_000 });
    log('the welcome message shows after Play');
    await page.waitForSelector('[data-testid="combat-hud"]', { timeout: 30_000 });
    const s0 = await snap(page);
    check(s0.combat !== null && s0.combat.ammo === 30, `the weapon HUD shows a full magazine (${JSON.stringify(s0.combat)})`);
    check(s0.hud['health'] === '100', `health starts at 100 (${s0.hud['health']})`);
    const camMode = await page.evaluate(() => (window.__aether?.simulation?.renderer as unknown as { rig: { mode: string } }).rig.mode);
    log(`camera mode: ${camMode}`);
    log(`playing: HUD ${JSON.stringify(s0.hud)}, combat ${JSON.stringify(s0.combat)}`);

    // 3. Fight until the second wave is on and raiders have died.
    const shotTimer = setInterval(() => void page.screenshot({ path: join(OUT, '2-gameplay.png') }).catch(() => undefined), 20_000);
    let f: Awaited<ReturnType<typeof fight>>;
    try {
      f = await fight(page, 240, true, 'wave2');
    } finally {
      clearInterval(shotTimer);
    }
    // The HUD refreshes a few times a second: let it catch up with the game state.
    await page.waitForTimeout(800);
    const s1 = await snap(page);
    log(`fight: ${JSON.stringify(f)}; HUD ${JSON.stringify(s1.hud)}; combat ${JSON.stringify(s1.combat)}`);
    await page.screenshot({ path: join(OUT, '2-gameplay.png') });
    await page.screenshot({ path: join(OUT, '3-hud.png'), clip: { x: 0, y: 0, width: VIEWPORT.width, height: 90 } });
    await page.screenshot({ path: join(OUT, '3-hud-weapon.png'), clip: { x: VIEWPORT.width - 420, y: VIEWPORT.height - 200, width: 420, height: 200 } });
    check(f.kills >= 3, `raiders died (${f.kills} kills)`);
    check(f.wave >= 2, `the wave counter advanced (wave ${f.wave})`);
    check(f.shots > 0 && s1.combat !== null && s1.combat.hits > 0, `shots landed (${f.shots} fired, ${s1.combat?.hits} hits)`);
    check(Number(s1.hud['wave']) >= 2, `the HUD shows wave ${s1.hud['wave']}`);
    result['fight'] = f;

    // 4. Stop shooting and stand in the open: the raiders bring the player (or the relay) down.
    log('ceasefire: waiting for the raiders to win…');
    const g = await fight(page, 400, false, '');
    await page.waitForTimeout(1200);
    const s2 = await snap(page);
    log(`end: ${JSON.stringify(g)}; status ${s2.status} "${s2.text}" score ${s2.score} best ${s2.best}`);
    check(Math.min(f.minHealth, g.minHealth) < 100, `health dropped when hit (lowest ${Math.min(f.minHealth, g.minHealth)})`);
    check(s2.status === 'lost', `the game was lost (status ${s2.status})`);
    const over = page.locator('.game-over');
    await over.waitFor({ timeout: 10_000 });
    check((await over.locator('h2').textContent())?.includes('Game over'), 'the game-over screen shows');
    check(await page.locator('[data-testid="game-over-score"]').count(), 'the game-over screen shows the score');
    await page.screenshot({ path: join(OUT, '4-game-over.png') });
    result['end'] = { ...g, text: s2.text, score: s2.score, best: s2.best };

    // 5. Restart from the game-over screen: a fresh game (wave 0, full health, a full magazine).
    await over.locator('.btn--primary').click();
    await page.waitForFunction(() => window.__aether?.store.getState().game.status === 'playing' && window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
    // Restart returns to the title card: the new run starts on Play.
    const again = page.locator('.title-card__start');
    await again.waitFor({ timeout: 30_000 });
    const heldTime = await page.evaluate(() => window.__aether?.simulation?.logic?.time ?? -1);
    check(heldTime === 0, `the restarted game waits on its title card (game time ${heldTime})`);
    await page.screenshot({ path: join(OUT, '5-restart-title.png') });
    await again.click();
    await page.waitForFunction(() => (window.__aether?.simulation?.logic?.time ?? 0) > 1.5, null, { timeout: 120_000, polling: 250 });
    await page.waitForTimeout(800);
    const s3 = await snap(page);
    log(`restart: HUD ${JSON.stringify(s3.hud)} combat ${JSON.stringify(s3.combat)}`);
    check(s3.status === 'playing', 'the restarted game is running');
    check(Number(s3.hud['health'] ?? 0) === 100, `health is back to 100 (${s3.hud['health']})`);
    check(Number(s3.hud['wave'] ?? 9) <= 1 && Number(s3.hud['score'] ?? 1) === 0, `the waves and score start over (${JSON.stringify(s3.hud)})`);
    await page.screenshot({ path: join(OUT, '6-restarted.png') });
    result['restart'] = s3.hud;

    // 6. The published game: the same world through a share link, in the standalone player.
    await context.close();
    result['player'] = await publishedPlayer(browser, server.url, errors);

    check(errors.length === 0, `page errors: ${errors.slice(0, 4).join(' | ')}`);
    log('OUTPOST OK');
    writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (e) {
    writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), errors, ...result }, null, 2));
    throw e;
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});

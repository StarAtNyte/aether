/**
 * Plays the shipped games to their win screen in a real browser, with the real character controller.
 *
 * For each game the verified-playable bot first plays it headless in Node (the same sealed-proof run the
 * player shows as "Sealed playable"); its recorded walk becomes the route. A page-side driver then plays
 * the game in Chromium through the on-screen controls (`setVirtualStick`, `turnBy`, `tapVirtual`): it
 * steers at the route with look-ahead, jumps where the route climbs, presses E where the bot pressed a
 * key, and gives up on a point it cannot reach for several seconds. The test passes when the game's own
 * win screen state (`game.status === "won"`) is reached, with no page errors.
 *
 * Games that need a conversation or a lift (Hollow Gate, Lantern Isles, Orbital Lab) are won by the
 * Node-side hand-written bots (`apps/studio/test/showcasePlaytest.test.ts`) and by the verified bot's
 * sealed replay; the real-time driver here covers the walking games.
 *
 * Run: `npm run build && npx tsx tests/e2e/gameplay.e2e.ts [--out=<dir>] [slug…]` (`AETHER_E2E_GPU=1` for the
 * machine's GPU). Real time: about the length of each game (2-3 minutes for Highland Trail) on a GPU; the driver
 * runs on the game clock, so software GL on a loaded machine is slower, not failing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { validateWorld } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { playtest } from '@aether/playtest';
import { createRouteFollower } from '@aether/playtest/route';
import { CHROME_ARGS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const OUT_ARG = ARGS.find((a) => a.startsWith('--out='));
const OUT = resolve(OUT_ARG ? OUT_ARG.slice(6) : join(REPO_ROOT, 'gameplay-out'));
const SLUGS = ARGS.filter((a) => !a.startsWith('--'));
/** The games the page-side driver can walk to the end. */
const WALKING_GAMES = ['highland-trail', 'neon-rain-city', 'kyoto-temple'];
const VIEWPORT = { width: 1280, height: 720 };
/**
 * Wall-clock limits of one drive, for a page that stops ticking rather than a slow one (software GL on a loaded machine runs
 * Highland Trail at about a tenth of real time): the whole drive, and a game clock that has not moved at all.
 */
const WALL_CAP_MS = Number(process.env.AETHER_GAMEPLAY_WALL_CAP_MS ?? 30 * 60_000);
const STALL_MS = 60_000;
const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];

const started = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - started) / 1000).toFixed(1).padStart(7)}s] ${line}\n`);
}

class Failure extends Error {
  override name = 'GameplayFailure';
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Failure(message);
}

interface Route {
  /** Feet positions along the verified run, one every ~0.25 s. */
  points: Array<[number, number, number]>;
  /** Where the bot picked something up or reached the goal (route index and the thing's position): the driver walks right up to these. */
  visits: Array<{ idx: number; at: [number, number, number] }>;
  /** Seconds into the run at which a key press ("E") happened (the bot's press objectives). */
  seconds: number;
  /** The bot's final objective is a key press: press E at the end of the route. */
  pressAtEnd: boolean;
}

async function routeOf(slug: string): Promise<Route> {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/studio/public/templates/worlds', `${slug}.json`), 'utf8')) as { world: unknown };
  const v = validateWorld(raw.world);
  check(v.ok, `${slug}: invalid world`);
  const report = await playtest(v.world, { trace: true });
  check(report.status === 'passed' && report.trace !== undefined, `${slug}: the verified bot did not pass (${report.summary})`);
  const t = report.trace as NonNullable<typeof report.trace>;
  const points: Array<[number, number, number]> = [];
  const STEP = 3;
  for (let i = 0; i < t.frames; i += STEP) points.push([t.poses[i * 4] as number, t.poses[i * 4 + 1] as number, t.poses[i * 4 + 2] as number]);
  // The run ends on the tick the win fired: walk on into the goal itself.
  const goal = t.events.find((e) => e.kind === 'goal');
  if (goal) points.push([goal.position[0], goal.position[1], goal.position[2]], [goal.position[0], goal.position[1], goal.position[2]]);
  const visits = t.events
    .filter((e) => e.kind === 'pickup' || e.kind === 'goal')
    .map((e) => ({ idx: Math.min(points.length - 1, Math.round(e.t / t.dt / STEP)), at: [e.position[0], e.position[1], e.position[2]] as [number, number, number] }));
  return { points, visits, seconds: report.seconds, pressAtEnd: report.objectives.some((o) => o.kind === 'press') };
}

/**
 * The page-side driver: a {@link createRouteFollower} rebuilt in the page, fed the player's position, control heading
 * and the game clock, its commands applied through the on-screen controls. It acts once per game tick and counts game
 * seconds, so a slow frame rate (software GL, a loaded machine) slows the run down instead of breaking the steering.
 * Resolves with the outcome.
 */
async function drive(
  page: Page,
  route: Route,
  budgetSeconds: number,
  wallCapMs: number,
): Promise<{ status: string; time: number; elapsed: number; wallMs: number; stuck: number; at: number[]; log: string[] }> {
  // tsx keeps function names with a helper the page does not have.
  await page.evaluate('window.__name = (f) => f');
  // Evaluated through the debugging protocol, which the page's CSP (no 'unsafe-eval') does not cover.
  await page.evaluate(`window.__aetherRouteFollower = (${createRouteFollower.toString()});`);
  return page.evaluate(
    async ({ points, visits, pressAtEnd, budget, wallCap, stall }) => {
      const sim = window.__aether?.simulation;
      const store = window.__aether?.store;
      if (!sim || !store) throw new Error('no simulation');
      const make = (window as unknown as { __aetherRouteFollower: typeof createRouteFollower }).__aetherRouteFollower;
      const follower = make({ points, visits, pressAtEnd });
      const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
      // Which way does turnBy turn the heading? The control heading answers at once.
      const h0 = sim.playerHeading();
      sim.turnBy(8);
      const sign = wrap(sim.playerHeading() - h0) > 0 ? 1 : -1;
      sim.turnBy(-8);
      const w0 = performance.now();
      let lastTime = Number.NaN;
      let lastTick = w0;
      while (follower.elapsed < budget && performance.now() - w0 < wallCap && performance.now() - lastTick < stall) {
        const st = store.getState().game;
        if (st.status !== 'playing') break;
        const p = sim.playerPosition;
        const time = sim.logic?.time;
        if (time !== undefined && time !== lastTime) {
          lastTime = time;
          lastTick = performance.now();
        }
        if (p && time !== undefined) {
          const cmd = follower.step({ pos: [p[0], p[1], p[2]], heading: sim.playerHeading(), time });
          if (cmd.turn !== 0) sim.turnBy(sign * cmd.turn);
          sim.setVirtualStick(cmd.stick, 0);
          if (cmd.jump) sim.tapVirtual('Space');
          if (cmd.press) sim.tapVirtual('KeyE');
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      sim.setVirtualStick(0, 0);
      const end = store.getState().game;
      const q = sim.playerPosition;
      return { status: end.status, time: end.time, elapsed: follower.elapsed, wallMs: performance.now() - w0, stuck: follower.stuck, at: q ? [q[0], q[1], q[2]] : [], log: [...follower.log] };
    },
    { points: route.points, visits: route.visits, pressAtEnd: route.pressAtEnd, budget: budgetSeconds, wallCap: wallCapMs, stall: STALL_MS },
  );
}

async function playGame(page: Page, url: string, slug: string, route: Route): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
    },
    null,
    { timeout: 120_000, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 120_000, polling: 500 }).catch(() => undefined);
  await page.evaluate(() => void window.__aether?.studio.togglePlay());
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
  const card = page.locator('.title-card');
  await card.waitFor({ timeout: 30_000 });
  check((await card.locator('.title-card__title').textContent())?.length, `${slug}: the title card has no title`);
  await page.screenshot({ path: join(OUT, `${slug}-1-title.png`) });
  await card.locator('.title-card__start').dispatchEvent('click');
  await card.waitFor({ state: 'detached', timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${slug}-2-start.png`) });
  const hud0 = await page.evaluate(() => window.__aether?.store.getState().game.hud ?? {});
  check(Object.keys(hud0).length > 0, `${slug}: no HUD while playing`);

  // Game seconds: twice the bot's time (the driver walks up to each pickup and recovers from misses). The wall-clock cap
  // only stops a frozen page; a slow renderer is allowed to take its time.
  const budget = Math.max(120, route.seconds * 2.2);
  log(`  ${slug}: driving ${route.points.length} route points (the bot won in ${route.seconds.toFixed(0)} s)…`);
  const shotTimer = setInterval(() => void page.screenshot({ path: join(OUT, `${slug}-3-mid.png`) }).catch(() => undefined), Math.round((route.seconds * 1000) / 2));
  let end: Awaited<ReturnType<typeof drive>>;
  try {
    end = await drive(page, route, budget, WALL_CAP_MS);
  } finally {
    clearInterval(shotTimer);
  }
  for (const line of end.log) log(`    ${line}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${slug}-4-end.png`) });
  log(`  ${slug}: ${end.status} after ${end.elapsed.toFixed(0)} game s in ${(end.wallMs / 1000).toFixed(0)} s (${end.stuck} unstick nudges), at ${end.at.map((v) => v.toFixed(0)).join(', ')}`);
  check(end.status === 'won', `${slug}: the game was not won (status ${end.status}, at ${end.at.join(', ')})`);
  const over = await page.evaluate(() => window.__aether?.store.getState().game.text ?? '');
  check(over.length > 0, `${slug}: the win screen has no text`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await initPhysics();
  const games = (SLUGS.length > 0 ? SLUGS : WALKING_GAMES).filter((s) => WALKING_GAMES.includes(s));
  const routes = new Map<string, Route>();
  for (const slug of games) {
    routes.set(slug, await routeOf(slug));
    log(`${slug}: verified route of ${(routes.get(slug) as Route).points.length} points`);
  }
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const failures: string[] = [];
  try {
    for (const slug of games) {
      // The driver acts once per game tick, but a long frame is still several physics steps of one stick input, so a machine
      // under heavy load can miss a jump on a footbridge. The route is verified in the bot's own deterministic run; a miss is
      // retried once on a fresh page before it counts as a failure.
      let lastError = '';
      let passed = false;
      for (let attempt = 1; attempt <= 2 && !passed; attempt++) {
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
        await context.addInitScript({ content: SKIP_FIRST_RUN });
        const errors: string[] = [];
        try {
          const page = await context.newPage();
          page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
          page.on('console', (m) => {
            if (m.type() === 'error' && !BENIGN_CONSOLE.some((re) => re.test(m.text()))) errors.push(`console: ${m.text().slice(0, 200)}`);
          });
          await playGame(page, server.url, slug, routes.get(slug) as Route);
          check(errors.length === 0, `${slug}: ${errors.slice(0, 4).join(' | ')}`);
          log(`PASS ${slug}${attempt > 1 ? ` (second attempt; the first: ${lastError.slice(0, 120)})` : ''}`);
          passed = true;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          log(`${attempt < 2 ? 'RETRY' : 'FAIL'} ${slug}: ${lastError}`);
        } finally {
          await context.close();
        }
      }
      if (!passed) failures.push(`${slug}: ${lastError}`);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ games, failures }, null, 2));
  if (failures.length > 0) {
    process.stderr.write(`${failures.length} game(s) not won:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  log(`GAMEPLAY OK: ${games.join(', ')}`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});

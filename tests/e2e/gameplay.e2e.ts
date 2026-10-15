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
 * machine's GPU). Real time: about the length of each game (2-3 minutes for Highland Trail).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { validateWorld } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { playtest } from '@aether/playtest';
import { CHROME_ARGS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const OUT_ARG = ARGS.find((a) => a.startsWith('--out='));
const OUT = resolve(OUT_ARG ? OUT_ARG.slice(6) : join(REPO_ROOT, 'gameplay-out'));
const SLUGS = ARGS.filter((a) => !a.startsWith('--'));
/** The games the page-side driver can walk to the end. */
const WALKING_GAMES = ['highland-trail', 'neon-rain-city', 'kyoto-temple'];
const VIEWPORT = { width: 1280, height: 720 };
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

/** The page-side driver: steer at the route, jump where it climbs, press E at the end when asked. Resolves with the outcome. */
async function drive(page: Page, route: Route, budgetMs: number): Promise<{ status: string; time: number; stuck: number; at: number[]; log: string[] }> {
  // tsx keeps function names with a helper the page does not have.
  await page.evaluate('window.__name = (f) => f');
  return page.evaluate(
    async ({ points, visits, pressAtEnd, budget }) => {
      const sim = window.__aether?.simulation;
      const store = window.__aether?.store;
      if (!sim || !store) throw new Error('no simulation');
      const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
      // Which way does turnBy turn? Calibrate once on the camera heading.
      const h0 = sim.cameraHeading();
      sim.turnBy(8);
      await new Promise((r) => setTimeout(r, 120));
      const sign = wrap(sim.cameraHeading() - h0) > 0 ? 1 : -1;
      sim.turnBy(-8 * sign);
      let idx = 0;
      let lastJump = 0;
      let lastPress = 0;
      let stuckCount = 0;
      const trace: string[] = [];
      let lastLog = 0;
      let watchT = performance.now();
      let watchP = sim.playerPosition ? [...sim.playerPosition] : [0, 0, 0];
      const t0 = performance.now();
      let lastVisitLog = 0;
      const done = new Set<number>();
      const stopSince = new Map<number, number>();
      while (performance.now() - t0 < budget) {
        const now0 = performance.now();
        const st = store.getState().game;
        if (st.status !== 'playing') break;
        const p = sim.playerPosition;
        if (!p) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        // Advance past points we are close to, then aim a little ahead.
        // Stops on the route (pickups, the goal): walk right up to the thing itself, hopping, until it is taken or 4 s pass.
        const stop = visits.find((v) => Math.abs(v.idx - idx) <= 1 && !done.has(v.idx));
        if (stop) {
          if (!stopSince.has(stop.idx)) stopSince.set(stop.idx, now0);
          const near = Math.hypot(stop.at[0] - p[0], stop.at[2] - p[2]);
          if (near < 0.45 || now0 - (stopSince.get(stop.idx) as number) > 4000) {
            done.add(stop.idx);
          }
        }
        const visit = stop !== undefined && !done.has(stop.idx);
        if (visit && now0 - lastVisitLog > 1500) {
          lastVisitLog = now0;
          trace.push(`  visit idx=${idx} at ${p.map((v) => v.toFixed(1)).join(',')} thing ${stop!.at.map((v) => v.toFixed(1)).join(',')} hud=${JSON.stringify(st.hud)}`);
        }
        const radius = 0.7;
        while (!visit && idx < points.length - 1 && Math.hypot((points[idx] as number[])[0]! - p[0], (points[idx] as number[])[2]! - p[2]) < radius && Math.abs((points[idx] as number[])[1]! - p[1]) < 2.5) idx++;
        const aim = visit ? (stop!.at as number[]) : (points[Math.min(points.length - 1, idx + 1)] as number[]);
        const dx = aim[0]! - p[0];
        const dz = aim[2]! - p[2];
        const dist = Math.hypot(dx, dz);
        // cameraHeading() is the mirror of the bearing the bot uses (0 = −Z, positive turns left).
        const want = -(Math.atan2(-dx, -dz) * 180) / Math.PI;
        const diff = wrap(want - sim.cameraHeading());
        if (dist > 0.25) sim.turnBy(sign * Math.max(-30, Math.min(30, diff)));
        sim.setVirtualStick(Math.abs(diff) > 70 ? 0.1 : dist < 0.8 && idx >= points.length - 1 ? 0 : 1, 0);
        const now = performance.now();
        if ((aim[1]! - p[1] > 0.55 || (visit && dist < 1.5)) && now - lastJump > 700) {
          sim.tapVirtual('Space');
          lastJump = now;
        }
        if (pressAtEnd && idx >= points.length - 3 && now - lastPress > 500) {
          sim.tapVirtual('KeyE');
          lastPress = now;
        }
        // Stuck: hardly moved in 2.5 s on a route that keeps going: jump and skip a point.
        if (now - watchT > 2500) {
          if (Math.hypot(p[0] - watchP[0]!, p[2] - watchP[2]!) < 0.4 && idx < points.length - 1) {
            stuckCount++;
            sim.tapVirtual('Space');
            idx = Math.min(points.length - 1, idx + 2);
          }
          watchT = now;
          watchP = [...p];
        }
        if (now - lastLog > 15_000) {
          lastLog = now;
          trace.push(`t=${Math.round((now - t0) / 1000)}s idx=${idx}/${points.length} pos=${p.map((v) => Math.round(v)).join(',')} hud=${JSON.stringify(st.hud)}`);
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      sim.setVirtualStick(0, 0);
      const end = store.getState().game;
      const q = sim.playerPosition;
      return { status: end.status, time: end.time, stuck: stuckCount, at: q ? [q[0], q[1], q[2]] : [], log: trace };
    },
    { points: route.points, visits: route.visits, pressAtEnd: route.pressAtEnd, budget: budgetMs },
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

  const budget = Math.max(120_000, route.seconds * 1000 * 2.2);
  log(`  ${slug}: driving ${route.points.length} route points (the bot won in ${route.seconds.toFixed(0)} s)…`);
  const shotTimer = setInterval(() => void page.screenshot({ path: join(OUT, `${slug}-3-mid.png`) }).catch(() => undefined), Math.round((route.seconds * 1000) / 2));
  let end: Awaited<ReturnType<typeof drive>>;
  try {
    end = await drive(page, route, budget);
  } finally {
    clearInterval(shotTimer);
  }
  for (const line of end.log) log(`    ${line}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${slug}-4-end.png`) });
  log(`  ${slug}: ${end.status} after ${end.time.toFixed(0)} s (${end.stuck} unstick nudges), at ${end.at.map((v) => v.toFixed(0)).join(', ')}`);
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
        log(`PASS ${slug}`);
      } catch (e) {
        failures.push(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
        log(`FAIL ${slug}: ${failures[failures.length - 1]}`);
      } finally {
        await context.close();
      }
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

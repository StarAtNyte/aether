/**
 * Demo clips of bundled worlds, recorded from the real studio in real time (no compositing, no mock-ups): a visitor walking
 * and driving Lisbon Hills, and Kepler Base being brought back online. Each clip is one browser, one take.
 *
 *   GEN_GPU=intel npx tsx scripts/demo/clips.ts --scene=kepler|lisbon [--out=<dir>] [--url=http://localhost:5176]
 *
 * The integrated-GPU path is WebGL2 (the simulation keeps real time); WebGPU on this machine falls to a software adapter and the
 * simulation crawls, so it is switched off the way scripts/demo/record.ts does. The player is placed with the studio's own
 * `placePlayer` (the guided-tour hook) at the foot of each thing to do; walking, jumping, switching and driving are real input.
 */
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome } from '../../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SCENE = arg('scene') ?? 'kepler';
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/clips'));
const URL = arg('url') ?? 'http://localhost:5176';
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];

type Vec3 = [number, number, number];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Yaw (degrees, 0 faces -Z, positive turns left) that looks from `from` toward `to` on the ground plane. */
const yawTo = (from: Vec3, to: Vec3): number => (Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])) * 180) / Math.PI;

/** Stand at `feet` looking at `look`: yaw toward it and pitch up or down to the point from an eye 1.6 m above the feet. */
async function place(page: Page, feet: Vec3, look: Vec3): Promise<void> {
  const yaw = yawTo(feet, look);
  const pitch = (Math.atan2(look[1] - (feet[1] + 1.6), Math.hypot(look[0] - feet[0], look[2] - feet[2])) * 180) / Math.PI;
  await page.evaluate(([f, y, pi]) => (window as unknown as { __aether: { simulation: { placePlayer(f: number[], y: number, p: number): boolean } } }).__aether.simulation.placePlayer(f as number[], y as number, pi as number), [feet, yaw, pitch] as const);
}

async function act(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __aether: { simulation: { tapVirtual(c: string): void } } }).__aether.simulation.tapVirtual('KeyE'));
}

async function view(page: Page, v: 'follow' | 'firstPerson'): Promise<void> {
  await page.evaluate((x) => (window as unknown as { __aether: { simulation: { setCameraView(v: string): void } } }).__aether.simulation.setCameraView(x), v);
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}

async function entityPos(page: Page, id: string): Promise<Vec3> {
  return page.evaluate((i) => (window as unknown as { __aether: { history: { current: { entities: Record<string, { transform: { position: number[] } }> } } } }).__aether.history.current.entities[i]!.transform.position as Vec3, id);
}

async function open(page: Page, slug: string): Promise<void> {
  await page.goto(`${URL}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const a = (window as unknown as { __aether?: { simulation: unknown; store: { getState(): { loading: unknown } }; history: { current: { entities: object } } } }).__aether;
    return !!a && a.simulation !== null && a.store.getState().loading === null && Object.keys(a.history.current.entities).length > 0;
  }, null, { timeout: 180_000, polling: 500 });
  await sleep(6000);
}

async function play(page: Page): Promise<void> {
  await page.locator('button.play-btn').first().click();
  await page.waitForFunction(() => (window as unknown as { __aether?: { store: { getState(): { mode: string } } } }).__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
  await sleep(3000);
  await page.getByRole('button', { name: /^Start/ }).first().click({ timeout: 3000 }).catch(() => undefined);
  await sleep(1500);
}

/** Kepler Base: the base has no power; switch on the three arrays, walk into the command dome, send the distress call. */
async function kepler(page: Page): Promise<void> {
  await open(page, 'kepler-base');
  await sleep(4000);
  await play(page);
  await sleep(3000);
  await hold(page, 'w', 3500);
  // The crosshair has to be on the switch, so the three switches are used from the player's own eyes.
  await view(page, 'firstPerson');
  for (const id of ['sw-1', 'sw-2', 'sw-3']) {
    const p = await entityPos(page, id);
    const feet: Vec3 = [p[0] - 1.4, p[1] - 0.8, p[2]];
    await place(page, feet, p);
    await sleep(1200);
    await act(page);
    await sleep(2800);
  }
  await sleep(2500);
  await view(page, 'follow');
  const cc = await entityPos(page, 'comms-console');
  const dome = await entityPos(page, 'dome-command');
  await place(page, [dome[0] + 14, 1, dome[2]], dome);
  await sleep(800);
  await hold(page, 'w', 3600);
  await sleep(600);
  await view(page, 'firstPerson');
  await place(page, [cc[0] + 1.5, cc[1] - 0.68, cc[2]], cc);
  await sleep(1200);
  await act(page);
  await sleep(5000);
}

/** Lisbon Hills: a walk up a street and along the quay. */
async function lisbon(page: Page): Promise<void> {
  await open(page, 'lisbon-hills');
  await sleep(3000);
  await play(page);
  await sleep(3000);
  await hold(page, 'w', 6000);
  await hold(page, 'd', 1200);
  await hold(page, 'w', 5000);
  await hold(page, 'w', 4000);
  await sleep(1500);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const tmp = join(OUT, `.take-${SCENE}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: { width: W, height: H } } });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => process.stdout.write(`pageerror: ${e.message.slice(0, 200)}\n`));
    if (SCENE === 'kepler') await kepler(page);
    else if (SCENE === 'lisbon') await lisbon(page);
    else throw new Error(`unknown scene ${SCENE} (kepler | lisbon)`);
    await page.screenshot({ path: join(OUT, `${SCENE}-last.png`) });
    await ctx.close();
    const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
    if (webm) renameSync(join(tmp, webm), join(OUT, `${SCENE}.webm`));
    process.stdout.write(`${join(OUT, `${SCENE}.webm`)}\n`);
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

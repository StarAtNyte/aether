/**
 * Product demo recorder: drives the real studio (the built app served by the Aether server) through the demo scenes
 * and records one raw take per scene group plus a timeline of captions, titles, cuts and speed ramps.
 * `compose.ts` turns those into the final mp4.
 *
 *   npm run build
 *   GEN_GPU=intel npx tsx scripts/demo/record.ts [--scene=villa,photo,game] [--out=<dir>] [--size=1280x720] [--ai=offline|live]
 *
 * Scenes:
 *   villa  home page, a prompt builds a two-storey villa, a chat edit with a diff and Undo, walk mode through a lit room
 *   photo  the "Rooms rebuilt from a photo" examples, one opened and walked
 *   generate  the whole generation of one prompt (--prompt="..."): prompt typed on the home page, the agent building in the
 *             chat and viewport as it happens (speed ramp over the wait, never cut), a short walk of the result
 *   game   a coin game: the bot's verified-playable badge and replay, a few seconds of play, the Publish hub and share link
 *
 * AI honesty: by default (`--ai=offline`) the app runs with the offline planner (the server starts with the mock
 * provider), which only knows a fixed set of themes. Each scene that uses it says so on screen. `--ai=live` records
 * against an already running local app with a connected AI (`AETHER_E2E_URL=http://127.0.0.1:<port>`, started with
 * `npx aether start`) and uses the open-ended prompts in LIVE_PROMPTS; it does not add the offline note.
 *
 * The take runs in real time on whatever GPU the browser gets (integrated GPU with GEN_GPU=intel, or software GL).
 * Slow waits are not hidden by jump cuts: they are marked as speed ramps and the final video says "x8" on them.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { CHROME_ARGS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, startServer } from '../../tests/e2e/support/env';
import { OVERLAY_SCRIPT, Recorder, click, cursor, dwell, glide, hidePhoto, hold, turn, hover, ring, showPhoto, sleep, type, zoomTo } from './lib';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/raw'));
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];
const LIVE = (arg('ai') ?? 'offline') === 'live';
const SCENES = (arg('scene') ?? 'villa,photo,game').split(',').filter(Boolean);

/** Prompts for a live AI (any wording); the offline planner only understands its fixed themes. */
const LIVE_PROMPTS = { villa: 'a two-storey modern house with a pool, open-plan living room, kitchen and two bedrooms' };
const VILLA_PROMPT = LIVE ? LIVE_PROMPTS.villa : 'a two-storey villa with a pool';
const GENERATE_PROMPT = arg('prompt') ?? LIVE_PROMPTS.villa;
const GAME_PROMPT = 'a coin collecting game on a tropical island';
const OFFLINE_NOTE = 'Built by the offline planner (no AI connected), recorded in real time';

const log = (m: string): void => void process.stdout.write(`${m}\n`);

async function newTake(browser: Awaited<ReturnType<typeof chromium.launch>>, name: string, dir: string): Promise<{ ctx: BrowserContext; page: Page; rec: Recorder }> {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  // The integrated GPU path is WebGL2 (60 fps); WebGPU on this machine falls to a software adapter at a few fps.
  if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
  await ctx.addInitScript({ content: OVERLAY_SCRIPT });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
  const rec = new Recorder(name, LIVE ? 'live AI' : 'offline planner, recorded');
  return { ctx, page, rec };
}

async function finish(ctx: BrowserContext, page: Page, rec: Recorder, name: string): Promise<void> {
  rec.save(join(OUT, `${name}.json`));
  const video = page.video();
  await ctx.close();
  const src = await video?.path();
  if (src) {
    const dst = join(OUT, `${name}.webm`);
    rmSync(dst, { force: true });
    renameSync(src, dst);
  }
  log(`${name}: raw take saved (${rec.now() / 1000} s of video)`);
}

/** Wait for the renderer to have the world (bounded: a stuck sync must not hang the take). */
const synced = (page: Page): Promise<unknown> =>
  page.evaluate(async () => Promise.race([(window as unknown as { __aether: { simulation: { whenSynced(): Promise<void> } } }).__aether.simulation.whenSynced(), new Promise((r) => setTimeout(r, 60_000))]));

/** Wait for the editor's light bake to finish (the page is busy and the picture barely moves while it runs). */
const settle = (page: Page, ms = 120_000): Promise<unknown> =>
  page.waitForFunction(() => !/Baking light/.test(document.body.innerText), null, { timeout: ms, polling: 300 }).catch(() => undefined);

const idle = (page: Page, ms = 240_000): Promise<unknown> =>
  page.waitForFunction(() => { const s = window.__aether?.store.getState(); return !!s && !s.agentBusy && s.loading === null; }, null, { timeout: ms, polling: 250 });

/** Wait for the editor to be fully up (renderer attached, scene loaded, agent idle). */
async function editorReady(page: Page): Promise<void> {
  await page.waitForFunction(() => { const a = window.__aether; const s = a?.store.getState(); return !!a && a.simulation !== null && s?.loading === null && !s.agentBusy; }, null, { timeout: 240_000, polling: 250 });
  await synced(page);
}

async function typePrompt(page: Page, selector: string, text: string): Promise<void> {
  const box = page.locator(selector).first();
  await click(page, box, 800);
  await type(page, text);
  await sleep(500);
}

// ---------------------------------------------------------------------------------------------------------------
// villa: home, build, refine, walk
// ---------------------------------------------------------------------------------------------------------------

async function villa(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string): Promise<void> {
  const { ctx, page, rec } = await newTake(browser, 'villa', join(OUT, 'tmp-villa'));
  const boot = rec.now();
  await page.goto(`${base}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-prompt').waitFor({ timeout: 90_000 });
  await dwell(page, 2500);
  rec.cut(boot);

  // 1. Home
  rec.title('Describe a world');
  rec.caption('Type what you want in plain words');
  await glide(page, 640, 360, 500);
  await hover(page, page.locator('.hero-bar').first(), 900);
  await sleep(600);
  await typePrompt(page, '#hero-prompt', VILLA_PROMPT);
  await sleep(500);
  if (!LIVE) rec.note(OFFLINE_NOTE);
  const before = rec.now();
  const opened = /#\/p\/[a-z0-9]+/;
  for (let i = 0; i < 8 && !opened.test(page.url()); i++) {
    await page.keyboard.press('Enter');
    await page.waitForURL(opened, { timeout: 4_000 }).catch(() => undefined);
  }
  await page.waitForURL(opened, { timeout: 30_000 });
  const prep = rec.now();
  await page.waitForFunction(() => (window.__aether?.store.getState().chat.length ?? 0) > 0, null, { timeout: 90_000, polling: 100 }).catch(() => undefined);
  rec.cut(prep);

  // 2. Build (real time; the wait is marked and sped up, never cut)
  rec.title('Aether builds it');
  rec.caption(LIVE ? 'The AI plans, places and checks its own work' : 'The planner places rooms, stairs, doors and furniture', { note: false });
  await editorReady(page);
  await idle(page);
  await synced(page);
  rec.ramp(before, 7000);
  await dwell(page, 3500);
  await page.waitForFunction(() => { const p = window.__aether?.store.getState().playtest as { status?: string } | undefined; return !p || (p.status !== 'running'); }, null, { timeout: 120_000, polling: 500 }).catch(() => undefined);
  const bake0 = rec.now();
  await settle(page);
  rec.ramp(bake0, 2500);
  rec.caption('Rooms, doors and stairs that work, checked automatically');
  await hover(page, page.getByRole('toolbar', { name: 'Building views' }), 800).catch(() => undefined);
  await dwell(page, 2500);

  // 3. Refine by chat
  rec.title('Refine by chat');
  rec.caption('Keep talking to it: small edits, not a rebuild');
  await page.evaluate(() => (window as unknown as { __aether: { store: { getState(): { showLeftView(v: string): void } } } }).__aether.store.getState().showLeftView('agent'));
  const prompt = page.getByLabel('Prompt', { exact: true });
  await click(page, prompt, 800);
  await type(page, 'make the sofa dark green');
  await sleep(400);
  const head = await page.evaluate(() => window.__aether?.history.head ?? -1);
  await page.keyboard.press('Enter');
  await page.waitForFunction((h) => (window.__aether?.history.head ?? -1) !== h || window.__aether?.store.getState().agentBusy === true, head, { timeout: 30_000, polling: 100 });
  await idle(page);
  await dwell(page, 1800);
  rec.caption('Every edit is a one-line diff you can undo');
  await page.screenshot({ path: join(OUT, 'dbg-refine.png') });
  const undo = page.getByRole('button', { name: /^Undo/ }).first();
  if (await undo.count()) await ring(page, undo, 1800).catch(() => undefined);
  await sleep(800);

  // 4. Walk through
  rec.title('Walk through it');
  rec.caption('Step inside: doors open, lights switch, people live there', { high: true });
  const walk = page.getByRole('button', { name: 'Walk through' });
  await click(page, walk, 900);
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
  await cursor(page, false);
  await dwell(page, 1500);
  await hold(page, 'w', 2600);
  await sleep(300);
  await hold(page, 'ArrowLeft', 700);
  await hold(page, 'w', 2200);
  await sleep(300);
  await page.keyboard.press('e');
  await sleep(1200);
  await hold(page, 'ArrowRight', 900);
  await hold(page, 'w', 1800);
  await hold(page, 'ArrowRight', 500);
  await hold(page, 'w', 1200);
  await sleep(1500);
  await page.screenshot({ path: join(OUT, 'dbg-walk.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: 30_000 });
  await cursor(page, true);
  await sleep(1000);
  await sleep(1500);
  await finish(ctx, page, rec, 'villa');
}

// ---------------------------------------------------------------------------------------------------------------
// photo: example rooms rebuilt from a photograph
// ---------------------------------------------------------------------------------------------------------------

async function photo(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string): Promise<void> {
  const { ctx, page, rec } = await newTake(browser, 'photo', join(OUT, 'tmp-photo'));
  const boot = rec.now();
  await page.goto(`${base}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-prompt').waitFor({ timeout: 90_000 });
  await dwell(page, 1500);
  rec.cut(boot);
  rec.title('Start from a photo');
  rec.caption('Give it a photo and it rebuilds the room', { top: true });
  await click(page, page.getByRole('button', { name: 'Templates' }).or(page.getByRole('link', { name: 'Templates' })).first(), 800);
  const section = page.locator('[aria-labelledby="h-photo"]');
  await section.waitFor({ timeout: 30_000 });
  await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await dwell(page, 1500);
  const card = section.locator('.template-card, .card, article').first();
  rec.note('Saved examples: rooms an AI rebuilt earlier from credited photos, not generated live');
  rec.caption('Example rooms rebuilt from credited photographs', { top: true });
  await page.screenshot({ path: join(OUT, 'dbg-photo-home.png') });
  await hover(page, card, 900);
  await dwell(page, 2200);
  await click(page, card, 700);
  const loading = rec.now();
  await page.waitForURL(/#\/p\//, { timeout: 30_000 });
  await editorReady(page);
  await sleep(600);
  rec.cut(loading);
  const photoFile = join(REPO_ROOT, 'tests/fixtures/photo/bedroom-cc0-hotel.jpg');
  await showPhoto(page, `data:image/jpeg;base64,${readFileSync(photoFile).toString('base64')}`, 'Source photo: Markus Spiske, CC0');
  rec.caption('The room rebuilt from that photo: real walls, windows, furniture');
  await dwell(page, 5500);
  await hidePhoto(page);
  rec.title('Walk it');
  rec.caption('Walk in, open doors, change it by chat', { high: true });
  await click(page, page.getByRole('button', { name: 'Walk through' }), 800);
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
  await cursor(page, false);
  await dwell(page, 1500);
  log(`  yaw after turning: ${await turn(page, 180, 1800)}`);
  await sleep(600);
  await hold(page, 'w', 1300);
  await turn(page, -75, 1800);
  await sleep(500);
  await turn(page, 130, 3000);
  await sleep(600);
  await page.screenshot({ path: join(OUT, 'dbg-photo-room.png') });
  await dwell(page, 1200);
  await finish(ctx, page, rec, 'photo');
}

// ---------------------------------------------------------------------------------------------------------------
// game: verified playable, play, publish
// ---------------------------------------------------------------------------------------------------------------

async function game(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string): Promise<void> {
  const { ctx, page, rec } = await newTake(browser, 'game', join(OUT, 'tmp-game'));
  const boot = rec.now();
  await page.goto(`${base}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-prompt').waitFor({ timeout: 90_000 });
  await dwell(page, 1500);
  rec.cut(boot);
  rec.title('Games that prove they work');
  rec.caption('Same prompt box, now a game');
  await typePrompt(page, '#hero-prompt', GAME_PROMPT);
  if (!LIVE) rec.note(OFFLINE_NOTE);
  const before = rec.now();
  const opened = /#\/p\/[a-z0-9]+/;
  for (let i = 0; i < 8 && !opened.test(page.url()); i++) {
    await page.keyboard.press('Enter');
    await page.waitForURL(opened, { timeout: 4_000 }).catch(() => undefined);
  }
  await page.waitForURL(opened, { timeout: 30_000 });
  const prep = rec.now();
  await page.waitForFunction(() => (window.__aether?.store.getState().chat.length ?? 0) > 0, null, { timeout: 90_000, polling: 100 }).catch(() => undefined);
  rec.cut(prep);
  await editorReady(page);
  await idle(page);
  rec.ramp(before, 5000);
  rec.caption('A bot plays the level on a forked physics world');
  const pill = page.getByTestId('playtest-pill');
  await pill.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => { const p = window.__aether?.store.getState().playtest as { status?: string } | undefined; return !!p && p.status !== 'running' && p.status !== 'idle'; }, null, { timeout: 300_000, polling: 500 });
  await sleep(800);
  rec.caption('The badge only turns green after a real winning run');
  await ring(page, pill, 2600);
  await page.getByTestId('replay-bar').waitFor({ timeout: 60_000 }).catch(() => undefined);
  rec.caption('Watch the bot’s winning run replayed over the world');
  await dwell(page, 4500);
  await page.screenshot({ path: join(OUT, 'dbg-game.png') });

  rec.title('Play it yourself');
  rec.caption('Now play it with the keyboard', { high: true });
  await click(page, page.locator('button.play-btn').first(), 800);
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
  await cursor(page, false);
  await sleep(1500);
  await hold(page, 'w', 2500);
  await hold(page, 'd', 900);
  await hold(page, 'w', 2500);
  await hold(page, 'a', 700);
  await hold(page, 'w', 2000);
  await page.screenshot({ path: join(OUT, 'dbg-game-play.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: 30_000 });
  await cursor(page, true);
  await sleep(800);

  rec.title('Publish and share');
  rec.caption('Publish: a link, a game build, a video, a 3D model');
  await click(page, page.getByRole('button', { name: 'Publish' }).first(), 800);
  await page.getByTestId('publish-hub').waitFor({ timeout: 15_000 });
  await dwell(page, 2000);
  await click(page, page.getByTestId('publish-target-share'), 700);
  await page.waitForFunction(() => (document.querySelector<HTMLInputElement>('[data-testid="publish-share-link"]')?.value ?? '').includes('#w='), null, { timeout: 30_000 });
  rec.caption('A share link that plays the world: no upload needed');
  await dwell(page, 3500);
  await page.screenshot({ path: join(OUT, 'dbg-publish.png') });
  await finish(ctx, page, rec, 'game');
}

// ---------------------------------------------------------------------------------------------------------------
// generate: one prompt, the whole build on camera
// ---------------------------------------------------------------------------------------------------------------

async function generate(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string): Promise<void> {
  const { ctx, page, rec } = await newTake(browser, 'generate', join(OUT, 'tmp-generate'));
  const boot = rec.now();
  await page.goto(`${base}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-prompt').waitFor({ timeout: 90_000 });
  await dwell(page, 2000);
  rec.cut(boot);

  rec.title('Describe a world');
  rec.caption('One prompt');
  await typePrompt(page, '#hero-prompt', GENERATE_PROMPT);
  if (!LIVE) rec.note(OFFLINE_NOTE);
  const started = rec.now();
  const opened = /#\/p\/[a-z0-9]+/;
  for (let i = 0; i < 8 && !opened.test(page.url()); i++) {
    await page.keyboard.press('Enter');
    await page.waitForURL(opened, { timeout: 4_000 }).catch(() => undefined);
  }
  await page.waitForURL(opened, { timeout: 30_000 });

  rec.title('Aether builds it');
  rec.caption(LIVE ? 'The AI plans, places and checks its own work' : 'The planner places the pieces', { note: false });
  await editorReady(page);
  await idle(page, 1_800_000);
  await synced(page);
  rec.ramp(started, 12000);
  await dwell(page, 3000);
  const bake0 = rec.now();
  await settle(page);
  rec.ramp(bake0, 2500);

  rec.title('Walk through it');
  const walk = page.getByRole('button', { name: 'Walk through' });
  await click(page, walk, 900);
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
  await cursor(page, false);
  await dwell(page, 1500);
  await hold(page, 'w', 3500);
  await hold(page, 'ArrowLeft', 700);
  await hold(page, 'w', 3000);
  await page.screenshot({ path: join(OUT, 'dbg-generate.png') });
  await finish(ctx, page, rec, 'generate');
}

// ---------------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    for (const s of SCENES) {
      log(`scene ${s} (${W}x${H}, ${LIVE ? 'live AI' : 'offline planner'})`);
      if (s === 'villa') await villa(browser, server.url);
      else if (s === 'photo') await photo(browser, server.url);
      else if (s === 'generate') await generate(browser, server.url);
      else if (s === 'game') await game(browser, server.url);
      else throw new Error(`unknown scene ${s}`);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

void [copyFileSync, existsSync, readdirSync, zoomTo];
main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exitCode = 1;
});

/**
 * Verified playable, end to end, in Chromium then Firefox (one browser at a
 * time), against the built studio served in mock mode:
 *
 *  1. prompt a small game ("make a coin collecting game"): after the turn a
 *     bot plays it in a worker; the badge turns "Verified playable" only
 *     after a real passed run, the ghost replay of the bot's run appears with
 *     its controls (pause, scrub, speed), and the Checks tab shows the proof;
 *  2. break it by prompt ("remove a coin"): the bot catches that the win can
 *     no longer happen, proposes the smallest patch as an ordinary undoable
 *     history entry, plays again and tells the user in one sentence; Undo
 *     brings the broken world back and the badge is no longer green;
 *  3. a key-and-door game ("a locked vault with a key and a door"), broken
 *     by "remove the key": the bot finds the door nothing can unlock and
 *     fixes it;
 *  4. a building ("a small café interior"): a walkthrough bot opens every
 *     door and visits every room, finds a doorway too narrow for the player
 *     and widens it;
 *  5. the share link carries one proof, the replay seal with the bot's
 *     winning run inside: the player page says "Sealed playable" and that a
 *     bot won, replays the recorded run, and "Check it yourself" re-simulates
 *     the world and has the bot play it again on this device.
 *
 * Any console error or uncaught page error fails the run.
 *
 * Run: `npm run build && npm run e2e:verified` (`-- --chromium` / `-- --firefox`).
 */
import { chromium, firefox, type Browser, type BrowserContext, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const ARGS = process.argv.slice(2);
const BROWSERS = ARGS.includes('--firefox') ? ['firefox'] : ARGS.includes('--chromium') ? ['chromium'] : ['chromium', 'firefox'];
const TIMEOUT = 180_000;
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

function watch(page: Page, errors: string[]): void {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!BENIGN_CONSOLE.some((re) => re.test(text))) errors.push(`console.error: ${text.slice(0, 300)} @ ${m.location().url.slice(0, 160)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
}

/** Wait until the editor rendered and no agent turn is running. */
async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      const last = st.chat[st.chat.length - 1];
      return st.loading === null && !st.agentBusy && (last === undefined || (last.role === 'assistant' && last.status !== 'streaming'));
    },
    null,
    { timeout: TIMEOUT, polling: 250 },
  );
}

/** Create a project from the hero prompt and wait for the agent's turn. */
async function buildFromHero(page: Page, base: string, prompt: string): Promise<void> {
  await page.goto(`${base}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-prompt').waitFor({ timeout: 30_000 });
  await page.locator('#hero-prompt').focus();
  await page.keyboard.type(prompt);
  // The projects store opens asynchronously (a few seconds on a software-GL Firefox): an Enter before it is
  // ready only shows "Projects are still loading", so submit again until the project opens.
  const opened = /#\/p\/[a-z0-9]+/;
  for (let attempt = 0; attempt < 8 && !opened.test(page.url()); attempt++) {
    await page.keyboard.press('Enter');
    await page.waitForURL(opened, { timeout: 4_000 }).catch(() => undefined);
  }
  await page.waitForURL(opened, { timeout: 30_000 });
  log(`  project opened for "${prompt}"`);
  await page.waitForFunction(() => (window.__aether?.store.getState().chat.length ?? 0) > 0, null, { timeout: 60_000 });
  log('  the agent started');
  await waitIdle(page);
  log('  the agent finished');
}

/** Send a prompt in the open editor and wait for the turn. */
async function sendPrompt(page: Page, text: string): Promise<void> {
  const head = await page.evaluate(() => window.__aether?.history.head ?? -1);
  await page.evaluate(() => window.__aether?.store.getState().showLeftView('agent'));
  const input = page.getByLabel('Prompt', { exact: true });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  await page.waitForFunction((h) => (window.__aether?.history.head ?? -1) !== h || window.__aether?.store.getState().agentBusy === true, head, { timeout: 30_000, polling: 100 });
  await waitIdle(page);
}

interface Snapshot {
  status: string;
  proven: boolean;
  head: number | null;
  currentHead: number;
  sentence: string;
  repairs: string[];
  kind: string;
}

async function snap(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const a = window.__aether;
    const p = a?.store.getState().playtest;
    return { status: p?.status ?? 'none', proven: p?.proven ?? false, head: p?.head ?? null, currentHead: a?.history.head ?? -1, sentence: p?.sentence ?? '', repairs: [...(p?.repairs ?? [])], kind: p?.kind ?? 'game' };
  });
}

/** Wait for a finished verdict on the world on screen (not `running`, not idle). */
async function verdict(page: Page, what: string): Promise<Snapshot> {
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      const p = a?.store.getState().playtest;
      return !!p && p.status !== 'running' && p.status !== 'idle' && p.head === a?.history.head;
    },
    null,
    { timeout: TIMEOUT, polling: 250 },
  );
  const s = await snap(page);
  log(`  ${what}: ${s.status}${s.repairs.length ? ` after ${s.repairs.length} fix(es)` : ''} — ${s.sentence.slice(0, 140)}`);
  return s;
}

async function pillVerified(page: Page): Promise<boolean> {
  return (await page.getByTestId('playtest-pill').getAttribute('data-verified')) === 'true';
}

// ---------------------------------------------------------------------------
// 1: a small game is played by the bot
// ---------------------------------------------------------------------------

async function gameFlow(page: Page, base: string): Promise<void> {
  await buildFromHero(page, base, 'make a coin collecting game');
  // The bot runs after the turn; the badge never turns green before a real pass.
  const early = await page.getByTestId('playtest-pill').getAttribute('data-verified');
  check(early !== 'true' || (await snap(page)).status === 'passed', 'the badge was green before the bot finished');
  const s = await verdict(page, 'coin game');
  check(s.status === 'passed' && s.proven, `the coin game was not verified: ${s.status} ${s.sentence}`);
  check(s.sentence.startsWith('Verified playable'), `unexpected sentence "${s.sentence}"`);
  check(await pillVerified(page), 'the badge is not green after a passed run');
  check(((await page.getByTestId('playtest-pill').textContent()) ?? '').includes('Verified playable'), 'the badge does not say "Verified playable"');
  // The bot's seal over the viewport, with a replay.
  await page.locator('[data-testid="proof-seal"][data-kind="playtest"]').waitFor({ timeout: 30_000 });
  // The ghost replay of the winning run plays over the real world, with controls.
  await page.getByTestId('replay-bar').waitFor({ timeout: 60_000 });
  check(await page.evaluate(() => window.__aether?.simulation?.renderer.ghostState.active === true), 'no ghost player in the world');
  await page.getByTestId('replay-toggle').click();
  const paused = await page.evaluate(() => window.__aether?.simulation?.renderer.ghostState.playing === false);
  check(paused, 'the pause button did not pause the ghost');
  // Scrub: the ghost stands where the recording says at that time.
  const probe = await page.evaluate(() => {
    const a = window.__aether;
    const trace = a?.studio.playtest.lastReport?.trace;
    if (!a || !trace) return null;
    const t = (trace.frames - 1) * trace.dt * 0.5;
    a.studio.playtest.seekReplay(t);
    const i = Math.round(t / trace.dt);
    const pos = a.simulation?.renderer.ghostPosition();
    return { pos, want: [trace.poses[i * 4], trace.poses[i * 4 + 1], trace.poses[i * 4 + 2]], t };
  });
  check(probe?.pos && probe.want.every((v, k) => Math.abs((v as number) - (probe.pos as number[])[k]!) < 1.2), `the ghost is not where the recording puts it: ${JSON.stringify(probe)}`);
  const speed0 = (await page.getByTestId('replay-speed').textContent())?.trim();
  await page.getByTestId('replay-speed').click();
  const speed1 = (await page.getByTestId('replay-speed').textContent())?.trim();
  check(speed0 !== speed1, 'the speed button did nothing');
  await page.getByTestId('replay-toggle').click();
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.ghostState.playing === true, null, { timeout: 10_000 });
  // The Checks tab shows the proof in words.
  await page.getByTestId('playtest-pill').click();
  const section = page.getByTestId('verified-section');
  await section.waitFor({ timeout: 10_000 });
  check((await section.getAttribute('data-verified')) === 'true', 'the Checks section is not verified');
  check(((await section.getByTestId('verified-sentence').textContent()) ?? '').includes('Verified playable'), 'the Checks section does not state the result');
  // Play mode clears the ghost.
  await page.locator('button.play-btn').first().click();
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 30_000 });
  check(!(await page.evaluate(() => window.__aether?.simulation?.renderer.ghostState.active)), 'the ghost kept running in play mode');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: 30_000 });
  log('  game: bot won, badge green only after the pass, ghost replay with pause / scrub / speed, Checks tab');
}

// ---------------------------------------------------------------------------
// 2: break it by prompt; the bot catches it and fixes it
// ---------------------------------------------------------------------------

async function breakFlow(page: Page): Promise<void> {
  const before = await snap(page);
  await sendPrompt(page, 'remove a coin');
  // The badge cannot be green for the changed world until the bot has played it again.
  const s = await verdict(page, 'after "remove a coin"');
  check(s.currentHead !== before.currentHead, 'the prompt did not change the world');
  check(s.repairs.length > 0, 'the bot did not repair the broken win condition');
  check(/Lowered the win target/.test(s.repairs.join(' ')), `unexpected repair: ${s.repairs.join(' | ')}`);
  check(s.status === 'passed' && s.proven, `the repaired game was not verified: ${s.status}`);
  check(s.sentence.startsWith('I fixed a problem so it can be won:'), `the one-sentence summary is off: "${s.sentence}"`);
  // The fix is an ordinary history entry (one undo step) and the chat carries the sentence.
  const fix = await page.evaluate(() => {
    const a = window.__aether;
    const entries = a?.history.entries ? a.history.entries() : [];
    return entries.some((e: { message: string }) => e.message.startsWith('Playtest fix:'));
  });
  check(fix, 'the repair is not a history entry');
  const chat = await page.evaluate(() => JSON.stringify(window.__aether?.store.getState().chat.slice(-3) ?? []));
  check(/I fixed a problem so it can be won/.test(chat), 'the chat does not carry the sentence');
  // Undo brings the broken world back: the badge is no longer green until it is checked again.
  await page.evaluate(() => window.__aether?.store.getState().showLeftView('verify'));
  await page.getByTestId('playtest-undo-fix').click();
  await page.waitForFunction(() => {
    const a = window.__aether;
    return a?.store.getState().playtest.head !== a?.history.head;
  }, null, { timeout: 10_000 });
  check(!(await pillVerified(page)), 'the badge stayed green after undoing the fix');
  // Checking again repairs again.
  await page.getByTestId('playtest-run').click();
  const again = await verdict(page, 're-check after undo');
  check(again.status === 'passed', 'the re-check did not pass');
  log('  break: "remove a coin" → caught, repaired in one undoable step, Undo drops the green badge');
}

// ---------------------------------------------------------------------------
// 3: a key-and-door game
// ---------------------------------------------------------------------------

async function vaultFlow(page: Page, base: string): Promise<void> {
  await buildFromHero(page, base, 'a locked vault with a key and a door');
  const s = await verdict(page, 'vault');
  check(s.status === 'passed' && s.proven, `the vault was not verified: ${s.sentence}`);
  const events = await page.evaluate(() => window.__aether?.studio.playtest.lastReport?.trace?.events.map((e: { kind: string; label: string }) => `${e.kind}:${e.label}`) ?? []);
  const key = events.findIndex((e: string) => e.startsWith('pickup:'));
  const door = events.findIndex((e: string) => e.startsWith('door:'));
  const goal = events.findIndex((e: string) => e.startsWith('goal:') || e.startsWith('win:'));
  check(key >= 0 && door > key && goal > door, `the bot did not take the key before the door and the treasure: ${events.join(', ')}`);
  await sendPrompt(page, 'remove the key');
  const broken = await verdict(page, 'after "remove the key"');
  check(broken.repairs.length > 0 && /open when you walk up to it/.test(broken.repairs.join(' ')), `the locked door was not repaired: ${broken.repairs.join(' | ')} / ${broken.sentence}`);
  check(broken.status === 'passed', `the repaired vault was not verified: ${broken.sentence}`);
  log('  vault: key before door before treasure; "remove the key" → the unopenable door is caught and fixed');
}

// ---------------------------------------------------------------------------
// 4: a building is walked through
// ---------------------------------------------------------------------------

async function houseFlow(page: Page, base: string): Promise<void> {
  await buildFromHero(page, base, 'a small café interior');
  const s = await verdict(page, 'café walkthrough');
  check(s.kind === 'walkthrough', 'a building was not walked through');
  check(s.status === 'passed' && s.proven, `the café was not verified walkable: ${s.sentence}`);
  check(/Widened the washroom door/.test(s.repairs.join(' ')), `the too-narrow door was not widened: ${s.repairs.join(' | ')}`);
  check(((await page.getByTestId('playtest-pill').textContent()) ?? '').includes('Verified walkable'), 'the badge does not say "Verified walkable"');
  const rooms = await page.evaluate(() => window.__aether?.store.getState().playtest.objectives.filter((o: { status: string }) => o.status === 'done').length ?? 0);
  check(rooms >= 3, `the bot visited only ${rooms} rooms`);
  log(`  café: ${rooms} rooms visited, doors opened, a too-narrow doorway widened`);
}

// ---------------------------------------------------------------------------
// 4b: pressing Play while the bot is playing steps it aside
// ---------------------------------------------------------------------------

async function playGuardFlow(page: Page, base: string): Promise<void> {
  await buildFromHero(page, base, 'make a coin collecting game');
  // The bot is playing right after the turn; the user presses Play meanwhile.
  const running = await page.evaluate(() => window.__aether?.store.getState().playtest.status === 'running');
  await page.locator('button.play-btn').first().click();
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 30_000 });
  if (running) {
    await page.waitForFunction(() => window.__aether?.store.getState().playtest.status !== 'running', null, { timeout: 10_000 });
    check(!(await page.evaluate(() => window.__aether?.studio.playtest.running)), 'the bot kept playing while the user played');
  }
  // Back in the editor the bot picks the check up again by itself.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: 30_000 });
  const s = await verdict(page, running ? 'resumed after Play' : 'finished before Play');
  check(s.status === 'passed' || !running, `the bot did not come back after Play: ${s.status}`);
  log(`  play guard: ${running ? 'the bot stepped aside for Play and resumed on return' : 'the bot had already finished'}`);
}

// ---------------------------------------------------------------------------
// 5: the share link carries the proof
// ---------------------------------------------------------------------------

async function shareFlow(page: Page, ctx: BrowserContext, base: string, errors: string[]): Promise<void> {
  await buildFromHero(page, base, 'make a coin collecting game');
  const s = await verdict(page, 'game to share');
  check(s.status === 'passed' && s.proven, 'the game to share was not verified');
  const value = await page.evaluate(async () => {
    const proof = await window.__aether?.studio.playtestProof();
    return proof ? proof.status : null;
  });
  check(value === 'passed', 'the studio has no proof to attach to the share link');
  // The publish controller builds the link with the proof.
  const link = await page.evaluate(async () => {
    const a = window.__aether;
    if (!a) return null;
    await a.studio.publish.makeShareLink();
    return a.studio.publish.state.getState().share.value;
  });
  check(typeof link === 'string' && link.length > 100, 'no share link');
  const player = await ctx.newPage();
  watch(player, errors);
  try {
    await player.goto(`${base}/play#w=${link}`, { waitUntil: 'domcontentloaded' });
    // One proof: the replay seal carries the bot's winning run.
    await player.getByTestId('proof-badge').waitFor({ timeout: 90_000 });
    check((await player.getByTestId('proof-badge').getAttribute('data-state')) === 'sealed', 'the player claims more than the seal before any check');
    const evidence = player.getByTestId('bot-evidence');
    await evidence.waitFor({ timeout: 30_000 });
    check(/A bot played it to the win/.test((await player.getByTestId('bot-line').textContent()) ?? ''), 'the player does not say the bot won');
    // Watch the recorded run over the world.
    await player.getByTestId('bot-watch').click();
    await player.getByTestId('bot-replay').waitFor({ timeout: 30_000 });
    // Check it yourself: the replay is re-simulated and the bot plays again on this device.
    await player.getByTestId('proof-check').click();
    await player.waitForFunction(() => document.querySelector('[data-testid="proof-badge"]')?.getAttribute('data-state') === 'verified', null, { timeout: 180_000 });
    check((await evidence.getAttribute('data-reproduced')) === 'true', 'the bot did not win again on this device');
    check(/not a formal proof/i.test((await player.getByTestId('proof-detail').textContent()) ?? ''), 'the verified wording lacks the disclaimer');
    log('  share: the player shows one seal with the bot run, replays it and re-verifies both on this device');
  } finally {
    await player.close();
  }
}

async function runBrowser(name: string, base: string): Promise<void> {
  let browser: Browser | null = null;
  let ctx: BrowserContext | null = null;
  const errors: string[] = [];
  try {
    browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    log(name);
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    const page = await ctx.newPage();
    watch(page, errors);
    await gameFlow(page, base);
    await breakFlow(page);
    await vaultFlow(page, base);
    await houseFlow(page, base);
    await playGuardFlow(page, base);
    await shareFlow(page, ctx, base, errors);
    check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
    log(`${name} passed`);
  } finally {
    await ctx?.close().catch(() => undefined);
    await browser?.close();
  }
}

const server = await startServer((l) => (l.includes('"level":"error"') ? log(l) : undefined));
try {
  for (const name of BROWSERS) await runBrowser(name, server.url);
  log('VERIFIED E2E PASSED');
} catch (err) {
  log(`VERIFIED E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await server.stop();
}

/**
 * End-to-end check of refining a world by prompt, in real browsers:
 * Chromium (default backend policy) then Firefox (WebGL2), one at a time.
 *
 * Product flow: the first prompt builds a world; every following message in
 * the same chat REFINES it. The run:
 *
 *  1. builds a lakeside camp with the first prompt;
 *  2. sends five chained small edits ("make the first tent red", "move the
 *     second tent 2 meters to the left", "make the campfire bigger", "remove
 *     the third log seat", "make it night"); after each one it compares the
 *     world before and after and requires that ONLY the named thing changed
 *     (nothing else regenerated, nothing else moved), that the chat shows
 *     the compact diff card, and that no model was called;
 *  3. asks something ambiguous ("make the tent green"): the world must stay
 *     untouched, the candidates must be offered, and picking one edits only it;
 *  4. undoes everything and requires the world to be byte-identical to the
 *     one the first prompt built.
 *
 * Any console error or uncaught page error fails the run.
 * Run: `npm run build && npm run e2e:refine` (`-- --firefox` or `-- --chromium` for one browser).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type ConsoleMessage, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const SHOTS = process.argv.includes('--shots');

/** Screenshot of the chat panel (only with --shots). */
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const dir = join(REPO_ROOT, 'docs/screenshots');
  mkdirSync(dir, { recursive: true });
  await page.locator('.agent').first().screenshot({ path: join(dir, `${name}.png`) });
}

const VIEWPORT = { width: 1440, height: 900 };
const BOOT_TIMEOUT_MS = 60_000;
const AGENT_TIMEOUT_MS = 120_000;
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

/** The document as JSON text, entity by entity (so differences can be attributed). */
interface Snapshot {
  entities: Record<string, string>;
  environment: string;
  other: string;
  head: number;
  calls: number;
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const a = window.__aether;
    if (!a) throw new Error('no debug handle');
    const w = a.history.current;
    const entities: Record<string, string> = {};
    for (const [id, e] of Object.entries(w.entities)) entities[id] = JSON.stringify(e);
    const { entities: _e, environment, ...rest } = w;
    // Model calls of the newest finished turn (the 'done' event of the chat).
    const chat = a.store.getState().chat;
    let calls = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
      const entry = chat[i];
      if (entry?.role !== 'assistant') continue;
      const done = entry.events.find((ev) => ev.type === 'done');
      if (done && done.type === 'done') calls = done.calls;
      break;
    }
    return { entities, environment: JSON.stringify(environment), other: JSON.stringify(rest), head: a.history.head, calls };
  });
}

function changedIds(a: Snapshot, b: Snapshot): string[] {
  const ids = new Set([...Object.keys(a.entities), ...Object.keys(b.entities)]);
  return [...ids].filter((id) => a.entities[id] !== b.entities[id]).sort();
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  // Entry ids only ever grow (the chat itself is trimmed to its newest entries).
  const before = await page.evaluate(() => window.__aether?.store.getState().chat.at(-1)?.id ?? 0);
  const input = page.getByLabel('Prompt', { exact: true });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  // A local edit or a question is over within a frame or two: the turn shows up as new chat entries, not as "busy".
  await waitFor(page, `the agent to answer "${text}"`, 10_000, () => page.evaluate((n) => (window.__aether?.store.getState().chat.at(-1)?.id ?? 0) >= n + 2, before));
  await waitFor(page, `the agent to finish "${text}"`, AGENT_TIMEOUT_MS, () =>
    page.evaluate(() => {
      const a = window.__aether;
      if (!a || a.store.getState().agentBusy) return false;
      const chat = a.store.getState().chat;
      const last = chat[chat.length - 1];
      return last?.role === 'assistant' && last.status !== 'streaming';
    }),
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
}

async function boot(page: Page, url: string): Promise<string> {
  await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, 'the editor', BOOT_TIMEOUT_MS, () => page.evaluate(() => !!window.__aether));
  await waitFor(page, 'the first frame', BOOT_TIMEOUT_MS, () =>
    page.evaluate(() => {
      const a = window.__aether;
      const st = a?.store.getState();
      if (st?.fatal) throw new Error(st.fatal);
      return !!a?.simulation && st?.loading === null && Object.keys(a.history.current.entities).length > 0;
    }),
  );
  return page.evaluate(() => window.__aether?.store.getState().backend ?? 'none');
}

interface Step {
  text: string;
  /** Entities that must be the only ones to change (removed ones included). */
  changed: string[];
  /** Whether the environment may change (and must). */
  env?: boolean;
}

const STEPS: readonly Step[] = [
  { text: 'make the first tent red', changed: ['tent-1'] },
  { text: 'move the second tent 2 meters to the left', changed: ['tent-2'] },
  { text: 'make the campfire bigger', changed: ['campfire-1'] },
  { text: 'remove the third log seat', changed: ['log-seat-3'] },
  { text: 'make it night', changed: [], env: true },
];

async function run(browser: Browser, url: string, name: string): Promise<void> {
  log(`run "${name}"`);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (BENIGN_CONSOLE.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text.slice(0, 500)}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 500)}`));
    page.on('crash', () => errors.push('page crashed'));
    const backend = await boot(page, url);
    log(`  booted on ${backend}`);

    // 1. The first message builds the world.
    await sendPrompt(page, 'A cozy lakeside camp at sunset with a campfire, tents and fireflies');
    const built = await snapshot(page);
    const ids = Object.keys(built.entities);
    check(ids.length > 20, `the first prompt built too little (${ids.length} entities)`);
    for (const id of ['tent-1', 'tent-2', 'campfire-1', 'log-seat-3']) check(ids.includes(id), `the built camp has no ${id}`);
    log(`  built ${ids.length} entities`);

    // 2. Five chained small edits: only the named thing changes, with no model call.
    let prev = built;
    for (const step of STEPS) {
      await sendPrompt(page, step.text);
      const now = await snapshot(page);
      const changed = changedIds(prev, now);
      check(JSON.stringify(changed) === JSON.stringify([...step.changed].sort()), `"${step.text}" changed ${JSON.stringify(changed)}, expected ${JSON.stringify(step.changed)}`);
      check((now.environment !== prev.environment) === (step.env === true), `"${step.text}": environment ${now.environment !== prev.environment ? 'changed' : 'did not change'} unexpectedly`);
      check(now.other === prev.other, `"${step.text}" changed rules, state or other world data`);
      check(now.head === prev.head + 1, `"${step.text}" was not exactly one undo step (${prev.head} → ${now.head})`);
      check(now.calls === 0, `"${step.text}" used ${now.calls} model call(s)`);
      const card = page.locator('[data-testid="edit-card"]').last();
      check(await card.isVisible(), `no diff card after "${step.text}"`);
      const cardText = (await card.textContent()) ?? '';
      check(/no model call/i.test(cardText), `the diff card does not say it was local ("${cardText.slice(0, 80)}")`);
      log(`  "${step.text}" → only ${step.changed.join(', ') || 'the sky'} (${(await page.locator('[data-testid="edit-summary"]').last().textContent())?.trim()})`);
      prev = now;
    }

    await shot(page, 'refine-chat-edits');

    // 3. Ambiguity: ask, do not guess; picking one edits only it.
    await sendPrompt(page, 'make the tent green');
    const asked = await snapshot(page);
    check(changedIds(prev, asked).length === 0, 'an ambiguous edit changed the world instead of asking');
    const choices = page.locator('[data-testid="clarify-choice"]');
    await waitFor(page, 'the candidates', 10_000, async () => (await choices.count()) >= 2);
    await shot(page, 'refine-chat-clarify');
    await choices.first().click();
    await waitFor(page, 'the chosen edit to finish', AGENT_TIMEOUT_MS, () => page.evaluate(() => window.__aether?.store.getState().agentBusy === false && window.__aether.history.head > 0));
    await page.evaluate(async () => {
      await window.__aether?.simulation?.whenSynced();
    });
    const picked = await snapshot(page);
    const pickedChange = changedIds(asked, picked);
    check(pickedChange.length === 1 && /^tent-\d+$/.test(pickedChange[0] ?? ''), `picking a candidate changed ${JSON.stringify(pickedChange)}`);
    log(`  asked which tent; the answer changed only ${pickedChange[0]}`);

    // 4. Undo every step (the last one through its card's button).
    const undoBtn = page.locator('[data-testid="edit-undo"]').last();
    check(await undoBtn.isEnabled(), 'the newest diff card has no working Undo');
    await undoBtn.click();
    for (let i = 0; i < STEPS.length; i++) await page.evaluate(() => window.__aether?.studio.undo());
    await page.evaluate(async () => {
      await window.__aether?.simulation?.whenSynced();
    });
    const back = await snapshot(page);
    check(JSON.stringify(back.entities) === JSON.stringify(built.entities) && back.environment === built.environment && back.other === built.other, 'undoing every step did not restore the world the first prompt built');
    log('  undid all six edits: the world is exactly the one the first prompt built');

    // 5. GPU resources stay flat over 20 add / recolour / undo cycles done by prompt.
    // The counts are of buffers the GPU has been handed and not yet released, and a buffer is handed over only when its
    // object is first drawn: right after an undo the replaced objects are released but their replacements wait for the
    // next frame, and hidden helpers (the avatar, the ghost run, the camera path: 7 buffers between them) are counted
    // only once drawn. So one reading lands anywhere between 90 and 108 while the scene's objects hold a steady 97
    // buffers, with no trend over 45 cycles. A leak is a trend: the settled readings after the last
    // five cycles must not exceed those after the first five (after a warm-up) by more than the bound.
    const gpu = (): Promise<{ geometries: number; textures: number }> =>
      page.evaluate(async () => {
        const sim = window.__aether!.simulation!;
        await sim.whenSynced();
        // Frames drawn, then the same reading for 1.5 s in a row. (No named helper functions in here: the test
        // bundler would wrap them in a helper the page does not have.)
        let last = { geometries: sim.memoryStats().geometries, textures: sim.memoryStats().textures };
        let steady = 0;
        const deadline = performance.now() + 12_000;
        while (steady < 6 && performance.now() < deadline) {
          sim.touch();
          await new Promise((r) => setTimeout(r, 250));
          const m = sim.memoryStats();
          steady = m.geometries === last.geometries && m.textures === last.textures ? steady + 1 : 0;
          last = { geometries: m.geometries, textures: m.textures };
        }
        return last;
      });
    const cycle = async (): Promise<void> => {
      for (const text of ['add a bench next to the campfire', 'make the campfire red']) {
        await sendPrompt(page, text);
        await page.waitForTimeout(60);
        await page.evaluate(async () => {
          window.__aether?.studio.undo();
          await window.__aether?.simulation?.whenSynced();
        });
      }
    };
    const CYCLES = 20;
    const WINDOW = 5;
    for (let i = 0; i < 2; i++) await cycle();
    const first: Array<{ geometries: number; textures: number }> = [];
    const last: Array<{ geometries: number; textures: number }> = [];
    for (let i = 0; i < CYCLES; i++) {
      await cycle();
      if (i < WINDOW) first.push(await gpu());
      else if (i >= CYCLES - WINDOW) last.push(await gpu());
    }
    const peak = (xs: ReadonlyArray<{ geometries: number; textures: number }>): { geometries: number; textures: number } => ({ geometries: Math.max(...xs.map((x) => x.geometries)), textures: Math.max(...xs.map((x) => x.textures)) });
    const base = peak(first);
    const after = peak(last);
    check(after.geometries <= base.geometries + 6 && after.textures <= base.textures + 4, `GPU resources grew over ${CYCLES} edit/undo cycles: ${JSON.stringify(base)} → ${JSON.stringify(after)} (first ${JSON.stringify(first)}, last ${JSON.stringify(last)})`);
    log(`  ${CYCLES} edit/undo cycles by prompt: geometries ${base.geometries} → ${after.geometries}, textures ${base.textures} → ${after.textures}`);

    check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
    log(`run "${name}" passed`);
  } catch (err) {
    if (errors.length > 0) log(`  collected errors:\n  ${errors.join('\n  ')}`);
    throw err;
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const only = process.argv.includes('--firefox') ? 'firefox' : process.argv.includes('--chromium') ? 'chromium' : null;
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    if (only !== 'firefox') {
      browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
      await run(browser, server.url, 'chromium');
      await browser.close();
      browser = null;
    }
    if (only !== 'chromium') {
      browser = await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
      await run(browser, server.url, 'firefox-webgl2');
      await browser.close();
      browser = null;
    }
    log('REFINE E2E PASSED');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`REFINE E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

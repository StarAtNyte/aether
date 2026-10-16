/**
 * End-to-end check of prompt-defined NPCs in real browsers: Chromium (default
 * backend policy: WebGPU) then Firefox (WebGL2), one browser at a time.
 *
 * Like a user:
 *  1. type "add a guard who patrols the gate and chases me when he sees me"
 *     into the chat → the offline planner adds a guard (kinematic body, route,
 *     attack) and a gate; type "add a shopkeeper who greets me and sells a key"
 *     → a shopkeeper with a stall and a dialogue;
 *  2. Play → the guard walks his patrol (waypoints are reached, nobody falls);
 *  3. the player steps into his view → he chases and the Health counter drops;
 *  4. the player walks up to the shopkeeper → the "Talk" hint appears, E opens
 *     the dialogue card, 1 picks a choice, the card follows the tree and the
 *     close button ends it.
 *
 * Any console error or uncaught page error fails the run.
 * Run: `npm run build && npm run e2e:npc` (`-- --firefox` / `-- --chromium`).
 */
import { chromium, firefox, type Browser, type ConsoleMessage, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const VIEWPORT = { width: 1440, height: 900 };
const BOOT_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 30_000;
const AGENT_TIMEOUT_MS = 90_000;
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

/** Send a prompt through the chat box and wait for the agent to finish. */
async function prompt(page: Page, text: string): Promise<void> {
  const head = await page.evaluate(() => window.__aether?.history.head ?? -1);
  const input = page.getByLabel('Prompt', { exact: true });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  await waitFor(page, `the agent to start on "${text}"`, 10_000, () => page.evaluate((h) => (window.__aether?.store.getState().agentBusy ?? false) || (window.__aether?.history.head ?? -1) !== h, head));
  await waitFor(page, `the agent to finish "${text}"`, AGENT_TIMEOUT_MS, () =>
    page.evaluate(() => {
      const st = window.__aether?.store.getState();
      return !!st && !st.agentBusy && st.chat.length > 0 && st.chat[st.chat.length - 1]?.role === 'assistant';
    }),
  );
}

interface NpcSnap {
  id: string;
  mode: string;
  dead: boolean;
  x: number;
  z: number;
  legs: number;
  stuck: number;
}

function npcs(page: Page): Promise<NpcSnap[]> {
  return page.evaluate(() => (window.__aether?.simulation?.logic?.npcs.infos() ?? []).map((n) => ({ id: n.id, mode: n.mode, dead: n.dead, x: n.x, z: n.z, legs: n.legs, stuck: n.stuck })));
}

/** Put the player (the capsule controller) somewhere. */
function teleportPlayer(page: Page, x: number, z: number): Promise<void> {
  return page.evaluate(
    ([px, pz]) => {
      const sim = window.__aether?.simulation as unknown as { session?: { character?: { teleport(p: [number, number, number]): void } | null } } | undefined;
      sim?.session?.character?.teleport([px as number, 1.2, pz as number]);
    },
    [x, z],
  );
}

async function addNpcsByPrompt(page: Page): Promise<{ guard: string; shop: string }> {
  await prompt(page, 'add a guard who patrols the gate and chases me when he sees me');
  await prompt(page, 'add a shopkeeper who greets me and sells a key');
  const found = await page.evaluate(() => {
    const es = Object.values(window.__aether?.history.current.entities ?? {});
    const guard = es.find((e) => e.npc?.role === 'guard');
    const shop = es.find((e) => e.npc?.role === 'shopkeeper');
    return {
      guard: guard?.id ?? null,
      shop: shop?.id ?? null,
      route: guard?.npc?.waypoints.length ?? 0,
      attack: guard?.npc?.attack?.damage ?? 0,
      tests: window.__aether?.history.current.tests.some((t) => t.kind === 'npcs') ?? false,
      gate: es.some((e) => e.tags.includes('gate')),
      dialogue: Object.keys(shop?.npc?.dialogue?.nodes ?? {}).length,
    };
  });
  check(found.guard && found.shop, `the prompts did not create a guard and a shopkeeper (${JSON.stringify(found)})`);
  check(found.route >= 2 && found.attack > 0 && found.gate && found.tests && found.dialogue >= 2, `the NPCs are incomplete: ${JSON.stringify(found)}`);
  log(`  prompts added ${found.guard} (route of ${found.route}, attack ${found.attack}) and ${found.shop} (${found.dialogue} dialogue nodes)`);
  return { guard: found.guard, shop: found.shop };
}

async function play(page: Page): Promise<void> {
  await page.locator('button.play-btn').click();
  await waitFor(page, 'play mode', STEP_TIMEOUT_MS, () => page.evaluate(() => window.__aether?.store.getState().mode === 'play' && !window.__aether?.store.getState().modeBusy && !!window.__aether?.simulation?.logic));
  // A world with a title card holds the game until Start; ours has none, but be safe.
  await page.evaluate(() => window.__aether?.studio.startGame());
  const count = await waitFor(page, 'the NPC brains', STEP_TIMEOUT_MS, async () => (await npcs(page)).length || null);
  log(`  playing with ${count} NPC(s)`);
}

async function watchPatrol(page: Page, guard: string): Promise<void> {
  const first = (await npcs(page)).find((n) => n.id === guard);
  check(first, 'the guard has no brain');
  // Park the player far away so the guard keeps to his route.
  await teleportPlayer(page, first.x + 60, first.z + 60);
  const moved = await waitFor(page, 'the guard to walk his patrol', 40_000, async () => {
    const n = (await npcs(page)).find((x) => x.id === guard);
    if (!n || n.dead) return null;
    return Math.hypot(n.x - first.x, n.z - first.z) > 3 && n.legs >= 1 ? n : null;
  });
  const y = await page.evaluate((id) => window.__aether?.simulation?.physics?.getState(id)?.position[1] ?? null, guard);
  check(y === null || y > -1, `the guard fell through the floor (y=${y})`);
  check(moved.stuck < 3, `the guard is stuck (${moved.stuck}s)`);
  log(`  patrol: ${guard} walked ${Math.hypot(moved.x - first.x, moved.z - first.z).toFixed(1)} m, ${moved.legs} waypoint(s) reached, mode ${moved.mode}`);
}

async function watchChase(page: Page, guard: string): Promise<void> {
  const health0 = await page.evaluate(() => Number(window.__aether?.simulation?.logic?.readState('health') ?? 100));
  // Stand 6 m in front of him, along the way he is walking.
  const at = await page.evaluate((id) => {
    const info = window.__aether?.simulation?.logic?.npcs.info(id);
    const e = window.__aether?.history.current.entities[id];
    const wp = e?.npc?.waypoints[(info?.waypoint ?? 0) % Math.max(1, e.npc.waypoints.length)];
    if (!info || !wp) return null;
    const dx = wp[0] - info.x;
    const dz = wp[2] - info.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: info.x + (dx / d) * 6, z: info.z + (dz / d) * 6 };
  }, guard);
  check(at, 'cannot place the player in front of the guard');
  await teleportPlayer(page, at.x, at.z);
  const chased = await waitFor(page, 'the guard to chase', 10_000, async () => {
    const n = (await npcs(page)).find((x) => x.id === guard);
    return n && (n.mode === 'chase' || n.mode === 'attack') ? n.mode : null;
  });
  const hurt = await waitFor(page, 'the guard to land a hit', 15_000, () => page.evaluate((h) => (Number(window.__aether?.simulation?.logic?.readState('health') ?? 100) < h ? Number(window.__aether?.simulation?.logic?.readState('health')) : null), health0));
  log(`  chase: the guard went to "${chased}" and health ${health0} → ${hurt}`);
  // The HUD shows it.
  const hud = await page.locator('.play-hud').innerText();
  check(/Health/i.test(hud), `the HUD does not show Health: ${hud}`);
}

async function talk(page: Page, shop: string): Promise<void> {
  // Heal up and move away from the guard; a talk needs a calm shopkeeper.
  const pos = await page.evaluate((id) => {
    const i = window.__aether?.simulation?.logic?.npcs.info(id);
    return i ? { x: i.x, z: i.z } : null;
  }, shop);
  check(pos, 'the shopkeeper has no brain');
  await teleportPlayer(page, pos.x + 2.4, pos.z + 0.4);
  const hint = await waitFor(page, 'the talk hint', 10_000, async () => {
    const t = await page.locator('.npc-prompt').first().textContent({ timeout: 500 }).catch(() => null);
    return t && /Talk to/.test(t) ? t : null;
  });
  await page.keyboard.press('KeyE');
  const card = await waitFor(page, 'the dialogue card', 10_000, async () => {
    const visible = await page.locator('.npc-card').first().isVisible().catch(() => false);
    return visible ? await page.locator('.npc-card__speaker').first().innerText() : null;
  });
  const text0 = await waitFor(page, 'the greeting to finish typing', 10_000, async () => {
    const t = await page.locator('.npc-card__text').first().innerText({ timeout: 2000 }).catch(() => '');
    return /Welcome/.test(t) ? t : null;
  });
  await waitFor(page, 'the choices', 10_000, async () => ((await page.locator('.npc-choice').count()) >= 2 ? true : null));
  const choices = await page.locator('.npc-choice').allInnerTexts();
  await page.keyboard.press('Digit1'); // the first offered choice: "How much for the key?" (buying needs coins)
  const price = await waitFor(page, 'the price answer', 10_000, async () => {
    const t = await page.locator('.npc-card__text').first().innerText();
    return /coins/.test(t) ? t : null;
  });
  // Pointer route: the close button ends the conversation.
  await page.locator('.npc-card__close').click();
  await waitFor(page, 'the card to close', 15_000, async () => ((await page.locator('.npc-card').count()) === 0 ? true : null));
  log(`  talk: "${hint.trim()}" → ${card}: "${text0.slice(0, 40)}…" choices ${JSON.stringify(choices.map((c) => c.replace(/\s+/g, ' ').trim()))} → "${price.slice(0, 40)}"; closed with the button`);
}

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
    const { guard, shop } = await addNpcsByPrompt(page);
    await play(page);
    await watchPatrol(page, guard);
    await watchChase(page, guard);
    await talk(page, shop);
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
    log('NPC E2E PASSED');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`NPC E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

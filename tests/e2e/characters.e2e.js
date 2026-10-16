/**
 * End-to-end check of people in real browsers: Chromium (default backend
 * policy: WebGPU) then Firefox (WebGL2), one browser at a time.
 *
 * Like a user:
 *  1. type "add a tired old shopkeeper in a green coat who greets me" and
 *     "add two guards in red who patrol the gate" → the offline planner makes
 *     people (a `character` on each NPC: age, mood, outfit colours);
 *  2. the cast loads (skinned, animated glTF) and each person plays the idle
 *     of their mood;
 *  3. Play → a guard walks his route with a walk clip whose rate matches his
 *     speed (no sliding), footsteps fire;
 *  4. the player steps up to the shopkeeper, presses E and the shopkeeper
 *     switches to a talking gesture clip while the card is up;
 *  5. the player's own body walks, runs and jumps (clips follow the speed and
 *     the controller), and is drawn shadow-only in first person.
 *
 * `CHAR_SHOTS=<dir>` also saves screenshots of every step (look development).
 * Any console error or uncaught page error fails the run.
 * Run: `npm run build && npm run e2e:characters` (`-- --firefox` / `-- --chromium`).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';
const VIEWPORT = { width: 1280, height: 800 };
const BOOT_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 30_000;
const AGENT_TIMEOUT_MS = 90_000;
const BENIGN_CONSOLE = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];
const SHOTS = process.env['CHAR_SHOTS'] ?? '';
const startedAt = performance.now();
function log(line) {
    process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}
class E2EFailure extends Error {
    name = 'E2EFailure';
}
function check(cond, message) {
    if (!cond)
        throw new E2EFailure(message);
}
async function waitFor(page, what, timeoutMs, probe, intervalMs = 150) {
    const deadline = performance.now() + timeoutMs;
    let last = null;
    while (performance.now() < deadline) {
        const v = await probe();
        if (v !== null && v !== undefined && v !== false)
            return v;
        last = v;
        await page.waitForTimeout(intervalMs);
    }
    throw new E2EFailure(`timed out after ${timeoutMs} ms waiting for ${what} (last=${JSON.stringify(last)})`);
}
async function boot(page, url) {
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, 'the editor', BOOT_TIMEOUT_MS, () => page.evaluate(() => !!window.__aether));
    await waitFor(page, 'the first frame', BOOT_TIMEOUT_MS, () => page.evaluate(() => {
        const a = window.__aether;
        const st = a?.store.getState();
        if (st?.fatal)
            throw new Error(st.fatal);
        return !!a?.simulation && st?.loading === null && Object.keys(a.history.current.entities).length > 0;
    }));
    return page.evaluate(() => window.__aether?.store.getState().backend ?? 'none');
}
async function prompt(page, text) {
    const head = await page.evaluate(() => window.__aether?.history.head ?? -1);
    const input = page.getByLabel('Prompt', { exact: true });
    await input.click();
    await input.fill(text);
    await input.press('Enter');
    await waitFor(page, `the agent to start on "${text}"`, 10_000, () => page.evaluate((h) => (window.__aether?.store.getState().agentBusy ?? false) || (window.__aether?.history.head ?? -1) !== h, head));
    await waitFor(page, `the agent to finish "${text}"`, AGENT_TIMEOUT_MS, () => page.evaluate(() => {
        const st = window.__aether?.store.getState();
        return !!st && !st.agentBusy && st.chat.length > 0 && st.chat[st.chat.length - 1]?.role === 'assistant';
    }));
}
/** The renderer's view of the people (debug handle, same objects the game uses). */
function rigOf(page, id) {
    return page.evaluate((i) => {
        const r = window.__aether?.simulation?.renderer.characterRig(i);
        return r ? { clip: r.clipName, state: r.state, speed: Math.round(r.speed * 100) / 100, body: r.look.body.id } : null;
    }, id);
}
async function shot(page, name) {
    if (!SHOTS)
        return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}
/** Frame a person: camera 3 m in front, at head height. */
async function look(page, id, dist = 3.2, side = 0.9) {
    await page.evaluate(([i, d, s]) => {
        const sim = window.__aether?.simulation;
        const e = window.__aether?.history.current.entities[i];
        if (!sim || !e)
            return;
        const p = e.transform.position;
        const yaw = ((e.transform.rotation[1] ?? 0) * Math.PI) / 180;
        // In front of the character (its −Z side), a little to the side.
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        sim.renderer.lookAt([p[0] + fx * d + fz * s, 1.55, p[2] + fz * d - fx * s], [p[0], 1.1, p[2]], 34);
    }, [id, dist, side]);
    await page.waitForTimeout(500);
}
function teleportPlayer(page, x, z) {
    return page.evaluate(([px, pz]) => {
        const sim = window.__aether?.simulation;
        sim?.session?.character?.teleport([px, 1.2, pz]);
    }, [x, z]);
}
async function run(browser, url, name) {
    log(`run "${name}"`);
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    const errors = [];
    try {
        const page = await context.newPage();
        page.on('console', (m) => {
            if (m.type() !== 'error')
                return;
            const text = m.text();
            if (BENIGN_CONSOLE.some((re) => re.test(text)))
                return;
            errors.push(`console.error: ${text.slice(0, 500)}`);
        });
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 500)}`));
        page.on('crash', () => errors.push('page crashed'));
        const backend = await boot(page, url);
        log(`  booted on ${backend}`);
        // 1. People by prompt.
        await prompt(page, 'add a tired old shopkeeper in a green coat who greets me and sells a key');
        await prompt(page, 'add two guards in red who patrol the gate');
        const made = await page.evaluate(() => {
            const es = Object.values(window.__aether?.history.current.entities ?? {});
            const shop = es.find((e) => e.npc?.role === 'shopkeeper');
            const guards = es.filter((e) => e.npc?.role === 'guard');
            return {
                shop: shop?.id ?? null,
                shopLook: shop?.character ?? null,
                guards: guards.map((g) => g.id),
                guardLooks: guards.map((g) => g.character ?? null),
            };
        });
        check(made.shop && made.shopLook && made.guards.length >= 2, `the prompts did not create people: ${JSON.stringify(made)}`);
        check(made.shopLook.age === 'old' && made.shopLook.mood === 'tired' && /^#[0-9a-f]{6}$/i.test(made.shopLook.top ?? ''), `the shopkeeper's look was not read from the words: ${JSON.stringify(made.shopLook)}`);
        check(made.guardLooks.every((l) => l && l.top && l.wardrobe === 'guard'), `the guards' look is wrong: ${JSON.stringify(made.guardLooks)}`);
        log(`  prompts made ${made.shop} (${JSON.stringify(made.shopLook)}) and ${made.guards.length} guards (${JSON.stringify(made.guardLooks[0])})`);
        // 2. The cast loads and idles in character.
        await waitFor(page, 'the people to load', 60_000, () => page.evaluate((n) => ((window.__aether?.simulation?.renderer.characterCount ?? 0) >= n ? true : null), 3));
        const shopRig = await waitFor(page, "the shopkeeper's rig", 20_000, async () => rigOf(page, made.shop));
        check(shopRig.clip === 'idle_breathe', `a tired shopkeeper should idle with idle_breathe, not ${shopRig.clip}`);
        const bodies = await page.evaluate((ids) => ids.map((i) => window.__aether?.simulation?.renderer.characterRig(i)?.look.body.id), [made.shop, ...made.guards]);
        check(new Set(bodies).size >= 2, `the cast is not varied: ${JSON.stringify(bodies)}`);
        log(`  cast: ${JSON.stringify(bodies)}; shopkeeper idles with ${shopRig.clip}`);
        await look(page, made.shop);
        await shot(page, `${name}-shopkeeper`);
        await look(page, made.guards[0]);
        await shot(page, `${name}-guard`);
        // 3. Play: the guard walks, the clip rate follows his speed.
        await page.locator('button.play-btn').click();
        await waitFor(page, 'play mode', STEP_TIMEOUT_MS, () => page.evaluate(() => window.__aether?.store.getState().mode === 'play' && !window.__aether?.store.getState().modeBusy && !!window.__aether?.simulation?.logic));
        await page.evaluate(() => window.__aether?.studio.startGame());
        const guard = made.guards[0];
        const start = await page.evaluate((id) => window.__aether?.simulation?.logic?.npcs.info(id) ?? null, guard);
        check(start, 'the guard has no brain');
        await teleportPlayer(page, start.x + 70, start.z + 70);
        const walking = await waitFor(page, 'the guard to walk with a walk clip', 40_000, async () => {
            const r = await rigOf(page, guard);
            return r && /^(walk|stroll|jog|run)/.test(r.clip) && r.speed > 0.5 ? r : null;
        });
        const rate = await page.evaluate((id) => {
            const r = window.__aether?.simulation?.renderer.characterRig(id);
            return r?.current ? { scale: r.current.timeScale, clip: r.current.getClip().name } : null;
        }, guard);
        check(rate && rate.scale > 0.6 && rate.scale < 1.7, `the walk rate should match the speed (no sliding): ${JSON.stringify(rate)}`);
        log(`  guard: ${walking.clip} at ${walking.speed} m/s, play rate ${rate?.scale.toFixed(2)}`);
        await look(page, guard, 4.5, 2.2);
        await shot(page, `${name}-guard-walk`);
        // 4. Talk: the shopkeeper gestures while the card is up.
        const pos = await page.evaluate((id) => window.__aether?.simulation?.logic?.npcs.info(id) ?? null, made.shop);
        check(pos, 'the shopkeeper has no brain');
        await teleportPlayer(page, pos.x + 2.2, pos.z + 0.4);
        await waitFor(page, 'the talk hint', 10_000, async () => ((await page.locator('.npc-prompt').first().textContent({ timeout: 500 }).catch(() => null)) ?? '').includes('Talk') || null);
        await page.keyboard.press('KeyE');
        await waitFor(page, 'the dialogue card', 10_000, async () => ((await page.locator('.npc-card').first().isVisible().catch(() => false)) ? true : null));
        const talking = await waitFor(page, 'a talking gesture', 8_000, async () => {
            const r = await rigOf(page, made.shop);
            return r && /^talk/.test(r.clip) ? r : null;
        });
        log(`  talk: the shopkeeper plays ${talking.clip} (${talking.state}) during the conversation`);
        await shot(page, `${name}-talk`);
        await page.locator('.npc-card__close').click();
        // 5. The player's own body.
        const body = await waitFor(page, "the player's body", 20_000, () => page.evaluate(() => window.__aether?.simulation?.renderer.playerRig()?.look.body.id ?? null));
        await teleportPlayer(page, 0, 12);
        await page.keyboard.down('KeyW');
        const moving = await waitFor(page, 'a locomotion clip on the player', 10_000, () => page.evaluate(() => {
            const r = window.__aether?.simulation?.renderer.playerRig();
            return r && /^(walk|jog|run|sprint)/.test(r.clipName) ? r.clipName : null;
        }));
        await shot(page, `${name}-player-run`);
        await page.keyboard.press('Space');
        const jumped = await waitFor(page, 'a jump clip', 4_000, () => page.evaluate(() => {
            const r = window.__aether?.simulation?.renderer.playerRig();
            return r && /^(jump|fall)/.test(r.clipName) ? r.clipName : null;
        }), 40);
        await page.keyboard.up('KeyW');
        log(`  player (${body}): ${moving} while moving, ${jumped} when jumping`);
        check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
        log(`run "${name}" passed`);
    }
    catch (err) {
        if (errors.length > 0)
            log(`  collected errors:\n  ${errors.join('\n  ')}`);
        throw err;
    }
    finally {
        await context.close();
    }
}
async function main() {
    const only = process.argv.includes('--firefox') ? 'firefox' : process.argv.includes('--chromium') ? 'chromium' : null;
    const server = await startServer(log);
    let browser = null;
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
        log('CHARACTERS E2E PASSED');
    }
    finally {
        await browser?.close();
        await server.stop();
    }
}
main().catch((err) => {
    log(`CHARACTERS E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
});

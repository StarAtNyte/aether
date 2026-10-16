/**
 * End-to-end check of the plan reveal on the courtyard house, in real browsers
 * (Chromium WebGPU, forced WebGL2, Firefox WebGL2): the Reveal button draws the
 * plan in ink on paper, the paper dissolves into the 3D view while the walls
 * rise (an animated section cut) and the camera comes down, and when it ends the
 * overlay is gone, the section is off and the previous view is back; a click
 * skips to the end at any time. Frames go to `--out=<dir>` for a look.
 *
 * Run: `npm run build && npm run e2e:reveal` (`-- --chromium` / `-- --firefox`,
 * `-- --webgpu` / `-- --webgl2`, `--out=<dir>`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';
const ARGS = process.argv.slice(2);
const OUT = ARGS.find((a) => a.startsWith('--out='))?.slice(6);
const VIEWPORT = { width: 1280, height: 800 };
const BENIGN_CONSOLE = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];
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
async function waitFor(page, what, timeoutMs, probe, intervalMs = 100) {
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
const arch = (page) => page.evaluate(() => {
    const a = window.__aether.store.getState().arch;
    return { reveal: a.reveal, section: a.section, walls: a.walls };
});
async function shot(page, name) {
    const png = await page.locator('.viewport').screenshot();
    if (OUT) {
        mkdirSync(resolve(OUT), { recursive: true });
        writeFileSync(join(resolve(OUT), `${name}.png`), png);
    }
    return pixelStats(decodePng(png)).stdDev;
}
async function run(browser, url, label, forceWebGL2) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    if (forceWebGL2)
        await context.addInitScript({ content: 'try { delete Navigator.prototype.gpu; } catch {}' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
        if (m.type() === 'error' && !BENIGN_CONSOLE.some((r) => r.test(m.text())))
            errors.push(`console: ${m.text()}`);
    });
    try {
        await page.goto(`${url}/?debug=1#/new/casa-patio`, { waitUntil: 'domcontentloaded' });
        await waitFor(page, 'the house', 120_000, () => page.evaluate(() => {
            const a = window.__aether;
            const st = a?.store.getState();
            return a && a.simulation !== null && st?.loading === null && !st.agentBusy && st.arch.building !== null ? true : null;
        }));
        await page.evaluate(async () => {
            await window.__aether?.simulation?.whenSynced();
            window.__aether?.studio.playtest.cancel();
            window.__aether?.studio.playtest.stopReplay();
        });
        const before = await arch(page);
        check(before.reveal === null, `[${label}] no reveal before the button`);
        const bar = page.getByRole('toolbar', { name: 'Building views' });
        // The button starts it (a click on the paper ends it); then a short reveal for the timing checks.
        await bar.getByRole('button', { name: 'Reveal' }).click();
        await waitFor(page, 'the paper', 10_000, () => page.locator('[data-testid="reveal"]').count().then((n) => (n === 1 ? true : null)));
        await page.locator('[data-testid="reveal"]').click({ position: { x: 200, y: 200 } });
        await waitFor(page, 'the click to end it', 10_000, async () => ((await arch(page)).reveal === null ? true : null));
        check((await arch(page)).section === before.section, `[${label}] ending the reveal restores the view`);
        // Held frames (scrubbed), so screenshots are of a still view: ink half way, the paper dissolving over rising walls, the end.
        const scrub = (t) => page.evaluate((x) => window.__aether?.studio.arch.scrubReveal(x), t);
        check(await scrub(0.12), `[${label}] the reveal should start`);
        const inkAt = async () => page.locator('[data-testid="reveal"] path').count();
        const inkEarly = await inkAt();
        await shot(page, `${label}-1-ink`);
        await scrub(0.26);
        const inkLate = await inkAt();
        check(inkLate > inkEarly && inkLate > 6, `[${label}] the plan should be drawn in ink, more of it as time passes (${inkEarly} -> ${inkLate})`);
        check((await page.locator('[data-testid="reveal"] text').count()) > 0, `[${label}] room names appear on the plan`);
        const labels = await page.locator('[data-testid="reveal"] text').allTextContents();
        check(labels.some((t) => /LIVING ROOM/.test(t)), `[${label}] the living room is labelled: ${labels.slice(0, 6).join(' | ')}`);
        const early = await arch(page);
        await scrub(0.38);
        const dissolving = await page.locator('[data-testid="reveal"]').evaluate((el) => Number(getComputedStyle(el).opacity));
        check(dissolving > 0.05 && dissolving < 0.95, `[${label}] the paper should be dissolving (${dissolving})`);
        const s1 = (await arch(page)).section;
        await shot(page, `${label}-2-dissolve`);
        await scrub(0.6);
        const s2 = (await arch(page)).section;
        await shot(page, `${label}-3-rising`);
        await scrub(0.8);
        const s3 = (await arch(page)).section;
        check(early.section !== null && s1 !== null && s2 !== null && s1 < s2 && s2 > early.section, `[${label}] the walls should rise: ${early.section} -> ${s1} -> ${s2} -> ${s3}`);
        check((await page.locator('[data-testid="reveal"]').count()) === 0, `[${label}] the paper is gone once the walls are up`);
        await page.evaluate(() => window.__aether?.studio.arch.cancelReveal());
        const after = await arch(page);
        check(after.reveal === null, `[${label}] the reveal should end`);
        // The end state: overlay gone, section off, the previous view back.
        check(after.section === before.section && after.walls === before.walls, `[${label}] the previous view should come back: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        const stdDev = await shot(page, `${label}-4-end`);
        check(stdDev > 8, `[${label}] the final view looks blank (stddev ${stdDev.toFixed(1)})`);
        log(`[${label}] reveal: ${inkEarly} → ${inkLate} ink strokes, ${labels.length} labels, section ${early.section?.toFixed(2)} → ${s2.toFixed(2)} m, back to ${after.walls}`);
        // A real, running reveal also completes by itself.
        await page.evaluate(() => window.__aether?.studio.arch.startReveal(2));
        await waitFor(page, 'the reveal to finish by itself', 120_000, async () => ((await arch(page)).reveal === null ? true : null), 250);
        check((await arch(page)).section === before.section, `[${label}] the running reveal restores the view`);
        // 4. A click skips to the end.
        await page.evaluate(() => window.__aether?.studio.arch.startReveal(6));
        await waitFor(page, 'the second reveal', 10_000, () => page.locator('[data-testid="reveal"]').count().then((n) => (n === 1 ? true : null)));
        await page.locator('[data-testid="reveal"]').click({ position: { x: 300, y: 300 } });
        await waitFor(page, 'the skip', 5_000, async () => ((await arch(page)).reveal === null ? true : null));
        check((await arch(page)).section === before.section, `[${label}] skipping should restore the view`);
        check(errors.length === 0, `[${label}] page errors: ${errors.slice(0, 5).join(' | ')}`);
    }
    finally {
        await context.close();
    }
}
async function main() {
    const server = await startServer(log);
    let browser = null;
    const only = ARGS.find((a) => a === '--chromium' || a === '--firefox');
    try {
        if (only !== '--firefox') {
            browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
            if (!ARGS.includes('--webgl2'))
                await run(browser, server.url, 'chromium-webgpu', false);
            if (!ARGS.includes('--webgpu'))
                await run(browser, server.url, 'chromium-webgl2', true);
            await browser.close();
            browser = null;
        }
        if (only !== '--chromium') {
            browser = await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
            await run(browser, server.url, 'firefox-webgl2', false);
            await browser.close();
            browser = null;
        }
    }
    finally {
        await browser?.close().catch(() => undefined);
        await server.stop();
    }
    log('reveal e2e passed');
}
main().catch((err) => {
    log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exitCode = 1;
});

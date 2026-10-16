/**
 * The render quality layer in real browsers: Chromium (WebGPU, then forced WebGL2) and Firefox (WebGL2),
 * one browser at a time, on the kart-canyon flagship (loaded from its saved world).
 *
 *  1. every tier (low, medium, high, ultra) draws a non-blank frame, runs its effects without any of them
 *     failing on the device, and individual effects switch off again;
 *  2. a Final render still (planned like the studio does) comes back at the requested size, non-blank;
 *  3. an area light over a floor really lights it (the lit wall is brighter than the unlit corner);
 *  4. a small path-traced still (private WebGL2 context, lazily loaded) completes and is non-blank;
 *  5. twelve tier / effect / still-quality switches leave the renderer's GPU object counts flat (no leak);
 *  6. no console error and no page error anywhere.
 *
 * Run: `npm run build && npm run e2e:render` (`-- --chromium` / `-- --firefox` / `-- --no-pathtrace`).
 * Firefox needs a GL: on a machine without a display use `xvfb-run -a npm run e2e:render -- --firefox`.
 */
import { chromium, firefox } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';
import { LABS } from './support/photoreal-labs';
const ARGS = process.argv.slice(2);
const VIEWPORT = { width: 800, height: 450 };
const TIMEOUT = 150_000;
const SLUG = 'kart-canyon';
const SKIP_PT = ARGS.includes('--no-pathtrace');
const BROWSERS = ARGS.includes('--firefox') ? ['firefox'] : ARGS.includes('--webgl2') ? ['chromium-webgl2'] : ARGS.includes('--chromium') ? ['chromium-webgpu', 'chromium-webgl2'] : ['chromium-webgpu', 'chromium-webgl2', 'firefox'];
const BENIGN = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];
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
/** Run `fn` in the page with the renderer handle (`fn` must be self-contained; `arg` must be JSON). */
function onRenderer(page, fn, arg) {
    return page.evaluate(`(${fn.toString()})(window.__aether.simulation.renderer, ${JSON.stringify(arg ?? null)})`);
}
async function open(page, url) {
    await page.goto(`${url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const a = window.__aether;
        if (!a || a.simulation === null)
            return false;
        const st = a.store.getState();
        return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
    }, null, { timeout: TIMEOUT, polling: 250 });
    await page.evaluate(async () => {
        await window.__aether?.simulation?.whenSynced();
        const st = window.__aether?.store.getState();
        st?.setPanel('left', false);
        st?.setPanel('right', false);
        st?.updateSettings({ showNavHint: false });
    });
    await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: TIMEOUT, polling: 500 }).catch(() => undefined);
    await page.waitForTimeout(800);
}
/** Wait until the chain the current tier wants is the one running (it builds asynchronously). */
async function settled(page, tier) {
    await page.evaluate(async (t) => {
        const r = window.__aether?.simulation?.renderer;
        r.setEffects({});
        r.setRenderTier(t);
        const deadline = performance.now() + 60_000;
        // Draw frames until the pipeline exists with all the intended effects (or the device dropped some).
        while (performance.now() < deadline) {
            r.requestRender();
            await new Promise((res) => setTimeout(res, 120));
            const on = Object.entries(r.activeEffects).filter(([k, v]) => v && k !== 'composite').map(([k]) => k);
            const wanted = r.intendedEffects;
            if (on.length === wanted.length && on.every((k) => wanted.includes(k)))
                return;
        }
    }, tier);
    await page.waitForTimeout(500);
}
async function frame(page) {
    // Let the loop draw a few frames first: the screenshot reads what has been drawn.
    await page.evaluate(async () => {
        const r = window.__aether?.simulation?.renderer;
        const f0 = r.frameCount;
        for (let i = 0; i < 60 && r.frameCount < f0 + 3; i++) {
            r.requestRender();
            await new Promise((res) => setTimeout(res, 100));
        }
    });
    let img = null;
    // A frame read back before the first present can be empty on some drivers: look again a few times.
    for (let attempt = 0; attempt < 5; attempt++) {
        const dataUrl = await onRenderer(page, async (r) => await r.screenshot({ width: 640, height: 360, mime: 'image/png' }), null);
        check(dataUrl?.startsWith('data:image/png;base64,'), 'screenshot failed');
        img = decodePng(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
        if (pixelStats(img).stdDev > 1)
            break;
        log(`  (empty frame, looking again ${attempt + 1})`);
        await page.waitForTimeout(400);
    }
    return img;
}
function lumaMean(img, x0, y0, x1, y1) {
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++) {
        for (let x = Math.floor(x0 * img.width); x < Math.floor(x1 * img.width); x++) {
            const o = (y * img.width + x) * 4;
            sum += 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
            n++;
        }
    }
    return n > 0 ? sum / n : 0;
}
async function runBrowser(name, browser, url) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    if (name === 'chromium-webgl2') {
        await context.addInitScript(() => {
            delete Navigator.prototype['gpu'];
        });
    }
    const errors = [];
    try {
        const page = await context.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => {
            if (m.type() === 'error' && !BENIGN.some((re) => re.test(m.text())))
                errors.push(m.text().slice(0, 300));
            if (/flat colour/.test(m.text()))
                log('  (renderer re-rendered a flat still)');
        });
        await open(page, url);
        const backend = await onRenderer(page, (r) => r.backend, null);
        log(`${name}: booted on ${backend}`);
        // 1. Tiers.
        for (const tier of ['low', 'medium', 'high', 'ultra']) {
            await settled(page, tier);
            const state = await onRenderer(page, (r) => ({ tier: r.renderTier, active: Object.entries(r.activeEffects).filter(([, v]) => v).map(([k]) => k), failed: r.failedEffectNames }), null);
            const stats = pixelStats(await frame(page));
            log(`  ${tier}: ${state.active.join('+') || 'direct'}, stddev ${stats.stdDev.toFixed(1)}`);
            check(state.tier === tier, `tier ${tier} not in effect (${state.tier})`);
            check(state.failed.length === 0, `${tier}: effects failed on this device: ${state.failed.join(', ')}`);
            check(stats.stdDev > 8, `${tier}: blank canvas (stddev ${stats.stdDev.toFixed(1)})`);
            if (tier === 'ultra') {
                for (const e of ['ssr', 'shafts', 'halation', 'aberration', 'ao', 'taa'])
                    check(state.active.includes(e), `ultra is missing ${e}`);
            }
        }
        await onRenderer(page, (r) => r.setEffects({ ao: false, ssr: false }), null);
        await page.waitForTimeout(600);
        await onRenderer(page, async (r) => {
            for (let i = 0; i < 40 && (r.activeEffects['ao'] || r.activeEffects['ssr']); i++) {
                r.requestRender();
                await new Promise((res) => setTimeout(res, 100));
            }
        }, null);
        const toggled = await onRenderer(page, (r) => r.activeEffects, null);
        check(!toggled['ao'] && !toggled['ssr'] && toggled['taa'], `effect toggles did not apply: ${JSON.stringify(toggled)}`);
        await settled(page, 'medium');
        // 2. Final render still, planned like the studio does.
        const pose = await onRenderer(page, (r) => r.cameraPose(), null);
        const still = await onRenderer(page, async (r, p) => {
            r.setRenderQuality('final');
            await r.preparePost();
            const plan = r.planStill(400, 225, 'final');
            const opts = { width: 400, height: 225, pose: p, frames: Math.min(plan.frames, 4), tileSize: plan.tileSize, ...(plan.supersample > 1 ? { supersample: plan.supersample } : {}) };
            const img = await r.renderStill(opts);
            r.setRenderQuality('realtime');
            let min = 255;
            let max = 0;
            for (let i = 0; i < img.data.length; i += 4 * 7) {
                const v = img.data[i + 1];
                if (v < min)
                    min = v;
                if (v > max)
                    max = v;
            }
            return { width: img.width, height: img.height, min, max, plan };
        }, pose);
        log(`  final still ${still.width}x${still.height}, plan ${JSON.stringify(still.plan)}`);
        check(still.width === 400 && still.height === 225, 'final still has the wrong size');
        check(still.max - still.min > 20, `final still is flat (green ${still.min}..${still.max})`);
        check((await onRenderer(page, (r) => r.renderTier, null)) !== undefined, 'renderer broken after the still');
        // 3. An area light lights its surroundings.
        const lab = LABS['area'];
        check(lab, 'area lab missing');
        const err = await page.evaluate((patches) => (window.__aether ? (window.__aether.studio.commitUser(patches, 'Lab') ?? '') : 'no studio'), lab.patches);
        check(err === '', `lab rejected: ${err}`);
        await page.evaluate(async () => {
            await window.__aether?.simulation?.whenSynced();
        });
        await onRenderer(page, (r, c) => r.lookAt(c.pos, c.target), lab.cam);
        await settled(page, 'high');
        await page.waitForTimeout(1500);
        const lit = await frame(page);
        // The panel hangs at the left of the wall: the wall right under it is lit, the far right corner of the floor is not.
        const near = lumaMean(lit, 0.38, 0.3, 0.52, 0.5);
        const far = lumaMean(lit, 0.88, 0.8, 0.99, 0.99);
        log(`  area light: lit wall ${near.toFixed(0)}, far corner ${far.toFixed(0)}`);
        check(near > far + 10, `the area light does not light its surroundings (${near.toFixed(1)} vs ${far.toFixed(1)})`);
        // 4. A small path trace.
        if (!SKIP_PT) {
            const t0 = Date.now();
            const traced = await onRenderer(page, async (r, c) => {
                const img = await r.pathTraceStill({ width: 96, height: 54, samples: 2, pose: { pos: c.pos, target: c.target } });
                let min = 255;
                let max = 0;
                for (let i = 0; i < img.data.length; i += 4) {
                    const v = img.data[i + 1];
                    if (v < min)
                        min = v;
                    if (v > max)
                        max = v;
                }
                return { width: img.width, height: img.height, spread: max - min };
            }, lab.cam);
            log(`  path trace ${traced.width}x${traced.height} in ${((Date.now() - t0) / 1000).toFixed(1)} s, spread ${traced.spread}`);
            check(traced.width === 96 && traced.height === 54, 'path-traced still has the wrong size');
            check(traced.spread > 10, 'path-traced still is flat');
            check(!(await onRenderer(page, (r) => r.pathTracing, null)), 'the viewport stayed paused after the path trace');
        }
        // 5. No leak across switches.
        await settled(page, 'medium');
        const before = await onRenderer(page, (r) => r.memoryStats(), null);
        for (let i = 0; i < 12; i++) {
            await onRenderer(page, async (r, n) => {
                const k = n;
                r.setRenderTier(k % 3 === 0 ? 'ultra' : k % 3 === 1 ? 'high' : 'low');
                if (k % 4 === 0)
                    r.setEffects({ ssr: false });
                else
                    r.setEffects({});
                for (let f = 0; f < 4; f++) {
                    r.requestRender();
                    await new Promise((res) => setTimeout(res, 90));
                }
                if (k % 5 === 0)
                    r.setRenderQuality('studio');
                else
                    r.setRenderQuality('realtime');
                for (let f = 0; f < 3; f++) {
                    r.requestRender();
                    await new Promise((res) => setTimeout(res, 90));
                }
            }, i);
        }
        await settled(page, 'medium');
        await page.waitForTimeout(1500);
        const after = await onRenderer(page, (r) => r.memoryStats(), null);
        log(`  GPU objects: geometries ${before.geometries} → ${after.geometries}, textures ${before.textures} → ${after.textures}, materials ${before.materials} → ${after.materials}`);
        check(after.geometries <= before.geometries + 2, `geometries leaked: ${before.geometries} → ${after.geometries}`);
        check(after.textures <= before.textures + 4, `textures leaked: ${before.textures} → ${after.textures}`);
        check(after.materials <= before.materials + 2, `materials leaked: ${before.materials} → ${after.materials}`);
        check(errors.length === 0, `console / page errors: ${errors.join(' | ')}`);
        log(`${name}: OK`);
    }
    finally {
        await context.close();
    }
}
async function main() {
    const server = await startServer(log);
    try {
        for (const name of BROWSERS) {
            const browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
            try {
                await runBrowser(name, browser, server.url);
            }
            finally {
                await browser.close();
            }
        }
        log('RENDER QUALITY E2E PASSED');
    }
    finally {
        await server.stop();
    }
}
main().catch((e) => {
    log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
});

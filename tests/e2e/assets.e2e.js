/**
 * End-to-end check of the asset pipeline in real browsers: Chromium
 * (WebGPU, then forced WebGL2) and Firefox (WebGL2), one browser at a time.
 *
 * 1. Library: the Assets panel opens on the library; searching "couch"
 *    finds the sofa with a rendered thumbnail; category chips filter.
 * 2. Drag the sofa onto the viewport: it lands where it was dropped (the
 *    floor under the cursor), is selected, renders a real model and has a
 *    physics collider (a ray cast down onto it in play mode hits it).
 * 3. An HDR sky tile sets the environment.
 * 4. Imports: a GLB and a PNG import and appear; a junk file is refused
 *    with a message; the imported model renders.
 * 5. Export package: the downloaded .zip contains the world, the sofa's
 *    model file, the imported files and CREDITS.txt naming Kenney; the
 *    credits dialog lists the packs.
 * 6. GPU resources stay flat over 20 place / undo cycles.
 *
 * Run: `npm run build && npm run e2e:assets` (`-- --chromium` / `-- --firefox`,
 * `-- --webgpu` / `-- --webgl2` for one Chromium backend).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { readZip } from '../../apps/studio/src/assets/zip';
import { pngHeader, triangleGlb } from '../../packages/assets/test/fixtures';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';
const VIEWPORT = { width: 1440, height: 900 };
const BOOT_MS = 60_000;
const ARGS = process.argv.slice(2);
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
async function waitFor(page, what, timeoutMs, probe, intervalMs = 200) {
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
/** Asset entities of the current world: id → asset id. */
function assetEntities(page) {
    return page.evaluate(() => Object.values(window.__aether?.history.current.entities ?? {}).flatMap((e) => (e.shape.kind === 'asset' ? [{ id: e.id, asset: e.shape.id, pos: [...e.transform.position] }] : [])));
}
async function run(browser, url, label, forceWebGL2, files) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, acceptDownloads: true });
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
        await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
        await waitFor(page, 'the studio to boot', BOOT_MS, () => page.evaluate(() => {
            const a = window.__aether;
            const st = a?.store.getState();
            if (st?.fatal)
                return `fatal: ${st.fatal}`;
            return a && a.simulation !== null && st?.loading === null ? true : null;
        }));
        const backend = await page.evaluate(() => window.__aether?.simulation?.backend ?? '?');
        log(`[${label}] booted on ${backend}`);
        check(!forceWebGL2 || backend === 'webgl2', `[${label}] expected WebGL2, got ${backend}`);
        // Start from an empty world with a ground plane so the drop target is known.
        await page.evaluate(() => window.__aether?.studio.commitUser([{ op: 'clear' }], 'Clear'));
        // 1. Library search with thumbnails.
        await page.getByRole('tab', { name: 'Assets' }).click();
        const search = page.getByLabel('Search assets');
        await search.fill('couch');
        const tile = page.getByRole('button', { name: 'Add Sofa', exact: true });
        await tile.waitFor({ state: 'visible', timeout: 15_000 });
        const thumbOk = await waitFor(page, 'the sofa thumbnail', 15_000, () => tile.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false));
        check(thumbOk, `[${label}] the sofa thumbnail did not load`);
        await search.fill('');
        await page.getByRole('button', { name: 'Vehicles', exact: true }).click();
        const vehicles = await page.locator('.asset-grid .asset-tile').count();
        check(vehicles >= 10 && vehicles < 60, `[${label}] the Vehicles chip should filter to vehicles (${vehicles} tiles)`);
        await page.getByRole('button', { name: 'Vehicles', exact: true }).click();
        log(`[${label}] library: "couch" → Sofa with thumbnail, Vehicles chip → ${vehicles} tiles`);
        // 2. Drag the sofa onto the viewport.
        await search.fill('sofa');
        const vp = page.locator('.viewport');
        const box = await vp.boundingBox();
        check(box, 'no viewport');
        const target = { x: box.width * 0.55, y: box.height * 0.62 };
        await page.getByRole('button', { name: 'Add Sofa', exact: true }).dragTo(vp, { targetPosition: target });
        const placed = await waitFor(page, 'the sofa entity', 15_000, async () => (await assetEntities(page)).find((e) => e.asset === 'sofa') ?? null);
        check(Math.abs(placed.pos[1] ?? 1) < 0.05, `[${label}] the sofa should stand on the ground (y=${placed.pos[1]})`);
        const selected = await page.evaluate(() => window.__aether?.store.getState().selection ?? []);
        check(selected.includes(placed.id), `[${label}] the dropped sofa should be selected`);
        await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
        const mounted = await waitFor(page, 'the sofa model', 20_000, () => page.evaluate((id) => {
            const r = window.__aether?.simulation?.renderer;
            const node = r?.sync.node(id);
            return node && !node.failed && node.content.children.some((c) => c.name === 'asset') ? true : null;
        }, placed.id));
        check(mounted, `[${label}] the sofa model did not render`);
        // Collider: in play mode a ray straight down onto the sofa hits it.
        await page.evaluate(async () => window.__aether?.studio.togglePlay());
        const hit = await waitFor(page, 'a physics hit on the sofa', 20_000, () => page.evaluate(([id, x, z]) => {
            const pw = window.__aether?.simulation?.physics;
            if (!pw)
                return null;
            const h = pw.raycast([x, 5, z], [0, -1, 0], 10);
            return h?.id === id ? h.point[1] : null;
        }, [placed.id, placed.pos[0], placed.pos[2]]));
        check(hit > 0.2 && hit < 1.2, `[${label}] the sofa collider top should be at seat/back height (${hit})`);
        await page.evaluate(async () => window.__aether?.studio.togglePlay());
        await waitFor(page, 'edit mode', 15_000, () => page.evaluate(() => window.__aether?.store.getState().mode === 'edit'));
        log(`[${label}] dragged sofa → ${placed.id} at (${placed.pos.map((v) => v.toFixed(1)).join(', ')}), model mounted, collider hit at y=${hit.toFixed(2)}`);
        // 3. HDR sky.
        await search.fill('sunset');
        await page.getByRole('button', { name: 'Add Venice Sunset', exact: true }).click();
        await waitFor(page, 'the HDRI', 10_000, () => page.evaluate(() => window.__aether?.history.current.environment.hdri === 'sky-venice-sunset'));
        log(`[${label}] HDR sky tile set environment.hdri`);
        // 4. Imports (GLB + PNG accepted, junk refused).
        await search.fill('');
        await page.getByRole('radio', { name: 'Imports' }).click();
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /Import files/ }).click();
        await (await chooser).setFiles([files.glb, files.png, files.junk]);
        await waitFor(page, 'two imports', 20_000, () => page.evaluate(() => (window.__aether?.studio.assets.state.getState().imports.length ?? 0) >= 2));
        const refused = await waitFor(page, 'the refusal toast', 10_000, () => page.evaluate(() => window.__aether?.store.getState().toasts.some((t) => /junk\.bin/.test(t.text)) ?? false));
        check(refused, `[${label}] the junk file should be refused`);
        const imported = (await assetEntities(page)).filter((e) => e.asset.startsWith('user-'));
        check(imported.length >= 1, `[${label}] the imported model should be placed`);
        log(`[${label}] imports: GLB + PNG accepted, junk refused, ${imported.length} placed`);
        // 5. Export package and credits.
        const download = page.waitForEvent('download');
        await page.evaluate(() => void window.__aether?.studio.assets.exportPackage());
        const dl = await download;
        const path = await dl.path();
        check(path, 'no download path');
        const zip = await readZip(new Uint8Array(readFileSync(path)));
        check(zip.ok, `[${label}] the package is not a valid zip`);
        const names = zip.entries.map((e) => e.name);
        check(names.includes('world.aether.json') && names.includes('CREDITS.txt'), `[${label}] package files: ${names.join(', ')}`);
        check(names.some((n) => /^assets\/lib\/m\/sofa\.[0-9a-f]{8}\.glb$/.test(n)), `[${label}] the sofa model is missing from the package`);
        check(names.some((n) => /^assets\/user-[0-9a-f]{12}\.glb$/.test(n)), `[${label}] the imported model is missing from the package`);
        const credits = new TextDecoder().decode(zip.entries.find((e) => e.name === 'CREDITS.txt').data);
        check(/Kenney/.test(credits) && /Poly Haven/.test(credits), `[${label}] CREDITS.txt should credit Kenney and Poly Haven`);
        await page.evaluate(() => window.__aether?.studio.assets.setCreditsOpen(true));
        await page.getByRole('dialog', { name: 'Credits' }).getByText('Kenney Furniture Kit').first().waitFor({ timeout: 5_000 });
        await page.keyboard.press('Escape');
        log(`[${label}] package: ${names.length} files (${(readFileSync(path).byteLength / 1024).toFixed(0)} KB) incl. sofa model, import and CREDITS.txt; credits dialog lists Kenney`);
        // 6. GPU resources stay flat over 20 place / undo cycles.
        const gpu = () => page.evaluate(() => {
            const m = window.__aether.simulation.memoryStats();
            return { geometries: m?.geometries ?? 0, textures: m?.textures ?? 0 };
        });
        const cycle = async () => {
            await page.evaluate(async () => {
                await window.__aether?.studio.assets.place('armchair-classic');
                await window.__aether?.simulation?.whenSynced();
            });
            await page.waitForTimeout(150);
            await page.evaluate(async () => {
                window.__aether?.studio.undo();
                await window.__aether?.simulation?.whenSynced();
            });
            await page.waitForTimeout(100);
        };
        await cycle();
        await page.waitForTimeout(600);
        const base = await gpu();
        for (let i = 0; i < 20; i++)
            await cycle();
        await page.waitForTimeout(800);
        const after = await gpu();
        check(after.geometries <= base.geometries + 6 && after.textures <= base.textures + 4, `[${label}] GPU resources grew over 20 place/undo cycles: ${JSON.stringify(base)} → ${JSON.stringify(after)}`);
        log(`[${label}] 20 place/undo cycles: geometries ${base.geometries}→${after.geometries}, textures ${base.textures}→${after.textures}`);
        check(errors.length === 0, `[${label}] page errors: ${errors.slice(0, 5).join(' | ')}`);
    }
    catch (e) {
        const shot = join(tmpdir(), `aether-assets-e2e-${label}.png`);
        await page.screenshot({ path: shot }).catch(() => undefined);
        log(`[${label}] failure screenshot: ${shot}`);
        throw e;
    }
    finally {
        await context.close();
    }
}
async function main() {
    const dir = mkdtempSync(join(tmpdir(), 'aether-assets-e2e-'));
    const files = { glb: join(dir, 'triangle.glb'), png: join(dir, 'poster.png'), junk: join(dir, 'junk.bin') };
    writeFileSync(files.glb, triangleGlb({ translate: [3, 1, 0] }));
    writeFileSync(files.png, pngHeader(64, 32));
    writeFileSync(files.junk, new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]));
    const server = await startServer(log);
    let browser = null;
    const only = ARGS.find((a) => a === '--chromium' || a === '--firefox');
    try {
        if (only !== '--firefox') {
            browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
            if (!ARGS.includes('--webgl2'))
                await run(browser, server.url, 'chromium-webgpu', false, files);
            if (!ARGS.includes('--webgpu'))
                await run(browser, server.url, 'chromium-webgl2', true, files);
            await browser.close();
            browser = null;
        }
        if (only !== '--chromium') {
            browser = await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
            await run(browser, server.url, 'firefox-webgl2', false, files);
            await browser.close();
            browser = null;
        }
    }
    finally {
        await browser?.close().catch(() => undefined);
        await server.stop();
        rmSync(dir, { recursive: true, force: true });
    }
    log('assets e2e passed');
}
main().catch((err) => {
    log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exitCode = 1;
});

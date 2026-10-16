/**
 * End-to-end check of hand editing in real browsers: Chromium (default
 * backend policy: WebGPU) then Firefox (WebGL2), one browser at a time.
 *
 * Starting from the starter scene it drives the editor like a user:
 *
 *  1. select a crate in the outliner → move it with the gizmo (W, drag the
 *     centre handle) → one undoable edit → Ctrl+Z restores it;
 *  2. change a generator parameter with its inspector slider → the
 *     procedural mesh regenerates;
 *  3. bake an object to an editable mesh → Tab → click its top face →
 *     extrude → the mesh and its physics collider grow;
 *  4. sculpt a terrain with the brush (S) → one stroke = one undo step;
 *  5. paint a scatter of grass on it (T);
 *  6. edit a rule card (WHEN start → ADD points 7) → Play → the logic runs.
 *
 * Any console error or uncaught page error fails the run.
 * Run: `npm run build && npm run e2e:editing` (`-- --firefox` or
 * `-- --chromium` for one browser).
 */
import { chromium, firefox } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';
const VIEWPORT = { width: 1440, height: 900 };
const BOOT_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 20_000;
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
/** Wait until the renderer shows exactly the current document. */
async function synced(page) {
    await waitFor(page, 'the renderer to sync', STEP_TIMEOUT_MS, () => page.evaluate(async () => {
        const a = window.__aether;
        if (!a?.simulation)
            return false;
        await a.simulation.whenSynced();
        return a.simulation.syncedWorld === a.history.current;
    }));
}
/** Screen position (page CSS pixels) of a world point. */
function screenOf(page, p) {
    return page.evaluate((w) => {
        const sim = window.__aether?.simulation;
        const canvas = document.querySelector('.viewport__host canvas');
        if (!sim || !canvas)
            return null;
        const cam = sim.renderer.camera;
        cam.updateMatrixWorld();
        const v = cam.matrixWorldInverse.elements;
        const pr = cam.projectionMatrix.elements;
        // No helper functions in here: the bundler would wrap them in a helper that does not exist in the page.
        const e = [0, 0, 0, 0];
        for (let r = 0; r < 4; r++)
            e[r] = v[r] * w[0] + v[4 + r] * w[1] + v[8 + r] * w[2] + v[12 + r];
        const c = [0, 0, 0, 0];
        for (let r = 0; r < 4; r++)
            c[r] = pr[r] * e[0] + pr[4 + r] * e[1] + pr[8 + r] * e[2] + pr[12 + r] * e[3];
        const cw = c[3];
        if (cw <= 0)
            return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + ((c[0] / cw + 1) / 2) * rect.width, y: rect.top + ((1 - c[1] / cw) / 2) * rect.height };
    }, p);
}
/** World bounds of an entity as rendered. */
function boundsOf(page, id) {
    return page.evaluate((eid) => window.__aether?.simulation?.entityBounds(eid) ?? null, id);
}
async function centerOf(page, id) {
    const b = await waitFor(page, `bounds of ${id}`, STEP_TIMEOUT_MS, () => boundsOf(page, id));
    const s = await screenOf(page, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
    check(s, `${id} is behind the camera`);
    return s;
}
function head(page) {
    return page.evaluate(() => window.__aether?.history.head ?? -1);
}
/** Message of the history entry at the current position (not the end of a redo tail). */
function lastMessage(page) {
    return page.evaluate(() => {
        const h = window.__aether?.history;
        return h?.entries().find((e) => e.id === h.head)?.message ?? '';
    });
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
    await synced(page);
    // Settle the first camera flight before projecting points.
    await page.waitForTimeout(1800);
    return page.evaluate(() => window.__aether?.store.getState().backend ?? 'none');
}
/** Show a left panel view through the icon rail. */
async function showView(page, label) {
    const rail = page.locator(`.rail__btn[aria-label="${label}"]`).first();
    if ((await rail.getAttribute('aria-selected')) !== 'true' && (await rail.getAttribute('aria-pressed')) !== 'true')
        await rail.click();
    else
        await page.waitForTimeout(50);
}
// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
async function moveWithGizmo(page) {
    const id = await page.evaluate(() => Object.keys(window.__aether?.history.current.entities ?? {}).find((k) => k.startsWith('crate')) ?? null);
    check(id, 'the starter scene has no crate');
    await showView(page, 'Objects');
    await page.locator(`.outliner-row[data-id="${id}"]`).click();
    await waitFor(page, 'selection', 5000, () => page.evaluate((x) => window.__aether?.store.getState().selection.includes(x) ?? false, id));
    await page.locator('.viewport__host canvas').hover();
    await page.keyboard.press('w');
    await page.waitForTimeout(400);
    const before = await page.evaluate((x) => JSON.stringify(window.__aether?.history.current.entities[x]?.transform), id);
    const h0 = await head(page);
    const origin = await page.evaluate((x) => {
        const e = window.__aether?.history.current.entities[x];
        return e ? e.transform.position : null;
    }, id);
    check(origin, 'crate has no transform');
    const at = await screenOf(page, origin);
    check(at, 'crate is off screen');
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(100);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++)
        await page.mouse.move(at.x + i * 9, at.y - i * 2);
    await page.mouse.up();
    await waitFor(page, 'the gizmo commit', STEP_TIMEOUT_MS, async () => (await head(page)) !== h0);
    const msg = await lastMessage(page);
    check(/^Move /.test(msg), `expected a "Move" history entry, got "${msg}"`);
    const after = await page.evaluate((x) => JSON.stringify(window.__aether?.history.current.entities[x]?.transform), id);
    check(after !== before, 'the gizmo drag did not change the transform');
    await page.locator('.viewport__host canvas').hover();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await waitFor(page, 'undo', 5000, async () => (await page.evaluate((x) => JSON.stringify(window.__aether?.history.current.entities[x]?.transform), id)) === before);
    log(`  gizmo: moved ${id} (${msg}) and undid it`);
}
async function editGeneratorParam(page) {
    await page.evaluate(() => window.__aether?.store.getState().setTool('select'));
    await page.locator('.outliner-row[data-id="tent-1"]').click();
    await waitFor(page, 'tent selected', 5000, () => page.evaluate(() => window.__aether?.store.getState().selection[0] === 'tent-1'));
    await synced(page);
    const outBefore = await page.evaluate(() => {
        const o = window.__aether?.simulation?.renderer.getGeneratorOutput('tent-1');
        window.__out = o;
        return o ? o.stats.triangles : -1;
    });
    check(outBefore > 0, 'tent has no generator output');
    const slider = page.locator('.panel--right .section input[type="range"]').first();
    await slider.waitFor({ state: 'visible', timeout: 5000 });
    const label = await slider.getAttribute('aria-label');
    const paramsBefore = await page.evaluate(() => JSON.stringify(window.__aether?.history.current.entities['tent-1']?.shape));
    await slider.focus();
    for (let i = 0; i < 8; i++)
        await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await waitFor(page, 'the parameter commit', STEP_TIMEOUT_MS, async () => (await page.evaluate(() => JSON.stringify(window.__aether?.history.current.entities['tent-1']?.shape))) !== paramsBefore);
    await synced(page);
    const changed = await waitFor(page, 'the regenerated mesh', STEP_TIMEOUT_MS, () => page.evaluate(() => {
        const o = window.__aether?.simulation?.renderer.getGeneratorOutput('tent-1');
        return !!o && o !== window.__out;
    }));
    check(changed, 'the procedural mesh did not regenerate');
    log(`  parameter "${label}" changed: ${await lastMessage(page)}; mesh regenerated`);
}
async function bakeAndExtrude(page) {
    const id = await page.evaluate(() => Object.keys(window.__aether?.history.current.entities ?? {}).filter((k) => k.startsWith('crate')).pop() ?? null);
    check(id, 'no crate to bake');
    await page.locator(`.outliner-row[data-id="${id}"]`).click();
    await waitFor(page, 'crate selected', 5000, () => page.evaluate((x) => window.__aether?.store.getState().selection[0] === x, id));
    await page.locator('[data-testid="bake-mesh"]').click();
    await waitFor(page, 'the bake', STEP_TIMEOUT_MS, () => page.evaluate((x) => window.__aether?.history.current.entities[x]?.shape.kind === 'mesh', id));
    await synced(page);
    const before = await page.evaluate((x) => {
        const w = window.__aether?.history.current;
        const e = w?.entities[x];
        const mesh = e && e.shape.kind === 'mesh' ? w?.meshes[e.shape.mesh] : undefined;
        const c = window.__aether?.simulation?.renderer.getGeneratorOutput(x)?.colliders[0];
        let maxY = -Infinity;
        const pts = c && c.kind === 'trimesh' ? c.positions : c && c.kind === 'hull' ? c.points : null;
        if (pts)
            for (let i = 1; i < pts.length; i += 3)
                maxY = Math.max(maxY, pts[i]);
        return mesh ? { tris: mesh.triangleCount, maxY, kind: c?.kind ?? 'none' } : null;
    }, id);
    check(before && Number.isFinite(before.maxY), 'the baked mesh has no mesh collider');
    await page.locator('[data-testid="edit-mesh"]').click();
    await waitFor(page, 'mesh editing', 5000, () => page.evaluate(() => window.__aether?.store.getState().meshEdit !== null));
    const b = await waitFor(page, `bounds of ${id}`, STEP_TIMEOUT_MS, () => boundsOf(page, id));
    const top = await screenOf(page, [(b.min[0] + b.max[0]) / 2, b.max[1] - 0.001, (b.min[2] + b.max[2]) / 2]);
    check(top, 'top face is off screen');
    // The top face is seen from above: click just inside its centre.
    await page.mouse.click(top.x, top.y + 2);
    await waitFor(page, 'a face selection', 5000, () => page.evaluate(() => (window.__aether?.store.getState().meshEdit?.faces.length ?? 0) > 0));
    await page.locator('[data-testid="mesh-extrude"]').click();
    const after = await waitFor(page, 'the extrusion', STEP_TIMEOUT_MS, () => page.evaluate((x) => {
        const w = window.__aether?.history.current;
        const e = w?.entities[x];
        const mesh = e && e.shape.kind === 'mesh' ? w?.meshes[e.shape.mesh] : undefined;
        return mesh && mesh.triangleCount > 12 ? { tris: mesh.triangleCount } : null;
    }, id));
    await synced(page);
    const collider = await page.evaluate((x) => {
        const c = window.__aether?.simulation?.renderer.getGeneratorOutput(x)?.colliders[0];
        let maxY = -Infinity;
        const pts = c && c.kind === 'trimesh' ? c.positions : c && c.kind === 'hull' ? c.points : null;
        if (pts)
            for (let i = 1; i < pts.length; i += 3)
                maxY = Math.max(maxY, pts[i]);
        return maxY;
    }, id);
    check(collider > (before?.maxY ?? 0) + 0.1, `the collider did not follow the extrusion (${before?.maxY} → ${collider})`);
    await page.keyboard.press('Escape');
    await waitFor(page, 'leaving mesh editing', 5000, () => page.evaluate(() => window.__aether?.store.getState().meshEdit === null));
    log(`  baked ${id}: ${before?.tris} → ${after.tris} triangles, ${before?.kind} collider top ${before?.maxY.toFixed(2)} → ${collider.toFixed(2)} m`);
    return id;
}
async function sculptTerrain(page) {
    const target = await page.evaluate(() => {
        const sim = window.__aether?.simulation;
        return sim ? sim.renderer.orbitTarget() : null;
    });
    check(target, 'no orbit target');
    await page.evaluate((t) => {
        const studio = window.__aether?.studio;
        studio?.commitUser([{ op: 'add', entity: { id: 'e2e-terrain', name: 'Test terrain', transform: { position: [t[0], 0.05, t[2]] }, shape: { kind: 'procedural', generator: 'terrain', params: { size: 16, height: 0.5 }, seed: 3 }, physics: { body: 'static' } } }], 'Add test terrain');
        window.__aether?.store.getState().select([]);
    }, target);
    await synced(page);
    await page.waitForTimeout(800);
    const c = await centerOf(page, 'e2e-terrain');
    await page.mouse.move(c.x, c.y);
    await page.keyboard.press('s');
    await waitFor(page, 'the sculpt tool', 5000, () => page.evaluate(() => window.__aether?.store.getState().tool === 'sculpt'));
    const h0 = await head(page);
    await page.mouse.move(c.x - 40, c.y);
    await page.mouse.down();
    for (let i = 0; i <= 12; i++) {
        await page.mouse.move(c.x - 40 + i * 7, c.y + Math.sin(i / 2) * 6);
        await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await waitFor(page, 'the sculpt commit', STEP_TIMEOUT_MS, async () => /^Sculpt/.test(await lastMessage(page)));
    const h1 = await head(page);
    check(h1 - h0 === 2, `expected two history entries (convert + stroke), got ${h1 - h0}`);
    const positions = () => page.evaluate(() => {
        const w = window.__aether?.history.current;
        const e = w?.entities['e2e-terrain'];
        return e && e.shape.kind === 'mesh' ? JSON.stringify(w?.meshes[e.shape.mesh]?.positions) : '';
    });
    const sculpted = await positions();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await waitFor(page, 'undo of the stroke', 5000, async () => (await head(page)) !== h1);
    const unsculpted = await positions();
    check(unsculpted !== '' && unsculpted !== sculpted, 'undo did not restore the unsculpted mesh');
    check((await lastMessage(page)).startsWith('Convert'), 'one undo should remove exactly the stroke');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
    await waitFor(page, 'redo of the stroke', 5000, async () => (await head(page)) === h1);
    log(`  sculpted the terrain (${await lastMessage(page)}), undo/redo per stroke ok`);
}
async function paintScatter(page) {
    await synced(page);
    const c = await centerOf(page, 'e2e-terrain');
    await page.keyboard.press('t');
    await waitFor(page, 'the scatter tool', 5000, () => page.evaluate(() => window.__aether?.store.getState().tool === 'scatter'));
    await page.evaluate(() => window.__aether?.store.getState().setBrush({ scatterItem: 'grass-tuft', density: 6, size: 3, erase: false }));
    await page.mouse.move(c.x - 30, c.y);
    await page.mouse.down();
    for (let i = 0; i <= 10; i++) {
        await page.mouse.move(c.x - 30 + i * 6, c.y + 3);
        await page.waitForTimeout(30);
    }
    await page.mouse.up();
    const painted = await waitFor(page, 'a painted scatter', STEP_TIMEOUT_MS, () => page.evaluate(() => {
        const w = window.__aether?.history.current;
        const e = w ? Object.values(w.entities).find((x) => x.shape.kind === 'scatter' && Array.isArray(x.shape.points)) : undefined;
        return e && e.shape.kind === 'scatter' && (e.shape.points?.length ?? 0) > 0 ? { id: e.id, n: e.shape.points?.length ?? 0 } : null;
    }));
    await page.keyboard.press('Escape');
    log(`  painted ${painted.n} grass tufts into ${painted.id}`);
}
async function editRuleAndPlay(page) {
    await page.evaluate(() => window.__aether?.store.getState().setTool('select'));
    await showView(page, 'Logic');
    await page.locator('[data-testid="rule-add"]').click();
    const ruleId = await waitFor(page, 'the new rule', 5000, () => page.evaluate(() => window.__aether?.history.current.rules.at(-1)?.id ?? null));
    await page.locator(`[data-testid="rule-edit-${ruleId}"]`).click();
    const editor = page.locator('[data-testid="rule-editor"]');
    await editor.waitFor({ state: 'visible', timeout: 5000 });
    await editor.locator('select[aria-label="Action"]').selectOption('add');
    const variable = editor.locator('.rule-editor__action input[aria-label="Variable"]');
    await variable.fill('e2e_points');
    await variable.press('Enter');
    const amount = editor.locator('.rule-editor__action input[aria-label="Amount"]');
    await amount.fill('7');
    await amount.press('Enter');
    await editor.locator('[data-testid="rule-save"]').click();
    await waitFor(page, 'the edited rule', 5000, () => page.evaluate((rid) => {
        const r = window.__aether?.history.current.rules.find((x) => x.id === rid);
        const a = r?.then[0];
        return !!a && a.do === 'add' && a.key === 'e2e_points' && a.amount === 7;
    }, ruleId));
    await page.locator('button.play-btn').click();
    const value = await waitFor(page, 'the rule to fire in play', STEP_TIMEOUT_MS, () => page.evaluate(() => {
        const logic = window.__aether?.simulation?.logic;
        const v = logic?.readState('e2e_points');
        return typeof v === 'number' && v >= 7 ? v : null;
    }));
    await page.locator('button.play-btn').click();
    await waitFor(page, 'edit mode', STEP_TIMEOUT_MS, () => page.evaluate(() => window.__aether?.store.getState().mode === 'edit' && !window.__aether?.store.getState().modeBusy));
    log(`  rule ${ruleId} edited to "add e2e_points 7"; in play e2e_points = ${value}`);
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
        await moveWithGizmo(page);
        await editGeneratorParam(page);
        await bakeAndExtrude(page);
        await sculptTerrain(page);
        await paintScatter(page);
        await editRuleAndPlay(page);
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
        log('EDITING E2E PASSED');
    }
    finally {
        await browser?.close();
        await server.stop();
    }
}
main().catch((err) => {
    log(`EDITING E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
});

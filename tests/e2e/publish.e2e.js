/**
 * Publishing end to end, in Chromium then Firefox (one browser at a time),
 * against the built studio served by the server in mock mode:
 *
 *  1. the Publish hub opens from the top bar on a template world;
 *  2. Render: a 1920×1080 PNG still (dimensions and real pixels checked);
 *  3. Video: a directed 1.5 s shot rendered and muxed in the browser
 *     (MP4 or WebM header checked; the <video> element plays it with the
 *     right duration);
 *  4. 3D model: a GLB export, parsed back with the glTF loader in the page
 *     ("verified") and re-read here (glTF magic, JSON chunk with meshes);
 *  5. Share link: the world travels in the URL fragment; a fresh context
 *     opens /play#w=… and plays the same world; malformed, hostile and
 *     oversized fragments show an error screen instead;
 *  6. Game: the zip downloads, unpacks (our reader, checksums), is served by
 *     a plain static server (no special headers, like itch.io) and the
 *     extracted build boots to its title screen and starts playing;
 *  7. History and versions list what was published and saved;
 *  8. Floor plan: an apartment built by the planner exports an SVG with its rooms.
 *
 * Run: `npm run build && npm run e2e:publish` (`-- --chromium` / `-- --firefox`).
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { chromium, firefox } from 'playwright';
import { readZip } from '../../packages/assets/src/zip';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, SKIP_FIRST_RUN, startServer } from './support/env';
import { decodePng } from './support/png';
const ARGS = process.argv.slice(2);
const BROWSERS = ARGS.includes('--firefox') ? ['firefox'] : ARGS.includes('--chromium') ? ['chromium'] : ['chromium', 'firefox'];
const BOOT_MS = 120_000;
const JOB_MS = 300_000;
/** Optional directory for review screenshots (`AETHER_PUBLISH_SHOTS=dir`). */
const SHOTS = process.env['AETHER_PUBLISH_SHOTS'] ?? '';
async function shot(page, name) {
    if (!SHOTS)
        return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}
const BENIGN_CONSOLE = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];
const startedAt = performance.now();
function log(line) {
    process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}
function check(cond, message) {
    if (!cond)
        throw new Error(message);
}
function watch(page, errors, label) {
    page.on('console', (m) => {
        if (m.type() !== 'error')
            return;
        const text = m.text();
        if (!BENIGN_CONSOLE.some((re) => re.test(text)))
            errors.push(`[${label}] console.error: ${text.slice(0, 300)}`);
    });
    page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message.slice(0, 300)}`));
}
async function bytesOf(d) {
    const p = await d.path();
    if (!p)
        throw new Error('download has no path');
    return new Uint8Array(readFileSync(p));
}
async function waitJob(page, what) {
    const deadline = Date.now() + JOB_MS;
    for (;;) {
        const state = await page.evaluate(() => {
            const s = window.__aether?.studio.publish.state.getState();
            return s?.job ? { running: s.job.running, error: s.job.error, label: s.job.label, detail: s.result?.detail ?? null } : null;
        });
        if (state && !state.running) {
            check(!state.error, `${what} failed: ${state.error}`);
            check(state.detail, `${what} finished without a result`);
            return state.detail;
        }
        if (Date.now() > deadline)
            throw new Error(`${what} timed out (${state?.label ?? 'no job'})`);
        await page.waitForTimeout(500);
    }
}
/** Serve a directory like a plain static host (no CSP or other headers). */
async function staticHost(dir) {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
    const root = normalize(dir + sep);
    const server = createServer((req, res) => {
        let path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        if (path.endsWith('/'))
            path += 'index.html';
        const file = normalize(join(dir, path));
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
        res.end(readFileSync(file));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => {
            server.closeAllConnections();
            server.close(() => r());
        }),
    };
}
async function bootEditor(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const a = window.__aether;
        const st = a?.store.getState();
        if (!a || a.simulation === null || st?.loading !== null || st.agentBusy)
            return false;
        const last = st.chat[st.chat.length - 1];
        return !last || last.role !== 'assistant' || last.status === 'done';
    }, null, { timeout: BOOT_MS, polling: 250 });
    await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
}
async function editorFlow(browser, name, base, errors) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    const page = await ctx.newPage();
    watch(page, errors, `${name}/studio`);
    try {
        await bootEditor(page, `${base}/?debug=1#/new/coin-island`);
        const entities = await page.evaluate(() => Object.keys(window.__aether?.history.current.entities ?? {}).length);
        const backend = await page.evaluate(() => window.__aether?.simulation?.backend ?? '?');
        log(`  [${name}] coin island built on ${backend}: ${entities} entities`);
        // 1. The hub.
        await page.getByTestId('topbar-publish').click();
        await page.getByTestId('publish-hub').waitFor({ timeout: 15_000 });
        log(`  [${name}] publish hub open`);
        await shot(page, `${name}-hub-game`);
        // 2. Render still.
        await page.getByTestId('publish-target-render').click();
        await page.getByTestId('publish-still-export').click();
        const stillDetail = await waitJob(page, 'still');
        const stillDl = page.waitForEvent('download');
        await page.getByTestId('publish-download').click();
        const png = decodePng(await bytesOf(await stillDl));
        check(png.width === 1920 && png.height === 1080, `still is ${png.width}×${png.height}`);
        let sum = 0;
        let sum2 = 0;
        for (let i = 0; i < png.data.length; i += 4 * 97) {
            const l = 0.2126 * (png.data[i] ?? 0) + 0.7152 * (png.data[i + 1] ?? 0) + 0.0722 * (png.data[i + 2] ?? 0);
            sum += l;
            sum2 += l * l;
        }
        const n = png.data.length / (4 * 97);
        const sd = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
        check(sd > 8, `still looks blank (luminance sd ${sd.toFixed(1)})`);
        log(`  [${name}] still: ${stillDetail}`);
        // 3. Video: a directed 1.5 s shot at 720p.
        await page.getByTestId('publish-target-video').click();
        await page.getByTestId('camera-timeline').waitFor({ timeout: 10_000 });
        await page.getByTestId('publish-direct-input').fill('slow orbit around the island for 1.5 seconds');
        await page.getByTestId('publish-direct').click();
        await page.getByTestId('publish-direct-note').waitFor({ timeout: 30_000 });
        const keys = await page.evaluate(() => window.__aether?.studio.publish.state.getState().path.keys.length ?? 0);
        await page.waitForTimeout(600);
        await shot(page, `${name}-hub-video`);
        check(keys >= 2, `the director produced ${keys} keys`);
        await page.evaluate(() => {
            const p = window.__aether?.studio.publish;
            p?.stopPreview();
            p?.setVideo({ preset: '720p', fps: 24, music: 'calm' });
        });
        await page.getByTestId('publish-video-export').click();
        const videoDetail = await waitJob(page, 'video');
        const duration = await page.evaluate(() => new Promise((resolve) => {
            const v = document.querySelector('[data-testid="publish-video"]');
            if (!v)
                return resolve(-1);
            if (v.error)
                return resolve(-2);
            if (v.readyState >= 1)
                return resolve(v.duration);
            v.addEventListener('loadedmetadata', () => resolve(v.duration), { once: true });
            v.addEventListener('error', () => resolve(-2), { once: true });
            setTimeout(() => resolve(-3), 15_000);
        }));
        check(duration > 1.2 && duration < 1.9, `video duration ${duration} (${videoDetail})`);
        const videoDl = page.waitForEvent('download');
        await page.getByTestId('publish-download').click();
        const video = await bytesOf(await videoDl);
        const isMp4 = String.fromCharCode(...video.subarray(4, 8)) === 'ftyp';
        const isWebm = video[0] === 0x1a && video[1] === 0x45 && video[2] === 0xdf && video[3] === 0xa3;
        check(isMp4 || isWebm, 'video is neither MP4 nor WebM');
        log(`  [${name}] video: ${videoDetail} (${isMp4 ? 'MP4' : 'WebM'}, plays ${duration.toFixed(2)} s)`);
        // 4. 3D model.
        await page.getByTestId('publish-target-model').click();
        await page.getByTestId('publish-model-export').click();
        const modelDetail = await waitJob(page, 'model');
        check(/verified/.test(modelDetail), `model was not verified: ${modelDetail}`);
        const glbDl = page.waitForEvent('download');
        await page.getByTestId('publish-download').click();
        const glb = await bytesOf(await glbDl);
        check(String.fromCharCode(...glb.subarray(0, 4)) === 'glTF', 'GLB magic missing');
        const jsonLen = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
        check((json.meshes?.length ?? 0) > 3 && (json.materials?.length ?? 0) > 0, 'GLB has no meshes / materials');
        log(`  [${name}] model: ${modelDetail}`);
        // GPU resources stay flat over repeated captures (capture targets are reused / evicted, copies disposed).
        const gpu = async () => page.evaluate(() => {
            const r = window.__aether?.simulation?.renderer.stats();
            return `${r?.geometries ?? -1}/${r?.textures ?? -1}`;
        });
        const cycle = async () => {
            await page.evaluate(() => {
                const p = window.__aether?.studio.publish;
                p?.setStill({ preset: 'custom', width: 640, height: 360 });
            });
            await page.evaluate(() => window.__aether?.studio.publish.exportStill());
            await page.evaluate(() => window.__aether?.studio.publish.exportModel());
        };
        await cycle();
        const before = await gpu();
        for (let i = 0; i < 4; i++)
            await cycle();
        const after = await gpu();
        check(before === after, `GPU objects grew over capture cycles: ${before} → ${after}`);
        log(`  [${name}] GPU objects flat over 4 still + model cycles (${after} geometries/textures)`);
        // 5. Share link → fresh context plays the same world.
        await page.getByTestId('publish-target-share').click();
        await page.waitForFunction(() => (document.querySelector('[data-testid="publish-share-link"]')?.value ?? '').includes('#w='), null, { timeout: 20_000 });
        const link = await page.getByTestId('publish-share-link').inputValue();
        check(link.startsWith(`${base}/play#w=`), `unexpected link ${link.slice(0, 60)}`);
        const qr = await page.getByTestId('publish-share-qr').count();
        await shot(page, `${name}-hub-share`);
        log(`  [${name}] share link: ${link.length} characters${qr ? ', with QR code' : ''}`);
        await playerFlow(browser, name, link, entities, errors);
        // 6. Game zip → static host → title screen → play.
        await page.getByTestId('publish-target-game').click();
        const zipDl = page.waitForEvent('download', { timeout: JOB_MS });
        await page.getByTestId('publish-game-download').click();
        const zipBytes = await bytesOf(await zipDl);
        await waitJob(page, 'game');
        await zipFlow(browser, name, zipBytes, entities, errors);
        // 7. History and versions.
        await page.getByRole('button', { name: /History/ }).first().click();
        await page.getByTestId('publish-history').waitFor({ timeout: 10_000 });
        const items = await page.locator('.pub-hist').count();
        check(items >= 5, `history shows ${items} items`);
        await page.getByTestId('publish-save-version').click();
        await page.locator('.pub-version').first().waitFor({ timeout: 10_000 });
        log(`  [${name}] history: ${items} items, versions saved`);
        // 8. Floor plan from a building.
        await page.getByRole('button', { name: 'Close publish' }).click();
        const input = page.getByLabel('Prompt', { exact: true });
        await input.fill('a modern two-bedroom apartment');
        await input.press('Enter');
        await page.waitForFunction(() => {
            const st = window.__aether?.store.getState();
            return st && !st.agentBusy && st.arch.building !== null;
        }, null, { timeout: BOOT_MS, polling: 250 });
        await page.getByTestId('topbar-publish').click();
        await page.getByTestId('publish-target-plan').click();
        await page.getByTestId('publish-plan-export').click();
        await waitJob(page, 'floor plan');
        const planDl = page.waitForEvent('download');
        await page.getByTestId('publish-download').click();
        const svg = new TextDecoder().decode(await bytesOf(await planDl));
        check(svg.startsWith('<svg') && /Bedroom/i.test(svg) && /m²/.test(svg), 'floor plan SVG is missing rooms');
        log(`  [${name}] floor plan: ${Math.round(svg.length / 1024)} KB SVG`);
    }
    finally {
        await ctx.close();
    }
}
async function playerFlow(browser, name, link, entities, errors) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    watch(page, errors, `${name}/player`);
    try {
        await page.goto(link, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('pl-title').waitFor({ timeout: BOOT_MS });
        const got = await page.evaluate(() => window.__aetherPlayer?.entities ?? -1);
        check(got === entities, `player has ${got} entities, the studio ${entities}`);
        await page.waitForTimeout(1500);
        await shot(page, `${name}-player-title`);
        await page.getByTestId('pl-play').click();
        await page.waitForFunction(() => window.__aetherPlayer?.phase === 'playing', null, { timeout: 60_000 });
        await page.keyboard.press('Escape');
        await page.getByTestId('pl-resume').waitFor({ timeout: 10_000 });
        await shot(page, `${name}-player-paused`);
        await page.getByTestId('pl-resume').click();
        await page.waitForFunction(() => window.__aetherPlayer?.phase === 'playing', null, { timeout: 10_000 });
        log(`  [${name}] player: same world (${got} entities), plays, pauses, resumes`);
        // Malformed / hostile / oversized fragments: an error screen, never a crash.
        const origin = new URL(link).origin;
        const hostile = Buffer.from('{"v":1,"world":{"name":"x","__proto__":{"polluted":true}}}').toString('base64url');
        let n = 0;
        // Firefox refuses URLs over 1 MB outright; Chromium gets one over the player's 1.5 MB cap.
        const huge = name === 'firefox' ? 1_000_000 : 1_600_000;
        for (const frag of ['Dgarbage!!', `J${hostile}`, `D${'A'.repeat(huge)}`, 'Z123']) {
            await page.goto(`${origin}/play?case=${n++}#w=${frag}`, { waitUntil: 'domcontentloaded' });
            await page.getByTestId('pl-error').waitFor({ timeout: 30_000 });
            const polluted = await page.evaluate(() => ({})['polluted'] !== undefined);
            check(!polluted, 'prototype polluted');
        }
        await page.goto(`${origin}/play`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('pl-error').getByText('Nothing to play here').waitFor({ timeout: 30_000 });
        log(`  [${name}] player: malformed, hostile and oversized links rejected safely`);
    }
    finally {
        await ctx.close();
    }
}
async function zipFlow(browser, name, zip, entities, errors) {
    const r = await readZip(zip);
    check(r.ok, `zip did not read: ${r.ok ? '' : r.error}`);
    if (!r.ok)
        return;
    const names = r.entries.map((e) => e.name);
    for (const f of ['index.html', 'game.json', 'manifest.webmanifest', 'sw.js', 'cover.png', 'icon-512.png', 'CREDITS.txt', 'README.md'])
        check(names.includes(f), `zip lacks ${f}`);
    check(names.some((n) => n.startsWith('project/') && n.endsWith('.aether.json')), 'zip lacks the project file');
    check(!names.some((n) => /webllm|EditorRoute|AgentPanel/.test(n)), 'editor code leaked into the game build');
    const dir = mkdtempSync(join(tmpdir(), 'aether-game-'));
    const host = await (async () => {
        for (const e of r.entries) {
            const file = join(dir, e.name);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, e.data);
        }
        return staticHost(dir);
    })();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    watch(page, errors, `${name}/game`);
    try {
        // Served from a sub-folder, as itch.io and GitHub Pages do.
        await page.goto(`${host.url}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('pl-title').waitFor({ timeout: BOOT_MS });
        const got = await page.evaluate(() => window.__aetherPlayer?.entities ?? -1);
        check(got === entities, `game build has ${got} entities, the studio ${entities}`);
        await page.getByTestId('pl-play').click();
        await page.waitForFunction(() => window.__aetherPlayer?.phase === 'playing', null, { timeout: 60_000 });
        const size = (zip.byteLength / 1024 / 1024).toFixed(1);
        log(`  [${name}] game zip: ${r.entries.length} files, ${size} MB; the extracted build boots to its title screen and plays`);
    }
    finally {
        await ctx.close();
        await host.close();
        rmSync(dir, { recursive: true, force: true });
    }
}
async function runBrowser(name, base) {
    let browser = null;
    const errors = [];
    try {
        browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
        log(name);
        await editorFlow(browser, name, base, errors);
        check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
        log(`${name} passed`);
    }
    finally {
        await browser?.close();
    }
}
async function main() {
    const server = await startServer(log);
    try {
        for (const name of BROWSERS)
            await runBrowser(name, server.url);
        log('publish e2e passed');
    }
    finally {
        await server.stop();
    }
}
main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
});

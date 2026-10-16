/**
 * Stills and frame-cost measurements of block worlds for look development: opens a bundled block world
 * (`--slug`), optionally sets the render tier / hour, moves the player to a vantage and captures the viewport.
 *
 * Run (against a running dev or preview server): `AETHER_E2E_URL=http://127.0.0.1:5199 npx tsx tests/e2e/voxelshots.e2e.ts --slug=survival-world --out=<dir> [--gpu] [--webgl2] [--tier=high] [--hour=17.5] [--cams=cams.json] [--size=WxH] [--bench]`
 * `cams.json`: `[{ "name": "a", "dx": 0, "dy": 2, "dz": 0, "yaw": 0.5, "pitch": -0.1 }]` — offsets from the spawn; the camera is the player's eye.
 * `--bench` prints the frame cost (ms) per tier for the last camera.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';
const ARGS = process.argv.slice(2);
const arg = (name) => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = resolve(arg('out') ?? '/tmp/aether-voxelshots');
const SLUG = arg('slug') ?? 'survival-world';
const GPU = ARGS.includes('--gpu');
const WEBGL2 = ARGS.includes('--webgl2');
const FIREFOX = ARGS.includes('--firefox');
const BENCH = ARGS.includes('--bench');
const TIER = arg('tier');
const NOPBR = ARGS.includes('--nopbr');
const FRAMES = Number(arg('frames') ?? 90);
const SETTLE = Number(arg('settle') ?? 2500);
const TIERS = (arg('tiers') ?? 'low,medium,high,ultra').split(',');
const HOUR = arg('hour');
const [W, H] = (arg('size') ?? '1600x900').split('x').map(Number);
const CAMS = arg('cams') ? JSON.parse(readFileSync(resolve(arg('cams')), 'utf8')) : [{ name: 'spawn' }];
const GPU_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--disable-vulkan-surface', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const startedAt = performance.now();
function log(line) {
    process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}
async function main() {
    mkdirSync(OUT, { recursive: true });
    const direct = arg('url');
    const server = direct ? { url: direct, stop: async () => undefined } : await startServer(log);
    let browser = null;
    try {
        browser = FIREFOX
            ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })
            : await chromium.launch({ executablePath: findChrome(), args: GPU ? GPU_ARGS : [...CHROME_ARGS] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        await context.addInitScript({ content: SKIP_FIRST_RUN });
        await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
        if (WEBGL2 && !FIREFOX)
            await context.addInitScript({ content: 'try { delete Navigator.prototype.gpu; } catch {}' });
        const page = await context.newPage();
        page.on('pageerror', (err) => log(`  pageerror: ${err.message}`));
        page.on('console', (m) => {
            if (m.type() === 'error' || m.type() === 'warning') {
                const t = m.text();
                if (!/GL Driver Message|GPU stall|WebGL warning|ReadPixels/i.test(t))
                    log(`  console.${m.type()}: ${t.slice(0, 1200)}`);
            }
        });
        await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
            const a = window.__aether;
            if (!a || a.simulation === null)
                return false;
            const st = a.store.getState();
            return st.loading === null && !st.agentBusy && !!a.history.current.voxel;
        }, null, { timeout: 150_000, polling: 250 });
        log(`backend ${await page.evaluate(() => window.__aether?.simulation?.backend ?? '?')}`);
        await page.waitForFunction(() => {
            const v = window.__aether?.simulation?.voxel;
            if (!v?.active)
                return false;
            const s = v.status();
            return s.settled && s.meshed > 0 && !s.compiling;
        }, null, { timeout: 240_000, polling: 300 });
        await page.evaluate(() => void window.__aether?.studio.togglePlay());
        try {
            await page.waitForFunction(() => {
                const hud = window.__aether?.store.getState().voxelHud;
                return !!hud && hud.loading === null;
            }, null, { timeout: 120_000, polling: 300 });
        }
        catch (err) {
            const diag = await page.evaluate(() => {
                const a = window.__aether;
                const v = a?.simulation?.voxel;
                return { hud: a?.store.getState().voxelHud?.loading ?? null, status: v?.status() ?? null, playing: a?.store.getState().mode ?? null };
            });
            log(`loading stuck: ${JSON.stringify(diag)}`);
            throw err;
        }
        await page.addStyleTag({ content: '.nav-hint, .toasts, .toast, .tooltip { display: none !important; }' });
        if (NOPBR)
            await page.evaluate(() => window.__aether?.simulation?.renderer.voxelIfLoaded?.setBlockMaterials(null, null));
        if (TIER)
            await page.evaluate((t) => window.__aether?.simulation?.renderer.setRenderTier(t), TIER);
        const spawn = await page.evaluate(() => {
            const b = window.__aether?.simulation?.voxel?.game?.game.player.body;
            return b ? { x: b.x, y: b.y, z: b.z } : null;
        });
        log(`spawn ${JSON.stringify(spawn)} tier ${await page.evaluate(() => window.__aether?.simulation?.renderer.renderTier)}`);
        for (const cam of CAMS) {
            const hour = cam.hour ?? (HOUR ? Number(HOUR) : undefined);
            await page.evaluate(([c, h]) => {
                const play = window.__aether?.simulation?.voxel?.game;
                if (!play)
                    return;
                const g = play.game;
                if (h !== undefined && g.clock)
                    g.clock.set(g.clock.day, h);
                const b = play.game.player.body;
                const w = window;
                w.__spawn ??= { x: b.x, y: b.y, z: b.z };
                const s = w.__spawn;
                if (c.dx !== undefined || c.dz !== undefined || c.dy !== undefined) {
                    b.x = c.abs ? (c.dx ?? 0) : s.x + (c.dx ?? 0);
                    b.y = c.abs ? (c.dy ?? 0) : s.y + (c.dy ?? 0);
                    b.z = c.abs ? (c.dz ?? 0) : s.z + (c.dz ?? 0);
                    b.vx = 0;
                    b.vy = 0;
                    b.vz = 0;
                }
                for (const m of c.mobs ?? [])
                    play.game.spawnMob(m.kind, b.x + m.dx, b.y + 1, b.z + m.dz);
                play.input.setLook(c.yaw ?? play.input.yawRad, c.pitch ?? 0);
            }, [cam, hour]);
            await page.waitForTimeout(4000);
            const dataUrl = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w, height: h, mime: 'image/png' })) ?? null, [W, H]);
            if (!dataUrl?.startsWith('data:image/png;base64,'))
                throw new Error(`${cam.name}: capture failed`);
            const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
            const stats = pixelStats(decodePng(png));
            writeFileSync(join(OUT, `${cam.name}.png`), png);
            log(`  ${cam.name}: mean ${stats.mean.toFixed(0)}, stddev ${stats.stdDev.toFixed(1)}`);
        }
        if (BENCH) {
            for (const tier of TIERS) {
                await page.evaluate((t) => window.__aether?.simulation?.renderer.setRenderTier(t), tier);
                await page.waitForTimeout(SETTLE);
                const ms = await page.evaluate((n) => new Promise((done) => {
                    const gaps = [];
                    let last = performance.now();
                    const tick = (t) => {
                        gaps.push(t - last);
                        last = t;
                        if (gaps.length < n)
                            requestAnimationFrame(tick);
                        else {
                            const s = gaps.slice(5).sort((a, b) => a - b);
                            done({ mean: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.floor(s.length * 0.95)], n: s.length });
                        }
                    };
                    requestAnimationFrame(tick);
                }), FRAMES);
                log(`  BENCH ${tier}: frame ${ms.mean.toFixed(1)} ms mean, p95 ${ms.p95.toFixed(1)} ms (${ms.n} frames)`);
            }
        }
        await context.close();
        log('VOXELSHOTS DONE');
    }
    finally {
        await browser?.close();
        await server.stop();
    }
}
main().catch((err) => {
    log(`VOXELSHOTS FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
});

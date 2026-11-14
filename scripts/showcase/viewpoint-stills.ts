/**
 * Player stills of a template's own viewpoints (`world.views`), with the renderer's triangle counts at each: opens
 * `/play.html#t=<slug>` (live, no cooked package unless `--cook`), waits for the player to leave `booting` and the world to
 * load, flies to each viewpoint, waits for the still to refine and saves the canvas. Writes `<slug>-v<n>.png` and
 * `stats.json` (drawn triangles per view, scene triangles) to `--out`.
 *
 *   STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/showcase/viewpoint-stills.ts --out=<dir> [--w=1280] [--cook] [--views=0,3] <slug>
 *
 * Headless Chromium draws on SwiftShader by default (CHROME_ARGS), which is slow and heavy on the CPU: on the NVIDIA
 * laptop set `GEN_GPU=nvidia` (WebGL2 on the discrete GPU, works headless; a large world then takes about a minute).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, startServer } from '../../tests/e2e/support/env';

const arg = (n: string): string | undefined => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!slug) throw new Error('usage: viewpoint-stills.ts --out=<dir> <slug>');
const out = arg('out') ?? `probe-out/${slug}-views`;
const W = Number(arg('w') ?? 1280);
const H = Math.round((W * 9) / 16);
const only = arg('views')?.split(',').map(Number);
const log = (s: string): void => void process.stdout.write(`${s}\n`);

type View = { name: string; position: [number, number, number]; target: [number, number, number]; fov?: number };
type P = { phase: string; world: { views?: View[] }; simulation: { renderer: { setCameraPose(...a: number[]): void; setFov?(f: number): void; refineProgress?: number; stats(): { triangles: number; sceneTriangles: number; drawCalls: number }; screenshot(o: object): Promise<string | null> } } };

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const stats: Array<Record<string, unknown>> = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.addInitScript({ content: "try { localStorage.setItem('aether.player.mute', '1'); } catch {}" });
    await page.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 160)}`));
    const t0 = Date.now();
    await page.goto(`${server.url}/play.html#t=${slug}&cook=${process.argv.includes('--cook') ? 'use' : '0'}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: P }).__aetherPlayer?.phase !== undefined && (window as unknown as { __aetherPlayer: P }).__aetherPlayer.phase !== 'booting', null, { timeout: 900_000, polling: 1000 });
    await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 900_000, polling: 1000 });
    log(`loaded in ${Math.round((Date.now() - t0) / 1000)} s`);
    await page.waitForTimeout(5000);
    const views = await page.evaluate(() => (window as unknown as { __aetherPlayer: P }).__aetherPlayer.world.views ?? []);
    for (const [i, v] of views.entries()) {
      if (only && !only.includes(i)) continue;
      await page.evaluate((c) => {
        const r = (window as unknown as { __aetherPlayer: P }).__aetherPlayer.simulation.renderer;
        const dx = c.target[0] - c.position[0], dy = c.target[1] - c.position[1], dz = c.target[2] - c.position[2];
        if (c.fov) r.setFov?.(c.fov);
        r.setCameraPose(c.position[0], c.position[1], c.position[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      }, v);
      await page.waitForTimeout(6000);
      await page.waitForFunction(() => ((window as unknown as { __aetherPlayer: P }).__aetherPlayer.simulation.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 90_000, polling: 500 }).catch(() => log('  (refinement unfinished)'));
      const s = await page.evaluate(() => {
        const st = (window as unknown as { __aetherPlayer: P }).__aetherPlayer.simulation.renderer.stats();
        return { triangles: st.triangles, sceneTriangles: st.sceneTriangles, drawCalls: st.drawCalls };
      });
      const url = await page.evaluate(async ([w, h]) => (await (window as unknown as { __aetherPlayer: P }).__aetherPlayer.simulation.renderer.screenshot({ width: w, height: h, mime: 'image/png' })) ?? null, [W, H] as const);
      if (!url?.startsWith('data:image/png;base64,')) throw new Error(`v${i}: capture failed`);
      writeFileSync(join(out, `${slug}-v${i}.png`), Buffer.from(url.slice(22), 'base64'));
      stats.push({ view: i, name: v.name, ...s });
      log(`v${i} ${v.name}: ${s.triangles} drawn, ${s.sceneTriangles} in scene, ${s.drawCalls} draws`);
    }
  } finally {
    writeFileSync(join(out, 'stats.json'), JSON.stringify(stats, null, 1));
    await browser.close();
    await server.stop();
  }
}
await main();
process.exit(0);

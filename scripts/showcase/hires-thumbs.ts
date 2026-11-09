/**
 * Sharp card stills: opens each template in the player (cooked light, top tier), flies to its cover camera
 * (tests/e2e/support/showcase-cameras.ts) when it has one, waits for the still to refine, and captures the canvas
 * (no UI) at 2560x1440. `scripts/showcase/hires-pack.py` then makes the 1920 lead still and the 1280 / 640 thumbnails.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/showcase/hires-thumbs.ts --out=<dir> [--time=<0..24>] <slug ...>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, findChrome, startServer } from '../../tests/e2e/support/env';
import { COVER_CAMERAS } from '../../tests/e2e/support/showcase-cameras';

const arg = (n: string): string | undefined => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const out = arg('out') ?? 'hires';
const W = Number(arg('w') ?? 2560);
const H = Math.round((W * 9) / 16);
const log = (s: string): void => void process.stdout.write(`${s}\n`);

async function shoot(page: Page, slug: string): Promise<void> {
  const base = (globalThis as { __url?: string }).__url;
  if (arg('editor')) {
    await page.goto(`${base}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const a = (window as unknown as { __aether?: { simulation: unknown; store: { getState(): { loading: unknown; agentBusy: boolean } }; history: { current: { entities: object; voxel?: unknown } } } }).__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      return st.loading === null && !st.agentBusy && (Object.keys(a.history.current.entities).length > 0 || a.history.current.voxel !== undefined);
    }, null, { timeout: 300_000, polling: 250 });
    await page.evaluate(async () => {
      const a = (window as unknown as { __aether: { simulation: { whenSynced(): Promise<void> }; store: { getState(): { setArch(v: object): void; select(ids: string[]): void } } } }).__aether;
      await a.simulation.whenSynced();
      a.store.getState().select([]);
      const walls = new URLSearchParams(location.search).get('walls');
      a.store.getState().setArch({ walls: walls ?? 'up', quality: 'studio' });
      (window as unknown as { __aetherPlayer: unknown }).__aetherPlayer = a;
    });
    await page.waitForFunction(() => (window as unknown as { __aether: { simulation: { renderer: { animating: boolean } } } }).__aether.simulation.renderer.animating === false, null, { timeout: 150_000, polling: 500 }).catch(() => undefined);
  } else {
  await page.goto(`${base}/play.html#t=${slug}&cook=use&tier=ultra`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 500 });
  await page.waitForFunction(() => !!(window as unknown as { __aetherPlayer?: { simulation: unknown } }).__aetherPlayer?.simulation, null, { timeout: 120_000, polling: 250 });
  }
  await page.waitForTimeout(6000);
  const probes = arg('cam')?.split(';').map((v) => v.split(',').map(Number) as [number, number, number, number, number, number, number?]);
  const preset = COVER_CAMERAS[slug];
  const cams = probes ? probes.map((v) => ({ pos: [v[0], v[1], v[2]] as [number, number, number], target: [v[3], v[4], v[5]] as [number, number, number], overGround: v[6] === 1 })) : [preset ?? null];
  const hour = arg('time');
  for (const [i, cam] of cams.entries()) {
    await page.evaluate(
      ([c, t]) => {
        const p = (window as unknown as { __aetherPlayer: { simulation: { voxel?: { groundAt(x: number, z: number): number }; renderer: { setCameraPose(...a: number[]): void; setTimeOfDay?(h: number): void } } } }).__aetherPlayer;
        const sim = p.simulation;
        if (t !== null) sim.renderer.setTimeOfDay?.(Number(t));
        if (!c) return;
        const g = c.overGround ? (sim.voxel?.groundAt(c.target[0], c.target[2]) ?? 0) : 0;
        const ps = [c.pos[0], c.pos[1] + g, c.pos[2]];
        const ts = [c.target[0], c.target[1] + g, c.target[2]];
        const dx = ts[0]! - ps[0]!, dy = ts[1]! - ps[1]!, dz = ts[2]! - ps[2]!;
        sim.renderer.setCameraPose(ps[0]!, ps[1]!, ps[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      },
      [cam ?? null, hour ?? null] as const,
    );
    await page.waitForTimeout(cam?.overGround ? 12_000 : 4000);
    await page
      .waitForFunction(() => ((window as unknown as { __aetherPlayer: { simulation: { renderer: { refineProgress?: number } } } }).__aetherPlayer.simulation.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 60_000, polling: 500 })
      .catch(() => log('  (refinement unfinished)'));
    const url = await page.evaluate(
      async ([w, h]) => (await (window as unknown as { __aetherPlayer: { simulation: { renderer: { screenshot(o: object): Promise<string | null> } } } }).__aetherPlayer.simulation.renderer.screenshot({ width: w, height: h, mime: 'image/png' })) ?? null,
      [W, H] as const,
    );
    if (!url?.startsWith('data:image/png;base64,')) throw new Error(`${slug}: capture failed`);
    const name = probes ? `${slug}-p${i}` : slug;
    writeFileSync(join(out, `${name}.png`), Buffer.from(url.slice(22), 'base64'));
    log(`${name}: ok`);
  }
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const server = await startServer(log);
  (globalThis as { __url?: string }).__url = server.url;
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    for (const slug of slugs) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.addInitScript({ content: "try { localStorage.setItem('aether.player.mute', '1'); } catch {}" });
      await page.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['GEN_GPU'] === 'intel') await page.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
      page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 160)}`));
      try {
        await shoot(page, slug);
      } catch (e) {
        log(`${slug}: FAILED ${(e as Error).message.slice(0, 200)}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}
void main();

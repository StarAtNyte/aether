/**
 * Game-feel stills: opens a bundled game, looks at its fires in the editor, then plays it and fires feel events
 * (pickup, damage, landing, explosion, win) next to the player, saving page screenshots (the flash, vignette and
 * floating text are page overlays) a few frames after each. For judging the effects by eye.
 *
 * Run: `npm run build && npx tsx scripts/feel-shots.ts --slug=hollow-gate --out=<dir> [--gpu]`
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SLUGS = (arg('slug') ?? 'hollow-gate').split(',').filter(Boolean);
const OUT = resolve(arg('out') ?? '/tmp/aether-feel-shots');
/** Real GPU: WebGL2 over ANGLE/GL (headless ANGLE/Vulkan loses the WebGL context on this machine; see tests/e2e/support/env.ts). */
const GPU_ARGS = ['--ignore-gpu-blocklist', `--use-angle=${process.env['AETHER_E2E_ANGLE'] ?? 'gl'}`, '--enable-gpu-rasterization'];
const log = (l: string): void => void process.stdout.write(`${l}\n`);

type Vec = [number, number, number];

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  log(`  ${name}.png`);
}

/** World positions of entities matching a pattern (id, name or tags). */
async function find(page: Page, pattern: string): Promise<Array<{ id: string; pos: Vec }>> {
  return page.evaluate((src) => {
    const a = window.__aether;
    if (!a) return [];
    const re = new RegExp(src, 'i');
    const out: Array<{ id: string; pos: [number, number, number] }> = [];
    for (const e of Object.values(a.history.current.entities)) {
      if (!re.test(`${e.id} ${e.name} ${e.tags.join(' ')}`)) continue;
      const b = a.simulation?.entityBounds(e.id);
      const p = b ? [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2] : e.transform.position;
      out.push({ id: e.id, pos: [p[0] as number, p[1] as number, p[2] as number] });
    }
    return out;
  }, pattern);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(log);
  const gpu = ARGS.includes('--gpu');
  const browser = await chromium.launch({ executablePath: findChrome(), args: gpu ? GPU_ARGS : [...CHROME_ARGS] });
  try {
    for (const slug of SLUGS) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      await context.addInitScript({ content: "try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ immersivePlay: true })); } catch {}" });
      if (gpu) await context.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
      const page = await context.newPage();
      page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/GPU stall|GL Driver/.test(m.text())) log(`console.error: ${m.text().slice(0, 240)}`);
      });
      await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const a = window.__aether;
        return !!a && a.simulation !== null && a.store.getState().loading === null && !a.store.getState().agentBusy && Object.keys(a.history.current.entities).length > 0;
      }, null, { timeout: 150_000, polling: 250 });
      await page.evaluate(async () => void (await window.__aether?.simulation?.whenSynced()));
      await page.waitForTimeout(3000);
      log(`${slug}:`);
      // 1. The fires in the editor (emitters run there too).
      const fires = await find(page, 'campfire|torch|brazier|chimney|portal');
      for (const [i, f] of fires.slice(0, 2).entries()) {
        await page.evaluate(([p]) => {
          const sim = window.__aether?.simulation;
          if (!sim) return;
          sim.renderer.setCameraPose(p[0] + 2.6, p[1] + 1.5, p[2] + 2.6, Math.PI / 4, -0.32);
          sim.touch();
        }, [f.pos] as const);
        await page.waitForTimeout(1800);
        await page.evaluate(() => window.__aether?.simulation?.touch());
        await shot(page, `${slug}-edit-${i}-${f.id}`);
      }
      // 2. Play: stand by the first fire (or the spawn) and fire the events.
      await page.locator('button.play-btn').first().click();
      await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
      await page.waitForTimeout(2500);
      await page.evaluate(() => (document.querySelector('.title-card__start') as HTMLButtonElement | null)?.click());
      await page.waitForTimeout(1500);
      const near = fires[0]?.pos;
      if (near) {
        await page.evaluate(([p]) => window.__aether?.simulation?.placePlayer([p[0] - 3.2, p[1] + 0.05, p[2] + 3.2], 225, -6), [near] as const);
        await page.waitForTimeout(1500);
      }
      await shot(page, `${slug}-play-0-stand`);
      const events: Array<{ kind: 'pickup' | 'damage' | 'land' | 'explosion' | 'win' | 'checkpoint' | 'hit'; amount?: number; ahead?: number; wait: number }> = [
        { kind: 'pickup', amount: 1, ahead: 1.6, wait: 140 },
        { kind: 'hit', amount: -2, ahead: 1.8, wait: 90 },
        { kind: 'damage', amount: -10, wait: 70 },
        { kind: 'land', wait: 120 },
        { kind: 'checkpoint', ahead: 2, wait: 220 },
        { kind: 'explosion', ahead: 7, wait: 160 },
        { kind: 'win', ahead: 3, wait: 420 },
      ];
      for (const [i, ev] of events.entries()) {
        await page.waitForTimeout(1600);
        const ok = await page.evaluate(([kind, amount, ahead]) => {
          const sim = window.__aether?.simulation;
          const feet = sim?.playerPosition;
          if (!sim || !feet) return false;
          // "Ahead" is away from the camera, past the player, so the burst is in the picture.
          const e = sim.renderer.camera.matrixWorld.elements;
          const fx = -(e[8] as number);
          const fz = -(e[10] as number);
          const fl = Math.hypot(fx, fz) || 1;
          const at: [number, number, number] | undefined = ahead ? [feet[0] + (fx / fl) * ahead, feet[1] + 0.9, feet[2] + (fz / fl) * ahead] : undefined;
          return sim.previewFeel(kind as 'pickup', at, amount ?? undefined);
        }, [ev.kind, ev.amount ?? null, ev.ahead ?? 0] as const);
        await page.waitForTimeout(ev.wait);
        // Freeze the effects for the screenshot (taking it is slower than a flash).
        await page.evaluate(() => {
          const fx = window.__aether?.simulation?.renderer.fx;
          if (fx) fx.paused = true;
        });
        await page.waitForTimeout(150);
        await shot(page, `${slug}-play-${i + 1}-${ev.kind}${ok ? '' : '-none'}`);
        await page.evaluate(() => {
          const fx = window.__aether?.simulation?.renderer.fx;
          if (fx) fx.paused = false;
        });
      }
      // 3. Walk a little: footstep dust on the ground.
      await page.keyboard.down('w');
      await page.waitForTimeout(1300);
      await shot(page, `${slug}-play-walk`);
      await page.keyboard.up('w');
      const stats = await page.evaluate(() => window.__aether?.simulation?.feelStats);
      log(`  feel stats ${JSON.stringify(stats)}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  log(`feel-shots failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

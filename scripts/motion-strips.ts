/**
 * Motion strips: opens a bundled room, presses Play, puts the player in front of a seat and records frame sequences of
 * walking, jumping, sitting down, sitting and standing up as cropped stills (`<out>/<action>-<n>.png`), for judging the
 * body's motion by eye. A montage step (see the caller) lays each action out as one strip.
 *
 * Run: `npm run build && GEN_GPU=intel npx tsx scripts/motion-strips.ts --slug=photo-four-poster --out=<dir>`
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SLUG = arg('slug') ?? 'photo-four-poster';
const OUT = resolve(arg('out') ?? '/tmp/aether-motion-strips');
const FRAMES = Number(arg('frames') ?? 8);
const VIEW = { width: 960, height: 720 };
const CROP = { x: 160, y: 40, width: 640, height: 640 };
/** Side the camera stands on, relative to the seat's yaw (degrees). */
let sideYaw = 90;
const log = (l: string): void => void process.stdout.write(`${l}\n`);

/** A camera 2.3 m to the side of the person, looking at the chest: the same view in every frame of a strip. */
async function track(page: Page): Promise<void> {
  await page.evaluate((side) => {
    const sim = window.__aether?.simulation as unknown as { renderer: { playerRig(): { root: { matrixWorld: { elements: number[] } } } | null; setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void } } | null;
    const rig = sim?.renderer.playerRig();
    if (!sim || !rig) return;
    const m = rig.root.matrixWorld.elements;
    const p = { x: m[12] as number, y: m[13] as number, z: m[14] as number };
    const a = (side * Math.PI) / 180;
    sim.renderer.setCameraPose(p.x + Math.sin(a) * 2.3, p.y + 1.15, p.z + Math.cos(a) * 2.3, a, -0.08);
  }, sideYaw);
}

/** With the page clock installed: advance `stepMs` of game time between stills (a deterministic strip, whatever the GPU speed). */
async function stepped(page: Page, name: string, count: number, stepMs: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.clock.runFor(stepMs);
    await track(page);
    await page.clock.runFor(16);
    await page.screenshot({ path: join(OUT, `${name}-${String(i).padStart(2, '0')}.png`), clip: CROP });
  }
  log(`  ${name}: ${count} stepped frames of ${stepMs} ms`);
}

async function frames(page: Page, name: string, count: number, gapMs: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await track(page);
    await page.screenshot({ path: join(OUT, `${name}-${String(i).padStart(2, '0')}.png`), clip: CROP });
    if (gapMs > 0) await page.waitForTimeout(gapMs);
  }
  log(`  ${name}: ${count} frames`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    if (process.env['GEN_GPU'] === 'intel') await context.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
    const page = await context.newPage();
    page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
    await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const a = window.__aether;
      return !!a && a.simulation !== null && a.store.getState().loading === null && !a.store.getState().agentBusy && Object.keys(a.history.current.entities).length > 0;
    }, null, { timeout: 150_000, polling: 250 });
    await page.waitForTimeout(2500);
    await page.locator('button.play-btn').first().click();
    await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /^Start/ }).first().click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    // A seat, and the player placed two metres in front of it facing it.
    const seat = await page.evaluate(() => {
      const a = window.__aether;
      const sim = a?.simulation as unknown as { sitOn(id: string): boolean; session: { character: { teleport(p: number[]): void; position: number[] } }; input: { setYaw(d: number): void }; entityBounds(id: string): { min: number[]; max: number[] } | null } | null;
      if (!a || !sim) return null;
      const kinds = ['armchair', 'chair', 'sofa', 'bar-stool'];
      for (const k of kinds) {
        for (const e of Object.values(a.history.current.entities)) {
          if (e.arch?.kind !== k || !e.interact) continue;
          const b = sim.entityBounds(e.id);
          if (!b) continue;
          const yaw = (e.transform.rotation[1] as number) ?? 0;
          const t = (yaw * Math.PI) / 180;
          const cx = ((b.min[0] as number) + (b.max[0] as number)) / 2;
          const cz = ((b.min[2] as number) + (b.max[2] as number)) / 2;
          const px = cx + Math.sin(t) * 2.2;
          const pz = cz + Math.cos(t) * 2.2;
          sim.session.character.teleport([px, (b.min[1] as number) + 0.02, pz]);
          sim.input.setYaw((((yaw + 180) % 360) + 360) % 360);
          return { id: e.id, kind: k, at: [cx, cz], yaw };
        }
      }
      return null;
    });
    log(`seat: ${JSON.stringify(seat)}`);
    sideYaw = (seat?.yaw ?? 0) + 90;
    if (!seat) throw new Error('no seat in this room');
    await page.waitForTimeout(1500);
    await frames(page, 'idle', 3, 120);
    // Walk.
    await page.keyboard.down('w');
    await page.waitForTimeout(600);
    await frames(page, 'walk', FRAMES, 60);
    await page.keyboard.up('w');
    await page.waitForTimeout(800);
    // Jump: the body's height is polled while the stills are taken (the stills are slow on a software or integrated GPU).
    await page.keyboard.down('Space');
    const ys: string[] = [];
    const t0 = Date.now();
    for (let i = 0; i < 14; i++) {
      const y = await page.evaluate(() => ((window.__aether?.simulation as unknown as { session: { character: { position: number[] } } }).session.character.position[1] as number).toFixed(2));
      ys.push(`${Date.now() - t0}ms:${y}`);
      await track(page);
      await page.screenshot({ path: join(OUT, `jump-${String(i).padStart(2, '0')}.png`), clip: CROP });
      if (i === 1) await page.keyboard.up('Space');
    }
    log(`  jump height samples: ${ys.join(' ')}`);
    await page.waitForTimeout(1200);
    await page.keyboard.down('w');
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await frames(page, 'run-jump', 12, 0);
    await page.keyboard.up('w');
    await page.waitForTimeout(1000);
    // Sit down: walk to the approach point, turn, lower; sit; stand up.
    await page.evaluate((id) => void (window.__aether?.simulation as unknown as { sitOn(i: string): boolean }).sitOn(id), seat.id);
    await frames(page, 'sit-down', FRAMES + 8, 80);
    await page.waitForTimeout(1500);
    await frames(page, 'seated', 3, 400);
    await page.evaluate(() => (window.__aether?.simulation as unknown as { standUp(): void }).standUp());
    await frames(page, 'stand-up', FRAMES + 8, 80);
    await page.waitForTimeout(1500);
    await frames(page, 'after', 2, 200);
    await context.close();
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});

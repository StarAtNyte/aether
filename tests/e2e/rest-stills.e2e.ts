/**
 * Stills of the DEFAULT view at rest (automatic tier, studio render refined) on the bundled showcase rooms, from a fixed
 * camera, for before / after pixel diffs of shading changes. `--moving` also saves one frame drawn while the view moves
 * (the lean path), taken the same way every run.
 *
 * Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/rest-stills.e2e.ts --out=dir [--worlds=a,b] [--size=1920x1080] [--moving]`
 * Compare two folders with `scripts/image-diff.py a b`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'photo-hotel-bedroom,photo-twin-room,photo-vaulted-bedroom,skyline-penthouse').split(',').filter(Boolean);
const OUT = arg('out') ?? 'rest-stills';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];
const MOVING = ARGS.includes('--moving');
const TIMEOUT = 150_000;

type R = {
  setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
  requestRender(): void;
  cameraPose(): { pos: number[]; target: number[] };
  frameCount: number;
  forceLean: boolean | null;
};

async function open(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      const w = a.history.current;
      return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
    },
    null,
    { timeout: TIMEOUT, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.setPanel('left', false);
    st?.setPanel('right', false);
    st?.updateSettings({ showNavHint: false });
  });
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer as unknown as { lightmapStatus: { state: string } }).lightmapStatus.state !== 'baking', null, { timeout: 60_000, polling: 500 }).catch(() => undefined);
  await page.waitForTimeout(4000);
}

async function main(): Promise<void> {
  const server = await startServer((l) => process.stdout.write(`${l}\n`));
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    for (const slug of WORLDS) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['AETHER_INIT']) await context.addInitScript({ content: process.env['AETHER_INIT'] });
      if (process.env['AETHER_RICH'] === '1') await context.addInitScript({ content: 'globalThis.__AETHER_RICH = true;' });
      if (process.env['GEN_GPU'] === 'intel' && process.env['AETHER_WEBGPU'] !== '1') {
        await context.addInitScript(() => {
          delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu'];
        });
      }
      try {
        const page = await context.newPage();
        page.on('console', (m) => {
          if (m.type() === 'error' || m.type() === 'warning') process.stdout.write(`console ${m.type()}: ${m.text().slice(0, 300)}\n`);
        });
        await open(page, server.url, slug);
        const cam = COVER_CAMERAS[slug];
        let pose: number[] = await page.evaluate(() => {
          const r = window.__aether?.simulation?.renderer as unknown as R;
          const c = r.cameraPose();
          const dx = c.target[0]! - c.pos[0]!;
          const dy = c.target[1]! - c.pos[1]!;
          const dz = c.target[2]! - c.pos[2]!;
          return [c.pos[0]!, c.pos[1]!, c.pos[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
        });
        if (cam) {
          if (cam.arch) await page.evaluate((view) => window.__aether?.store.getState().setArch(view), cam.arch);
          const dx = cam.target[0] - cam.pos[0];
          const dy = cam.target[1] - cam.pos[1];
          const dz = cam.target[2] - cam.pos[2];
          pose = [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
        }
        await page.evaluate((p) => {
          const r = window.__aether?.simulation?.renderer as unknown as R;
          r.setCameraPose(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!);
          r.requestRender();
        }, pose);
        await page.waitForTimeout(9000);
        writeFileSync(join(OUT, `${slug}-rest.png`), await page.screenshot());
        if (MOVING) {
          // One frame of the moving view: nudge the camera and grab the very next frame, before the view rests.
          await page.evaluate((p) => {
            const r = window.__aether?.simulation?.renderer as unknown as R;
            r.forceLean = true;
            r.setCameraPose(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!);
            r.requestRender();
          }, pose);
          await page.waitForTimeout(1500);
          writeFileSync(join(OUT, `${slug}-lean.png`), await page.screenshot());
          await page.evaluate(() => {
            (window.__aether?.simulation?.renderer as unknown as R).forceLean = null;
          });
        }
        process.stdout.write(`${slug}: saved\n`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});

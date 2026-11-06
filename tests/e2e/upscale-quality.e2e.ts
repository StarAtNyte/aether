/**
 * Picture quality of the scene pass drawn below the frame size while the view moves. A fixed orbit (the camera pose is a
 * function of the step index) is captured from the canvas inside the draw call (no screenshot timing), at a pinned scene
 * scale. Capture the reference at `--scale=1`, the candidates at their scale, then compare with `scripts/upscale-metrics.py`.
 *
 * Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/upscale-quality.e2e.ts --out=dir [--worlds=a,b] [--scale=0.25|auto] [--tier=ultra] [--nobias=1] [--speed=0.004] [--size=1920x1080]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'casa-patio,skyline-penthouse').split(',').filter(Boolean);
const OUT = arg('out') ?? 'upscale-out';
const SCALE = arg('scale') ?? '1';
const VARIANT = arg('var');
const NOBIAS = arg('nobias') !== undefined;
/** A fixed render tier (`ultra`: the scene pass takes the scale, the canvas stays full size). */
const TIER = arg('tier');
const SPEED = Number(arg('speed') ?? 0.004);
const [W, H] = (arg('size') ?? '1856x1016').split('x').map(Number) as [number, number];
const SHOTS = (arg('shots') ?? '40,70,100').split(',').map(Number);
const log = (line: string): void => void process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  mkdirSync(OUT, { recursive: true });
  try {
    for (const slug of WORLDS) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['AETHER_WEBGPU'] !== '1') await context.addInitScript(() => void delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu']);
      if (VARIANT) await context.addInitScript({ content: `globalThis.__UPVAR = ${JSON.stringify(VARIANT)};` });
      if (NOBIAS) await context.addInitScript({ content: 'globalThis.__NOBIAS = true;' });
      const page = await context.newPage();
      await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const a = window.__aether;
        if (!a || a.simulation === null) return false;
        const st = a.store.getState();
        return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
      }, null, { timeout: 150_000, polling: 250 });
      await page.evaluate(async () => {
        await window.__aether?.simulation?.whenSynced();
        const st = window.__aether?.store.getState();
        st?.setPanel('left', false);
        st?.setPanel('right', false);
        st?.updateSettings({ showNavHint: false });
      });
      if (TIER) await page.evaluate((t) => (window.__aether?.simulation?.renderer as unknown as { setRenderTier?: (x: string) => void } | undefined)?.setRenderTier?.(t), TIER);
      await page.waitForTimeout(8000);
      const cam = COVER_CAMERAS[slug];
      let pose: number[] = [];
      if (cam) {
        const dx = cam.target[0] - cam.pos[0];
        const dy = cam.target[1] - cam.pos[1];
        const dz = cam.target[2] - cam.pos[2];
        pose = [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
      } else {
        pose = await page.evaluate(() => {
          const r = window.__aether?.simulation?.renderer as unknown as { cameraPose(): { pos: number[]; target: number[] } };
          const c = r.cameraPose();
          const dx = c.target[0]! - c.pos[0]!;
          const dy = c.target[1]! - c.pos[1]!;
          const dz = c.target[2]! - c.pos[2]!;
          return [c.pos[0]!, c.pos[1]!, c.pos[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
        });
      }
      const shots: Record<string, string> = await page.evaluate(
        async ([p, scale, speed, shotIdx]) => {
          type R = {
            setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
            setAdaptiveResolution(on: boolean): void;
            requestRender(): void;
            draw: (...a: unknown[]) => void;
            adaptive: { scale: number; record: () => boolean };
            governor: { record: () => boolean };
            motionScale: number;
            resize(w: number, h: number): void;
            cssWidth: number;
            cssHeight: number;
            stats(): Record<string, number>;
            renderer: { domElement: HTMLCanvasElement };
          };
          const r = window.__aether?.simulation?.renderer as unknown as R;
          const pose = p as number[];
          const sh = shotIdx as number[];
          const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
          const orbit = (n: number, onStep: (i: number) => void): Promise<void> =>
            new Promise((done) => {
              let i = 0;
              const step = (): void => {
                r.setCameraPose(pose[0]!, pose[1]!, pose[2]!, pose[3]! + i * (speed as number), pose[4]!);
                onStep(i);
                if (++i < n) requestAnimationFrame(step);
                else done();
              };
              requestAnimationFrame(step);
            });
          await orbit(60, () => undefined);
          await wait(3000);
          await orbit(60, () => undefined);
          if (scale !== 'auto') {
            const k = Number(scale);
            r.adaptive.record = () => false;
            r.governor.record = () => false;
            r.adaptive.scale = k;
            r.motionScale = k;
            r.resize(r.cssWidth, r.cssHeight);
          }
          await orbit(40, () => undefined);
          const out: Record<string, string> = {};
          let idx = -1;
          const orig = r.draw;
          r.draw = function (this: unknown, ...a: unknown[]): void {
            orig.apply(this, a);
            if (idx >= 0 && sh.includes(idx) && !(String(idx) in out)) out[String(idx)] = r.renderer.domElement.toDataURL('image/png');
          };
          await orbit(Math.max(...sh) + 3, (i) => (idx = i));
          r.draw = orig;
          out['scale'] = String(r.stats()['resolutionScale']);
          return out;
        },
        [pose, SCALE, SPEED, SHOTS] as const,
      );
      for (const [k, v] of Object.entries(shots)) {
        if (k === 'scale') continue;
        writeFileSync(join(OUT, `${slug}-${k}.png`), Buffer.from(v.slice(v.indexOf(',') + 1), 'base64'));
      }
      log(`${slug}: scale=${shots['scale']} shots=${Object.keys(shots).length - 1}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

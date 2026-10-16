/**
 * Frame cost of the water tiers in a real browser: for each world with water, the camera orbits slowly (every
 * frame is dirty), the loop is uncapped, and the median frame interval is recorded for classic water (off), `simple`,
 * `standard` and `high`. Prints a Markdown table.
 *
 *   npm run build && npx tsx tests/e2e/water-bench.e2e.ts [--worlds=sakura-river,highland-trail] [--frames=40] [--size=1600x900] [--webgl2]
 *
 * `AETHER_E2E_GPU=1` uses the machine's GPU in Chromium (default: a software rasteriser, where numbers are only relative).
 */
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'sakura-river,highland-trail').split(',').filter(Boolean);
const FRAMES = Math.max(8, Math.min(200, Number(arg('frames') ?? 40)));
const [W, H] = (arg('size') ?? '1600x900').split('x').map(Number) as [number, number];
const WEBGL2 = ARGS.includes('--webgl2');
const log = (l: string): void => void process.stdout.write(`${l}\n`);

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  try {
    log('| world | backend | water | median ms | p90 ms |');
    log('|---|---|---|---:|---:|');
    for (const slug of WORLDS) {
      for (const tier of ['off', 'simple', 'standard', 'high']) {
        const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
        await context.addInitScript({ content: SKIP_FIRST_RUN });
        await context.addInitScript({ content: `globalThis.__name = (f) => f; globalThis.__WATER_TIER = '${tier}';` });
        if (WEBGL2) await context.addInitScript(() => void delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu']);
        try {
          const page = await context.newPage();
          await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(
            () => {
              const a = window.__aether;
              return !!a && a.simulation !== null && a.store.getState().loading === null && !a.store.getState().agentBusy && Object.keys(a.history.current.entities).length > 0;
            },
            null,
            { timeout: 150_000, polling: 250 },
          );
          await page.evaluate(async () => void (await window.__aether?.simulation?.whenSynced()));
          await page.waitForTimeout(2500);
          const cam = COVER_CAMERAS[slug];
          const pose = cam ? [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-(cam.target[0] - cam.pos[0]), -(cam.target[2] - cam.pos[2])), Math.atan2(cam.target[1] - cam.pos[1], Math.hypot(cam.target[0] - cam.pos[0], cam.target[2] - cam.pos[2]))] : [0, 2, 10, 0, 0];
          const res = await page.evaluate(
            async ([p, frames]) => {
              const r = window.__aether?.simulation?.renderer as unknown as {
                setAdaptiveResolution(on: boolean): void;
                requestRender(): void;
                setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
                gpu: { tier: string };
              };
              r.setAdaptiveResolution(false);
              const pose = p as number[];
              let yaw = pose[3] as number;
              const times: number[] = [];
              const warm = 20;
              await new Promise<void>((done) => {
                let n = 0;
                let last = performance.now();
                const step = (now: number): void => {
                  times.push(now - last);
                  last = now;
                  yaw += 0.002;
                  r.setCameraPose(pose[0] as number, pose[1] as number, pose[2] as number, yaw, pose[4] as number);
                  r.requestRender();
                  if (++n < (frames as number) + warm) requestAnimationFrame(step);
                  else done();
                };
                requestAnimationFrame(step);
              });
              const sorted = times.slice(warm).sort((a, b) => a - b);
              const at = (f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] as number;
              return { median: at(0.5), p90: at(0.9), backend: window.__aether?.simulation?.backend ?? '?', gpu: r.gpu.tier };
            },
            [pose, FRAMES] as const,
          );
          log(`| ${slug} | ${res.backend} (${res.gpu}) | ${tier} | ${res.median.toFixed(2)} | ${res.p90.toFixed(2)} |`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});

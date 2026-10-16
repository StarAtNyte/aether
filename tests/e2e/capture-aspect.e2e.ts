/**
 * Capture correctness: a still taken at another aspect than the viewport must be rendered fresh at that aspect (not the
 * viewport's frame re-composited and stretched), the first capture after load must not be black, and the canvas must be
 * back to its own size afterwards.
 *
 * Run: `npm run build && npm run e2e:capture [-- --slug=kart-canyon] [--gpu]`
 */
import { chromium } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SLUG = arg('slug') ?? 'kart-canyon';
const GPU_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--disable-vulkan-surface'];

function check(ok: boolean, message: string): void {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${message}\n`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const server = await startServer((l) => process.stdout.write(`${l}\n`));
  const browser = await chromium.launch({ executablePath: findChrome(), args: ARGS.includes('--gpu') ? GPU_ARGS : [...CHROME_ARGS] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    if (ARGS.includes('--gpu')) await context.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
    const page = await context.newPage();
    await page.goto(`${server.url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const a = window.__aether;
      return !!a && a.simulation !== null && a.store.getState().loading === null && !a.store.getState().agentBusy && Object.keys(a.history.current.entities).length > 0;
    }, null, { timeout: 120_000, polling: 250 });
    // The very first capture, straight after load: not black.
    const first = await page.evaluate(async () => (await window.__aether?.simulation?.renderer.screenshot({ width: 640, height: 400, mime: 'image/png' })) ?? '');
    const firstStats = pixelStats(decodePng(Buffer.from(first.slice('data:image/png;base64,'.length), 'base64')));
    check(firstStats.mean > 8, `first capture has content (mean ${firstStats.mean.toFixed(1)})`);
    await page.waitForTimeout(2000);
    // Record the aspect the scene is drawn with while each capture runs.
    await page.evaluate(() => {
      const r = window.__aether!.simulation!.renderer as unknown as { scene: { onBeforeRender: (a: unknown, b: unknown, c: { aspect?: number }) => void } };
      const w = window as unknown as { __aspects: number[] };
      w.__aspects = [];
      r.scene.onBeforeRender = (_a, _b, cam) => {
        if (typeof cam.aspect === 'number') w.__aspects.push(cam.aspect);
      };
    });
    const canvasBefore = await page.evaluate(() => {
      const c = window.__aether!.simulation!.renderer.domElement;
      return [c.width, c.height] as const;
    });
    for (const [w, h] of [[900, 900], [1600, 900], [canvasBefore[0], canvasBefore[1]]] as const) {
      await page.evaluate(() => ((window as unknown as { __aspects: number[] }).__aspects.length = 0));
      const url = await page.evaluate(async ([cw, ch]) => (await window.__aether?.simulation?.renderer.screenshot({ width: cw, height: ch, mime: 'image/png' })) ?? '', [w, h] as const);
      const aspects = await page.evaluate(() => (window as unknown as { __aspects: number[] }).__aspects.slice());
      const want = w / h;
      check(aspects.some((a) => Math.abs(a - want) < 0.01), `capture ${w}x${h} drew the scene at aspect ${want.toFixed(3)} (saw ${[...new Set(aspects.map((a) => a.toFixed(2)))].join(', ')})`);
      const stats = pixelStats(decodePng(Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')));
      check(stats.stdDev > 10, `capture ${w}x${h} has detail (stddev ${stats.stdDev.toFixed(1)})`);
    }
    const canvasAfter = await page.evaluate(() => {
      const c = window.__aether!.simulation!.renderer.domElement;
      return [c.width, c.height] as const;
    });
    check(canvasAfter[0] === canvasBefore[0] && canvasAfter[1] === canvasBefore[1], `canvas restored to ${canvasBefore.join('x')} (now ${canvasAfter.join('x')})`);
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});

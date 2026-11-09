/**
 * Which GPU does a browser launch really render on? Opens a blank page and reports the WebGL2 renderer string and the
 * WebGPU adapter. Used to pick the footage browser (see docs/demo/FOOTAGE-PIPELINE.md).
 *
 *   npx tsx scripts/demo/gpu-probe.ts --browser=chrome --gpu=intel|nvidia|nvidia-vulkan|nvidia-webgpu [--headless]
 */
import { chromium } from 'playwright';
import { launchFootageBrowser } from './footage-browser';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

async function main(): Promise<void> {
  const browser = await launchFootageBrowser({ browser: arg('browser') ?? 'chrome', gpu: arg('gpu') ?? 'intel', headless: ARGS.includes('--headless') });
  const page = await browser.newPage();
  await page.goto(arg('url') ?? 'about:blank');
  if (arg('url')?.startsWith('chrome://')) {
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => (document.body as HTMLElement).innerText);
    process.stdout.write(`${text.split('\n').filter((l) => /webgpu|vulkan|webgl2|gl_renderer|canvas|ANGLE|driver/i.test(l)).slice(0, 14).join('\n')}\n`);
    await browser.close();
    return;
  }
  const info = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const out: Record<string, unknown> = { webgl2: !!gl, renderer: gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, version: gl?.getParameter(gl.VERSION) };
    try {
      const nav = navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string>; features?: Set<string> } | null> } };
      const ad = await nav.gpu?.requestAdapter();
      out['webgpu'] = ad ? { info: { vendor: ad.info?.['vendor'], architecture: ad.info?.['architecture'], description: ad.info?.['description'] }, features: ad.features?.size } : null;
    } catch (e) {
      out['webgpu'] = `error ${String(e).slice(0, 120)}`;
    }
    return out;
  });
  process.stdout.write(`${JSON.stringify(info)}\n`);
  await browser.close();
}

void chromium;
main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${String(e).slice(0, 500)}\n`);
  process.exit(1);
});

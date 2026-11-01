/**
 * Export a bundled world as a .glb with the studio's own exporter, so an external tool (Blender, for hero stills) can render it.
 *
 *   GEN_GPU=intel npx tsx scripts/blender/export-glb.ts --slug=lisbon-hills --out=<file.glb> [--url=http://localhost:5176]
 *
 * Needs the studio running (`npm run dev`) or `--url` of a deployment. Runs one headless browser and closes it.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome } from '../../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const slug = arg('slug') ?? 'lisbon-hills';
const out = arg('out') ?? `${slug}.glb`;
const url = arg('url') ?? 'http://localhost:5176';

const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
try {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  const page = await ctx.newPage();
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const a = (window as unknown as { __aether?: { simulation: unknown; store: { getState(): { loading: unknown } }; history: { current: { entities: object } } } }).__aether;
    return !!a && a.simulation !== null && a.store.getState().loading === null && Object.keys(a.history.current.entities).length > 0;
  }, null, { timeout: 150_000, polling: 500 });
  await page.waitForTimeout(6000);
  const b64 = await page.evaluate(async () => {
    const a = (window as unknown as { __aether: { simulation: { renderer: { exportGlb(): Promise<ArrayBuffer> } } } }).__aether;
    const bytes = new Uint8Array(await a.simulation.renderer.exportGlb());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  writeFileSync(out, Buffer.from(b64, 'base64'));
  process.stdout.write(`${out}: ${Math.round((b64.length * 3) / 4 / 1024)} KB\n`);
} finally {
  await browser.close();
}
process.exit(0);

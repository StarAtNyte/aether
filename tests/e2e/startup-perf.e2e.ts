/**
 * Time to the first picture, per showcase world, from a cold browser (a fresh profile: no shader or HTTP cache): the loading
 * screen gone, the first frame drawn, and the shader programs compiled by then. Each sample launches its own browser.
 *
 * Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/startup-perf.e2e.ts [--worlds=a,b] [--samples=2] [--size=1920x1080]`
 */
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'photo-hotel-bedroom,photo-twin-room,skyline-penthouse,casa-patio').split(',').filter(Boolean);
const SAMPLES = Math.max(1, Number(arg('samples') ?? 2));
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];

async function main(): Promise<void> {
  const server = await startServer((l) => process.stdout.write(`${l}\n`));
  try {
    process.stdout.write('| world | sample | loading screen gone (s) | first frame (s) | programs at first frame | programs after 8 s |\n|---|---|---:|---:|---:|---:|\n');
    for (const slug of WORLDS) {
      for (let s = 0; s < SAMPLES; s++) {
        const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
        try {
          const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
          await context.addInitScript({ content: SKIP_FIRST_RUN });
          await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
          if (arg('dump')) await context.addInitScript({ content: 'globalThis.__KEEP = true;' });
          if (process.env['GEN_GPU'] === 'intel') {
            await context.addInitScript(() => {
              delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu'];
            });
          }
          await context.addInitScript(() => {
            // Count the programs the page links, with the size of their fragment shaders.
            const w = globalThis as unknown as { __links: Array<{ at: number; frag: number; vert: number; src?: string }> };
            w.__links = [];
            const proto = WebGL2RenderingContext.prototype;
            const link = proto.linkProgram;
            proto.linkProgram = function (this: WebGL2RenderingContext, program: WebGLProgram): void {
              let frag = 0;
              let vert = 0;
              for (const sh of this.getAttachedShaders(program) ?? []) {
                const src = this.getShaderSource(sh) ?? '';
                if (this.getShaderParameter(sh, this.SHADER_TYPE) === this.FRAGMENT_SHADER) frag = src.length;
                else vert = src.length;
              }
              w.__links.push({ at: performance.now(), frag, vert, src: (globalThis as { __KEEP?: boolean }).__KEEP ? (this.getAttachedShaders(program) ?? []).map((sh) => this.getShaderSource(sh) ?? '').join('\n//----\n') : undefined });
              link.call(this, program);
            };
          });
          const page = await context.newPage();
          const t0 = Date.now();
          await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(
            () => {
              const a = window.__aether;
              if (!a || a.simulation === null) return false;
              const st = a.store.getState();
              return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
            },
            null,
            { timeout: 240_000, polling: 100 },
          );
          const tOpen = (Date.now() - t0) / 1000;
          await page.waitForFunction(() => ((window.__aether?.simulation?.renderer as unknown as { frameCount: number }).frameCount ?? 0) >= 1, null, { timeout: 240_000, polling: 50 });
          const tFrame = (Date.now() - t0) / 1000;
          const programs = (): Promise<number> => page.evaluate(() => (globalThis as unknown as { __links: unknown[] }).__links.length);
          const p1 = await programs();
          await page.waitForTimeout(8000);
          const p2 = await programs();
          const links = await page.evaluate(() => (globalThis as unknown as { __links: Array<{ frag: number; vert: number; src?: string }> }).__links);
          if (arg('dump')) {
            const { mkdirSync, writeFileSync } = await import('node:fs');
            mkdirSync(arg('dump') as string, { recursive: true });
            links.forEach((l, i) => writeFileSync(`${arg('dump')}/${slug}-${String(i).padStart(3, '0')}-${l.frag}.glsl`, l.src ?? ''));
          }
          const big = links.filter((l) => l.frag > 20000).length;
          const total = links.reduce((a, l) => a + l.frag, 0);
          process.stdout.write(`${slug}: ${links.length} programs, ${big} with a fragment shader over 20 kB, ${(total / 1e6).toFixed(2)} MB of fragment source\n`);
          process.stdout.write(`| ${slug} | ${s + 1} | ${tOpen.toFixed(1)} | ${tFrame.toFixed(1)} | ${p1} | ${p2} |\n`);
        } finally {
          await browser.close();
        }
      }
    }
  } finally {
    await server.stop();
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});

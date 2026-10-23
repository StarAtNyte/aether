/**
 * Opening a bundled showcase world applies its bundled lightmap with no bake: no worker job, no "Baking light" pill, in the
 * view the world opens in and in the architecture view its cover shot uses (cutaway sections the walls that face the camera,
 * which must not change which file the building matches).
 *
 * Run: `npm run build && npx tsx tests/e2e/lightmap-open.e2e.ts [--worlds=a,b]` (`GEN_GPU=intel` for the integrated GPU).
 */
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'photo-hotel-bedroom,photo-twin-room,photo-four-poster,photo-vaulted-bedroom,skyline-penthouse,casa-patio').split(',').filter(Boolean);
/** The architecture views each world is also opened in (its cover shot's, plus the lowered plan view). */
const VIEWS: Record<string, Array<'cutaway' | 'down'>> = { 'skyline-penthouse': ['cutaway', 'down'], 'casa-patio': ['cutaway', 'down'] };

interface R {
  lightmapStatus: { state: string; message: string };
  lightmapStats: { source: string; key: string } | null;
  lightmapBakesStarted: number;
  setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
  requestRender(): void;
}

async function open(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
    },
    null,
    { timeout: 180_000, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  // Every status the renderer shows, from the first frame on (a pill is a status of 'baking' or 'waiting').
  await page.evaluate(() => {
    const w = window as unknown as { __lm: string[] };
    w.__lm = [];
    const r = window.__aether?.simulation?.renderer as unknown as R;
    let last = '';
    setInterval(() => {
      const s = r.lightmapStatus;
      const pill = document.querySelector('[data-testid="lightmap-pill"]') ? '|PILL' : '';
      const line = `${s.state}|${s.message}${pill}`;
      if (line !== last) {
        last = line;
        w.__lm.push(line);
      }
    }, 20);
  });
}

async function settle(page: Page, seconds: number): Promise<{ log: string[]; bakes: number; source: string | null; state: string }> {
  await page
    .waitForFunction(() => (window.__aether?.simulation?.renderer as unknown as R).lightmapStatus.state === 'applied', null, { timeout: 90_000, polling: 250 })
    .catch(() => undefined);
  await page.waitForTimeout(seconds * 1000);
  return page.evaluate(() => {
    const r = window.__aether?.simulation?.renderer as unknown as R;
    return { log: (window as unknown as { __lm: string[] }).__lm, bakes: r.lightmapBakesStarted, source: r.lightmapStats?.source ?? null, state: r.lightmapStatus.state };
  });
}

async function main(): Promise<void> {
  const server = await startServer((l) => process.stdout.write(`${l}\n`));
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  let failed = 0;
  const check = (label: string, r: { log: string[]; bakes: number; source: string | null; state: string }): void => {
    const pill = r.log.filter((l) => /^(baking|waiting)\|/.test(l) ? !l.endsWith('|applying baked light') : l.endsWith('|PILL'));
    const ok = r.state === 'applied' && r.source === 'static' && r.bakes === 0 && pill.length === 0;
    process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${label}: state=${r.state} source=${r.source} bakes=${r.bakes}${pill.length ? ` pill=${pill.join(' / ')}` : ''}\n`);
    if (process.env['TRACE']) process.stdout.write(`     ${r.log.join('  >  ')}\n`);
    if (!ok) failed++;
  };
  try {
    for (const slug of WORLDS) {
      // One page per case: opened as is, switched to an architecture view once the lightmap is on, and opened already in that view
      // (the view is set before the lightmap has settled, as a restored session or a cover shot does).
      const cases: Array<{ walls: 'cutaway' | 'down' | null; early: boolean }> = [{ walls: null, early: false }];
      for (const walls of VIEWS[slug] ?? []) cases.push({ walls, early: false }, { walls, early: true });
      for (const c of cases) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        await context.addInitScript({ content: SKIP_FIRST_RUN });
        await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
        try {
          const page = await context.newPage();
          await open(page, server.url, slug);
          const view = async (walls: 'cutaway' | 'down'): Promise<void> => {
            await page.evaluate((w) => window.__aether?.store.getState().setArch({ walls: w }), walls);
            const cam = COVER_CAMERAS[slug];
            if (!cam) return;
            const [dx, dy, dz] = [cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]];
            await page.evaluate(
              (p) => {
                const r = window.__aether?.simulation?.renderer as unknown as R;
                r.setCameraPose(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!);
                r.requestRender();
              },
              [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))],
            );
          };
          if (c.walls && c.early) await view(c.walls);
          const label = `${slug} ${c.walls === null ? 'as opened' : c.early ? `opened in ${c.walls}` : `switched to ${c.walls}`}`;
          if (c.walls && !c.early) {
            check(`${slug} as opened`, await settle(page, 2));
            await view(c.walls);
            check(label, await settle(page, 8));
          } else check(label, await settle(page, c.walls ? 8 : 3));
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  process.stdout.write(failed === 0 ? 'lightmap-open: ok\n' : `lightmap-open: ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();

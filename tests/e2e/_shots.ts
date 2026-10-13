/* Scratch screenshot harness (not part of the suite). */
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer } from './support/env';

const OUT = process.env['SHOTS_OUT'] ?? '/tmp/claude-1000/-home-nitiz-Projects-Self-Challenges-victoria-ar/faa68d66-5f0c-4e9a-9a4d-98d4a3853cf6/scratchpad/shots/';
const args = process.argv.slice(2);
const FF = args.includes('--firefox');
const DARK = args.includes('--dark');
const sizes = (args.find((a) => a.startsWith('--sizes='))?.slice(8) ?? '1440x900').split(',').map((s) => s.split('x').map(Number) as [number, number]);
const steps = (args.find((a) => a.startsWith('--steps='))?.slice(8) ?? 'home,editor').split(',');
const tag = (FF ? 'ff' : 'cr') + (DARK ? '-dark' : '');

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const a = window.__aether;
    return !!a && a.simulation !== null && a.store.getState().loading === null;
  }, null, { timeout: 90_000 });
}

const server = await startServer((l) => process.stdout.write(l + '\n'));
let browser: Browser | null = null;
try {
  browser = FF ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  for (const [w, h] of sizes) {
    const mobile = w < 768;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, ...(mobile && !FF ? { isMobile: true, hasTouch: true } : {}), colorScheme: DARK ? 'dark' : 'light' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 300));
    });
    const sz = `${w}x${h}`;
    for (const step of steps) {
      if (step === 'home') {
        await page.goto(`${server.url}/?debug=1#/`);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-home.png` });
      } else if (step === 'new') {
        await page.goto(`${server.url}/?debug=1#/`);
        await page.waitForTimeout(800);
        await page.keyboard.press('n');
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-newdialog.png` });
        await page.keyboard.press('Escape');
      } else if (step === 'editor') {
        await page.goto(`${server.url}/?debug=1#/new`);
        await waitReady(page);
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-editor.png` });
      } else if (step === 'template') {
        await page.goto(`${server.url}/?debug=1#/new/lakeside-camp`);
        await waitReady(page);
        await page.waitForFunction(() => window.__aether?.store.getState().agentBusy === true, null, { timeout: 20_000 }).catch(() => undefined);
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-busy.png` });
        await page.waitForFunction(() => window.__aether?.store.getState().agentBusy === false, null, { timeout: 120_000 });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-template.png` });
      } else if (step === 'select') {
        const id = await page.evaluate(() => {
          const a = window.__aether!;
          const ids = Object.keys(a.history.current.entities);
          const pick = ids.find((i) => a.history.current.entities[i]?.shape.kind === 'procedural') ?? ids[0];
          a.studio.pick(pick ?? null);
          return pick;
        });
        console.log('selected', id);
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-selected.png` });
      } else if (step === 'assets') {
        await page.evaluate(() => window.__aether!.store.getState().showLeftView('assets'));
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-assets.png` });
      } else if (step === 'objects') {
        await page.evaluate(() => window.__aether!.store.getState().showLeftView('objects'));
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-objects.png` });
      } else if (step === 'palette') {
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-palette.png` });
        await page.keyboard.press('Escape');
      } else if (step === 'play') {
        await page.evaluate(() => window.__aether!.studio.togglePlay());
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-play.png` });
        await page.evaluate(() => window.__aether!.studio.togglePlay());
        await page.waitForTimeout(1000);
      } else if (step === 'labels') {
        await page.evaluate(() => window.__aether!.store.getState().updateSettings({ showLabels: true, showPerf: true }));
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-labels.png` });
      } else if (step === 'settings') {
        await page.evaluate(() => window.__aether!.store.getState().setSettingsOpen(true));
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-settings.png` });
        await page.keyboard.press('Escape');
      } else if (step === 'homeback') {
        await page.goto(`${server.url}/?debug=1#/`);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${OUT}${tag}-${sz}-home2.png` });
      }
    }
    await ctx.close();
  }
} finally {
  await browser?.close();
  await server.stop();
}

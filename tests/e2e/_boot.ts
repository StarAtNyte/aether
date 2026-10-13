import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, startServer } from './support/env';
const server = await startServer(() => undefined);
const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 200)));
  await page.goto(`${server.url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => ({ hash: location.hash, a: !!window.__aether, sim: window.__aether ? window.__aether.simulation !== null : null, loading: window.__aether?.store.getState().loading ?? null, fps: window.__aether?.store.getState().stats.fps ?? null }));
    console.log(i, JSON.stringify(s));
    if (i === 3) await page.evaluate(() => window.__aether?.store.getState().updateSettings({ showPerf: true }));
    await page.waitForTimeout(500);
  }
} finally {
  await browser.close();
  await server.stop();
}

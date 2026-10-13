import { chromium, firefox } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer } from './support/env';
const server = await startServer(() => undefined);
for (const name of ['chromium', 'firefox']) {
  const browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(`${server.url}/?debug=1#/new`);
    await page.waitForFunction(() => !!window.__aether && window.__aether.simulation !== null && window.__aether.store.getState().loading === null, null, { timeout: 90000 });
    await page.waitForTimeout(4000);
    const r = await page.evaluate(async () => {
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const b = await window.__aether!.studio.captureThumbnail();
        out.push(Math.round(performance.now() - t0));
        if (!b) return { err: 'no blob' };
      }
      return { ms: out };
    });
    console.log(name, JSON.stringify(r));
  } finally {
    await browser.close();
  }
}
await server.stop();

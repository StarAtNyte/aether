import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome } from '../../tests/e2e/support/env';
const url = process.env['AETHER_E2E_URL']!;
const out = process.argv[2]!;
const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await ctx.addInitScript(SKIP_FIRST_RUN);
await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const a = (window as any).__aether; return !!a && a.simulation !== null && a.store.getState().loading === null; }, null, { timeout: 150000 });
await page.getByRole('tab', { name: 'Assets' }).click();
const search = page.getByLabel('Search assets');
for (const q of ['office chair', 'drum', 'crate', 'kettle']) {
  await search.fill(q);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const s = document.querySelector('[data-hub-status]');
    return { status: s?.getAttribute('data-hub-status') ?? null, hub: [...document.querySelectorAll('[data-hub="1"]')].map((t) => t.getAttribute('data-asset')), lib: document.querySelectorAll('.asset-grid .asset-tile:not([data-hub])').length, imgs: [...document.querySelectorAll('[data-hub="1"] img')].map((i) => (i as HTMLImageElement).naturalWidth > 0) };
  });
  console.log(q, JSON.stringify(info));
  await page.screenshot({ path: `${out}/hub-search-${q.replace(' ', '-')}.png` });
}
await browser.close();

import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, startServer } from './support/env';
const server = await startServer(() => undefined);
const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${server.url}/?debug=1#/new`);
  await page.waitForFunction(() => !!window.__aether && window.__aether.store.getState().loading === null, null, { timeout: 60000 });
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.waitForTimeout(300);
  console.log('menus open', await page.locator('.menu').count(), 'active', await page.evaluate(() => document.activeElement?.className));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log('after esc', await page.locator('.menu').count(), 'active', await page.evaluate(() => document.activeElement?.className));
} finally {
  await browser.close();
  await server.stop();
}

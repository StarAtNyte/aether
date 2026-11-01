import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome } from '../tests/e2e/support/env';
const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  await ctx.addInitScript({ content: 'globalThis.__name = (f) => f; delete Navigator.prototype.gpu;' });
  const page = await ctx.newPage();
  let done: (v: string) => void;
  const got = new Promise<string>((r) => (done = r));
  page.on('response', async (res) => {
    if (res.url().endsWith('/api/llm') && res.status() === 400) {
      const req = res.request().postData() ?? '';
      let keys = '';
      try { const j = JSON.parse(req); keys = Object.keys(j).join(',') + ' | tools ' + (j.tools?.length ?? 0) + ' | msgs ' + (j.messages?.length ?? 0); } catch {}
      done(`${await res.text()}\nREQ KEYS ${keys}`);
    }
  });
  await page.goto('http://127.0.0.1:8799/#/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-prompt').waitFor({ timeout: 90_000 });
  await page.locator('#hero-prompt').fill('a small stone well in a meadow');
  await page.keyboard.press('Enter');
  console.log((await Promise.race([got, new Promise<string>((r) => setTimeout(() => r('no 400 in 90s'), 90_000))])).slice(0, 1500));
} finally { await browser.close(); }
process.exit(0);

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CHROME_ARGS, findChrome, startServer, SKIP_FIRST_RUN } from '../tests/e2e/support/env';

const OUT = process.argv[2] ?? "/tmp/ui-audit";
mkdirSync(OUT, { recursive: true });
const log = (s: string) => process.stdout.write(s + '\n');

async function main() {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--disable-lcd-text', '--font-render-hinting=none'], headless: true });
  try {
    for (const dark of [false, true]) for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      const tag = `${dark ? 'dark' : 'light'}-${w}`;
      if (process.env['ONLY'] && !tag.includes(process.env['ONLY'])) continue;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await ctx.addInitScript(SKIP_FIRST_RUN);
      await ctx.addInitScript(`localStorage.setItem('aether.studio.settings.v1', JSON.stringify({darkTheme:${dark}}))`);
      const page = await ctx.newPage();
      page.setDefaultTimeout(4000);
      const shot = async (name: string) => { try { const boxes = await page.evaluate(() => [...document.querySelectorAll('canvas,img,video,.card__thumb,.hero-stage')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })); writeFileSync(`${OUT}/${tag}-${name}.json`, JSON.stringify(boxes)); await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, timeout: 30000 }); log('shot ' + tag + ' ' + name); } catch (e) { log('fail ' + name + ' ' + e); } };
      const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { log(`skip ${tag} ${name}: ${String(e).split('\n')[0]}`); } };
      await page.goto(`${server.url}/?debug=1#/`);
      await page.getByRole('heading', { name: 'Start from a template' }).waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await shot('home');
      await step('card-menu', async () => { /* template hover */ await page.locator('.card--template').first().hover(); await shot('home-hover'); });
      await page.locator('.card--template').filter({ hasText: 'Lantern Isles' }).locator('.card__remix').click({ timeout: 30000 });
      await page.waitForURL(/#\/p\//, { timeout: 30000 });
      await page.waitForFunction(() => !!(window as any).__aether, null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(6000);
      await shot('editor');
      const names = await page.evaluate(() => [...document.querySelectorAll('button,[role=tab],[role=switch],input,select')].map((e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('type') || '').trim().slice(0, 30)).filter(Boolean));
      log(tag + ' controls: ' + JSON.stringify([...new Set(names)]).slice(0, 1800));
      await step('menu', async () => { await page.getByRole('button', { name: 'Aether menu' }).click(); await page.waitForTimeout(300); await shot('menu'); await page.keyboard.press('Escape'); });
      await step('tooltip', async () => { await page.getByRole('button', { name: 'Undo' }).hover(); await page.waitForTimeout(900); await shot('tooltip'); });
      await step('palette', async () => { await page.keyboard.press('Control+k'); await page.waitForTimeout(500); await shot('palette'); await page.keyboard.press('Escape'); });
      await step('settings', async () => { await page.getByRole('button', { name: /settings/i }).first().click(); await page.waitForTimeout(500); await shot('settings'); await page.keyboard.press('Escape'); });
      for (const rail of ['Objects', 'Assets', 'Logic', 'Checks', 'History']) await step('rail-' + rail, async () => { await page.getByRole('tab', { name: rail, exact: true }).click(); await page.waitForTimeout(400); await shot('rail-' + rail.toLowerCase()); });
      await step('agent-rail', async () => { await page.getByRole('tab', { name: 'Agent', exact: true }).first().click(); });
      await step('publish', async () => { await page.getByRole('button', { name: 'Publish' }).first().click(); await page.waitForTimeout(700); await shot('publish'); await page.keyboard.press('Escape'); });
      await step('share', async () => { await page.getByRole('button', { name: 'Share' }).first().click(); await page.waitForTimeout(700); await shot('share'); await page.keyboard.press('Escape'); });
      await step('inspect-sections', async () => { await page.getByRole('button', { name: 'Ground' }).first().click(); await page.getByRole('button', { name: 'Game feel' }).first().click(); await page.waitForTimeout(400); await shot('inspector-open'); });
      await step('focus', async () => { await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.waitForTimeout(200); await shot('focus'); });
      await step('select', async () => { await page.getByRole('tab', { name: 'Objects', exact: true }).click(); await page.locator('[role=treeitem], .tree__row, .outliner__row, .objects-row').nth(4).click(); await page.waitForTimeout(600); await shot('select'); });
      await step('tabs', async () => { const tabs = page.getByRole('tab'); const n = await tabs.count(); for (let i = 1; i < Math.min(n, 4); i++) { await tabs.nth(i).click(); await page.waitForTimeout(300); await shot('tab' + i); } });
      await step('play', async () => { await page.getByRole('button', { name: /^play/i }).first().click(); await page.waitForTimeout(4000); await shot('play'); });
      await step('arch', async () => {
        await page.goto(`${server.url}/?debug=1#/templates`);
        await page.locator('.card--template').filter({ hasText: /Skyline Penthouse/ }).first().locator('.card__remix').click({ timeout: 30000 });
        await page.waitForURL(/#\/p\//, { timeout: 30000 });
        await page.waitForTimeout(9000);
        await shot('arch');
        await page.getByRole('button', { name: /plan/i }).first().click();
        await page.waitForTimeout(1500);
        await shot('arch-plan');
      });
      await ctx.close();
    }
  } finally { await browser.close(); await server.stop(); }
}
main().catch((e) => { console.error(e); process.exit(1); });

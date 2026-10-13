import { chromium, firefox, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer } from './support/env';
const server = await startServer(() => undefined);
async function homePaint(page: Page): Promise<unknown> {
  await page.goto(`${server.url}/#/`);
  await page.waitForSelector('.card--template img');
  const cardsAt = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.card--template img')].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0));
  const thumbsAt = await page.evaluate(() => Math.round(performance.now()));
  const js = await page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((r) => r.name.endsWith('.js')).reduce((t, r) => t + r.encodedBodySize, 0));
  const cls = await page.evaluate(() => (window as unknown as { __cls?: number }).__cls ?? null);
  return { cardsAt, thumbsAt, jsKB: Math.round(js / 1024), cls };
}
for (const name of ['chromium', 'firefox']) {
  const browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--js-flags=--expose-gc'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript('globalThis.__name = (f) => f;');
    await ctx.addInitScript(() => {
      try {
        let cls = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) cls += e.value; (window as unknown as { __cls: number }).__cls = cls; }).observe({ type: 'layout-shift', buffered: true });
      } catch { /* not supported (Firefox) */ }
    });
    const page = await ctx.newPage();
    console.log(name, 'home', JSON.stringify(await homePaint(page)));
    await page.goto(`${server.url}/?debug=1#/new`);
    await page.waitForFunction(() => !!window.__aether && window.__aether.simulation !== null && window.__aether.store.getState().loading === null, null, { timeout: 90000 });
    await page.waitForTimeout(3000);
    if (name === 'chromium') {
      const probe = async (labels: boolean): Promise<number> => page.evaluate(async (on) => {
        const a = window.__aether!;
        a.store.getState().updateSettings({ showLabels: on });
        const cam = a.simulation!.renderer.camera;
        const r = Math.hypot(cam.position.x, cam.position.z);
        const g = (globalThis as unknown as { gc?: () => void }).gc;
        await new Promise((ok) => setTimeout(ok, 300));
        g?.();
        const m = performance as unknown as { memory: { usedJSHeapSize: number } };
        const before = m.memory.usedJSHeapSize;
        let t = 0;
        await new Promise<void>((ok) => {
          const step = (): void => {
            t += 1;
            const ang = t * 0.01;
            cam.position.x = Math.cos(ang) * r;
            cam.position.z = Math.sin(ang) * r;
            a.simulation!.renderer.requestRender();
            if (t < 120) requestAnimationFrame(step); else ok();
          };
          requestAnimationFrame(step);
        });
        return (m.memory.usedJSHeapSize - before) / 120;
      }, labels);
      const off = await probe(false);
      const on = await probe(true);
      console.log(name, 'bytes allocated per orbit frame (no GC in between): labels off', Math.round(off), 'labels on', Math.round(on));
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
}
await server.stop();

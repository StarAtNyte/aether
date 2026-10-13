import { chromium, firefox } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer } from './support/env';
const OUT = '/tmp/claude-1000/-home-nitiz-Projects-Self-Challenges-victoria-ar/faa68d66-5f0c-4e9a-9a4d-98d4a3853cf6/scratchpad/shots/';
const FF = process.argv.includes('--firefox');
const server = await startServer(() => undefined);
const browser = FF ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto(`${server.url}/?debug=1#/new`);
  await page.waitForFunction(() => !!window.__aether && window.__aether.simulation !== null && window.__aether.store.getState().loading === null, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const id = await page.evaluate(() => {
    const a = window.__aether!;
    const ids = Object.keys(a.history.current.entities);
    const pick = ids.find((i) => a.history.current.entities[i]?.shape.kind === 'procedural' && a.history.current.entities[i]?.parent === null && /tent|crate|campfire/.test(i)) ?? ids[0]!;
    a.studio.pick(pick);
    a.studio.focus(pick);
    a.store.getState().setTool('move');
    return pick;
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}${FF ? 'ff' : 'cr'}-gizmo.png` });
  // Screen position of the entity origin.
  const pt = await page.evaluate((eid) => {
    const a = window.__aether!;
    const sim = a.simulation!;
    const cam = sim.renderer.camera;
    const p = a.history.current.entities[eid]!.transform.position;
    const v = cam.position.clone().set(p[0], p[1], p[2]).project(cam);
    const r = sim.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (0.5 - v.y * 0.5) * r.height, before: p };
  }, id);
  console.log('entity', id, JSON.stringify(pt));
  await page.mouse.move(pt.x + 2, pt.y + 2);
  await page.waitForTimeout(200);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(200);
  const busy = await page.evaluate(() => window.__aether!.simulation!.renderer.gizmoBusy);
  console.log('hover busy', busy);
  const head0 = await page.evaluate(() => window.__aether!.history.head);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(pt.x + i * 8, pt.y); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.evaluate((eid) => ({ head: window.__aether!.history.head, pos: window.__aether!.history.current.entities[eid]!.transform.position, sel: window.__aether!.store.getState().selection }), id);
  console.log('head', head0, '->', after.head, 'pos', JSON.stringify(after.pos), 'sel', JSON.stringify(after.sel));
  await page.screenshot({ path: `${OUT}${FF ? 'ff' : 'cr'}-gizmo2.png` });
} finally {
  await browser.close();
  await server.stop();
}

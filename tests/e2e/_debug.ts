/* Scratch debug probe (not part of the suite). */
import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, startServer } from './support/env';

const server = await startServer(() => undefined);
const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') console.log('CONSOLE', m.type(), m.text().slice(0, 200));
  });
  await page.goto(`${server.url}/?debug=1#/new/lakeside-camp`);
  await page.waitForFunction(() => {
    const st = window.__aether?.store.getState();
    const last = st?.chat[st.chat.length - 1];
    return !!st && !st.agentBusy && last?.role === 'assistant' && last.status !== 'streaming';
  }, null, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const cam = async (): Promise<unknown> => page.evaluate(() => {
    const r = window.__aether!.simulation!.renderer;
    const p = r.camera.position;
    return { pos: [p.x, p.y, p.z].map((v) => Math.round(v * 10) / 10), sphere: r.contentSphere, fog: r.fogState };
  });
  console.log('after build', JSON.stringify(await cam()));
  await page.evaluate(async () => window.__aether!.simulation!.frameWorld());
  await page.waitForTimeout(2500);
  console.log('after reframe', JSON.stringify(await cam()));
  const report = await page.evaluate(() => {
    const a = window.__aether!;
    const r = a.simulation!.renderer as unknown as { sync: { nodes: Map<string, { pending: boolean; failed: boolean; content: unknown; object3d?: unknown; root?: { children: unknown[]; visible: boolean } }>; warnings: Map<string, string> } };
    const out: string[] = [];
    for (const [id, e] of Object.entries(a.history.current.entities)) {
      const n = r.sync.nodes.get(id) as unknown as Record<string, unknown> | undefined;
      const keys = n ? Object.keys(n).join(',') : 'NONE';
      if (e.shape.kind === 'scatter' || (e.shape.kind === 'procedural' && ['mountain', 'terrain'].includes(e.shape.generator))) out.push(`${id} ${e.shape.kind} pending=${String(n?.['pending'])} failed=${String(n?.['failed'])} keys=${keys}`);
    }
    return { out, warnings: [...r.sync.warnings.entries()] };
  });
  console.log(report.warnings.length);
  const objs = await page.evaluate(() => {
    const r = window.__aether!.simulation!.renderer as unknown as { sync: { nodes: Map<string, { object: { visible: boolean; scale: { x: number }; position: { x: number; y: number; z: number }; children: Array<{ visible: boolean; scale: { x: number }; children: unknown[]; type: string; count?: number }> } }> } };
    const out: unknown[] = [];
    for (const id of ['pine-forest-1', 'mountain-1', 'campfire', 'tent-1']) {
      const n = r.sync.nodes.get(id);
      if (!n) { out.push(`${id} missing`); continue; }
      const o = n.object;
      out.push({ id, vis: o.visible, s: o.scale.x, p: [o.position.x, o.position.y, o.position.z], kids: o.children.map((c) => ({ t: c.type, v: c.visible, s: c.scale.x, n: c.children.length, count: c.count })) });
    }
    return out;
  });
  console.log(JSON.stringify(objs));
  await page.screenshot({ path: '/tmp/claude-1000/-home-nitiz-Projects-Self-Challenges-victoria-ar/faa68d66-5f0c-4e9a-9a4d-98d4a3853cf6/scratchpad/shots/debug-end.png' });
} finally {
  await browser.close();
  await server.stop();
}

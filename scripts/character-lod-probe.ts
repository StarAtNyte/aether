/**
 * The bodies' far levels of detail, measured in the real player: triangles (the people's in the view and in the sun's
 * shadow map, and the whole frame's) and frame time, with the far levels on and then off.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/character-lod-probe.ts [--slug=cloudwatch-harbour] [--cook=use]
 *       [--seconds=20] [--out=<report.json>]
 *
 * A world with a film (`world.story`) is measured over the whole film from its start, each pass; any other world over
 * `--seconds` of play where it opens. Frame intervals are paced by the display (16.7 ms at best), so compare the slow
 * frames and the GPU time (`gpuMs`, a timer query when the GPU has one).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const slug = arg('slug') ?? 'cloudwatch-harbour';
const cook = arg('cook') ?? 'use';
const seconds = Number(arg('seconds') ?? 20);
const out = arg('out');
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

const server = await env.startServer(() => undefined);
const browser = await chromium.launch({ executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS });
const report: Record<string, unknown> = { slug, cook };
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  if (process.env['GEN_GPU'] === 'intel') await page.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
  await page.addInitScript({ content: "window.__links = 0; { const l = WebGL2RenderingContext.prototype.linkProgram; WebGL2RenderingContext.prototype.linkProgram = function (p) { window.__links++; return l.call(this, p); }; } try { localStorage.setItem('aether.player.mute', '1'); } catch {}" });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  await page.goto(`${server.url}/play.html#t=${slug}&cook=${cook}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 180_000, polling: 250 });
  await page.waitForFunction(() => !!(window as unknown as { __aetherPlayer?: { simulation?: unknown } }).__aetherPlayer?.simulation, null, { timeout: 90_000, polling: 250 });
  await page.waitForTimeout(6000);
  report['load'] = await page.evaluate(() => (window as unknown as { __aetherCook?: { path: string } }).__aetherCook?.path);
  // A string: tsx's helpers (`__name`) do not exist in the page.
  const pass = (on: boolean): Promise<Record<string, unknown>> =>
    page.evaluate(`new Promise((done) => {
      const p = window.__aetherPlayer;
      const wr = p.simulation.renderer;
      const ch = wr.characters;
      ch.setFarLevels(${on});
      const film = !!(p.world.story && p.playStory);
      if (film) p.playStory(0);
      const links0 = window.__links;
      const dts = [], tris = [], view = [], shadow = [], gpu = [], far = [];
      let last = performance.now();
      const t0 = last;
      // The film restarts: wait for its clock to be back near 0 before reading its end.
      let started = !film;
      const tick = () => {
        const now = performance.now();
        dts.push(now - last);
        last = now;
        const st = wr.stats();
        tris.push(st.triangles);
        const d = ch.drawnTriangles();
        view.push(d.view);
        shadow.push(d.shadow);
        let n = 0;
        for (const e of ch.list) if (e.rig.levels && e.rig.levels.level === 1) n++;
        far.push(n);
        const g = wr.gpuCost && wr.gpuCost.seconds;
        if (typeof g === 'number') gpu.push(g * 1000);
        const s = p.story;
        if (s && s.time < 1) started = true;
        if (!started) { last = now; dts.length = 0; tris.length = 0; view.length = 0; shadow.length = 0; gpu.length = 0; far.length = 0; requestAnimationFrame(tick); return; }
        const over = film ? (!s || s.time > s.duration - 0.05) : now - t0 > ${seconds * 1000};
        if (over) done({ film, dts: dts.slice(5), tris, view, shadow, gpu, far, people: ch.list.length, withLod: ch.list.filter((e) => e.rig.levels).length, links: window.__links - links0 });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })`) as Promise<Record<string, unknown>>;
  const sum = (r: Record<string, unknown>): Record<string, unknown> => {
    const q = (a: number[], f: number): number => {
      const s = [...a].sort((x, y) => x - y);
      return Math.round((s[Math.min(s.length - 1, Math.floor(s.length * f))] ?? 0) * 10) / 10;
    };
    const mean = (a: number[]): number => Math.round(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length));
    const dts = r['dts'] as number[];
    const gpu = r['gpu'] as number[];
    const far = r['far'] as number[];
    return {
      frames: dts.length,
      people: r['people'],
      withFarLevel: r['withLod'],
      framesWithAFarBody: far.filter((n) => n > 0).length,
      frameMs: { p50: q(dts, 0.5), p95: q(dts, 0.95), worst: q(dts, 1), over50: dts.filter((t) => t > 50).length },
      gpuMs: gpu.length > 0 ? { p50: q(gpu, 0.5), p95: q(gpu, 0.95), mean: Math.round((gpu.reduce((a, b) => a + b, 0) / gpu.length) * 100) / 100 } : null,
      triangles: { frameMean: mean(r['tris'] as number[]), peopleViewMean: mean(r['view'] as number[]), peopleShadowMean: mean(r['shadow'] as number[]), peopleViewMax: Math.max(...(r['view'] as number[])) },
      programsLinked: r['links'],
    };
  };
  // A warm pass first (links, uploads), unmeasured, then off and on.
  log('warm pass');
  await pass(true);
  log('far levels off');
  report['off'] = sum(await pass(false));
  log(JSON.stringify(report['off']));
  log('far levels on');
  report['on'] = sum(await pass(true));
  log(JSON.stringify(report['on']));
  report['errors'] = errors.slice(0, 20);
} finally {
  await browser.close();
  await server.stop?.();
}
if (out) writeFileSync(resolve(out), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exit(0);

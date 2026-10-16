/**
 * Which graphics backend ran, and why. Opens the studio under four conditions and asserts the backend, the recorded
 * reason, the number of adapter requests and the Settings indicator:
 *
 *  1. default: WebGPU, answered at once, no graphics errors in the console; on a real GPU the standard water tier runs
 *     on WebGPU (the scene backdrop is drawn);
 *  2. flaky adapter (the first four requests answer null): WebGPU after retries;
 *  3. no adapter at all: WebGL2, reason `no-adapter`, a visible explanation in Settings, a working viewport;
 *  4. WebGL2 chosen in Settings: reason `requested`.
 *
 *   npx tsx tests/e2e/backend.e2e.ts          (software rasteriser)
 *   AETHER_E2E_GPU=1 npx tsx tests/e2e/backend.e2e.ts   (the machine's GPU)
 */
import { chromium, type BrowserContext } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const log = (l: string): void => void process.stdout.write(`${l}\n`);
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
}

interface Seen {
  backend: string;
  reason: string;
  attempts: number;
  tier: string;
  waterTier: string;
  backdropDraws: number;
  indicator: { backend: string | null; reason: string | null; text: string } | null;
  errors: string[];
  frames: number;
}

async function scenario(context: BrowserContext, url: string, world: string): Promise<Seen> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errors.push(m.text().slice(0, 200));
  });
  try {
    await page.goto(`${url}/?debug=1#/new/${world}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const a = window.__aether;
        return !!a && a.simulation !== null && a.store.getState().loading === null && Object.keys(a.history.current.entities).length > 0;
      },
      null,
      { timeout: 150_000, polling: 250 },
    );
    await page.evaluate(async () => void (await window.__aether?.simulation?.whenSynced()));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__aether?.store.getState().setSettingsOpen(true));
    await page.waitForTimeout(400);
    const indicator = page.locator('[data-testid="backend-indicator"]');
    const shown = (await indicator.count()) > 0 ? { backend: await indicator.getAttribute('data-backend'), reason: await indicator.getAttribute('data-reason'), text: ((await indicator.textContent()) ?? '').trim() } : null;
    const seen = await page.evaluate(() => {
      const sim = window.__aether?.simulation;
      const r = sim?.renderer;
      const w = r?.waterDebug();
      return { backend: sim?.backend ?? '?', reason: r?.gpu.report.reason ?? '?', attempts: r?.gpu.report.adapterAttempts ?? -1, tier: r?.gpu.tier ?? '?', waterTier: w?.tier ?? '?', backdropDraws: w?.backdrop.draws ?? 0, frames: r?.frameCount ?? 0 };
    });
    return { ...seen, indicator: shown, errors };
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const ctx = async (settings: object | null, script?: string): Promise<BrowserContext> => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await c.addInitScript(SKIP_FIRST_RUN);
    if (settings) await c.addInitScript(`try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}`);
    if (script) await c.addInitScript(script);
    return c;
  };
  try {
    // 1. Default.
    let c = await ctx(null);
    let s = await scenario(c, server.url, 'sakura-river');
    await c.close();
    log(`default: ${JSON.stringify({ ...s, errors: s.errors.length })}`);
    check(s.backend === 'webgpu' && s.reason === 'webgpu', 'default run uses WebGPU');
    check(s.errors.filter((e) => /webgpu|validation|invalid|binding/i.test(e)).length === 0, `no graphics errors in the console (${s.errors.slice(0, 2).join(' | ')})`);
    check(s.indicator?.backend === 'webgpu', 'Settings shows the WebGPU backend');
    check(s.frames > 0, 'the viewport draws');
    if (s.tier !== 'software') {
      check(s.waterTier === 'standard' || s.waterTier === 'high', `water runs the ${s.waterTier} tier on WebGPU`);
      check(s.backdropDraws > 0, 'the scene behind the water is drawn on WebGPU');
    }

    // 2. A flaky adapter: null four times, then the real one.
    const flaky =
      "(() => { const g = navigator.gpu; if (!g) return; const real = g.requestAdapter.bind(g); let n = 0; g.requestAdapter = async (o) => (++n <= 4 ? null : real(o)); })();";
    c = await ctx(null, flaky);
    s = await scenario(c, server.url, 'orbital-lab');
    await c.close();
    log(`flaky: ${JSON.stringify({ ...s, errors: s.errors.length })}`);
    check(s.backend === 'webgpu', 'WebGPU after a few null adapters');
    check(s.attempts >= 5, `the adapter was requested again (${s.attempts} requests)`);

    // 3. No adapter at all.
    const none = "(() => { const g = navigator.gpu; if (g) g.requestAdapter = async () => null; })();";
    c = await ctx(null, none);
    s = await scenario(c, server.url, 'orbital-lab');
    await c.close();
    log(`no adapter: ${JSON.stringify({ ...s, errors: s.errors.length })}`);
    check(s.backend === 'webgl2' && s.reason === 'no-adapter', 'a null adapter falls back to WebGL2 with the reason recorded');
    check(s.attempts >= 9, `every retry was made (${s.attempts} requests)`);
    check(s.indicator?.backend === 'webgl2' && /no WebGPU adapter/i.test(s.indicator.text), `Settings explains the fallback (${s.indicator?.text ?? 'no indicator'})`);
    check(s.frames > 0, 'the WebGL2 viewport draws');

    // 4. WebGL2 chosen.
    c = await ctx({ backend: 'webgl2' });
    s = await scenario(c, server.url, 'orbital-lab');
    await c.close();
    log(`webgl2: ${JSON.stringify({ ...s, errors: s.errors.length })}`);
    check(s.backend === 'webgl2' && s.reason === 'requested', 'WebGL2 chosen in Settings runs WebGL2');
    check(s.errors.length === 0, `no errors on WebGL2 (${s.errors[0] ?? ''})`);
  } finally {
    await browser.close();
    await server.stop();
  }
  if (failures.length > 0) {
    log(`${failures.length} check(s) failed`);
    process.exit(1);
  }
  log('backend e2e passed');
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});

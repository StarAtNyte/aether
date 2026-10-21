/**
 * Gameplay effects render on every backend: Chromium WebGPU, Chromium WebGL2 and Firefox (WebGL2). For each, the
 * studio opens a small stage (ground, a pillar, a torch with a fire emitter, night sky), and the renderer's own
 * screenshot is taken with the effects hidden and shown, with the effects clock frozen at a known age after a burst of
 * every kind (sparks, explosion, sparkle, magic, dust, smoke, splash, confetti). The suite fails when the effects do
 * not change the picture where they were emitted, when a backend is not the one asked for, or when the page logs a
 * shader or validation error. The frames go to the output directory for a look.
 *
 *   npx tsx tests/e2e/vfx.e2e.ts <outDir> [--only=chromium-webgpu,chromium-webgl2,firefox-webgl2] [--size=960x540]
 *   (`npm run e2e:vfx -- <outDir>`; AETHER_E2E_GPU=1 for the real GPU instead of SwiftShader)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';
import { decodePng, type RgbaImage } from './support/png';
import { encodePng, sideBySide } from './support/png-encode';

const ARGS = process.argv.slice(2);
const outDir = ARGS.find((a) => !a.startsWith('--')) ?? 'vfx-out';
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ONLY = (arg('only') ?? 'chromium-webgpu,chromium-webgl2,firefox-webgl2').split(',').filter(Boolean);
const [W, H] = (arg('size') ?? '960x540').split('x').map(Number) as [number, number];
const log = (l: string): void => void process.stdout.write(`${l}\n`);

/** The stage: night, so additive light reads; a lit ground so dust and smoke read too. */
const STAGE = [
  { op: 'clear', keepEnvironment: false },
  { op: 'setEnvironment', set: { sky: 'sunset', weather: 'clear' } },
  { op: 'add', entity: { id: 'pillar', name: 'Pillar', transform: { position: [-3, 1, -1] }, shape: { kind: 'primitive', primitive: 'box', size: [0.6, 2, 0.6] }, material: { color: '#8a8278' } } },
  { op: 'add', entity: { id: 'torch', name: 'Torch', transform: { position: [3, 0.9, 0] }, shape: { kind: 'primitive', primitive: 'cylinder', size: [0.12, 1.8, 0.12] }, material: { color: '#4a3524' }, vfx: { preset: 'fire', offset: [0, 1, 0] } } },
] as const;

/** Bursts and where (x, y, z) — spread over the frame. */
const BURSTS: ReadonlyArray<[string, number, number, number]> = [
  ['explosion', 0, 1.2, 0],
  ['sparks', -2, 0.3, 1.5],
  ['sparkle', 1.6, 1.4, 1.8],
  ['magic', -1.4, 1.6, -0.5],
  ['dust', 0.6, 0.05, 2.6],
  ['smoke', -3.2, 2.2, -1],
  ['splash', 2.2, 0.05, 2.4],
  ['confetti', 0, 2.5, 1],
];

interface Result {
  name: string;
  backend: string;
  changed: number;
  regions: Array<{ preset: string; changed: number }>;
  errors: string[];
  particles: number;
}

async function runOne(browser: Browser, url: string, name: string, backend: 'webgpu' | 'webgl2'): Promise<Result> {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await context.addInitScript(SKIP_FIRST_RUN);
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  await context.addInitScript(`try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ backend: '${backend}' })); } catch {}`);
  const page: Page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || (m.type() === 'warning' && /webgpu|wgsl|glsl|shader|validation|invalid|binding/i.test(t))) errors.push(`${m.type()}: ${t.slice(0, 240)}`);
  });
  try {
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aether?.simulation != null && window.__aether.store.getState().loading === null, null, { timeout: 180_000, polling: 250 });
    await page.evaluate(async (stage) => {
      const a = window.__aether;
      if (!a) throw new Error('no debug handle');
      const r = a.history.commit(stage as unknown as unknown[], 'vfx stage', 'user');
      if (r.errors.length > 0) throw new Error(r.errors.map((e) => e.message).join('; '));
      await a.simulation?.whenSynced();
    }, STAGE);
    await page.waitForTimeout(1500);
    const info = await page.evaluate(
      async ([w, h, bursts]) => {
        const sim = window.__aether?.simulation;
        const r = sim?.renderer;
        if (!sim || !r) throw new Error('no renderer');
        r.setCameraPose(0, 2.4, 8.5, 0, -0.16);
        r.setAdaptiveResolution(false);
        const fx = r.fx;
        // Let the torch burn for a moment, then freeze the clock and play every burst at a known age.
        await new Promise((ok) => setTimeout(ok, 1200));
        fx.paused = true;
        for (const [preset, x, y, z] of bursts as Array<[string, number, number, number]>) fx.trigger(null, [x, y, z], { seed: 7, vfx: preset as never, floorY: 0 });
        fx.vfx.update(0.22, r.camera);
        fx.vfx.hidden = true;
        fx.vfx.update(0, r.camera);
        r.requestRender();
        const off = await r.screenshot({ width: w as number, height: h as number, mime: 'image/png' });
        fx.vfx.hidden = false;
        fx.vfx.update(0, r.camera);
        r.requestRender();
        const on = await r.screenshot({ width: w as number, height: h as number, mime: 'image/png' });
        // Project each burst to the image to measure the change around it.
        const cam = r.camera;
        const points = (bursts as Array<[string, number, number, number]>).map(([preset, x, y, z]) => {
          const v = { x, y, z };
          const e = cam.matrixWorldInverse.elements;
          const p = cam.projectionMatrix.elements;
          const vx = e[0]! * v.x + e[4]! * v.y + e[8]! * v.z + e[12]!;
          const vy = e[1]! * v.x + e[5]! * v.y + e[9]! * v.z + e[13]!;
          const vz = e[2]! * v.x + e[6]! * v.y + e[10]! * v.z + e[14]!;
          const cx = p[0]! * vx + p[4]! * vy + p[8]! * vz + p[12]!;
          const cy = p[1]! * vx + p[5]! * vy + p[9]! * vz + p[13]!;
          const cw = p[3]! * vx + p[7]! * vy + p[11]! * vz + p[15]!;
          return { preset, u: (cx / cw) * 0.5 + 0.5, v: 1 - ((cy / cw) * 0.5 + 0.5) };
        });
        return { backend: sim.backend, off, on, points, particles: fx.vfx.liveEstimate };
      },
      [W, H, BURSTS] as const,
    );
    if (info.backend !== backend) throw new Error(`asked for ${backend} but ${info.backend} ran`);
    const a: RgbaImage = decodePng(Buffer.from(info.off.slice(info.off.indexOf(',') + 1), 'base64'));
    const b: RgbaImage = decodePng(Buffer.from(info.on.slice(info.on.indexOf(',') + 1), 'base64'));
    writeFileSync(join(outDir, `${name}-off.png`), encodePng(a));
    writeFileSync(join(outDir, `${name}-on.png`), encodePng(b));
    writeFileSync(join(outDir, `${name}-pair.png`), encodePng(sideBySide(a, b)));
    const changedIn = (x0: number, y0: number, x1: number, y1: number): number => {
      let n = 0;
      let all = 0;
      for (let y = Math.max(0, y0); y < Math.min(a.height, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(a.width, x1); x++) {
          const i = (y * a.width + x) * 4;
          const d = Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!);
          if (d > 24) n++;
          all++;
        }
      }
      return all > 0 ? n / all : 0;
    };
    const r = Math.round(a.width * 0.06);
    const regions = info.points.map((p) => {
      const x = Math.round(p.u * a.width);
      const y = Math.round(p.v * a.height);
      return { preset: p.preset, changed: changedIn(x - r, y - r, x + r, y + r) };
    });
    return { name, backend: info.backend, changed: changedIn(0, 0, a.width, a.height), regions, errors, particles: info.particles };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const server = await startServer(log);
  let failed = 0;
  try {
    const runs: Array<{ name: string; browser: 'chromium' | 'firefox'; backend: 'webgpu' | 'webgl2' }> = [
      { name: 'chromium-webgpu', browser: 'chromium', backend: 'webgpu' },
      { name: 'chromium-webgl2', browser: 'chromium', backend: 'webgl2' },
      { name: 'firefox-webgl2', browser: 'firefox', backend: 'webgl2' },
    ];
    for (const run of runs.filter((r) => ONLY.includes(r.name))) {
      const browser = run.browser === 'chromium' ? await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }) : await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
      try {
        const res = await runOne(browser, server.url, run.name, run.backend);
        // Each burst must visibly change its own neighbourhood; the frame as a whole must change.
        const weak = res.regions.filter((g) => g.changed < 0.04);
        const bad = res.errors.length > 0 || res.changed < 0.01 || weak.length > 0;
        if (bad) failed++;
        log(`${bad ? 'FAIL' : 'ok  '} ${res.name}: backend ${res.backend}, ${(res.changed * 100).toFixed(1)}% of pixels changed, ~${res.particles} particles; ${res.regions.map((g) => `${g.preset} ${(g.changed * 100).toFixed(0)}%`).join(', ')}`);
        for (const e of res.errors.slice(0, 6)) log(`     ${e}`);
        if (weak.length > 0) log(`     no visible change at: ${weak.map((g) => g.preset).join(', ')}`);
      } catch (e) {
        failed++;
        log(`FAIL ${run.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.stop();
  }
  if (failed > 0) {
    log(`VFX E2E FAILED (${failed})`);
    process.exitCode = 1;
  } else log('VFX E2E PASSED');
}

main().catch((err: unknown) => {
  log(`VFX E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

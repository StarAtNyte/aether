/**
 * Baked light before and after, in a real browser: for each world, the probe volume alone (`environment.lightBake: off`) and
 * each requested bake quality, with the bake's wall time and size, the draw cost per frame and screenshots from the player's
 * spawn, the reverse view and (architecture) the cover camera.
 *
 *   npx tsx scripts/lightmap-shots.ts <outDir> <slug>…
 *
 * Environment: `LM_MODES` (default `off,medium`; any of off, low, medium, high, auto), `LM_SAMPLES` (rays per texel),
 * `GEN_GPU=intel` (WebGL2/ANGLE on the integrated GPU) or `AETHER_E2E_GPU=1`, `SHOT_W` / `SHOT_H`, `LM_TIMEOUT` (seconds a
 * bake may take), `SHOT_BACKEND=webgpu|webgl2`, `LM_SAVE=dir` (writes the `.lmap` file of each bake there),
 * `LM_FRAMES` (frames of the cost measure, default 24). Prints one JSON line per run and writes `<outDir>/results.json`.
 * The server, the browser and every page are closed in a `finally`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';
import { COVER_CAMERAS } from '../tests/e2e/support/showcase-cameras';

const [outDir, ...slugs] = process.argv.slice(2);
if (!outDir || slugs.length === 0) throw new Error('usage: lightmap-shots <outDir> <slug>…');

const log = (l: string): void => void process.stdout.write(`${l}\n`);
const W = Number(process.env['SHOT_W'] ?? 1280);
const H = Number(process.env['SHOT_H'] ?? 720);
const MODES = (process.env['LM_MODES'] ?? 'off,medium').split(',').filter(Boolean);
const SAMPLES = process.env['LM_SAMPLES'] ? Number(process.env['LM_SAMPLES']) : undefined;
const TIMEOUT_S = Number(process.env['LM_TIMEOUT'] ?? 900);
const FRAMES = Number(process.env['LM_FRAMES'] ?? 24);
const INTEL_ARGS: readonly string[] = ['--enable-unsafe-webgpu', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'];

async function open(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      return st.loading === null && !st.agentBusy && (Object.keys(a.history.current.entities).length > 0 || a.history.current.voxel !== undefined);
    },
    null,
    { timeout: 180_000, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 120_000, polling: 500 }).catch(() => log('  (still animating)'));
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.setPanel('left', false);
    st?.setPanel('right', false);
    st?.updateSettings({ showNavHint: false });
  });
  await page.waitForTimeout(800);
}

interface Cam {
  name: string;
  pos: [number, number, number];
  target: [number, number, number];
  arch?: { walls?: 'up' | 'cutaway' | 'down'; levelMode?: 'stacked' | 'exploded' };
}

/** Interior cameras from the world's own spawn (eye height, along and against its heading) and the cover camera. */
async function cameras(page: Page, slug: string): Promise<Cam[]> {
  const spawn = await page.evaluate(() => {
    const p = window.__aether?.history.current.player;
    return p ? { spawn: p.spawn as [number, number, number], yaw: (p.yaw as number | undefined) ?? 0 } : null;
  });
  const out: Cam[] = [];
  if (spawn) {
    for (const [name, add] of [['spawn', 0], ['back', 180]] as const) {
      const a = ((spawn.yaw + add) * Math.PI) / 180;
      const pos: [number, number, number] = [spawn.spawn[0], spawn.spawn[1] + 1.6, spawn.spawn[2]];
      out.push({ name, pos, target: [pos[0] - Math.sin(a) * 4, pos[1] - 0.25, pos[2] - Math.cos(a) * 4] });
    }
  }
  const cover = COVER_CAMERAS[slug];
  if (cover) out.push({ name: 'cover', pos: [...cover.pos], target: [...cover.target], ...(cover.arch ? { arch: cover.arch } : {}) });
  return out;
}

async function setCam(page: Page, c: Cam): Promise<void> {
  await page.evaluate(
    ([p, t, arch]) => {
      if (arch) window.__aether?.store.getState().setArch(arch as never);
      const dx = t[0]! - p[0]!;
      const dy = t[1]! - p[1]!;
      const dz = t[2]! - p[2]!;
      window.__aether?.simulation?.renderer.setCameraPose(p[0]!, p[1]!, p[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    },
    [c.pos, c.target, c.arch ?? null] as const,
  );
  await page.waitForTimeout(1200);
}

async function waitBake(page: Page): Promise<{ ms: number; timedOut: boolean }> {
  const t0 = Date.now();
  let timedOut = false;
  await page
    .waitForFunction(
      () => {
        const r = window.__aether?.simulation?.renderer;
        if (!r) return false;
        const st = r.lightmapStatus.state;
        return !r.lightVolumeBaking && (st === 'applied' || st === 'failed' || st === 'idle' || st === 'cancelled');
      },
      null,
      { timeout: TIMEOUT_S * 1000, polling: 500 },
    )
    .catch(() => {
      timedOut = true;
    });
  return { ms: Date.now() - t0, timedOut };
}

async function frameCost(page: Page, c: Cam): Promise<{ median: number; p90: number }> {
  const [p, t] = [c.pos, c.target];
  return page.evaluate(
    async ([pos, target, frames]) => {
      const r = window.__aether?.simulation?.renderer as unknown as {
        setAdaptiveResolution(on: boolean): void;
        requestRender(): void;
        setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
      };
      r.setAdaptiveResolution(false);
      const dx = target[0]! - pos[0]!, dy = target[1]! - pos[1]!, dz = target[2]! - pos[2]!;
      let yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const times: number[] = [];
      const warm = 14;
      await new Promise<void>((done) => {
        let n = 0;
        let last = performance.now();
        const step = (now: number): void => {
          times.push(now - last);
          last = now;
          yaw += 0.002;
          r.setCameraPose(pos[0]!, pos[1]!, pos[2]!, yaw, pitch);
          r.requestRender();
          if (++n < (frames as number) + warm) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      const sorted = times.slice(warm).sort((x, y) => x - y);
      const at = (f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] as number;
      return { median: at(0.5), p90: at(0.9) };
    },
    [p, t, FRAMES] as const,
  );
}

async function shoot(page: Page, file: string): Promise<void> {
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 40_000, polling: 500 }).catch(() => undefined);
  const data = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w as number, height: h as number, mime: 'image/png' })) ?? null, [W, H]);
  if (!data) throw new Error('capture failed');
  writeFileSync(file, Buffer.from(data.slice('data:image/png;base64,'.length), 'base64'));
}

async function main(): Promise<void> {
  mkdirSync(outDir!, { recursive: true });
  const server = await startServer(log);
  const intel = process.env['GEN_GPU'] === 'intel';
  const browser = await chromium.launch({ executablePath: findChrome(), args: intel ? [...INTEL_ARGS] : [...CHROME_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'], headless: true });
  const results: unknown[] = [];
  try {
    for (const slug of slugs) {
     // A fresh page per mode: the light volume (and with it the eye's exposure) depends on the architectural view (cutaway
     // walls), so every mode bakes from the state a world opens in, before the camera moves into the room.
     for (const mode of MODES) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(SKIP_FIRST_RUN);
      await ctx.addInitScript('globalThis.__name = (f) => f;');
      if (process.env['SHOT_BACKEND']) await ctx.addInitScript(`try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ backend: ${JSON.stringify(process.env['SHOT_BACKEND'])} })); } catch {}`);
      try {
        const page = await ctx.newPage();
        page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
        page.on('console', (m) => {
          if (m.type() === 'error' || m.type() === 'warning') log(`  console.${m.type()}: ${m.text().slice(0, 240)}`);
        });
        await open(page, server.url, slug);
        const cams = await cameras(page, slug);
        {
          log(`${slug} [${mode}]`);
          await page.evaluate(
            ([m, s]) => {
              const a = window.__aether;
              if (!a) return;
              if (m === 'auto') a.studio.setLightBake(null);
              else if (s !== null && m !== 'off') a.studio.commitUser([{ op: 'setEnvironment', set: { lightBake: { quality: m, samples: s } } }], 'bake');
              else a.studio.setLightBake(m as 'off' | 'low' | 'medium' | 'high');
            },
            [mode, SAMPLES ?? null] as const,
          );
          const waited = await waitBake(page);
          const info = await page.evaluate(() => {
            const r = window.__aether?.simulation?.renderer;
            return r ? { status: r.lightmapStatus, stats: r.lightmapStats, volume: r.lightVolumeStats } : null;
          });
          if (process.env['LM_SAVE'] && mode !== 'off') {
            const b64 = await page.evaluate(() => {
              const a = window.__aether?.simulation?.renderer.lightmapAsset;
              if (!a) return null;
              let s = '';
              for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
              return btoa(s);
            });
            if (b64 && info?.stats) {
              mkdirSync(process.env['LM_SAVE'], { recursive: true });
              writeFileSync(join(process.env['LM_SAVE'], `${info.stats.key}.lmap`), Buffer.from(b64, 'base64'));
            }
          }
          const costs: Record<string, { median: number; p90: number }> = {};
          const eye: Record<string, unknown> = {};
          for (const c of cams) {
            await setCam(page, c);
            await page.waitForFunction(() => window.__aether?.simulation?.renderer.lightVolumeBaking !== true, null, { timeout: 60_000, polling: 250 }).catch(() => undefined);
            await shoot(page, join(outDir!, `${slug}-${mode}-${c.name}.png`));
            eye[c.name] = await page.evaluate((pos) => {
              const r = window.__aether?.simulation?.renderer;
              const s = r?.lightVolumeAt(pos[0]!, pos[1]!, pos[2]!);
              return s ? { eyeEv: s.eyeEv, ev: s.ev, vis: s.vis, bounce: s.bounce, lamps: s.lamps } : null;
            }, c.pos);
            if (c.name === 'spawn' || c.name === 'cover') costs[c.name] = await frameCost(page, c);
          }
          const row = { slug, mode, samples: SAMPLES ?? null, bakeWaitMs: waited.ms, timedOut: waited.timedOut, ...info, frameMs: costs, eye };
          results.push(row);
          log(JSON.stringify(row));
        }
      } finally {
        await ctx.close();
      }
     }
    }
  } finally {
    writeFileSync(join(outDir!, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    await server.stop();
  }
}

await main();

/**
 * KTX2 compressed textures against the original images, in a real browser.
 *
 * For each target (Chromium on WebGPU, Chromium on WebGL2, Firefox on WebGL2) and each scene (three flagships,
 * a house the offline planner builds from a prompt, and a close-up of photographed library models and two of
 * the cast, one tinted), the studio is opened twice in fresh browser contexts: with KTX2 twins (the default)
 * and with `?textures=rgba` (the original WebP / JPEG / PNG). Each run records
 *
 * - GPU texture memory (`renderer.memoryStats().texturesMB`: three.js's per-texture accounting, corrected for
 *   compressed textures and generated mip levels) and the texture count,
 * - load time (navigation to the world being ready and the last library file in) and the library download
 *   (bytes on the wire as served, and the files' size on disk),
 * - the KTX2 state (on / off and the GPU formats the transcoder targets),
 * - a still from a fixed camera, saved next to the other mode's still with a difference score.
 *
 * Prints a Markdown table and writes the stills, side-by-side pairs and `results.json` to `--out`
 * (default: a fresh temp directory). One browser at a time, closed in `finally`. Any console error that
 * mentions KTX2, Basis or a texture fails the run.
 *
 * Run: `npm run build && npx tsx tests/e2e/ktx2.e2e.ts [--only=chromium-webgpu|chromium-webgl2|firefox]
 * [--scenes=lantern-isles,closeup] [--out=dir]` (`AETHER_E2E_GPU=1` for the machine's GPU in Chromium).
 */
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { createWorld } from '@aether/core';
import { decodePng, pixelStats } from './support/png';
import { encodePng, imageDiff, sideBySide } from './support/png-encode';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ONLY = arg('only');
const OUT = arg('out') ?? mkdtempSync(join(tmpdir(), 'aether-ktx2-'));
const TIMEOUT = 180_000;
const W = 1280;
const H = 720;
const startedAt = performance.now();

function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

interface Target {
  name: string;
  launch(): Promise<Browser>;
  hideWebGPU: boolean;
}

const TARGETS: readonly Target[] = [
  { name: 'chromium-webgpu', launch: () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), hideWebGPU: false },
  { name: 'chromium-webgl2', launch: () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), hideWebGPU: true },
  { name: 'firefox', launch: () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }), hideWebGPU: false },
];

interface Camera {
  pos: readonly [number, number, number];
  target: readonly [number, number, number];
  walls?: 'up' | 'cutaway' | 'down';
}

interface Scene {
  name: string;
  open(page: Page, url: string, query: string): Promise<void>;
  cameras: Readonly<Record<string, Camera>>;
  /** Also export a GLB (texture count) and path-trace one camera (the export graph keeps compressed textures). */
  extras?: { trace: Camera };
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
    },
    null,
    { timeout: TIMEOUT, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
}

const template = (slug: string): Scene => {
  const cover = COVER_CAMERAS[slug];
  return {
    name: slug,
    async open(page, url, query) {
      await page.goto(`${url}/?debug=1${query}#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
    },
    cameras: cover ? { cover: { pos: cover.pos, target: cover.target, ...(cover.arch?.walls ? { walls: cover.arch.walls } : {}) } } : {},
  };
};

/** A house the offline planner builds and furnishes from a prompt. */
const generatedHouse: Scene = {
  name: 'generated-house',
  async open(page, url, query) {
    await page.goto(`${url}/?debug=1${query}#/new`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.evaluate(async () => {
      await window.__aether?.studio.send('A furnished two-storey family house with a living room, a kitchen and two bedrooms');
    });
    await waitReady(page);
  },
  cameras: { aerial: { pos: [-15, 13, -17], target: [0, 1, 0], walls: 'cutaway' }, inside: { pos: [-3, 1.6, -3], target: [3, 1, 3], walls: 'cutaway' } },
};

/** Photographed library models and two of the cast close up, under a low sun (normal maps read in relief). */
const closeup: Scene = {
  name: 'closeup',
  async open(page, url, query) {
    await page.goto(`${url}/?debug=1${query}#/new`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const at = (x: number, z: number, ry = 0): { transform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } } => ({ transform: { position: [x, 0, z], rotation: [0, ry, 0], scale: [1, 1, 1] } });
    const world = createWorld({
      name: 'KTX2 close-up',
      environment: { timeOfDay: 16.5 },
      entities: {
        armchair: { id: 'armchair', shape: { kind: 'asset', id: 'armchair-classic' }, ...at(0, 0, 0.35) },
        barrel: { id: 'barrel', shape: { kind: 'asset', id: 'barrel-realistic' }, ...at(1.5, -0.2) },
        cat: { id: 'cat', shape: { kind: 'asset', id: 'cat-statue' }, ...at(-1.4, 0.1, -0.5) },
        lantern: { id: 'lantern', shape: { kind: 'asset', id: 'lantern-wood' }, ...at(0.8, 1.1) },
        lamp: { id: 'lamp', shape: { kind: 'asset', id: 'street-lamp-realistic' }, ...at(2.6, -1.2) },
        crate: { id: 'crate', shape: { kind: 'asset', id: 'crate' }, ...at(-2.6, 0.4) },
        dario: { id: 'dario', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.8, 0.5] }, character: { body: 'dario' }, ...at(-0.9, 1.5, 0.3) },
        sophie: { id: 'sophie', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.7, 0.5] }, character: { body: 'sophie', top: '#b8322a', hair: '#e0c068' }, ...at(1.6, 1.4, -0.3) },
      },
    });
    const payload: unknown = JSON.parse(JSON.stringify(world));
    await page.evaluate((w) => window.__aether?.studio.replaceWorld(w as never, 'ktx2 close-up'), payload);
    await waitReady(page);
  },
  extras: { trace: { pos: [0.55, 1.05, 1.35], target: [0, 0.55, 0] } },
  cameras: {
    group: { pos: [0.3, 1.5, 5.2], target: [0, 0.75, 0] },
    armchair: { pos: [0.55, 1.05, 1.35], target: [0, 0.55, 0] },
    // The cast faces -Z: from in front of them.
    people: { pos: [0.35, 1.45, -0.7], target: [0.3, 1.05, 1.45] },
    // Hair cards (alpha cut-outs, UASTC) close up.
    hair: { pos: [-0.8, 1.3, 0.75], target: [-0.9, 1.15, 1.5] },
  },
};

const SCENES: readonly Scene[] = [template('lantern-isles'), template('kart-canyon'), template('skyline-penthouse'), generatedHouse, closeup];
const WANT = arg('scenes')?.split(',');

interface Run {
  target: string;
  scene: string;
  mode: 'ktx2' | 'rgba';
  readyMs: number;
  assetsMs: number;
  wireBytes: number;
  diskBytes: number;
  files: number;
  texturesMB: number;
  /** Bytes of block-compressed plus decoded-image textures (the library's textures; render targets and procedural data excluded). */
  assetTexturesMB: number;
  breakdown: string;
  textures: number;
  compression: string;
  stills: string[];
  errors: string[];
  /** Textures in the exported GLB (close-up only). */
  exportTextures?: number;
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: TIMEOUT, polling: 500 }).catch(() => undefined);
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.lightVolumeBaking !== true && window.__aether?.simulation?.renderer.foliagePending !== true, null, { timeout: 60_000, polling: 250 }).catch(() => undefined);
}

async function shoot(page: Page, cam: Camera): Promise<Buffer> {
  await page.evaluate((walls) => window.__aether?.store.getState().setArch({ walls }), cam.walls ?? 'up');
  await page.evaluate(
    ([p, t]) => {
      const dx = t[0] - p[0];
      const dy = t[1] - p[1];
      const dz = t[2] - p[2];
      window.__aether?.simulation?.renderer.setCameraPose(p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    },
    [cam.pos, cam.target] as const,
  );
  await page.waitForTimeout(2500);
  await settle(page);
  const url = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w, height: h, mime: 'image/png' })) ?? '', [W, H] as const);
  if (!url.startsWith('data:image/png;base64,')) throw new Error('capture failed');
  return Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
}

function diskSize(urlPath: string): number {
  const rel = urlPath.replace(/^\/+/, '');
  const file = rel.startsWith('assets/lib/') ? join(REPO_ROOT, rel) : join(REPO_ROOT, 'apps/studio/public', rel);
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

async function runOne(browser: Browser, target: Target, url: string, scene: Scene, mode: 'ktx2' | 'rgba'): Promise<Run> {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  if (target.hideWebGPU) {
    await context.addInitScript(() => {
      delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu'];
    });
  }
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 240));
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 240)}`));
  const t0 = performance.now();
  let lastLib = t0;
  let wire = 0;
  let disk = 0;
  let files = 0;
  const pending: Array<Promise<void>> = [];
  page.on('requestfinished', (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith('/assets/lib/') && !u.pathname.startsWith('/basis/') && !u.pathname.startsWith('/blocks/')) return;
    lastLib = performance.now();
    files++;
    disk += diskSize(u.pathname);
    pending.push(
      req.sizes().then(
        (s) => {
          wire += s.responseBodySize;
        },
        () => undefined,
      ),
    );
  });
  try {
    const query = mode === 'rgba' ? '&textures=rgba' : '';
    await scene.open(page, url, query);
    const readyMs = performance.now() - t0;
    await page.evaluate(() => {
      const st = window.__aether?.store.getState();
      st?.setPanel('left', false);
      st?.setPanel('right', false);
      st?.updateSettings({ showNavHint: false });
    });
    await settle(page);
    // Library files stream in after the first frame: wait until none has arrived for 2.5 s.
    for (let i = 0; i < 120 && performance.now() - lastLib < 2500; i++) await page.waitForTimeout(500);
    await Promise.all(pending);
    const assetsMs = Math.round(lastLib - t0);
    const stills: string[] = [];
    const cams = Object.entries(scene.cameras);
    for (const [name, cam] of cams.length > 0 ? cams : [['default', null] as const]) {
      const png = cam ? await shoot(page, cam) : Buffer.from(((await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w, height: h, mime: 'image/png' })) ?? '', [W, H] as const)) || ',').split(',')[1] ?? '', 'base64');
      const file = join(OUT, `${target.name}-${scene.name}-${name}-${mode}.png`);
      writeFileSync(file, png);
      stills.push(file);
    }
    let exportTextures: number | undefined;
    if (scene.extras) {
      exportTextures = await page.evaluate(async () => {
        const r = window.__aether?.simulation?.renderer as unknown as { exportGltf(o: { binary: boolean }): Promise<{ data: Uint8Array | string }> };
        const out = await r.exportGltf({ binary: true });
        if (typeof out.data === 'string') return -1;
        // GLB JSON chunk: count "images".
        const view = new DataView(out.data.buffer, out.data.byteOffset, out.data.byteLength);
        const len = view.getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(out.data.subarray(20, 20 + len))) as { images?: unknown[] };
        return json.images?.length ?? 0;
      });
      const t = scene.extras.trace;
      const img = await page.evaluate(async ([p, tg, w, h]) => {
        const r = window.__aether?.simulation?.renderer as unknown as { pathTraceStill(o: { width: number; height: number; samples: number; pose: { pos: number[]; target: number[] } }): Promise<{ width: number; height: number; data: Uint8Array }> };
        const s = await r.pathTraceStill({ width: w, height: h, samples: 48, pose: { pos: [...p], target: [...tg] } });
        return { width: s.width, height: s.height, data: Array.from(s.data) };
      }, [t.pos, t.target, 640, 360] as const);
      const file = join(OUT, `${target.name}-${scene.name}-trace-${mode}.png`);
      writeFileSync(file, encodePng({ width: img.width, height: img.height, data: Uint8Array.from(img.data) }));
      stills.push(file);
    }
    const mem = await page.evaluate(() => {
      (window as unknown as { gc?: () => void }).gc?.();
      const r = window.__aether?.studio.memoryReport().renderer as unknown as {
        texturesMB: number;
        textures: number;
        textureBreakdownMB: Record<string, { count: number; mb: number }> | null;
        compression: { state: string; reason: string | null; formats: string | null; setupMs: number | null };
      } | null;
      if (!r) return null;
      const b = r.textureBreakdownMB;
      const asset = b ? (b['compressed']?.mb ?? 0) + (b['image']?.mb ?? 0) : -1;
      const breakdown = b ? Object.entries(b).map(([k, v]) => `${k} ${v.mb} MB/${v.count}`).join(', ') : '?';
      const c = r.compression;
      return { texturesMB: r.texturesMB, assetTexturesMB: Math.round(asset * 10) / 10, breakdown, textures: r.textures, compression: `${c.state}${c.formats ? ` (${c.formats})` : ''}${c.setupMs !== null ? ` ${c.setupMs} ms` : ''}${c.reason ? `: ${c.reason}` : ''}` };
    });
    return {
      target: target.name,
      scene: scene.name,
      mode,
      readyMs: Math.round(readyMs),
      assetsMs,
      wireBytes: wire,
      diskBytes: disk,
      files,
      texturesMB: mem?.texturesMB ?? -1,
      assetTexturesMB: mem?.assetTexturesMB ?? -1,
      breakdown: mem?.breakdown ?? '?',
      textures: mem?.textures ?? -1,
      compression: mem?.compression ?? '?',
      stills,
      errors,
      ...(exportTextures !== undefined ? { exportTextures } : {}),
    };
  } finally {
    await context.close();
  }
}

const MB = (b: number): string => (b / 1048576).toFixed(1);

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(log);
  const runs: Run[] = [];
  const failures: string[] = [];
  try {
    for (const target of TARGETS) {
      if (ONLY && ONLY !== target.name) continue;
      const browser = await target.launch();
      try {
        for (const scene of SCENES) {
          if (WANT && !WANT.includes(scene.name)) continue;
          for (const mode of ['ktx2', 'rgba'] as const) {
            log(`${target.name} ${scene.name} ${mode}`);
            try {
              const r = await runOne(browser, target, server.url, scene, mode);
              runs.push(r);
              log(`  textures ${r.texturesMB} MB (${r.textures}; ${r.breakdown}), ready ${r.readyMs} ms, assets ${r.assetsMs} ms, ${r.files} files ${MB(r.wireBytes)} MB wire / ${MB(r.diskBytes)} MB disk, KTX2 ${r.compression}${r.exportTextures !== undefined ? `, GLB export ${r.exportTextures} images` : ''}`);
              const bad = r.errors.filter((e) => /ktx|basis|transcod|texture|compressed/i.test(e));
              if (bad.length > 0) failures.push(`${target.name} ${scene.name} ${mode}: ${bad.join(' | ')}`);
              if (r.errors.length > 0) log(`  console errors: ${r.errors.slice(0, 4).join(' | ')}`);
            } catch (e) {
              failures.push(`${target.name} ${scene.name} ${mode}: ${e instanceof Error ? e.message : String(e)}`);
              log(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          const pair = runs.filter((r) => r.target === target.name && r.scene === scene.name);
          const k = pair.find((r) => r.mode === 'ktx2');
          const o = pair.find((r) => r.mode === 'rgba');
          if (k && o) {
            for (let i = 0; i < Math.min(k.stills.length, o.stills.length); i++) {
              const a = decodePng(readFileSync(k.stills[i] as string));
              const b = decodePng(readFileSync(o.stills[i] as string));
              if (a.width !== b.width || a.height !== b.height) continue;
              const d = imageDiff(a, b);
              const sa = pixelStats(a);
              writeFileSync((k.stills[i] as string).replace(/-ktx2\.png$/, '-pair.png'), encodePng(sideBySide(a, b)));
              log(`  still ${i}: mean diff ${d.mean.toFixed(2)}, ${(d.share * 100).toFixed(2)} % of pixels over tolerance, luma ${d.meanLumaA.toFixed(1)} vs ${d.meanLumaB.toFixed(1)}, stddev ${sa.stdDev.toFixed(1)}`);
            }
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.stop();
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(runs, null, 2));
  const rows = ['| Target | Scene | Image textures KTX2 / original (MB) | Ratio | All textures incl. render targets (MB) | Load KTX2 / original (s) | Library download KTX2 / original (MB, on disk) | KTX2 |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  const keys = [...new Set(runs.map((r) => `${r.target}|${r.scene}`))];
  for (const key of keys) {
    const [t, s] = key.split('|') as [string, string];
    const k = runs.find((r) => r.target === t && r.scene === s && r.mode === 'ktx2');
    const o = runs.find((r) => r.target === t && r.scene === s && r.mode === 'rgba');
    if (!k || !o) continue;
    rows.push(`| ${t} | ${s} | ${k.assetTexturesMB} / ${o.assetTexturesMB} | ${(o.assetTexturesMB / Math.max(0.1, k.assetTexturesMB)).toFixed(2)}× | ${k.texturesMB} / ${o.texturesMB} | ${(k.assetsMs / 1000).toFixed(1)} / ${(o.assetsMs / 1000).toFixed(1)} | ${MB(k.diskBytes)} / ${MB(o.diskBytes)} | ${k.compression} |`);
  }
  process.stdout.write(`\n${rows.join('\n')}\n\nstills: ${OUT}\n`);
  if (failures.length > 0) {
    process.stdout.write(`\nFAILURES:\n${failures.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    log('KTX2 E2E PASSED');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

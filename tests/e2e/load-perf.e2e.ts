/**
 * Load and runtime performance of the production build, per CPU throttle.
 *
 * For each CPU throttle (CDP Emulation.setCPUThrottlingRate) and each flagship it measures, from a cold HTTP
 * cache: the home page (first contentful paint, long-task blocking time, requests and transferred bytes), the
 * time until a world is open (loading screen gone, scene synced, render settled), what was fetched while it
 * opened (largest requests) and the frame time of a slow camera orbit with the automatic tier and adaptive
 * resolution left on. Prints Markdown rows.
 *
 * Chromium only, one browser at a time, closed in `finally`. `GEN_GPU=intel` uses the integrated GPU (WebGL2),
 * `AETHER_E2E_GPU=1` the discrete one, default is the software rasteriser (numbers are only relative).
 * `--url=https://host` measures a deployment instead of the local server (the server's gzip/brotli
 * behaviour differs from Vercel's).
 *
 * Run: `npm run build && npm run e2e:load-perf -- [--throttle=1,4,6] [--worlds=highland-trail,casa-patio,kart-canyon]
 * [--url=…] [--size=1280x720] [--tier=auto|low|medium|high]`
 */
import { chromium, type CDPSession, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const THROTTLES = (arg('throttle') ?? '1,4').split(',').map(Number);
const WORLDS = (arg('worlds') ?? 'highland-trail,casa-patio,kart-canyon').split(',').filter(Boolean);
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];
const URL_ARG = arg('url');
const TIER = arg('tier') ?? 'auto';
const TIMEOUT = 300_000;
const PROFILE = ARGS.includes('--profile');
/** `--hw=4,4`: report that many cores and GB of memory (a weak laptop) to the page. */
const HW = arg('hw')?.split(',').map(Number);

/** Top self-time functions of the CPU profile (flat), then by script file. */
async function dumpProfile(cdp: CDPSession, label: string): Promise<void> {
  const { profile } = (await cdp.send('Profiler.stop')) as { profile: { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }>; samples: number[]; timeDeltas: number[] } };
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byFn = new Map<string, number>();
  const byFile = new Map<string, number>();
  for (const n of profile.nodes) {
    const t = (self.get(n.id) ?? 0) / 1000;
    const f = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^https?:\/\/[^/]+/, '')}:${n.callFrame.lineNumber}`;
    byFn.set(f, (byFn.get(f) ?? 0) + t);
    const u = n.callFrame.url.replace(/^https?:\/\/[^/]+/, '') || n.callFrame.functionName;
    byFile.set(u, (byFile.get(u) ?? 0) + t);
  }
  const top = (m: Map<string, number>, k: number): string => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, t]) => `${t.toFixed(0)}ms ${n.slice(0, 110)}`).join('\n      ');
  log(`  profile ${label} by function:\n      ${top(byFn, 14)}\n    by file:\n      ${top(byFile, 8)}`);
}
const t0 = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`;
const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`;

interface Net {
  count: number;
  bytes: number;
  js: number;
  big: Array<{ url: string; bytes: number }>;
  all: Array<{ url: string; bytes: number }>;
}

/** Network accounting through CDP (encoded = on-the-wire bytes). */
async function netWatch(cdp: CDPSession): Promise<{ reset(): void; read(): Net }> {
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  const urls = new Map<string, { url: string; type: string }>();
  let net: Net = { count: 0, bytes: 0, js: 0, big: [], all: [] };
  cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, { url: e.response.url, type: e.type }));
  cdp.on('Network.loadingFinished', (e) => {
    const u = urls.get(e.requestId);
    if (!u) return;
    net.count++;
    net.bytes += e.encodedDataLength;
    if (u.type === 'Script') net.js += e.encodedDataLength;
    net.big.push({ url: u.url.replace(/^https?:\/\/[^/]+/, ''), bytes: e.encodedDataLength });
  });
  return {
    reset: () => void (net = { count: 0, bytes: 0, js: 0, big: [], all: [] }),
    read: () => ({ ...net, all: net.big, big: [...net.big].sort((a, b) => b.bytes - a.bytes).slice(0, 6) }),
  };
}

const PERF_INIT = `
  window.__keyLog = [];
  { const iv = setInterval(() => { try { const nm = window.__aether?.simulation?.renderer?.renderer?._nodes; if (!nm || nm.__wrapped) return; nm.__wrapped = true; clearInterval(iv);
    const orig = nm.getCacheKey.bind(nm); let last = '';
    nm.getCacheKey = function (scene, lightsNode) { const k = orig(scene, lightsNode); try { const r = this.renderer; const env = this.getEnvironmentNode(scene); const fog = this.getFogNode(scene);
      const comp = [lightsNode.getCacheKey(true), r.shadowMap.enabled ? 1 : 0, r.shadowMap.type, env ? env.getCacheKey() : 'noenv', fog ? fog.getCacheKey() : 'nofog'].join('/'); if (comp !== last) { window.__keyLog.push(Math.round(performance.now()) + ' ' + comp + ' lights=' + (lightsNode.getLights ? lightsNode.getLights().map((l) => l.type + (l.visible ? '' : '(h)') + (l.castShadow ? 'S' : '')).join(',') : '?')); last = comp; } } catch (e) { window.__keyLog.push('err ' + e); } return k; };
  } catch {} }, 5); }

  window.__tl = []; window.__src = new WeakMap(); window.__keys = new Set(); window.__big = [];
  window.__gl = { links: 0, linkMs: 0, statusMs: 0, statusCalls: 0, srcKB: 0, vlen: 0 };
  for (const C of [WebGL2RenderingContext]) {
    const P = C.prototype, link = P.linkProgram, gp = P.getProgramParameter, ss = P.shaderSource;
    P.linkProgram = function (p) { try { const k = this.getAttachedShaders(p).map((x) => window.__src.get(x) || '').join('|'); window.__keys.add(k); { const nk = k.replace(/\d+/g, '#'); let h = 0; for (let i = 0; i < nk.length; i += 7) h = (h * 31 + nk.charCodeAt(i)) | 0; (window.__links = window.__links || []).push([Math.round(performance.now()), h, k.length]); } window.__big.push(k.length); } catch {} const t = performance.now(); const r = link.call(this, p); window.__gl.links++; window.__gl.linkMs += performance.now() - t; return r; };
    P.getProgramParameter = function (p, k) { const t = performance.now(); const r = gp.call(this, p, k); const d = performance.now() - t; if (k === this.LINK_STATUS) { window.__tl.push([Math.round(t), Math.round(d)]); window.__gl.statusMs += d; window.__gl.statusCalls++; } return r; };
    P.shaderSource = function (s, src) { window.__src.set(s, src); window.__gl.srcKB += src.length / 1024; return ss.call(this, s, src); };
  }

  window.__lt = { blocking: 0, last: 0, n: 0, fcp: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lt.blocking += Math.max(0, e.duration - 50); window.__lt.last = e.startTime + e.duration; window.__lt.n++; } }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__lt.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch {}
`;

async function waitWorld(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      const w = a.history.current;
      return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
    },
    null,
    { timeout: TIMEOUT, polling: 100 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
}

async function runThrottle(rate: number, base: string): Promise<void> {
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  try {
    // Cold: home page.
    for (const mode of ['home', ...WORLDS]) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      if (HW) await context.addInitScript(([c, m]) => { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => c }); Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => m }); }, [HW[0] ?? 4, HW[1] ?? 4] as const);
      // WebGL2 on the integrated GPU: without this the studio would pick a software WebGPU adapter.
      if (process.env['GEN_GPU'] === 'intel') await context.addInitScript(() => void delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu']);
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' + PERF_INIT });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.clearBrowserCache');
      if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      const net = await netWatch(cdp);
      try {
        const start = performance.now();
        if (mode === 'home') {
          await page.goto(`${base}/?debug=1`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('button', { timeout: TIMEOUT });
          await page.waitForLoadState('load');
          const interactive = performance.now() - start;
          await page.waitForTimeout(1500);
          const lt = await page.evaluate(() => (window as unknown as { __lt: { blocking: number; last: number; n: number; fcp: number } }).__lt);
          const n = net.read();
          if (process.env['DUMP_NET']) (await import('node:fs')).writeFileSync(`${process.env['DUMP_NET']}.home`, n.all.map((b) => `${b.bytes}\t${b.url}`).join('\n'));
          log(`| ${rate}x | home | first button ${interactive.toFixed(0)} ms | FCP ${lt.fcp.toFixed(0)} ms | blocking ${lt.blocking.toFixed(0)} ms (${lt.n} long tasks, last ends ${lt.last.toFixed(0)}) | ${n.count} req | ${mb(n.bytes)} (js ${mb(n.js)}) | top: ${n.big.slice(0, 3).map((b) => `${b.url.slice(0, 40)} ${kb(b.bytes)}`).join('; ')} |`);
        } else {
          if (PROFILE) {
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
            await cdp.send('Profiler.start');
          }
          await page.goto(`${base}/?debug=1#/new/${mode}`, { waitUntil: 'domcontentloaded' });
          const marks: string[] = [];
          page.on('console', (m) => {
            const t = m.text();
            if (/timeline|warmup|ready|bake|volume|compile|physics|decode|ktx2/i.test(t) && marks.length < 14) marks.push(`${((performance.now() - start) / 1000).toFixed(1)}s ${t.slice(0, 400)}`);
          });
          await waitWorld(page);
          const synced = performance.now() - start;
          if (PROFILE) await dumpProfile(cdp, mode);
          await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 30_000, polling: 250 }).catch(() => undefined);
          const settled = performance.now() - start;
          const lt = await page.evaluate(() => (window as unknown as { __lt: { blocking: number; last: number; n: number; fcp: number } }).__lt);
          if (process.env['DUMP_SHADERS']) {
            const keys = await page.evaluate(() => [...(window as unknown as { __keys: Set<string> }).__keys]);
            (await import('node:fs')).writeFileSync(process.env['DUMP_SHADERS'], JSON.stringify(keys));
          }
          if (process.env['DUMP_MATS']) {
            const rows = await page.evaluate(() => {
              const r = window.__aether?.simulation?.renderer as unknown as { scene: { traverse(f: (o: any) => void): void } };
              const m = new Map<string, number>();
              r.scene.traverse((o) => {
                if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const mat of mats) {
                  const k = [o.isInstancedMesh ? 'inst' : o.isSkinnedMesh ? 'skin' : o.isBatchedMesh ? 'batch' : 'mesh', mat.type, mat.name || '-', mat.side, mat.transparent ? 'T' : 'O', mat.vertexColors ? 'vc' : '', mat.map ? 'map' : '', mat.normalMap ? 'nrm' : '', mat.alphaTest ? 'at' : '', mat.aoMap ? 'ao' : '', mat.emissiveMap ? 'em' : '', o.castShadow ? 'cs' : '', o.receiveShadow ? 'rs' : '', mat.userData && Object.keys(mat.userData).join(','), o.userData && o.userData.aetherLayer].join(' ');
                  m.set(k, (m.get(k) ?? 0) + 1);
                }
              });
              return [...m].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c}x ${k}`);
            });
            (await import('node:fs')).writeFileSync(process.env['DUMP_MATS'], rows.join('\n'));
          }
          if (process.env['DUMP_LINKS']) {
            const rows = await page.evaluate(() => (window as unknown as { __links: number[][] }).__links);
            (await import('node:fs')).writeFileSync(process.env['DUMP_LINKS'], JSON.stringify(rows));
          }
          if (process.env['DUMP_KEYS']) (await import('node:fs')).writeFileSync(process.env['DUMP_KEYS'], (await page.evaluate(() => (window as unknown as { __keyLog: string[] }).__keyLog)).join('\n'));
          const n = net.read();
          // Frame time of a slow orbit: adaptive resolution and automatic tier untouched unless --tier.
          const fr = await page.evaluate(async (tier) => {
            const r = window.__aether?.simulation?.renderer as unknown as {
              setRenderTier(t: string): void;
              requestRender(): void;
              setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
              renderTier: string;
              gpu: { description: string; tier: string };
              stats(): { drawCalls: number; triangles: number };
              shaderWarmupMs: number;
              domElement: HTMLCanvasElement;
            };
            const ext = (() => { try { const c = document.createElement('canvas').getContext('webgl2'); return c?.getSupportedExtensions()?.includes('KHR_parallel_shader_compile') ?? false; } catch { return false; } })();
            console.log(`timeline ${JSON.stringify({ warm: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('aether:warm')).map((m) => Math.round(m.startTime)), status: (window as unknown as { __tl: number[][] }).__tl.filter((x) => (x[1] as number) > 20).map((x) => x.join(':')).slice(0, 400).join(' ') })}`);
            console.log(`gl ${JSON.stringify((window as unknown as { __gl: object }).__gl)} unique ${(window as unknown as { __keys: Set<string> }).__keys.size} sizes(KB) max ${Math.round(Math.max(...(window as unknown as { __big: number[] }).__big) / 1024)} avg ${Math.round((window as unknown as { __big: number[] }).__big.reduce((a, b) => a + b, 0) / (window as unknown as { __big: number[] }).__big.length / 1024)}; warmup ${Math.round(r.shaderWarmupMs)} ms, parallel-compile ext on a fresh context: ${ext}`);
            if (tier !== 'auto') r.setRenderTier(tier);
            const times: number[] = [];
            let yaw = 0;
            await new Promise<void>((done) => {
              let i = 0;
              let last = performance.now();
              const step = (now: number): void => {
                times.push(now - last);
                last = now;
                yaw += 0.003;
                r.setCameraPose(0, 2.5, 12, yaw, -0.1);
                r.requestRender();
                if (++i < 60) requestAnimationFrame(step);
                else done();
              };
              requestAnimationFrame(step);
            });
            const s = times.slice(15).sort((a, b) => a - b);
            const s2 = r.stats();
            return { med: s[Math.floor(s.length * 0.5)] ?? 0, p90: s[Math.floor(s.length * 0.9)] ?? 0, tier: r.renderTier, gpu: `${r.gpu.tier}: ${r.gpu.description.slice(0, 40)}`, dc: s2.drawCalls, tris: s2.triangles };
          }, TIER);
          if (process.env['SHOT_DIR']) await page.screenshot({ path: `${process.env['SHOT_DIR']}/${mode}-${rate}x.png` });
          log(`| ${rate}x | ${mode} | open ${synced.toFixed(0)} ms | settled ${settled.toFixed(0)} ms | blocking ${lt.blocking.toFixed(0)} ms (${lt.n}) | ${n.count} req | ${mb(n.bytes)} (js ${mb(n.js)}) | tier ${fr.tier} (${fr.gpu}) | frame med ${fr.med.toFixed(1)} / p90 ${fr.p90.toFixed(1)} ms | ${fr.dc} dc, ${fr.tris} tris |`);
          if (process.env['DUMP_NET']) (await import('node:fs')).writeFileSync(process.env['DUMP_NET'], n.all.map((b) => `${b.bytes}\t${b.url}`).join('\n'));
          const cat = new Map<string, [number, number]>();
          for (const b of n.all) {
            const k = /\.glb/.test(b.url) ? 'glb' : /\.hdr/.test(b.url) ? 'hdr' : /\.ktx2/.test(b.url) ? 'ktx2' : /\.wasm/.test(b.url) ? 'wasm' : /\.js/.test(b.url) ? 'js' : /\.(webp|png|jpe?g)/.test(b.url) ? 'img' : /\.json/.test(b.url) ? 'json' : 'other';
            const c = cat.get(k) ?? [0, 0];
            cat.set(k, [c[0] + 1, c[1] + b.bytes]);
          }
          log(`    by type: ${[...cat].map(([k, [c, by]]) => `${k} ${c}x ${mb(by)}`).join(', ')}`);
          log(`    largest: ${n.big.map((b) => `${b.url.slice(0, 48)} ${kb(b.bytes)}`).join('; ')}`);
          if (marks.length) log(`    marks: ${marks.join(' | ')}`);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const server = URL_ARG ? { url: URL_ARG.replace(/\/+$/, ''), stop: async () => undefined } : await startServer(log);
  try {
    log(`target ${server.url}, GPU args ${CHROME_ARGS.join(' ')}, viewport ${W}x${H}, tier ${TIER}`);
    for (const r of THROTTLES) await runThrottle(r, server.url);
    log('LOAD PERF DONE');
  } finally {
    await server.stop();
  }
}

main().catch((e: unknown) => {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

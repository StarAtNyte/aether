/**
 * CPU-side cost of the render stack on a decent CPU: per-frame JS time, allocations per frame, scene size
 * (objects, meshes, materials, programs, draw calls), matrix-update load and time to first frame, per world.
 *
 * Each world is opened cold, then measured twice: idle (nothing moves; on-demand rendering should draw nothing) and a
 * slow camera orbit (every frame dirty). The orbit runs under the CDP sampling profiler (top self-time functions) and
 * the sampling heap profiler (bytes allocated per frame, top allocation sites).
 *
 * Chromium only. `AETHER_E2E_GPU=1` for the machine GPU, default software (CPU numbers are comparable either way:
 * they time JS on the main thread, not the GPU). Prints Markdown rows.
 *
 * Run: `npm run build && npx tsx tests/e2e/cpu-perf.e2e.ts [--worlds=a,b] [--frames=120] [--profile] [--size=1280x720]`
 */
import { chromium, type CDPSession, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'photo-hotel-bedroom,photo-twin-room,photo-vaulted-bedroom,skyline-penthouse,casa-patio,highland-trail').split(',').filter(Boolean);
const FRAMES = Number(arg('frames') ?? 120);
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];
const PROFILE = ARGS.includes('--profile');
/** The sampling heap profiler slows the page down a lot: opt in. */
const WARM_TURN = Number(arg("warm") ?? 90);
const HEAP = ARGS.includes('--heap');
const TIMEOUT = 240_000;
const t0 = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);

interface Prof {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>;
  samples: number[];
  timeDeltas: number[];
}

async function topFunctions(cdp: CDPSession, frames: number): Promise<string> {
  const { profile } = (await cdp.send('Profiler.stop')) as { profile: Prof };
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byFn = new Map<string, number>();
  for (const n of profile.nodes) {
    const f = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^https?:\/\/[^/]+/, '').split('/').pop()}:${n.callFrame.lineNumber}`;
    byFn.set(f, (byFn.get(f) ?? 0) + (self.get(n.id) ?? 0) / 1000);
  }
  return [...byFn]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([n, t]) => `      ${(t / frames).toFixed(3)}ms/frame ${n.slice(0, 100)}`)
    .join('\n');
}

interface HeapNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: HeapNode[];
}

async function heapReport(cdp: CDPSession, frames: number): Promise<{ bytes: number; text: string }> {
  const { profile } = (await cdp.send('HeapProfiler.stopSampling')) as { profile: { head: HeapNode } };
  const by = new Map<string, number>();
  let total = 0;
  const walk = (n: HeapNode): void => {
    if (n.selfSize > 0) {
      const f = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^https?:\/\/[^/]+/, '').split('/').pop()}:${n.callFrame.lineNumber}`;
      by.set(f, (by.get(f) ?? 0) + n.selfSize);
      total += n.selfSize;
    }
    n.children.forEach(walk);
  };
  walk(profile.head);
  const text = [...by]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([n, b]) => `      ${(b / frames / 1024).toFixed(1)}KB/frame ${n.slice(0, 100)}`)
    .join('\n');
  return { bytes: total / frames, text };
}

async function sceneStats(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const r = window.__aether?.simulation?.renderer as unknown as { scene: import('three').Scene; renderer: { info: { render: Record<string, number>; memory: Record<string, number>; programs?: unknown[] } } };
    const scene = r.scene;
    let objects = 0;
    let meshes = 0;
    let visibleMeshes = 0;
    let skinned = 0;
    let instanced = 0;
    let autoUpdate = 0;
    let nonCulled = 0;
    let lights = 0;
    let matrixAutoStatic = 0;
    const mats = new Set<unknown>();
    const geos = new Set<unknown>();
    scene.traverse((o) => {
      objects++;
      const m = o as import('three').Mesh;
      if (o.matrixAutoUpdate) autoUpdate++;
      if ((o as { isLight?: boolean }).isLight) lights++;
      if (m.isMesh || (o as { isLine?: boolean }).isLine || (o as { isPoints?: boolean }).isPoints) {
        meshes++;
        let vis = true;
        for (let p: import('three').Object3D | null = o; p; p = p.parent) if (!p.visible) vis = false;
        if (vis) visibleMeshes++;
        if (!m.frustumCulled) nonCulled++;
        if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned++;
        if ((o as { isInstancedMesh?: boolean }).isInstancedMesh) instanced++;
        if (m.matrixAutoUpdate && !(o as { isSkinnedMesh?: boolean }).isSkinnedMesh) matrixAutoStatic++;
        geos.add(m.geometry);
        if (Array.isArray(m.material)) m.material.forEach((x) => mats.add(x));
        else mats.add(m.material);
      }
    });
    const info = r.renderer.info;
    return {
      objects,
      meshes,
      visibleMeshes,
      skinned,
      instanced,
      matrixAuto: autoUpdate,
      nonCulled,
      lights,
      materials: mats.size,
      geometries: geos.size,
      calls: info.render['drawCalls'] ?? info.render['calls'] ?? 0,
      tris: info.render['triangles'] ?? 0,
      glGeo: info.memory['geometries'] ?? 0,
      glTex: info.memory['textures'] ?? 0,
      matrixAutoMesh: matrixAutoStatic,
    };
  });
}

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: m } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  try {
    for (const slug of WORLDS) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (ARGS.includes('--webgl')) await context.addInitScript(() => void delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu']);
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Performance.enable');
        if (ARGS.includes('--profile-load')) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
          await cdp.send('Profiler.start');
        }
        const tStart = performance.now();
        await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
        const tDom = performance.now() - tStart;
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
        const tOpen = performance.now() - tStart;
        log(`${slug}: open`);
        await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
        const tSynced = performance.now() - tStart;
        if (ARGS.includes('--profile-load')) log(`load profile (total ${tSynced.toFixed(0)}ms):\n${await topFunctions(cdp, 1)}`);
        await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: TIMEOUT, polling: 250 }).catch(() => undefined);
        const mLoad = await metrics(cdp);
        const cam = COVER_CAMERAS[slug];
        let pose = [0, 2, 10, 0, 0];
        if (cam?.arch) await page.evaluate((v) => window.__aether?.store.getState().setArch(v), cam.arch);
        if (cam) {
          const dx = cam.target[0] - cam.pos[0];
          const dy = cam.target[1] - cam.pos[1];
          const dz = cam.target[2] - cam.pos[2];
          pose = [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
          await page.evaluate((p) => window.__aether?.simulation?.renderer.setCameraPose(p[0] as number, p[1] as number, p[2] as number, p[3] as number, p[4] as number), pose);
        }
        await page.waitForTimeout(2500);
        // Idle: no input; count draws and script time over 3 s.
        const shotDir = arg('shot');
        if (shotDir) {
          const { mkdirSync } = await import('node:fs');
          mkdirSync(shotDir, { recursive: true });
          await page.evaluate(() => {
            const st = window.__aether?.store.getState();
            st?.setPanel('left', false);
            st?.setPanel('right', false);
          });
          await page.waitForTimeout(3000);
          await page.screenshot({ path: `${shotDir}/${slug}.png` });
        }
        const m0 = await metrics(cdp);
        const idle = await page.evaluate(async () => {
          const r = window.__aether?.simulation?.renderer as unknown as { framesDrawn: number };
          const f0 = r.framesDrawn;
          let rafs = 0;
          const end = performance.now() + 3000;
          await new Promise<void>((d) => {
            const s = (): void => {
              rafs++;
              if (performance.now() < end) requestAnimationFrame(s);
              else d();
            };
            requestAnimationFrame(s);
          });
          return { drawn: r.framesDrawn - f0, rafs };
        });
        const m1 = await metrics(cdp);
        const idleScriptMs = ((m1['ScriptDuration'] ?? 0) - (m0['ScriptDuration'] ?? 0)) * 1000;
        const idleTaskMs = ((m1['TaskDuration'] ?? 0) - (m0['TaskDuration'] ?? 0)) * 1000;
        const sceneS = await sceneStats(page);
        // Orbit under profilers.
        // Fixed tier, no adaptive resolution: a mid-run tier change would put its rebuild into the numbers.
        const tier = await page.evaluate((t) => {
          const r = window.__aether?.simulation?.renderer as unknown as { qualityPlan: { tier: string }; setRenderTier(t: string): void; setAdaptiveResolution(on: boolean): void };
          const tier = t ?? r.qualityPlan.tier;
          r.setAdaptiveResolution(false);
          // The performance governor is switched off (it would step the tier down mid-run), the tier itself is not re-applied.
          (r as unknown as { governor: { enabled: boolean } }).governor.enabled = false;
          return tier;
        }, arg('tier') ?? null);
        await page.waitForTimeout(1500);
        // One quick turn first so every visible program is compiled and every render object exists (steady state).
        await page.evaluate(async ([p, turn]) => {
          const r = window.__aether?.simulation?.renderer as unknown as { setCameraPose(...a: number[]): void; requestRender(): void };
          const pose = p as number[];
          await new Promise<void>((done) => {
            let n = 0;
            const step = (): void => {
              r.setCameraPose(pose[0] as number, pose[1] as number, pose[2] as number, (pose[3] as number) + n * 0.07, pose[4] as number);
              r.requestRender();
              if (++n < (turn as number)) requestAnimationFrame(step);
              else done();
            };
            requestAnimationFrame(step);
          });
        }, [pose, WARM_TURN] as const);
        await page.waitForTimeout(1500);
        log(`tier ${tier}, warmed`);
        await cdp.send('Profiler.enable');
        await cdp.send('HeapProfiler.enable');
        await page.evaluate(() => (window as unknown as { gc?: () => void }).gc?.());
        if (PROFILE) await cdp.send('Profiler.start');
        if (HEAP) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        const o0 = await metrics(cdp);
        const orbit = await page.evaluate(
          async ([frames, p]) => {
            const r = window.__aether?.simulation?.renderer as unknown as { setCameraPose(...a: number[]): void; requestRender(): void; render: (...a: unknown[]) => boolean };
            const pose = p as number[];
            let yaw = pose[3] as number;
            const render = r.render.bind(r);
            const cpu: number[] = [];
            r.render = (...a: unknown[]): boolean => {
              const s = performance.now();
              const out = render(...a);
              if (out) cpu.push(performance.now() - s);
              return out;
            };
            const times: number[] = [];
            await new Promise<void>((done) => {
              let n = 0;
              let last = performance.now();
              const step = (now: number): void => {
                times.push(now - last);
                last = now;
                yaw += 0.002;
                r.setCameraPose(pose[0] as number, pose[1] as number, pose[2] as number, yaw, pose[4] as number);
                r.requestRender();
                if (++n < (frames as number) + 20) requestAnimationFrame(step);
                else done();
              };
              requestAnimationFrame(step);
            });
            r.render = render;
            const c = cpu.slice(20).sort((x, y) => x - y);
            const at = (a: number[], f: number): number => a[Math.min(a.length - 1, Math.floor(a.length * f))] ?? 0;
            const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
            return { cpuMed: at(c, 0.5), cpuP90: at(c, 0.9), cpuN: c.length, intervalMed: at(times.slice(20).sort((x, y) => x - y), 0.5), heap: mem };
          },
          [FRAMES, pose] as const,
        );
        const o1 = await metrics(cdp);
        const heap = HEAP ? await heapReport(cdp, FRAMES + 20) : { bytes: 0, text: '' };
        const scriptPerFrame = (((o1['ScriptDuration'] ?? 0) - (o0['ScriptDuration'] ?? 0)) * 1000) / (FRAMES + 20);
        const taskPerFrame = (((o1['TaskDuration'] ?? 0) - (o0['TaskDuration'] ?? 0)) * 1000) / (FRAMES + 20);
        const sceneAfter = await sceneStats(page);
        log(`## ${slug}`);
        log(`| load | dom ${tDom.toFixed(0)}ms, open ${tOpen.toFixed(0)}ms, synced ${tSynced.toFixed(0)}ms; script ${((mLoad['ScriptDuration'] ?? 0) * 1000).toFixed(0)}ms task ${((mLoad['TaskDuration'] ?? 0) * 1000).toFixed(0)}ms; heap ${(((mLoad['JSHeapUsedSize'] ?? 0)) / 1048576).toFixed(0)}MB |`);
        log(`| idle 3s | drawn ${idle.drawn}/${idle.rafs} rafs, script ${idleScriptMs.toFixed(1)}ms, task ${idleTaskMs.toFixed(1)}ms |`);
        log(`| orbit | render() JS median ${orbit.cpuMed.toFixed(2)}ms p90 ${orbit.cpuP90.toFixed(2)}ms (n=${orbit.cpuN}); script/frame ${scriptPerFrame.toFixed(2)}ms task/frame ${taskPerFrame.toFixed(2)}ms; raf interval ${orbit.intervalMed.toFixed(1)}ms; alloc ${(heap.bytes / 1024).toFixed(0)}KB/frame |`);
        log(`| scene | ${JSON.stringify(sceneS)} |`);
        log(`| scene after orbit | calls ${sceneAfter['calls']} tris ${sceneAfter['tris']} |`);
        log(`   allocations:\n${heap.text}`);
        if (PROFILE) log(`   cpu:\n${await topFunctions(cdp, FRAMES + 20)}`);
      } finally {
        await context.close();
      }
    }
    log('CPU PERF DONE');
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  log(`FAILED: ${e instanceof Error ? e.stack : String(e)}`);
  process.exitCode = 1;
});

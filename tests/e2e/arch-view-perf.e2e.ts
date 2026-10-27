/**
 * Cost of the architectural view modes on a building: a full turn of the camera in cutaway (walls flip between full
 * height and cut as the eye passes them), then exploded / solo toggles. Per phase: JS time of `render()` (median, p90,
 * mean), frames over 33 ms, wall rebuilds and geometry creations the scene sync made, GL geometries alive, JS heap.
 *
 * Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/arch-view-perf.e2e.ts [--worlds=a,b] [--frames=240] [--turns=2] [--size=1280x720]`
 * GL geometry / texture / mesh counts that keep rising from turn to turn are a disposal leak.
 */
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'skyline-penthouse,casa-patio,dusk-lake-house').split(',').filter(Boolean);
const FRAMES = Number(arg('frames') ?? 240);
const TURNS = Number(arg('turns') ?? 2);
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];
const TIMEOUT = 240_000;
const t0 = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);

interface Phase {
  name: string;
  cpuMed: number;
  cpuP90: number;
  cpuMean: number;
  slow: number;
  frames: number;
  rebuilds: number;
  created: number;
  glGeometries: number;
  glTextures: number;
  meshes: number;
  heapMB: number;
}

async function runPhase(page: Page, name: string, pose: number[], mode: 'orbit' | 'toggle', frames: number): Promise<Phase> {
  return page.evaluate(
    async ([nm, p, md, n]) => {
      const sim = window.__aether?.simulation;
      const r = sim?.renderer as unknown as {
        setCameraPose(...a: number[]): void;
        requestRender(): void;
        render: (...a: unknown[]) => boolean;
        sync: { rebuild: (...a: unknown[]) => Promise<void>; opts: { geometries: { acquire: (...a: unknown[]) => unknown; refs: (k: string) => number } } };
        renderer: { info: { memory: Record<string, number> } };
      };
      const pose = p as number[];
      let rebuilds = 0;
      let created = 0;
      const rb = r.sync.rebuild.bind(r.sync);
      r.sync.rebuild = (...a: unknown[]): Promise<void> => {
        rebuilds++;
        return rb(...a);
      };
      const geos = r.sync.opts.geometries;
      const acq = geos.acquire.bind(geos);
      geos.acquire = (...a: unknown[]): unknown => {
        const key = `${a[0] as string}#${a[1] as number}`;
        if (geos.refs(key) === 0) created++;
        return acq(...a);
      };
      const render = r.render.bind(r);
      const cpu: number[] = [];
      r.render = (...a: unknown[]): boolean => {
        const s = performance.now();
        const out = render(...a);
        if (out) cpu.push(performance.now() - s);
        return out;
      };
      const store = window.__aether!.store;
      const gc = (window as unknown as { gc?: () => void }).gc;
      gc?.();
      const heap0 = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
      const cx = (pose[0] as number) - 0;
      const cz = (pose[2] as number) - 0;
      const tx = pose[5] as number;
      const tz = pose[6] as number;
      const rad = Math.hypot(cx - tx, cz - tz);
      const a0 = Math.atan2(cz - tz, cx - tx);
      await new Promise<void>((done) => {
        let i = 0;
        const step = (): void => {
          if (md === 'orbit') {
            const a = a0 + (i / (n as number)) * Math.PI * 2;
            const x = tx + Math.cos(a) * rad;
            const z = tz + Math.sin(a) * rad;
            const dx = tx - x;
            const dz = tz - z;
            r.setCameraPose(x, pose[1] as number, z, Math.atan2(-dx, -dz), pose[4] as number);
          } else if (i % 20 === 0) {
            const k = (i / 20) % 4;
            const st = store.getState();
            st.setArch(k === 0 ? { levelMode: 'exploded' } : k === 1 ? { levelMode: 'stacked' } : k === 2 ? { levelMode: 'solo', level: 0 } : { levelMode: 'stacked' });
          }
          r.requestRender();
          if (++i < (n as number)) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      await new Promise((d) => setTimeout(d, 600));
      r.render = render;
      r.sync.rebuild = rb;
      geos.acquire = acq;
      const c = cpu.slice(5).sort((x, y) => x - y);
      const at = (f: number): number => c[Math.min(c.length - 1, Math.floor(c.length * f))] ?? 0;
      gc?.();
      const heap1 = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
      return {
        name: nm as string,
        cpuMed: at(0.5),
        cpuP90: at(0.9),
        cpuMean: c.reduce((s, v) => s + v, 0) / Math.max(1, c.length),
        slow: c.filter((v) => v > 33).length,
        frames: c.length,
        rebuilds,
        created,
        glGeometries: r.renderer.info.memory['geometries'] ?? 0,
        glTextures: r.renderer.info.memory['textures'] ?? 0,
        meshes: (() => {
          let n = 0;
          (r as unknown as { scene: import('three').Object3D }).scene.traverse((o) => void ((o as import('three').Mesh).isMesh && n++));
          return n;
        })(),
        heapMB: (heap1 - heap0) / 1048576,
      };
    },
    [name, pose, mode, frames] as const,
  );
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  try {
    for (const slug of WORLDS) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      try {
        const page = await context.newPage();
        await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
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
        await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
        await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: TIMEOUT, polling: 250 }).catch(() => undefined);
        const cam = COVER_CAMERAS[slug];
        if (!cam) throw new Error(`no cover camera for ${slug}`);
        const dx = cam.target[0] - cam.pos[0];
        const dy = cam.target[1] - cam.pos[1];
        const dz = cam.target[2] - cam.pos[2];
        const pose = [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), cam.target[0], cam.target[2]];
        await page.evaluate(
          ([p]) => {
            const r = window.__aether?.simulation?.renderer as unknown as { setAdaptiveResolution(on: boolean): void; setCameraPose(...a: number[]): void; governor: { enabled: boolean } };
            r.setAdaptiveResolution(false);
            r.governor.enabled = false;
            r.setCameraPose(...(p as number[]).slice(0, 5));
          },
          [pose],
        );
        await page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'cutaway', levelMode: 'stacked' }));
        await page.waitForTimeout(3000);
        // Warm: one quick turn so programs and render objects exist.
        await runPhase(page, 'warm', pose, 'orbit', 90);
        await page.waitForTimeout(1500);
        const rows: Phase[] = [];
        for (let t = 1; t <= TURNS; t++) rows.push(await runPhase(page, `cutaway turn ${t}`, pose, 'orbit', FRAMES));
        rows.push(await runPhase(page, 'levels toggle', pose, 'toggle', 160));
        log(`## ${slug}`);
        for (const x of rows) {
          log(`| ${x.name} | render() JS med ${x.cpuMed.toFixed(2)} p90 ${x.cpuP90.toFixed(2)} mean ${x.cpuMean.toFixed(2)} ms; >33ms ${x.slow}/${x.frames}; rebuilds ${x.rebuilds}; geometries created ${x.created}; GL geometries ${x.glGeometries}; GL textures ${x.glTextures}; meshes ${x.meshes}; heap ${x.heapMB.toFixed(1)} MB |`);
        }
      } finally {
        await context.close();
      }
    }
    log('ARCH VIEW PERF DONE');
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});

/**
 * Where the triangles of a showcase world go: every drawn mesh grouped by name and kind, with triangles in the
 * default view's frustum, triangles that also cast into the sun map, and draw calls.
 * Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/geom-probe.e2e.ts [--worlds=casa-patio,skyline-penthouse] [--top=30]`
 */
import { chromium } from 'playwright';
import { COVER_CAMERAS } from './support/showcase-cameras';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'casa-patio,skyline-penthouse').split(',');
const DEFAULT = arg('default') !== undefined;
const COVER = arg('cover') !== undefined;
const GPU = arg('gpu') !== undefined;
const HIDES = (arg('hide') ?? '').split(',').filter(Boolean);
const TOP = Number(arg('top') ?? 30);
const log = (l: string): void => void process.stdout.write(`${l}\n`);

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    for (const slug of WORLDS) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await ctx.addInitScript({ content: SKIP_FIRST_RUN });
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['GEN_GPU'] === 'intel' && process.env['AETHER_WEBGPU'] !== '1') {
        await ctx.addInitScript(() => {
          delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu'];
        });
      }
      const page = await ctx.newPage();
      await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const a = window.__aether;
        if (!a || a.simulation === null) return false;
        const st = a.store.getState();
        return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
      }, null, { timeout: 150_000, polling: 250 });
      if (COVER) {
        const cam = COVER_CAMERAS[slug];
        if (cam) {
          if (cam.arch) await page.evaluate((view) => window.__aether?.store.getState().setArch(view), cam.arch);
          const dx = cam.target[0] - cam.pos[0], dy = cam.target[1] - cam.pos[1], dz = cam.target[2] - cam.pos[2];
          await page.evaluate((p) => (window.__aether?.simulation?.renderer as any).setCameraPose(...p), [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]);
        }
      }
      await page.waitForTimeout(8000);
      const rows = await page.evaluate(() => {
        const r = window.__aether?.simulation?.renderer as unknown as { scene: any; camera: any };
        const THREE_FRUSTUM = (r.camera.constructor as any);
        void THREE_FRUSTUM;
        const cam = r.camera;
        cam.updateMatrixWorld(true);
        // frustum from projection * view
        const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
        const e = m.elements as number[];
        const planes: number[][] = [];
        const P = (a: number, b: number, c: number, d: number): void => { const l = Math.hypot(a, b, c); planes.push([a / l, b / l, c / l, d / l]); };
        P(e[3]! + e[0]!, e[7]! + e[4]!, e[11]! + e[8]!, e[15]! + e[12]!);
        P(e[3]! - e[0]!, e[7]! - e[4]!, e[11]! - e[8]!, e[15]! - e[12]!);
        P(e[3]! + e[1]!, e[7]! + e[5]!, e[11]! + e[9]!, e[15]! + e[13]!);
        P(e[3]! - e[1]!, e[7]! - e[5]!, e[11]! - e[9]!, e[15]! - e[13]!);
        P(e[3]! + e[2]!, e[7]! + e[6]!, e[11]! + e[10]!, e[15]! + e[14]!);
        P(e[3]! - e[2]!, e[7]! - e[6]!, e[11]! - e[10]!, e[15]! - e[14]!);
        const groups = new Map<string, { n: number; tris: number; inView: number; inViewDraws: number; shadowTris: number; inst: number }>();
        const visibleChain = (o: any): boolean => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
        const total = { tris: 0, inView: 0, shadow: 0, draws: 0, inViewDraws: 0 };
        r.scene.traverse((o: any) => {
          if (!(o.isMesh || o.isPoints || o.isLine) || !o.geometry || !visibleChain(o)) return;
          if (!(o.layers.mask & cam.layers.mask)) return;
          const g = o.geometry;
          const idx = g.index ? g.index.count : g.attributes.position.count;
          const inst = o.isInstancedMesh ? o.count : 1;
          const tris = (idx / 3) * inst;
          if (!g.boundingSphere) g.computeBoundingSphere();
          let inView = true;
          if (o.isInstancedMesh) inView = true;
          else if (o.frustumCulled !== false && g.boundingSphere) {
            const c = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
            const s = g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
            for (const p of planes) if (p[0]! * c.x + p[1]! * c.y + p[2]! * c.z + p[3]! < -s) { inView = false; break; }
          }
          let name = o.name || '';
          for (let p = o; p && !name; p = p.parent) name = p.name || '';
          name = (name.replace(/[0-9a-f]{6,}|\d+/g, '#') || o.type) + ' | ' + (o.material?.type ?? '?') + (o.isInstancedMesh ? ' inst' : '') + (o.isSkinnedMesh ? ' skin' : '');
          const gr = groups.get(name) ?? { n: 0, tris: 0, inView: 0, inViewDraws: 0, shadowTris: 0, inst: 0 };
          gr.n++; gr.tris += tris; if (inView) { gr.inView += tris; gr.inViewDraws++; }
          if (o.castShadow) gr.shadowTris += tris;
          groups.set(name, gr);
          total.tris += tris; total.draws++; if (inView) { total.inView += tris; total.inViewDraws++; } if (o.castShadow) total.shadow += tris;
        });
        const st = (r as any).stats();
        return { total, stats: st, rows: [...groups.entries()].sort((a, b) => b[1].inView - a[1].inView).map(([k, v]) => ({ k, ...v })) };
      });
      if (arg('shader') !== undefined) {
        const src = await page.evaluate(() => {
          const r = window.__aether?.simulation?.renderer as any;
          const out: string[] = [];
          const cache = r.renderer._nodes.nodeBuilderCache as Map<unknown, any>;
          for (const st of cache.values()) if (st.fragmentShader && /splat/i.test(st.vertexShader + st.fragmentShader)) out.push(st.fragmentShader);
          return out;
        });
        const { writeFileSync } = await import('node:fs');
        src.forEach((t, i) => writeFileSync(`${arg('shader')}-${i}.frag`, t));
        log(`${slug}: dumped ${src.length} splat shaders`);
      }
      if (GPU) {
        const lines = await page.evaluate(async ([hides, isDefault]) => {
          type Rn = { draw: (...a: unknown[]) => void; __o?: (...a: unknown[]) => void; __q: WebGLQuery[]; scene: any; adaptive: any; resize(w: number, h: number): void; cssWidth: number; cssHeight: number; setAdaptiveResolution(on: boolean): void; setRenderQuality(q: string): string; setRenderTier(t: string): void; requestRender(): void; setCameraPose(...a: number[]): void; cameraPose(): { pos: number[]; target: number[] }; env: any; renderer: any };
          const r = window.__aether?.simulation?.renderer as unknown as Rn;
          if (!isDefault) {
            r.setAdaptiveResolution(false);
            r.setRenderQuality('realtime');
            r.setRenderTier('low');
            r.adaptive.scale = 0.5;
            r.resize(r.cssWidth, r.cssHeight);
          }
          const gl = r.renderer.backend.gl as WebGL2RenderingContext;
          const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number };
          r.__q = [];
          r.__o = r.draw;
          r.draw = function (this: unknown, ...a: unknown[]): void {
            const q = gl.createQuery();
            gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
            try { r.__o!.apply(this, a); } finally { gl.endQuery(tq.TIME_ELAPSED_EXT); r.__q.push(q); }
          };
          const c = r.cameraPose();
          const dx = c.target[0]! - c.pos[0]!, dy = c.target[1]! - c.pos[1]!, dz = c.target[2]! - c.pos[2]!;
          let yaw = Math.atan2(-dx, -dz);
          const pitch = Math.atan2(dy, Math.hypot(dx, dz));
          const frames = async (n: number): Promise<void> => {
            for (let i = 0; i < n; i++) {
              await new Promise<void>((res) => requestAnimationFrame(() => res()));
              yaw += 0.002;
              r.setCameraPose(c.pos[0]!, c.pos[1]!, c.pos[2]!, yaw, pitch);
              r.requestRender();
            }
          };
          const gpu1 = async (): Promise<number> => {
            await frames(10);
            r.__q = [];
            await frames(24);
            const mine = r.__q;
            r.__q = [];
            for (let w = 0; w < 80 && !gl.getQueryParameter(mine[mine.length - 1]!, gl.QUERY_RESULT_AVAILABLE); w++) await new Promise((res) => setTimeout(res, 50));
            const v: number[] = [];
            for (const q of mine) { if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) v.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6); gl.deleteQuery(q); }
            v.sort((a, b) => a - b);
            return v[Math.floor(v.length / 2)] ?? -1;
          };
          const gpu = async (): Promise<number> => {
            let best = Infinity;
            for (let k = 0; k < 4; k++) best = Math.min(best, await gpu1());
            return best;
          };
          const out: string[] = [];
          if (isDefault) {
            await frames(200);
            (r as any).governor.record = () => false;
            (r as any).adaptive.record = () => false;
          }
          out.push(`all: ${(await gpu()).toFixed(1)} ms (tris ${(r as any).stats().triangles}, draws ${(r as any).stats().drawCalls}, scale ${(r as any).stats().resolutionScale}, level ${(r as any).stats().performanceLevel}, ${(r as any).renderQuality}/${(r as any).renderTier})`);
          const hidden: any[] = [];
          for (const h of hides) {
            if (h.startsWith('x:')) {
              const e = r.env;
              if (h === 'x:taps1') {
                e.softFilter?.set({ blockerSamples: 1, filterSamples: 1, sunAngle: 0.019, minPenumbra: 0.012 });
                const t = await gpu();
                e.softFilter?.set({ blockerSamples: 6, filterSamples: 12, sunAngle: 0.019, minPenumbra: 0.012 });
                out.push(`softFilter present=${!!e.softFilter} plan=${JSON.stringify(e.sunPlan)} soft filter 1+1 taps: ${t.toFixed(1)} ms  [base ${(await gpu()).toFixed(1)}]`);
              }
              if (h === 'x:norecv' || h === 'x:nocast') {
                const meshes: any[] = [];
                r.scene.traverse((o: any) => { if (o.isMesh) meshes.push(o); });
                const key = h === 'x:norecv' ? 'receiveShadow' : 'castShadow';
                const prev = meshes.map((m) => m[key]);
                meshes.forEach((m) => (m[key] = false));
                await frames(30);
                const t = await gpu();
                meshes.forEach((m, i) => (m[key] = prev[i]));
                out.push(`all meshes ${key}=false: ${t.toFixed(1)} ms  [base ${(await gpu()).toFixed(1)}]`);
              }
              if (h === 'x:cache') {
                e.sun.shadow.autoUpdate = false;
                e.sun.shadow.needsUpdate = false;
                const t = await gpu();
                e.sun.shadow.autoUpdate = true;
                out.push(`sun map frozen (no shadow pass): ${t.toFixed(1)} ms  [base ${(await gpu()).toFixed(1)}]`);
              }
              continue;
            }
            const sh = h.startsWith('shadow:');
            const pat = new RegExp(sh ? h.slice(7) : h);
            const picked: any[] = [];
            r.scene.traverse((o: any) => {
              if (!(o.isMesh)) return;
              let name = o.name || '';
              for (let p = o.parent; p && !(name && pat.test(name)); p = p.parent) name = (p.name && pat.test(p.name)) ? p.name : name;
              if (pat.test(name)) picked.push(o);
            });
            if (sh) { const prev = picked.map((o) => o.castShadow); picked.forEach((o) => (o.castShadow = false)); const t = await gpu(); picked.forEach((o, i) => (o.castShadow = prev[i])); out.push(`no shadow cast by ${h.slice(7)} (${picked.length} meshes): ${t.toFixed(1)} ms  [base ${(await gpu()).toFixed(1)}]`); }
            else { const prev = picked.map((o) => o.visible); picked.forEach((o) => (o.visible = false)); const t = await gpu(); picked.forEach((o, i) => (o.visible = prev[i])); out.push(`hide ${h} (${picked.length} meshes): ${t.toFixed(1)} ms  [base ${(await gpu()).toFixed(1)}]`); }
          }
          void hidden;
          r.env.sun.castShadow = false;
          out.push(`sun shadow off: ${(await gpu()).toFixed(1)} ms`);
          return out;
        }, [HIDES, DEFAULT] as [string[], boolean]);
        for (const l of lines) log(`${slug} gpu: ${l}`);
      }
      log(`== ${slug}: total tris ${rows.total.tris} inView ${rows.total.inView} shadowCasting ${rows.total.shadow} meshes ${rows.total.draws} inViewMeshes ${rows.total.inViewDraws}; stats draws=${rows.stats.drawCalls} tris=${rows.stats.triangles} scene=${rows.stats.sceneTriangles}`);
      for (const g of rows.rows.slice(0, TOP)) log(`${String(g.inView).padStart(9)} inView ${String(g.tris).padStart(9)} all ${String(g.shadowTris).padStart(9)} cast x${String(g.n).padStart(4)} (${g.inViewDraws} in view)  ${g.k}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}
void main();

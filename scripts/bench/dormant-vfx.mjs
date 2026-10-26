/** Full-renderer on-demand regression for inactive emitters. Requires a studio dev server. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const server = process.env.AETHER_BENCH_URL ?? 'http://localhost:5176';
const browser = await chromium.launch({ args: process.env.GEN_GPU === 'intel'
  ? ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.route('**/vfx-idle', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas width="256" height="256" style="width:256px;height:256px"></canvas>' }));
  await page.goto(`${server}/vfx-idle`);
  const result = await page.evaluate(async repository => {
    const root = '/@fs' + repository;
    const { WorldRenderer } = await import(root + 'packages/render/src/world-renderer.ts');
    const { FakeSource, world, box } = await import(root + 'packages/render/test/helpers.ts');
    const r = await WorldRenderer.create(document.querySelector('canvas'), { backend: 'webgl2', geometrySource: new FakeSource(), watchdog: false, shadows: false, antialias: false, foliageUrl: null, growIn: false, blueprint: false });
    r.setRenderTier('low');
    r.setAdaptiveResolution(false);
    await r.setWorld(world([{ id: 'holder' }, box('torch', [500, 1, 0], { parent: 'holder', vfx: { preset: 'fire', enabled: true } }), box('prop', [0, 1, 0])], { environment: { bloom: 0, weather: 'clear' } }));
    await r.sync.whenIdle();
    for (let i = 0; i < 500 && r.warming; i++) await new Promise(resolve => setTimeout(resolve, 20));
    if (r.warming) throw new Error('Shader warmup timed out');
    r.setCameraPose(0, 3, 10, 0, -Math.atan2(3, 10));
    const frames = count => {
      let drawn = 0;
      for (let i = 0; i < count; i++) if (r.render(0.1, { onDemand: true, animate: true })) drawn++;
      return drawn;
    };
    frames(60);
    const dormantDraws = frames(60);
    const gl = r.renderer.backend.gl;
    const pixels = () => {
      const out = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    };
    const optimized = pixels();
    // Restore the former policy as a control, keeping every other renderer setting identical.
    const vfx = r.fx.vfx;
    Object.defineProperty(vfx, 'animating', { configurable: true, get() { return this.emitterCount > 0 || this.pools.add.alive(this.clock) || this.pools.alpha.alive(this.clock); } });
    const formerDraws = frames(60);
    const reference = pixels();
    delete vfx.animating;
    let pixelDifferences = 0;
    for (let i = 0; i < reference.length; i++) if (reference[i] !== optimized[i]) pixelDifferences++;
    const torch = r.sync.object('torch');
    torch.position.x = 0;
    torch.updateMatrix();
    r.requestRender();
    const activeDraws = frames(60);
    r.sync.object('holder').visible = false;
    r.requestRender();
    frames(60); // Let the particles already born finish naturally.
    const hiddenDraws = frames(60);
    const error = gl.getError();
    const gpu = r.gpu.description;
    const emitterCount = vfx.emitterCount;
    r.dispose();
    return { gpu, dormantDraws, formerDraws, activeDraws, hiddenDraws, emitterCount, pixelDifferences, error };
  }, repository);
  console.log(JSON.stringify(result, null, 2));
  if (result.dormantDraws || result.hiddenDraws || result.formerDraws !== 60 || result.activeDraws === 0 || result.emitterCount !== 1 || result.pixelDifferences || result.error) process.exitCode = 1;
} finally {
  await browser.close();
}

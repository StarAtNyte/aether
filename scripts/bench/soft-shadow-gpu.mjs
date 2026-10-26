/** Real PCSS shader variants: exact images and interleaved GPU timers on synthetic depth fields. */
import { chromium, firefox } from 'playwright';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const webgpu = process.env.AETHER_BENCH_WEBGPU === '1';
const server = process.env.AETHER_BENCH_URL ?? 'http://localhost:5177';
const cache = `node_modules/.aether-shadow-probe-${process.pid}`;
const production = await readFile(new URL('../../packages/render/src/gpu/sun-shadow-nodes.ts', import.meta.url), 'utf8');
const originalLoop = `    T.Loop(this.blockerTaps, ({ i }) => {
      const uv = shadowCoord.xy.add(T.vogelDiskSample(i, this.blockerTaps, phi).mul(search));
      b0.addAssign(lit(uv, zr).oneMinus());
      b1.addAssign(lit(uv, zr.add(dz1)).oneMinus());
      b2.addAssign(lit(uv, zr.add(dz2)).oneMinus());
      b3.addAssign(lit(uv, zr.add(dz3)).oneMinus());
    });`;
const stagedLoop = `    T.Loop(this.blockerTaps, ({ i }) => {
      const uv = shadowCoord.xy.add(T.vogelDiskSample(i, this.blockerTaps, phi).mul(search));
      b0.addAssign(lit(uv, zr).oneMinus());
    });`;
const distanceLoop = `      // The output is already fully lit when this branch is skipped. Defer the three
      // distance comparisons until a blocker exists, retaining the same tap order and sum.
      T.Loop(this.blockerTaps, ({ i }) => {
        const uv = shadowCoord.xy.add(T.vogelDiskSample(i, this.blockerTaps, phi).mul(search));
        b1.addAssign(lit(uv, zr.add(dz1)).oneMinus());
        b2.addAssign(lit(uv, zr.add(dz2)).oneMinus());
        b3.addAssign(lit(uv, zr.add(dz3)).oneMinus());
      });
`;
if (!production.includes(stagedLoop) || !production.includes(distanceLoop)) throw new Error('Production shadow algorithm changed; update the reference');
const source = production.replace(distanceLoop, '').replace(stagedLoop, originalLoop);
if (!source.includes(originalLoop)) throw new Error('Baseline blocker loop changed; update the experiment');
const perTap = source.replace(originalLoop, `    T.Loop(this.blockerTaps, ({ i }) => {
      const uv = shadowCoord.xy.add(T.vogelDiskSample(i, this.blockerTaps, phi).mul(search));
      const blocked = lit(uv, zr).oneMinus().toVar();
      b0.addAssign(blocked);
      T.If(blocked.greaterThan(0), () => {
        b1.addAssign(lit(uv, zr.add(dz1)).oneMinus());
        b2.addAssign(lit(uv, zr.add(dz2)).oneMinus());
        b3.addAssign(lit(uv, zr.add(dz3)).oneMinus());
      });
    });`);
const staged = production;
await mkdir(repository + cache, { recursive: true });
await writeFile(`${repository}${cache}/engine.ts`, "export * as T from 'three/webgpu'; export * as S from 'three/tsl';\n");
for (const [name, code] of Object.entries({ baseline: source, staged, perTap })) {
  await writeFile(`${repository}${cache}/${name}.ts`, code.replace("from '../environment/sun-shadow-plan'", `from '/@fs${repository}packages/render/src/environment/sun-shadow-plan.ts'`));
}
let browser;
try {
  browser = process.env.AETHER_BENCH_BROWSER === 'firefox' ? await firefox.launch({ headless: process.env.AETHER_BENCH_HEADED !== '1', firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } }) : await chromium.launch({ args: webgpu ? ['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader'] : process.env.GEN_GPU === 'intel'
    ? ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 500)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 500)); });
  await page.route('**/shadow-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
  await page.goto(server + '/shadow-probe');
  const result = await page.evaluate(async ({ repository, cache, extensive, reversed, webgpu }) => {
    const root = '/@fs' + repository;
    // Resolve through Vite so the filter and renderer share one TSL node/stack instance.
    const { T, S } = await import(root + cache + '/engine.ts');
    const { SOFT_TAPS } = await import(root + 'packages/render/src/environment/sun-shadow-plan.ts');
    const modules = {};
    for (const name of ['baseline', 'staged', 'perTap']) modules[name] = await import(root + cache + '/' + name + '.ts');
    const renderer = new T.WebGPURenderer({ canvas: document.querySelector('canvas'), forceWebGL: !webgpu, antialias: false, reversedDepthBuffer: reversed });
    await renderer.init(); renderer.setSize(512, 512); renderer.outputColorSpace = T.LinearSRGBColorSpace;
    if (reversed && !renderer.reversedDepthBuffer) throw new Error('Reversed depth unavailable');
    if (webgpu && !renderer.backend.isWebGPUBackend) throw new Error('WebGPU unavailable');
    const gl = renderer.backend.gl;
    const output = webgpu ? new T.RenderTarget(512, 512) : null;
    const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : webgpu ? 'WebGPU' : gl.getParameter(gl.RENDERER);
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 1;
    const geometry = new T.PlaneGeometry(2, 2);
    const depthScene = new T.Scene(), depthMaterial = new T.MeshBasicNodeMaterial();
    const depthMesh = new T.Mesh(geometry, depthMaterial); depthScene.add(depthMesh);
    const depthTexture = new T.DepthTexture(256, 256, T.UnsignedIntType);
    depthTexture.compareFunction = reversed ? T.GreaterEqualCompare : T.LessEqualCompare;
    depthTexture.minFilter = T.LinearFilter; depthTexture.magFilter = T.LinearFilter;
    const depthTarget = new T.RenderTarget(256, 256, { depthTexture, depthBuffer: true });
    const shadow = new T.DirectionalLight().shadow;
    Object.assign(shadow.camera, { left: -10, right: 10, near: 0.1, far: 25 }); shadow.mapSize.set(256, 256);
    const scenes = {}, materials = [], filters = [];
    for (const [name, module] of Object.entries(modules)) {
      const filter = new module.SoftShadowFilter({ blockerSamples: 6, filterSamples: 8, sunAngle: 0.02, minPenumbra: 0.012 });
      filters.push(filter);
      const value = filter.fn({ depthTexture, shadowCoord: S.vec3(S.uv(), 0.5), shadow, depthLayer: 0 });
      const material = new T.MeshBasicNodeMaterial(); material.colorNode = S.vec3(value);
      const scene = new T.Scene(); scene.add(new T.Mesh(geometry, material)); scenes[name] = scene; materials.push(material);
    }
    const pixels = async () => {
      if (webgpu) return new Uint8Array(await renderer.readRenderTargetPixelsAsync(output, 0, 0, 512, 512));
      const image = new Uint8Array(512 * 512 * 4);
      gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, image); return image;
    };
    const draw = name => renderer.render(scenes[name], camera);
    const results = [];
    const settings = extensive ? [
      { blockerSamples: 1, filterSamples: 1, sunAngle: .0001, minPenumbra: .001 },
      ...Object.values(SOFT_TAPS).map(([blockerSamples, filterSamples]) => ({ blockerSamples, filterSamples, sunAngle: .02, minPenumbra: .012 })),
      { blockerSamples: 16, filterSamples: 32, sunAngle: .12, minPenumbra: .04 },
    ] : [{ blockerSamples: 6, filterSamples: 8, sunAngle: .02, minPenumbra: .012 }];
    for (const noise of (extensive ? [0, 2.5, 23] : [0])) for (const setting of settings) for (const pattern of ['lit', 'shadow', 'split', 'checker', 'dense', 'ramp', ...(extensive ? ['near-contact', 'sparse'] : [])]) {
      for (const filter of filters) filter.set(setting);
      for (const module of Object.values(modules)) module.shadowNoiseValue.set(noise, -noise * 1.3);
      const uv = S.uv();
      const cells = pattern === 'dense' ? 128 : 16;
      const checker = S.mod(S.floor(uv.x.mul(cells)).add(S.floor(uv.y.mul(cells))), 2).lessThan(1);
      depthMaterial.depthNode = pattern === 'lit' ? S.float(1) : pattern === 'shadow' ? S.float(0.12)
        : pattern === 'split' ? S.select(uv.x.lessThan(0.5), 0.12, 1)
        : pattern === 'ramp' ? uv.x.mul(0.8).add(0.1)
        : pattern === 'near-contact' ? uv.x.mul(.002).add(.499)
        : pattern === 'sparse' ? S.select(uv.x.sub(.5).abs().lessThan(.002).and(uv.y.sub(.5).abs().lessThan(.002)), .12, 1) : S.select(checker, 0.12, 1);
      if (reversed) depthMaterial.depthNode = depthMaterial.depthNode.oneMinus();
      depthMaterial.needsUpdate = true;
      renderer.setRenderTarget(depthTarget); renderer.render(depthScene, camera); renderer.setRenderTarget(output);
      draw('baseline'); const reference = await pixels();
      const parity = {};
      for (const name of ['staged', 'perTap']) {
        draw(name); const actual = await pixels(); let differences = 0;
        for (let i = 0; i < actual.length; i++) if (actual[i] !== reference[i]) differences++;
        parity[name] = differences;
      }
      let lit = 0, dark = 0, penumbra = 0;
      for (let i = 0; i < reference.length; i += 4) {
        if (reference[i] === 255) lit++; else if (reference[i] === 0) dark++; else penumbra++;
      }
      const timing = {};
      if (ext && noise === 0) {
        for (let i = 0; i < 36; i++) draw(['baseline', 'staged', 'perTap'][i % 3]);
        gl.finish(); const samples = [];
        for (let i = 0; i < 48; i++) {
          const name = (i % 2 ? ['perTap', 'staged', 'baseline'] : ['baseline', 'staged', 'perTap'])[Math.floor(i / 2) % 3];
          const query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); draw(name); gl.endQuery(ext.TIME_ELAPSED_EXT);
          samples.push({ name, query });
        }
        const deadline = performance.now() + 15000;
        while (samples.some(s => !gl.getQueryParameter(s.query, gl.QUERY_RESULT_AVAILABLE))) {
          if (performance.now() > deadline) throw new Error('GPU query timeout');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw new Error('Disjoint GPU timing');
        for (const name of ['baseline', 'staged', 'perTap']) {
          const own = samples.filter(s => s.name === name).map(s => gl.getQueryParameter(s.query, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b);
          timing[name] = { medianMs: own[Math.floor(own.length / 2)], p90Ms: own[Math.floor(own.length * 0.9)], samples: own.length };
        }
        for (const s of samples) gl.deleteQuery(s.query);
      }
      results.push({ setting, noise, pattern, parity, lit, dark, penumbra, timing });
    }
    const error = gl?.getError() ?? 0;
    renderer.dispose(); output?.dispose(); depthTarget.dispose(); geometry.dispose(); depthMaterial.dispose(); for (const m of materials) m.dispose();
    return { gpu, gpuTimers: Boolean(ext), error, results };
  }, { repository, cache, extensive: process.env.AETHER_BENCH_EXTENSIVE === '1', reversed: process.env.AETHER_BENCH_REVERSED === '1', webgpu });
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length || result.error || result.results.some(r => Object.values(r.parity).some(n => n !== 0))
      || result.results.filter(r => ['split', 'checker'].includes(r.pattern)).some(r => r.penumbra === 0)) process.exitCode = 1;
} finally {
  await browser?.close();
  await rm(repository + cache, { recursive: true, force: true });
}

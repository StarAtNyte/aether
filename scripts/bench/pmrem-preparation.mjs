/** Experimental shader preparation for atomic environment filtering; not enabled in the runtime. */
import { chromium } from 'playwright';
const base = process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177';
const root = '/@fs' + process.cwd() + '/';
const rate = Number(process.env.AETHER_BENCH_CPU_RATE ?? 1);
if (!Number.isFinite(rate) || rate < 1 || rate > 20) throw new Error('Invalid CPU rate');
const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.route('**/pmrem-preparation-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>PMREM preparation</title>' }));
  await page.goto(base + '/pmrem-preparation-probe');
  const results = await page.evaluate(async ({ root }) => {
    const { T, parallelPrograms } = await import(root + 'scripts/bench/graph-browser-engine.mjs');
    async function measured(action) {
      let last = performance.now(), maxGap = 0;
      const timer = setInterval(() => { const t = performance.now(); maxGap = Math.max(maxGap, t - last); last = t; }, 0);
      await new Promise(resolve => setTimeout(resolve, 10));
      const start = performance.now(), value = await action(), wallMs = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 10)); clearInterval(timer);
      return { wallMs, maxGap, value };
    }
    async function run(mode, width, kind) {
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const renderer = new T.WebGPURenderer({ canvas, forceWebGL: true, antialias: false });
      await renderer.init(); renderer.setSize(32, 32);
      const faces = [];
      let input;
      if (kind === 'cube') {
        const edge = width / 4;
        for (let face = 0; face < 6; face++) {
          const pixels = Uint8Array.from({ length: edge * edge * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 17 + face * 31) % 256);
          faces.push(new T.DataTexture(pixels, edge, edge, T.RGBAFormat, T.UnsignedByteType));
        }
        input = new T.CubeTexture(faces); input.colorSpace = T.SRGBColorSpace;
      } else {
        const bytes = kind === 'srgb-byte';
        const pixels = bytes ? new Uint8Array(width * (width / 2) * 4) : new Float32Array(width * (width / 2) * 4);
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = bytes ? (i * 17) % 256 : .2 + (i % 31) / 31;
          pixels[i + 1] = bytes ? (i * 23) % 256 : .1 + (i % 43) / 43;
          pixels[i + 2] = bytes ? 92 : .3; pixels[i + 3] = bytes ? 255 : 1;
        }
        input = new T.DataTexture(pixels, width, width / 2, T.RGBAFormat, bytes ? T.UnsignedByteType : T.FloatType);
        input.mapping = T.EquirectangularReflectionMapping;
        if (bytes) input.colorSpace = T.SRGBColorSpace;
      }
      input.needsUpdate = true;
      const filter = (generator, target) => kind === 'cube' ? generator.fromCubemap(input, target) : generator.fromEquirectangular(input, target);
      const gl = renderer.backend.gl, liveTextures = new Set();
      const makeTexture = gl.createTexture.bind(gl), deleteTexture = gl.deleteTexture.bind(gl);
      let peakTextures = 0;
      gl.createTexture = () => { const texture = makeTexture(); if (texture) liveTextures.add(texture); peakTextures = Math.max(peakTextures, liveTextures.size); return texture; };
      gl.deleteTexture = texture => { liveTextures.delete(texture); deleteTexture(texture); };
      const failures = [];
      const programs = parallelPrograms(renderer.backend, () => {}, error => failures.push(String(error)));
      const create = renderer.backend.createRenderPipeline;
      let phase = 'prepare'; const calls = { prepare: 0, generate: 0 };
      renderer.backend.createRenderPipeline = function (...args) { calls[phase]++; return create.apply(this, args); };
      const generator = new T.PMREMGenerator(renderer);
      let target, staged, outputGenerator = generator;
      try {
        const preparation = await measured(async () => {
          if (mode === 'public') { if (kind === 'cube') await generator.compileCubemapShader(); else await generator.compileEquirectangularShader(); }
          if (mode.startsWith('discovered')) {
            const render = renderer.render, jobs = new Map();
            renderer.render = (mesh, camera) => {
              if (!jobs.has(mesh.material)) jobs.set(mesh.material, { mesh: mesh.clone(), camera: camera.clone(), target: renderer.getRenderTarget() });
            };
            try { target = filter(generator); } finally { renderer.render = render; }
            for (const job of jobs.values()) {
              const previous = renderer.getRenderTarget(); let pending;
              try { renderer.setRenderTarget(job.target); pending = renderer.compileAsync(job.mesh, job.camera); }
              finally { renderer.setRenderTarget(previous); }
              await pending;
            }
            await programs.idle();
          }
        });
        const texturesBeforeRelease = liveTextures.size;
        if (mode === 'discovered-new' || mode === 'discovered-released') {
          staged = target; target = undefined; outputGenerator = new T.PMREMGenerator(renderer);
          if (mode === 'discovered-released') { staged.dispose(); staged = undefined; generator._pingPongRenderTarget.dispose(); }
        }
        const texturesAfterRelease = liveTextures.size;
        const restored = renderer.getRenderTarget() === null && renderer.getOutputRenderTarget() === null && renderer._isPreCompiling === false;
        phase = 'generate';
        const generation = await measured(() => programs.synchronous(() => filter(outputGenerator, target)));
        target = generation.value; delete generation.value; delete preparation.value;
        const output = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
        const result = { mode, width, kind, restored, texturesBeforeRelease, texturesAfterRelease, preparation, generation, calls, failures, peakTextures, error: renderer.backend.gl.getError(), output: Array.from(new Uint8Array(output.buffer, output.byteOffset, output.byteLength)) };
        return result;
      } finally {
        target?.dispose(); staged?.dispose();
        if (outputGenerator !== generator) outputGenerator.dispose();
        generator.dispose(); input.dispose(); for (const face of faces) face.dispose(); programs.dispose();
        const gl = renderer.backend.gl; renderer.dispose(); gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove();
      }
    }
    const results = [];
    for (let round = 0; round < 3; round++) for (const width of [64, 256]) for (const kind of ['linear-float', 'srgb-byte', 'cube']) {
      const modes = round % 2 ? ['discovered-released', 'discovered-new', 'none', 'discovered', 'public'] : ['none', 'public', 'discovered', 'discovered-new', 'discovered-released'];
      const cases = [];
      for (const mode of modes) cases.push(await run(mode, width, kind));
      const before = cases.find(c => c.mode === 'none');
      for (const after of cases.filter(c => c.mode !== 'none')) {
        let differences = Math.abs(before.output.length - after.output.length);
        for (let i = 0; i < Math.min(before.output.length, after.output.length); i++) if (before.output[i] !== after.output[i]) differences++;
        const baseline = { ...before }, candidate = { ...after }; delete baseline.output; delete candidate.output;
        results.push({ round, width, kind, differences, before: baseline, after: candidate });
      }
    }
    return results;
  }, { root });
  console.log(JSON.stringify({ cpuRate: rate, errors, results }, null, 2));
  if (errors.length || results.some(r => r.differences || r.before.error || r.after.error || r.before.failures.length || r.after.failures.length || !r.after.restored
    || (r.after.mode.startsWith('discovered') && r.after.calls.generate !== 0)
    || (r.after.mode === 'discovered-released' && (r.after.texturesAfterRelease >= r.after.texturesBeforeRelease || r.after.peakTextures > r.before.peakTextures)))) process.exitCode = 1;
} finally { await browser.close(); }

/** Production UI worker health, event-loop stalls and CPU stacks while opening a world. */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const cpuRate = Number(process.env.AETHER_BENCH_CPU_RATE ?? 1);
if (!Number.isFinite(cpuRate) || cpuRate < 1 || cpuRate > 20) throw new Error('CPU rate must be between 1 and 20');
const base = process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5176';
const world = process.env.AETHER_BENCH_WORLD ?? 'casa-patio';
const asyncCompile = process.env.AETHER_BENCH_ASYNC === '1';
const cachePixelStore = process.env.AETHER_BENCH_CACHE_PIXEL_STORE === '1';
const holdCompiling = process.env.AETHER_BENCH_HOLD_COMPILING === '1';
const glTrace = process.env.AETHER_BENCH_GL_TRACE === '1';
const pipelineTrace = process.env.AETHER_BENCH_PIPELINE_TRACE === '1';
const textureSlice = process.env.AETHER_BENCH_TEXTURE_SLICE === '1';
const phaseTrace = process.env.AETHER_BENCH_PHASE_TRACE === '1';
const renderTrace = process.env.AETHER_BENCH_RENDER_TRACE === '1';
const browser = await chromium.launch({ args: process.env.GEN_GPU === 'intel'
  ? ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(({ nativeGPU }) => {
    localStorage.setItem('aether.onboarding.v1', JSON.stringify({ choice: 'offline', at: 1 }));
    localStorage.setItem('aether.tour.v1', JSON.stringify({ done: true, at: 1 }));
    if (!nativeGPU) delete Navigator.prototype.gpu;
    globalThis.__uiProbe = { tasks: [], gaps: [] };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) globalThis.__uiProbe.tasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      if (now - last > 50) globalThis.__uiProbe.gaps.push(now - last);
      last = now;
    }, 16);
  }, { nativeGPU: process.env.AETHER_BENCH_NATIVE_GPU === '1' });
  if (glTrace) await context.addInitScript(() => {
    window.__glSlowCalls = [];
    const seen = new Set();
    for (let proto = WebGL2RenderingContext.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor' || seen.has(name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (typeof descriptor?.value !== 'function') continue;
        seen.add(name); const original = descriptor.value;
        Object.defineProperty(proto, name, { ...descriptor, value: function (...args) {
          const start = performance.now();
          try { return original.apply(this, args); }
          finally { const duration = performance.now() - start; if (duration > 20) window.__glSlowCalls.push({ name, start, duration }); }
        } });
      }
    }
  });
  const page = await context.newPage(), workers = [], errors = [], failedRequests = [];
  page.on('worker', worker => {
    const record = { url: worker.url().split('/').pop(), closed: false };
    workers.push(record); worker.on('close', () => { record.closed = true; });
  });
  page.on('pageerror', e => (errors.push(e.message.slice(0, 300)), console.error('page error:', e.message.slice(0, 300))));
  page.on('response', r => { if (r.status() >= 400) failedRequests.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  const session = await context.newCDPSession(page);
  if (cpuRate !== 1) await session.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await session.send('Performance.enable');
  if (process.env.AETHER_BENCH_TRACE) await session.send('Tracing.start', { categories: 'devtools.timeline,v8,blink,renderer.scheduler,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
  await session.send('Profiler.enable'); await session.send('Profiler.setSamplingInterval', { interval: 1000 }); await session.send('Profiler.start');
  const start = performance.now();
  await page.goto(`${base}/?debug=1#/new/${world}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (asyncCompile || cachePixelStore || pipelineTrace || renderTrace || phaseTrace || textureSlice) {
    await page.waitForFunction(() => window.__aether?.simulation, null, { timeout: 120000 });
    await page.evaluate(({ asyncCompile, cachePixelStore, holdCompiling, pipelineTrace, renderTrace, phaseTrace, textureSlice }) => {
      const r = window.__aether.simulation.renderer, backend = r.renderer.backend;
      if (textureSlice) {
        const nodes = r.renderer._nodes, build = nodes.getForRenderAsync;
        window.__textureSlice = { count: 0, total: 0, max: 0 };
        nodes.getForRenderAsync = async function (object) {
          const result = await build.call(this, object);
          for (const group of object.getBindings()) for (const binding of group.bindings) {
            const texture = binding.texture;
            if (!binding.isSampledTexture || !texture?.image || texture.version <= 0 || texture.image.complete === false || texture.source?.dataReady === false
                || texture.isRenderTargetTexture || texture.isDepthTexture || texture.isFramebufferTexture || texture.isVideoTexture || texture.isStorageTexture || texture.isExternalTexture || texture.isHTMLTexture) continue;
            const data = r.renderer._textures.get(texture);
            if (data.initialized && data.version === texture.version) continue;
            await new Promise(resolve => setTimeout(resolve, 0));
            const start = performance.now();
            r.renderer.initTexture(texture);
            const duration = performance.now() - start, stats = window.__textureSlice;
            stats.count++; stats.total += duration; stats.max = Math.max(stats.max, duration);
          }
          return result;
        };
      }
      if (phaseTrace) {
        window.__phaseProbe = [];
        window.__phaseTiming = { firstFrame: null, refined: null };
        const render = r.render;
        r.render = function (...args) {
          const result = render.apply(this, args), timing = window.__phaseTiming;
          const loaded = window.__aether.store.getState().loading === null && Object.keys(window.__aether.history.current.entities).length > 0;
          if (result && loaded && timing.firstFrame === null) timing.firstFrame = performance.now();
          if (result && loaded && timing.refined === null && this.atRest && !this.postPending && this.preparation.pending === 0 && this.programs.pending === 0 && this.refineProgress === 1) {
            const wanted = this.wantedEffects();
            if (wanted && this.post && Object.keys(wanted).every(k => this.post.effects[k] === wanted[k])) timing.refined = performance.now();
          }
          return result;
        };
        const sync = r.syncRest;
        r.syncRest = function (...args) {
          const before = this.atRest;
          const value = sync.apply(this, args);
          if (before !== this.atRest) window.__phaseProbe.push({ at: performance.now(), rest: this.atRest, motion: args[0], pending: this.preparation.pending, programs: this.programs.pending, post: this.post?.key });
          return value;
        };
      }
      if (renderTrace) {
        window.__renderFrames = [];
        let costs = null, passes = [], activePass = null;
        const wrap = (object, name, label = name) => {
          if (!object || typeof object[name] !== 'function') return;
          const original = object[name];
          object[name] = function (...args) {
            const start = performance.now();
            try { return original.apply(this, args); }
            finally {
              if (costs) { const c = costs[label] ??= { ms: 0, calls: 0 }; c.ms += performance.now() - start; c.calls++; }
            }
          };
        };
        for (const name of ['drawReady', 'syncPost', 'stepAnimations', 'prepareBatches']) wrap(r, name);
        for (const [name, object] of [['_nodes', r.renderer._nodes], ['_pipelines', r.renderer._pipelines], ['_bindings', r.renderer._bindings], ['_geometries', r.renderer._geometries], ['_objects', r.renderer._objects]]) {
          for (const key of ['getForRender', 'updateForRender', 'updateBefore', 'get']) wrap(object, key, name + '.' + key);
        }
        wrap(backend, 'draw', 'backend.draw');
        const draw = backend.draw;
        backend.draw = function (...args) { if (activePass) activePass.draws++; return draw.apply(this, args); };
        const sceneRender = r.renderer.render;
        r.renderer.render = function (scene, camera, ...args) {
          const entry = { name: scene.name || scene.type, camera: camera.type, shadow: scene.overrideMaterial?.isShadowPassMaterial === true, lighting: this.lighting.enabled, draws: 0, ms: 0 };
          const previous = activePass, start = performance.now(); activePass = entry; passes.push(entry);
          try { return sceneRender.call(this, scene, camera, ...args); }
          finally { entry.ms = performance.now() - start; activePass = previous; }
        };
        const render = r.render;
        r.render = function (...args) {
          costs = {}; passes = []; const start = performance.now();
          try { return render.apply(this, args); }
          finally {
            const duration = performance.now() - start;
            if (duration > 50) window.__renderFrames.push({ start, duration, costs, passes });
            costs = null;
          }
        };
      }
      if (pipelineTrace) {
        window.__pipelineCompileCalls = [];
        const complete = backend._completeCompile;
        backend._completeCompile = function (object, pipeline) {
          const start = performance.now();
          try { return complete.call(this, object, pipeline); }
          finally {
            const duration = performance.now() - start;
            if (duration > 10) window.__pipelineCompileCalls.push({ start, duration, object: object.object?.name,
              material: object.material?.name, type: object.material?.type, vertices: object.object?.geometry?.attributes?.position?.count,
              targets: object.context?.textures?.map(t => t.name) });
          }
        };
      }
      if (cachePixelStore) {
        const gl = backend.gl, state = backend.state;
        for (const key of [gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) {
          if (state.parameters[key] === undefined) state.parameters[key] = gl.getParameter(key);
        }
      }
      if (!asyncCompile) return;
      const original = backend.createRenderPipeline;
      window.__compileProbe = { started: 0, finished: 0, pending: 0, maxPending: 0, parallel: Boolean(backend.parallel) };
      if (holdCompiling) {
        const render = r.render;
        r.render = function (...args) { return window.__compileProbe.pending ? false : render.apply(this, args); };
      }
      backend.createRenderPipeline = function (object, promises) {
        if (promises !== null || !this.parallel) return original.call(this, object, promises);
        const jobs = [];
        original.call(this, object, jobs);
        const stats = window.__compileProbe;
        for (const job of jobs) {
          stats.started++; stats.pending++; stats.maxPending = Math.max(stats.maxPending, stats.pending);
          job.finally(() => { stats.finished++; stats.pending--; if (!stats.pending) r.requestRender(); });
        }
      };
    }, { asyncCompile, cachePixelStore, holdCompiling, pipelineTrace, renderTrace, phaseTrace, textureSlice });
  }
  await page.waitForFunction(() => {
    const a = window.__aether;
    return a?.simulation && a.store.getState().loading === null && Object.keys(a.history.current.entities).length > 0;
  }, null, { timeout: 120000 });
  const openMs = performance.now() - start;
  await page.waitForTimeout(Number(process.env.AETHER_BENCH_AFTER_OPEN_MS ?? 15000));
  const { profile } = await session.send('Profiler.stop');
  if (process.env.AETHER_BENCH_PROFILE) await writeFile(process.env.AETHER_BENCH_PROFILE, JSON.stringify(profile));
  const { metrics } = await session.send('Performance.getMetrics');
  const nav = metrics.find(m => m.name === 'NavigationStart')?.value;
  if (process.env.AETHER_BENCH_TRACE) {
    const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
    await session.send('Tracing.end');
    const { stream } = await complete;
    let trace = '';
    for (;;) {
      const part = await session.send('IO.read', { handle: stream });
      trace += part.base64Encoded ? Buffer.from(part.data, 'base64').toString() : part.data;
      if (part.eof) break;
    }
    await session.send('IO.close', { handle: stream });
    await writeFile(process.env.AETHER_BENCH_TRACE, trace);
  }
  const observations = await page.evaluate(() => {
    const a = window.__aether, r = a.simulation.renderer;
    return { ...window.__uiProbe, textureSlice: window.__textureSlice ?? null, phases: window.__phaseProbe ?? [], phaseTiming: window.__phaseTiming ?? null, uvMathSpecialized: (() => { const tex=r.materials?.foliage?.textures?.values().next().value; const code=tex?.matrix.setUvTransform.toString().replace(/\s/g,'')??''; return /===0|0===/.test(code)&&code.includes('Math'); })(), shadowCache: r.env?.sunCascades ? { enabled: r.env.sunCascades.cacheEnabled, dynamic: r.env.sunCascades.sceneState.dynamicInputs } : null, refineProgress: r.refineProgress, atRest: r.atRest, restDeferred: r.restDeferred, post: r.post?.key, renderFrames: window.__renderFrames ?? [], pipelineCalls: window.__pipelineCompileCalls ?? [], glCalls: window.__glSlowCalls ?? [], compile: window.__compileProbe ?? null, entities: Object.keys(a.history.current.entities).length, backend: r.backend, tier: r.renderTier, drawn: r.framesDrawn, pendingPrograms: r.programs?.pending ?? null, pendingPreparation: r.preparation?.pending ?? null };
  });
  const byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map();
  for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i] / 1000);
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([id, ms]) => {
    const f = byId.get(id).callFrame;
    return { fn: f.functionName || '(anonymous)', file: f.url.split('/').pop(), line: f.lineNumber, ms: Math.round(ms) };
  });
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const stacks = [...self].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, ms]) => {
    const frames = [];
    for (let current = id; current && frames.length < 12; current = parent.get(current)) {
      const f = byId.get(current).callFrame; frames.push(`${f.functionName || '(anon)'}@${f.url.split('/').pop()}:${f.lineNumber}`);
    }
    return { ms: Math.round(ms), frames };
  });
  observations.tasks.sort((a, b) => b.duration - a.duration);
  const focused = observations.tasks.slice(0, 5).map(task => {
    const counts = new Map(); let at = profile.startTime;
    const lo = nav * 1e6 + task.start * 1000, hi = lo + task.duration * 1000;
    for (let i = 0; i < profile.samples.length; i++) {
      at += profile.timeDeltas[i];
      if (at >= lo && at < hi) counts.set(profile.samples[i], (counts.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i] / 1000);
    }
    return { ...task, self: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, ms]) => ({ fn: byId.get(id).callFrame.functionName, ms: Math.round(ms) })) };
  });
  observations.gaps.sort((a, b) => b - a);
  console.log(JSON.stringify({ world, cpuRate, asyncCompile, cachePixelStore, openMs, navigationStart: nav, focused, workers, errors, failedRequests, observations: { ...observations, tasks: observations.tasks.slice(0, 20), gaps: observations.gaps.slice(0, 20) }, top, stacks }, null, 2));
} finally { await browser.close(); }

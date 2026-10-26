/** Actual worker parity and event-loop responsiveness, with independent geometry and CPU throttling. */
import { chromium, firefox } from 'playwright';
const firefoxMode = process.env.AETHER_BENCH_BROWSER === 'firefox';
const cpuRate = firefoxMode ? 1 : Number(process.env.AETHER_BENCH_CPU_RATE ?? 4);
const browser = await (firefoxMode ? firefox.launch() : chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] }));
try {
  const page = await browser.newPage(), errors = [], workers = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  if (!firefoxMode) {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  }
  await page.route('**/bvh-worker-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>BVH worker probe</title>' }));
  await page.goto((process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177') + '/bvh-worker-probe');
  const cases = await page.evaluate(async root => {
    const T = await import(root + 'node_modules/three/build/three.module.js');
    const { buildTriangleBvh } = await import(root + 'packages/render/src/geometry/raycast-bvh-build.ts');
    const { warmTriangleBvh, triangleBvh } = await import(root + 'packages/render/src/geometry/raycast-bvh.ts');
    const results = [];
    async function measure(run) {
      let last = performance.now(), maxGap = 0, ticks = 0;
      const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++; }, 4);
      await new Promise(resolve => setTimeout(resolve, 20));
      const start = performance.now(), value = await run(), wallMs = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 20)); clearInterval(timer);
      return { value, wallMs, maxGap, ticks };
    }
    for (const indexed of [true, false]) {
      const plane = new T.PlaneGeometry(50, 50, 400, 400);
      const g = indexed ? plane : plane.toNonIndexed();
      const position = g.getAttribute('position');
      for (let i = 0; i < position.count; i++) position.setZ(i, Math.sin(position.getX(i) * .2) * Math.cos(position.getY(i) * .2));
      const p = position.array, index = g.index?.array ?? null, n = Math.floor((index?.length ?? position.count) / 3);
      const reference = await measure(() => buildTriangleBvh(p, index, n, position.version, g.index?.version ?? 0));
      const candidate = await measure(async () => { await warmTriangleBvh(g); return triangleBvh(g); });
      const a = reference.value, b = candidate.value;
      const same = ['boxes', 'nodes', 'tris'].every(key => {
        const x = new Uint8Array(a[key].buffer, a[key].byteOffset, a[key].byteLength), y = new Uint8Array(b[key].buffer, b[key].byteOffset, b[key].byteLength);
        return x.length === y.length && x.every((v, i) => v === y[i]);
      });
      if (!same || b.positions !== p || b.index !== index || !p.byteLength) throw new Error('BVH parity/ownership failure');
      results.push({ indexed, triangles: n, exact: same, reference: { wallMs: reference.wallMs, maxGap: reference.maxGap, ticks: reference.ticks }, worker: { wallMs: candidate.wallMs, maxGap: candidate.maxGap, ticks: candidate.ticks } });
      g.dispose(); if (g !== plane) plane.dispose();
    }
    return results;
  }, '/@fs' + process.cwd() + '/');
  console.log(JSON.stringify({ browser: firefoxMode ? 'firefox' : 'chromium', cpuRate, errors, workers, cases }, null, 2));
  if (errors.length || !workers.some(url => url.includes('raycast-bvh.worker'))) process.exitCode = 1;
} finally { await browser.close(); }

/** Actual merge-worker byte parity and page timer gaps, including attribute decoding and lightmap expansion. */
import { chromium, firefox } from 'playwright';
const firefoxMode = process.env.AETHER_BENCH_BROWSER === 'firefox', cpuRate = firefoxMode ? 1 : 4;
const browser = await (firefoxMode ? firefox.launch() : chromium.launch());
try {
  const page = await browser.newPage(), errors = [], workers = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('worker', w => workers.push(w.url()));
  if (!firefoxMode) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await page.route('**/merge-worker-probe', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto((process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177') + '/merge-worker-probe');
  const cases = await page.evaluate(async root => {
    const { C: T } = await import(root + 'scripts/bench/graph-browser-engine.mjs');
    const { mergeGeometries } = await import(root + 'packages/render/src/sync/merge-geometries.ts');
    const { expandWithLightmap } = await import(root + 'packages/render/src/sync/lightmap-uv.ts');
    const { MergeBuildClient } = await import(root + 'packages/render/src/sync/merge-client.ts');
    const { mergeRequest, writeMergeOutput } = await import(root + 'packages/render/src/sync/merge-wire.ts');
    async function measure(run) {
      let last = performance.now(), maxGap = 0, ticks = 0;
      const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++; }, 4);
      await new Promise(r => setTimeout(r, 20)); const start = performance.now(), value = await run(), wallMs = performance.now() - start;
      await new Promise(r => setTimeout(r, 20)); clearInterval(timer); return { value, maxGap, wallMs, ticks };
    }
    const client = new MergeBuildClient(), cases = [];
    try {
      for (const name of ['plain', 'normalized-interleaved', 'half', 'lightmap']) {
        const geometry = new T.PlaneGeometry(30, 20, 128, 128), p = geometry.getAttribute('position'), count = p.count;
        if (name === 'normalized-interleaved') {
          const values = new Float32Array(count * 5); for (let i = 0; i < count; i++) { values[i * 5] = p.getX(i); values[i * 5 + 1] = p.getY(i); values[i * 5 + 2] = Math.sin(i) * .1; }
          geometry.setAttribute('position', new T.InterleavedBufferAttribute(new T.InterleavedBuffer(values, 5), 3, 0));
          const normal = new Int8Array(count * 3); for (let i = 2; i < normal.length; i += 3) normal[i] = 127;
          geometry.setAttribute('normal', new T.BufferAttribute(normal, 3, true));
          const uv = geometry.getAttribute('uv'), valuesUV = new Uint16Array(count * 2);
          for (let i = 0; i < count; i++) { valuesUV[i * 2] = Math.round(uv.getX(i) * 65535); valuesUV[i * 2 + 1] = Math.round(uv.getY(i) * 65535); }
          geometry.setAttribute('uv', new T.BufferAttribute(valuesUV, 2, true));
        } else if (name === 'half') geometry.setAttribute('position', new T.Float16BufferAttribute(Array.from(p.array, T.DataUtils.toHalfFloat), 3));
        const color = new Uint8Array(count * 3); for (let i = 0; i < color.length; i++) color[i] = (i * 23) % 256;
        geometry.setAttribute('color', new T.BufferAttribute(color, 3, true));
        const members = Array.from({ length: 12 }, (_, i) => ({ geometry, rel: Float64Array.from(new T.Matrix4().makeShear(.2, .1, 0, .3, 0, .1).scale(new T.Vector3(i % 3 === 0 ? -1 : 1, 1.3, .7)).setPosition(i * 2, i % 3, 0).elements) }));
        const lightmap = name === 'lightmap' ? members.map((_, i) => new Float32Array(geometry.index.count * 2).fill(i / members.length)) : null;
        const request = mergeRequest(members, lightmap); if (!request) throw new Error('Worker descriptors unavailable for ' + name);
        const before = await measure(() => {
          let result = mergeGeometries(members);
          if (lightmap) { const uv = new Float32Array(lightmap.reduce((n, a) => n + a.length, 0)); let offset = 0; for (const part of lightmap) { uv.set(part, offset); offset += part.length; } const lit = expandWithLightmap(result, uv); result.dispose(); result = lit; }
          return result;
        });
        const after = await measure(() => client.build(request).promise);
        if (!after.value) throw new Error('Worker merge failed: ' + name);
        const a = writeMergeOutput(before.value), b = writeMergeOutput(after.value);
        const arrays = [...Object.keys(a.attributes).map(key => [key, a.attributes[key].array, b.attributes[key]?.array]), ['index', a.index, b.index]];
        for (const [key, x, y] of arrays) {
          if (x === null && y === null) continue;
          if (!x || !y || x.constructor !== y.constructor || x.byteLength !== y.byteLength) throw new Error('Layout changed: ' + name + '/' + key);
          const u = new Uint8Array(x.buffer, x.byteOffset, x.byteLength), v = new Uint8Array(y.buffer, y.byteOffset, y.byteLength);
          if (!u.every((value, i) => value === v[i])) throw new Error('Merge pixels/geometry changed: ' + name + '/' + key);
        }
        if (JSON.stringify(a.box) !== JSON.stringify(b.box) || JSON.stringify(a.sphere) !== JSON.stringify(b.sphere) || !geometry.getAttribute('position').array.byteLength) throw new Error('Bounds/ownership changed');
        cases.push({ name, sourceVertices: count * members.length, outputVertices: after.value.getAttribute('position').count, exact: true, reference: { maxGap: before.maxGap, wallMs: before.wallMs, ticks: before.ticks }, worker: { maxGap: after.maxGap, wallMs: after.wallMs, ticks: after.ticks } });
        before.value.dispose(); after.value.dispose(); geometry.dispose();
      }
    } finally { client.dispose(); }
    return cases;
  }, '/@fs' + process.cwd() + '/');
  console.log(JSON.stringify({ browser: firefoxMode ? 'firefox' : 'chromium', cpuRate, errors, workers, cases }, null, 2));
  if (errors.length || !workers.some(w => w.includes('merge.worker'))) process.exitCode = 1;
} finally { await browser.close(); }

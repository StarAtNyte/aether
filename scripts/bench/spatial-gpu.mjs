/**
 * GPU timer experiment: spatial batches vs one global Three.js InstancedMesh, same scene and image.
 * Start the studio dev server, then:
 * GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/spatial-gpu.mjs
 * Measures submission plus GPU execution in a timer query; does not measure application FPS.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const server = process.env.AETHER_BENCH_URL ?? 'http://localhost:5176';
const browser = await chromium.launch({ args: process.env.GEN_GPU === 'intel'
  ? ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.route('**/spatial-gpu', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
  await page.goto(`${server}/spatial-gpu`);
  const result = await page.evaluate(async repository => {
    const root = '/@fs' + repository;
    const T = await import(root + 'node_modules/three/build/three.module.js');
    const { makeSync, world } = await import(root + 'packages/render/test/helpers.ts');
    const { sync } = makeSync();
    const entities = Array.from({ length: 1024 }, (_, i) => ({ id: `p-${i}`, transform: { position: [(i % 4) * 1000 + Math.floor(i / 4) * 0.05, 0.5, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [0.3, 1, 0.3] }, physics: { body: 'static' } }));
    await sync.setWorld(world(entities));
    sync.root.updateMatrixWorld(true);
    sync.updateBatches();
    const spatial = sync.root.children.filter(o => o.name === 'aether:batch');
    const geometry = new T.SphereGeometry(0.5, 32, 24);
    const material = new T.MeshBasicMaterial({ color: 0x89aacc });
    for (const b of spatial) {
      b.geometry = geometry;
      b.material = material;
      b.computeBoundingSphere();
    }
    const global = new T.InstancedMesh(geometry, material, 1024);
    for (let i = 0; i < 1024; i++) global.setMatrixAt(i, sync.object(`p-${i}`).matrixWorld);
    sync.root.add(global);
    const scene = new T.Scene();
    scene.add(sync.root);
    const camera = new T.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(6, 3, 30);
    camera.lookAt(6, 0.5, 0);
    const renderer = new T.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(512, 512);
    const gl = renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) throw new Error('GPU timer extension unavailable; cannot infer GPU speed from submission counts');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const draw = label => {
      global.visible = label === 'global';
      for (const b of spatial) b.visible = label === 'spatial';
      renderer.render(scene, camera);
    };
    const pixels = () => {
      const out = new Uint8Array(512 * 512 * 4);
      gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    };
    draw('global');
    const reference = pixels();
    const globalTriangles = renderer.info.render.triangles;
    draw('spatial');
    const image = pixels();
    const spatialTriangles = renderer.info.render.triangles;
    let differences = 0, covered = 0;
    for (let i = 0; i < image.length; i++) if (image[i] !== reference[i]) differences++;
    for (let i = 0; i < image.length; i += 4) if (image[i] || image[i + 1] || image[i + 2]) covered++;
    for (let i = 0; i < 40; i++) draw(i % 2 ? 'spatial' : 'global');
    gl.finish();
    const samples = [];
    for (let i = 0; i < 48; i++) {
      // ABBA alternation reduces ordering bias.
      const label = i % 4 === 0 || i % 4 === 3 ? 'global' : 'spatial';
      const query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      const start = performance.now();
      draw(label);
      const cpuMs = performance.now() - start;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      samples.push({ label, query, cpuMs });
    }
    const deadline = performance.now() + 15000;
    while (samples.some(s => !gl.getQueryParameter(s.query, gl.QUERY_RESULT_AVAILABLE))) {
      if (performance.now() > deadline) throw new Error('GPU timer query timeout');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw new Error('Disjoint GPU timing; measurements invalid');
    const timing = {};
    for (const label of ['global', 'spatial']) {
      const own = samples.filter(s => s.label === label);
      const gpuTimes = own.map(s => gl.getQueryParameter(s.query, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b);
      const cpuTimes = own.map(s => s.cpuMs).sort((a, b) => a - b);
      timing[label] = { gpuMedianMs: gpuTimes[Math.floor(own.length / 2)], gpuP90Ms: gpuTimes[Math.floor(own.length * 0.9)], cpuMedianMs: cpuTimes[Math.floor(own.length / 2)], samples: own.length };
    }
    for (const s of samples) gl.deleteQuery(s.query);
    const error = gl.getError();
    renderer.dispose();
    global.dispose();
    sync.clear();
    geometry.dispose();
    material.dispose();
    return { gpu, globalTriangles, spatialTriangles, differences, covered, timing, error };
  }, repository);
  console.log(JSON.stringify(result, null, 2));
  if (result.differences || result.covered < 100 || result.error || result.spatialTriangles >= result.globalTriangles) process.exitCode = 1;
} finally {
  await browser.close();
}

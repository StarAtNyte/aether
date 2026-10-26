/** Compare finite BVH traversal against the prior unlimited traversal, with a checked source edit. */
import { chromium, firefox } from 'playwright';
const firefoxMode = process.env.AETHER_BENCH_BROWSER === 'firefox';
const browser = await (firefoxMode ? firefox.launch() : chromium.launch());
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (!firefoxMode) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.route('**/raycast-bvh.ts?range-reference', async route => {
    const response = await route.fetch(), body = await response.text();
    const pattern = /let limit = Infinity;[\s\S]*?const local = bvhNearest\([^;]+;/;
    if (!pattern.test(body)) throw new Error('Range reference edit no longer matches');
    await route.fulfill({ response, body: body.replace(pattern, 'const local = bvhNearest(tree, tree.positions, tree.index, _ray, material.side, _hit);') });
  });
  await page.route('**/bvh-range-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto((process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177') + '/bvh-range-probe');
  const cases = await page.evaluate(async root => {
    const T = await import(root + 'node_modules/three/build/three.module.js');
    const before = await import(root + 'packages/render/src/geometry/raycast-bvh.ts?range-reference');
    const after = await import(root + 'packages/render/src/geometry/raycast-bvh.ts');
    const geometry = new T.PlaneGeometry(40, 40, 256, 256), material = new T.MeshBasicMaterial({ side: T.DoubleSide }), mesh = new T.Mesh(geometry, material);
    before.triangleBvh(geometry); after.triangleBvh(geometry);
    const cases = [];
    try {
      for (const name of ['distant', 'visible', 'unlimited', 'mixed', 'sheared-distant']) {
        mesh.matrixWorld.identity();
        if (name === 'sheared-distant') mesh.matrixWorld.makeShear(.8, .4, .3, 0, 0, .2).premultiply(new T.Matrix4().makeScale(.3, 2, 1.5));
        const rays = [];
        for (let i = 0; i < 10000; i++) {
          const target = new T.Vector3((i % 31 - 15) * .5 + .123, (i % 29 - 14) * .5 + .456, 0).applyMatrix4(mesh.matrixWorld);
          const origin = target.clone().add(new T.Vector3(0, 0, name === 'visible' || name === 'unlimited' ? 10 : 1000));
          const far = name === 'unlimited' ? Infinity : name === 'visible' || (name === 'mixed' && i % 10 === 0) ? 2000 : 2;
          rays.push(new T.Raycaster(origin, target.clone().sub(origin).normalize(), 0, far));
        }
        const hits = [];
        function run(module) {
          let count = 0, checksum = 0;
          for (const ray of rays) { hits.length = 0; module.bvhRaycast.call(mesh, ray, hits); if (hits.length) { count++; checksum += hits[0].distance + hits[0].faceIndex; } }
          return { count, checksum };
        }
        const a = run(before), b = run(after);
        if (a.count !== b.count || a.checksum !== b.checksum) throw new Error('Range parity failed: ' + name);
        const times = { before: [], after: [] };
        for (let i = 0; i < 12; i++) {
          for (const key of i % 2 ? ['after', 'before'] : ['before', 'after']) { const start = performance.now(); run(key === 'before' ? before : after); times[key].push(performance.now() - start); }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        cases.push({ name, hits: a.count, exact: true, beforeMs: times.before.sort((a, b) => a - b)[6], afterMs: times.after.sort((a, b) => a - b)[6] });
      }
    } finally { geometry.dispose(); material.dispose(); }
    return cases;
  }, '/@fs' + process.cwd() + '/');
  console.log(JSON.stringify({ browser: firefoxMode ? 'firefox' : 'chromium', cpuRate: firefoxMode ? 1 : 4, errors, cases }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }

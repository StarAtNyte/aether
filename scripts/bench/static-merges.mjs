/**
 * Split-merge WebGL parity regression against individually drawn source meshes.
 * Run a studio dev server, then:
 * GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/static-merges.mjs
 * GEN_GPU unset uses SwiftShader. This checks rendering and buffer reuse, not FPS.
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
  await page.route('**/merge-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
  await page.goto(`${server}/merge-probe`);
  const result = await page.evaluate(async repository => {
    const root = '/@fs' + repository;
    const T = await import(root + 'node_modules/three/build/three.module.js');
    const { StaticMerges, MAX_MERGE_VERTICES } = await import(root + 'packages/render/src/sync/static-merges.ts');
    const { createEntityNode } = await import(root + 'packages/render/src/sync/entity-node.ts');
    const { world } = await import(root + 'packages/render/test/helpers.ts');
    const count = Math.floor(MAX_MERGE_VERTICES / 4) + 1;
    const geometry = new T.BufferGeometry();
    const positions = new Float32Array(count * 3);
    positions.set([0, 0, 0, 0.7, 0, 0, 0, 0.7, 0]);
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    const normals = new Float32Array(count * 3);
    for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
    geometry.setIndex([0, 1, 2]);
    const material = new T.MeshBasicMaterial({ color: 0x89aacc });
    const scene = new T.Scene();
    const doc = world(Array.from({ length: 9 }, (_, i) => ({ id: `p-${i}`, shape: { kind: 'procedural', generator: 'test-part' } })));
    const nodes = Object.values(doc.entities).map((entity, i) => {
      const node = createEntityNode(entity, false);
      node.object.position.x = i;
      node.object.updateMatrix();
      const mesh = new T.Mesh(geometry, material);
      node.content.add(mesh);
      node.bindings.push({ mesh, partMaterial: {}, hasColors: false, doubleSided: false, materialKey: 'shared', seeThrough: false, ownedMaterial: null });
      node.geometryKeys.push('shared');
      scene.add(node.object);
      return node;
    });
    scene.updateMatrixWorld(true);
    const camera = new T.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(4.5, 0.5, 12);
    camera.lookAt(4.5, 0.5, 0);
    const renderer = new T.WebGLRenderer({ canvas: document.querySelector('canvas'), preserveDrawingBuffer: true, antialias: false });
    renderer.setSize(256, 256);
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const read = () => {
      renderer.render(scene, camera);
      const pixels = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const differences = (a, b) => {
      let count = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
      return count;
    };
    const original = read();
    const merges = new StaticMerges();
    merges.rebuild(nodes);
    const initialCount = merges.count;
    const mergedDifference = differences(original, read());
    const retained = merges.rebuild(nodes) === false;
    // The last partition becomes an undersized tail: its remaining two members must draw standalone.
    nodes[8].object.removeFromParent();
    merges.rebuild(nodes.slice(0, 8));
    const afterRemoval = read();
    const mergedTriangles = renderer.info.render.triangles;
    merges.clear();
    const standalone = read();
    let covered = 0;
    for (let i = 0; i < standalone.length; i += 4) if (standalone[i] || standalone[i + 1] || standalone[i + 2]) covered++;
    const tailDifference = differences(afterRemoval, standalone);
    const error = gl.getError();
    renderer.dispose();
    geometry.dispose();
    material.dispose();
    return { gpu, vertices: count * 9, initialCount, retained, mergedDifference, mergedTriangles, tailDifference, covered, error };
  }, repository);
  console.log(JSON.stringify(result, null, 2));
  if (result.initialCount !== 3 || !result.retained || result.mergedDifference || result.tailDifference || result.mergedTriangles !== 8 || result.covered < 100 || result.error) process.exitCode = 1;
} finally {
  await browser.close();
}

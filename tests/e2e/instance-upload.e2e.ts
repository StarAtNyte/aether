/** Small hardware check of three's instance-buffer updates; no studio or heavy world is loaded. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome } from './support/env';

const files = new Map([
  ['/three.webgpu.js', join(process.cwd(), 'node_modules/three/build/three.webgpu.js')],
  ['/three.core.js', join(process.cwd(), 'node_modules/three/build/three.core.js')],
]);
const server = createServer((req, res) => {
  const file = files.get(req.url ?? '');
  if (!file) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html>'); return; }
  void readFile(file).then(data => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(data); }, () => { res.writeHead(404); res.end(); });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('no test server address');
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: [...CHROME_ARGS] });
try {
  const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
  await page.addInitScript({ content: 'globalThis.__name = (fn) => fn;' });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const result = await page.evaluate(async (useWebgpu) => {
    // @ts-expect-error Served from the local test server, not resolved by TypeScript.
    const t = await import('/three.webgpu.js');
    const renderer = new t.WebGPURenderer({ forceWebGL: !useWebgpu, antialias: false });
    await renderer.init();
    renderer.setSize(128, 128);
    const scene = new t.Scene();
    const camera = new t.PerspectiveCamera(45, 1, 0.1, 50);
    camera.position.z = 5;
    const geometry = new t.BoxGeometry();
    const material = new t.MeshBasicMaterial({ color: 0xff5522 });
    // Exceed the uniform-buffer path so the matrices use GPU vertex buffers.
    const mesh = new t.InstancedMesh(geometry, material, 2048);
    const dynamic = new t.InstancedMesh(geometry, material, 2048);
    dynamic.instanceMatrix.setUsage(t.DynamicDrawUsage);
    const matrix = new t.Matrix4();
    for (const item of [mesh, dynamic]) {
      for (let i = 2; i < item.count; i++) item.setMatrixAt(i, matrix.makeTranslation(1000, 1000, 1000));
      item.setMatrixAt(0, matrix.makeTranslation(-0.7, 0, 0));
      item.setMatrixAt(1, matrix.makeTranslation(0.7, 0, 0));
      item.instanceMatrix.needsUpdate = true;
      item.frustumCulled = false;
      scene.add(item);
    }
    dynamic.visible = false;
    const target = new t.RenderTarget(128, 128);
    renderer.setRenderTarget(target);
    let uploads = 0;
    let tracked = mesh.instanceMatrix.array;
    const backend = renderer.backend;
    const gl = backend.gl as WebGL2RenderingContext | undefined;
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu = gl ? (debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))) : 'WebGPU';
    const actualWebgpu = backend.isWebGPUBackend === true;
    if (useWebgpu !== actualWebgpu) throw new Error(`Unexpected backend: ${gpu}`);
    const original = backend.updateAttribute;
    backend.updateAttribute = function (attribute: unknown) {
      const a = attribute as { array?: unknown; data?: { array?: unknown } };
      if ((a.data?.array ?? a.array) === tracked) uploads++;
      return original.call(this, attribute);
    };
    const pixels = async (): Promise<Uint8Array> => renderer.readRenderTargetPixelsAsync(target, 0, 0, 128, 128);
    renderer.render(scene, camera);
    await pixels();
    uploads = 0;
    for (let i = 0; i < 3; i++) renderer.render(scene, camera);
    const staticUploads = uploads;
    const staticPixels = await pixels();
    mesh.visible = false;
    dynamic.visible = true;
    tracked = dynamic.instanceMatrix.array;
    renderer.render(scene, camera);
    await pixels();
    uploads = 0;
    for (let i = 0; i < 3; i++) renderer.render(scene, camera);
    const dynamicUploads = uploads;
    const dynamicPixels = await pixels();
    dynamic.visible = false;
    mesh.visible = true;
    tracked = mesh.instanceMatrix.array;
    mesh.setMatrixAt(1, matrix.makeTranslation(0, 0.8, 0));
    mesh.instanceMatrix.needsUpdate = true;
    uploads = 0;
    renderer.render(scene, camera);
    const changedUploads = uploads;
    const changedPixels = await pixels();
    dynamic.visible = true;
    mesh.visible = false;
    dynamic.setMatrixAt(1, matrix.makeTranslation(0, 0.8, 0));
    dynamic.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    const changedDynamicPixels = await pixels();
    const same = staticPixels.every((value: number, i: number) => value === dynamicPixels[i]);
    const changed = staticPixels.some((value: number, i: number) => value !== changedPixels[i]);
    const sameChanged = changedPixels.every((value: number, i: number) => value === changedDynamicPixels[i]);
    // Capture may update an instance between two renders in the same node frame.
    mesh.visible = true;
    dynamic.visible = false;
    renderer.render(scene, camera);
    mesh.setMatrixAt(1, matrix.makeTranslation(0, -0.8, 0));
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    const immediateStatic = await pixels();
    mesh.visible = false;
    dynamic.visible = true;
    renderer.render(scene, camera);
    dynamic.setMatrixAt(1, matrix.makeTranslation(0, -0.8, 0));
    dynamic.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    const immediateDynamic = await pixels();
    const cachedUpdate = backend.updateAttribute;
    backend.updateAttribute = original;
    renderer.render(scene, camera);
    const immediateUncached = await pixels();
    backend.updateAttribute = cachedUpdate;
    const sameImmediateDynamic = immediateDynamic.every((value: number, i: number) => value === immediateUncached[i]);
    const sameImmediate = immediateStatic.every((value: number, i: number) => value === immediateDynamic[i]);
    mesh.visible = true;
    dynamic.visible = false;
    renderer._nodes.nodeFrame.update();
    renderer.render(scene, camera);
    const nextFrame = await pixels();
    const sameNextFrame = nextFrame.every((value: number, i: number) => value === immediateDynamic[i]);
    target.dispose(); geometry.dispose(); material.dispose(); await renderer.dispose();
    const nextIsOld = nextFrame.every((value: number, i: number) => value === changedPixels[i]);
    const immediateIsOld = immediateStatic.every((value: number, i: number) => value === changedPixels[i]);
    return { gpu, staticUploads, dynamicUploads, changedUploads, same, changed, sameChanged, sameImmediateDynamic, sameImmediate, sameNextFrame, nextIsOld, immediateIsOld };
  }, process.argv.includes('--webgpu'));
  if (result.staticUploads !== 0 || result.dynamicUploads < 3 || result.changedUploads !== 1 || !result.same || !result.changed || !result.sameChanged || !result.sameImmediateDynamic) throw new Error(JSON.stringify(result));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const particles = await page.evaluate(async (useWebgpu) => {
    // @ts-expect-error Served by this test.
    const t = await import('/three.webgpu.js');
    const renderer = new t.WebGPURenderer({ forceWebGL: !useWebgpu, antialias: false });
    await renderer.init();
    renderer.setSize(128, 128);
    const scene = new t.Scene();
    const camera = new t.PerspectiveCamera(45, 1, 0.1, 50);
    camera.position.z = 5;
    const base = new t.PlaneGeometry(1, 1);
    const material = new t.MeshBasicNodeMaterial({ color: 0xff5522 });
    material.positionNode = t.TSL.positionGeometry.add(t.TSL.attribute('aOrigin', 'vec4').xyz);
    function make(dynamic: boolean) {
      const geometry = new t.InstancedBufferGeometry();
      geometry.index = base.index;
      geometry.setAttribute('position', base.getAttribute('position'));
      geometry.instanceCount = 1;
      const attribute = new t.InstancedBufferAttribute(new Float32Array([-0.7, 0, 0, 1]), 4);
      if (dynamic) attribute.setUsage(t.DynamicDrawUsage);
      geometry.setAttribute('aOrigin', attribute);
      const mesh = new t.Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, geometry, attribute };
    }
    const a = make(false), b = make(true);
    b.mesh.visible = false;
    const target = new t.RenderTarget(128, 128);
    renderer.setRenderTarget(target);
    const backend = renderer.backend;
    const original = backend.updateAttribute;
    let tracked = a.attribute.array, uploads = 0;
    backend.updateAttribute = function (attribute: { array?: unknown; data?: { array?: unknown } }) {
      if ((attribute.data?.array ?? attribute.array) === tracked) uploads++;
      return original.call(this, attribute);
    };
    const pixels = async (): Promise<Uint8Array> => renderer.readRenderTargetPixelsAsync(target, 0, 0, 128, 128);
    renderer.render(scene, camera); await pixels(); uploads = 0;
    for (let i = 0; i < 3; i++) renderer.render(scene, camera);
    const staticUploads = uploads;
    const initial = await pixels();
    a.mesh.visible = false; b.mesh.visible = true; tracked = b.attribute.array;
    renderer.render(scene, camera); await pixels(); uploads = 0;
    for (let i = 0; i < 3; i++) renderer.render(scene, camera);
    const dynamicUploads = uploads;
    const dynamicInitial = await pixels();
    a.mesh.visible = true; b.mesh.visible = false; tracked = a.attribute.array;
    renderer.render(scene, camera);
    a.attribute.array[0] = 0.7; a.attribute.needsUpdate = true; uploads = 0;
    renderer.render(scene, camera);
    const changedUploads = uploads;
    const changed = await pixels();
    a.mesh.visible = false; b.mesh.visible = true;
    renderer.render(scene, camera);
    b.attribute.array[0] = 0.7; b.attribute.needsUpdate = true;
    renderer.render(scene, camera);
    const dynamicChanged = await pixels();
    const sameInitial = initial.every((value: number, i: number) => value === dynamicInitial[i]);
    const imageChanged = initial.some((value: number, i: number) => value !== changed[i]);
    const sameChanged = changed.every((value: number, i: number) => value === dynamicChanged[i]);
    target.dispose(); a.geometry.dispose(); b.geometry.dispose(); base.dispose(); material.dispose(); await renderer.dispose();
    return { staticUploads, dynamicUploads, changedUploads, sameInitial, imageChanged, sameChanged };
  }, process.argv.includes('--webgpu'));
  if (particles.staticUploads !== 0 || particles.dynamicUploads < 3 || particles.changedUploads !== 1 || !particles.sameInitial || !particles.imageChanged || !particles.sameChanged) throw new Error(`particle attributes: ${JSON.stringify(particles)}`);
  process.stdout.write(`particle attributes: ${JSON.stringify(particles)}\n`);
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

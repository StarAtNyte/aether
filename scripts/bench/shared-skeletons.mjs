/** Skinned palette sharing: WebGL pixel parity and texture uploads across independently animated actors. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const server = process.env.AETHER_BENCH_URL ?? 'http://localhost:5176';
const backend = process.env.AETHER_BENCH_BACKEND ?? 'classic';
if (!['classic', 'webgl2'].includes(backend)) throw new Error('AETHER_BENCH_BACKEND must be classic or webgl2');
const browser = await chromium.launch({ args: process.env.GEN_GPU === 'intel'
  ? ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.route('**/skin-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
  await page.goto(`${server}/skin-probe`);
  const result = await page.evaluate(async ({ repository, backend }) => {
    const root = '/@fs' + repository;
    const T = await import(root + 'node_modules/three/build/three.module.js');
    const { clone } = await import(root + 'node_modules/three/examples/jsm/utils/SkeletonUtils.js');
    const { cloneModel, disposeModelInstance, shareSkeletons } = await import(root + 'packages/render/src/geometry/model-loader.ts');
    const source = new T.Group();
    const hip = new T.Bone(), arm = new T.Bone();
    hip.name = 'hip'; arm.name = 'arm';
    arm.position.y = 1;
    hip.add(arm); source.add(hip); source.updateMatrixWorld(true);
    const geometries = [], materials = [];
    for (let part = 0; part < 3; part++) {
      const geometry = new T.BoxGeometry(0.5, 1.5, 0.5).translate((part - 1) * 0.65, 0.75, 0);
      const count = geometry.getAttribute('position').count;
      const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        indices[i * 4] = geometry.getAttribute('position').getY(i) > 0.75 ? 1 : 0;
        weights[i * 4] = 1;
      }
      geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
      const material = new T.MeshBasicMaterial({ color: [0x89aacc, 0xccaa89, 0x99cc88][part] });
      const mesh = new T.SkinnedMesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.bind(new T.Skeleton([hip, arm]), new T.Matrix4());
      source.add(mesh); geometries.push(geometry); materials.push(material);
    }
    const baseline = new T.Scene(), optimized = new T.Scene();
    const beforeActors = [], afterActors = [];
    for (let actor = 0; actor < 2; actor++) {
      const before = clone(source), after = clone(source);
      before.position.x = after.position.x = actor === 0 ? -1.6 : 1.6;
      shareSkeletons(after);
      baseline.add(before); optimized.add(after);
      beforeActors.push(before); afterActors.push(after);
    }
    const skeletons = scene => {
      const out = new Set();
      scene.traverse(o => { if (o.isSkinnedMesh) out.add(o.skeleton); });
      return out;
    };
    const beforeSkeletons = skeletons(baseline), afterSkeletons = skeletons(optimized);
    const options = { canvas: document.querySelector('canvas'), preserveDrawingBuffer: true, antialias: false };
    let renderer;
    if (backend === 'webgl2') {
      const { WebGPURenderer } = await import(root + 'node_modules/three/build/three.webgpu.js');
      renderer = new WebGPURenderer({ ...options, forceWebGL: true });
      await renderer.init();
    } else renderer = new T.WebGLRenderer(options);
    renderer.setSize(256, 256);
    const camera = new T.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 2, 9); camera.lookAt(0, 0.8, 0);
    const gl = backend === 'webgl2' ? renderer.backend.gl : renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    renderer.render(baseline, camera); renderer.render(optimized, camera);
    let uploads = 0;
    const upload = gl.texSubImage2D.bind(gl);
    gl.texSubImage2D = (...args) => { uploads++; return upload(...args); };
    const pixels = () => {
      const data = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    };
    let beforeUpdates = 0, afterUpdates = 0;
    for (const skeleton of beforeSkeletons) {
      const update = skeleton.update.bind(skeleton);
      skeleton.update = () => { beforeUpdates++; return update(); };
    }
    for (const skeleton of afterSkeletons) {
      const update = skeleton.update.bind(skeleton);
      skeleton.update = () => { afterUpdates++; return update(); };
    }
    let differences = 0, beforeUploads = 0, afterUploads = 0, covered = 0;
    for (let frame = 1; frame <= 6; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      for (let actor = 0; actor < 2; actor++) for (const actors of [beforeActors, afterActors]) {
        actors[actor].getObjectByName('arm').rotation.z = Math.sin(frame * 0.3 + actor * 1.7) * 0.65;
        actors[actor].getObjectByName('hip').position.y = Math.sin(frame * 0.2 + actor) * 0.2;
      }
      uploads = 0; renderer.render(baseline, camera); beforeUploads += uploads;
      const reference = pixels();
      uploads = 0; renderer.render(optimized, camera); afterUploads += uploads;
      const actual = pixels();
      for (let i = 0; i < actual.length; i++) if (actual[i] !== reference[i]) differences++;
      if (frame === 6) for (let i = 0; i < actual.length; i += 4) if (actual[i] || actual[i + 1] || actual[i + 2]) covered++;
    }
    const poseBeforeUpdates = beforeUpdates, poseAfterUpdates = afterUpdates;
    let uniformCache = null;
    if (backend === 'webgl2') {
      const { cacheUniformUploads } = await import(root + 'packages/render/src/gpu/buffer-uploads.ts');
      const nativeUpdate = renderer.backend.updateBinding;
      cacheUniformUploads(renderer.backend);
      const cachedUpdate = renderer.backend.updateBinding;
      let writes = 0;
      const data = gl.bufferData.bind(gl), sub = gl.bufferSubData.bind(gl);
      gl.bufferData = (...args) => { if (args[0] === gl.UNIFORM_BUFFER) writes++; return data(...args); };
      gl.bufferSubData = (...args) => { if (args[0] === gl.UNIFORM_BUFFER) writes++; return sub(...args); };
      const nativeWrites = [], cachedWrites = [];
      let pixelDifferences = 0;
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        afterActors[0].getObjectByName('arm').rotation.z = frame < 6 ? frame * 0.1 : 0.5;
        camera.position.x = frame * 0.01;
        renderer.backend.updateBinding = nativeUpdate;
        writes = 0; renderer.render(optimized, camera); nativeWrites.push(writes);
        const reference = pixels();
        renderer.backend.updateBinding = cachedUpdate;
        writes = 0; renderer.render(optimized, camera); cachedWrites.push(writes);
        const actual = pixels();
        for (let i = 0; i < actual.length; i++) if (actual[i] !== reference[i]) pixelDifferences++;
      }
      uniformCache = { nativeWrites, cachedWrites, pixelDifferences };
      if (pixelDifferences || cachedWrites[11] >= nativeWrites[11]) throw new Error('Uniform cache regression');
    }
    let bindingKeys = null;
    if (backend === 'webgl2') {
      const { cacheUniformBindingKeys } = await import(root + 'packages/render/src/gpu/uniform-binding-keys.ts');
      const state = renderer.backend.state;
      let binds = 0;
      const bind = gl.bindBufferBase.bind(gl);
      gl.bindBufferBase = (...args) => { binds++; return bind(...args); };
      state.currentBoundBufferBases = {};
      binds = 0; renderer.render(optimized, camera);
      const formerBinds = binds, reference = pixels();
      cacheUniformBindingKeys(renderer.backend);
      state.currentBoundBufferBases = {};
      binds = 0; renderer.render(optimized, camera);
      const cachedBinds = binds, actual = pixels();
      let pixelDifferences = 0;
      for (let i = 0; i < actual.length; i++) if (actual[i] !== reference[i]) pixelDifferences++;
      bindingKeys = { formerBinds, cachedBinds, pixelDifferences };
      if (pixelDifferences || formerBinds !== cachedBinds || formerBinds === 0) throw new Error('Binding-key cache regression');
    }
    for (const skeleton of [...beforeSkeletons, ...afterSkeletons]) skeleton.dispose();
    let lifecycle = null;
    {
      for (const scene of [baseline, optimized]) scene.traverse(o => { if (o.isMesh) o.dispatchEvent({ type: 'dispose' }); });
      const liveBuffers = new Set();
      const createBuffer = gl.createBuffer.bind(gl), deleteBuffer = gl.deleteBuffer.bind(gl);
      gl.createBuffer = () => { const buffer = createBuffer(); if (buffer) liveBuffers.add(buffer); return buffer; };
      gl.deleteBuffer = buffer => { liveBuffers.delete(buffer); return deleteBuffer(buffer); };
      const drawObjects = () => backend === 'webgl2' ? renderer._objects._renderObjects.size : null;
      const texture = new T.DataTexture(new Uint8Array(16).fill(255), 2, 2);
      texture.needsUpdate = true;
      let sourceDisposals = 0;
      texture.addEventListener('dispose', () => sourceDisposals++);
      for (const material of materials) { material.map = texture; material.needsUpdate = true; }
      const cycleScene = new T.Scene();
      const anchor = new T.Mesh(geometries[0], materials[0]);
      anchor.position.x = -3;
      cycleScene.add(anchor);
      renderer.render(cycleScene, camera);
      const baseImage = pixels();
      const baseTextures = renderer.info.memory.textures;
      const baseDrawObjects = drawObjects();
      const formerCounts = [], releasedCounts = [], formerRoots = [];
      const formerDrawObjects = [], releasedDrawObjects = [], formerBuffers = [], releasedBuffers = [];
      let lifecycleDifferences = 0;
      const cycle = (release, model = source) => {
        const wrapper = new T.Group();
        for (let actor = 0; actor < 2; actor++) {
          const instance = cloneModel(model);
          instance.position.x = actor ? 1.5 : -1.5;
          wrapper.add(instance);
        }
        cycleScene.add(wrapper);
        renderer.render(cycleScene, camera);
        wrapper.removeFromParent();
        if (release) { disposeModelInstance(wrapper); disposeModelInstance(wrapper); }
        else formerRoots.push(wrapper);
        renderer.render(cycleScene, camera);
        const image = pixels();
        for (let i = 0; i < image.length; i++) if (image[i] !== baseImage[i]) lifecycleDifferences++;
        return renderer.info.memory.textures;
      };
      for (let i = 0; i < 5; i++) {
        formerCounts.push(cycle(false));
        formerDrawObjects.push(drawObjects());
        formerBuffers.push(liveBuffers.size);
      }
      for (const wrapper of formerRoots) disposeModelInstance(wrapper);
      renderer.render(cycleScene, camera);
      const baseBuffers = liveBuffers.size;
      for (let i = 0; i < 5; i++) {
        releasedCounts.push(cycle(true));
        releasedDrawObjects.push(drawObjects());
        releasedBuffers.push(liveBuffers.size);
      }
      const staticSource = new T.Group();
      for (let part = 0; part < 3; part++) staticSource.add(new T.Mesh(geometries[part], materials[part]));
      cycle(true, staticSource);
      const staticBaseBuffers = liveBuffers.size;
      const staticDrawObjects = [], staticBuffers = [];
      for (let i = 0; i < 5; i++) {
        cycle(true, staticSource);
        staticDrawObjects.push(drawObjects());
        staticBuffers.push(liveBuffers.size);
      }
      lifecycle = { baseTextures, formerCounts, releasedCounts, baseDrawObjects, formerDrawObjects, releasedDrawObjects, baseBuffers, formerBuffers, releasedBuffers, staticBaseBuffers, staticDrawObjects, staticBuffers, sourceDisposals, differences: lifecycleDifferences };
      texture.dispose();
    }
    const error = gl.getError();
    renderer.dispose();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    return { uniformCache, bindingKeys, gpu, backend, beforeSkeletons: beforeSkeletons.size, afterSkeletons: afterSkeletons.size, beforeUpdates: poseBeforeUpdates, afterUpdates: poseAfterUpdates, beforeUploads, afterUploads, differences, covered, lifecycle, error };
  }, { repository, backend });
  console.log(JSON.stringify(result, null, 2));
  if (result.lifecycle) {
    const l = result.lifecycle;
    const controlFailed = backend === 'classic'
      ? l.formerCounts.some((count, i) => count !== l.baseTextures + (i + 1) * 2)
      : l.formerDrawObjects.some((count, i) => count !== l.baseDrawObjects + (i + 1) * 6);
    if (controlFailed || l.releasedCounts.some(count => count !== l.baseTextures)
      || l.releasedDrawObjects.some(count => count !== l.baseDrawObjects)
      || l.releasedBuffers.some(count => count !== l.baseBuffers)
      || l.staticDrawObjects.some(count => count !== l.baseDrawObjects)
      || l.staticBuffers.some(count => count !== l.staticBaseBuffers) || l.sourceDisposals || l.differences) process.exitCode = 1;
  }
  if (result.beforeSkeletons !== 6 || result.afterSkeletons !== 2 || result.afterUpdates >= result.beforeUpdates || (result.beforeUploads > 0 && result.afterUploads >= result.beforeUploads) || result.differences || result.covered < 100 || result.error) process.exitCode = 1;
} finally {
  await browser.close();
}

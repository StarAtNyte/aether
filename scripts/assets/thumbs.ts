/**
 * Render library thumbnails (192 px WebP, transparent background, three-
 * quarter view, neutral studio lighting) in one headless Chromium and
 * record them in `assets/catalog.json`. Only missing thumbnails are
 * rendered unless `--force` is passed.
 *
 *   npm run assets:thumbs [-- --force] [-- --only id1,id2]
 *
 * `--front=<dir>` instead writes a straight-on view from +Z (the way a prop's front must face) of the models
 * named by `--only` to `<dir>/<id>.webp` and leaves the catalog alone: used to check a model's orientation
 * (`--yaw=90` looks from +X, 180 from the back, 270 from -X).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Catalog } from '../../packages/assets/src/schema';
import { withBrowserPage } from './browser';

const ROOT = resolve(import.meta.dirname, '../..');
const LIB = join(ROOT, 'assets', 'lib');
const CATALOG = join(ROOT, 'assets', 'catalog.json');
const SIZE = 192;

const force = process.argv.includes('--force');
const onlyArg = process.argv.find((a, i) => process.argv[i - 1] === '--only');
const frontArg = process.argv.find((a) => a.startsWith('--front='))?.slice(8);
const yaw = Number(process.argv.find((a) => a.startsWith('--yaw='))?.slice(6) ?? 0);
const only = onlyArg ? new Set(onlyArg.split(',')) : null;

/** Page-side renderer, installed once as `window.__thumb`. */
const SETUP = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const SIZE = ${SIZE};
const canvas = document.createElement('canvas');
canvas.width = SIZE; canvas.height = SIZE;
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const hdr = new HDRLoader();
function encode() {
  return canvas.toDataURL('image/webp', 0.86).split(',')[1];
}
window.__thumb = {
  async model(url, idle, back, front) {
    const gltf = await loader.loadAsync(url);
    const scene = new THREE.Scene();
    scene.environment = envTex;
    scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xfff4e8, 1.5);
    key.position.set(3, 6, 4);
    scene.add(key, new THREE.HemisphereLight(0xdfe8ff, 0x6b665e, 0.35));
    const root = gltf.scene;
    scene.add(root);
    if (idle && gltf.animations.length) {
      const clip = gltf.animations.find((c) => c.name === idle) ?? gltf.animations[0];
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      mixer.update(0.4);
    }
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 5000);
    const dir = front !== false ? new THREE.Vector3(Math.sin(front * Math.PI / 180), 0.22, Math.cos(front * Math.PI / 180)).normalize() : new THREE.Vector3(1, 0.72, back ? -1.35 : 1.35).normalize();
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(28 / 2)) * 1.04;
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    cam.lookAt(sphere.center);
    cam.near = dist / 100; cam.far = dist * 4; cam.updateProjectionMatrix();
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    const out = encode();
    root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); } } });
    return out;
  },
  async hdri(url) {
    const tex = await hdr.loadAsync(url);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const scene = new THREE.Scene();
    scene.background = tex;
    const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 10);
    cam.lookAt(new THREE.Vector3(0, 0.18, -1));
    renderer.render(scene, cam);
    const out = encode();
    tex.dispose();
    return out;
  },
};
window.__thumbReady = true;
`;

/** Delete thumbnails no catalog entry references (left behind by rebuilt models). */
function removeOrphans(catalog: Catalog): void {
  const keep = new Set(catalog.entries.map((e) => e.thumb).filter((t): t is string => !!t));
  for (const f of readdirSync(join(LIB, 't'))) if (!keep.has(`t/${f}`)) unlinkSync(join(LIB, 't', f));
}

async function main(): Promise<void> {
  const catalog = Catalog.parse(JSON.parse(readFileSync(CATALOG, 'utf8')));
  const todo = catalog.entries.filter((e) => e.file && (frontArg || force || !e.thumb || !existsSync(join(LIB, e.thumb))) && (!only || only.has(e.id)));
  if (todo.length === 0) {
    removeOrphans(catalog);
    console.log('all thumbnails present');
    return;
  }
  mkdirSync(join(LIB, 't'), { recursive: true });
  await withBrowserPage(async (page) => {
    await page.addScriptTag({ type: 'module', content: SETUP });
    await page.waitForFunction(() => (window as unknown as { __thumbReady?: boolean }).__thumbReady === true, undefined, { timeout: 30_000 });
    if (frontArg) mkdirSync(frontArg, { recursive: true });
    for (const e of todo) {
      const url = `/lib/${e.file}`;
      const b64 = e.kind === 'hdri'
        ? await page.evaluate((u) => (window as unknown as { __thumb: { hdri(u: string): Promise<string> } }).__thumb.hdri(u), url)
        : await page.evaluate(([u, idle, back, front]) => (window as unknown as { __thumb: { model(u: string, i: string | null, b: boolean, f: number | false): Promise<string> } }).__thumb.model(u, idle, back, front), [url, e.anims?.idle ?? null, e.facing === '-z', frontArg ? yaw : false] as const);
      const data = Buffer.from(b64, 'base64');
      if (frontArg) {
        writeFileSync(join(frontArg, `${e.id}.webp`), data);
        continue;
      }
      const h = createHash('sha256').update(data).digest('hex').slice(0, 8);
      const rel = `t/${e.id}.${h}.webp`;
      if (e.thumb && e.thumb !== rel && existsSync(join(LIB, e.thumb))) unlinkSync(join(LIB, e.thumb));
      writeFileSync(join(LIB, rel), data);
      e.thumb = rel;
      process.stdout.write(`${e.id} ${data.byteLength} B\n`);
    }
  });
  if (frontArg) {
    console.log(`${todo.length} front views in ${frontArg}`);
    return;
  }
  writeFileSync(CATALOG, `${JSON.stringify(Catalog.parse(catalog))}\n`);
  removeOrphans(catalog);
  console.log(`${todo.length} thumbnails rendered`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});

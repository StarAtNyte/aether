/** The page-side thumbnail renderer shared by `thumbs.ts` (library) and `simready-bulk.ts` (hub batches). */
export const THUMB_SIZE = 192;

/** Page-side renderer, installed once as `window.__thumb`. */
export const SETUP = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const SIZE = ${THUMB_SIZE};
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


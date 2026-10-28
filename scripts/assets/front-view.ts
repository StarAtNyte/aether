/** Page-side renderer of the front check: four turns of one model about Y as a labelled 2x2 contact image (installed as `window.__views`). */
export const TILE = 384;

export const VIEWS_SETUP = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const T = ${TILE};
const glc = document.createElement('canvas');
glc.width = T; glc.height = T;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(T, T, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xe4e4e4, 1);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const out = document.createElement('canvas');
out.width = out.height = 2 * T;
const ctx = out.getContext('2d');
window.__views = {
  async contact(url, angles, labels) {
    const gltf = await loader.loadAsync(url);
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    const key = new THREE.DirectionalLight(0xfff4e8, 1.4);
    key.position.set(3, 6, 5);
    scene.add(key, new THREE.HemisphereLight(0xdfe8ff, 0x6b665e, 0.4));
    const root = gltf.scene;
    const pivot = new THREE.Group();
    pivot.add(root);
    scene.add(pivot);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const rad = Math.max(0.05, Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), Math.max(Math.abs(box.min.z), Math.abs(box.max.z))));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(rad * 1.9, 48), new THREE.MeshBasicMaterial({ color: 0xc4c4c4 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002;
    scene.add(floor);
    // The +Z arrow lies on the floor in front of the model and points at the viewer.
    const sh = new THREE.Shape();
    const L = rad * 0.6, W = rad * 0.22;
    sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(W / 2, L * 0.55); sh.lineTo(W, L * 0.55); sh.lineTo(0, L); sh.lineTo(-W, L * 0.55); sh.lineTo(-W / 2, L * 0.55); sh.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0xd62020, side: THREE.DoubleSide }));
    arrow.rotation.x = Math.PI / 2; // shape +y becomes world +z
    arrow.position.set(0, 0.002, rad * 1.1);
    scene.add(arrow);
    const all = new THREE.Box3().setFromObject(root, true);
    all.expandByPoint(new THREE.Vector3(0, 0, rad * 1.1 + L)).expandByPoint(new THREE.Vector3(0, 0, -rad));
    const sphere = all.getBoundingSphere(new THREE.Sphere());
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 5000);
    const yaw = 22 * Math.PI / 180, el = 24 * Math.PI / 180;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    cam.lookAt(sphere.center);
    cam.near = dist / 100; cam.far = dist * 4; cam.updateProjectionMatrix();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 2 * T, 2 * T);
    for (let i = 0; i < 4; i++) {
      pivot.rotation.y = angles[i] * Math.PI / 180;
      renderer.render(scene, cam);
      const x = (i % 2) * T, y = Math.floor(i / 2) * T;
      ctx.drawImage(glc, x, y);
      ctx.fillStyle = 'rgba(20,20,20,0.85)'; ctx.fillRect(x + 8, y + 8, 44, 44);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], x + 30, y + 31);
      ctx.fillStyle = '#b01818'; ctx.font = '13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('red arrow = +Z, toward the viewer', x + 8, y + T - 10);
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(T, 0); ctx.lineTo(T, 2 * T); ctx.moveTo(0, T); ctx.lineTo(2 * T, T); ctx.stroke();
    const png = out.toDataURL('image/png').split(',')[1];
    root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); } } });
    return png;
  },
};
window.__viewsReady = true;
`;

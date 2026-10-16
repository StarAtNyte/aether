/**
 * Contact sheet of GLB models (dev tool for model authoring): each model in a three-quarter and a side view under
 * image-based light, rendered in a real browser.
 *
 *   npx tsx scripts/assets/model-sheet.ts <out.png> <a.glb> [b.glb ...]
 *
 * `--views=34,side,front,back,top` picks the views per model (default 34,side). The GLB files may be anywhere
 * readable; they are served from one throw-away loopback server that only serves them and `three`.
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, REPO_ROOT } from '../../tests/e2e/support/env';

const args = process.argv.slice(2);
const views = (args.find((a) => a.startsWith('--views='))?.slice(8) ?? '34,side').split(',');
/** `--clip=name` poses every model in that clip at `--t=seconds` (default 0.25). */
const clip = args.find((a) => a.startsWith('--clip='))?.slice(7) ?? '';
const clipTime = Number(args.find((a) => a.startsWith('--t='))?.slice(4) ?? '0.25');
const [out, ...files] = args.filter((a) => !a.startsWith('--')).map((a) => resolve(a));
if (!out || files.length === 0) throw new Error('usage: model-sheet <out.png> <a.glb> ...');

const HTML = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#222}canvas{display:block}</style><canvas id=c></canvas>
<script type=importmap>{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type=module>
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
window.render = async (spec) => {
  const {urls, views, tw, th, clip, clipTime} = spec;
  const cols = views.length, rows = urls.length;
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true});
  renderer.setPixelRatio(1); renderer.setSize(cols*tw, rows*th); renderer.setScissorTest(true);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aa6b2); scene.environment = env; scene.environmentIntensity = 0.9;
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.6); sun.position.set(4, 6, 3); sun.castShadow = true; sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera, {left:-5,right:5,top:5,bottom:-5,near:0.5,far:20}); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60,60), new THREE.MeshStandardMaterial({color:0x5d5f5c, roughness:0.95})); floor.rotation.x=-Math.PI/2; floor.receiveShadow = true; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(26, tw/th, 0.1, 80);
  const info = [];
  for (let r=0;r<rows;r++) {
    const g = await loader.loadAsync(urls[r]);
    const root = g.scene;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(root);
    if (clip) { const c = g.animations.find(a => a.name === clip); if (c) { const mixer = new THREE.AnimationMixer(root); const act = mixer.clipAction(c); act.play(); mixer.setTime(clipTime); } }
    root.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    info.push({size:[s.x,s.y,s.z].map(v=>+v.toFixed(2)), min:+box.min.y.toFixed(3)});
    const R = Math.max(s.x, s.y, s.z) * 0.5;
    const dist = R / Math.tan(THREE.MathUtils.degToRad(13)) * 1.0;
    for (let v=0; v<cols; v++) {
      const name = views[v];
      // The model faces -Z.
      const dir = name === 'side' ? new THREE.Vector3(1,0.1,0) : name === 'front' ? new THREE.Vector3(0,0.12,-1) : name === 'back' ? new THREE.Vector3(0,0.12,1) : name === 'top' ? new THREE.Vector3(0.02,1,0.25) : name === 'low' ? new THREE.Vector3(0.9,0.05,-0.9) : new THREE.Vector3(0.75,0.34,-0.8);
      cam.position.copy(c).addScaledVector(dir.normalize(), dist); cam.lookAt(c);
      const x = v*tw, y = (rows-1-r)*th;
      renderer.setViewport(x,y,tw,th); renderer.setScissor(x,y,tw,th);
      renderer.render(scene, cam);
    }
    scene.remove(root);
  }
  return info;
};
</script>`;

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };

async function main(): Promise<void> {
  const served = new Map(files.map((f, i) => [`/m/${i}-${basename(f)}`, f]));
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0] as string);
    if (url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(HTML);
      return;
    }
    const m = served.get(url);
    const f = m ?? resolve(REPO_ROOT, `.${url}`);
    const ok = m !== undefined || f.startsWith(join(REPO_ROOT, 'node_modules/three/'));
    if (!ok || !existsSync(f) || !statSync(f).isFile()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(f)] ?? 'application/octet-stream');
    createReadStream(f).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('console', (m) => process.stdout.write(`[page] ${m.text()}\n`));
    page.on('pageerror', (e) => process.stdout.write(`[pageerror] ${e.message}\n`));
    await page.goto(`http://127.0.0.1:${port}/`);
    const info = await page.evaluate((spec) => (window as unknown as { render(s: unknown): Promise<unknown> }).render(spec), { urls: [...served.keys()], views, tw: 720, th: 440, clip, clipTime });
    const data = await page.evaluate(() => (document.getElementById('c') as HTMLCanvasElement).toDataURL('image/png'));
    writeFileSync(out as string, Buffer.from(data.split(',')[1] as string, 'base64'));
    console.log(JSON.stringify(info));
    console.log('wrote', out);
  } finally {
    await browser.close();
    server.close();
  }
}

void readFileSync;
await main();

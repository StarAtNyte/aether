/**
 * Offline contact sheets of the baked characters and motions, rendered in a
 * real browser (software GL is fine). A development tool for the character
 * pipeline: it looks at the files `characters:build` wrote, not at the studio.
 *
 *   npx tsx scripts/characters/preview.ts --out=<dir> [--cast] [--clips=walk,run] [--char=marcus] [--view=front|side|back]
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, REPO_ROOT } from '../../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = resolve(arg('out') ?? '/tmp/char-preview');
const CHAR = arg('char') ?? 'marcus';
const VIEW = arg('view') ?? 'front';
const CLIPS = (arg('clips') ?? '').split(',').filter(Boolean);
const FRAMES = Number(arg('frames') ?? 6);
const record = JSON.parse(readFileSync(join(REPO_ROOT, 'assets/characters.json'), 'utf8')) as { cast: Array<{ id: string; gender: string; file: string }>; motions: Array<{ gender: string; file: string; clips: Array<{ name: string; duration: number }> }> };

const HTML = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#222}canvas{display:block}</style><canvas id=c></canvas>
<script type=importmap>{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type=module>
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
const load = (u) => { if (!cache.has(u)) cache.set(u, loader.loadAsync(u)); return cache.get(u); };
window.render = async (spec) => {
  const {tiles, cols, tw, th, view} = spec;
  const rows = Math.ceil(tiles.length / cols);
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true});
  renderer.setPixelRatio(1); renderer.setSize(cols*tw, rows*th); renderer.setScissorTest(true);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a97a3);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x7a7468, 3.2));
  const sun = new THREE.DirectionalLight(0xfff0dd, 4.2); sun.position.set(2.5, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024,1024);
  Object.assign(sun.shadow.camera, {left:-2,right:2,top:2,bottom:-2,near:0.5,far:12}); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40,40), new THREE.MeshStandardMaterial({color:0x6d6f6a, roughness:0.95})); floor.rotation.x=-Math.PI/2; floor.receiveShadow = true; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(28, tw/th, 0.1, 50);
  const info = [];
  for (let i=0;i<tiles.length;i++) {
    const t = tiles[i];
    const g = await load(t.char);
    const root = clone(g.scene);
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material.map) o.material.map.anisotropy = 4; } });
    scene.add(root);
    let hip = 0;
    if (t.motions) {
      const m = await load(t.motions);
      const clip = m.animations.find(a => a.name === t.clip);
      if (!clip) throw new Error('no clip ' + t.clip);
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      mixer.setTime(t.t * clip.duration);
      if (t.root) { const b = root.getObjectByName('Bip01'); info.push([t.clip, t.t, b.position.y]); }
    }
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    const dist = Math.max(s.y*1.25, s.x*1.5, s.z*1.4) / (2*Math.tan(THREE.MathUtils.degToRad(14)));
    const dir = view === 'side' ? new THREE.Vector3(1,0.12,0) : view === 'back' ? new THREE.Vector3(0,0.12,-1) : view === '34' ? new THREE.Vector3(0.7,0.15,0.7) : new THREE.Vector3(0,0.12,1);
    cam.position.copy(c).addScaledVector(dir.normalize(), dist); cam.lookAt(c);
    const x = (i % cols) * tw, y = (rows - 1 - Math.floor(i / cols)) * th;
    renderer.setViewport(x, y, tw, th); renderer.setScissor(x, y, tw, th);
    renderer.render(scene, cam);
    scene.remove(root);
  }
  return info;
};
</script>`;

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.html': 'text/html' };

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] as string;
    if (url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(HTML);
      return;
    }
    const f = resolve(REPO_ROOT, `.${decodeURIComponent(url)}`);
    const ok = f.startsWith(join(REPO_ROOT, 'node_modules/three/')) || f.startsWith(join(REPO_ROOT, 'assets/lib/c/'));
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
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--ignore-gpu-blocklist', '--use-gl=angle'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('console', (m) => process.stdout.write(`[page] ${m.text()}\n`));
    page.on('pageerror', (e) => process.stdout.write(`[pageerror] ${e.message}\n`));
    await page.goto(`http://127.0.0.1:${port}/`);
    const charFile = (id: string): string => `/assets/lib/${record.cast.find((c) => c.id === id)?.file}`;
    const motionFile = (id: string): string => {
      const g = record.cast.find((c) => c.id === id)?.gender;
      return `/assets/lib/${record.motions.find((m) => m.gender === g)?.file}`;
    };
    const shot = async (name: string, tiles: unknown[], cols: number, tw: number, th: number): Promise<void> => {
      const info = await page.evaluate((spec) => (window as unknown as { render(s: unknown): Promise<unknown> }).render(spec), { tiles, cols, tw, th, view: VIEW });
      const data = await page.evaluate(() => (document.getElementById('c') as HTMLCanvasElement).toDataURL('image/png'));
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(data.split(',')[1] as string, 'base64'));
      if (Array.isArray(info) && info.length) console.log(name, JSON.stringify(info));
      console.log('wrote', name);
    };
    if (ARGS.includes('--cast')) {
      const tiles = record.cast.map((c) => ({ char: charFile(c.id) }));
      await shot(`cast-${VIEW}`, tiles, 5, 360, 560);
    }
    for (const clip of CLIPS) {
      const tiles = Array.from({ length: FRAMES }, (_, i) => ({ char: charFile(CHAR), motions: motionFile(CHAR), clip, t: i / FRAMES }));
      await shot(`clip-${CHAR}-${clip}-${VIEW}`, tiles, FRAMES, 300, 460);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

await main();

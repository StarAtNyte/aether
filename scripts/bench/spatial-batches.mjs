/**
 * Reproducible generated-world WebGL experiment (no template or app state).
 * Start the studio dev server, then run:
 * AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/spatial-batches.mjs
 * Software Chromium makes this a submission/transfer/pixel-parity check, not a hardware FPS benchmark.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const server = process.env.AETHER_BENCH_URL ?? 'http://localhost:5176';
const browser = await chromium.launch({args: process.env.GEN_GPU === 'intel'
  ? ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
  : ['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage();
  await page.route('**/batch-probe', route => route.fulfill({contentType:'text/html', body:'<!doctype html><canvas id="probe"></canvas>'}));
  await page.goto(`${server}/batch-probe`);
  const result = await page.evaluate(async (repository) => {
    const root = '/@fs' + repository;
    const T = await import(root + 'node_modules/three/build/three.module.js');
    const {makeSync, world} = await import(root + 'packages/render/test/helpers.ts');
    const {sync} = makeSync();
    const props = Array.from({length:1024}, (_,i)=>({id:`p-${i}`,transform:{position:[(i%4)*1000+Math.floor(i/4)*0.05,0.5,0]},shape:{kind:'primitive',primitive:'box',size:[0.3,1,0.3]},physics:{body:'static'}}));
    await sync.setWorld(world(props));
    sync.root.updateMatrixWorld(true); sync.updateBatches();
    const batches = sync.root.children.filter(o => o.name === 'aether:batch');
    const mat = new T.MeshBasicMaterial({color:0x89aacc});
    for (const b of batches) b.material = mat;
    const scene = new T.Scene(); scene.add(sync.root);
    const baselineScene = new T.Scene();
    const baseline = new T.InstancedMesh(batches[0].geometry, mat,1024);
    for(let i=0;i<1024;i++) baseline.setMatrixAt(i,sync.object(`p-${i}`).matrixWorld);
    baselineScene.add(baseline);
    const camera = new T.PerspectiveCamera(55,1,0.1,100); camera.position.set(6,3,30); camera.lookAt(6,.5,0);
    const renderer = new T.WebGLRenderer({canvas:document.querySelector('canvas'),preserveDrawingBuffer:true,antialias:false}); renderer.setSize(256,256);
    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 context required');
    const pixels = () => {const a=new Uint8Array(256*256*4); gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,a); return a;};
    renderer.render(baselineScene,camera); const before={...renderer.info.render}; const reference=pixels();
    renderer.render(scene,camera); const after={...renderer.info.render}; const optimized=pixels();
    let mismatch=0; for(let i=0;i<reference.length;i++) if(reference[i]!==optimized[i]) mismatch++;
    let coveredPixels=0; for(let i=0;i<reference.length;i+=4) if(reference[i]>0 || reference[i+1]>0 || reference[i+2]>0) coveredPixels++;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const uploads=[]; const sub=gl.bufferSubData.bind(gl); gl.bufferSubData=(...args)=>{uploads.push({offset:args[1],count:args[4]??args[2].length});return sub(...args);};
    for (let i=0;i<2;i++) {const m=sync.object('p-0');m.position.y+=.1;m.updateMatrix();sync.root.updateMatrixWorld(true);sync.updateBatches();renderer.render(scene,camera);}
    const error=gl.getError();
    renderer.dispose(); sync.clear(); baseline.dispose(); mat.dispose();
    return {gpu,before,after,coveredPixels,mismatch,uploads,error};
  }, repository);
  console.log(JSON.stringify(result,null,2));
  if(result.coveredPixels < 100 || result.mismatch || result.error || result.after.triangles>=result.before.triangles || !result.uploads.some(u=>u.count===16)) process.exitCode=1;
} finally {await browser.close();}

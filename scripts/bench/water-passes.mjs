/**
 * Water auxiliary-pass regression through the full WorldRenderer.
 * Run a studio dev server, then:
 * GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/water-passes.mjs
 * GEN_GPU unset uses SwiftShader. Backdrop is forced on WebGL to exercise both pass gates.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const server = process.env.AETHER_BENCH_URL ?? 'http://localhost:5176';
const b=await chromium.launch({args: process.env.GEN_GPU === 'intel'
 ? ['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']
 : ['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const p=await b.newPage();
 p.on('pageerror',e=>console.log('pageerror',e.message));
 await p.route('**/water-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><canvas width="256" height="256" style="width:256px;height:256px"></canvas>'}));
 await p.goto(`${server}/water-probe`);
 const r=await p.evaluate(async(repository)=>{
  const root='/@fs'+repository;
  const {WorldRenderer}=await import(root+'packages/render/src/world-renderer.ts');
  const {world,box,FakeSource}=await import(root+'packages/render/test/helpers.ts');
  globalThis.__WATER_TIER='high';
  const r=await WorldRenderer.create(document.querySelector('canvas'),{backend:'webgl2',geometrySource:new FakeSource(),watchdog:false,shadows:false,antialias:false,foliageUrl:null,growIn:false,blueprint:false});
  r.setRenderTier('low');r.setAdaptiveResolution(false);
  await r.setWorld(world([box('water',[1000,0,0],{material:{preset:'water'},shape:{kind:'primitive',primitive:'box',size:[8,.1,8]}}),box('prop',[0,1,0])]));
  await r.sync.whenIdle();
  for(let i=0;i<500 && r.warming;i++) await new Promise(done=>setTimeout(done,20));
  if(r.warming)throw new Error('shader warmup did not finish');
  r.setCameraPose(0,3,10,0,-Math.atan2(3,10));
  r.materials.mirror.used=true;r.materials.backdrop.used=true;
  let mirrors=0;const mirror=r.materials.mirror.mirror;const render=mirror.render.bind(mirror);mirror.render=(...a)=>{mirrors++;return render(...a);};
  const draw=()=>{r.requestRender();r.render(0,{animate:false});};
  for(let i=0;i<4;i++) draw();
  const offscreen={mirrors,backdrops:r.materials.backdrop.draws};
  const gl=r.renderer.backend.gl;
  const pixels=()=>{const out=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
  const optimized=pixels();
  const check=r.sync.hasVisibleWater.bind(r.sync);
  r.sync.hasVisibleWater=()=>true;
  draw();
  const reference=pixels();
  let pixelDifferences=0;
  for(let i=0;i<reference.length;i++)if(reference[i]!==optimized[i])pixelDifferences++;
  r.sync.hasVisibleWater=check;
  // Count only the subsequent visible and hidden frames.
  mirrors=0;
  const backdropStart=r.materials.backdrop.draws;
  const node=r.sync.object('water');node.position.x=0;node.updateMatrix();
  for(let i=0;i<4;i++) draw();
  const visible={mirrors,backdrops:r.materials.backdrop.draws-backdropStart};
  node.visible=false;
  for(let i=0;i<4;i++) draw();
  const hidden={mirrors,backdrops:r.materials.backdrop.draws-backdropStart};
  const gpu=r.gpu.description;
  const error=gl.getError();
  r.dispose();return {gpu,offscreen,visible,hidden,pixelDifferences,error};
 },repository);console.log(JSON.stringify(r,null,2));
 if(r.pixelDifferences||r.error||r.offscreen.mirrors||r.offscreen.backdrops||r.visible.mirrors===0||r.visible.backdrops===0||r.hidden.mirrors!==r.visible.mirrors||r.hidden.backdrops!==r.visible.backdrops)process.exitCode=1;
}finally{await b.close();}

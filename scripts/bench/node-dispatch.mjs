/** Native NodeManager/NodeFrame dispatch, unchanged callbacks, isolated from GPU shading. */
import { chromium, firefox } from 'playwright';
const fx=process.env.AETHER_BENCH_BROWSER==='firefox',rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);
const browser=await(fx?firefox.launch({headless:process.env.AETHER_BENCH_HEADED!=='1',firefoxUserPrefs:{'webgl.force-enabled':true}}):chromium.launch({args:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']}));
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(!fx&&rate>1)await(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate});
 await page.route('**/node-map-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/node-map-probe');
 const results=await page.evaluate(async ({root,mapCache})=>{
  const {T,S}=await import(root+'scripts/bench/graph-browser-engine.mjs');
  const module=await import(root+(mapCache?'scripts/bench/node-map-cache-experiment.ts':'scripts/bench/node-dispatch-experiment.ts')),patch=mapCache?module.cacheNodeUpdateMaps:module.inlineNodeUpdates;
  const renderer=new T.WebGPURenderer({forceWebGL:true});await renderer.init();const manager=renderer._nodes,native=manager.updateForRender;
  patch(renderer);const optimized=manager.updateForRender;if(optimized===native)throw new Error('Patch not installed');
  const results=[];
  try{for(const mode of ['render-heavy','mixed','object','material-reference']){
   const counts=mode==='render-heavy'?[12,4,4]:mode==='object'?[0,0,24]:[8,2,14],stats={calls:0,digest:0},nodes=[];
   for(const [j,type] of ['render','frame','object'].entries())for(let i=0;i<counts[j];i++){
    const index=nodes.length;
    if(mode==='material-reference'&&type==='object')nodes.push(S.materialReference(['roughness','metalness','opacity'][i%3],'float'));
    else{const node=new T.Node();node.updateType=type;node.update=function(frame){stats.calls++;stats.digest+=index+(type==='object'?frame.object.position.x:frame.frameId);};nodes.push(node);}
   }
   const state={updateNodes:nodes},scene=new T.Scene(),camera=new T.PerspectiveCamera(),objects=[];
   for(let i=0;i<300;i++){const object=new T.Mesh(undefined,new T.MeshStandardMaterial({roughness:(i%10)/10,metalness:(i%3)/3}));object.position.x=i%7;objects.push({renderer,scene,camera,object,material:object.material,getNodeBuilderState:()=>state});}
   const run=(fn,frames)=>{manager.nodeFrame.updateMap=new WeakMap();stats.calls=0;stats.digest=0;const start=performance.now();for(let frame=1;frame<=frames;frame++){manager.nodeFrame.frameId=frame;manager.nodeFrame.renderId=frame*3;for(const ro of objects)fn.call(manager,ro);}return{ms:performance.now()-start,calls:stats.calls,digest:stats.digest};};
   run(native,10);run(optimized,10);const pairs=[];
   for(let i=0;i<5;i++){const a=run(i%2?optimized:native,80),b=run(i%2?native:optimized,80),before=i%2?b:a,after=i%2?a:b;if(before.calls!==after.calls||before.digest!==after.digest)throw new Error('Callback mismatch');pairs.push({beforeMs:before.ms,afterMs:after.ms,calls:before.calls,digest:before.digest});await new Promise(r=>setTimeout(r,0));}
   const median=k=>pairs.map(p=>p[k]).sort((a,b)=>a-b)[2];results.push({mode,dispatchesPerRun:nodes.length*objects.length*80,beforeMs:median('beforeMs'),afterMs:median('afterMs'),pairs});for(const ro of objects){ro.object.geometry.dispose();ro.material.dispose();}
  }}finally{renderer.dispose();}
  return results;
 },{root:'/@fs'+process.cwd()+'/',mapCache:process.env.AETHER_BENCH_NODE_MAP_CACHE==='1'});
 console.log(JSON.stringify({browser:fx?'firefox':'chromium',cpuRate:rate,mapCache:process.env.AETHER_BENCH_NODE_MAP_CACHE==='1',errors,results},null,2));if(errors.length)process.exitCode=1;
}finally{await browser.close();}

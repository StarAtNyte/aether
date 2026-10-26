/** Exact cascade depth reuse versus native live updates, including edits and dynamic fallbacks. */
import {chromium,firefox} from 'playwright';
const browserName=process.env.AETHER_BENCH_BROWSER??'chromium',webgpu=process.env.AETHER_BENCH_WEBGPU==='1';
const browser=await(browserName==='firefox'?firefox.launch({headless:process.env.AETHER_BENCH_HEADED!=='1',firefoxUserPrefs:{'webgl.force-enabled':true}}):chromium.launch({args:webgpu?['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader']:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']}));
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,500));});
 await page.route('**/cascade-cache-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/cascade-cache-probe');
 const result=await page.evaluate(async({root,webgpu})=>{
  const {T,S}=await import(root+'scripts/bench/graph-browser-engine.mjs');
  const {SunCascades,SoftShadowFilter,shadowNoiseValue}=await import(root+'packages/render/src/gpu/sun-shadow-nodes.ts');
  const {planSunShadows}=await import(root+'packages/render/src/environment/sun-shadow-plan.ts');
  const {staticShadowAlpha}=await import(root+'packages/render/src/gpu/shadow-alpha.ts');
  const {installRenderPatches}=await import(root+'packages/render/src/three-patches.ts');
  async function create(cached){
   const renderer=new T.WebGPURenderer({forceWebGL:!webgpu,antialias:false});await renderer.init();if(webgpu&&!renderer.backend.isWebGPUBackend)throw new Error('WebGPU unavailable');renderer.setSize(192,192);installRenderPatches(renderer);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,1,.1,150);camera.position.set(14,12,20);camera.lookAt(0,0,0);
   const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(15,25,10);sun.castShadow=true;Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:1,far:100});sun.shadow.camera.updateProjectionMatrix();scene.add(sun,sun.target,new T.HemisphereLight(0xffffff,0x335544,1));
   const plan=planSunShadows({tier:'high',still:false,shadowMapCap:256,contentRadius:120,voxel:false});const cascades=new SunCascades(sun,camera,plan,new SoftShadowFilter(plan));sun.shadow.shadowNode=cascades;cascades.hints.target=new T.Vector3();cascades.hints.maxDistance=100;cascades.setCacheEnabled(cached);
   const geometry=new T.BoxGeometry(.9,2,.9),materials=[],meshes=[];
   for(let i=0;i<100;i++){const material=new T.MeshStandardMaterial({color:new T.Color().setHSL(i/100,.6,.5)}),mesh=new T.Mesh(geometry,material);mesh.position.set((i%10-4.5)*1.5,1,(Math.floor(i/10)-4.5)*1.5);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);materials.push(material);meshes.push(mesh);}
   const floorGeometry=new T.PlaneGeometry(45,45),floorMaterial=new T.MeshStandardMaterial({color:0xcccccc}),floor=new T.Mesh(floorGeometry,floorMaterial);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
   const alpha=new T.DataTexture(new Uint8Array([255,255,255,255,255,255,255,0,255,255,255,0,255,255,255,255]),2,2);alpha.needsUpdate=true;materials[1].map=alpha;materials[1].alphaTest=.5;materials[1].needsUpdate=true;
   const output=webgpu?new T.RenderTarget(192,192):null;if(output)renderer.setOutputRenderTarget(output);
   const draw=()=>{renderer._nodes.nodeFrame.update();renderer.render(scene,camera);};
   for(let i=0;i<5;i++)draw();let shadowPasses=0;
   for(const n of cascades._shadowNodes){const render=n.renderShadow;n.renderShadow=function(...args){shadowPasses++;return render.apply(this,args);};}
   const read=async()=>{if(webgpu)return new Uint8Array(await renderer.readRenderTargetPixelsAsync(output,0,0,192,192));const p=new Uint8Array(192*192*4),gl=renderer.backend.gl;gl.readPixels(0,0,192,192,gl.RGBA,gl.UNSIGNED_BYTE,p);const error=gl.getError();if(error)throw new Error((cached?'cached':'native')+' GL error '+error);return p;};
   return{renderer,scene,camera,sun,cascades,geometry,materials,meshes,alpha,draw,read,passes:()=>shadowPasses,dispose(){cascades.dispose();renderer.dispose();output?.dispose();geometry.dispose();floorGeometry.dispose();floorMaterial.dispose();alpha.dispose();for(const m of materials)m.dispose();}};
  }
  const before=await create(false),after=await create(true),cases=[];let previousPixels=null;
  try{
   const compare=async name=>{const start=after.passes();before.draw();after.draw();const a=await before.read(),b=await after.read();let differences=0,max=0,changedPixels=0;const colors=new Set();for(let i=0;i<a.length;i++){if(previousPixels&&previousPixels[i]!==a[i])changedPixels++;if(a[i]!==b[i])differences++;max=Math.max(max,Math.abs(a[i]-b[i]));if(i%4===0)colors.add(a[i]+','+a[i+1]+','+a[i+2]);}cases.push({name,differences,max,colors:colors.size,changedPixels,shadowPasses:after.passes()-start});previousPixels=a;if(colors.size<20)throw new Error('Empty frame');if(name==='animated-position'&&!changedPixels)throw new Error('Animation did not affect image');if(name!=='initial'&&name!=='filter-rotation'&&after.passes()===start)throw new Error('Missing invalidation: '+name);};
   await compare('initial');
   const p0=before.passes(),p1=after.passes(),times={before:[],after:[]};
   for(let i=0;i<20;i++){for(const name of i%2?['after','before']:['before','after']){const t=performance.now();(name==='before'?before:after).draw();times[name].push(performance.now()-t);}await new Promise(r=>setTimeout(r,0));}
   const timing={beforeMs:times.before.sort((a,b)=>a-b)[10],afterMs:times.after.sort((a,b)=>a-b)[10],beforeShadowPasses:before.passes()-p0,afterShadowPasses:after.passes()-p1};
   for(const pair of [before,after]){pair.meshes[0].position.x+=2;pair.meshes[0].position.z+=2;}await compare('caster-moved');
   for(const pair of [before,after])pair.meshes[3].visible=false;await compare('visibility');
   for(const pair of [before,after]){pair.alpha.image.data[3]=0;pair.alpha.needsUpdate=true;}await compare('alpha-edited');
   for(const pair of [before,after]){pair.camera.position.x+=4;pair.camera.lookAt(2,0,0);}await compare('camera-moved');
   shadowNoiseValue.set(23,17);await compare('filter-rotation');shadowNoiseValue.set(0,0);
   for(const pair of [before,after]){pair.sun.position.x-=3;}await compare('sun-moved');
   for(const pair of [before,after]){const p=pair.geometry.getAttribute('position');p.setY(0,p.getY(0)+.5);p.needsUpdate=true;}await compare('geometry-edited');
   for(const pair of [before,after])pair.cascades.requestRefresh();await compare('explicit-refresh');
   for(const pair of [before,after])pair.cascades.setCacheEnabled(false);await compare('capture-live');
   after.cascades.setCacheEnabled(true);await compare('capture-restored');
   // Map size changes use EnvironmentRig's light replacement path; mutating native cascade targets in place raises GL 1282 even without caching.
   for(const pair of [before,after]){pair.originalContext=pair.renderer.contextNode;pair.renderer.contextNode=S.context(null,{getUV:()=>S.uv().mul(.5)});}await compare('custom-renderer-context');
   for(const pair of [before,after])pair.renderer.contextNode=pair.originalContext;await compare('renderer-context-restored');
   for(const pair of [before,after]){pair.materials[2].colorNode=staticShadowAlpha(S.vec4(S.materialColor.rgb.mul(.9),1));pair.materials[2].needsUpdate=true;}await compare('certified-colour-node');
   const cert=after.passes();after.draw();if(after.passes()!==cert)throw new Error('Certified colour did not settle');
   for(const pair of [before,after]){pair.materials[2].colorNode=S.vec4(S.materialColor.rgb,S.float(.7));pair.materials[2].needsUpdate=true;}await compare('unknown-colour-node');
   const d0=before.passes(),d1=after.passes();before.draw();after.draw();const fallback={before:before.passes()-d0,after:after.passes()-d1};
   for(const pair of [before,after]){pair.materials[2].colorNode=null;pair.materials[2].needsUpdate=true;pair.height=S.uniform(.2);for(const m of pair.materials){m.positionNode=S.positionLocal.add(S.vec3(0,pair.height,0));m.needsUpdate=true;}}await compare('custom-position');
   for(const pair of [before,after])pair.height.value=4;await compare('animated-position');
   return{cases,timing,fallback};
  }finally{before.dispose();after.dispose();}
 },{root:'/@fs'+process.cwd()+'/',webgpu});
 console.log(JSON.stringify({browser:browserName,backend:webgpu?'webgpu':'webgl2',errors,...result},null,2));
 if(errors.length||result.cases.some(c=>c.differences)||result.timing.afterShadowPasses!==0||result.timing.beforeShadowPasses===0||result.fallback.after===0)process.exitCode=1;
}finally{await browser.close();}

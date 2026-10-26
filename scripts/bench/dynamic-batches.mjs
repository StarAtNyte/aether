/** Compare transform-updatable material batches with individual native meshes. */
import { chromium, firefox } from 'playwright';
const initialHidden=Number(process.env.AETHER_BENCH_INITIAL_HIDDEN??0);
const reference=process.env.AETHER_BENCH_REFERENCE??'native';
const control=process.env.AETHER_BENCH_CONTROL??'batch';
const webgpu=process.env.AETHER_BENCH_WEBGPU==='1',fx=process.env.AETHER_BENCH_BROWSER==='firefox',post=process.env.AETHER_BENCH_POST==='1';
const browser=await(fx?firefox.launch({headless:process.env.AETHER_BENCH_HEADED!=='1',firefoxUserPrefs:{'webgl.force-enabled':true}}):chromium.launch({args:webgpu?['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader']:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']}));
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,500));});
 await page.route('**/packages/render/src/sync/static-batches.ts?hidden-reference',async route=>{
  const response=await route.fetch(),body=await response.text(),pattern=/const visibilityChanged = batch\.mesh\.visible !==[\s\S]*?return changed \|\| visibilityChanged;/;
  if(!pattern.test(body))throw new Error('Hidden-batch reference edit no longer matches');
  await route.fulfill({response,body:body.replace(pattern,'if (force) batch.mesh.computeBoundingSphere(); return changed;')});
 });
 const rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);if(!fx&&rate>1)await(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate});
 await page.route('**/dynamic-batch-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/dynamic-batch-probe');
 const result=await page.evaluate(async ({root,webgpu,post,control,reference,initialHidden})=>{
  const {T,S}=await import(root+'scripts/bench/graph-browser-engine.mjs');
  const {DynamicBatchesExperiment,prepareDynamicBatchDraws}=await import(root+'scripts/bench/dynamic-batches-experiment.ts');
  const {StaticBatches}=await import(root+'packages/render/src/sync/static-batches.ts');
  const {DrawBatches}=await import(root+'packages/render/src/sync/draw-batches.ts');const {prepareBatchDraws}=await import(root+'packages/render/src/gpu/batch-draws.ts');
  const StaticBatchesReference=control==='static-before'||reference==='static-before'?(await import(root+'packages/render/src/sync/static-batches.ts?hidden-reference')).StaticBatches:null;
  async function create(batched,mode=control){
   const renderer=new T.WebGPURenderer({forceWebGL:!webgpu,antialias:false});await renderer.init();renderer.setSize(256,256);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
   let geometryTarget=null;const sceneRender=renderer.render;renderer.render=function(scene,camera,...args){if(scene.isScene&&this.getMRT())geometryTarget=this.getRenderTarget();return sceneRender.call(this,scene,camera,...args);};
   const scene=new T.Scene();scene.background=new T.Color(0x304050);
   const camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.set(0,9,22);camera.lookAt(0,0,0);
   const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(-4,8,6);sun.castShadow=true;sun.shadow.mapSize.set(256,256);Object.assign(sun.shadow.camera,{left:-4,right:4,top:4,bottom:-4});scene.add(sun,new T.HemisphereLight(0xffffff,0x443322,1));
   const materials=Array.from({length:4},(_,i)=>new T.MeshStandardMaterial({color:new T.Color().setHSL(i/4,.5,.5),roughness:.4,metalness:.1}));
   const geometries=Array.from({length:8},(_,i)=>i%2?new T.BoxGeometry(.5+i*.02,.5,.5):new T.SphereGeometry(.3,8+i,6));
   const group=new T.Group();scene.add(group);const meshes=[];
   for(let i=0;i<400;i++){const mesh=new T.Mesh(geometries[i%8],materials[i%4]);mesh.position.set((i%20-9.5)*.8,Math.floor(i/20)%3*.6,(Math.floor(i/20)-9.5)*.8);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);meshes.push(mesh);}
   for(let i=0;i<Math.min(initialHidden,meshes.length);i++)meshes[i].visible=false;
   const floorGeometry=new T.PlaneGeometry(40,40),floorMaterial=new T.MeshStandardMaterial({color:0xaaaaaa});const floor=new T.Mesh(floorGeometry,floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-.5;floor.receiveShadow=true;floor.renderOrder=1;scene.add(floor);
   scene.updateMatrixWorld(true);const restore=prepareDynamicBatchDraws(renderer);
   function nativeInstances(){
    const groups=new Map();for(const source of meshes){const key=source.geometry.uuid+source.material.uuid;const list=groups.get(key)??[];list.push(source);groups.set(key,list);}
    const batches=[];for(const list of groups.values()){const mesh=new T.InstancedMesh(list[0].geometry,list[0].material,list.length);mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh);for(const source of list)source.layers.set(7);batches.push({mesh,list});}
    return {batches,saved:meshes.length-batches.length,update(){for(const b of batches){const visibility=b.list.map(source=>{for(let o=source;o;o=o.parent){if(!o.visible)return false;if(o===scene)return true;}return false;});b.mesh.visible=visibility.some(Boolean);if(!b.mesh.visible)continue;for(let i=0;i<b.list.length;i++)b.mesh.setMatrixAt(i,visibility[i]?b.list[i].matrixWorld:new T.Matrix4().makeScale(0,0,0));b.mesh.instanceMatrix.needsUpdate=true;}},dispose(){for(const b of batches){b.mesh.removeFromParent();b.mesh.dispose();for(const source of b.list)source.layers.set(0);}}};
   }
   function staticInstances(){const Class=mode==='static-before'?StaticBatchesReference:StaticBatches;const batches=new Class(scene);const nodes=meshes.map(mesh=>({entity:{shape:{kind:'primitive'},physics:{body:'static'}},bindings:[{mesh,materialKey:mesh.material.uuid,ownedMaterial:null,seeThrough:false}],geometryKeys:[mesh.geometry.uuid]}));batches.rebuild(nodes);return{get batches(){return Array(batches.count);},get saved(){return batches.drawCallsSaved;},update(){batches.update();},dispose(){batches.clear();}};}
   function managedDraws(){if(!prepareBatchDraws(renderer))throw new Error('Draw-batch preparation unavailable');const batches=new DrawBatches(scene);batches.rebuild(meshes);return{get batches(){return batches.batches;},get saved(){return batches.drawCallsSaved;},update(){batches.update();},dispose(){batches.clear();}};}
   const batch=batched&&mode!=='native'?(mode==='instance'?nativeInstances():(mode==='static'||mode==='static-before')?staticInstances():mode==='draw'?managedDraws():new DynamicBatchesExperiment(scene,meshes)):null;
   let pipeline=null;if(post){const {createPostPipeline}=await import(root+'packages/render/src/gpu/post.ts');pipeline=await createPostPipeline(renderer,scene,camera,.1,'studio',{effects:{composite:true,ao:true,gi:true,taa:!webgpu,contact:true,ssr:true,shafts:true,halation:true,aberration:true,grain:true,dof:true},sun,contactLight:sun});if(!pipeline)throw new Error('Post pipeline failed');pipeline.setFocus(22);}
   const output=new T.RenderTarget(256,256,{depthBuffer:true,type:T.UnsignedByteType});
   if(post)renderer.setOutputRenderTarget(output);let frame=0;let draws=0;const native=renderer.backend.draw;renderer.backend.draw=function(...args){draws++;return native.apply(this,args);};
   const draw=()=>{scene.updateMatrixWorld(true);batch?.update();const nf=renderer._nodes.nodeFrame;nf.frameId=++frame;nf.time=3;nf.deltaTime=1/60;draws=0;if(post){renderer.setRenderTarget(null);pipeline.render();}else{renderer.setRenderTarget(output);renderer.render(scene,camera);}return draws;};
   const read=async()=>new Uint8Array((await renderer.readRenderTargetPixelsAsync(output,0,0,256,256)).buffer);
   let velocityCopy=null,velocityTarget=null;
   const readAttachments=async()=>{const arrays=[];if(geometryTarget)for(let i=0;i<geometryTarget.textures.length;i++){let values;if(geometryTarget.textures[i].name==='velocity'){if(!velocityCopy){velocityTarget=new T.RenderTarget(256,256,{type:T.FloatType});velocityCopy=new T.RenderPipeline(renderer);velocityCopy.outputColorTransform=false;velocityCopy.outputNode=S.vec4(S.texture(geometryTarget.textures[i]).rg,0,1);}const previous=renderer.getRenderTarget();renderer.setRenderTarget(velocityTarget);velocityCopy.render();renderer.setRenderTarget(previous);values=await renderer.readRenderTargetPixelsAsync(velocityTarget,0,0,256,256);}else values=await renderer.readRenderTargetPixelsAsync(geometryTarget,0,0,256,256,i);arrays.push({name:geometryTarget.textures[i].name,values});}return arrays;};
   return{renderer,scene,camera,sun,meshes,group,materials,batch,draw,read,readAttachments,dispose(){batch?.dispose();restore();pipeline?.dispose();velocityCopy?.dispose();velocityTarget?.dispose();output.dispose();renderer.dispose();floorGeometry.dispose();floorMaterial.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}};
  }
  const before=await create(reference!=='native',reference),after=await create(true),cases=[];
  try{
   const compare=async name=>{const draws=[before.draw(),after.draw()],a=await before.read(),b=await after.read();let differences=0,max=0,absolute=0,aboveTwo=0;const outliers=[];for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);differences+=d>0;aboveTwo+=d>2;if(d>2&&outliers.length<64)outliers.push({index:i,reference:a[i],candidate:b[i]});absolute+=d;max=Math.max(max,d);}const colors=new Set();for(let i=0;i<a.length;i+=4)colors.add(`${a[i]},${a[i+1]},${a[i+2]}`);if(colors.size<20&&name!=='hidden-parent')throw new Error('Empty or flat reference: '+colors.size);const aa=await before.readAttachments(),bb=await after.readAttachments();const attachments=aa.map((v,i)=>{let differences=0,max=0;for(let k=0;k<v.values.length;k++){const d=Math.abs(v.values[k]-bb[i].values[k]);differences+=d>0;max=Math.max(max,d);}return{name:v.name,array:v.values.constructor.name,differences,max};});cases.push({name,draws,colors:colors.size,differences,aboveTwo,outliers,max,mean:absolute/a.length,attachments});};
   if(post)for(let i=0;i<5;i++){before.draw();after.draw();}await compare('live-shadow-first');await compare('live-shadow-repeat');for(const r of[before,after])r.sun.shadow.autoUpdate=false;await compare('cached-shadow');
   const times={before:[],after:[]};for(let i=0;i<20;i++){for(const n of i%2?['after','before']:['before','after']){const s=performance.now();(n==='before'?before:after).draw();times[n].push(performance.now()-s);}await new Promise(r=>setTimeout(r,0));}
   for(const r of[before,after]){r.meshes[8].rotation.y=.4;r.meshes[9].position.y+=.5;r.meshes[10].scale.set(1,2,.5);r.sun.shadow.needsUpdate=true;}await compare('moving-and-nonuniform');
   for(const r of[before,after]){r.meshes[15].visible=false;r.meshes[16].removeFromParent();r.sun.shadow.needsUpdate=true;}await compare('hidden-and-detached');
   for(const r of[before,after]){r.camera.position.x=5;r.camera.lookAt(0,0,0);r.sun.shadow.needsUpdate=true;}await compare('camera-change');
   for(const r of[before,after])r.group.visible=false;await compare('hidden-parent');for(const r of[before,after])r.group.visible=true;await compare('restored-parent');if(initialHidden){for(const r of[before,after]){for(let i=0;i<Math.min(initialHidden,r.meshes.length);i++){r.meshes[i].visible=true;r.meshes[i].position.x+=.1;}r.sun.shadow.needsUpdate=true;}await compare('reveal-initially-hidden');}
   return{cases,batches:after.batch?.batches.length??0,saved:after.batch?.saved??0,timing:Object.fromEntries(Object.entries(times).map(([k,v])=>[k,v.sort((a,b)=>a-b)[10]]))};
  }finally{before.dispose();after.dispose();}
 },{root:'/@fs'+process.cwd()+'/',webgpu,post,control,reference,initialHidden});
 const failedCases=result.cases.filter(c=>c.max>2||c.mean>.01).map(c=>c.name);console.log(JSON.stringify({errors,cpuRate:rate,browser:fx?'firefox':'chromium',webgpu,post,control,reference,initialHidden,imageGate:{maxByteDifference:2,maxMeanDifference:.01,failedCases},...result},null,2));if(errors.length||failedCases.length)process.exitCode=1;
}finally{await browser.close();}

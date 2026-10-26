/** Post-pipeline parity probes: geometry lighting, UV math, signed motion and reflection material layouts. */
import { chromium, firefox } from 'playwright';
import {writeFile} from 'node:fs/promises';
const webgpu=process.env.AETHER_BENCH_WEBGPU==='1', firefoxMode=process.env.AETHER_BENCH_BROWSER==='firefox';
const browser=await(firefoxMode?firefox.launch({headless:process.env.AETHER_BENCH_HEADED!=='1',firefoxUserPrefs:{'webgl.force-enabled':true}}):chromium.launch({args:webgpu?['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader']:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']}));
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,500));});
 await page.route('**/packages/render/src/gpu/post.ts?geometry-experiment',async route=>{
  const response=await route.fetch(),body=await response.text(),pattern=/prePass\.transparent = false;/;
  if(!pattern.test(body))throw new Error('Experiment edit no longer matches post.ts');
  const helper=`import {configureGeometryPass} from '/@fs${process.cwd()}/scripts/bench/geometry-pass-experiment.ts';\n`;
  await route.fulfill({response,body:helper+body.replace(pattern,'prePass.transparent = false;configureGeometryPass(prePass, three.Lighting);')});
 });
 await page.route('**/packages/render/src/gpu/post.ts?motion-reference',async route=>{
  const response=await route.fetch(),body=await response.text(),pattern=/motionTexture\.format = RGFormat;/;
  if(!pattern.test(body))throw new Error('Motion reference no longer matches post.ts');
  await route.fulfill({response,body:body.replace(pattern,'motionTexture.format = three.RGBAFormat;')});
 });
 await page.route('**/packages/render/src/gpu/post.ts?material-reference',async route=>{
  const response=await route.fetch(),body=await response.text(),pattern=/materialTexture\.format = RGFormat;/;
  if(!pattern.test(body))throw new Error('Material reference no longer matches post.ts');
  await route.fulfill({response,body:body.replace(pattern,'materialTexture.format = three.RGBAFormat;')});
 });
 const rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);if(!firefoxMode&&rate>1)await(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate});
 await page.route('**/geometry-prepass-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/geometry-prepass-probe');
 const result=await page.evaluate(async({root,webgpu,effect,control,uvMath,motion,materialLayout})=>{
  const {T,S}=await import(root+'scripts/bench/graph-browser-engine.mjs');
  const {specializeUvTransform}=await import(root+'packages/render/src/gpu/uv-transform.ts');const nativeUv=T.Matrix3.prototype.setUvTransform,fastUv=uvMath?specializeUvTransform(nativeUv):nativeUv;if(uvMath&&nativeUv===fastUv)throw new Error('UV specialization unavailable');
  async function create(unlit){
   const renderer=new T.WebGPURenderer({forceWebGL:!webgpu,antialias:false});await renderer.init();if(webgpu&&!renderer.backend.isWebGPUBackend)throw new Error('WebGPU unavailable');renderer.setSize(256,256);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
   let geometryTarget=null,beautyTarget=null,aoTarget=null;const sceneRender=renderer.render;renderer.render=function(...args){if(this.getMRT()&&args[0].isScene)geometryTarget=this.getRenderTarget();if(!this.getMRT()&&args[0].isScene&&!args[0].overrideMaterial?.isShadowPassMaterial&&this.getRenderTarget())beautyTarget=this.getRenderTarget();if(this.getRenderTarget()?.texture.name==='GTAONode.AO')aoTarget=this.getRenderTarget();return sceneRender.apply(this,args);};
      const scene = new T.Scene();scene.background=new T.Color(0x335577);
      const envPixels=new Float32Array(128*64*4);
      for(let y=0;y<64;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4;envPixels[i]=.2+x/128;envPixels[i+1]=.1+y/64;envPixels[i+2]=.3;envPixels[i+3]=1;}
      const environment=new T.DataTexture(envPixels,128,64,T.RGBAFormat,T.FloatType);environment.mapping=T.EquirectangularReflectionMapping;environment.needsUpdate=true;scene.environment=environment;
      scene.fog=new T.FogExp2(0x997766,.035);
      const camera = new T.PerspectiveCamera(45,1,0.1,50);camera.position.set(0,2,8);camera.lookAt(0,0,0);
      const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(2,5,4);sun.castShadow=true;sun.shadow.mapSize.set(256,256);scene.add(sun,new T.HemisphereLight(0xbfdfff,0x443322,1.5));
      const texture = new T.DataTexture(new Uint8Array([255,255,255,255,255,128,64,0,64,128,255,255,255,255,255,255]),2,2);texture.needsUpdate=true;
      const geometry=new T.BoxGeometry(.7,.7,.7), materials=[];
      for(let i=0;i<24;i++){
        const material=new T.MeshStandardMaterial({color:new T.Color().setHSL(i/24,.7,.5),roughness:.2+(i%5)*.15,metalness:(i%3)*.3,side:i%4===0?T.DoubleSide:T.FrontSide,transparent:i%4===0,opacity:i%4===0?.6:1,alphaTest:i%5===0?.5:0,map:i%5===0?texture:null});
        materials.push(material);
        const mesh=new T.Mesh(geometry,material);mesh.position.set((i%6-2.5)*.85,(Math.floor(i/6)-1.5)*.85,0);mesh.rotation.y=i*.15;mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
      }
      const extraMaterial=new T.MeshStandardMaterial({color:0xffcc66,roughness:.5});
      const instances=new T.InstancedMesh(geometry,extraMaterial,2);
      for(let i=0;i<2;i++)instances.setMatrixAt(i,new T.Matrix4().makeTranslation(-1.2+i*2.4,2.1,0));
      instances.castShadow=true;scene.add(instances);
      const skinGeometry=geometry.clone(),vertices=skinGeometry.attributes.position.count;
      const skinIndices=new Uint16Array(vertices*4),skinWeights=new Float32Array(vertices*4);
      for(let i=0;i<vertices;i++)skinWeights[i*4]=1;
      skinGeometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndices,4));skinGeometry.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeights,4));
      const skin=new T.SkinnedMesh(skinGeometry,extraMaterial),bone=new T.Bone();skin.add(bone);skin.bind(new T.Skeleton([bone]));bone.rotation.z=.3;skin.position.set(0,2.1,0);skin.castShadow=true;scene.add(skin);
      const planeGeometry=new T.PlaneGeometry(10,10), planeMaterial=new T.MeshStandardMaterial({color:0xc0c0c0,roughness:.8});
      const plane=new T.Mesh(planeGeometry,planeMaterial);plane.rotation.x=-Math.PI/2;plane.position.y=-2;plane.receiveShadow=true;scene.add(plane);

   const {createPostPipeline}=await import(root+'packages/render/src/gpu/post.ts'+(materialLayout&&!unlit?'?material-reference':motion&&!unlit?'?motion-reference':unlit&&!control&&!uvMath&&!motion&&!materialLayout?'?geometry-experiment':''));
   const effects={composite:true,ao:true,gi:true,taa:!webgpu||motion,contact:true,ssr:true,shafts:true,halation:true,aberration:true,grain:true,dof:true};
   if(effect!=='all')for(const key in effects)effects[key]=key==='composite'||key===effect;
   const pipeline=await createPostPipeline(renderer,scene,camera,.1,'studio',{effects,sun,contactLight:sun});if(!pipeline)throw new Error('Pipeline construction failed');pipeline.setFocus(8);
   const output=webgpu?new T.RenderTarget(256,256,{type:T.UnsignedByteType}):null;if(output)renderer.setOutputRenderTarget(output);
   let frame=0;const draw=()=>{T.Matrix3.prototype.setUvTransform=unlit&&uvMath?fastUv:nativeUv;const nf=renderer._nodes.nodeFrame;nf.frameId=++frame;nf.time=3;nf.deltaTime=1/60;pipeline.render();};
   for(let i=0;i<5;i++)draw();
   const depthTarget=new T.RenderTarget(256,256,{type:T.FloatType}),depthPipeline=new T.RenderPipeline(renderer);depthPipeline.outputColorTransform=false;depthPipeline.outputNode=S.vec4(S.texture(geometryTarget.depthTexture).r,0,0,1);
   const aoPipeline=new T.RenderPipeline(renderer);aoPipeline.outputColorTransform=false;if(aoTarget)aoPipeline.outputNode=S.vec4(S.texture(aoTarget.texture).r,0,0,1);
   const velocityPipeline=new T.RenderPipeline(renderer);velocityPipeline.outputColorTransform=false;const velocityTexture=geometryTarget.textures.find(t=>t.name==='velocity');if(velocityTexture)velocityPipeline.outputNode=S.vec4(S.texture(velocityTexture).rg,0,1);
   const materialPipeline=new T.RenderPipeline(renderer);materialPipeline.outputColorTransform=false;const materialTexture=geometryTarget.textures.find(t=>t.name==='material');if(materialLayout&&(!materialTexture||materialTexture.type!==T.UnsignedByteType||materialTexture.format!==(unlit?T.RGFormat:T.RGBAFormat)))throw new Error('Unexpected material attachment layout');if(materialTexture)materialPipeline.outputNode=S.vec4(S.texture(materialTexture).rg,0,1);
   const read=async()=>{let p;if(webgpu)p=await renderer.readRenderTargetPixelsAsync(output,0,0,256,256);else{const gl=renderer.backend.gl;p=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,p);if(gl.getError())throw new Error('GL error');}const arrays=[{name:'full-post',bytes:new Uint8Array(p.buffer,p.byteOffset,p.byteLength)}];for(const [name,target] of [['beauty',beautyTarget]])if(target){const v=await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height);arrays.push({name,bytes:new Uint8Array(v.buffer,v.byteOffset,v.byteLength)});}for(let i=0;i<geometryTarget.textures.length;i++){let v;if(['velocity','material'].includes(geometryTarget.textures[i].name)){const previous=renderer.getRenderTarget();renderer.setRenderTarget(depthTarget);(geometryTarget.textures[i].name==='velocity'?velocityPipeline:materialPipeline).render();renderer.setRenderTarget(previous);v=await renderer.readRenderTargetPixelsAsync(depthTarget,0,0,256,256);}else v=await renderer.readRenderTargetPixelsAsync(geometryTarget,0,0,256,256,i);arrays.push({name:'geometry-'+geometryTarget.textures[i].name,bytes:new Uint8Array(v.buffer,v.byteOffset,v.byteLength)});}const prev=renderer.getRenderTarget();renderer.setRenderTarget(depthTarget);depthPipeline.render();renderer.setRenderTarget(prev);const d=await renderer.readRenderTargetPixelsAsync(depthTarget,0,0,256,256);arrays.push({name:'geometry-depth',bytes:new Uint8Array(d.buffer,d.byteOffset,d.byteLength)});if(aoTarget){renderer.setRenderTarget(depthTarget);aoPipeline.render();renderer.setRenderTarget(prev);const v=await renderer.readRenderTargetPixelsAsync(depthTarget,0,0,256,256);arrays.push({name:'ao',bytes:new Uint8Array(v.buffer,v.byteOffset,v.byteLength)});}return arrays;};
   return{renderer,sun,draw,read,scene,camera,materials,texture,bone,skin,instances,dispose(){pipeline.dispose();depthPipeline.dispose();aoPipeline.dispose();velocityPipeline.dispose();materialPipeline.dispose();depthTarget.dispose();output?.dispose();renderer.dispose();geometry.dispose();skinGeometry.dispose();planeGeometry.dispose();planeMaterial.dispose();extraMaterial.dispose();texture.dispose();environment.dispose();for(const m of materials)m.dispose();}};
  }
  const before=await create(false),after=await create(true),cases=[];let shots=null;
  try{
   const compare=async name=>{before.draw();after.draw();const a=await before.read(),b=await after.read();const attachments=a.map((v,i)=>{let differences=0,max=0;for(let k=0;k<v.bytes.length;k++){if(v.bytes[k]!==b[i].bytes[k])differences++;max=Math.max(max,Math.abs(v.bytes[k]-b[i].bytes[k]));}const unique=new Set(v.bytes);if(v.name==='full-post'&&unique.size<5)throw new Error('Empty attachment '+v.name);return{name:v.name,type:v.type,array:v.array,distinctBytes:unique.size,range:[Math.min(...unique),Math.max(...unique)],bytes:v.bytes.length,differences,max};});cases.push({name,attachments});};
   await compare('initial');for(const r of[before,after]){r.sun.shadow.autoUpdate=false;r.sun.shadow.needsUpdate=false;}await compare('cached-shadow');shots=[before.renderer.domElement.toDataURL(),after.renderer.domElement.toDataURL()];
   const times={before:[],after:[]};for(let i=0;i<30;i++){for(const name of i%2?['after','before']:['before','after']){const start=performance.now();(name==='before'?before:after).draw();times[name].push(performance.now()-start);}await new Promise(r=>setTimeout(r,0));}
   for(const r of[before,after]){r.camera.position.x=.5;r.camera.lookAt(0,0,0);r.bone.rotation.z=.6;}await compare('camera-and-skin');
   for(const r of[before,after])r.sun.shadow.needsUpdate=true;await compare('shadow-refreshed');await compare('shadow-reused-again');
   for(const r of[before,after]){r.sun.shadow.needsUpdate=true;r.texture.image.data[3]=0;r.texture.needsUpdate=true;r.materials[1].roughness=.95;r.materials[2].metalness=.8;}await compare('alpha-and-material');
   if(uvMath||motion||materialLayout){for(const r of[before,after]){r.texture.rotation=.4;r.texture.center.set(.5,.5);r.sun.shadow.needsUpdate=true;}await compare('rotated-texture');for(const r of[before,after]){const light=new T.PointLight(0xffffff,6,30);light.position.set(2,3,4);light.castShadow=true;light.shadow.mapSize.set(64,64);r.scene.add(light);}await compare('late-point-shadow');}
   if(materialLayout){for(const r of[before,after]){const data=new Uint8Array(256*4);for(let i=0;i<256;i++)data.set([255,i,255-i,255],i*4);r.texture.dispose();r.texture.image={data,width:256,height:1};r.texture.needsUpdate=true;for(const m of r.materials){m.metalness=1;m.roughness=1;m.metalnessMap=r.texture;m.roughnessMap=r.texture;m.needsUpdate=true;}r.sun.shadow.needsUpdate=true;}await compare('all-8-bit-material-levels');}
   const timing=Object.fromEntries(Object.entries(times).map(([k,v])=>[k,v.sort((a,b)=>a-b)[15]]));return{cases,timing,shots};
  }finally{before.dispose();after.dispose();T.Matrix3.prototype.setUvTransform=nativeUv;}
 },{root:'/@fs'+process.cwd()+'/',webgpu,effect:process.env.AETHER_BENCH_EFFECTS??'all',control:process.env.AETHER_BENCH_CONTROL==='1',uvMath:process.env.AETHER_BENCH_UV_MATH==='1',motion:process.env.AETHER_BENCH_MOTION_LAYOUT==='1',materialLayout:process.env.AETHER_BENCH_MATERIAL_LAYOUT==='1'});
 for(let i=0;i<result.shots.length;i++)await writeFile('/tmp/aether-post-'+(process.env.AETHER_BENCH_UV_MATH==='1'?'uv':'prepass')+'-'+i+'.png',Buffer.from(result.shots[i].split(',')[1],'base64'));delete result.shots;
 console.log(JSON.stringify({backend:webgpu?'webgpu':'webgl2',browser:firefoxMode?'firefox':'chromium',errors,...result},null,2));if(errors.length||result.cases.some(c=>c.attachments.some(a=>a.differences)))process.exitCode=1;
}finally{await browser.close();}

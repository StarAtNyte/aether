/** Full byte comparison of geometry MRT outputs with scene lighting enabled versus disabled. */
import { chromium, firefox } from 'playwright';
const webgpu=process.env.AETHER_BENCH_WEBGPU==='1', firefoxMode=process.env.AETHER_BENCH_BROWSER==='firefox';
const browser=await(firefoxMode?firefox.launch({headless:process.env.AETHER_BENCH_HEADED!=='1',firefoxUserPrefs:{'webgl.force-enabled':true}}):chromium.launch({args:webgpu?['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader']:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']}));
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,500));});
 const rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);if(!firefoxMode&&rate>1)await(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate});
 await page.route('**/geometry-prepass-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/geometry-prepass-probe');
 const result=await page.evaluate(async({root,webgpu})=>{
  const {T,S}=await import(root+'scripts/bench/graph-browser-engine.mjs');
  async function create(unlit){
   const renderer=new T.WebGPURenderer({forceWebGL:!webgpu,antialias:false});await renderer.init();if(webgpu&&!renderer.backend.isWebGPUBackend)throw new Error('WebGPU unavailable');renderer.setSize(256,256);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
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

   const pre=S.pass(scene,camera,{samples:0});pre.transparent=false;
   if(unlit){pre.lighting=new T.Lighting();pre.lighting.enabled=false;}
   pre.setMRT(S.mrt({output:S.packNormalToRGB(S.normalView),velocity:S.velocity,diffuse:S.vec4(S.diffuseColor.rgb,1),material:S.vec4(S.metalness,S.roughness,0,1)}));pre.getTexture('output').type=T.UnsignedByteType;for(const key of ['velocity','diffuse','material'])pre.getTexture(key);
   const pipeline=new T.RenderPipeline(renderer);pipeline.outputNode=pre.getTextureNode('output');
   const draw=()=>{renderer._nodes.nodeFrame.update();pipeline.render();};
   for(let i=0;i<5;i++)draw();
   const depthTarget=new T.RenderTarget(256,256,{type:T.FloatType}),depthPipeline=new T.RenderPipeline(renderer);depthPipeline.outputColorTransform=false;depthPipeline.outputNode=S.vec4(S.texture(pre.renderTarget.depthTexture).r,0,0,1);
   const read=async()=>{const arrays=[];for(let i=0;i<pre.renderTarget.textures.length;i++){const p=await renderer.readRenderTargetPixelsAsync(pre.renderTarget,0,0,256,256,i);arrays.push({name:pre.renderTarget.textures[i].name,type:pre.renderTarget.textures[i].type,array:p.constructor.name,bytes:new Uint8Array(p.buffer,p.byteOffset,p.byteLength)});}const prev=renderer.getRenderTarget();renderer.setRenderTarget(depthTarget);depthPipeline.render();renderer.setRenderTarget(prev);const d=await renderer.readRenderTargetPixelsAsync(depthTarget,0,0,256,256);arrays.push({name:'depth',array:d.constructor.name,type:T.FloatType,bytes:new Uint8Array(d.buffer,d.byteOffset,d.byteLength)});return arrays;};
   return{renderer,draw,read,scene,camera,materials,texture,bone,skin,instances,pre,dispose(){pipeline.dispose();depthPipeline.dispose();depthTarget.dispose();pre.dispose();renderer.dispose();geometry.dispose();skinGeometry.dispose();planeGeometry.dispose();planeMaterial.dispose();extraMaterial.dispose();texture.dispose();environment.dispose();for(const m of materials)m.dispose();}};
  }
  const before=await create(false),after=await create(true),cases=[];
  try{
   const compare=async name=>{before.draw();after.draw();const a=await before.read(),b=await after.read();const attachments=a.map((v,i)=>{let differences=0,max=0;for(let k=0;k<v.bytes.length;k++){if(v.bytes[k]!==b[i].bytes[k])differences++;max=Math.max(max,Math.abs(v.bytes[k]-b[i].bytes[k]));}const unique=new Set(v.bytes);if(v.name!=='velocity'&&unique.size<5)throw new Error('Empty attachment '+v.name);return{name:v.name,type:v.type,array:v.array,distinctBytes:unique.size,bytes:v.bytes.length,differences,max};});cases.push({name,attachments});};
   await compare('initial');
   const times={before:[],after:[]};for(let i=0;i<30;i++){for(const name of i%2?['after','before']:['before','after']){const start=performance.now();(name==='before'?before:after).draw();times[name].push(performance.now()-start);}await new Promise(r=>setTimeout(r,0));}
   for(const r of[before,after]){r.camera.position.x=.5;r.camera.lookAt(0,0,0);r.bone.rotation.z=.6;}await compare('camera-and-skin');
   for(const r of[before,after]){r.texture.image.data[3]=0;r.texture.needsUpdate=true;r.materials[1].roughness=.95;r.materials[2].metalness=.8;}await compare('alpha-and-material');
   const timing=Object.fromEntries(Object.entries(times).map(([k,v])=>[k,v.sort((a,b)=>a-b)[15]]));return{cases,timing};
  }finally{before.dispose();after.dispose();}
 },{root:'/@fs'+process.cwd()+'/',webgpu});
 console.log(JSON.stringify({backend:webgpu?'webgpu':'webgl2',browser:firefoxMode?'firefox':'chromium',errors,...result},null,2));if(errors.length||result.cases.some(c=>c.attachments.some(a=>a.differences)))process.exitCode=1;
}finally{await browser.close();}

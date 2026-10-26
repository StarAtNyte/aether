/** Actual shaders, MRT/context/transparent/shadow images and warm CPU cost, baseline versus deferred setup. */
import { chromium, firefox } from 'playwright';
import { writeFile } from 'node:fs/promises';
const webgpu = process.env.AETHER_BENCH_WEBGPU === '1';
const browserName = process.env.AETHER_BENCH_BROWSER ?? 'chromium';
const browser = await (browserName === 'firefox' ? firefox.launch({ headless: process.env.AETHER_BENCH_HEADED !== '1', firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false, 'webgl.enable-webgl2': true } }) : chromium.launch({ args: webgpu ? ['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader'] : ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] }));
try {
  const page = await browser.newPage({viewport:{width:800,height:600}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text().slice(0,500)); });
  await page.route('**/graph-preparation-probe', route => route.fulfill({ contentType:'text/html',body:'<!doctype html><title>Render preparation</title>' }));
  await page.goto(`${process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177'}/graph-preparation-probe`);
  const results = await page.evaluate(async ({root,webgpu,uvMath}) => {
    const { T, S, parallelPrograms, deferRenderPreparation, prepareCompileTextures } = await import(root + 'scripts/bench/graph-browser-engine.mjs');
    const {specializeUvTransform}=await import(root+'packages/render/src/gpu/uv-transform.ts');
    const nativeUv=T.Matrix3.prototype.setUvTransform,fastUv=uvMath?specializeUvTransform(nativeUv):nativeUv;
    if(uvMath&&fastUv===nativeUv)throw new Error('UV specialization unavailable');
    async function measure(deferred, mode, compile = false) {
      T.Matrix3.prototype.setUvTransform=deferred?fastUv:nativeUv;
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const renderer = new T.WebGPURenderer({canvas,forceWebGL:!webgpu,antialias:false}); await renderer.init();renderer.setSize(256,256);
      if(webgpu&&!renderer.backend.isWebGPUBackend)throw new Error('WebGPU was requested but unavailable');
      renderer.toneMapping=T.ACESFilmicToneMapping; renderer.outputColorSpace=T.SRGBColorSpace;
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
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
      const beauty=S.pass(scene,camera,{samples:0});
      beauty.contextNode=S.context({getAO:()=>S.float(.67)});
      const pre=S.pass(scene,camera,{samples:0});pre.transparent=false;
      pre.setMRT(S.mrt({output:S.vec4(S.normalView.mul(.5).add(.5),1),material:S.vec4(S.roughness,S.metalness,0,1)}));
      const pipeline=new T.RenderPipeline(renderer);
      pipeline.outputNode=mode==='mrt'?pre.getTextureNode('material'):mode==='post'?beauty.getTextureNode().mul(.9).add(pre.getTextureNode('material').mul(.1)):beauty.getTextureNode();
      // A generated, non-template material bundle exercises multiple cold uploads per object.
      const materialTextures=[];
      if(compile)for(let i=0;i<materials.length;i++)for(const [j,key]of ['map','roughnessMap','metalnessMap','normalMap'].entries()){
        const size=i<4?512:128,data=new Uint8Array(size*size*4);
        for(let k=0;k<data.length;k+=4){data[k]=key==='normalMap'?128:(i*29+j*47+k/4)%192+32;data[k+1]=128;data[k+2]=key==='normalMap'?255:160;data[k+3]=255;}
        const map=new T.DataTexture(data,size,size);map.needsUpdate=true;materials[i][key]=map;materials[i].needsUpdate=true;materialTextures.push(map);
      }
      const programs=deferred?parallelPrograms(renderer.backend,()=>{},e=>{throw e;}):{pending:0,dispose(){},idle:async()=>{}};
      const compileTextures=deferred?prepareCompileTextures(renderer):null;
      const preparationErrors=[];
      const preparation=deferred?deferRenderPreparation(renderer,{blocked:()=>programs.pending>0,atomic:draw=>programs.synchronous(draw),ready(){},error(e){preparationErrors.push(String(e));}}):null;
      const r={renderer,programs,requestRender(){},drawReady(){mode==='raw'?renderer.render(scene,camera):pipeline.render();},render(){if(preparation?.pending)return false;renderer._nodes.nodeFrame.update();this.drawReady();return !preparation?.pending&&!programs.pending;},dispose(){compileTextures?.dispose();preparation?.dispose();programs.dispose();renderer.dispose();}};
      if(compile)await renderer.compileAsync(scene,camera);
      const deadline=performance.now()+60000;
      let frames=0;
      const settle=async()=>{
        let stable=0;
        while(stable<4){
          const complete=r.render();frames++;
          await new Promise(resolve=>setTimeout(resolve,8));
          const stats=preparation?{pending:preparation.pending,errors:preparationErrors}:null;
          if(complete&&!programs.pending&&!preparation?.pending)stable++;else stable=0;
          if(performance.now()>deadline)throw new Error('Preparation timeout '+JSON.stringify(stats));
        }
      };
      await settle();
      // Dispose an object after discovery but before its queued setup can run.
      const transientGeometry=geometry.clone(),transientMaterial=new T.MeshStandardMaterial({color:0xff0000});
      const transient=new T.Mesh(transientGeometry,transientMaterial);scene.add(transient);r.render();scene.remove(transient);transientGeometry.dispose();transientMaterial.dispose();
      // Invalidate a visible program after the first completed image.
      materials[1].map=texture;materials[1].side=T.DoubleSide;materials[1].transparent=true;materials[1].opacity=.55;materials[1].needsUpdate=true;
      await settle();
      if(uvMath){texture.offset.set(.13,.21);texture.repeat.set(1.7,.8);texture.center.set(.5,.5);texture.rotation=.4;await settle();texture.rotation=-0;await settle();}
      let readTarget=null;
      if(webgpu){
        readTarget=new T.RenderTarget(256,256,{type:T.UnsignedByteType,depthBuffer:true});
        renderer.setOutputRenderTarget(readTarget);renderer.setRenderTarget(null);await settle();
      }
      // No temporal randomness: a complete graph must produce identical RGBA bytes.
      for(let i=0;i<4;i++)r.render();
      const gl=renderer.backend.gl,pixels=webgpu?await renderer.readRenderTargetPixelsAsync(readTarget,0,0,256,256):new Uint8Array(256*256*4);if(gl)gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      const timings=[];
      for(let round=0;round<5;round++){const start=performance.now();for(let i=0;i<20;i++)r.render();timings.push((performance.now()-start)/20);await new Promise(resolve=>setTimeout(resolve,0));}
      r.render();const debugURL=canvas.toDataURL('image/png');
      const sample=[...renderer._objects._renderObjects].find(o=>o.object.material===materials[1]&&o.material===materials[1]);
      const debug=sample?{fragment:sample.getNodeBuilderState().fragmentShader,lights:sample.lightsNode.getLights?.().map(l=>l.type),bindings:sample.getBindings().map(g=>({name:g.name,values:g.bindings.filter(b=>b.isUniformBuffer).map(b=>Array.from(b.buffer??[]))}))}:null;
      const state=preparation?{pending:preparation.pending,errors:preparationErrors}:null,error=gl?gl.getError():0;
      const colors=new Set();for(let i=0;i<pixels.length;i+=64)colors.add(pixels[i]+','+pixels[i+1]+','+pixels[i+2]);
      readTarget?.dispose();r.dispose();for(const map of materialTextures)map.dispose();geometry.dispose();skinGeometry.dispose();skin.skeleton.boneTexture?.dispose();extraMaterial.dispose();planeGeometry.dispose();planeMaterial.dispose();texture.dispose();environment.dispose();for(const material of materials)material.dispose();beauty.dispose();pre.dispose();pipeline.dispose();canvas.remove();
      return{debug,debugURL,pixels:Array.from(pixels),frames,state,error,colors:colors.size,cpuMedianMs:timings.sort((a,b)=>a-b)[2]};
    }
    const results=[];
    for(const mode of ['raw','beauty','mrt','post','compile']){
      const before=await measure(false,mode==='compile'?'raw':mode,mode==='compile'),after=await measure(true,mode==='compile'?'raw':mode,mode==='compile');let differences=0,maxDelta=0;
      for(let i=0;i<before.pixels.length;i++){if(before.pixels[i]!==after.pixels[i])differences++;maxDelta=Math.max(maxDelta,Math.abs(before.pixels[i]-after.pixels[i]));}
      delete before.pixels;delete after.pixels;results.push({mode,differences,maxDelta,before,after});
    }
    T.Matrix3.prototype.setUvTransform=nativeUv;return results;
  },{root:'/@fs'+process.cwd()+'/',webgpu,uvMath:process.env.AETHER_BENCH_UV_MATH==='1'});
  for (const r of results) for (const phase of ['before','after']) {
    await writeFile('/tmp/aether-graph-' + r.mode + '-' + phase + '.png', Buffer.from(r[phase].debugURL.split(',')[1], 'base64'));
    await writeFile('/tmp/aether-graph-' + r.mode + '-' + phase + '-debug.json', JSON.stringify(r[phase].debug,null,2));
    delete r[phase].debug;
    delete r[phase].debugURL;
  }
  console.log(JSON.stringify({browser:browserName,backend:webgpu?'webgpu':'webgl2',errors,results},null,2));
  if(errors.length||results.some(r=>r.differences||r.before.error||r.after.error||r.before.colors<10||r.after.colors<10||r.after.state.errors.length))process.exitCode=1;
}finally{await browser.close();}

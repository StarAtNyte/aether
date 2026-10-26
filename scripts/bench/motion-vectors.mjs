/** Signed temporal motion through the actual post chain; compare compact RG16F with RGBA16F and the current runtime. */
import { chromium, firefox } from 'playwright';
const fx=process.env.AETHER_BENCH_BROWSER==='firefox',webgpu=process.env.AETHER_BENCH_WEBGPU==='1',format=process.env.AETHER_BENCH_MOTION_FORMAT??'native';
const browser=await(fx?firefox.launch({headless:process.env.AETHER_BENCH_HEADED!=='1',firefoxUserPrefs:{'webgl.force-enabled':true}}):chromium.launch({args:webgpu?['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader']:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']}));
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,500));});
 await page.route('**/packages/render/src/gpu/post.ts?motion-experiment',async route=>{
  const response=await route.fetch(),body=await response.text(),pattern=/motionTexture\.format = RGFormat;/;
  if(!pattern.test(body))throw new Error('Motion format experiment no longer matches post.ts');
  let edited=body.replace(pattern,`motionTexture.format = three.${format==='rg16f'?'RGFormat':'RGBAFormat'};`);if(format==='rgba8'){const type=/motionTexture\.type = HalfFloatType;/;if(!type.test(edited))throw new Error('Legacy motion type edit no longer matches');edited=edited.replace(type,'motionTexture.type = three.UnsignedByteType;');}await route.fulfill({response,body:edited});
 });
 await page.route('**/motion-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/motion-probe');
 const result=await page.evaluate(async({root,webgpu,format})=>{
  const {T,S}=await import(root+'scripts/bench/graph-browser-engine.mjs');
  const {createPostPipeline}=await import(root+'packages/render/src/gpu/post.ts'+(format==='native'?'':'?motion-experiment'));
  const renderer=new T.WebGPURenderer({forceWebGL:!webgpu,antialias:false});await renderer.init();renderer.setSize(128,128);
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(90,1,.1,100);camera.position.z=5;camera.updateMatrixWorld();
  const geometry=new T.PlaneGeometry(2,2),material=new T.MeshBasicMaterial({color:0x55bb88}),mesh=new T.Mesh(geometry,material);scene.add(mesh);
  let target=null;const render=renderer.render;renderer.render=function(s,c,...args){if(s===scene&&this.getMRT()?.has('velocity'))target=this.getRenderTarget();return render.call(this,s,c,...args);};
  const pipeline=await createPostPipeline(renderer,scene,camera,0,'studio',{effects:{composite:true,ao:false,gi:false,taa:true,contact:false,ssr:false,shafts:false,halation:false,aberration:false,grain:false,dof:false}});if(!pipeline)throw new Error('Pipeline failed');
  const output=new T.RenderTarget(128,128,{type:T.UnsignedByteType});renderer.setOutputRenderTarget(output);
  let frame=0;const draw=()=>{const nf=renderer._nodes.nodeFrame;nf.frameId=++frame;nf.time=3;nf.deltaTime=1/60;pipeline.render();};
  for(let i=0;i<5;i++)draw();if(!target)throw new Error('No velocity attachment');
  const index=target.textures.findIndex(t=>t.name==='velocity'),texture=target.textures[index];if(!texture)throw new Error('Missing velocity texture');
  const copyTarget=new T.RenderTarget(128,128,{type:T.FloatType}),copy=new T.RenderPipeline(renderer);copy.outputColorTransform=false;copy.outputNode=S.vec4(S.texture(texture).rg,0,1);
  const cases=[];let x=0,y=0;
  for(const [name,dx,dy] of [['right',.5,0],['left',-.5,0],['up',0,.5],['down',0,-.5],['diagonal',-.25,.25],['small',.001,-.001],['still',0,0]]){
   x+=dx;y+=dy;mesh.position.set(x,y,0);draw();const previous=renderer.getRenderTarget();renderer.setRenderTarget(copyTarget);copy.render();renderer.setRenderTarget(previous);
   const values=await renderer.readRenderTargetPixelsAsync(copyTarget,0,0,128,128);const i=(64*128+64)*4;
   cases.push({name,expected:[dx/5,dy/5],actual:[values[i],values[i+1]],maxError:Math.max(Math.abs(values[i]-dx/5),Math.abs(values[i+1]-dy/5))});
  }
  const layout={type:texture.type,format:texture.format,width:texture.image.width,height:texture.image.height};
  copy.dispose();pipeline.dispose();copyTarget.dispose();output.dispose();geometry.dispose();material.dispose();renderer.dispose();return{layout,cases};
 },{root:'/@fs'+process.cwd()+'/',webgpu,format});
 console.log(JSON.stringify({browser:fx?'firefox':'chromium',webgpu,format,errors,...result},null,2));if(errors.length||result.cases.some(c=>c.maxError>Math.max(0.000002,...c.expected.map(v=>Math.abs(v)*0.001))))process.exitCode=1;
}finally{await browser.close();}

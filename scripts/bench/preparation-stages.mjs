/** Real cold multi-map objects: old/new preparation callback spans, not simulated job durations. */
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,500));});
 await page.route('**/prep-stages-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/prep-stages-probe');
 const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});
 const result=await page.evaluate(async root=>{
  const {T,parallelPrograms,deferRenderPreparation}=await import(root+'scripts/bench/graph-browser-engine.mjs');
  const before=await import(root+'scripts/bench/render-preparation-reference.ts');
  const {cachePixelStoreState}=await import(root+'packages/render/src/gpu/pixel-store-cache.ts');
  async function measure(staged){
   const renderer=new T.WebGPURenderer({forceWebGL:true,antialias:false});await renderer.init();renderer.setSize(128,128);cachePixelStoreState(renderer.backend);
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,1,.1,50);camera.position.set(0,0,8);
   scene.add(new T.HemisphereLight(0xffffff,0x445566,3));
   const geometry=new T.BoxGeometry(.8,.8,.8),materials=[],textures=[];
   for(let i=0;i<8;i++){
    const material=new T.MeshStandardMaterial({color:new T.Color().setHSL(i/8,.6,.5),roughness:.7});
    for(const name of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']){
     const pixels=new Uint8Array(1024*1024*4);pixels.fill(128);for(let k=3;k<pixels.length;k+=4)pixels[k]=255;
     const texture=new T.DataTexture(pixels,1024,1024);texture.generateMipmaps=true;texture.minFilter=T.LinearMipmapLinearFilter;texture.needsUpdate=true;
     material[name]=texture;textures.push(texture);
    }
    const mesh=new T.Mesh(geometry,material);mesh.position.set(i%4-1.5,Math.floor(i/4)-.5,0);scene.add(mesh);materials.push(material);
   }
   const spans=[],drawSpans=[],prepErrors=[];
   const inputs=new Set(textures),manager=renderer._textures,updateTexture=manager.updateTexture;
   let drawing=false,drawUploads=0,preparationUploads=0;
   manager.updateTexture=function(texture,...args){
    const data=this.get(texture);
    if(inputs.has(texture)&&(!data.initialized||data.version!==texture.version)){if(drawing)drawUploads++;else preparationUploads++;}
    return updateTexture.call(this,texture,...args);
   };let callbacks=0;
   const programs=parallelPrograms(renderer.backend,()=>{},e=>prepErrors.push(String(e)));
   const preparation=(staged?deferRenderPreparation:before.deferRenderPreparation)(renderer,{blocked:()=>programs.pending>0,atomic:fn=>programs.synchronous(fn),ready(){},error:e=>prepErrors.push(String(e)),channel:()=>{
    const channel=new MessageChannel();return{port1:{set onmessage(handler){channel.port1.onmessage=e=>{const start=performance.now();try{handler(e);}finally{spans.push(performance.now()-start);callbacks++;}};},close(){channel.port1.close();}},port2:channel.port2};
   }});
   const start=performance.now(),deadline=start+60000;let stable=0;
   while(stable<3){
    if(!preparation.pending){const drawStart=performance.now();drawing=true;try{renderer.render(scene,camera);}finally{drawing=false;}drawSpans.push(performance.now()-drawStart);if(!preparation.pending&&!programs.pending)stable++;else stable=0;}
    if(performance.now()>deadline)throw new Error('Preparation deadline');await new Promise(r=>setTimeout(r,1));
   }
   const elapsedMs=performance.now()-start,gl=renderer.backend.gl,pixels=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   const colors=new Set();for(let i=0;i<pixels.length;i+=4)colors.add(pixels[i]+','+pixels[i+1]+','+pixels[i+2]);
   if(colors.size<10||gl.getError()!==0)throw new Error('Invalid rendered comparison frame');
   preparation.dispose();programs.dispose();renderer.dispose();geometry.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
   return{elapsedMs,colors:colors.size,drawUploads,preparationUploads,maxDrawMs:Math.max(...drawSpans),maxCallbackMs:Math.max(...spans),callbacks,pixels:Array.from(pixels),errors:prepErrors};
  }
  const results=[];
  for(let round=0;round<3;round++){
   let a,b;if(round%2){b=await measure(true);a=await measure(false);}else{a=await measure(false);b=await measure(true);}
   let differences=0;for(let i=0;i<a.pixels.length;i++)if(a.pixels[i]!==b.pixels[i])differences++;
   delete a.pixels;delete b.pixels;results.push({round,differences,before:a,after:b});
  }
  return results;
 },'/@fs'+process.cwd()+'/');
 console.log(JSON.stringify({errors,results:result},null,2));if(errors.length||result.some(r=>r.differences||r.before.errors.length||r.after.errors.length))process.exitCode=1;
}finally{await browser.close();}

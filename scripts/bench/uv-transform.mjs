/** Native versus exact zero-rotation UV math; no skipped matrix writes or shader changes. */
import {chromium,firefox} from 'playwright';
const fx=process.env.AETHER_BENCH_BROWSER==='firefox',rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);
const browser=await(fx?firefox.launch({headless:process.env.AETHER_BENCH_HEADED!=='1',firefoxUserPrefs:{'webgl.force-enabled':true}}):chromium.launch({args:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']}));
try{
 const page=await browser.newPage();if(!fx&&rate>1)await(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate});
 await page.route('**/uv-math-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/uv-math-probe');
 const results=await page.evaluate(async root=>{
  const {T}=await import(root+'scripts/bench/graph-browser-engine.mjs'),{specializeUvTransform}=await import(root+'packages/render/src/gpu/uv-transform.ts');
  const native=T.Matrix3.prototype.setUvTransform,fast=specializeUvTransform(native);if(fast===native)throw new Error('Native source guard did not match');
  const results=[];
  for(const mode of['zero','signed-zero','mixed','nonzero']){
   const input=new Float64Array(64*7);for(let i=0;i<64;i++)input.set([i*.003,-i*.002,.5+i*.03,1+i*.02,mode==='zero'?0:mode==='signed-zero'?(i%2?-0:0):mode==='mixed'?(i%8?0:i*.07):i*.07+.1,.2,.5],i*7);
   const run=(fn,count)=>{const m=new T.Matrix3();let digest=0;const start=performance.now();for(let i=0;i<count;i++){const j=(i%64)*7;fn.call(m,input[j],input[j+1],input[j+2],input[j+3],input[j+4],input[j+5],input[j+6]);digest+=m.elements[i%9];}return{ms:performance.now()-start,digest,bits:Array.from(new Uint32Array(new Float64Array(m.elements).buffer))};};
   run(native,20000);run(fast,20000);const pairs=[];
   for(let i=0;i<7;i++){const a=run(i%2?fast:native,200000),b=run(i%2?native:fast,200000),before=i%2?b:a,after=i%2?a:b;if(before.digest!==after.digest||before.bits.some((v,j)=>v!==after.bits[j]))throw new Error('UV mismatch');pairs.push({beforeMs:before.ms,afterMs:after.ms});await new Promise(r=>setTimeout(r,0));}
   const median=key=>pairs.map(p=>p[key]).sort((a,b)=>a-b)[3];results.push({mode,callsPerRun:200000,beforeMs:median('beforeMs'),afterMs:median('afterMs'),pairs});
  }return results;
 },'/@fs'+process.cwd()+'/');
 console.log(JSON.stringify({browser:fx?'firefox':'chromium',cpuRate:rate,results},null,2));
}finally{await browser.close();}

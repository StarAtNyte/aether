/** Exact old/new noise pixels and interleaved CPU timings for first-use surface variation. */
import {chromium,firefox} from 'playwright';
const browserName=process.env.AETHER_BENCH_BROWSER??'chromium';
const browser=await(browserName==='firefox'?firefox:chromium).launch();
try{
 const page=await browser.newPage();await page.route('**/material-noise-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/material-noise-probe');
 const rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);if(!Number.isFinite(rate)||rate<1||rate>20)throw new Error('Invalid CPU rate');
 if(browserName==='firefox'&&rate!==1)throw new Error('CPU slowdown requires Chromium');
 if(browserName!=='firefox'){const s=await page.context().newCDPSession(page);await s.send('Emulation.setCPUThrottlingRate',{rate});}
 const results=await page.evaluate(async root=>{
  const before=await import(root+'scripts/bench/material-noise-reference.ts'),after=await import(root+'packages/render/src/materials/noise-texture.ts');
  const results=[];
  for(const [size,period]of [[256,16],[64,3],[257,7]]){
   const t0=performance.now(),a=before.noisePixels(size,period),firstBeforeMs=performance.now()-t0;
   const t1=performance.now(),b=after.noisePixels(size,period),firstAfterMs=performance.now()-t1;let differences=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences++;
   if(differences)throw new Error('Material noise pixels differ');
   const timings={before:[],after:[]};for(let r=0;r<20;r++){
    for(const mode of r%2?['before','after']:['after','before']){const t=performance.now();(mode==='before'?before:after).noisePixels(size,period);timings[mode].push(performance.now()-t);}
    await new Promise(resolve=>setTimeout(resolve,0));
   }
   results.push({size,period,differences,firstBeforeMs,firstAfterMs,beforeMs:timings.before.sort((a,b)=>a-b)[10],afterMs:timings.after.sort((a,b)=>a-b)[10]});
  }
  return results;
 },'/@fs'+process.cwd()+'/');console.log(JSON.stringify({browser:browserName,cpuRate:rate,results},null,2));
}finally{await browser.close();}

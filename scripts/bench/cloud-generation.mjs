/** Exact old/new cloud generation and cold CPU cost on generated coverage/sun cases. */
import {chromium,firefox} from 'playwright';
const browserName=process.env.AETHER_BENCH_BROWSER??'chromium';
const browser=await (browserName==='firefox'?firefox:chromium).launch();
try{
 const page=await browser.newPage();await page.route('**/cloud-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/cloud-probe');
 const rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);if(!Number.isFinite(rate)||rate<1||rate>20)throw new Error('Invalid CPU rate');
 if(browserName==='firefox'&&rate!==1)throw new Error('CPU throttling requires Chromium');
 if(browserName!=='firefox'){const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate});}
 const result=await page.evaluate(async root=>{
  const before=await import(root+'scripts/bench/cloud-reference.ts'),after=await import(root+'packages/render/src/environment/clouds.ts');
  const results=[];
  for(const stretch of [1,4]){
   const start=performance.now(),old=before.fractalNoise(256,0xc10d5,stretch),nativeMs=performance.now()-start;
   const nextStart=performance.now(),next=after.fractalNoise(256,0xc10d5,stretch),optimizedMs=performance.now()-nextStart;
   const a=new Uint8Array(old.buffer),b=new Uint8Array(next.buffer);let differences=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences++;
   const pixels=[];for(const cover of [.05,.4,.95]){
    const sun={x:1.5,y:-2.5},a=before.cloudPixels(256,cover,old,sun);
    const b=after.cloudPixels(256,cover,next,sun);
    let differences=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences++;pixels.push({cover,differences});
   }
   results.push({stretch,differences,nativeMs,optimizedMs,pixels});
  }
  return results;
 },'/@fs'+process.cwd()+'/');console.log(JSON.stringify({browser:browserName,cpuRate:rate,results:result},null,2));if(result.some(r=>r.differences||r.pixels.some(p=>p.differences)))process.exitCode=1;
}finally{await browser.close();}

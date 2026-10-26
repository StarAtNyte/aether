/** Real browser task scheduling: frozen old queue versus reusable-channel indexed queue. */
import {chromium,firefox} from 'playwright';
const browserName=process.env.AETHER_BENCH_BROWSER??'chromium';
const browser=await(browserName==='firefox'?firefox:chromium).launch();
try{
 const page=await browser.newPage();await page.route('**/task-queue-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/task-queue-probe');
 const rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);if(!Number.isFinite(rate)||rate<1||rate>20)throw new Error('Invalid CPU rate');
 if(browserName==='firefox'&&rate!==1)throw new Error('CPU slowdown requires Chromium');
 if(browserName!=='firefox'){const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate});}
 const result=await page.evaluate(async root=>{
  const old=await import(root+'scripts/bench/task-queue-reference.ts'),next=await import(root+'packages/render/src/gpu/task-queue.ts');
  const NativeChannel=globalThis.MessageChannel;let channels=0;
  globalThis.MessageChannel=function(){channels++;return new NativeChannel();};
  const results=[];
  try{
   for(const scenario of ['batch','sequence']){
    const rounds=[];
    for(let round=0;round<6;round++)for(const mode of round%2?['next','old']:['old','next']){
     const q=new(mode==='old'?old:next).TaskQueue(6),count=scenario==='batch'?30000:1000;
     let seen=0,last=performance.now(),maxGap=0;
     const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},4);
     const beforeChannels=channels,start=performance.now();
     const job=i=>{if(i!==seen++)throw new Error('FIFO changed');};
     if(scenario==='batch')await Promise.all(Array.from({length:count},(_,i)=>q.run(()=>job(i))));
     else for(let i=0;i<count;i++)await q.run(()=>job(i));
     const ms=performance.now()-start;
     maxGap=Math.max(maxGap,performance.now()-last);
     clearInterval(timer);if(q.pending!==0||seen!==count)throw new Error('Queue did not drain');
     rounds.push({mode,ms,channels:channels-beforeChannels,maxGap});
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    const summarize=mode=>{const own=rounds.filter(r=>r.mode===mode);return{medianMs:own.map(r=>r.ms).sort((a,b)=>a-b)[3],medianChannels:own.map(r=>r.channels).sort((a,b)=>a-b)[3],maxTimerGap:Math.max(...own.map(r=>r.maxGap))};};
    results.push({scenario,count:scenario==='batch'?30000:1000,before:summarize('old'),after:summarize('next')});
   }
  }finally{globalThis.MessageChannel=NativeChannel;}
  return results;
 },'/@fs'+process.cwd()+'/');console.log(JSON.stringify({browser:browserName,cpuRate:rate,results:result},null,2));
}finally{await browser.close();}

/** Actual dome recolouring: exact output and interleaved cache-miss/cache-hit CPU costs. */
import {chromium,firefox} from 'playwright';
const browserName=process.env.AETHER_BENCH_BROWSER??'chromium';
const browser=await(browserName==='firefox'?firefox:chromium).launch();
try{
 const page=await browser.newPage();await page.route('**/sky-cache-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/sky-cache-probe');
 const rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);if(!Number.isFinite(rate)||rate<1||rate>20)throw new Error('Invalid CPU rate');
 if(browserName==='firefox'&&rate!==1)throw new Error('CPU slowdown requires Chromium');
 if(browserName!=='firefox'){const s=await page.context().newCDPSession(page);await s.send('Emulation.setCPUThrottlingRate',{rate});}
 const results=await page.evaluate(async root=>{
  const {SkyDome}=await import(root+'packages/render/src/environment/sky-dome.ts');
  const {computeSkyState}=await import(root+'packages/render/src/environment/sky-state.ts');
  const results=[];
  for(const preset of ['day','sunset']){
   const state=computeSkyState({sky:preset,sunIntensity:2.5,ambientIntensity:.4}),cold=new SkyDome(),cached=new SkyDome();
   cold.apply(state);cached.apply(state);
   const timings={miss:[],hit:[]};
   for(let r=0;r<12;r++){
    const fog=r%2?'#8899aa':'#aabbaa';
    for(const mode of r%2?['miss','hit']:['hit','miss']){
     const d=mode==='miss'?cold:cached;
     // Explicitly force a miss for comparison; this is not a frozen previous implementation.
     if(mode==='miss')d.atmosphere=null;
     const start=performance.now();d.apply(state,fog);timings[mode].push(performance.now()-start);
    }
    const a=cold.group.children[0].geometry.getAttribute('color').array,b=cached.group.children[0].geometry.getAttribute('color').array;
    for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw new Error('Dome colours differ at '+i);
    await new Promise(resolve=>setTimeout(resolve,0));
   }
   results.push({preset,missMs:timings.miss.sort((a,b)=>a-b)[6],hitMs:timings.hit.sort((a,b)=>a-b)[6],differences:0});cold.dispose();cached.dispose();
  }
  return results;
 },'/@fs'+process.cwd()+'/');console.log(JSON.stringify({browser:browserName,cpuRate:rate,results},null,2));
}finally{await browser.close();}

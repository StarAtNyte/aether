/** Packed procedural bounds versus the native box+sphere path, exact results and interleaved CPU timings. */
import { chromium } from 'playwright';
const browser=await chromium.launch();
try {
  const page=await browser.newPage();
  await page.route('**/position-bounds-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/position-bounds-probe');
  const session=await page.context().newCDPSession(page);
  const rate=Number(process.env.AETHER_BENCH_CPU_RATE??1);
  if(!Number.isFinite(rate)||rate<1||rate>20)throw new Error('Invalid CPU rate');
  await session.send('Emulation.setCPUThrottlingRate',{rate});
  const results=await page.evaluate(async root=>{
    const {T,setPositionBounds}=await import(root+'scripts/bench/graph-browser-engine.mjs');
    const results=[];
    for(const count of [0,100,10000,500000]){
      const p=new Float32Array(count*3);for(let i=0;i<p.length;i++)p[i]=Math.sin(i*.133)*200;
      const a=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p,3)),b=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p,3));
      const native=()=>{a.computeBoundingBox();a.computeBoundingSphere();},packed=()=>setPositionBounds(b,p);
      for(let i=0;i<20;i++){native();packed();}
      const times={native:[],packed:[]};
      for(let round=0;round<30;round++){
        for(const key of round%2?['native','packed']:['packed','native']){
          const start=performance.now();for(let j=0;j<5;j++)(key==='native'?native:packed)();times[key].push((performance.now()-start)/5);
        }
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const box=a.boundingBox.equals(b.boundingBox),sphere=a.boundingSphere.equals(b.boundingSphere);
      if(!box||!sphere)throw new Error('Bounds differ at '+count);
      results.push({count,box,sphere,nativeMs:times.native.sort((a,b)=>a-b)[15],packedMs:times.packed.sort((a,b)=>a-b)[15]});a.dispose();b.dispose();
    }
    return results;
  },'/@fs'+process.cwd()+'/');
  console.log(JSON.stringify({cpuRate:rate,results},null,2));
}finally{await browser.close();}

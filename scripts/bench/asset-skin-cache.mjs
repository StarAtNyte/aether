/** Repeated low-tier skin classification on generated static and skinned asset hierarchies. */
import { chromium } from 'playwright';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.route('**/skin-cache-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5177')+'/skin-cache-probe');
 const result=await page.evaluate(async root=>{
  const {T,AssetSkinCache}=await import(root+'scripts/bench/graph-browser-engine.mjs');
  const nodes=[];for(let i=0;i<1000;i++){const content=new T.Group();for(let j=0;j<40;j++)content.add(new T.Group());if(i%50===0)content.add(new T.SkinnedMesh());nodes.push({content,token:1,pending:false,placeholder:false});}
  const old=new Map(),cache=new AssetSkinCache();
  const baseline=()=>{let count=0;for(let i=0;i<nodes.length;i++){let skin=old.get(i);if(skin===undefined){let any=false;nodes[i].content.traverse(o=>{if(o.isSkinnedMesh)any=true;});if(any)old.set(i,skin=true);}if(skin)count++;}return count;};
  const cached=()=>{let count=0;for(const n of nodes)if(cache.hasSkin(n))count++;return count;};
  for(let i=0;i<20;i++){baseline();cached();}
  const times={baseline:[],cached:[]};for(let r=0;r<30;r++){for(const key of r%2?['cached','baseline']:['baseline','cached']){const t=performance.now();for(let i=0;i<10;i++)if((key==='cached'?cached:baseline)()!==20)throw new Error('Skin classification differs');times[key].push((performance.now()-t)/10);}await new Promise(r=>setTimeout(r,0));}
  return{assets:nodes.length,descendantsPerAsset:40,skinned:20,baselineMs:times.baseline.sort((a,b)=>a-b)[15],cachedMs:times.cached.sort((a,b)=>a-b)[15]};
 },'/@fs'+process.cwd()+'/');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}

/** Resolve recorded long-task CPU samples to local build source maps. No network or source-map guessing. */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
const [reportPath, profilePath, assetsPath] = process.argv.slice(2);
if(!assetsPath)throw new Error('Usage: node profile-stalls.mjs REPORT.json PROFILE.cpuprofile BUILD/assets');
const report=JSON.parse(await readFile(reportPath,'utf8')),profile=JSON.parse(await readFile(profilePath,'utf8'));
if(!report.navigationStart)throw new Error('Report must include navigationStart');
const nodes=new Map(profile.nodes.map(n=>[n.id,n])),maps=new Map();
async function resolve(frame){
 if(!frame.url)return{fn:frame.functionName||'(anonymous)'};
 const file=basename(new URL(frame.url).pathname);
 if(!maps.has(file)){try{maps.set(file,new TraceMap(JSON.parse(await readFile(join(assetsPath,file+'.map'),'utf8'))));}catch{maps.set(file,null);}}
 const map=maps.get(file),pos=map?originalPositionFor(map,{line:frame.lineNumber+1,column:frame.columnNumber}):null;
 return{fn:pos?.name??frame.functionName??'(anonymous)',source:pos?.source??file,line:pos?.line??frame.lineNumber+1,column:pos?.column??frame.columnNumber};
}
const results=[];
for(const task of report.observations.tasks.slice(0,8)){
 const counts=new Map();let at=profile.startTime;
 const lo=report.navigationStart*1e6+task.start*1000,hi=lo+task.duration*1000;
 for(let i=0;i<profile.samples.length;i++){at+=profile.timeDeltas[i];if(at>=lo&&at<hi)counts.set(profile.samples[i],(counts.get(profile.samples[i])??0)+profile.timeDeltas[i]/1000);}
 const samples=[];for(const[id,ms]of[...counts].sort((a,b)=>b[1]-a[1]).slice(0,12))samples.push({...await resolve(nodes.get(id).callFrame),ms:Math.round(ms)});
 results.push({...task,samples});
}
console.log(JSON.stringify(results,null,2));

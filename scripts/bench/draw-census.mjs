/** Actual production submissions grouped by scene pass, owning entity and batching exclusion. */
import { chromium } from 'playwright';
const browser=await chromium.launch({args:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']});
try {
 const context=await browser.newContext({viewport:{width:1280,height:720}});
 await context.addInitScript(()=>{localStorage.setItem('aether.onboarding.v1',JSON.stringify({choice:'offline',at:1}));localStorage.setItem('aether.tour.v1',JSON.stringify({done:true,at:1}));delete Navigator.prototype.gpu;});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.AETHER_BENCH_URL??'http://127.0.0.1:5176')+'/?debug=1#/new/'+(process.env.AETHER_BENCH_WORLD??'casa-patio'));
 await page.waitForFunction(()=>{const a=window.__aether,r=a?.simulation?.renderer;return a?.store.getState().loading===null&&r?.refineProgress===1&&r?.atRest&&!r.postPending&&r.programs.pending===0&&r.preparation.pending===0;},null,{timeout:120000});
 const result=await page.evaluate(async()=>{
 const r=window.__aether.simulation.renderer,backend=r.renderer.backend,nodes=r.sync.nodes;
 const owner=new Map();for(const n of nodes.values())n.content.traverse(o=>owner.set(o,n));
 const frames=[];let frame=null,pass=null;
 const render=r.render,sceneRender=r.renderer.render,draw=backend.draw;
 const summarize=(o,m)=>{const n=owner.get(o),g=o.geometry,b=n?.bindings.find(b=>b.mesh===o),e=n?.entity;const reasons=[];
 if(!n) reasons.push('generated-or-system');else{
 for(const k of ['transient','placeholder','pending','failed','overridden'])if(n[k])reasons.push(k);
 if(n.instances>0)reasons.push('instances');if(n.virtual.length||n.field)reasons.push('virtual-field');
 if(e.template)reasons.push('template');if(e.shape.kind!=='procedural')reasons.push(e.shape.kind);
 if(e.behaviors.length)reasons.push('behaviors');if(e.physics&&e.physics.body!=='static')reasons.push('dynamic-physics');
 if(n.bindings.length>32)reasons.push('many-parts');if(n.geometryKeys.length!==n.bindings.length)reasons.push('geometry-keys');
 if(b?.ownedMaterial)reasons.push('owned-material');if(b?.variant)reasons.push('variant');if(b?.seeThrough||m.transparent)reasons.push('transparent');if(!g?.index)reasons.push('nonindexed');if(!g?.attributes.normal)reasons.push('no-normal');
 }
 return {id:o.id,name:o.name,type:o.type,owner:e?.id,generator:e?.shape.generator,behaviors:e?.behaviors.map(x=>x.type??x.kind),reasons:reasons.length?reasons:['eligible-small-group'],material:m.id,materialType:m.type,materialKey:b?.materialKey,geometry:g?.id,vertices:g?.attributes.position?.count,instances:o.count,positionNode:!!m.positionNode,colorNode:!!m.colorNode,cast:o.castShadow,receive:o.receiveShadow,parent:n?.object.parent?.id??o.parent?.id,uv:!!g?.attributes.uv,color:!!g?.attributes.color};};
 backend.draw=function(ro,...args){if(pass)pass.objects.push(summarize(ro.object,ro.material));return draw.call(this,ro,...args);};
 r.renderer.render=function(s,c,...args){const prev=pass;pass={scene:s.name||s.type,shadow:s.overrideMaterial?.isShadowPassMaterial===true,objects:[]};frame?.push(pass);try{return sceneRender.call(this,s,c,...args);}finally{pass=prev;}};
 r.render=function(...args){frame=[];try{return render.apply(this,args);}finally{if(frame.some(p=>p.objects.length>20)){frames.push(frame);if(frames.length>4)frames.shift();}frame=null;}};
 try{r.needsDraw=true;await new Promise(resolve=>setTimeout(resolve,2500));return{frames:frames.slice(-1),nodes:nodes.size,merges:r.sync.merges.count,saved:r.sync.merges.drawCallsSaved,batches:r.sync.batches.count,groups:r.sync.merges.merges.map(m=>({parent:m.parent.id,material:m.material.id,key:m.key,members:m.members.length}))};}
 finally{r.render=render;r.renderer.render=sceneRender;backend.draw=draw;}
 });console.log(JSON.stringify({errors,...result},null,2));
}finally{await browser.close();}

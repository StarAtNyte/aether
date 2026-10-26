/** Actual viewport processing feedback: paint-before-GPU, compositor animation, edits and mode transitions. */
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']});
let inspectFailure=async()=>({});
try{
 const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'no-preference'});
 await context.addInitScript(()=>{
  localStorage.setItem('aether.onboarding.v1',JSON.stringify({choice:'offline',at:1}));localStorage.setItem('aether.tour.v1',JSON.stringify({done:true,at:1}));delete Navigator.prototype.gpu;
  window.__processingTrace=[];const seen=new WeakSet(),labels=new WeakMap();
  const observe=()=>{for(const status of document.querySelectorAll('.vp-status')){const label=status.textContent;if(labels.get(status)!==label){labels.set(status,label);window.__processingTrace.push({event:'status',at:performance.now(),label,modeBusy:window.__aether?.store.getState().modeBusy});}}for(const el of document.querySelectorAll('.vp-loading .spinner,.vp-status .spinner'))if(!seen.has(el)){seen.add(el);const label=el.parentElement.textContent;window.__processingTrace.push({event:'spinner',at:performance.now(),label,animation:getComputedStyle(el).animationName});requestAnimationFrame(()=>window.__processingTrace.push({event:'spinner-frame',at:performance.now(),label}));}};
  new MutationObserver(observe).observe(document,{childList:true,characterData:true,subtree:true});
  const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(this.className==='viewport__canvas'&&(kind==='webgl2'||kind==='webgpu'))window.__processingTrace.push({event:'context',at:performance.now(),kind,spinner:!!document.querySelector('.vp-loading .spinner')});return get.call(this,kind,...args);};
 });
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfailed',r=>requests.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText}));
 page.on('response',r=>{if(r.status()>=400)requests.push({path:new URL(r.url()).pathname,status:r.status()});});
 inspectFailure=async()=>({errors,requests,workers:page.workers().map(w=>new URL(w.url()).pathname),state:await page.evaluate(()=>{const a=window.__aether,r=a?.simulation?.renderer,s=a?.store.getState();return{loading:s?.loading,fatal:s?.fatal,processing:s?.processing,mode:s?.mode,modeBusy:s?.modeBusy,drawn:r?.framesDrawn,pending:r?.programs.pending,preparation:r?.preparation.pending,lost:r?.lost,trace:window.__processingTrace?.slice(-30)};})});
 const base=process.env.AETHER_SMOKE_URL??'http://127.0.0.1:5177';
 const html=await(await fetch(base)).text();const entry=[...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map(m=>m[1]).filter(src=>!src.includes('/@vite/')).at(-1);if(!entry)throw new Error('Missing module entry');
 const entryUrl=new URL(entry,base).href;let release;const held=new Promise(resolve=>{release=resolve;});await page.route(entryUrl,async route=>{await held;await route.continue();},{times:1});
 await page.goto(base+'/?debug=1#/new/casa-patio',{waitUntil:'commit'});
 const bootSpinner=page.locator('#boot-status .boot-spinner');await bootSpinner.waitFor();const boot=await bootSpinner.evaluate(el=>({animation:getComputedStyle(el).animationName,withoutApp:!window.__aether}));release();

 await page.waitForFunction(()=>window.__aether?.simulation&&window.__aether.store.getState().loading===null,null,{timeout:180000});
 const init=await page.evaluate(()=>({trace:window.__processingTrace,processing:window.__aether.store.getState().processing}));
 await page.evaluate(()=>{const r=window.__aether.simulation.renderer;r.setRenderQuality('realtime');r.setRenderTier('low');});
 await page.waitForFunction(()=>{const r=window.__aether.simulation.renderer;return r.programs.pending===0&&r.preparation.pending===0&&r.processingStage===null;},null,{timeout:120000});
 await page.evaluate(()=>window.__aether.store.getState().setAgentBusy(true));
 const spinner=page.locator('.vp-status .spinner');await spinner.waitFor();
 const first=await spinner.evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(300);const second=await spinner.evaluate(el=>getComputedStyle(el).transform);
 const client=await context.newCDPSession(page);await client.send('LayerTree.enable');let layers=[];client.on('LayerTree.layerTreeDidChange',e=>{layers=e.layers??[];});
 await page.waitForTimeout(150);const {root}=await client.send('DOM.getDocument');const {nodeId}=await client.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.vp-status .spinner'});const {node}=await client.send('DOM.describeNode',{nodeId});const layer=layers.find(l=>l.backendNodeId===node.backendNodeId);const reasons=layer?await client.send('LayerTree.compositingReasons',{layerId:layer.layerId}):null;
 const toolbarClear=await spinner.evaluate(el=>{const a=el.parentElement.getBoundingClientRect();return [...document.querySelectorAll('.vp-overlay button,.arch-bar button')].every(button=>{const b=button.getBoundingClientRect();return !b.width||!b.height||a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;});});
 await page.screenshot({path:'/tmp/aether-processing-spinner.png'});await page.evaluate(()=>window.__aether.store.getState().setAgentBusy(false));await page.locator('.vp-status').waitFor({state:'hidden'});
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.__aether.store.getState().setAgentBusy(true));await spinner.waitFor();const reducedMotion=await spinner.evaluate(el=>getComputedStyle(el).animationName);await page.evaluate(()=>window.__aether.store.getState().setAgentBusy(false));await page.emulateMedia({reducedMotion:'no-preference'});
 // Exercise a real world edit: sync announces processing before it yields and coalesces the document.
 const sync=await page.evaluate(async()=>{const s=window.__aether,id=Object.keys(s.history.current.entities).find(id=>s.history.current.entities[id].shape.kind==='primitive');if(!id)throw new Error('Missing editable primitive');const before=s.history.current.entities[id].visible!==false;const edit=s.history.commit([{op:'update',id,set:{visible:!before}}],'Processing smoke');if(edit.errors.length)throw new Error(JSON.stringify(edit.errors));const announced=s.store.getState().processing;await s.simulation.whenSynced();return{announced,stage:s.store.getState().processing};});
 await page.waitForFunction(()=>window.__aether.store.getState().processing===null,null,{timeout:120000});
 await page.locator('.topbar .play-btn').click();
 await page.waitForFunction(()=>{const s=window.__aether.store.getState();return s.mode==='play'&&!s.modeBusy;},null,{timeout:120000});
 await page.locator('.topbar .play-btn').click();
 await page.waitForFunction(()=>{const s=window.__aether.store.getState();return s.mode==='edit'&&!s.modeBusy;},null,{timeout:120000});
 const modeSpinner=await page.evaluate(()=>window.__processingTrace.some(e=>e.event==='status'&&e.label==='Switching mode…'&&e.modeBusy));
 const firstContext=init.trace.find(e=>e.event==='context'),firstFrame=init.trace.find(e=>e.event==='spinner-frame'&&e.label==='Starting renderer…');
 const result={errors,boot,toolbarClear,init,animationChanged:first!==second,compositor:reasons,reducedMotion,sync,modeSpinner,paintBeforeContext:!!firstContext&&!!firstFrame&&firstFrame.at<firstContext.at&&firstContext.spinner};console.log(JSON.stringify(result,null,2));
 if(errors.length||boot.animation!=='boot-spin'||!boot.withoutApp||!toolbarClear||!result.animationChanged||!result.paintBeforeContext||sync.announced!=='scene'||reducedMotion!=='none'||!modeSpinner)throw new Error('Processing feedback smoke failed');
}catch(error){console.error('Processing probe diagnostic:',JSON.stringify(await inspectFailure().catch(e=>({error:e.message}))));throw error;}finally{await browser.close();}

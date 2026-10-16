import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, startServer, SKIP_FIRST_RUN } from './support/env';
const hash = process.argv[2] ?? '#/new';
const init = process.argv[3] ?? '';
const srv = await startServer((l) => void l);
const b = await chromium.launch({ executablePath: findChrome(), args: process.env.NOWEBGPU ? CHROME_ARGS.filter((a) => !a.includes('webgpu')) : [...CHROME_ARGS], headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript({ content: SKIP_FIRST_RUN });
if (init) await ctx.addInitScript({ content: init });
const page = await ctx.newPage();
page.on('console', (m) => { if (true) console.log(m.type(), m.text().slice(0, 600)); });
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 400)));
await page.goto(`${srv.url}/?debug=1${hash}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const prompts = (process.env.PROMPTS ?? '').split('|').filter(Boolean);
for (const t of prompts) {
  const input = page.getByLabel('Prompt', { exact: true });
  await input.click(); await input.fill(t); await input.press('Enter');
  await page.waitForTimeout(500);
  for (let i = 0; i < 60; i++) { const busy = await page.evaluate(() => (window as any).__aether?.store.getState().agentBusy); if (!busy) break; await page.waitForTimeout(500); }
  await page.waitForTimeout(3000);
}
await page.waitForTimeout(Number(process.argv[4] ?? 3000));
console.log('STATE', await page.evaluate(() => { const st = (window as any).__aether?.store.getState(); const r = (window as any).__aether?.simulation?.renderer; return JSON.stringify({ fatal: st?.fatal, loading: st?.loading, backend: st?.backend, animating: r?.animating, stats: r?.stats ? Object.keys(r) .slice(0,5) : null }); }));
console.log('backend', await page.evaluate(() => (window as any).__aether?.store.getState().backend));
console.log(await page.evaluate(async () => { const a = await (navigator as any).gpu?.requestAdapter({powerPreference:'high-performance'}); const d = await (window as any).__aether?.simulation;  return a ? 'adapter ok ' + a.limits.maxSampledTexturesPerShaderStage + ' ' + typeof a.limits['maxSampledTexturesPerShaderStage'] : 'no adapter'; }));
console.log(await page.evaluate("(() => {\n  var st = window.__aether && window.__aether.studio; if (!st) return 'no studio';\n  function find(o, d) { if (!o || d > 3) return null; var ks = Object.keys(o); for (var i = 0; i < ks.length; i++) { var v = o[ks[i]]; if (v && typeof v === 'object' && v.scene && v.scene.isScene) return v; } for (var i = 0; i < ks.length; i++) { var v = o[ks[i]]; if (v && typeof v === 'object') { var r = find(v, d + 1); if (r) return r; } } return null; }\n  var wr = find(st, 0); if (!wr) return 'no wr: ' + Object.keys(st).join(',');\n  var rows = [];\n  wr.scene.traverse(function (o) { var m = o.material; if (!m) return; var ms = Array.isArray(m) ? m : [m]; ms.forEach(function (mm) { var tex = Object.keys(mm).filter(function (k) { return mm[k] && mm[k].isTexture; }); rows.push(o.name + ' ' + mm.type + ' ' + (mm.name || '') + ' ud=' + Object.keys(mm.userData || {}).join('/') + ' tex=' + tex.join(',')); }); });\n  return Array.from(new Set(rows)).slice(0, 80).join('\\n');\n})()"));
console.log('INFO', await page.evaluate("(function(){var st=window.__aether.studio;function find(o,d){if(!o||d>3)return null;var ks=Object.keys(o);for(var i=0;i<ks.length;i++){var v=o[ks[i]];if(v&&typeof v==='object'&&v.scene&&v.scene.isScene)return v;}for(var i=0;i<ks.length;i++){var v=o[ks[i]];if(v&&typeof v==='object'){var r=find(v,d+1);if(r)return r;}}return null;}var wr=find(st,0);var r=wr.renderer;var inf=r.info;return JSON.stringify({calls:inf.render.calls,tris:inf.render.triangles,frame:inf.render.frame,progs:inf.programs&&inf.programs.length, post: !!wr.post, tier: wr.gpu, bg: wr.scene.background&&wr.scene.background.constructor.name, fog: !!wr.scene.fog, wtier: wr.materials&&wr.materials.waterTier, samples: r.samples})})()"));
if (process.env.HIDE) {
  console.log(await page.evaluate("(function(){var st=window.__aether.studio;function find(o,d){if(!o||d>3)return null;var ks=Object.keys(o);for(var i=0;i<ks.length;i++){var v=o[ks[i]];if(v&&typeof v==='object'&&v.scene&&v.scene.isScene)return v;}for(var i=0;i<ks.length;i++){var v=o[ks[i]];if(v&&typeof v==='object'){var r=find(v,d+1);if(r)return r;}}return null;}var wr=find(st,0);var re=new RegExp('" + process.env.HIDE + "');var n=0;var top=[];wr.scene.children.forEach(function(c){top.push(c.type+':'+c.name+':'+c.children.length)});wr.scene.traverse(function(o){var m=o.material;var nm=(o.name||'')+' '+(m&&m.name||'')+' '+(o.type||'');if(re.test(nm)){o.visible=false;n++}});window.__aether.simulation.renderer.requestRender();return 'hidden '+n+' top='+top.join(',')})()"));
  await page.waitForTimeout(1500);
}
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await b.close(); await srv.stop();

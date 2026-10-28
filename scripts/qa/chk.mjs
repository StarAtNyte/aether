import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsTransmission } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  let pts = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { const a = p.getAttribute('POSITION'); const n=a.getCount(); const v=[0,0,0]; for (let i=0;i<n;i++){a.getElement(i,v);pts.push([v[0],v[1],v[2]]);} }
  const ys = pts.map(p=>p[1]); const y0=Math.min(...ys), y1=Math.max(...ys), h=y1-y0;
  const up = pts.filter(p=>p[1]>y0+0.7*h); const lo = pts.filter(p=>p[1]<y0+0.55*h && p[1]>y0+0.3*h);
  const m=(a,i)=>a.length? (a.reduce((s,p)=>s+p[i],0)/a.length).toFixed(3):'na';
  console.log(f.split('/').pop(), 'h',h.toFixed(2),'upper z',m(up,2),'x',m(up,0),'| mid z',m(lo,2));
}

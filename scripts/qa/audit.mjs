import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRTextureBasisu]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const files = process.argv.slice(2);
for (const f of files) {
  try {
    const doc = await io.read(f);
    const min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9]; let vol = 0, tris = 0, tex = 0, mats = 0, dark = 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute('POSITION'); const idx = p.getIndices(); const n = a.getCount(); const P = [];
      const v = [0,0,0]; for (let i=0;i<n;i++){ a.getElement(i,v); P.push([...v]); for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[k]);max[k]=Math.max(max[k],v[k]);} }
      const I = idx ? Array.from(idx.getArray()) : P.map((_,i)=>i);
      for (let i=0;i+2<I.length;i+=3){ const [x0,y0,z0]=P[I[i]],[x1,y1,z1]=P[I[i+1]],[x2,y2,z2]=P[I[i+2]]; vol += (x0*(y1*z2-y2*z1) - y0*(x1*z2-x2*z1) + z0*(x1*y2-x2*y1))/6; tris++; }
    }
    for (const m of doc.getRoot().listMaterials()) { mats++; if (m.getBaseColorTexture()) tex++; const c=m.getBaseColorFactor(); if (!m.getBaseColorTexture() && c[0]+c[1]+c[2] < 0.06) dark++; }
    const sz = max.map((m,i)=>+(m-min[i]).toFixed(3));
    console.log(JSON.stringify({ f: f.split('/').pop().replace(/\.[0-9a-f]{8}\.glb$/,''), size: sz, minY: +min[1].toFixed(3), cx: +((min[0]+max[0])/2).toFixed(3), cz: +((min[2]+max[2])/2).toFixed(3), vol: +vol.toFixed(5), tris, mats, tex, dark }));
  } catch (e) { console.log(JSON.stringify({ f, err: String(e.message).slice(0,100) })); }
}

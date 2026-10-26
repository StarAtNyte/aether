import { mergeGeometries } from './merge-geometries';
import { readMergeGeometry, writeMergeOutput, type MergeRequest, type MergeOutput } from './merge-wire';
import { expandWithLightmap } from './lightmap-uv';

/** Worker-side reconstruction and the same merge/lightmap math used by atomic captures. */
export function runMergeRequest(request: MergeRequest): MergeOutput {
  const geometries = request.geometries.map(readMergeGeometry);
  let result = mergeGeometries(request.members.map(m => ({ geometry: geometries[m.geometry]!, rel: m.rel })));
  if (request.lightmap) {
    const size = request.lightmap.reduce((n, uv) => n + uv.length, 0), uv = new Float32Array(size);
    let offset = 0; for (const part of request.lightmap) { uv.set(part, offset); offset += part.length; }
    if (uv.length === (result.index?.count ?? 0) * 2) { const lit = expandWithLightmap(result, uv); result.dispose(); result = lit; }
  }
  const output = writeMergeOutput(result);
  result.dispose(); for (const g of geometries) g.dispose();
  return output;
}

/**
 * Virtual geometry (cluster LOD DAG) — CPU-side measurements in Node.
 *
 * Run: nice -n 15 npx tsx experiments/virtual-geometry/bench.ts [subdivisions...]
 *
 * Measures, per mesh size: simplification speed, DAG build time and memory,
 * levels, and the cost of selecting a cut (traversal + culling) and
 * assembling its index buffer at several distances.
 */
import { performance } from 'node:perf_hooks';
import { simplifyMesh } from '../../packages/render/src/virtual/simplify';
import { assembleCut, buildClusterDag, createCutScratch, cutIndexCount, selectCut, type CutView } from '../../packages/render/src/virtual/cluster-dag';
import { icosphere, median } from '../lib/meshes';

const subdivs = process.argv.slice(2).map(Number).filter((n) => n >= 1 && n <= 9);
for (const s of subdivs.length ? subdivs : [5, 7, 8]) {
  const mesh = icosphere(s, 1, 0.08);
  const tris = mesh.indices.length / 3;
  let t0 = performance.now();
  const half = simplifyMesh(mesh.positions, mesh.indices, { targetIndexCount: Math.floor(mesh.indices.length / 6) * 3 });
  const simpMs = performance.now() - t0;
  t0 = performance.now();
  const tenth = simplifyMesh(mesh.positions, mesh.indices, { targetIndexCount: Math.floor(mesh.indices.length / 30) * 3 });
  const simp10Ms = performance.now() - t0;
  t0 = performance.now();
  const dag = buildClusterDag(mesh.positions, mesh.indices);
  const buildMs = performance.now() - t0;
  const bytes = dag.indices.byteLength + dag.offsets.byteLength + dag.spheres.byteLength + dag.cones.byteLength + dag.lod.byteLength + dag.source.byteLength + dag.groupClusters.byteLength + dag.groupOffsets.byteLength;
  console.log(`\nicosphere s=${s}: ${tris.toLocaleString()} tris, ${(mesh.positions.length / 3).toLocaleString()} verts`);
  console.log(`  simplify 50%: ${simpMs.toFixed(1)} ms -> ${half.indices.length / 3} tris, err ${half.error.toExponential(2)}`);
  console.log(`  simplify 10%: ${simp10Ms.toFixed(1)} ms -> ${tenth.indices.length / 3} tris, err ${tenth.error.toExponential(2)}`);
  console.log(`  DAG build: ${buildMs.toFixed(0)} ms, ${dag.count} clusters, ${dag.roots.length} roots, levels ${dag.levelTriangles.join(' > ')}, index pool ${(dag.indices.length / 3 / tris).toFixed(2)}x base, ${(bytes / 1048576).toFixed(1)} MB`);
  const out = new Uint32Array(dag.count);
  const target = new Uint32Array(dag.indices.length);
  const scratch = createCutScratch(dag);
  const pixelScale = 900 / (2 * Math.tan((50 * Math.PI) / 360));
  for (const dist of [1.5, 4, 16, 64, 256]) {
    const view: CutView = { cx: 0, cy: 0, cz: dist, pixelScale, threshold: 1, planes: null, backface: true };
    const times: number[] = [];
    let n = 0;
    let idx = 0;
    for (let k = 0; k < 15; k++) {
      const a = performance.now();
      n = selectCut(dag, view, out, scratch);
      idx = assembleCut(dag, out, n, target);
      times.push(performance.now() - a);
    }
    void cutIndexCount;
    console.log(`  cut @${dist}: ${n} clusters, ${(idx / 3).toLocaleString()} tris (${((idx / 3 / tris) * 100).toFixed(2)}%), ${median(times).toFixed(3)} ms`);
  }
}

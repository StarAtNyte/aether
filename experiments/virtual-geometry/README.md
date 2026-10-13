# Virtual geometry (cluster LOD DAG)

**Hypothesis.** A Nanite-style hierarchy of 128-triangle clusters, built
offline with our own QEM simplifier, lets a scene hold tens of millions of
sculpted triangles while each frame draws only a screen-bounded cut — on
WebGL2 as well as WebGPU, because selection runs on the CPU and the GPU only
sees ordinary indexed draws.

**Method.** `bench.ts` builds displaced icospheres (closed, smooth: the worst
case for cluster counts) and measures, in Node:

- QEM half-edge simplification to 50 % and 10 %,
- the DAG build (clusters → groups of 4 → simplify with locked group borders
  → re-cluster, per level),
- cut selection + index assembly at 1 px error for a 900 px tall viewport at
  several distances.

Run: `nice -n 15 npx tsx experiments/virtual-geometry/bench.ts 6 7`

**Numbers** (laptop in its power-saving profile, ~1.2 GHz; Node 24):

| Mesh | Simplify 50 % | DAG build | Clusters / levels | Index pool | Cut @1.5 r | @16 r | @256 r |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 82k tris | 195 ms | 0.93 s | 1 343 / 14 | 2.04× base, 2 MB | 0.29 ms, 32 % tris | 0.09 ms, 12 % | 0.02 ms, 3 % |
| 328k tris | 506 ms | 1.53 s | 5 464 / 15 | 2.04× base, 8 MB | 0.45 ms, 15 % | 0.13 ms, 6.3 % | 0.012 ms, 0.6 % |

- Every cut is watertight: a unit test checks that each directed edge of the
  assembled cut has its twin at seven distances (no cracks between LOD
  levels), and that frustum and normal-cone culling remove what they should.
- The vertex buffer is never duplicated: half-edge collapse keeps original
  vertices, so all levels share one GPU vertex buffer; only the index pool
  grows (≈ 2× the source indices).
- The first cluster builder fragmented clusters (Morton-order continuation
  jumped across the mesh), which made the DAG stall at ~13k triangles with
  inflated spheres; bounding the continuation by distance and splitting
  simplified groups along Morton order fixed both (one root, ~45–50 %
  reduction per level).
- Simplifier optimisation: claiming only the two collapse endpoints per
  pass (and reading already-collapsed corners through the remap, as
  meshoptimizer does) instead of the whole one-ring cut passes from ~70 ms to
  ~20 ms each (82k: 514 → 130 ms).

**In the browser** (see `tests/e2e/benchmark.e2e.ts` and
`docs/RESEARCH_LOG.md`): 41 sculptures of 49k–442k triangles (≈ 17 M source
triangles) draw a few hundred thousand triangles; hierarchies build in a
module worker (one at a time) and the full-detail mesh is never drawn — it
stays on the raycast-only layer for picking and the chase camera.

**Verdict: WIN — integrated** (`packages/render/src/virtual/*`): automatic
for any part with ≥ 20 000 triangles; DAG builds in `dag.worker.ts`; the
per-mesh `VirtualGroup` packs every instance's cut into one shared dynamic
index buffer and re-uploads only from the first instance whose cut changed;
a budget governor raises the error threshold when cuts exceed the per-GPU
triangle budget. GPU compute culling / indirect draws were not needed for
these counts and would split the WebGPU and WebGL2 paths; left as future work.

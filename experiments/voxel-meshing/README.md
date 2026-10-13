# Voxel meshing: culled vs greedy vs binary greedy

**Hypothesis.** Binary greedy meshing (solid columns as 32-bit masks; face
bits by shifting; rectangles merged with `Math.clz32` on whole rows) beats
classic greedy meshing (Lysenko's 2D masks) by an order of magnitude in JS
with the same quad count, which would make large voxel worlds (and chunk
LODs at 2×/4×/8× downsampling) cheap to remesh on edit.

**Method.** `bench.ts`: one 32³ chunk, two fields — rolling terrain (a
heightmap) and 3D-noise caves (the worst case for merging) — 30 runs each,
median time. The binary mesher's output is checked to cover exactly the
culled face count.

Run: `nice -n 15 npx tsx experiments/voxel-meshing/bench.ts`

**Numbers** (power-saving laptop profile, Node 24):

| Field | Culled faces | Greedy | Binary greedy |
| --- | --- | --- | --- |
| terrain | 5 762 quads, 1.46 ms | 2 120 quads, 8.9 ms | 2 117 quads, **0.83 ms** |
| caves | 9 054 quads, 0.45 ms | 3 813 quads, 6.0 ms | 3 785 quads, **1.12 ms** |

Binary greedy covers exactly the culled faces (5 762 / 9 054) with the same
quad reduction as classic greedy (2.7× / 2.4× fewer quads than culling) at
5–11× its speed: a 32³ chunk remeshes in about a millisecond.

**Verdict: algorithm wins, not integrated.** The World IR has no voxel
representation (terrain is heightfields and meshes; sculptures go through
virtual geometry), so there is nothing to mesh at runtime yet. The
experiment stays as the reference implementation if a voxel/destructible
terrain shape is added; chunk LODs would then reuse the scatter-field chunk
culler.

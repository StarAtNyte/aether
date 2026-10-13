# Scatter fields: a million instances with chunk culling and QEM LODs

**Hypothesis.** One `InstancedMesh` per scatter layer (the old path, capped
at 80–150k instances per device and drawn whole every frame) can be
replaced by a *field*: instances sorted into spatial chunks, culled per chunk
on the CPU, given a level of detail per chunk from automatically simplified
meshes, and spent against a per-frame triangle budget front to back. That
should hold 1M+ instances in a fraction of the memory and draw a bounded
number of triangles on both WebGPU and WebGL2 (no compute shaders needed).

**Method.** `bench.ts` (Node):

1. builds the LOD chain of each built-in vegetation/rock generator with the
   QEM simplifier (faceted parts are re-flattened so LODs keep per-face
   normals),
2. places N pines (the same seeded placement physics uses), packs them into
   20-byte records (x, y, z, s·cos, s·sin) and sorts them into ~128-instance
   chunks,
3. drives the culler along a 120-frame camera path (moving and turning, 60°
   frustum, 900 px viewport, 3 M triangle budget) and records update cost,
   rewrites, upload bytes and drawn triangles.

Run: `nice -n 15 npx tsx experiments/scatter-field/bench.ts 1000000`

**Numbers** (power-saving laptop profile, Node 24):

| | |
| --- | --- |
| LOD chains | pine 208 → 62 → 22 → 10 triangles (15 ms); oak 704 → 212 → 70 → 20; grass 216 → 64 → 22 → 6 |
| 1 M instances | placement 96 ms, packing + chunking 210 ms, 7 832 chunks |
| Storage | 19 MB packed vs 61 MB of matrices (3.2× less); level buffers 30 MB, bounded by the budget not the count |
| Update | 0.00–0.16 ms when nothing changed (no upload), 2.4–3.4 ms when levels are rewritten |
| Drawn | 137k instances / 3.0 M triangles per frame vs 208 M triangles at full detail (**69× fewer**) |
| Uploads | 8 MB per rewrite while turning (only from the first changed chunk; 6 % less than whole levels on this path) |

Findings that shaped the design:

- 256-instance chunks were too coarse near the camera (a chunk 5 m away
  forced 256 trees to full detail); 128 instances and LOD switch points of
  90/30/10/4 px (projected instance radius) balance near detail and budget.
- Rewriting levels front to back every update re-uploaded everything when
  the camera turned; levels are now written in stable chunk order, only
  when their membership changes, and uploaded from the first changed chunk.
- On SwiftShader (software WebGPU, used by the e2e suite) GPU uploads, not
  CPU, dominate: re-planning is throttled to one per 90 ms while the camera
  moves (captures re-plan immediately), which removed multi-second stalls.
- Impostor billboards were not needed: the coarsest QEM level (4–28
  triangles) costs about as much as a billboard pair without alpha-test
  overdraw or a render-to-texture bake; far chunks below 0.6 px are culled.

**Verdict: WIN — integrated** (`virtual/field-culler.ts`,
`virtual/scatter-field.ts`, `sync/field-mount.ts`): any scatter layer of
≥ 2 000 instances becomes a field; per-GPU budgets (instances / triangles:
discrete 2 M / 4 M, integrated 1.2 M / 2 M, software 1 M / 300 k, low memory
300 k / 600 k). The schema now accepts 1 000 000 instances per layer.

Not done (measured not worth it yet): GPU compute culling with indirect draws
(WebGPU only, would fork the WebGL2/Firefox path) and a 16-byte instance
format through a custom vertex node (4× less upload; only matters on
software rasterizers at these counts).

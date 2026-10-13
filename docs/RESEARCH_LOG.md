# Engine research log

Each idea was built as a small experiment first (`experiments/<name>/`,
with a README stating hypothesis, method, numbers and verdict), measured,
and integrated into `@aether/render` only when it won clearly and degraded
gracefully on WebGL2 and Firefox. All numbers come from one laptop
(Intel UHD + RTX 3050 laptop GPU, 16 threads) running in its power-saving
profile; browser numbers are headless: Chromium on SwiftShader (software
WebGPU / WebGL2, the e2e configuration) and Firefox on WebGL2.

## Summary

| Experiment | Verdict | Where |
| --- | --- | --- |
| Virtual geometry (cluster LOD DAG, QEM simplifier, cluster culling) | **Shipped** | `packages/render/src/virtual/{simplify,clusters,cluster-dag,virtual-mesh,dag-*}.ts` |
| Scatter fields (chunk culling, QEM LODs, triangle budget, 1M instances) | **Shipped** | `virtual/{field-culler,scatter-field,lod-chain}.ts`, `sync/field-mount.ts` |
| Procedural wind for vegetation fields (TSL vertex node) | **Shipped** | `materials/wind.ts` |
| Sky-derived colour grade in the composite pass | **Shipped** | `gpu/grade.ts`, `gpu/post.ts` |
| p90 frame-time resolution governor | **Shipped** | `view/adaptive-resolution.ts` |
| Built-in generation in the compute worker | **Shipped** | `geometry/procgen-source.ts`, `procgen/generate.ts` |
| High-detail procedural sculpture generator + canyon terrain | **Shipped** (content for the above) | `procgen/generators/sculpture.ts`, `terrain.ts` variant 3 |
| Binary greedy voxel meshing | Algorithm wins (5–11× vs greedy), **not integrated** (no voxel content in the World IR) | `experiments/voxel-meshing` |
| Gaussian splats (Spark) | **Not integrated** (second renderer path, no splat content) | `experiments/gaussian-splats` |
| GPU compute culling + indirect draws | **Not built**: the CPU planners already cost < 1 ms; a WebGPU-only path would fork Firefox/WebGL2 | — |
| 16-byte instance format via custom vertex node | **Deferred**: 4× less upload, matters only on software rasterizers at these counts | — |
| Cinematic items not attempted this round (planar-reflection water, GTAO, TAA, VSM/cascades, GPU particles, audio, camera director) | Open | — |

## 1. Virtual geometry

*Experiment:* `experiments/virtual-geometry` (Node). *Verdict:* shipped.

- Quadric-error simplifier by half-edge collapse (Garland–Heckbert;
  batching strategy after meshoptimizer — ideas only, original code):
  welds attribute seams, area-weighted plane quadrics plus border fences,
  radix-sorted candidates, independent collapses per pass, flip rejection,
  locked vertices. Never creates vertices, so every LOD indexes the source
  vertex buffer. 82k triangles → 50 % in 130–195 ms (from 514 ms before
  claiming only collapse endpoints per pass).
- Clusters of 128 triangles (BFS over vertex adjacency seeded in Morton
  order, bounded continuation) with bounding spheres and normal cones;
  groups of 4 simplified to half with group borders locked, re-split along
  Morton order. 328k triangles: 5 464 clusters, 15 levels, one root, index
  pool 2.04× the source, built in 1.5 s (worker).
- Cut selection (error ≤ 1 px, frustum, normal-cone back-face): 0.01–0.5 ms
  per instance; 0.6–15 % of the source triangles depending on distance.
  Tests prove every cut is watertight and allocation-free.
- In the showcase: 41 sculptures (three unique meshes of 49k–442k triangles,
  plus the 131k-triangle canyon) — ≈ 17 M source triangles drawn as
  0.5–0.56 M (incl. shadow-casting cuts, which skip frustum culling so
  off-screen statues still cast shadows).
- Failure found and fixed in the browser: before its hierarchy was ready a
  sculpture drew at full detail, and the agent's critique views rendered
  18 M triangles on SwiftShader (43 s of blocked main thread). The
  full-detail mesh is now raycast-only from the start and the cut streams in.

## 2. Scatter fields

*Experiment:* `experiments/scatter-field` (Node). *Verdict:* shipped.

- 1 M pines: placement 96 ms, packing + chunking 210 ms, 19 MB packed vs
  61 MB of matrices. Re-plan 0.0–0.16 ms when nothing changed, 2.4–3.4 ms
  when levels are rewritten; ≈ 137k instances / 3 M triangles drawn per frame
  instead of 208 M (69×) under a 3 M budget.
- Browser: the CPU side is negligible (profile of a 6 s orbit: 44 ms in
  `updateView`); on SwiftShader the cost is GPU upload (`writeBuffer`), so
  re-plans are throttled to one per 120 ms while moving, levels are written
  in stable chunk order and uploaded from the first changed chunk only, and
  empty levels are never submitted.
- Per-GPU budgets (instances / triangles): discrete 2 M / 4 M, integrated
  1.2 M / 2 M, software 1 M / 300 k, low memory 300 k / 600 k.

## 3. Showcase ("a canyon with a million trees and ancient statues")

Offline planner theme `colossi` (`packages/agent/src/providers/mock/themes-tech.ts`):
canyon terrain (variant 3, floor at y = 0), two 500k-pine fields on the
plateaus, 60k grass tufts on the floor, 18 colossal heads, a ring of 12
carved standing stones and 10 boulders. Smoke (Node): builds and verifies
in 1.5 s.

`npm run e2e:benchmark` (1280×800, camera orbiting for 6 s):

| Browser / backend | Scene triangles | Drawn | Ratio | Draws | Frame p50 / p90 | Build |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium, WebGPU (SwiftShader) | 223 M | 1.16 M | 192× | 113 | 1 467 / 3 233 ms | 45 s |
| Chromium, WebGL2 (SwiftShader) | 223 M | 0.76–1.2 M | 190–290× | 119 | 1 467 / 1 967 ms | 55 s |
| Firefox, WebGL2 | 236 M (grass fits its budget) | 2.1 M | 112× | 116 | 100 / 117 ms | 10 s |

The software rasterizer is GPU-bound (the CPU profile is 99 % waiting in
`writeBuffer`); the same frame on a hardware GPU is measured with
`--only=chromium-gpu`. The classic engine (`?engine=classic`) is the A/B
baseline: see below.

## 4. Smaller wins

- **Colour grade.** Split tone toward the key light (warm at golden hour,
  cool under the moon) and the zenith, saturation by light, a contrast
  pivot at mid grey; computed in the existing composite pass from uniforms
  (no extra target or pass; unit-tested policy).
- **Wind.** Vegetation fields get a TSL position node (quadratic bend by
  height above the mesh base, phase from position): vertex work only.
- **p90 governor.** The adaptive resolution decides on the 90th-percentile
  frame time of 48 frames: a scene averaging 57 fps that stutters every
  eighth frame (p90 ≈ 22 fps) now scales down; isolated spikes do not.
- **Worker generation.** Built-in generators run in the compute worker
  (validated output, inline fallback), so a 442k-triangle sculpture never
  blocks the page; physics caches huge outputs as a collider view (colliders,
  bounds and a 16k-point sample), which took the showcase smoke run from
  31 s to 1.5 s together with sharing one seed per sculpture variant.

## 5. Not shipped

- **Voxels.** Binary greedy meshing: 0.8–1.1 ms per 32³ chunk vs 6–9 ms for
  classic greedy, same quads. No voxel shape exists to use it.
- **Gaussian splats.** Spark is MIT and capable but targets
  `WebGLRenderer`; adding it means a second render path and 16 MB of package
  for content the product cannot create yet.
- **GPU-driven culling.** The CPU planners stay under a millisecond for a
  million instances and 41 sculptures, and run identically on every backend;
  compute culling with indirect draws would only exist on WebGPU.

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
| Camera director (fly-through loop around the content) | **Shipped** | `view/tour.ts`, studio camera button |
| Built-in generation in the compute worker | **Shipped** | `geometry/procgen-source.ts`, `procgen/generate.ts` |
| High-detail procedural sculpture generator + canyon terrain | **Shipped** (content for the above) | `procgen/generators/sculpture.ts`, `terrain.ts` variant 3 |
| Binary greedy voxel meshing | Algorithm wins (5–11× vs greedy), **not integrated** (no voxel content in the World IR) | `experiments/voxel-meshing` |
| Gaussian splats (Spark) | **Not integrated** (second renderer path, no splat content) | `experiments/gaussian-splats` |
| GPU compute culling + indirect draws | **Not built**: the CPU planners already cost < 1 ms; a WebGPU-only path would fork Firefox/WebGL2 | — |
| 16-byte instance format via custom vertex node | **Deferred**: 4× less upload, matters only on software rasterizers at these counts | — |
| Cinematic items not attempted this round (planar-reflection water, GTAO, TAA, VSM/cascades, GPU particles, procedural audio) | Open | — |

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
- Browser: the CPU side is small (SwiftShader profile of a 6 s orbit: 44 ms
  in `updateView`; Firefox on hardware: 1–1.5 ms per re-plan for the two
  500k fields); uploads dominate, so re-plans are throttled to one per
  120 ms while moving, levels are written
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

`npm run e2e:benchmark` (1280×800, camera orbiting for 6 s). Firefox ran on
the machine's integrated Intel GPU (WebGL2, hardware); headless Chromium on
SwiftShader (the hardware-GPU headless Chromium path fails here with Vulkan
texture-allocation errors unrelated to Aether):

| Browser / engine | Scene triangles | Drawn | Draws | CPU in render() | Frame p50 / p90 |
| --- | --- | --- | --- | --- | --- |
| Firefox WebGL2, scale engine | **236 M** (1 M pines, 60k grass, 41 sculptures) | 1.5 M (157× fewer) | 70 | 20–21 ms | **33 ms / 67–83 ms** |
| Firefox WebGL2, classic (`?engine=classic`) | 27 M (instance budget dropped 90 % of the trees) | 26.4 M | 66 | 9 ms | 33 ms / 50 ms |
| Chromium WebGPU (SwiftShader), scale | 223 M (software budgets drop the grass) | 0.76 M (293×) | 70 | 32 ms (GPU-bound) | 1.25 s |
| Chromium WebGL2 (SwiftShader), scale | 223 M | 0.72 M (311×) | 70 | 18 ms (GPU-bound) | 1.28 s |
| Chromium WebGPU (SwiftShader), classic | 223 M requested | — | — | — | agent turn did not finish in 240 s (critique views of 18 M full-detail triangles) |

The classic engine can only show a tenth of the forest and still draws 26 M
triangles; the scale engine shows the whole scene at the same median frame
time. Its p90 comes from re-plan frames (every 120 ms while the camera
moves); a static or slowly moving camera re-plans nothing.

Three findings made the difference between 100 ms and 33 ms per frame in
Firefox:

1. **`DynamicDrawUsage` re-uploads every draw.** three's `Attributes.update`
   uploads any buffer with dynamic usage on *every* use, ignoring versions
   and update ranges. The shared virtual-geometry index buffer (41 meshes,
   two passes) and the field instance buffers were dynamic, so up to 16 MB
   went to the GPU dozens of times per frame (34 ms/frame in
   `updateAttribute`). They now use static usage and upload only through
   version bumps with update ranges (accumulated until the renderer
   uploads them): 34 → 6 ms/frame.
2. **Shadow casters re-selected every re-plan.** Casters skip frustum
   culling, so 18 colossal heads walked their whole hierarchy every 120 ms.
   A caster now keeps its cut while the camera moved < 1.5 % of its
   distance or while it is more than three radii outside the view.
3. **Per-object culling still matters.** Virtual meshes first disabled
   three's frustum culling ("the cut is planned per cluster"), so every
   sculpture was submitted in the main and the shadow pass even when off
   screen: 116 draws per frame instead of 70. With culling on (the bounding
   sphere is the source mesh's), drawn triangles fell from 2.3 M to 1.5 M.

Other measured checks: GPU objects stay flat over showcase rebuilds
(`--cycles=2`: 66 GPU geometries vs a 68 baseline, 28 textures, 22 cached
geometries, 7 materials); the planner allocates nothing per frame
(allocation probe, moving camera over a 50k-pine field and two sculptures).

## 4. Smaller wins

- **Colour grade.** Split tone toward the key light (warm at golden hour,
  cool under the moon) and the zenith, saturation by light, a contrast
  pivot at mid grey; computed in the existing composite pass from uniforms
  (no extra target or pass; unit-tested policy).
- **Wind.** Vegetation fields get a TSL position node (quadratic bend by
  height above the mesh base, phase from position): vertex work only.
- **Fly-through.** `startTour()` builds a loop of keys from the framing
  sphere and the focus objects (low passes, high reveals), plays it on a
  Catmull-Rom spline with eased timing, starts and ends at the current
  view, and stops on any input; per-frame state lives in a typed array so
  the probe measures 0 B/frame (doubles passed through calls or stored in
  object fields were boxed on the first attempt).
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

Screenshots of the latest Firefox run: [`docs/screenshots/benchmark/`](screenshots/benchmark) (`firefox.png` scale engine with the triangle badge, `firefox-closeup.png` a colossal head at full detail, `firefox-classic.png` the classic engine).
# Renderer performance review — 2026-11-05

Reviewed renderer CPU work, water passes, memory accounting, still path tracing, and recent ray-tracing research. Implemented bounded capture-target retention and removed redundant intermediate path-tracer presentation passes. See [renderer optimization report](RENDER_OPTIMIZATION_REPORT.md) for changes, targeted validation, research sources, limitations, and follow-up experiments. No GPU benchmark or stress test was run.

Follow-up: capped hardware runs of Lisbon Hills, Kestrel Outpost, and Cliff Sanctuary, plus a shared instance-buffer upload change. The Lisbon ultra transition hit the cap; the Kestrel before/after was inconclusive. See the [bounded run report](RENDER_OPTIMIZATION_REPORT.md#bounded-hardware-runs-2026-11-05) and its raw logs for conditions and results.

Further follow-up: avoid redundant direct particle-attribute uploads. Same-frame capture testing found that static usage is unsafe for mutable instance matrices, so the batch change and proposed weather change were reverted. Intel WebGL2 and software WebGPU controlled tests and their limits are in [the optimization report](RENDER_OPTIMIZATION_REPORT.md#follow-up-particle-uploads-and-capture-correctness). Sustained 60 FPS at full quality remains unverified.

An exact-byte dynamic-matrix upload cache was then prototyped and checked against same-frame captures. A paired capped Cliff Sanctuary run showed no measurable benefit, so the experiment was removed. [Results and raw logs](RENDER_OPTIMIZATION_REPORT.md#follow-up-bounded-dynamic-matrix-upload-experiment).

An attempted skip of intermediate still path-trace presentation was also reverted: a seeded tiny-scene comparison produced different pixels and did not prove equivalence. [Details](RENDER_OPTIMIZATION_REPORT.md#follow-up-still-path-trace-comparison).

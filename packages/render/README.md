# @aether/render

Aether's renderer, built on three.js r186. It prefers **WebGPU**
(`WebGPURenderer`) and falls back to **WebGL2** automatically. It mirrors a
`WorldDoc` incrementally and draws scatter with GPU instancing.

Public API: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md#aetherrender).

```ts
import { WorldRenderer } from '@aether/render';
import { createWorkerSandbox } from '@aether/procgen';

const renderer = await WorldRenderer.create(canvas, { sandbox: createWorkerSandbox() });
renderer.backend;                       // 'webgpu' | 'webgl2'
await renderer.setWorld(world);         // incremental: only changed entities are touched
renderer.applyTransforms(packed, order);  // zero-alloc pose sync from PhysicsWorld.writeTransforms
renderer.render(dt);
const png = await renderer.screenshot({ width: 768 });
```

## Features

- **Pipeline:** ACES tone mapping, sRGB, exposure from the environment, bloom
  through `RenderPipeline` (disabled automatically if it fails) and a capped
  pixel ratio.
- **`SceneSync`:** diff-driven add, remove and update; parent links;
  templates skipped; reference-counted geometry and material caches keyed by
  stable JSON; placeholders while generators run; stale results discarded;
  old resources released only after new content is mounted.
- **Scatter:** `InstancedMesh` with one shared matrix buffer. Placement is
  identical to `@aether/physics` (this is tested). `onSurface` projects onto
  terrain. Device budgets apply (150k instances or 12M triangles by default),
  and layers over 2000 instances cast no shadows.
- **Environment:** a sky dome for each preset with sun or moon and stars, sun
  direction and colour from `timeOfDay`, fog, ground, a shadow camera fitted
  to the scene, and instanced weather (rain, snow, dust, fireflies).
- **Cameras and tools:** orbit, follow and first-person cameras; `focus`
  fly-to; a capsule avatar; picking (including scatter layers); selection
  boxes; a ghost preview of proposed worlds; and debug overlays for
  colliders, bounds and diagnostics.
- **Capture:** `screenshot` and `renderViews` (top, front, side, iso) return
  JPEG data URLs.

## Conventions other packages rely on

- Point and spot light intensities are scaled ×20 to match three.js physical
  units.
- Spot and directional lights point along local −Y.
- Loaded models are centred and rest on y = 0. Model URLs must pass
  `isAllowedModelUrl` from `@aether/core`.
- `setWorld` does not wait for glTF downloads; `SceneSync.whenIdle()` does.
- Call `clearRuntimeOverrides()` when play stops.

## Tests

```bash
npx vitest run packages/render
```

The unit tests cover every GPU-free module. The GPU path is exercised by the
browser e2e run (`npm run e2e`) on both WebGPU and WebGL2.

## Spatial batching and measured quality

Static primitives are grouped by shared geometry/material and then partitioned by their
longest spatial axis. Large, dispersed groups form balanced leaves targeting 256 instances;
compact groups spanning at most 64 m remain together (up to 4096) to save draw calls. The
renderer can cull each leaf independently in camera and shadow passes. Moving members grow
their leaf bounds immediately; picking and editing still use the original member objects.
When many regions are visible together, spatial leaves can increase draw calls: this trades
some submission overhead for less offscreen vertex work. Partitioning runs on regroup, not
in the frame loop.

Instance updates compare at Float32 precision and upload a reusable span of changed matrices.
Unconsumed spans accumulate across culled frames, so later edits cannot erase pending uploads.
A single changed instance needs 64 bytes after initial data has been consumed; sparse edits
at opposite ends of a leaf upload the span between them as well.

Automatic realtime quality starts from the hardware hint. After 20 seconds of continuous
57+ FPS (p90 frame time) at full resolution, it probes one higher tier, up to high. It retreats
after sustained sub-50 FPS or a resolution drop, then waits 60–240 seconds before another
attempt. Software rendering, low-memory mode, reported memory at or below 2 GB, safety
fallbacks, and explicit tier choices exclude these probes. Existing resolution and effect
controllers still lower cost under load. Failed effect restorations hold the affordable level
for 120–480 seconds of uninterrupted full-resolution headroom before trying again, rather than
locking quality down permanently. Ultra stays an explicit choice.

Reproduce the generated-world WebGL experiment against a running studio dev server:

```bash
AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/spatial-batches.mjs
# Linux Intel GPU through ANGLE/GL-EGL (the output identifies the actual driver):
GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/spatial-batches.mjs
```

The test compares a single global instance batch against spatial leaves for 1024 interleaved
props in four districts. Both Chromium/SwiftShader and Intel RPL-S over ANGLE/GL-EGL measured 12,288 vs 3,072 submitted triangles,
one draw in both views, zero differing pixel bytes, and a 16-float update for a later single
member move. These are submission, transfer and image-parity results, not hardware FPS claims.

Animated assets request redraws only when their mixer actually advances. Distant-only scenes
can therefore idle between their scheduled animation steps (10 updates per 60 ticks beyond
110 m); hidden ancestors pause mixers without keeping the renderer dirty. Skipped time is
carried into the next visible scheduled step, including when distance scheduling is disabled.
Named animation clips skip locomotion-speed estimation.

The animation hot path reuses the frame timestep passed to nearby mixers, avoiding temporary
number objects when V8 has not eliminated argument boxing. The existing 20-walker allocation
probe passes without changing its budget or warm-up. A Chromium heap probe with 32 actors
attributes about 386 bytes/frame to the former animator path and zero to the reused path, with
identical actor poses and mixer times. Distance scheduling now forms an accumulated timestep
only when an actor actually steps, and keeps it separate from the shared frame timestep.
The 32-actor mixed-distance probe falls from roughly 621 to 65 animator bytes/frame, with
exact pose/time parity in Chromium and Firefox. Scheduled accumulated timesteps still allocate;
the path is not fully allocation-free. Heap sampling changes execution cost, so throughput
should be measured separately. `AETHER_BENCH_WARM` selects the explicit warm-up frame count.

```sh
node scripts/bench/animation-browser.mjs
AETHER_BENCH_CPU_RATE=4 node scripts/bench/animation-browser.mjs
AETHER_BENCH_HEAP=1 node scripts/bench/animation-browser.mjs
AETHER_BENCH_BROWSER=firefox node scripts/bench/animation-browser.mjs
# Optional: AETHER_BENCH_BASE_REF=<revision>, AETHER_BENCH_BASE_FILE=<source-file>
```

Large static merge groups are partitioned before reuse matching. Unchanged partitions retain
their geometry, and undersized tails draw standalone after an edit. Merge and instance-batch
reuse uses a member index; releasing batches builds the retained-member set once per regroup.
Shadow-flag changes invalidate otherwise identical instance batches.

```bash
GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/static-merges.mjs
```

This WebGL regression covers 900,009 source vertices split into three buffers: unchanged
buffers are retained, and removing one member leaves a two-member standalone tail. Both
Intel RPL-S and SwiftShader match the individually drawn reference pixel-for-pixel, including
the tail, with no WebGL errors. This verifies resource reuse and image parity, not FPS.

Water reflection and refraction scene passes run only when a candidate water mesh can draw
in the active camera. The candidate index updates with material changes, mounts and removals;
visibility checks use live transforms, ancestor visibility, camera layers and renderer spheres.
Batched, scattered and virtual water conservatively keeps its passes. Capture cameras use
their current projection, including the backend coordinate system.

```bash
GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/water-passes.mjs
```

The full-renderer Intel WebGL regression requests four frames each with a pool offscreen,
in view and hidden. It measures 0/4/0 new reflection passes and 0/4/0 new backdrop passes
(the backdrop is forced on for this WebGL test). Skipping offscreen passes matches forced
passes pixel-for-pixel with no WebGL errors. This is a pass-count and image-parity result;
frame-rate improvement depends on scene cost. The measured quality controller sees the
resulting frame time through its existing feedback path.

Visible water passes reuse their visibility snapshots (including nested draws and mixed initial
visibility states). The water-material list is rebuilt only when shader membership changes;
non-water materials and retained references do not invalidate it. Final release drops cached
shader references immediately, even if no later water pass runs.

```bash
GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/spatial-gpu.mjs
```

The GPU-timer experiment isolates culling efficiency: 1024 sphere instances (32×24 segments),
four districts, one visible, 512×512 output, basic opaque shading. It compares one global
Three.js InstancedMesh with the framework's automatic spatial partitions, retaining the same
scene traversal and checking identical pixels. Two Intel RPL-S runs measured median GPU timer
intervals of 1.187 ms global versus 0.313 ms spatial (about 3.8×), with 1,507,328 versus 376,832
submitted triangles and approximately 0.2 ms median CPU submission in both. Each run uses
24 samples per strategy after warmup, ABBA ordering, and rejects disjoint timer results.
This isolates one favorable culling workload; it is not application FPS, a universal speedup,
or a comparison against all possible Three.js optimizations. When every region is visible,
the spatial strategy can add draw calls without reducing triangles.

Particle bursts cache fixed preset hashes and prepare their position/direction once per layer,
rather than repeating that setup per particle. Seeded sparks, explosions, confetti, magic and
splashes match the pre-change particle buffers byte-for-byte.

Cone-shaped bursts now compute their shared emission basis once per batch, and particle-ring
advancement uses a boundary check instead of division. Individual writes still sample their own
direction. The browser CPU benchmark below compares the working sampler against a Git revision,
checks every output word, and includes both changing directions and 100-particle batches. Local
Chromium runs show roughly 13–21% less CPU time for batches; individual-write timings vary around
the baseline. These are sampler measurements, not whole-frame FPS claims.

```sh
node scripts/bench/particle-browser.mjs
AETHER_BENCH_CPU_RATE=4 node scripts/bench/particle-browser.mjs
# Optional: AETHER_BENCH_BASE_REF=<revision>, AETHER_BENCH_URL=http://localhost:5176
```

Inactive continuous emitters no longer force frames after their live particles expire. Hidden
ancestors stop new emission; revealing an emitter resumes normal emission without a backlog.
The simulation still calls update every animation tick, including on-demand ticks that skip
the GPU draw, so low-rate emitters wake naturally when their first particle is born.

```bash
GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/dormant-vfx.mjs
```

The full-renderer Intel WebGL test compares the former emitter-count policy against live-particle
scheduling: 60 forced draws become zero for a dormant emitter, with identical pixels. The same
emitter produces 60 draws when active and returns to zero when its parent is hidden and existing
particles have expired. It stays registered throughout, and WebGL reports no errors.

Raw node uniform buffers also use exact bitwise change detection before GPU upload. Unchanged
poses can therefore retain their GPU data between animation ticks. Each GPU buffer still gets its
own first upload; partial updates, bind-group refreshes and recreated buffers invalidate the cache.
Shared/resizable memory and buffers over 64 KiB use the normal upload path. The controlled common
renderer benchmark reduces uniform writes from 7 to 3 while one actor moves, then 7 to 0 with
held poses, with identical pixels on Intel and SwiftShader. These are upload counts, not FPS gains.

The WebGL state patch reuses uniform-binding keys through Three's existing state cache, including
its reset behavior. Intel and SwiftShader checks retain the same GPU bind calls and identical
pixels. The isolated Node 24 lookup benchmark runs about 2.5× faster; native driver calls are
unchanged, so this does not imply a comparable frame-rate increase.

Physics pose application caches parent inverse matrices and rotations while the exact parent
world matrix is unchanged. The weak cache releases removed parents naturally. Ancestor matrices
are refreshed before conversion, including an ancestor moved earlier in the same packed update;
singular parents skip conversion and recover when their transform becomes invertible again.
In the 2,000-body CPU benchmark, one shared parent takes about 12% less time, including when it
moves. Flat and one-parent-per-body timings remain close to baseline; this is not a universal gain.

```sh
npx tsx scripts/bench/uniform-binding-keys.ts
npx tsx scripts/bench/physics-poses.ts
# physics-poses supports AETHER_BENCH_BASE_REF=<revision>
```

The production CPU harness now applies `--tier` and reports the actual quality and tier measured.
An explicit tier uses realtime quality unless `--quality` is also supplied: studio/final quality
otherwise forces its ultra plan. Scene statistics are collected after the selected plan warms.

Fresh skinned model clones share a skeleton palette across parts only when all joint identities
and inverse bind matrices match. The optimization stays within each clone: actors keep separate
poses and each mesh retains its own bind transform. Already uploaded palettes are untouched.
This removes duplicate bone-matrix work and texture uploads introduced by SkeletonUtils.clone.

```bash
GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/shared-skeletons.mjs
AETHER_BENCH_BACKEND=webgl2 GEN_GPU=intel AETHER_BENCH_URL=http://localhost:5176 node scripts/bench/shared-skeletons.mjs
```

The Intel WebGL regression animates two actors independently over six poses: palettes fall
from six to two, texture uploads from 36 to 12 in the classic renderer, and every rendered pixel
matches, with no WebGL errors. The framework's WebGL2 backend (WebGPURenderer with forceWebGL)
also matches exactly on Intel and SwiftShader: skeleton updates fall from 36 to 12 there; these
small palettes use uniform buffers rather than bone textures. The production CPU harness now reports distinct skeleton objects and distinct binding
configurations. In a Highland Trail profile, 368 skeleton objects collapsed to its 39 distinct
bindings. With the same 1280×720 WebGL/profile settings (30 measured frames, 15 warm orbit
frames), render-call CPU median changed from 14.3 to 12.1 ms and p90 from 71.3 to 13.2 ms in the
observed runs. These timings are observational, with animated scene contents and driver noise;
the exact palette reduction and image-parity checks are the stronger evidence.

The chase-camera ring now compares hits after projection onto the boom axis and reuses one
projection factor across all four offset rays. Clear rays avoid the factor calculation entirely.
Short-boom and multiple-direction regressions cover the previously missed closer offset hit.

Cloned model draw objects and skeleton palettes now have explicit instance ownership. `disposeModelInstance(root)`
releases owned draw state and each palette once through nested groups and LODs; source geometry, materials
and textures remain borrowed. Entity retirement and character teardown call it automatically.
Skeleton-aware cloning is available to custom loaders immediately, without waiting for a glTF
load to install the clone helper.

The classic Intel WebGL lifecycle check in `scripts/bench/shared-skeletons.mjs` keeps a source
texture alive while creating and removing two actors five times. The former remove-only path
left 3, 5, 7, 9, then 11 GPU textures. Instance cleanup returns to the one source texture after
every cycle (1, 1, 1, 1, 1), preserves that source, and matches the reference image with no WebGL
errors. Unit checks also cover model removal with a retained source, character teardown,
independent custom-loader instances, and repeated disposal.

The framework's WebGL2 renderer also retains per-object uniform buffers and render objects
until it receives the object's disposal event. Instance cleanup now emits that event on owned
renderable clones, including static models. In the same five-cycle Intel regression, retained
draw objects previously rose 8, 14, 20, 26, 32 and tracked GPU buffers 17, 29, 41, 53, 65.
Cleanup keeps these at the warm baselines of two draw objects and five buffers after every
cycle, with the shared source texture intact and zero pixel differences or WebGL errors.

The render thread and background workers have separate budgets. Worker health alone does
not imply a responsive UI: Three r186's normal draw path creates GPU pipelines synchronously,
including programs first encountered in post-processing MRT and shadow passes. The renderer
now defers these programs through `parallelPrograms`: WebGL polls
`KHR_parallel_shader_compile`, waits for the entire submitted batch before querying bindings
(a completed program's binding query can otherwise wait behind another linking program),
and WebGPU uses the backend's asynchronous pipeline path. Draws pause while links are pending;
discovery frames do not count toward the quality governor or the blank-frame watchdog.
Disposal cancels polling and releases waiters. Pixel-store state is cached before scene work,
including reset defaults, so temporal texture copies avoid synchronous driver queries.
Capture sessions wait for pending links; atomic capture draws retain Three's native path.

`GEN_GPU=intel node scripts/bench/ui-responsiveness.mjs` profiles a fresh Casa Patio open,
worker lifecycle, heartbeat gaps, long tasks, main-thread stacks and rendering progress.
Use `AETHER_BENCH_URL` for another running build, `AETHER_BENCH_GL_TRACE=1` for slow GL
entry points, and `AETHER_BENCH_NATIVE_GPU=1` to allow WebGPU. The default deliberately
forces WebGL2 to exercise integrated-GPU fallback. This is a responsiveness probe, not an
FPS benchmark. On the local Intel test, the original production build stalled for 6.3 seconds;
the candidate's largest observed long task was 1.93 seconds with no slow shader-link or
binding queries. This is an improvement, not a claim of a free UI thread: texture uploads,
initial graph construction and browser GPU submission can still hitch. Rendering itself
still runs on the main thread; this does not move it to an OffscreenCanvas worker.

Foliage atlas rasterisation also runs in a lazy module worker (`foliage-atlas.worker.ts`).
The worker uses lightweight `@aether/core/random` and `@aether/procgen/foliage` entry points;
its production bundle is 13.7KB instead of 553.3KB when importing the package barrels.
Both procedural pixels and photographed sprite composition, canvas readback, hard-alpha
conversion and ratio neutralisation happen there. The decoded photo sheet is shared by
requests, and finished RGBA buffers transfer to the texture cache without a copy. Changing
photo sources or disposing the cache terminates outstanding work; a progress watchdog,
validated replies and the existing cooperative main-thread path cover unsupported or
failed workers. This changes scheduling, not atlas resolution, material identity or pixels.

`node scripts/bench/foliage-worker.mjs` compares the real worker's output against the original
functions for all seven procedural kinds and all six photographed kinds. On local Chromium,
all 13 atlases were byte-identical at 512px and 1024px; Firefox also matched at 512px.
With the existing cooperative scheduling as the baseline, the largest isolated main-thread
heartbeat gap at 1024px was 347ms versus 8ms while awaiting worker results on Chromium.
At 512px Firefox measured 42ms versus 29ms. `AETHER_BENCH_SIZE` selects the atlas size;
`AETHER_BENCH_BROWSER=firefox` selects Firefox. `AETHER_BENCH_INLINE=1` additionally compares
against an unsliced direct function call (not the former runtime scheduling). These are
atlas-job measurements, not whole-world startup
claims: full-app tracing still finds synchronous node graph construction on first use of
post passes. The UI probe supports `AETHER_BENCH_RENDER_TRACE=1` for per-frame renderer costs
and `AETHER_BENCH_TRACE=/absolute/path/trace.json` for a Chromium timeline trace.

First-use graph construction and binding/geometry setup are now deferred too
(`gpu/render-preparation.ts`). Each discovery records the actual target, MRT, output transform,
lighting membership, and temporary material overrides. Preparation runs in separate tasks
with a 4ms batching budget; a single graph remains an indivisible job. The work queue clears consumed references and advances an index rather than shifting a world-sized array.
Cached render objects
use a path without argument-array allocations or duplicate material/cache lookups. Native
`compileAsync` and program links exclude the queued uploads. Captures wait for queued setup
and retain their atomic draw path; bundles and unsupported renderer internals use the native
path. Disposed objects, replaced streaming geometry, changed source materials and disposed/resized pass targets cancel
obsolete jobs. These waiting/discovery frames do not feed the quality governor or watchdog.
One-shot PMREM/cubemap generation and renders nested inside graph setup remain atomic,
including program linking. Deferring those draws would cache an incomplete environment texture.
The expanded parity fixture covers this case on WebGL and WebGPU.

`node scripts/bench/graph-preparation.mjs` compares actual rendered bytes before/after
preparation, against unmodified Three, including HDRI environment lighting and fog,
raw/beauty/MRT/combined passes, alpha tests, transparent double
passes, shadows, instancing, skinning, edits and disposal during pending setup. All four
cases matched byte-for-byte in Chromium and Firefox (the local Firefox WebGL test requires
`AETHER_BENCH_BROWSER=firefox AETHER_BENCH_HEADED=1 xvfb-run -a node scripts/bench/graph-preparation.mjs`).
`AETHER_BENCH_WEBGPU=1 node scripts/bench/graph-preparation.mjs` also matched all four cases
with the actual WebGPU backend on SwiftShader, including edits and pending disposal.
With the corrected HDRI path, the local Intel production UI probe's largest long task
was 86ms (about 1.8s before graph preparation); its largest heartbeat gap was 105ms over a fresh load plus 25 seconds. At
`AETHER_BENCH_CPU_RATE=4`, the largest observed task was 398ms: individual graph/resource
jobs and initial application setup still matter on slower CPUs. These are responsiveness
observations, not whole-framework throughput claims or a claim that rendering runs in a worker.

The existing four-round world-switch/play-stop test passed its unchanged 9MB heap-growth
budget (38.2→45.5MB, 28 visits). Its shorter two-round run exceeded 3MB; the previous build
also exceeded that short budget (4.7MB), so a cold-cache comparison alone does not establish
a new leak. The longer run is a bounded cleanup check, not proof of zero retained memory.

Resource-ready redraws now retain a separate invalidation signal from camera/content motion
(`view/frame-invalidation.ts`). The rest-quality transition waits for one completed motion
frame and drained graph/program queues before resizing targets. This prevents background
preparation from repeatedly restarting the quality clock. In the Intel production probe at
4× CPU slowdown, the idle motion/rest transitions fell from 19 to 1; the corrected run reached
full requested effects and refinement at 41.2s after navigation, with no pending preparation
or programs. Its first completed scene frame was at 15.2s and largest long task was 335ms.
These cold-load costs remain work to improve; worker activity does not make all rendering
setup asynchronous. Skipping native shader warmup was tested and rejected: its largest
observed task rose to 1,112ms.

The directional soft-shadow filter now first counts receiver-depth blockers and only runs
the three blocker-distance comparisons inside the existing shadowed-result branch. Fully
lit fragments avoid those comparisons; shadowed fragments keep the same sample positions,
sums, penumbra and filter taps. This applies to the shared filter for arbitrary scenes.
`GEN_GPU=intel AETHER_BENCH_EXTENSIVE=1 node scripts/bench/soft-shadow-gpu.mjs` compares
the production filter against the former single-loop implementation and a per-tap experiment.
It exercises every current quality-plan tap count, the 1/16 blocker-tap limits, eight depth
fields and three temporal rotations (144 cases). The Intel repeat run matched every byte;
for the high-tier 6/10 setting, the first run measured 0.57→0.16ms for fully lit pixels and
0.64→0.45ms for a mixed lit/shadow field. Dense-shadow timings stayed approximately equal.
These are isolated 512×512 filter timings, not whole-frame speedups. The custom one-tap
limit traded about 0.03ms more in shaded cases for faster lit cases; current quality plans
use at least three blocker taps. Timing should be rechecked on other hardware.

The same 144-case comparison also passed byte-for-byte on Firefox WebGL (llvmpipe) and
actual WebGPU (SwiftShader). Use `AETHER_BENCH_BROWSER=firefox AETHER_BENCH_HEADED=1 xvfb-run -a`
for the local Firefox run, or `AETHER_BENCH_WEBGPU=1` for WebGPU; combine with
`AETHER_BENCH_EXTENSIVE=1`. `AETHER_BENCH_REVERSED=1` verifies the reverse-depth path and
fails explicitly if that path is unavailable.

Native `compileAsync` now stages known material-texture uploads through the shared bounded
texture-work queue (`gpu/compile-textures.ts`). Three yields between objects, but its
per-object binding step otherwise uploads all maps together. Aether uploads each ready,
ordinary sampled texture before that step, checking the renderer's actual uploaded version
again when the job runs. Already-current maps add no scheduled task. Render targets, depth,
video, storage, external, HTML, and unavailable textures retain the native update path.
No renderer pass state or `_isPreCompiling` flag is held across the added yields; disposal
restores the original async hook and rejects pending work before it can upload again.
This changes cold preparation scheduling, not texture resolution, filtering, or materials.
The graph browser fixture now also compares native compilation with/without staging on a
generated set of materials with multiple maps, alongside its original discovery cases.

In a fresh production Intel/4× CPU comparison, the largest long task after the world loader
cleared fell from 453ms to 152ms; initial application setup remained about 300ms. First
completed scene frames were 15.9s vs 16.4s after navigation and full-quality convergence was
43.2s vs 43.4s. Both runs used the requested effects and ended with no pending work. A
separate injected prototype uploaded 57 maps in scheduled tasks (largest upload 10ms).
These observations isolate a source of cold-start stalls; they do not demonstrate a fully
free UI thread, and total startup/convergence time still needs improvement.

The five graph comparisons (raw, beauty, MRT, combined post-processing, and native warmup
with the generated material bundle) matched rendered bytes on Chromium WebGL, Firefox
WebGL and actual WebGPU. The warmup bundle uses 96 generated material maps, including
512×512 maps, to exercise this path independently of the shipped world templates.

Procedural parts, static merged geometry and editable mesh previews now compute their box
and sphere with `geometry/position-bounds.ts`. The former native box+sphere sequence
scanned the packed positions three times because sphere calculation recomputed the box.
The new path scans twice, uses packed xyz directly, and retains the same box-centred,
vertex-tight sphere. It reuses existing bound objects for previews; morphing, interleaved,
normalized and other arbitrary Three geometry retain their original paths. Malformed
non-finite positions also retain native diagnostics. Exact comparisons cover empty,
degenerate, generated and edited meshes. `node scripts/bench/position-bounds.mjs` measures
interleaved native/new timings on generated geometry; the Chromium 500k-vertex result was
5.1→1.9ms. This is bounds computation, not a whole-frame throughput result.
With `AETHER_BENCH_CPU_RATE=4`, a clean follow-up measured 19.8→7.6ms for 500k
vertices and 0.38→0.14ms for 10k, still with exactly equal boxes and spheres.

Low-tier distant-asset culling now caches both static and skinned classifications against
the live entity node and its content-build token (`gpu/asset-skin-cache.ts`). The previous
positive-only ID cache walked every static asset subtree again on every culling pass and
could misclassify replacement content. Loading/placeholder results are not cached, rebuilt
content is reclassified, and weak keys allow retired entries to be collected. If a rebuilt
asset is static, the culler releases its own hiding while respecting character replacement
visibility. Distances, tier selection and normal near/far behavior are unchanged.
`node scripts/bench/asset-skin-cache.mjs` uses 1,000 generated assets with 40 descendants
each and 20 skinned assets. Repeated classification measured 0.36→0.01ms in Chromium with
the same results. This isolates subtree classification, not the entire world iteration or
frame time; tests also cover model replacement, delayed loads and visibility ownership.

Source-mapped cold-start profiling now records raw CPU profiles with
`AETHER_BENCH_PROFILE=/tmp/open.cpuprofile`. To resolve long tasks, build an isolated
`--sourcemap hidden` output, profile that exact output, then run
`node scripts/bench/profile-stalls.mjs REPORT.json PROFILE.cpuprofile BUILD/assets`.
The normal production build still omits maps. The mapped run identified early cloud noise,
atmosphere integration and material noise work; it also observed a separate 401ms render
setup task at 4× CPU slowdown. Previous single-run improvements do not establish that all
such stalls are eliminated.

Cloud fractal-noise generation now precomputes x weights once per octave and wraps lattice
rows once per row (`environment/clouds.ts`). Scratch arrays are reused across octaves;
Float64 weights retain the same arithmetic and Float32 accumulation order. The frozen old
algorithm in `scripts/bench/cloud-reference.ts` provides independent byte comparisons for
noise and RGBA output, including irregular sizes, several seeds/stretches, cover values,
and sun directions near rounding boundaries. `node scripts/bench/cloud-generation.mjs`
measured one 256px cloud deck at 16.6→6.1ms in Chromium; a clean 4× CPU run measured
40.2→13.7ms for cumulus and 24.6→12.8ms for stretched cirrus noise. All compared bytes
matched. The separate shadow-density-cache experiment was not retained; cloud shading,
texture resolution, octave count and cover behavior are unchanged.
The production 4× CPU follow-up observed an early task of 275ms versus 397ms in the
preceding run, but first completed scene frames were 16.4s versus 15.8s. This comparison
supports reducing a specific CPU cost, not a reliable total-load-time improvement.
The final Firefox noise comparison also matched every sample and RGBA byte; observed
cumulus/cirrus generation times were 14→4ms and 13→3ms respectively. These are single
cold-call observations; use the benchmark for repeat measurements on target devices.

The sky dome now keeps one exact Float64 integration result per vertex for the current
physical sun/turbidity and position-attribute identity/version. Fog, physical blending
weight and quality-detail updates reuse integration and still rebuild their own final
vertex colours. Sun/haze edits (including in-place state edits) and geometry edits invalidate
it without quantizing inputs. Storage is recycled across physical-state changes and cleared
on disposal; a partially recomputed cache is never published.
`node scripts/bench/sky-cache.mjs` compares actual dome recolouring on forced cache misses
and hits, checking every vertex colour while alternating fog colours. At 4× Chromium CPU
slowdown, day recolouring measured 22.5→1.1ms and sunset 21.6→1.1ms, with identical colours.
Unthrottled Chromium measured roughly 5→0.3ms; Firefox matched colours and measured 5→1ms.
These are miss/hit timings, not a frozen old-build comparison or a speedup for a new physical
sun state. The integration samples, sky model, cloud layers and sky geometry are unchanged.

The shared surface-variation texture now precomputes horizontal gradient-noise weights and
indices once per column, hoists row addressing, and reads the four gradient corners directly
instead of creating a texel-local closure (`materials/noise-texture.ts`). Float64 scratch
arrays preserve the original numeric inputs, including fractional lattice periods. Hashing,
Float32 samples, channel normalization, RGBA rounding, texture resolution and filtering are
unchanged. Frozen-reference tests compare all bytes across sizes, periods and signed seeds.
`node scripts/bench/material-noise.mjs` compares the old/new algorithms in alternating order.
At 4× Chromium CPU slowdown, default 256px texture generation measured 33→17.7ms on the
first measured calls, and 16.5→11.4ms for warmed medians. Firefox matched every pixel and
measured 4→3ms warmed, while both first calls measured 6ms. These are isolated texture
costs; first-call observations are not a repeated full-app startup comparison.

The shared `TaskQueue` now consumes jobs by index, clears consumed closures immediately,
and occasionally compacts storage instead of repeatedly removing the front element.
Reentrant submissions do not post duplicate work callbacks. A channel is reused while a
burst or sequential await chain continues; one reserved final message drains newly arrived
work or closes both ports when idle. The timer fallback retains the same FIFO/yield behavior.
The budget still only bounds work between jobs: an individual synchronous job cannot be
interrupted, and allocating a huge batch of promises can itself stall the caller.

`node scripts/bench/task-queue.mjs` compares a frozen copy of the prior scheduler with
interleaved runs. Chromium medians were 30.8→10.8ms for a 30k-job batch and 12.3→3.3ms for
1k sequentially awaited jobs; channel creation on the latter fell from 1,000 to 1. Firefox
sequential timings varied around 7–10ms after versus 9–11ms before; batch drainage was
slightly faster, but synchronous 30k-promise submission still produced 50ms-plus timer gaps.
The first microtask-based idle-cleanup experiment regressed Firefox (16ms chain/34ms timer
gap) and was rejected in favor of the final idle-message implementation. These are scheduler
benchmarks, not whole-world frame rates or a claim that the UI thread is now free.
The actual foliage worker/cooperative-fallback comparison still matched all 13 atlas cases,
including cache integration and source-change cancellation.
After the queue change, raw, beauty, MRT, combined post-processing and native-compilation
browser fixtures still matched unmodified Three byte-for-byte on WebGL and actual WebGPU,
including the generated multi-map material bundle and pending-disposal checks.
A clean `AETHER_BENCH_CPU_RATE=4` scheduler follow-up measured 122.7→42.8ms for the
30k-job burst and 50.6→13.3ms for the 1k-job await chain. Maximum observed timer gaps
were 30.6→27.5ms and 4.6→4.4ms respectively, including caller-side batch submission.
The deployed low/realtime UI also passed foliage-worker, screenshot, capture and restored-
viewport/quality checks without pending GPU work or page errors.

Discovery-time render preparation now yields between graph construction, geometry setup,
ordinary map uploads and final binding setup, retaining the requesting pass snapshot for
each slice. A partially prepared render object stays queued even after its binding objects
exist. Source versions, geometry identities, target epochs and disposal are checked between
steps. One-shot cube/PMREM work and captures keep the atomic path; individual graph or
buffer uploads remain synchronous and can exceed the four-millisecond budget.

Material texture preparation now resolves the built shader's active `MaterialReferenceNode`
values against the current render object's material (or the reference's explicit material).
The shared shader state and sampled bindings can still contain a previous material's texture
until normal draw-time updates; warming those stale values missed most maps on later objects.
The new lookup is read-only, does not run node updates, and applies to both native async
compilation and deferred discovery. Dynamic/target textures retain the native path.

`node scripts/bench/preparation-stages.mjs` compares an exact frozen pre-staging source
snapshot with the new path on eight generated materials with six 1024px maps each, at 4×
CPU slowdown. Across three paired rounds, the median largest viewport draw call fell from
93.7ms to 3.2ms and the median largest preparation callback from 45.3ms to 13.7ms. All 48
maps uploaded during preparation instead of 42 uploading during draws; all rendered bytes
matched, with 34 distinct pixel colours and no GL errors. Total completion time was similar
in the later rounds. This demonstrates the multi-map cold path, not universal UI latency.
An earlier production probe with staging alone still saw 152ms versus 150ms post-loader
tasks and similar convergence, so unrelated draw costs remain. Its full-quality convergence
after the loader cleared was approximately 35.7s versus 35.8s, with one quality transition.
The final implementation matched all five graph cases on Chromium WebGL, Firefox WebGL
and actual WebGPU. A clean render-suite run passed 1,008 tests; an earlier concurrent browser
run triggered the pre-existing animation-allocation warmup check, which passed unchanged
in isolation and in the clean full run (its allocation threshold was not relaxed).

In the final production 4× CPU probe, the largest post-loader task was 135ms versus 152ms
before; initial application setup remained 233ms versus 229ms. Both runs converged fully
with one quality transition and no pending work. After the loader cleared, first completed
scene frames took about 8.53s versus 8.47s, and full convergence 35.60s versus 35.70s.
This confirms completion and fidelity without proving a general total-startup speedup;
steady full-chain draws and other long jobs still need work.

### Exact cascade depth reuse

`SunCascades` now optionally records the actual placed light/projection matrices and
caster inputs, reusing a depth map only when those inputs are unchanged. WorldRenderer
enables this during viewport rendering, explicitly invalidates it as preparation completes,
and keeps captures on the live path. Temporal filter rotation still runs for every receiver
frame; it does not require redrawing unchanged depth. No cascade, map resolution or filter
tap is removed. Standalone SunCascades consumers retain native updates by default.

Caster snapshots cover transforms, geometry/instance upload versions, visibility, layers,
material alpha/displacement inputs, texture upload versions and UV transforms, clipping
planes and map disposal. Aether's known colour nodes have read-only alpha certification;
unknown colour, mask, position or depth nodes keep live updates. Skins, morphs, indirect GPU draws, custom
callbacks (including shadow callbacks), dynamic alpha textures, transmitted shadows,
unknown renderer contexts and VSM also keep the live path. Buffer and texture mutations
must still follow Three's normal `needsUpdate` contract. This is an exact static-scene
optimization, not an animation-freeze policy.

`node scripts/bench/cascade-shadow-cache.mjs` compares independent live and cached
renderers on a generated 100-caster scene. Twenty unchanged frames issue 60 versus zero
cascade passes. Tests compare full pixel bytes after caster, visibility, alpha-texture,
camera, sun and geometry edits, filter rotation, explicit invalidation, capture mode
switches, renderer-context restoration, certified/unknown colour nodes and animated custom positions.
All 17 cases matched byte-for-byte on Chromium WebGL, Firefox WebGL and actual WebGPU;
all three backends skipped unchanged passes and retained dynamic fallback updates. An in-place native cascade
map-resize experiment raised WebGL error 1282 even in the uncached reference; production
quality changes already replace the sun/cascades through EnvironmentRig rather than
resizing those live targets. Size/disposal invalidation is covered separately by input tests.

A paired 4× CPU production probe still reached full effects/refinement with one quality
transition and no pending work, but the candidate included a 383ms post-loader task versus
138ms in the reference. Full convergence was 42.02s versus 43.46s from navigation.
A repeat of the final candidate saw a 146ms post-loader task and converged at 42.64s.
The house probe uses a single-map plan, so it does not exercise this new cascade cache.
These runs verify completion, not a responsiveness benefit from this feature. Dynamic-caster
scenes retain their normal redraw cost, and first-use rendering still has long tasks.
The render suite passed 1,016 tests, with typechecking and production build also passing.

### UV math and rejected prepass/dispatch experiments

The next production trace identified two repeated scene draws (beauty and geometry data),
roughly 700 object submissions per full refinement frame. Unconditionally disabling lighting
for the geometry pass matched normals, velocity, albedo, material data and depth in isolation,
but the full pipeline hid two instanced objects with live shadow updates. Cached-shadow
cases matched; the exact cause remains under investigation. A guarded version kept the
native pass for live/custom shadows and render hooks. Its full-chain comparisons passed,
but a paired instrumented 4× CPU app probe delayed full convergence from 43.84s to 48.39s.
The median retained long draw after 30s fell from 72.2ms to 64.9ms and node updates from
26.8ms to 19.6ms; the additional shader variant/warmup cost was not an acceptable startup
tradeoff. Neither geometry-lighting version ships. The experiment and its reference-image
checks remain in `scripts/bench/geometry-pass-experiment.ts`, `geometry-prepass.mjs` and
`post-prepass-lighting.mjs`.

Native node-update map caching and an inline dispatcher also failed the broader workload
comparison: some generic-node cases improved, but material-reference dispatch regressed
(from 51.8ms to 56.2ms for caching, and 62.4ms to 83.0ms for inline dispatch in separate
4× CPU runs). The native dispatcher remains intact. `scripts/bench/node-dispatch.mjs`
retains the rejected inline experiment (`AETHER_BENCH_NODE_MAP_CACHE=1` selects the map-cache prototype); parity tests exercise actual native NodeFrame
callbacks, changing references, false-return retries, list changes and disposal.

The retained optimization specializes only the pure math of Three r186's zero-rotation UV
setter. It substitutes exact cosine/sine values (including signed zero), while every matrix
write and custom `matrix.set` call still runs. Nonzero/nonfinite angles use the original math
in the same evaluation order. A normalized source-body check accepts the known native and
minified implementations, leaving custom setters untouched; changed Math implementations
also retain their computations. No shader variant, update scheduling, shadow policy or
quality setting changes.

In a clean Chromium run at 4× CPU slowdown, 200,000 UV updates took 13.6ms versus 10.8ms
for zero rotation, 13.4ms versus 11.4ms for signed zero, and 15.7ms versus 13.6ms for a
mostly-zero mix. The all-nonzero case took 28.6ms versus 29.0ms. Firefox at native CPU speed
measured approximately 3→3ms, 4→3ms, 5→4ms and 5→5ms respectively (coarse timer resolution).
These are CPU math measurements, not a claimed overall frame-rate or UI-latency speedup.
`node scripts/bench/uv-transform.mjs` reproduces the paired test. Use
`AETHER_BENCH_UV_MATH=1` with the graph and full-post probes to compare the specialization
against the unchanged native pipeline.


The retained code passed 1,038 render and research tests, typechecking and a production
build. Native-versus-specialized graph checks (five cases) and full-post checks (eight
cases, including changing textures, skinning and live shadows) matched every read-back
byte under Chromium WebGL, Firefox WebGL and WebGPU. An adjacent production-preview
pair at 4× CPU slowdown reached full quality at 43.76s versus 44.50s from navigation,
with no page errors and no pending programs/preparation in either run. This does not
establish an end-to-end speedup. Main-thread rendering stalls remain unresolved; worker
health alone does not move render submission off the UI thread.

### Transform-updatable batching research (not enabled)

`scripts/bench/draw-census.mjs` records actual backend submissions by scene pass,
entity and existing batching exclusion. It accepts `AETHER_BENCH_WORLD` and
`AETHER_BENCH_URL`, so the census also works on newly generated environments.
The production house sample had 338 distinct objects in its main scene pass:
96 opaque objects had operable behaviors/kinematic physics, 39 had overrides,
58 were non-indexed and 22 were opaque assets. Existing merges already saved
229 submissions per pass. The 58 non-indexed objects could neither form groups
of three nor join the existing material groups; relaxing that rule alone would
not help this sample.

`dynamic-batches-experiment.ts` groups eligible opaque meshes by material,
attribute layout, index mode, render order and shadow flags, keeping distinct
geometry and updating transforms in a native `BatchedMesh`. The original meshes
stay available for picking. The experiment rejects deformation, custom render
hooks, partial draw ranges, mirrored/sheared transforms and non-static attributes.
It restores standalone drawing when a member changes geometry/material/shadow
flags or develops an unsupported transform. The snapshot prototype now evicts members after geometry attribute/index/bounds
changes, material pipeline changes, callback changes or ancestor ordering changes.
It does not yet integrate regrouping, lightmaps or the full renderer lifecycle,
and must not be installed in production.

The pinned Three r186 batch draw lists can be overwritten by nested shadow
renders ([upstream issue and fix](https://github.com/mrdoob/three.js/issues/34822)).
For its own batches, the experiment prepares the camera-specific list inside
`NodeManager.updateForRender`, after shadow updates and before native node/binding
updates; native callbacks are otherwise unchanged. Four research tests cover
movement, visibility, picking-layer ownership, disposal, standalone fallback,
transform exclusions and restoring the view-camera list after shadow culling.

`AETHER_BENCH_POST=1 AETHER_BENCH_CPU_RATE=4 node scripts/bench/dynamic-batches.mjs`
compares 400 individually rendered objects with four batches through the actual
full post chain. The first Chromium WebGL run reduced cached-shadow submissions
from 845 to 59 and median CPU submission time from 17.9ms to 4.8ms. Eight cases
exercise live/cached shadows, movement, nonuniform scale, detachment, visibility
and camera changes. Chromium outputs matched or differed by one byte value.
Firefox and WebGPU failed the retained strict final-image gate after camera
movement (largest byte differences 32 and 9 respectively). Firefox attachment
inspection found matching diffuse/velocity outputs and sparse one-unit normal or
material storage differences. The strict individual-mesh image gate remains failed. The native-instancing
control described below isolates this amplification without weakening that gate.

`node scripts/bench/dynamic-batches-app.mjs` probes the full application. Both sides
use synchronous preparation/program completion so omitted first-use objects cannot
count as a speedup. In a 4× CPU development run, 14 groups combined 163 source meshes
(149 potential saved submissions per pass). Median full-draw CPU time fell from
66.0ms to 52.4ms, with cached-shadow submissions falling from 744 to 494 and no
pending preparation/programs on either side. The candidate still had a 232ms spike
versus 77.2ms in the reference. This is a development CPU submission experiment,
not a production frame-rate, startup or UI responsiveness claim. Earlier app runs
with pending preparation were discarded. No runtime code changed for this research.


### Native-instancing controls and fully hidden groups

The multi-draw probe now supports `AETHER_BENCH_CONTROL=instance` for native
`InstancedMesh` groups and `AETHER_BENCH_REFERENCE=instance` to compare those groups
against the batching prototype. On Firefox, native instancing reproduced the same
17 camera-change color-component outliers (maximum difference 32) seen against
individual meshes. Comparing the prototype directly with native instancing matched
exactly or within one byte value across all eight full-post cases in Firefox,
and matched exactly in WebGPU. This is evidence of the same floating-point behavior
as native instancing, which the framework already uses, rather than missing objects
or incorrect camera history. The original individual-mesh gate is still reported;
no threshold was raised.

That control also exposed a production issue in `StaticBatches`: it kept submitting
fully hidden groups with zeroed instance matrices. Those matrices have w=0, so
native initial sphere calculation could generate NaN centers; rendering hidden
groups also copied zero matrices into native instancing's previous-frame data.
`StaticBatches` now hides its proxy when no members can draw. Initial bounds union
only nonzero instance slots, using the same Float32 transforms the GPU receives.
Showing a member again restores the proxy and expands its bounds normally.

The production change has two new unit cases for fully/partially hidden initial
populations, stable hidden frames and reappearance after movement. The full render
and research suite passed 1,047 tests before the final research-only hardening.
Typechecking and production build passed. Full-post checks against native instancing
matched every output byte in eight Firefox/WebGPU cases, and all nine Chromium/Firefox
cases starting with 400 hidden objects, including their later reveal. Use
`AETHER_BENCH_POST=1 AETHER_BENCH_CONTROL=static AETHER_BENCH_REFERENCE=instance`
with `scripts/bench/dynamic-batches.mjs`; `AETHER_BENCH_INITIAL_HIDDEN=400` exercises
the initial-hidden case. `AETHER_BENCH_REFERENCE=static-before` reconstructs the prior
production behavior through a checked Vite response edit. In Firefox, the old path
submitted 67 calls while the whole group was hidden, versus 51 after the fix (the
remaining calls render the floor/post chain). The old-versus-corrected output differed in 37,251 components on restoration
(maximum 88), while the corrected production path matched native instancing
exactly in its separate control run. No general UI
latency or whole-scene FPS improvement is inferred from this hidden-group case.

The deployed production smoke test exercised an actual ten-member app batch:
all hidden members suppressed the proxy, restoring them restored drawing with
finite bounds, and no page errors occurred. Foliage workers, screenshot and capture
session output, restored capture size, local API access and the existing public
tunnel all passed. The final focused run passed 23 static-batch/research tests,
including eight hardened dynamic-batching research tests; final typechecking passed.


### Signed motion and retained draw-batch lifecycle work

A direct GPU check through the actual post chain found that the velocity attachment
inherited the normal target's unsigned RGBA8 layout. Three's pass setup later changed
only its primary output to the renderer's half-float type; velocity remained unsigned.
Motion expected to be -0.1 read back as 0, while +0.1 read back as 0.0980392. A 0.0002
motion in either direction quantized to zero. This masked motion-history differences
in older unsigned-attachment comparisons.

The runtime now explicitly uses RG16F for the two signed velocity components. It has
the same nominal four bytes per texel as the old RGBA8 attachment and half the storage
of an RGBA16F correction. `scripts/bench/motion-vectors.mjs` checks seven analytical
object-motion cases (positive, negative, diagonal, subpixel and still) against expected
NDC displacement. Chromium WebGL, Firefox WebGL and WebGPU preserved both signs; the
largest error was 0.0000244141 at a displacement of 0.1. Set
`AETHER_BENCH_MOTION_FORMAT=rgba8` to reproduce the old failure, or `rgba16f` for the
full-width signed reference. `AETHER_BENCH_MOTION_LAYOUT=1` in the full-post probe
compares RG16F against RGBA16F: eight cases and every captured attachment byte matched
in all three backends. WebGPU's temporal AA output remains disabled by its existing
backend guard; the probe explicitly requests a velocity attachment to test the format.
Velocity read-back uses an RGBA32F copy, since direct RG readPixels is not portable.

The new internal `DrawBatches` implementation is not yet enabled in SceneSync or the
running application. It retains unchanged groups across regroups, lets static instancing
and merges elect their sources first, bounds its copied buffers, preserves picking on
originals, updates coarse and per-instance culling, and evicts stale geometry/materials.
Original meshes continue rendering while new groups warm; activation follows a primary
native node update. When originals resume, their previous world pose is seeded from the
batch rather than from before they joined. Eight lifecycle tests passed. A type-string
check was also corrected in the research prototype: Three's `InstancedMesh` has type
"Mesh", so explicit instanced/batched/skinned flags must exclude already-instanced data.
That regression now has its own test.

An audited, synchronous-preparation 4× CPU app probe using the new class combined 135
sources into 12 groups (123 potential saved submissions per pass). Every group contained
zero existing instanced/batched/skinned meshes. Both sides submitted 2,367,102 triangles
without shadow refresh and 3,513,400 with refresh, with no pending preparation/programs.
Median full-draw CPU time fell from 63.5ms to 54.0ms; submissions fell from 744 to 498 in
cached-shadow frames and 1068 to 699 with refresh. The candidate still had a 175.6ms
spike versus 79.5ms in the reference. These development measurements establish a steady
submission opportunity, not a production startup/UI benefit. Use
`AETHER_BENCH_DRAW_BATCHES=1 node scripts/bench/dynamic-batches-app.mjs` to reproduce.

### Compact reflection material attachment

The reflection pre-pass stores metalness and roughness in RG8 instead of RGBA8.
Both values retain eight-bit precision; the unused blue/alpha channels are omitted.
Nominal storage for this attachment falls from four to two bytes per pixel when
reflections are enabled. This is a storage reduction, not a measured FPS claim.

`AETHER_BENCH_MATERIAL_LAYOUT=1 node scripts/bench/post-prepass-lighting.mjs`
compares the runtime against a checked RGBA8 reference. The probe verifies the
actual texture type/format and copies both layouts to RGBA32F for portable readback.
Its material-gradient case includes all 256 input levels, alongside the moving
camera, skinning, instancing, alpha, texture rotation and shadow-update cases.
All nine cases matched every compared byte in Chromium WebGL, Firefox WebGL and
Chromium WebGPU. The 1,034 render tests passed under the repository's Node 24 runtime;
typechecking and the production build also passed. RG8 is a color-renderable format
in the [OpenGL ES 3 specification](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf).

### BVH warmup without blocking the page

Idle picking acceleration now constructs triangle BVHs in a small module worker.
The same pure Morton-sort/build/refit kernel serves synchronous picks and worker
warmup. Source buffers stay attached to live geometry; one input is copied at a
time, results transfer back, and the worker terminates after 15 seconds idle.
Shared geometry deduplicates warmups. Geometry edits, replacement and disposal
invalidate late results, while a tree built by an early pick retains its identity.
Initial automatic camera framing and Studio’s later frame-world call await worker
preparation of accelerated scene meshes, so late-arriving geometry does not force
cold trees back onto the UI thread during startup framing.
Workers that fail or are unavailable retain idle construction and synchronous
picking. This moves warmup builds, not refits or all rendering, off the UI thread.

`node scripts/bench/raycast-bvh-worker.mjs` checks actual worker output byte for
byte on indexed and non-indexed 320,000-triangle meshes and measures page timer
gaps. In one Chromium run with 4× main-thread throttling, maximum gaps fell from
114.8/88.4ms to 10.9/13.1ms. Firefox at native speed matched the buffers too, with
gaps falling from 44/37ms to 11/5ms. Worker startup made Firefox's first build
take longer overall (58ms versus 40ms); responsiveness is the benefit, not a
guarantee of shorter wall time. Set `AETHER_BENCH_BROWSER=firefox` to reproduce.

The studio/render suite passed 1,739 tests; the final Studio framing call also
passed its 699-test suite, typechecking and the production build. A deployed
4×-throttled startup profile contained no sampled main-thread BVH build calls
after both framing paths awaited preparation. It still contained initialization,
shader and render stalls; this is not evidence that all startup latency improved.
The live app smoke found the new worker, drained render queues, hid/restored a
batched group and produced nonempty screenshot and capture-session images.

### Off-thread character texture baking

Character variants now use a shared, lazy tint-bake worker for canvas readback
and recoloring. The synchronous API remains available as a fallback. Both paths
use the same lookup tables and pixel kernel, preserve alpha and texture sampling
settings, and keep original bitmaps usable by other variants. One bitmap/mask job
is submitted at a time; output pixels transfer back, and the worker terminates
after 15 seconds idle. Removed variants dispose late material/texture results.

`node scripts/bench/tint-worker.mjs` compares body, head and hair tints using
bitmap, canvas and compressed-texture original images. All nine 1024×1024 cases
matched every pixel byte and sampling setting in Chromium and Firefox. In one
4×-throttled Chromium run, maximum page timer gaps fell from 81–193ms to 15–18ms.
Firefox at native speed also matched; its worker gaps were usually 6–10ms, with
one 72ms outlier. These are targeted baking measurements, not whole-app FPS gains.
Use `AETHER_BENCH_BROWSER=firefox` for the Firefox probe. Lifecycle tests cover
bounded queues, unavailable/crashed workers, malformed replies, timeouts and late
results after a variant is released.
The 1,743-test studio/render run passed; after adding a yield between fallback
bakes, all five focused lifecycle tests, typechecking and the production build
passed too. A deployed 4×-throttled profile had no sampled main-thread recoloring
calls. The live smoke found three mounted characters with three baked textures,
empty render queues, valid hidden-batch restoration and nonempty capture images.

### Finite ray traversal

Accelerated finite raycasts now seed BVH traversal with a conservative local-space
distance bound instead of always searching an infinite ray. The bound uses an
upper bound on the inverse transform's operator norm, including shear and
nonuniform/mirrored scale, with rounding slack for large world coordinates.
The final world-space near/far checks remain unchanged. A coverage hint avoids
scale-bound setup for ordinary nearby meshes. The existing sphere check remains
unchanged; pruning uses the built/refitted tree rather than a new display-bound
clip that could reject edited geometry with stale display bounds.

`node scripts/bench/bvh-range.mjs` compares against a checked copy of the prior
unlimited traversal on 10,000-query batches. Chromium with 4× CPU throttling:
distant queries 30.7→3.9ms, mixed queries 30.8→7.1ms, sheared distant queries
30.4→4.1ms. Visible queries were 32.1→32.7ms and unlimited queries 31.6→31.6ms.
Firefox at native speed also matched every hit count/distance/triangle checksum:
distant 13→3ms, mixed 20→6ms, sheared distant 22→4ms, visible 15→16ms, unlimited
19→18ms. These are ray-query measurements, not whole-app FPS claims. Set
`AETHER_BENCH_BROWSER=firefox` for Firefox. Regression tests cover 400 transformed
queries, exact far-boundary hits, stale display bounds after refitting, and zero
triangle reads when the entire tree lies beyond the distance limit.
The 1,747-test studio/render suite, typechecking and production build passed.
The deployed smoke retained all three characters/tint textures, drained render
queues, restored hidden batches, and produced valid screenshots/capture frames.

### Background static geometry merges

WorldRenderer now builds static procedural merge buffers in a module worker,
including transformed positions/normals, normalized/interleaved/half-float reads,
indices, colors, exact bounds and baked-lightmap expansion. The worker uses the
same merge and lightmap kernels as the inline path. Source buffers stay attached;
one copied input is in flight, canceled queued jobs release references, and idle
workers terminate after 15 seconds. Clear/dispose cancels work. Publication checks
source attributes, versions, accessors, geometry/material identity and relative
poses; matching in-flight groups survive a regroup.

Originals retain picking ownership while a pending proxy reserves their render
layer. WorldRenderer holds the last complete frame until preparation finishes,
reports scene processing, and then prepares the resulting GPU resources before
drawing. CPU preparation waits pause the black-frame watchdog's no-frame/give-up
clocks; completed-frame adaptive-quality sampling remains unchanged. Captures
await preparation and retain an atomic inline path for temporary capture poses.
Failed workers fall back to the original merge path with task yields between jobs.

Low-level `new StaticMerges()` and `new SceneSync()` retain synchronous defaults.
Hosts opting into `SceneSyncOptions.backgroundMerges` must honor
`batchPreparationPending` or await `waitForBatches()` before drawing, and can use
`synchronousBatches()` for atomic captures. WorldRenderer enables and manages this
automatically for all environments; no template-specific switch is involved.

`node scripts/bench/static-merge-worker.mjs` checks actual worker output and page
timer gaps for 199,692 source vertices. All buffer bytes and bounds matched in
Chromium and Firefox, including a lightmapped expansion to 1,179,648 vertices.
In one Chromium run with 4× main-thread throttling, reference timer gaps were
89/121/171/416ms (plain, normalized/interleaved, half-float, lightmapped) versus
5/5/20/34ms with the worker. Cold startup increased the first job's wall time
from 88ms to 161ms; the benefit is page responsiveness, not guaranteed faster cold
completion. Firefox at native speed also matched, with 5–8ms worker timer gaps;
its first cold job took 220ms versus 32ms inline. Use
`AETHER_BENCH_BROWSER=firefox` for that probe.

The 1,759-test studio/render suite passed, including allocation checks, cancellation,
source mutation, superseded lightmaps, timeouts and atomic captures. An iterator
allocation in the new pending getter was found and removed. The integrated editor
probe completed 38 merges (277 saved submissions per pass), retained characters and
tint textures, drained preparation queues, restored hidden batches and produced
valid screenshot and capture-session images.
Publication counters update in constant time and are tested against interleaved
completion/removal; the live cached counters also matched the actual ready groups.
A deployed startup profile had no sampled main-thread merge-kernel calls. It still
showed script initialization, texture uploads and shader completion stalls, so
this does not establish that all startup or render-thread work is nonblocking.

### Lighting experiments and GPU timing

Two follow-up light-bake experiments were rejected. Visiting the nearer BVH half
first for any-hit shadow rays preserved 100,000 answers over 6,000 generated
triangles but slowed the measured Node workload by about 15%. Reusing volume-sample
results and removing an incident-light temporary array produced byte-identical
lightmaps (52,367 texels and 2,513,616 rays per room case), but median whole-bake
times were neutral to slower in Chromium and Firefox. Neither change ships.

`node scripts/bench/gpu-frame-cost.mjs` isolates GPU pixel cost from CPU contention
using a generated WebGL2 shader. Set `AETHER_BENCH_BROWSER=firefox` for Firefox.
It follows the [Khronos timer-query contract](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/):
poll availability after returning to the browser, reject disjoint results, and
never request an unavailable result. Unsupported contexts are reported explicitly.
Each case warms four draws and reports ten valid samples when available.

On the measured integrated GPU in Chromium, adding a 25 ms CPU delay left GPU
duration at 0.193 ms; increasing shader work raised it to 4.517 ms, and halving
both drawing dimensions reduced that to 1.140 ms. This demonstrates why frame
rate alone cannot identify a resolution bottleneck. The probe does not yet alter
the runtime quality policy or establish a whole-app speedup.

The runtime now samples GPU draw cost sparsely on WebGL2 devices that expose
timer queries. Three fresh samples are required before evidence can protect
resolution, and the p90 must leave 20% of the target frame budget free. CPU-only
delays then retain sharpness; existing sustained GPU-overload decisions remain.
Resolution can also recover with measured GPU headroom when CPU frame rate stays
low. Draw dimensions, scene-pass scale or pipeline changes discard old evidence;
samples expire after 500 ms. Invalid, disjoint, incomplete and timed-out queries
are ignored. Queries are bounded and reused, never awaited in the render loop.
Missing timer support, WebGPU and enabled Three timestamp tracking use the
existing frame-time policy. Captures retain their atomic drawing path.

`node scripts/bench/gpu-resolution.mjs` (with Vite on `AETHER_BENCH_URL`, default
5177) compares resolution decisions under a controlled 25 ms CPU delay. On the
measured integrated GPU, the old policy reached 0.5 scale while the GPU-aware
policy retained 1.0, both completing 180 frames in 4.5 seconds. Adding real GPU
shader work still reduced scale to 0.69 in a separate run. These are synthetic
policy checks, not whole-app throughput claims. Unit tests cover expiry, missing
results, disjoint/context loss, query ownership, resolution/pipeline changes and
fallback. Browser regression checks cover camera movement, hidden-batch restoration,
worker-backed characters and foliage, screenshot/capture output and restored sizing.

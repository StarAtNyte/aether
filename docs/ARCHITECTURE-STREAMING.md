# Streaming architecture: design (draft for review)

Status: design, partly implemented. Stage 3 (worker generation, geometry cache), the first part of stage 1 (frame
budget, sliced vertex uploads, `scripts/arch-probe.ts`), stage 4a (the cell grid, per-cell shadow and virtual batches,
material-grouped draw order), the first slice of stage 5 (cooked packages, §3.5.1) and part of stage 2 (the recorded program set of each tier pre-warmed at boot, the sweep off,
neighbouring tiers primed at rest, each material linked once, first use of every program behind the load screen; its gate is not met yet) are in; their numbers are in [PERFORMANCE.md](PERFORMANCE.md).
Profiling: 6 November 2026, on the build of `ec8b9593` plus the uncommitted work in the tree at the time. This document
covers measured baselines, the target architecture and a staged plan.

The goal is to move the renderer from "build the whole world, prepare every program, then show it" to a streamed
world, as Unreal does. The mapping:

| Unreal | Aether equivalent |
|---|---|
| World Partition | a grid of cells, streamed by distance from streaming sources |
| One File Per Actor | edits keyed per entity by a params hash |
| HLOD | merged per-cell proxies for the far field |
| Nanite | the existing `virtual/` cluster DAG, extended |
| Derived Data Cache | a cache of generated geometry keyed by input hash |
| Cook | baked, compressed GLB cells at publish |
| PSO cache | a fixed shader set per tier, pre-warmed |
| Async loading | generation in workers |

The opening view (eye-level first frame) is being built separately and is not covered here.

---

## 1. Measured baselines

### 1.1 How it was measured

**Build.** `vite build --sourcemap` into `/tmp/arch-dist`. The sourcemaps are only there to attribute CPU samples
back to source files.

**Harness.** The probe scripts are not in the repo. They are Playwright scripts plus CDP, run like the e2e harness
(`tests/e2e/support/env.ts`: `STATIC_DIR`, `GEN_GPU`). Each run had its own capped scope (`nice -n 10`,
`systemd-run --scope -p MemoryMax=7000M -p MemorySwapMax=0`) and one browser at a time. Per world:

1. Open `#/new/<slug>?debug=1` with a fresh profile.
2. Wait for `aether:fully-loaded` and for the load screen to leave.
3. Orbit for 20 s around the content centre at the opening view's height and distance, one full turn.
4. Enter play mode and time `KeyW` six times.

**Instruments:**
- The V8 sampling profiler (0.5 ms), mapped through the sourcemaps.
- A Chrome trace with categories `toplevel`, `devtools.timeline` and `blink.user_timing`, giving busy time per thread
  for every process, the GPU process included.
- `long-animation-frame` and `longtask` observers.
- Wrappers on `WebGL2RenderingContext.prototype`: call count, main-thread milliseconds and bytes for compile, link,
  `getProgramParameter`, `bufferData`/`bufferSubData` and the `tex*Image*` calls.
- A wrapper on `Worker` that counts jobs per worker.
- `performance.memory`, and the cgroup's `memory.current` for the whole browser.

**Generation cost per generator.** Measured offline in Node, single-threaded and cold, by running every unique
procedural output of the world's IR through `generateBuiltinSync`, and custom generators through
`compileGenerator`/`runCompiled`. These are the exact functions the workers run.

**Machine and GPUs.** The office PC: 32 threads, 31 GB RAM.
- `GEN_GPU=intel`: Intel UHD 770 (Raptor Lake-S GT1), WebGL2 over ANGLE GL-EGL, Mesa.
- `GEN_GPU=nvidia`: RTX 4090, WebGL2 over ANGLE GL-EGL.

The automatic tier was kept: medium on Intel for Kestrel, low on Intel for the three heavy worlds, high on NVIDIA.
1600x900 viewport, headless.

**Caveat.** This PC is shared: other agents ran browsers on both GPUs during the runs. Absolute frame times are noisy.
The large effects below (tens of seconds, hundreds of calls per frame) are far beyond that noise. Kestrel on Intel,
measured twice, gave load 35.0 s and 34.4 s, and an orbit p50 of 16.7 ms on the first run against 33.2 ms on the
second.

### 1.2 Load

All times in seconds from navigation. "Programs" is three's `info.memory.programs` after load. "GPU-main" is the busy
time of the GPU process's main thread (`CrGpuMain`) during the load: compile, link and GL command execution.

| World (scene tris, instances) | GPU | sync-done | compile window | sweep | fully loaded | programs | GPU-main busy | renderer main busy | worker busy |
|---|---|---|---|---|---|---|---|---|---|
| Kestrel Outpost (0.7 M, 578) | Intel medium | 2.1 | 2.6–11.6 | 17.6–33.3 | **33.9** | 128 | 30.8 | 4.9 | 2.1 |
| Linden Row (2.8 M, 11.7 k) | Intel low | 3.5 | 6.2–21.2 | 33.3–45.4 | **46.0** (screen gone 53.6) | 142 | 40.5 | 14.8 | 14.2 |
| Sanctuary Terraces (14.7 M, 10.8 k) | Intel low | 4.9 | 5.6–20.6 | 36.2–61.0 | **61.6** (screen gone 70.5) | 171 | 57.6 | 10.0 | 18.8 |
| Lisbon Hills (89.8 M, 32.0 k) | Intel low | 16.0 | 16.5–31.5 | 32.1–47.7 | **48.3** | 107 | 37.6 | 14.9 | 26.8 |
| Kestrel Outpost | NVIDIA high | 2.9 | 3.6–8.2 | 14.3–33.3 | **33.9** | 176 | 32.8 | 10.8 | 1.5 |
| Linden Row | NVIDIA high | 3.7 | 5.2–20.3 | 31.2–75.0 | **91.6** | 242 | 88.4 | 40.3 | 26.0 |
| Sanctuary Terraces | NVIDIA high | 5.1 | 5.9–20.9 | 28.9–78.9 | **178.9** (render stage pending 79–179) | 98 | 165.6 | 32.7 | 7.4 |
| Lisbon Hills | NVIDIA high | 12.5 | 13.0–28.1 | 28.7–78.7 | **122.8** | 187 | 118.6 | 60.1 | 20.1 |

What the load is made of:

1. **Shader programs are most of the load.** The compile window is `warmShaders` → `compileScene`, capped by
   `SHADER_WARMUP_MS` = 15 s, and it hits that cap on the three heavy worlds. The hidden four-heading sweep
   (`prepareSurroundings`) takes another 12–50 s. On NVIDIA (high tier) the load then waits again on the `render` stage
   (late preparation and programs): Sanctuary does not finish until 179 s, Lisbon until 123 s.
   - Together they are 25–60 s of every Intel load, and 30–100 s on NVIDIA.
   - During them the GPU process's main thread is busy 85–97 % of the time. Its tasks over 50 ms add up to 20–49 s
     per load, the longest single one 1.3–1.9 s, which is one program link (Mesa and NVIDIA alike).
   - On Intel the renderer's own main thread is idle 60–70 % of the load: on Kestrel/Intel 22.8 s idle against 8.7 s
     busy. On NVIDIA it is the second bottleneck: Lisbon is 60 s busy, with 602 tasks over 50 ms (longest 3.7 s), and
     Linden Row is 40 s busy, with 274 such tasks.
   - Programs whose link took long (`slowProgramLinks`): 9–100 per world, adding up to 22–333 s of link time spent
     in parallel.
2. **Generation is serial and partly on the main thread.** It ends at `sync-done`: 12.5–16 s on Lisbon, 2–5 s
   elsewhere.
   - Lisbon's 16 s is the custom generators. They run on one sandbox worker (`createWorkerSandbox({ poolSize: 1 })`
     in `Studio.ts` and `PlayerApp.tsx`), and each reply is validated on the main thread (1.9 s of main-thread
     long-animation-frame script time in `worker-sandbox.ts`).
   - Built-in generators run on one compute worker (`ComputeClient`, not a pool).
   - Time a job spent in flight per worker (Intel rerun, from the `Worker` wrapper):

     | World | Generator sandbox | Virtual-geometry DAG (`aether-dag`) | Compute (built-ins) | BVH |
     |---|---|---|---|---|
     | Lisbon | **15.8 s**, 219 jobs, serial, longest 1.2 s; the worker is recycled every 100 runs, hence 3 instances | **11.8 s** | 1.6 s | 2.9 s |
     | Sanctuary | 1.3 s | 0.8 s | **3.7 s** | |
     | Linden | | 1.6 s | 2.7 s, 1,742 jobs | 1.2 s |

     Linden's frame-sample worker job of 5.9 s is a single long job, not on the load path.
   - Repeat runs (Intel, same build): load Lisbon 48.8 / 47.6 s, Linden 54.3 / 43.6 s, Sanctuary 71.4 / 53.7 s.
     Lisbon's orbit p50 was 49.9 ms in both runs.
3. **Node-material building on the main thread** (three's `NodeBuilder` build/analyze/generate, called from
   `render-preparation.ts` `pump`/`buildAhead` and `compileAsync`): 4.4 s on Kestrel and 7.2 s on Lisbon (Intel).
   This is shader *source* generation in JS, separate from the driver's compile.
4. **Geometry and texture uploads are single, unbounded calls:**

   | Call | World | Total | Largest single call |
   |---|---|---|---|
   | `bufferData` | Lisbon | 310 MB in 1.53 s | 438 ms |
   | `bufferData` | Sanctuary | | 302 ms |
   | `bufferSubData` | Linden/NVIDIA | 262 MB in 4.1 s | 675 ms |
   | `texSubImage2D` | Linden | 205 MB | 1,688 ms (`texture-cap.ts` `updateTexture` redrawing image textures to 512 px on the main thread, 2.3 s in all) |

5. **Other main-thread costs during load:**
   - `metreUvMesh` 1.55 s on Lisbon.
   - `partToBufferGeometry`'s geometry key hashing 1.65 s on Lisbon.
   - The opening-view probe raycasts (`chooseOpeningView` → `opening-probe.ts` `surface`), 1.0–1.7 s per world.
     That code is being changed by the opening-view work.
   - The BVH warm-up 0.5–0.7 s.
6. **Downloads are small:** 21–39 MB per world. Most of it is JS (9.3–11.5 MB) and GLB (4–22 MB). The world IR is
   0.1–1.9 MB, and parsing plus validating it takes 14–134 ms. Network is not the problem.

**Returning visitor: Chrome's GPU program disk cache.** Two browser launches on one persistent profile, Intel. The
second launch has the program cache warm.

| World | Run | sync-done | compile window | sweep | fully loaded | slow links |
|---|---|---|---|---|---|---|
| Kestrel | cold | 3.4 | 4.1–13.4 (9.3 s) | 18.1–30.8 (12.6 s) | 31.4 | 24 |
| Kestrel | warm | 2.2 | 2.9–4.8 (1.9 s) | 11.7–14.7 (2.9 s) | **15.3** | 3 |
| Lisbon | cold | 16.3 | 16.6–31.6 (15.0 s) | 32.1–40.7 (8.6 s) | 41.3 | 5 |
| Lisbon | warm | 15.0 | 15.3–21.4 (6.2 s) | 26.5–36.8 (10.3 s) | **37.4** | 0 |

- A warm program cache halves Kestrel's load. The 7 s left between the compile and the sweep is preparation,
  `lateWarm` rounds and the gate's polling.
- Lisbon barely moves: its 15 s of generation before the first frame, and a sweep bound by drawing rather than
  compiling, remain. So the fixed shader set (§3.7) alone fixes the small worlds. The big ones need the generation
  work (§3.4–3.6) and streaming (§3.1–3.2) as well.

### 1.3 Generation per generator (single thread, Node, unique outputs)

| World | Total | Top costs (ms, entities/unique, M tris, MB output) |
|---|---|---|
| Lisbon Hills | **11,729 ms** | `lisbon-retaining`* 7,640 (18/18, max 1,207 per entity, 2.53 M, 94 MB); `lisbon-row4`* 3,162 (161/161, 2.15 M, 142 MB); `lisbon-terrain3`* 333; `lisbon-street3`* 209; `lisbon-setts`* 154; `lisbon-kerbs`* 126; `red-bridge5`* 45 |
| Sanctuary Terraces | **3,215 ms** | `figure-statue` 1,502 (2/2, max 930); `sanctuary-massif`* 923; `classical-temple` 284; `marble-grand-stair`* 201; `mountain` 136; `cliff-face` 91 |
| Linden Row | **951 ms** | `terrain` 291 (max 213); `furn-part` 99 (253); `furn-plant` 73; `hedge` 72; `furn-curtain` 44 (165); `shrub` 37 |
| Kestrel Outpost | **395 ms** | `cliff-face` 146; `sandbag-wall` 68; `shipping-container` 51; `boulder` 43; `tree-spruce` 36 |

`*` marks custom (world-defined) generators, which run in the sandbox worker.

Generated output that stays resident as CPU geometry: Lisbon about 266 MB, plus `generatorCacheMB` 44. Across the
whole set, the top ten generators by cost are: `lisbon-retaining`, `lisbon-row4`, `figure-statue`, `sanctuary-massif`,
`lisbon-terrain3`, `terrain`, `classical-temple`, `lisbon-street3`, `marble-grand-stair` and `lisbon-setts`.

### 1.4 Memory

| World | GPU | JS heap peak | Browser total (cgroup) peak | GPU estimate (textures + targets + buffers) |
|---|---|---|---|---|
| Kestrel | Intel | 317 MB | 2.25 GB | 202 + 188 + 18 MB |
| Linden Row | Intel | 727 MB | 3.22 GB | 465 + 122 + 54 MB |
| Sanctuary Terraces | Intel | 501 MB | 2.64 GB | 311 + 122 + 62 MB |
| Lisbon Hills | Intel | **1,442 MB** | **4.14 GB** | 352 + 122 + 328 MB |
| Kestrel | NVIDIA | 548 MB | 1.91 GB | 273 + 252 + 20 MB |
| Linden Row | NVIDIA | 1,061 MB | 3.31 GB | 840 + 122 + 72 MB |
| Sanctuary Terraces | NVIDIA | 1,167 MB | 2.68 GB | 214 + 186 + 24 MB |
| Lisbon Hills | NVIDIA | **2,229 MB** | 3.95 GB | 762 + 122 + 390 MB |

Memory grows with the size of the world. Nothing is ever unloaded, because everything is resident from the first
frame.

### 1.5 Frame pacing (20 s orbit after load)

| World | GPU | p50 | p95 | p99 | max | frames > 33 ms | > 50 ms | resolution scale | draws | GL calls per frame |
|---|---|---|---|---|---|---|---|---|---|---|
| Kestrel | Intel medium | 33.2 | 49.9 | 66.7 | 700 | 357 / 691 | 15 | 0.5 | 130 | 313 `bufferSubData`, 91 `useProgram` |
| Linden Row | Intel low | 33.3 | 66.6 | 100 | 233 | 428 / 568 | 43 | 0.5 | 655 | 900 `bufferSubData`, 440 `useProgram` |
| Sanctuary Terraces | Intel low | 33.3 | 49.9 | 66.8 | 517 | 375 / 704 | 19 | 0.5 | 260 | 635 `bufferSubData`, 162 `useProgram` |
| Lisbon Hills | Intel low | **49.9** | **116.6** | **266.6** | 433 | 354 / 388 | 75 | 0.5 | 724 | 1,094 `bufferSubData`, 570 `useProgram` |
| Kestrel | NVIDIA high | 33.3 | 50 | 83.4 | 550 | 440 / 601 | 23 | 0.85 | 530 | 629 `bufferSubData`, 203 `useProgram` |
| Linden Row | NVIDIA high | **50** | 66.7 | 83.4 | 383 | 395 / 421 | 113 | 0.85 | 981 | 1,912 `bufferSubData`, 790 `useProgram` |
| Sanctuary Terraces | NVIDIA high | 16.7 | 50.1 | 99.9 | 117 | 317 / 754 | 39 | 1.0 | 13 (\*) | 10 `bufferSubData`, 8 `useProgram` (\*) |
| Lisbon Hills | NVIDIA high | **66.7** | **183.3** | **200** | 200 | 240 / 246 | 159 | 0.85 | 790 | **4,798** `bufferSubData`, 563 `useProgram` |

(\*) The Sanctuary/NVIDIA orbit circle ran mostly inside the massif: 13 draws at the end, so it is not representative.
Every other run looked at the town.

Causes of the hitches:

- **The steady 30 fps is bound by the GPU process's command stream**, not by the shading:
  - During the orbit the GPU process's main thread is busy 93–98 % of the 20 s on Intel, and 58–97 % on the RTX 4090.
  - Each frame sends 300–1,100 uniform-buffer `bufferSubData` calls and 90–570 `useProgram` calls.
  - The renderer's main thread spends 7–18 s of the 20 s in three's `renderObject` → `_renderObjectDirect` →
    `updateForRender`/`_updateBindings` path: about 11 ms per frame on Kestrel, 30 ms on Linden Row.
  - So both sides of the GL command stream are full: CPU in the page and CPU in the GPU process.
  - Adaptive resolution has already dropped to 0.5 on Intel, which helps neither side.
  - On NVIDIA the page's main thread is the limit for the big worlds: Linden 19.1 s and Lisbon 18.4 s busy of 20 s,
    with 1,900–4,800 `bufferSubData` calls per frame. A faster GPU does not help: Lisbon on the RTX 4090 (high tier)
    orbits at a p50 of 67 ms, worse than on Intel (low tier).
- **Frames over 100 ms (4–23 per orbit):**
  - Nearly all fall while a renderer stage is still pending (`processingStage` = `render`): late preparation, batch
    merges, `lateWarm` program rounds.
  - Some of them coincide with new programs being linked during the orbit: +5 and +4 programs on Kestrel/Intel,
    +16 links on Kestrel/NVIDIA.
  - Script attribution (long-animation-frame): `Simulation.onAnimationFrame` (the draw itself), `render-preparation`
    `pump` and `pipeline-release`.
  - The "fully loaded" gate does not mean the world is finished: objects are still being prepared after it.
- **After the load screen, no main-thread task was over 50 ms on Intel.** On NVIDIA, 6 such tasks remained on Kestrel.
  During the orbit, long tasks (over 50 ms) numbered 2–22 on Intel, and 163 on Linden/NVIDIA, where nearly every
  frame of the high tier's chain is long.

### 1.6 Input latency

Play mode: time from `keydown` (event timestamp) to the first animation-frame callback in which the camera has moved.
Displaying that frame adds one more frame.

| World | GPU | Median | Range |
|---|---|---|---|
| Linden Row | Intel | 60.5 ms (rerun 34.6) | 25.7–79.8 |
| Sanctuary Terraces | Intel | 45.7 ms (rerun 46.5) | 10.4–62.3 |
| Lisbon Hills | Intel | 62.3 ms (rerun 85.9) | 50.6–87.7 |
| Linden Row | NVIDIA | 28.6 ms | 7.9–117.4 |
| Sanctuary Terraces | NVIDIA | 22.3 ms | 12.3–32.9 |
| Lisbon Hills | NVIDIA | **112.6 ms** | 56.9–154 (main thread saturated, frames of 67–200 ms) |
| Kestrel | both | not measured | entering play did not reach `logic` within 60 s in this harness |

So from key to photons is about 60–95 ms at 30 fps on Intel. The path:

1. The key is latched in `InputState`.
2. The next fixed physics step runs.
3. The player rig moves.
4. The camera follows (smoothing).
5. The next frame is drawn.
6. The compositor presents it.

At 30 fps, steps 2 to 6 alone are 2–3 frames.

---

## 2. Current code map

**Scene sync builds everything up front.**
- `SceneSync.setWorld` (`packages/render/src/sync/scene-sync.ts:606`) diffs the new world against the previous one and
  creates a node for every renderable entity. It starts `rebuild()` for all of them in one loop and resolves on
  `Promise.all`.
- There is no spatial ordering, cell or per-frame budget at this level. Assets and models load asynchronously and
  are not awaited.
- Work after sync is time-sliced:
  - `deferRenderPreparation`: 4 ms slices, 40 ms while loading.
  - `parallelPrograms`: `KHR_parallel_shader_compile` polling.
  - `TaskQueue`: 6 ms.

  Uploads are not sliced: `bufferData` and `texSubImage2D` run whole.

**Generators.**
- All built-in generators (`packages/procgen/src/generators/*`, about 90 ids) are pure:
  `(params, seededApi) → { parts: typed arrays, colliders }`.
- Built-ins run on one `ComputeClient` worker. Custom ones run on the locked-down sandbox worker pool, which is
  configured with 1 worker.
- On the main thread today:
  - scatter placements (`scatterPlacements`, `scene-sync.ts:1559`, `:1588`);
  - QEM LOD chains (`LodChainCache`, `field-mount.ts:23`);
  - `metreUvMesh`;
  - geometry key hashing;
  - sandbox output validation.
- Physics regenerates missing colliders with `generateBuiltinSync` (`packages/physics/src/source.ts`).

**Virtual geometry** (`virtual/`) covers two cases:
- Meshes of at least 20 k triangles (`VIRTUAL_MIN_TRIANGLES`) that are not kits: sculptures and terrain. A cluster DAG
  is built in `dag.worker.ts`, and `selectCut` picks a cut per frame by screen-space error, with frustum and
  normal-cone culling.
- Scatter layers of at least 2,000 instances (`FieldCuller`): chunks of 128 instances, LOD with hysteresis, and a
  front-to-back triangle budget.

Virtual sources are 3.7 M triangles on Lisbon. There is no per-cell or far-field merge across entities.

**The voxel streamer is the pattern to reuse** (`packages/voxel/src/streamer.ts`). Its `ChunkStreamer.update`:
1. Walks a precomputed distance-sorted spiral.
2. Puts edit remeshes first, as urgent work.
3. Generates in `vd+1` and meshes in `vd`.
4. Unloads beyond `vd+2` (hysteresis), handing modified chunks to `onEvict`, which saves them to IndexedDB.
5. Stops topping up when `pool.pending >= pool.capacity`, so no backlog can build.
6. Re-kicks itself from every finished job (`setTimeout(0)`), so throughput is independent of frame rate.
7. Drops stale replies by version stamp.

Around it: the pool (`pool.ts`) has 1–2 lanes sized from `deviceMemory`, a per-job timeout and an inline fallback.
The render side (`voxel-layer.ts`) wraps typed arrays without copying and pre-builds new chunk meshes with one
batched `compileAsync` per frame.

**Materials and tiers.**
- `RenderTier` is `low|medium|high|ultra` (`gpu/finishing.ts`). `effectsOf` gives the post effects per tier.
- `MaterialCache.acquire` is keyed by `materialKey + water tier + shade tier`.
- The distinct shaded programs are capped per tier at 8/24/48/96, halved unless the world is a hero world
  (`materials/shading.ts`).
- Warm-up runs in this order:
  1. `warmShaders`;
  2. `prepareAndCompile` (`compileScene`, with a 15 s bound);
  3. `lateWarm` rounds;
  4. `prepareSurroundings` (four hidden headings, WebGL only).
- `shader-release.ts` and `pipeline-release.ts` free shader objects and released programs.

**Editing.**
- `applyPatches` shares structure copy-on-write.
- `diffWorlds` uses reference equality, then `deepEqual`.
- `updateNode` rebuilds only when the shape changed. A material change calls `rematerial`, a transform change calls
  `applyTransform`. Generator and mesh changes rebuild their users, and `relayoutDependents` relays scatters.
- There is no per-entity hash yet. `proceduralOutputKey` (normalized params, seed, source hash) is the natural one.

**Picking, physics and review shots.**
- Picking: three's `Raycaster` on `sync.root`, with a BVH for large meshes (warmed in a worker) and `pickScatter` for
  instances.
- Physics: Rapier is created at play time from the renderer's cached `colliders`, for the whole world.
- Review shots: `capturePoses` waits for preparation, then draws each pose.

**Caches and publishing.**
- Generated geometry is cached in memory only (`GeneratorCache`, 256-entry LRU).
- IndexedDB already holds lightmaps (`lightmap-cache.ts`, content-hash key), light volumes and voxel saves.
- Publishing ships the IR (`game.json`) and the player regenerates everything at load. There is no cook.

---

## 3. Target architecture

```
              IR (whole world, always resident: 0.1-2 MB)
                              |
                    Cell index (entity -> cell, bounds, content hash)
                              |
  streaming sources --> StreamingPlanner (rings, priorities, hysteresis; per-frame, alloc-free)
                              |
          +-------------------+---------------------+
          |                   |                     |
   DDC / cooked cell     worker pool            HLOD proxies
   (Cache Storage)    (generate, post-process,   (cooked or built in
          |            validate, quantize)        a worker at edit-idle)
          +---------> CellCommitter (main thread, time-sliced, budget 2 ms in motion / 8 ms at rest)
                              |
                 GPU: geometry, batches, pre-warmed programs
```

### 3.1 Cell grid

**Grid.** Cells are squares on the XZ plane, keyed `(level, ix, iz)`. Level 0 is the base cell. Levels 1 and 2 are
2x2 and 4x4 groups of base cells, and they carry the HLOD.

**Cell size by world scale.** The extent is the larger side of the bounds of the top-level entities.

| World scale | Extent | Base cell | Examples (cells at level 0) |
|---|---|---|---|
| Room, house | < 64 m | 16 m (or a single cell) | rooms from a photo |
| Village, block | 64–256 m | 32 m | Kestrel (96x124 m: 3x4), Linden Row (150x150 m: 5x5) |
| Town | 256 m–1.5 km | 64 m | Lisbon Hills (780x520 m: 13x9), Sanctuary Terraces (690x700 m: 11x11) |
| Landscape | > 1.5 km | 128 m | future large worlds, 2 km fly-through |

`cellSize = clamp(nextPow2(extent / 12), 16, 128)`. It is fixed per world when the world is created, and stored in the
IR as `world.partition = { cellSize, origin }`, so cell keys stay stable across edits. A world can override it.

**Assigning entities to cells (the "grid levels" of World Partition):**
- A top-level entity (children follow their parent) goes to the base cell holding the centre of its bounds, at the
  lowest level whose cell size is at least its bounds' larger side divided by 2.
  - A house is level 0.
  - A 300 m `lisbon-terrain3` part or a mountain goes to level 2.
  - Anything larger than the level-2 cell goes to the **persistent layer** (always loaded, like UE's "always loaded"
    actors): the sky, the backdrop, whole-world terrain that is not split.
- Bounds before generation come from, in order:
  1. a new optional `estimateBounds(params)` on the generator;
  2. the DDC entry's stored bounds;
  3. the generator's declared scale range;
  4. the persistent layer until known.
- Generators that already produce parts (`lisbon-terrain3 {part}`, terrain `resolution`) get a `tile` param to split
  them per cell.
- **Scatter fields** are split per cell at placement time. The placements are deterministic from the seed, and
  `FieldCuller` already works in 128-instance chunks, so chunks are bucketed by cell. A scatter entity belongs to every
  cell it covers.
- **Logic, lights, NPC brains, rules, HUD and audio** are data and stay in the always-resident IR. Only renderable and
  collidable output streams.

The cell index is computed in a worker from the IR. It is incremental on patches: only the entities touched by the
diff are re-bucketed.

**Content hash per cell** (the "one file per actor" granularity): `cellHash = hash(sorted [entityId, entityHash] of
its entities)`, where
`entityHash = hash(shapeKey (proceduralOutputKey | primitiveKey | asset id + version), material, transform, visible, castShadow)`.
The entity hash is what the editor, the DDC and the HLOD builder share.

**Streaming-source API** (render package, used by the studio and the player):

```ts
interface StreamingSource {
  id: string;                    // 'camera', 'player', 'capture:3', 'edit', 'npc:guard'
  position: Vec3;
  velocity?: Vec3;               // look-ahead: rings are centred at position + velocity * 1.5 s
  forward?: Vec3; fovY?: number; // frustum bonus
  kind: 'camera' | 'player' | 'capture' | 'edit' | 'logic';
  radiusScale?: number;          // e.g. 0.5 for an NPC source (physics only)
  needs?: { render?: boolean; physics?: boolean; picking?: boolean };
}
interface Streaming {
  setSource(s: StreamingSource): void;           // upsert, cheap, call every frame
  removeSource(id: string): void;
  /** Pin a region at full detail until released; resolves when it is drawn-ready (cells committed, programs linked). */
  require(region: Box3 | Sphere | Frustum, opts?: { detail?: 'full' | 'hlod'; reason: string; timeoutMs?: number }): Promise<Pin>;
  readonly state: { cells: { resident: number; pending: number; hlod: number }; bytes: number; budgets: Budgets };
  onCellChange(cb: (key: CellKey, state: 'loaded' | 'unloaded' | 'hlod') => void): () => void;
}
```

The studio registers the orbit or fly camera every frame, the play-mode player, review captures through `require`, and
the selection through `require` with `detail: 'full'`.

### 3.2 Load rings and priorities

Rings are measured in base cells (S = the cell size), from the nearest point of the cell to the look-ahead position.
They are tier-scaled: low ×0.75, ultra ×1.25.

| Ring | Distance | What is resident | Priority |
|---|---|---|---|
| R0 near | ≤ 1.5 S | full geometry, colliders, picking BVH, shadow casters, interactive objects | 0 (urgent: edits, selection, captures) |
| R1 mid | ≤ 4 S | full geometry (virtual or LOD chains as today), shadow casters in the cached sun map | 1 |
| R2 far | ≤ 10 S | level-1 HLOD proxy (2x2 cells) | 2 |
| R3 horizon | rest of the world | level-2 HLOD (4x4 cells), always resident, plus the persistent layer and backdrop | 3, loaded with the IR |

**Hysteresis.** A cell is promoted at the ring edge and demoted at the edge + 1 S. Full-detail geometry is evicted
when a cell has stayed below R1 for 5 s and the resident bytes are over budget. This is the voxel `vd+2` rule.

**Order.** Inside a ring, work is ordered by `distance / S − 0.5 × inFrustum − 0.25 × (dot(velocity, dir) > 0)`, on a
precomputed spiral as in `ChunkStreamer`.

**Budgets:**
- The worker queue is capacity-bounded, so there is never a backlog for places left behind.
- Resident full-detail bytes: 256 MB on integrated GPUs or low memory, 768 MB on discrete GPUs.
- Over budget, the farthest R1 cells drop to HLOD first.

**First picture.** It needs:
1. R0 and R1 of the opening view;
2. R3, which is tiny;
3. the pre-warmed program set of the tier (§3.7).

It does not wait for R2, for the four-heading sweep or for the light bake. R2 and everything else stream in behind,
under the frame budget.

### 3.3 HLOD proxies

**Format.** One proxy per cell at levels 1 and 2. Each proxy is a single GLB:
- Merged geometry. The opaque part is simplified to a target of about 2–4 % of the source triangles, at least 2 k
  and at most 30 k per level-1 cell, using QEM (`virtual/simplify.ts`) with border locking, so neighbours meet
  without cracks.
- Cutout foliage becomes octahedral impostor cards (8x8 views in a 1024² atlas per cell; trees are already scatter
  fields). Water and glass are excluded and fall to the persistent layer's water.
- Positions are quantized to int16 within the cell's bounds. Normals are octahedral-encoded in 2x int8. UVs are
  float16.
- Compressed with `EXT_meshopt_compression`. The material atlas is KTX2 (UASTC or ETC1S), already supported by the
  ktx2 worker, which handles `textures/compressed` at 512–1024 px per cell. The proxy carries a single material,
  "baked albedo, roughness and AO", so it draws with **one program and one draw per proxy**.
- A per-vertex 16-bit `entityIndex` attribute plus a table of entity ids in the proxy, so a click on a far proxy can
  select the entity it came from.

**Where and when:**
- At publish, in the cook (§3.5): the canonical proxy.
- In the studio, after an edit: a cell's proxy is marked stale when its `cellHash` changes. It is rebuilt in the merge
  worker (`merge.worker.ts`, extended) 2 s after the last edit to that cell. Until then the far field keeps the old
  proxy, which is acceptable for something 10 cells away.
- On a cold first open without a cooked proxy: built from the generated cell output after the cell has been
  generated once. Until a proxy exists, R2 falls back to full geometry with a reduced draw distance, which is today's
  behaviour.

### 3.4 DDC: the generated-geometry cache

**Key** (a SHA-256 hex of the string):

```
ddc/v1/<kind>/<sha256(
  kind                                   // 'gen' | 'post' | 'hlod' | 'lodchain' | 'dag' | 'collider'
  | generator id
  | generator code version               // built-ins: hash of packages/procgen/src at build time (vite define);
                                         // custom: generatorSourceHash(def) (source + param spec)
  | proceduralOutputKey(shape, world)    // already normalizes params and the seed
  | post-process version                 // metre UVs, normals, quantization
)>
```

For `hlod`, the key is `hash(cellHash, level, tier class (integrated|discrete), proxy builder version)`.

**Storage:**
- **Cache Storage** (`caches.open('aether-ddc-v1')`) holds the blobs, keyed by a synthetic URL
  `/__ddc/<key>`. It is available in workers, streams large bodies, and is evicted by the browser as a unit.
- **IndexedDB** (`aether-ddc-meta`) holds `{ key, bytes, lastUsed, kind, bounds }` for LRU.
- Default cap: 512 MB, or 25 % of `navigator.storage.estimate().quota`, whichever is smaller. Eviction is LRU.
- `navigator.storage.persist()` is requested only after an explicit save or publish.

**Value.** A versioned binary:
- `GeneratorOutput` parts after post-processing: metre UVs, quantized positions where lossless enough, indices
  narrowed to 16-bit where possible;
- colliders;
- bounds;
- triangle count.

**Read path.** Reads and writes happen in the generation worker. On a hit, the worker posts transferable buffers, so
the main thread never touches the bytes until the upload.

**Who benefits:**
- A returning visitor.
- An edit-undo.
- Every edit that leaves most entities unchanged: today a changed generator rebuilds all its users, while with
  per-entity keys only changed params miss.
- Physics colliders, which today are regenerated with `generateBuiltinSync`.

**Security.** The cache is same-origin and written only by our worker after validation. A corrupt entry fails
validation and is deleted.

### 3.5 Cook on publish

**When.** At publish (studio publish flow and `apps/server/src/publish/jobs.ts`), a cook step runs the same pure
generators headless in Node. Node runs every built-in and custom generator: the Lisbon cook measured 11.7 s on one
thread, under 4 s on 4. Custom generators cook in a `node:vm` context with the same lockdown and time limits as the
browser sandbox. The step writes:

```
cook/
  manifest.json          partition {cellSize, origin}, per cell: key, bounds, entity ids, cellHash, byte sizes, tri counts
  cells/L0_<ix>_<iz>.glb     full detail: meshopt + quantized, per-entity nodes (ids in extras), material refs by key
  cells/L0_<ix>_<iz>.col     colliders (compact binary, Rapier-ready)
  hlod/L1_<ix>_<iz>.glb      proxies (3.3), hlod/L2_...
  lightmaps/...              existing bake output
```

**Player load:**
1. Fetch the manifest.
2. Stream cells by ring.
3. Fall back to live generation per cell when a file is missing or its `cellHash` does not match the IR.

The IR stays the source of truth, so a remix or edit after publish keeps working.

**Size.** The raw generated output of Lisbon is about 266 MB, all of which is resident today. Quantization plus meshopt
typically gives 4–8x. This has to be measured in stage 5, with a target of 35–60 MB for the whole Lisbon cook, about
half of it in the far rings, which never load at full detail.

### 3.5.1 Cooked package format (first slice, implemented)

A published world is cooked: a viewer downloads, uploads and draws; it never generates. Templates are published worlds:
the player opens them cooked (`play.html#t=<slug>`), and the editor (Edit/Remix) opens the IR live as before. The publish
kinds (game, arch walkthrough, scene showcase, VR) are profiles on one cook. This slice cooks in the real renderer in a
headless browser rather than in Node, so what is cooked is exactly what the browser makes. Code:
`packages/render/src/cook/` (format, page side, lane side), `scripts/cook.ts`.

**Layout** (`cooked/<slug>/` at the repository root, git-ignored; copied into a dist's `cooked/` to be served):

```
cooked/<slug>/manifest.json               small, revalidated on every visit
cooked/<slug>/<id>/packs/<nnnn>.bin       geometry, immutable
cooked/<slug>/<id>/programs/<tier>.json   program set of a tier, immutable
```

`<id>` is 16 hex of SHA-256(IR hash, geometry code version). The IR hash is SHA-256 of the parsed world's canonical JSON
(sorted keys), without `opening` and `startMode`. The geometry code version is `DDC_CODE_VERSION`: `__AETHER_GEN_VERSION__`
(a build hash of procgen, arch, core and render's geometry code) plus the preparation version.

**Manifest** (`CookManifest`, `cook/format.ts`; validated in full by `parseCookManifest`):
- `format` (1), `irHash`, `genVersion`, `dir` (`<id>/`), `cookedAt`, `world` (id, name, entity count);
- `opening` (position, target, fov) and `startMode` (`play` | `walkthrough` | `orbit`, also an additive IR field next to
  `opening`), `profile` (`game` | `walkthrough` | `showcase` | `vr`);
- `partition`: the world's grid (`streaming/cell-grid.ts` `partitionFor`, from the top-level entities, as scene-sync);
- `cells`: per cell its key (`level:ix,iz`, or `p` for the persistent layer), XZ bounds of its entities, entry count,
  bytes and packs. Cells are ordered nearest the opening first;
- `packs`: file and byte size of each pack;
- `entries`: geometry-cache key (64 hex, the same SHA-256 the geometry cache uses) to `[pack, offset, length, cell]`;
- `programs`: per tier its file, bytes and program count;
- `lightmap`: an optional bundled lightmap folder (`lightmap-controller` `staticBase`), relative to the cook folder. Null
  until the publish bake exists.

**Geometry packs.** Each entry is a generator output in the geometry cache's own encoding (`geometry/ddc.ts`
`encodeOutput`: header JSON plus typed arrays, prepared render streams included), 8-byte aligned. Entries go to the cell of
the nearest entity that uses them; outputs no top-level entity places (spawn templates, scatter pieces) go to `p`. A pack
is cut at 4 MB (`PACK_TARGET_BYTES`); a larger entry gets a pack of its own.

**Program sets** (`CookedProgramSet`): `{ format, tier, boot, pairs, sources }`. `pairs` are `[vertex hash, fragment
hash]` in `gpu/program-cache.ts` `sourceHash` form, `sources` the exact GLSL three generated, as the program cache records
them in IndexedDB. The first `boot` pairs are those the load used before its first picture; the rest came from the orbit
and play.

**Cooking** (`scripts/cook.ts`): one headless session per tier on one browser profile, each opening
`play.html#t=<slug>&cook=record&tier=<tier>` with `__AETHER_COOK_RECORD` set. That switch makes the generation lanes keep
every output in the geometry cache, however cheap. Each session loads fully, saves the program set (the boot pairs), orbits
the opening for 6 s, starts play for games, and saves again. The last session reads the program sets from IndexedDB and
every geometry-cache entry from Cache Storage. The script then places, packs and writes the package, and reports raw,
gzip and brotli sizes. `--install=<dist>` copies it into a dist.

**Cooked load** (`player/PlayerApp.tsx`, `cook/cooked.ts`):
1. The player fetches the manifest beside the template and checks it: format, `genVersion` equal to this build's,
   `irHash` equal to the loaded world's. Anything missing, malformed or stale loads live, with the reason in
   `window.__aetherCook`.
2. The geometry index goes to the generation lanes (`GenPool.setCook`). A lane looks up the geometry cache, then the
   package: it fetches a pack once (16 MB of packs kept per lane), decodes the entry, answers, and seeds the geometry cache with it
   behind the reply. No generator, sandbox or validation runs. An entry that fails generates as before.
3. The program sets seed the program cache (`cookedProgramStore`). The boot pre-warm links the tier's cooked set, the
   boot pairs first, and keeps submitting them after the world's compile begins (`ProgramStore.boot`). Both are written
   through to IndexedDB, so the session's save, a later visit and the editor's Remix keep them.
4. The world starts in its `startMode` at its opening (the cook's opening fills in an IR without one). `play` shows the
   title card over the attract tour as before; `orbit` and `walkthrough` stay on the opening view. Their play-mode UI is
   later work.

**Measured** (6 November 2026, Intel UHD 770, headless Chrome, `GEN_GPU=intel`, shared machine;
`first-picture-probe --player [--live]`, cold then warm on one profile, live and cooked interleaved):

| | Cold first picture, live / cooked | Warm first picture, live / cooked | Generator runs, cooked |
|---|---|---|---|
| Kestrel Outpost, 4 pairs | 27.0/24.6, 26.7/24.3, 18.8/17.2, 21.4/20.3 s | 13.2/10.6, 15.4/12.8, 11.2/8.8, 9.9/10.1 s | 0 (live: 65 cold, 12-15 warm) |
| Lisbon Hills, 1 pair | 50.7/45.7 s | 28.3/36.0 s | 0 (live: 270 cold, 21 warm) |

- Kestrel: cooked is faster in all four cold pairs (1.1-2.4 s, 5-9 %) and in three of four warm pairs (2.4-2.6 s). Most
  of the gain is the boot set. Warm, 65 of 67 programs come from the pool, against 11-20 live, and the compile walk no
  longer links one program after another. The rest of a load is the driver: each link, then each program's first use on
  Mesa. A package cannot ship that work. The machine's load moved the absolute numbers by a third between rounds.
  Linking 12 at a time instead of 6 (`__AETHER_EAGER_IN_FLIGHT`) was no better.
- Lisbon: cold is 5 s sooner, with no generation (5-6 s live). Warm is slower: the lanes read 84 of the 270 entries from
  the packs again (520 MB through the HTTP cache), because seeding the geometry cache was skipped while writes were
  backed up. With 48 MB of packs per lane, the cold cooked load ran out of the 5 GB cap. At 16 MB it fits.
- Hero shots: the player at three fixed poses (`--shots --player`), cooked against live: mean 0.10-0.36 / 255, the same as
  live against live (0.05-0.37).
- The editor path (studio `#/new/kestrel-outpost`), this build against the one before: cold 19.3 / 18.9 s, warm
  15.6 / 15.9 s.

**Sizes** (`cook-report.json`):

| | Entries, cells, packs | Geometry | Program sets (low / medium / high / ultra programs) | Total raw | gzip | brotli | Largest file |
|---|---|---|---|---|---|---|---|
| Kestrel Outpost | 65, 13, 14 | 25.8 MB | 64 / 75 / 109 / 114, 22 MB | 46.9 MB, 19 files | 13.1 MB | 6.7 MB | 6.9 MB |
| Lisbon Hills | 270, 26, 87 | 520 MB | 64 / 95 / 128 / 117 | 555 MB, 92 files | 173 MB | 131 MB | 19.7 MB |

The low and high sets reach the set cap (`SET_CAP` 64 / 128), so some programs of those tiers are not cooked.

**Hosting.**
- Vercel static limits: deployments have per-file and total upload limits that depend on the plan (on the order of
  100 MB on Hobby). Check the current plan limits before relying on them.
- The `.bin` packs are served as `application/octet-stream`, which Vercel's edge does not compress. A viewer downloads them
  raw: Kestrel 26 MB of geometry, Lisbon 520 MB. Program sets are JSON and compress about 20 times.
- Kestrel fits in a deployment. Lisbon does not: as a git-built Vercel deployment it would also put half a gigabyte into
  the repository.
- Options:
  1. An object store with a CDN (Cloudflare R2, S3 with CloudFront, Vercel Blob), with the package base made
     configurable. Packs are immutable, so long cache lifetimes are free.
  2. Precompressed `.bin.br` siblings, served with `content-encoding: br` (the local server already serves `.br`
     siblings; `scripts/precompress.ts`).
  3. Stage 5's quantization plus meshopt, about 4-8 times smaller, before anything ships at Lisbon's size.
- Until then, packages stay out of git (`cooked/` is ignored) and are installed into a dist by hand.

Hooks left for later work: `cells`/`packs` per cell, for cell streaming and unloading; `lightmap`, for the publish bake;
`profile`, for the publish UI of kinds; `GameManifest.cook`, for a self-hosted game build that ships its package.

### 3.6 Worker generation plan

**Pool.**
- `GenPool`: N lanes, with `N = clamp(hardwareConcurrency / 2 − 1, 1, 4)` and fewer under low memory.
- Two kinds of lane:
  - **trusted** built-in lanes: the compute worker, made into a pool;
  - **sandbox** lanes for custom generators: the existing locked-down worker. Raise `poolSize` from 1 to N.
- Sandbox output goes to a trusted **post** lane, which runs validation (today on the main thread), metre UVs,
  quantization, bounds and the DDC write, and then transfers the result to the main thread.
- The streamer pattern applies: capacity-bounded, urgent edits first, version stamps, a per-job timeout, an inline
  fallback.

**What moves first, by measured cost:**

| Order | Work | Measured cost | Today |
|---|---|---|---|
| 1 | Custom generators: `lisbon-retaining`, `lisbon-row4`, `sanctuary-massif`, `marble-grand-stair` | 10.8 s Lisbon, 1.1 s Sanctuary | 1 sandbox worker, serial |
| 2 | Sandbox output validation, `metreUvMesh`, geometry key hashing | 1.9 + 1.55 + 1.65 s (Lisbon) | main thread |
| 3 | Heavy built-ins: `figure-statue` (930 ms per entity), `classical-temple`, `terrain`, `mountain`, `cliff-face` | 1.5 s, 0.28 s, 0.29 s, 0.14 s, 0.15–0.09 s | 1 compute worker |
| 3b | Virtual-geometry cluster DAG builds | 11.8 s in one `aether-dag` worker (Lisbon) | 1 worker, one build at a time. Pool it, and cache DAGs in the DDC (`kind: 'dag'`) |
| 4 | Scatter placements and `LodChainCache` QEM chains | in the 2.3 s of `mountOutput`/`scene-sync` on Lisbon | main thread |
| 5 | Texture down-scaling (`texture-cap.ts` `updateTexture`) | 2.3 s, one 1,688 ms call (Linden) | main thread; to `createImageBitmap({ resizeWidth })` in a worker, or KTX2 |

The biggest single entities, a `lisbon-retaining` part (1.2 s) and a `figure-statue` (0.93 s), set the lower bound
of a cold cell. That is acceptable in a worker, and the DDC or cook removes it for every later load.

### 3.7 Shader pre-warm set (PSO cache)

Programs are the largest single cost: §1.2 point 1, 25–60 s and 107–242 programs. The fix has three parts.

1. **A fixed program set per tier.** Program identity is `(shading class, geometry variant, pass)`:
   - shading class: the `shadeKey` classes up to the tier cap of 8/24/48/96, plus the plain lit, foliage cutout,
     water, glass, sky and post programs;
   - geometry variant: static, instanced, batched, skinned, virtual;
   - pass: scene, sun-shadow depth, pre-pass normals, motion chain.

   Material differences that are only constants (colours, scalars, texture *choice*) become uniforms or texture
   bindings, so they do not create programs. Structural differences keep their own program. This middle ground stays
   clear of the rejected uber-shader.

   A build step records the program keys three produces for every showcase world per tier and writes
   `prewarm/<tier>.json`: the material descriptors and geometry layouts needed to reproduce each program. A runtime
   check counts the programs created after the first picture that are not in the set (target: 0 on the showcase
   worlds). The set is the union over the showcase worlds; aim for ≤ 60 on medium and ≤ 120 on ultra.
2. **Pre-warm early, on the real context.**
   - The viewport's WebGL context is created when the app boots, while the gallery or landing is shown and before a
     world is picked.
   - The tier's set is compiled there with `KHR_parallel_shader_compile` (`parallel-programs.ts`), in idle time.
   - Chrome's GPU program disk cache then makes every later visit cheap, and the set is the same for every world, so
     it stays warm.
   - Because the set is fixed, the four-heading sweep (`prepareSurroundings`, 12–44 s) can be removed. Per-object
     preparation (render objects, bindings) stays in the time-sliced queue.
3. **No compile on the frame path.** A program that is not in the set is built in the background. Until it is linked,
   the object draws with its class's fallback, as the cap does today with plain materials, so no frame ever blocks on
   a link.

Today's single-link GPU-process tasks take 1.3–1.9 s on Mesa. These tasks stall every frame that waits on the GPU
process, so moving them before the world opens is worth more than any other single change.

### 3.8 Frame pacing and latency

**A `FrameBudget` scheduler** (new, owned by the renderer). Every piece of streaming or preparation work runs through
it:
- 2 ms per frame in motion, or while play mode is active and the player moves;
- 8 ms at rest;
- 40 ms behind the load screen, as today.

Work units must be small enough to fit:
- **Geometry uploads.** Allocate with `bufferData(size)`, then fill with `bufferSubData` in slices of 256 KB to 1 MB
  per frame. A cell's geometry is made visible only when complete. The largest single calls today are 438 ms and
  302 ms `bufferData`, and 675 ms `bufferSubData`.
- **Texture uploads.** Decode in a worker (`createImageBitmap`), downscale before upload, or use KTX2, which is
  already used for products. Upload one mip level per slice, or `texSubImage2D` in row bands. The largest call today
  is 1,688 ms.
- **Node-material builds.** These are 4–7 s of JS during load. With the fixed set (§3.7) they happen at boot, not
  during the world. Otherwise they go one material per slice, as `render-preparation` does now.
- **BVH builds** are already in a worker. Their warm-up reply application (0.5–0.7 s) has to be sliced.

**Per-frame submission cost** is the steady-state limit, at 30 fps on both GPUs:
- **Per-cell static batches.** Merge static opaque geometry per `(cell, program)` in the merge worker, as `static-merges`
  does per world today. Draws then scale with the visible cells times the programs per cell, not with entities.
  The target is ≤ 300 draws in the R0–R1 view; Lisbon draws 724–1,597 today.
- **Fewer per-object uniform writes.** 300–1,100 `bufferSubData` calls per frame today. Object matrices and
  per-object parameters go into one per-frame storage, or into a texture or UBO array indexed by draw. Static cells
  upload nothing per frame: only dirty objects write, the same principle as `matrix-dirty-check`.
- **HLOD for R2/R3**: one draw per proxy.

**Latency path.** From key to the moved camera is 45–62 ms on Intel today:
- Sample input at the start of the animation frame and apply the camera's look-ahead (kinematic prediction) in the
  same frame, instead of waiting for the next fixed physics step. Physics corrects on the following step.
- Present with `desynchronized: true` in the play-mode canvas context, where supported.
- Keep the frame at ≤ 16.7 ms on the target tier, which the work above is for, so the path is at most one frame plus
  one present.
- Never run streaming commits in the same frame as a play-mode input change beyond the 2 ms budget.

Target: key to the moved frame ≤ 25 ms median, and ≤ 33 ms to displayed, on integrated GPUs at the default tier.

### 3.9 Editing, selection, physics and AI review with a partially loaded world

**Editing.**
- The IR is always whole, so the outliner, inspector, patches, history and diff work as today.
- After a patch, `diffWorlds` gives the changed ids, the cell index maps them to cells, and only the entities in
  resident cells rebuild, through today's `updateNode`.
- An entity in a non-resident cell updates its entry in the cell index and its `entityHash`. Its cell's HLOD is marked
  stale, and the edit shows when the cell loads.
- An entity that moves between cells is reassigned, and both cells are rehashed.
- Applying an edit pins the cells of the edited entities with `require(..., { detail: 'full', reason: 'edit' })` for
  10 s, so the edit is visible at once even far away. This is the voxel urgent-remesh rule.

**Selection.**
- Clicking a resident cell works as today.
- Clicking an HLOD proxy uses its `entityIndex` to select the entity, then pins the entity's cell and frames it.
- Selecting from the outliner pins the cell.
- Marquee selection works on the cell index (bounds), not on loaded geometry.

**Physics (play mode):**
- Rapier colliders are created per cell for the R0 and R1 rings of the player source only, and removed past R1 + 1 S.
  Colliders come from the DDC or cook (`.col`).
- Static terrain under far NPCs uses a coarse level-2 heightfield, which is always resident.
- NPCs outside the physics rings switch to kinematic simulation on that heightfield (simulation LOD).
- Logic stays whole: rules, scripts and triggers read the IR or state, not meshes.
- Trigger volumes are data and always active.
- The verification worker (`verify`) keeps its own full-world build, off the frame.

**AI review shots and captures** (`capturePoses`, hero shots, stills, export):
- For each pose, `require(frustumOf(pose, maxDistance), { detail: 'full', reason: 'capture' })`, wait, draw, release.
  Captures are already off-screen and already wait for preparation.
- Far content in a capture draws as HLOD, as a visitor would see it. Captures that need the whole world at full
  detail (GLB export, light bakes, plan views) call `require(worldBounds)`. These are rare, explicit and allowed to be
  slow.
- `AgentHost.captureReview` reports `partial: true` if a pin timed out, so the agent never judges a half-loaded
  picture without knowing.

**Light bakes.** The lightmap and light volume are keyed by content hash and cached in IndexedDB already. They become
per-cell, keyed by `cellHash`, with neighbours' casters within 1 S included.

### 3.10 Quality upgrades the budget pays for

The savings come from the far field (HLOD), program stalls and per-object uniforms. Spent in this order:

1. **Full resolution on integrated GPUs.** Today adaptive resolution sits at 0.5 on Intel during motion. The aim is
   at least 0.75 at 60 fps on medium. This is the biggest visible gain.
2. **A higher program cap**: hero material variety for every world. With a fixed pre-warmed set, variety costs boot
   time once, not load stalls per world.
3. **Sharper near shadows.** Spend the cascades on R0–R1 only. The far field uses baked HLOD lighting and AO.
4. **Denser near detail.** Grass and ground scatter in R0 only. Ground cover can triple inside 1.5 S at the cost of
   what HLOD saves beyond 4 S.
5. **Larger worlds at constant memory.** 2 km and more, with cell budgets instead of resident everything.
6. **TAA and AO on medium at rest**, using the idle frame budget that streaming leaves when nothing moves.

---

## 4. Staged plan

Each stage ships on its own and keeps the IR and publish format backward compatible. The metrics are measured with
the probe harness, `scripts/arch-probe.ts`. Reference hardware: Intel UHD (integrated) and RTX (discrete),
Chrome, four showcase worlds.

| Stage | What ships | Acceptance metrics |
|---|---|---|
| **1. Frame budget and long-task removal** | `FrameBudget` (2/8/40 ms); sliced `bufferData`/`bufferSubData`; texture downscale in a worker; sandbox validation, `metreUvMesh` and geometry key hashing moved to a trusted post worker; sliced BVH apply; probe script and CI perf job | No main-thread task > 50 ms after the first picture on all four worlds, both GPUs. Load main-thread long tasks: sum −50 %. No single GL call > 16 ms. Orbit max frame < 150 ms. |
| **2. Fixed shader set and early first picture** | Per-tier program manifest; constants to uniforms for the shading classes; pre-warm at boot (gallery or landing); sweep removed; load gate = opening-view rings + set linked; `lateWarm` replaced by fallbacks | Programs after the first picture not in the set: 0 on the showcase worlds. First picture on Intel: Kestrel < 3 s with a warm program cache (15.3 s fully loaded today), < 8 s cold (31–34 s today). Lisbon: program wait after `sync-done` ≤ 1 s warm (6.2 s today); its generation is stage 3. GPU-process tasks > 50 ms after the first picture: 0. |
| **3. Worker pool and DDC** | `GenPool` (N lanes, sandbox ×N, post lane); DDC in Cache Storage plus IndexedDB LRU; `entityHash`; colliders from the DDC; scatter and LOD chains in workers | Lisbon `sync-done` 15–16 s → ≤ 5 s cold on 4 cores, ≤ 1.5 s on a second visit (DDC hit). Lisbon first picture < 6 s on Intel on a second visit. Edit of one Lisbon row house: ≤ 100 ms to visible. Main-thread generation work: 0. |
| **4. World Partition: cells, sources, rings** | Cell index, `world.partition`, the streaming-source API, `StreamingPlanner` (voxel pattern), per-cell static batches, evict and reload; partial-world rules for editing, selection, physics and captures (3.9) | Flat memory: on a 2 km fly-through (Lisbon tiled 3x3 as a test world) the JS heap and GPU estimate stay within +10 % of the value after the first 200 m. p99 frame ≤ 25 ms on the RTX, ≤ 33 ms on Intel medium during the fly-through. Draws in view ≤ 300. Captures and review shots identical to today's within an image-diff threshold for poses inside R1. |
| **5. HLOD and cook on publish** | Proxy builder (merge worker plus QEM plus impostors plus atlas bake), level-1 and level-2 proxies, `entityIndex` picking; Node cook into `cook/` (meshopt, KTX2, `.col`), player streams cooked cells with generation fallback | Published Lisbon: download ≤ 60 MB, first picture < 3 s on Intel (warm program cache), fully streamed R0–R2 < 8 s. Intel orbit p50 ≤ 16.7 ms at a resolution scale ≥ 0.75. Far-field image diff vs full detail under the threshold at ≥ 10 S. |
| **6. Spend the budget on quality** | The items of 3.10 in order, each behind the frame-time governor; latency work (same-frame input sampling, look-ahead, `desynchronized`) | Key to moved frame ≤ 25 ms median on Intel. p99 ≤ 25 ms at the new defaults. Image quality: hero-shot review scores no lower than before, and higher on the far views. |

**Stages 1 and 2 need no format changes and give most of the load win on small and medium worlds.** The measured
load there is 60–90 % programs plus the sweep, and a warm program cache alone halves Kestrel's load. Lisbon-size
worlds also need stage 3, because their generation (15 s) comes before any frame. Stages 1–3 do not depend on each
other and can run in parallel. Stage 4 needs stage 3's worker pool and hashes, and stage 5 needs stage 4.

---

## 5. Risks

- **three.js internals.** Program identity, render-object preparation and node builds are three r186 internals. A
  three update can change the program keys of the fixed set. Mitigation: the manifest is regenerated in CI, and the
  runtime "program not in the set" counter fails the perf job.
- **Fewer programs, more GPU time.** Turning constants into uniforms can cost GPU time on Intel, the reason the
  uber-shader was rejected. Do it per class and measure each merge on Intel.
- **Seams at cell borders:**
  - merged batches, lightmaps and shadows across borders;
  - HLOD cracks;
  - scatter double-placement.

  Mitigation: border-locked simplification, scatter bucketed by instance position (not re-placed), and lighting baked
  with 1 S of neighbours.
- **Deterministic generators.** Custom generators must be pure for the DDC and the cook. The sandbox gives a seeded
  API, but its lockdown still allows `Math.random` and `Date` (`sandbox/lockdown.ts` `ALLOWED_GLOBALS`). A generator
  that uses them is cached as if it were pure: cached and cooked output would differ from a fresh run, without
  error. Mitigations, in order:
  1. Replace `Math.random` in the sandbox with the seeded RNG, and freeze `Date.now`.
  2. Add a cook-time double-run check that flags a generator whose output is not deterministic and keeps it out of
     the DDC.

  Note too that the sandbox (rightly) blocks `caches` and `indexedDB`, so the DDC can only live in the trusted post
  lane, as planned.
- **Cache invalidation.** A built-in generator changed without a version bump would serve stale geometry. The version
  is a build hash of `packages/procgen/src`, which is coarse but safe. Post-processing has its own version.
- **Storage quota and eviction.** Safari evicts after 7 days without interaction, and private modes have a small
  quota. The DDC is an accelerator only: every path must work cold.
- **Everything that assumes a whole world:**
  - the bounds and `contentSphere`, used by the opening view, framing and fog;
  - the sun-shadow fit;
  - light-volume bakes;
  - `heroShots`;
  - the export;
  - the agent's weight check.

  Each needs a "world bounds from the cell index" path rather than from loaded meshes. Audit these in stage 4.
- **Agent review consistency.** A capture that waits on pins can be slow on a cold machine. The `partial` flag and a
  timeout keep the agent loop moving, but review quality can dip if captures time out often.
- **Physics at ring borders.** A thrown object leaving R1, or an NPC walking into an unloaded cell, needs the
  kinematic fallback and the coarse heightfield. Scripts that raycast far away need a "query on the IR or coarse
  data" API.
- **Memory during the transition.** Until stage 4, the stage 1–3 changes keep everything resident. The DDC adds a copy
  in Cache Storage (disk, not RAM). Watch the cgroup peak in every stage.
- **Concurrent work.** `world-renderer.ts` and the camera are being changed by other work (the opening view). The
  streaming planner and `FrameBudget` should live in new modules under `packages/render/src/streaming/`, with narrow
  hooks into `world-renderer.ts`, to limit conflicts.
- **Measurement noise.** These baselines were taken on a shared machine. Re-measure stage 0 on the reference laptop
  (UHD plus RTX 3050) before using the acceptance numbers as gates.

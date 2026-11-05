# Performance of big worlds

How the renderer keeps the heaviest worlds (Linden Row, Lisbon Hills, Kestrel Outpost, the cliff sanctuaries) smooth on a
laptop, what was measured, and how to measure it again. Work of 3–5 November 2026, commits `de10901e` to `9a025421`.

## Targets

On the reference laptop (Intel UHD (Raptor Lake-P) plus an RTX 3050 6 GB Laptop GPU, Linux, 14 GB RAM, Chrome or Brave):

| Target | Result |
|---|---|
| RTX 3050 at ultra: about 60 fps | met (WebGPU and WebGL2) |
| Intel UHD at medium: about 60 fps | met |
| Intel UHD at ultra: at least 30 fps on the heaviest worlds | met (60 fps median on most) |
| No hangs, no exploring before the world is fully loaded | met |
| Never overload the machine's memory | met: heavy worlds peak at 2.7–4.6 GB in Chrome |

New worlds get all of this from the renderer; the agent also keeps them light (see [Keeping new worlds light](#keeping-new-worlds-light)).

## Results (final build)

Measured after the load screen, a 25–30 s orbit, 5 s windows, median frame interval. Peak memory is the test's cgroup
(Chrome plus about 0.3 GB of test server).

| World | GPU, tier | Load | Peak | Frames |
|---|---|---|---|---|
| Kestrel Outpost | Intel ultra | 23 s | 2.7 GB | 16.7 ms everywhere |
| Sanctuary Falls | Intel ultra | 66 s | 3.6 GB | 16.7 ms, worst 67 ms |
| Sanctuary Terraces | Intel ultra | 68 s (was 124) | 3.5 GB (was 4.5) | 16.7 ms, worst 100 ms |
| Sanctuary Ascent | Intel ultra | 79 s | 3.9 GB | 16.7 ms after the first window |
| Linden Row | Intel ultra | 64 s | 4.05 GB (was 4.8) | 16.7 ms every window, worst 67 ms |
| Linden Row | Intel medium | 64 s | 3.7 GB | 16.7 ms |
| Cliff Sanctuary | Intel ultra | 94 s (was 153) | 4.5 GB (was 5.3) | 16.7–33 ms, worst 83 ms |
| Lisbon Hills | Intel ultra | 54 s | 4.6 GB | 16.7–33 ms, worst 83 ms |
| Linden Row | RTX ultra, WebGL2 | 59 s | 3.1 GB | 16.7 ms |
| Lisbon Hills | RTX ultra, WebGL2 | 92 s (was 143) | 3.8 GB | 16.7 ms after the first seconds |
| Linden Row | RTX ultra, WebGPU | 47 s (was 95, out of memory) | 3.9 GB | 16.7 ms median and p90 |

Before this work: Linden Row on Intel medium had a 9.7 s freeze on the first move and 101 ms frames; Lisbon Hills took
55–180 ms a frame; the cliff sanctuaries froze 4–13 s on the first turn of the camera.

## What changed

### Load: nothing to explore until it is ready

- **Load gate.** `Simulation.whenFullyLoaded` keeps the load screen until the renderer has nothing pending
  (`processingStage` null for 600 ms): scene sync, materials, programs, the preparation queue, batch merges and the light
  bake. Cap 150 s (`FULL_LOAD_WAIT_MS`); a timeout is marked `aether:load-timeout`.
- **Light bake first.** The building light bake changes every lit material to its volume-lit form when it lands; the
  load waits for it before the sweep so each object is prepared once.
- **Hidden sweep** (`WorldRenderer.prepareSurroundings`, WebGL). The camera turns through four headings behind the load
  screen: every heading's compile is queued at once (the driver links them side by side), then each heading is drawn
  (shadow variants, distance-culled meshes). A split chain (see below) also builds and draws its motion phase, so the first
  turn of the camera links nothing. Far interiors and specks come back for the compile one mesh per program only.
  Memory-aware: worlds holding a large share of the heap sweep fewer headings or none.
- **Opaque load screen, held until smooth.** The canvas behind the load screen is busy (hidden headings, long preparation
  slices), so the screen is opaque; after the gate it stays up until four frames in a row come at the running rate
  (at most 4 s), then fades out in 320 ms (`Viewport.tsx`, `.vp-loading.is-leaving`).
- **Long preparation slices while loading** (`WorldRenderer.setLoading`, 40 ms instead of 4 ms).

### Each mesh prepared once

three.js keys every mesh's render objects and node builds by its render context, and a render context by the target's
format, sample count, MRT node and **call depth**. Several engine paths created extra contexts, so heavy worlds built every
mesh two to four times (a minute of a load and up to 2 GB of page heap):

- **Scene passes render first** (`gpu/post.ts`, `render()`): the pre-pass and the scene pass are updated from the top
  before the effect chain, at a fixed depth, instead of at whatever depth the first effect that read them reached (1 in
  motion, 2–5 at rest).
- **Motion phase single-sampled** on split chains, like the rest phase, so both share render state.
- **Occlusion on the composite** for split chains (`screenOcclusion`): AO and contact shadows multiply the picture instead
  of entering every lit material, so rest and motion share programs (306 → 234 programs on Sanctuary Terraces).
- **Pre-pass normals stay half-float**: the 8-bit target came back to half float after its first frames, doubling the
  pre-pass objects.
- **Compile walks target the scene pass** (`compileInScenePass`): the objects they prepare are the ones drawn, not a set
  for the bare canvas.

### Memory

- **Linked shaders freed** (`gpu/shader-release.ts`): three kept every compiled shader object attached forever; on Mesa
  that is about 10 MB a program. Shaders are detached after link and deleted after 4 s unused; compiled again on reuse
  (rare). GPU process 1.9 → 1.0 GB on Sanctuary Terraces. Opt out: `globalThis.__AETHER_SHADER_RELEASE = false`.
- **Texture cap** (`gpu/texture-cap.ts`): image textures at most 512 px on integrated GPUs and in low-memory mode
  (Lisbon Hills: textures 726 → 363 MB).
- **Heap pressure** (`apps/studio/src/lib/memory.ts`) uses the share of the heap limit, not a fixed 600 MB that latched
  low-memory mode on a 16 GB machine.

### Frame rate

- **Integrated GPUs:** shadow tier capped at medium (one cached sun map), split chain (light motion phase without the
  pre-pass, full chain at rest), LOD heights halved, far room contents hidden past 40 m, small-mesh culling, adaptive
  resolution "smooth" by default (floor 0.25 in motion).
- **Sun map** redrawn only when casters change: water, transforms, the avatar and orbiting no longer dirty it; soft
  refresh thinned by caster count.
- **Heavy worlds on discrete GPUs:** one cached sun map, lean motion chain, interiors past 60 m hidden.
- **Matrix walk once a frame**, and only for objects whose position, rotation or scale changed (`gpu/matrix-dirty-check.ts`).
- **Merged interiors:** room contents merge per material like walls and floors, and far ones are culled as a whole.
- **WebGPU:** pipeline jobs that never settle and compile holds are released after a bound; the software adapter is
  refused when WebGL2 has a hardware GPU.

## Keeping new worlds light

Everything above is in the renderer, so it applies to every world. What only a world can avoid is checked by the agent:

- **Guidelines** (`packages/agent/src/prompt.ts`): 16+ identical pieces are one scatter; a reused palette of finishes;
  shadows on at most 2 lamps; about 48 lamps at most.
- **Weight check in every review round** (`packages/agent/src/weight.ts`, `withWeight`): `repeat_pieces` (identical
  pieces with the same turn and size placed one by one), `material_variety` (more than 90 shader-distinct finishes),
  `shadow_lamps` (more than 2), `many_lamps` (more than 48), `heavy_scatter` (more than 1.5 M instances). Each finding
  carries the fix.

## What was investigated and not done

| Idea | Why not |
|---|---|
| Block-compressed textures (BC1/BC4) | Lossy; quality had to stay. |
| One uber-shader for all materials | Programs differ in structure (65 fragment shaders, 63 ignoring constants); merging them costs GPU time on Intel, where heavy views are GPU-bound. |
| Compact vertex formats | All CPU geometry is about 115 MB on Linden Row: 2% of the peak. |
| Freeing texture CPU copies | About 150–200 MB on the heaviest worlds, but tile variants, splat arrays, character recolouring and the exporter read them; needs regeneration fallbacks. |
| Freeing picking geometry | About 5% on the two heaviest worlds; touches selection, export, merging and light bakes. |
| Sharing GPU textures between clones | Measured: no duplicate uploads. |

Where the memory of a heavy world goes (Linden Row, Intel medium, about 3.2 GB): GPU process about 0.8–1.0 GB (compiled
programs), GPU memory in shared RAM about 1.1 GB (textures 460 MB, targets 72 MB, buffers 68 MB, driver overhead), page
about 1.2 GB (JS heap 0.5 GB, texture sources 226 MB, geometry 115 MB, workers).

## Measuring

- **Which GPU.** Brave and Chrome on this laptop use WebGL2 on the Intel GPU by default. `GEN_GPU=intel` (WebGL2 on
  Intel, headless), `GEN_GPU=nvidia` (WebGL2 on the RTX through PRIME offload, headless), `GEN_GPU=nvidia-webgpu`
  (WebGPU on the RTX; headed windows only). See `tests/e2e/support/env.ts`.
- **Frame cost:** `GEN_GPU=intel npx tsx tests/e2e/default-perf.e2e.ts --worlds=linden-row --rows=medium-adaptive,ultra-adaptive`.
- **Memory-safe runs.** Every browser run goes in a capped scope that is stopped afterwards (an out-of-memory kill left
  the test servers running once, 33 of them, 5.7 GB):

  ```sh
  systemd-run --user --scope -u aether-run-NAME -p MemoryMax=5000M -p MemorySwapMax=0 npx tsx tests/e2e/...
  systemctl --user stop aether-run-NAME.scope; systemctl --user reset-failed
  ```

  Start one only with at least the cap plus 1 GB of RAM available, one world at a time, and keep the browser profile off
  `/tmp` when it is RAM-backed (`TMPDIR=~/.cache/aether-e2e-tmp`).
- **Load marks** (`performance.getEntriesByType('mark')`): `aether:compile-start/end`, `aether:sweep-start/end`,
  `aether:bake-wait`, `aether:wait-<stage>`, `aether:fully-loaded`, `aether:load-timeout`.
- **Switches** (set on `globalThis` before the studio starts): `__AETHER_SWEEP`, `__AETHER_SWEEP_MOTION`,
  `__AETHER_SHADER_RELEASE`, `__AETHER_PASS_FIRST`, `__AETHER_COMPILE_TARGET`, `__AETHER_FULL_WARMUP` (opt-in),
  `__AETHER_MATRIX_CHECK`.

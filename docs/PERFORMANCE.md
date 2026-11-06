# Performance of big worlds

How the renderer keeps the heaviest worlds (Linden Row, Lisbon Hills, Kestrel Outpost, the cliff sanctuaries) smooth on a
laptop, what was measured, and how to measure it again. Work of 3–5 November 2026, commits `de10901e` onwards.

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
  Memory-aware: worlds holding a large share of the heap sweep fewer headings or none. **Off by default since
  6 November 2026** (see [Pre-warmed program set](#pre-warmed-program-set-6-november-2026)); `__AETHER_SWEEP = true`
  turns it back on.
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
  (Lisbon Hills: textures 726 → 363 MB). KTX2 textures are left alone (they cannot be redrawn), so streamed Amazon Berkeley Objects products load their
  first level within the cap instead (`lods/…_lod2`, 512 px), and the weight check counts their downloads (ASSETS.md).
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

### Changing quality tier

three r186 never deletes the WebGL program of a pipeline it releases: it only drops it from its cache, and the program
lives on until the browser happens to collect its wrapper. After a tier change every lit material builds a new program,
so the old tier's set stayed beside the new one and memory nearly doubled. `gpu/pipeline-release.ts` deletes a released
pipeline's program once its link has finished (opt out: `__AETHER_PIPELINE_RELEASE = false`).

| Switch medium → ultra | Peak during the switch | After |
|---|---|---|
| Linden Row, without | 3.97 GB | 3.54 GB |
| Linden Row, with | 3.51 GB (37 programs deleted) | 3.38 GB |
| Lisbon Hills, with | 4.57 GB, inside a 5 GB cap (26 deleted) | 4.06 GB |

A tier change is one transition (`view/quality-transition.ts`, `WorldRenderer.qualityTransition`): the view keeps its last
complete picture while the new tier's programs link (a re-warm asked for during another runs after it), the studio shows
"Applying <tier> quality…", and the automatic lightmap bake, which runs above the low tier only, gets another look when the tier
rises (before, a world opened on low kept "no baked light for this building yet" after a switch to ultra). The transition ends
once nothing has rebuilt for 0.4 s, and never later than 75 s. Probe: `scripts/tier-switch-probe.ts` (low to ultra, ultra to low,
auto to ultra, rapid toggles).

The automatic tier says why it is what it is (`WorldRenderer.autoTierReason`, shown in Settings next to the GPU line): "Firefox
cautious start", "stepped down: 18 fps", "integrated GPU", "4-core CPU". Firefox on a recognised discrete GPU starts at ladder
level 3 (medium) instead of 4 (low) and climbs with shorter waits (4 s of headroom, 6 s settle) until something measured is given
up; integrated GPUs keep level 4 and the usual climb. The climb also counts a median frame at 55 fps with a p90 above 28 fps as
fast: one missed vsync in ten holds the p90 at exactly 30 fps on a 60 Hz display. Probe: `scripts/tier-climb-probe.ts --firefox`
(medium to high in 26 s of motion on an NVIDIA GPU).

A separate bounded investigation that day (capture-target budget, particle buffer usage, an instance-upload cache, still
path-trace presentation) is in [RENDER_OPTIMIZATION_REPORT.md](RENDER_OPTIMIZATION_REPORT.md): its Lisbon Hills run ran out
of a 4.6 GB cap during the medium-to-ultra switch the fix above addresses.

## Re-benchmark, 5 November 2026 (final build)

With every change above, including the capture-target budget and static particle buffers:

| World | GPU, tier | Load | Peak | Frames |
|---|---|---|---|---|
| Linden Row | Intel ultra | 61 s | 4.04 GB | 16.7 ms median every window |
| Linden Row | Intel medium | 62 s | 3.67 GB | 16.7 ms |
| Lisbon Hills | Intel ultra | 52 s | 4.72 GB | 16.7 ms after the first window |
| Cliff Sanctuary | Intel ultra | 64 s | 4.10 GB | 16.7 ms |
| Kestrel Outpost | Intel ultra | — | 2.48 GB | 16.7 ms everywhere |
| Linden Row | RTX ultra, WebGL2 | 48 s | 2.57 GB | 16.7 ms |

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
- **Switches** (set on `globalThis` before the studio starts): `__AETHER_SWEEP` (opt-in), `__AETHER_PROGRAM_CACHE`, `__AETHER_SWEEP_MOTION`,
  `__AETHER_SHADER_RELEASE`, `__AETHER_PIPELINE_RELEASE`, `__AETHER_PASS_FIRST`, `__AETHER_COMPILE_TARGET`, `__AETHER_FULL_WARMUP` (opt-in),
  `__AETHER_MATRIX_CHECK`, `__AETHER_CELL_SHADOWS`, `__AETHER_CELL_VIRTUAL`, `__AETHER_SORT_BY_MATERIAL` (all on by default), `__AETHER_MERGE_VIRTUAL_PARTS` (opt-in).

## Pre-warmed program set (6 November 2026)

Part of stage 2 of [ARCHITECTURE-STREAMING.md](ARCHITECTURE-STREAMING.md): the equivalent of a pipeline-state cache.

- **The tier's program set** (`gpu/program-cache.ts`). Every pipeline three creates is recorded by its exact vertex and
  fragment sources under the realtime tier in effect, and the set is kept in IndexedDB (`aether-programs`: sources by hash,
  one set per tier, at most 64/96/128/160 programs, most recently used first, an entry unused for 12 sessions dropped). When
  the renderer starts, the tier's set is compiled and linked with `KHR_parallel_shader_compile`, six at a time, while the
  world is generated. A pipeline whose two sources are pooled takes the pooled program (linked or still linking) instead of
  linking its own, and its stages are never compiled by three (`installLazyStages`). The boot pre-warm stops submitting when
  the world's own compile starts; unused pooled programs are deleted 20 s after the first picture. A world that settles on
  another tier (a heavy world starts lower) pre-warms that tier's set instead. Opt out: `__AETHER_PROGRAM_CACHE = false`.
- **Neighbouring tiers in idle time.** After the first picture, while the view has been still for 2 s and nothing links or
  prepares, the rest of the set and the sets of the tiers above and below are linked one at a time and deleted at once: the
  browser's program cache then holds them for a tier change or the next visit.
- **No hidden sweep.** `prepareSurroundings` is opt-in. Programs met later link off the frame (the view keeps its last
  complete picture meanwhile) and objects prepare in time slices.
- **The opening view and the programs side by side.** The world's compile starts as soon as generation is done and links on
  the driver's threads while the opening view is chosen; late warm-up rounds no longer hold the draws.
- **Diagnostics:** `WorldRenderer.prewarmStats` (set size, pre-warm links, programs taken from the pool, own links, own links
  after the first picture that the set did not hold, trimmed, primed).

Kestrel Outpost, Intel UHD 770, medium (automatic), Chrome, two runs each on a shared machine, before = `6de94eef`
(`scripts/first-picture-probe.ts`; the first picture is the load screen starting to leave):

| | First picture cold | First picture warm | Programs | Link latency warm: sum, longest | `useProgram` / draws per orbit frame | GPU-process tasks > 50 ms after the first picture, cold |
|---|---|---|---|---|---|---|
| Before | 21.7 / 17.8 s | 11.6 / 9.2 s | 124-128 | 22.6-24.0 s, 3.1-3.7 s | 55-57 / 132-142 | 7-9 |
| After | 21.0 / 18.2 s | 9.5 / 8.7 s | 110-126 | 5.9-11.9 s, 0.2-1.6 s (21-22 taken from the pool) | 51-57 / 117-136 | 19-30 |

Links get cheaper and shorter (the pool takes a quarter of them; the longest wait for one drops from 3-4 s to under 2 s),
the first picture comes 0.5-2 s sooner warm and about the same cold. Cold, part of what the sweep did behind the load screen
now happens after it: more GPU-process tasks over 50 ms after the first picture (most of them short). The gate of the plan
(first picture under 3 s warm and under 8 s cold) is not met. What the first picture still waits for on Kestrel (warm):
generation (1.35 s), the compile walk (1.2 s), render-object preparation (1.4-1.9 s of JavaScript), the first real draws
(two GPU-process tasks of about 1.3 s each in `GLContextEGL::MakeCurrent`: the driver's first use of the new programs and
targets), seven programs of the split chain's rest phase that link only once the view rests (1.4 s warm, 3.2 s cold), and
the frames that must come at the running rate before the load screen lifts (1.5-2 s). Cold, the links themselves dominate
(about 89 of them, GPU-process bound), and the fly-in plays out behind the load screen once the first frame is drawn
(3.3 s). Collapsing permutations was measured first: of the 66 pipelines alive after Kestrel's load, 64 stay distinct when
constants and node names are ignored, so turning constants into uniforms would remove two programs; and 23 of the 88-94 links
of a load are of programs no longer in use at its end (materials rebuilt during the load), the next thing to remove. Hero
shots are unchanged within run-to-run noise (`scripts/image-diff.py`, mean 2.0-7.6 / 255 against 1.5-9.3 for the old build
against itself, from wind and particles).

```sh
STATIC_DIR=/tmp/s2-dist GEN_GPU=intel npx tsx scripts/first-picture-probe.ts --out=<dir> [--runs=cold,warm] [--shots] [--profile] kestrel-outpost
```

## Picture stability and sharpness (5 November 2026)

The low-end work above stays as it is; these changes are about how the picture holds still, settles and stays sharp.

- **Specular antialiasing** (`gpu/specular-aa.ts`): three widens roughness by the change of the geometry normal only. Normal-mapped
  stone, roofs and water seen from far away now also widen it by the shaded normal's screen-space variance (Kaplanyan and
  Hoffman, Filament's constants), so a far highlight is a steady sheen instead of glitter. Same programs, every tier. Opt out:
  `globalThis.__AETHER_SPECULAR_AA = false`.
- **Far foliage coverage** (`materials/foliage-shading.ts`): the cut-out alpha is raised a quarter per mip level read, so far trees
  keep their leaves instead of thinning into flickering specks.
- **Temporal AA sharpen** (`gpu/post.ts`, `TAA_SHARPEN`): a contrast-limited sharpen of the resolved image.
- **Settling after a stop** (`WorldRenderer.syncRest`, `REST_REVEAL_FRAMES`): a split chain's full chain starts from an empty
  temporal history; the last motion picture stays on screen until five rest frames have gone into the history (the existing
  presentation hold), so the view changes once into a nearly settled picture instead of crawling for a second.
- **Consistent sharpness**: on a discrete GPU adaptive resolution keeps the full picture down to 40 fps and never goes under 0.8
  (`DISCRETE_SMOOTH`); the motion floor of a split chain is 0.6 there, and 0.5 for a chosen ultra tier on other GPUs (auto and
  the cheaper tiers keep 0.25).
- **Ultra on discrete GPUs** (`WorldRenderer.supersample`): the realtime ultra tier draws at up to 1.5 times the display's pixel
  ratio (5 MP at most). It starts at the display's own resolution and adaptive resolution climbs into the extra pixels only while
  frames hold; its floor is the display's resolution. Not on heavy worlds' split chains or in low-memory mode. Opt out:
  `__AETHER_SUPERSAMPLE = false`.
- **Drone views** (`environment/mountain-range.ts` `altitudeShare`): the backdrop ranges are pictures painted for an eye near the
  ground. As the eye climbs past a third of the content's radius they melt into the air (all air above about the radius; the
  land ring and its trees stay). This removed the slate band of the far range's foot over Sanctuary Terraces.

Measured with `scripts/quality-probe.ts` (live frames: still flicker, a slow 0.1° orbit, a settle curve, a 30 s session log of
tier, pixel ratio and scale):

```sh
STATIC_DIR=/tmp/q-dist GEN_GPU=intel npx tsx scripts/quality-probe.ts --out=<dir> --tier=ultra [--only=far-aerial,drone] <world>
STATIC_DIR=/tmp/q-dist GEN_GPU=intel npx tsx scripts/quality-probe.ts --out=<dir> --tier=ultra --session <world>
```

## Worker generation and the geometry cache (6 November 2026)

Stage 3 of [ARCHITECTURE-STREAMING.md](ARCHITECTURE-STREAMING.md): no generator, validation or vertex-stream work on the main thread, and a second
visit that does not generate at all.

- **Sandbox pool** (`procgen/sandbox/worker-sandbox.ts`, `generationLanes()`): one locked-down worker per hardware thread but one, at most 4
  at 8 GB or less of `deviceMemory` and 2 at 4 GB or less (see the next section); `__AETHER_GEN_WORKERS` overrides it. A burst of runs is queued in one task and sent nearest first (the scene
  passes each entity's distance to the opening view, the player's start, or the camera after an edit). Compiled bodies are reused across runs.
  During a world build a run gets 15 s instead of the interactive 3 s, since runs share the CPU.
- **Generation lanes** (`render/geometry/gen-pool.ts`, `gen.worker.ts`, half as many, at most 4, trusted code): built-in generators run there;
  sandbox output goes there raw (`runRaw`, transferred buffers) to be validated. Every output is prepared there (`preparePart`: metre UVs,
  16-bit indices, bounds, the kit-of-pieces test, soft normals), so the page only wraps typed arrays in geometry. A lane failure falls back
  to the old path.
- **Geometry cache** (`render/geometry/ddc.ts`): Cache Storage `aether-ddc-v1`, keyed by SHA-256 of the output key (`proceduralOutputKey`) and
  `__AETHER_GEN_VERSION__` (a build hash of procgen, arch, core and render's geometry code, `scripts/vite/gen-version.ts`); IndexedDB
  `aether-ddc-meta` for LRU under 1 GB or a quarter of the quota. Written by the lanes after the reply, read by the lanes; a hit skips the
  sandbox, validation and preparation. Keys are per output, so an edit misses only for the edited entity.
- **Determinism** (`procgen/sandbox/determinism.ts`): `Math.random` seeded per run and the clock frozen in the worker and Node sandboxes.
- Mounts of generated content yield every 12 ms (one reply can complete many entities).

Measured on the shared office PC (`GEN_GPU=intel`, niced, other jobs running; `aether:sync-start` → `aether:sync-done`):

| Lisbon Hills | Before | After |
|---|---|---|
| Generation, cold | 16.5 s (sync-done 18.6 s from navigation) | 5.0–6.3 s (sync-done 6.7–9.4 s) |
| Generation, second visit | 16.3 s (sync-done 17.3 s) | 1.2–1.4 s (sync-done 1.9–2.1 s) |
| Main-thread long tasks before sync-done | 36, 2.7 s, max 225 ms | cold 9, max 508 ms (renderer creation); warm 1–2, max 51–75 ms |
| JS heap / cgroup peak, cold | 1.40 / 4.0 GB | 1.46 / 4.2–5.0 GB |
| Cache on disk | — | 520 MB (Sanctuary Terraces 75 MB) |

Sanctuary Terraces: sync-done 2.9 s cold / 3.7 s second visit before, 2.2 / 1.4 s after. Hero shots of both worlds match the old build within
run-to-run noise (animated water, clouds and foliage). Left on the main thread: scatter placement and the QEM LOD chains of scatter fields
(one large field mount is about 180 ms on Lisbon), and the virtual-geometry DAG worker (12 s on Lisbon, off the generation path).

## Frame budget, capture rounds and a smaller generation pool (6 November 2026)

The first part of stage 1 of [ARCHITECTURE-STREAMING.md](ARCHITECTURE-STREAMING.md), and two follow-ups to stage 3.

- **Black hero shots** (one Lisbon Hills run of three after stage 3). A pose capture (`WorldRenderer.capturePoses`) draws into a
  target of its own size, a render context of its own, so every object it sees is prepared again in the sliced preparation
  queue, and a draw whose object is still preparing is held back. The first pass queues that work and is dropped; the second
  pass was returned whatever the queue had done. When the queue had not drained (a loaded machine, a compile walk holding it
  right after a load) every draw, the sky included, was held, and the picture read back as all zeros. Stage 3 only changed the
  timing (generation ends seconds earlier, so captures overlap the warm-up more). Now the pass is drawn again after the queue
  settles until a pass holds back nothing (`view/capture-rounds.ts`, at most four rounds). Ruled out: a GPU process killed
  mid-load gives washed-out but drawn frames, not zeros; no cache hit returned empty or detached buffers (`hits` and shape
  checks in the lanes). Not reproduced in 9 runs before the fix; counting held draws per pass shows the mechanism (about 1,150 held in
  the first pass, 0 in the second when the queue has drained).
- **Generation pool for low-end PCs** (`generationLanes()`): at most 4 sandbox workers at 8 GB or less of device memory
  (Chrome never reports more than 8, so this is every Chrome), 2 at 4 GB or less; lanes stay half of that (2). A lane encodes a
  cache entry before it replies (a Blob holds the only copy) instead of keeping a copy of the output to encode later, and its
  write backlog is 16 MB instead of 48 MB.
- **Frame budget** (`streaming/frame-budget.ts`): render preparation after the load screen works 2 ms a frame while the view
  moves and 8 ms at rest, instead of 4 ms slices back to back; 40 ms slices behind the load screen and while a capture waits for
  the scene, as before.
- **Sliced vertex uploads** (`streaming/sliced-upload.ts`, `streaming/upload-streamer.ts`), opt-in with
  `__AETHER_SLICED_UPLOAD = true`: buffers of 1 MB and more are allocated, filled in 1 MB `bufferSubData` slices under the frame
  budget and handed to three's backend before its first upload. Off by default: in hero runs that load Lisbon Hills and then
  Sanctuary Terraces in one page it ended in draws with no vertex buffer bound (`GL_INVALID_OPERATION`) and missing pieces (the
  castle). Index buffers are never sliced (virtual geometry rewrites them). `__AETHER_SLICED_UPLOAD_VERIFY = true` reads every
  handed buffer back for comparison. A slice can still take a second when the GPU process is linking: slicing bounds the size of
  a call, not its wait.

Measured with `scripts/arch-probe.ts` (Lisbon Hills, `GEN_GPU=intel`, low tier, shared office PC, niced, 6 GB scope; three cold
and three second visits per build, medians, ranges in brackets):

| Lisbon Hills | Before (`43432859`) | After |
|---|---|---|
| Browser peak (cgroup), cold | 4.84 GB [4.70–4.93] | 4.74 GB [4.58–4.77] |
| Generation (sync-start → sync-done), cold | 5.3 s [5.0–6.0] | 5.2 s [5.0–6.2] |
| Generation, second visit | 1.55 s | 1.32 s |
| Main-thread tasks over 50 ms after the first picture, cold | 0 [0–1] | 0 [0–0] |
| Same, second visit | 1, 66–78 ms (the first frames' draw) | 1, 65–154 ms (same) |
| Orbit, cold: p50 / p95 / p99 / max | 33 / 83 / 167 / 417 ms | 33 / 83 / 183 / 433 ms |
| Orbit, cold: frames over 33 ms | 172 of 549 | 166 of 588 |
| Orbit, second visit: p50 / p95 / p99 / max | 33 / 33 / 50 / 367 ms | 17 / 33 / 50 / 317 ms |
| Orbit, second visit: frames over 33 ms | 138 of 752 | 128 of 805 |

Hero shots of Lisbon Hills and Sanctuary Terraces match the old build within run-to-run noise (mean pixel difference 0.1–5.2
against 0.5–5.5 between two runs of the old build).

What is left over 50 ms after the first picture, from CPU profiles of the orbit: single node-material builds (three's
`NodeBuilder`, 50–200 ms for one object, not divisible; stage 2's fixed program set removes them) and the frame's own draw
submission (40–100 ms on Lisbon on this machine; stage 4's per-cell batches). Before the first picture: program links and
bindings (stage 2), compile-walk uploads (single `bufferData` calls of 250–1,100 ms, mostly waiting on the GPU process), the
texture cap's redraw (130–180 ms tasks), scatter field mounts (LOD chains and placements, 300 ms). Not moved yet: the texture cap
redraw (an `ImageBitmap` would change the upload orientation of `flipY` textures) and the scatter field mount.

## Per-cell batches (6 November 2026)

Stage 4a of [ARCHITECTURE-STREAMING.md](ARCHITECTURE-STREAMING.md): the World Partition grid and static batches per cell. Streaming
(load and unload of cells) is stage 4b and uses the same grid.

- **Grid** (`streaming/cell-grid.ts`): base cell 16 / 32 / 64 / 128 m for a world under 64 m / 256 m / 1.5 km / larger, levels 1
  and 2 of 2x2 and 4x4 cells, a persistent layer for anything bigger than a level-2 cell. `SceneSync` fixes the grid from
  the top-level entities when a world is first set (Lisbon Hills: 64 m). `CellIndex` buckets entities and re-buckets one
  entity at a time.
- **Shadow batches** (`sync/cell-shadow-batches.ts`): the sun's depth pass draws every caster with one override material,
  so only geometry and the cast side separate casters there. Static plain casters (no behaviours, static or no body, no
  alpha test, no vertex displacement) of one level-1 cell and side are one positions-only mesh on layer 9, which only the
  cached sun map's camera enables; the shadow pass skips the batched meshes for that camera (cascades and point lights
  draw them as before). Virtual-geometry members cast with a fixed cut of their DAG at 0.1 m error. A batch takes over its
  members only after it has drawn once (its pipeline is ready). A member that moves, changes, is hidden, removed or
  selected is evicted at once (its triangles become degenerate, a ranged index upload) and casts by itself; its cell is
  rebuilt after 400 ms without change, under the frame budget. Each batch keeps member triangle ranges and entity ids
  (`entityAt`); members stay in the scene graph, so picking and selection never see a batch.
- **Virtual view batches** (`virtual/virtual-cell-batch.ts`): virtual stand-ins of one level-0 cell and material are one
  mesh over their vertices merged into batch space; every member still selects its own cut, packed at its vertex offset.
  Only materials without node slots join (per-object tones and object-space patterns read the model matrix). A member
  whose sun shadow comes from a ready shadow batch is frustum- and back-face-culled in its view cut.
- **Draw order**: opaque draws are grouped by material class and material before depth (`gpu/render-order.ts`).
- **Copies** merge per grid cell (`StaticMerges.copyCell`, 64 m on Lisbon, was 32). Merging the non-virtual parts of
  entities with virtual parts was tried and left opt-in (`__AETHER_MERGE_VIRTUAL_PARTS`): merged per cell those parts are no
  longer culled one by one or as sub-pixel specks, and the orbit was slower on Intel.
- Not done: building the batches in a worker. A positions-only merge copies about as much as it computes, so moving the
  source arrays to a worker would cost what it saves; builds are sliced per cell on the main thread instead.

Measured with `scripts/arch-probe.ts` (Lisbon Hills, `GEN_GPU=intel`, low tier, shared office PC, niced, 6 GB scope; resolution
held at 0.5 during the 20 s orbit with `--scale=0.5`, since adaptive resolution otherwise spends the saving on pixels):

| Lisbon Hills | Before (`d9d4dab1`) | After |
|---|---|---|
| Draws, opening view: view + shadow pass | 719 + 870 | 700 + 151 (10 shadow batches) |
| Draws, heaviest heading of the orbit | 1,082 + 865 | 1,083 + 154 |
| Draws per frame, median / p95 | 519 / 1,464 | 459 / 1,038 |
| `useProgram` per frame, median / p95 | 228 / 545 | 53 / 102 |
| Uniform-buffer writes per orbit frame, median | 982 | 971 |
| Orbit, second visit: p50 / p95 / p99 / max | 16.7 / 33.4 / 66.6 / 233 ms | 16.8 / 33.4 / 50.1 / 283 ms |
| Orbit, cold: p50 / p95 / p99 | 16.7 / 33.4 / 50 ms | 16.8 / 49.9 / 66.7 ms |

The shadow pass is cut 5.7x and program switches 4-5x; the view pass barely moves. It holds 188 distinct materials at the
opening view (225 at the heaviest heading; 129 and 146 if colour alone did not count), and a draw per (64 m cell, material)
would still be 350-470 draws: the view pass needs fewer materials (stage 2, texture arrays) more than more merging. The
uniform-buffer writes do not follow the draws: a frame drawn with the camera still makes only 20-30, so the writes of a
moving frame are the camera-dependent bindings, not per-batch state. Frame pacing is within this machine's run-to-run
noise; the frames over 33 ms are mostly ones with few draws (median 130 against 400 for the fast frames), waiting on the
GPU process or a node build, not on submission. Hero shots of Lisbon Hills match the old build within run-to-run noise
(mean pixel difference to a second run of the old build 0.2-2.4, the old build against itself 1.0-10.1).

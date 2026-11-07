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
- **Load marks** (`performance.getEntriesByType('mark')`): `aether:compile-start/end`, `aether:sweep-start/end`, `aether:first-use-end`,
  `aether:bake-wait`, `aether:wait-<stage>`, `aether:fully-loaded`, `aether:load-timeout`.
- **Switches** (set on `globalThis` before the studio starts): `__AETHER_SWEEP` (opt-in), `__AETHER_FIRST_USE`, `__AETHER_PROGRAM_CACHE`, `__AETHER_SWEEP_MOTION`,
  `__AETHER_SHADER_RELEASE`, `__AETHER_PIPELINE_RELEASE`, `__AETHER_PASS_FIRST`, `__AETHER_COMPILE_TARGET`, `__AETHER_FULL_WARMUP` (opt-in),
  `__AETHER_MATRIX_CHECK`, `__AETHER_CELL_SHADOWS`, `__AETHER_CELL_VIRTUAL`, `__AETHER_SORT_BY_MATERIAL`, `__AETHER_MERGE_VIRTUAL_PARTS`,
  `__AETHER_ASSET_INSTANCES`, `__AETHER_MATERIAL_DEDUPE`, `__AETHER_MERGE_SMALL_COPIES` (all on by default), `__AETHER_VIRTUAL_PART_CELL`
  (metres, or `'grid'`; default 160).

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

## Each material links once; first use behind the load screen (6 November 2026)

- **The lamp slots before the compile walk.** The 23 links of a load that went unused were lit materials built twice:
  the compile walk saw the entity lamps (three point lights), the first draw then moved them behind the lamp slots (four),
  and every lit material was built again for that light set, with the same code under other node numbers. The slots are
  now synced before every compile walk (`syncLampSlots`). `first-picture-probe --dead` lists the links a load threw
  away and how each differs from the nearest program still in use, numbering taken out; 10-12 remain (sky and
  environment converters, two materials whose graph changes when a texture lands).
- **First use behind the load screen** (`WorldRenderer.prepareFirstUse`, from the load gate). A linked program still
  costs its first draw on Mesa. One object per program is drawn with frustum culling off (clipped out of view, the
  picture does not change) with the sun map, in the motion and then the rest phase of the split chain; the post chain's
  programs link off the frame there (the rest phase's used to link inside the first frame at rest). Rounds repeat until
  a draw of each phase meets nothing new; while objects prepare, a round draws only when some finished. A pass that
  ended clean is not repeated unless programs were added. The sources of merged batches keep their flags (the batches
  key their members on them). Off: `__AETHER_FIRST_USE = false`. Diagnostics: `WorldRenderer.firstUseStats`.
- **Measured and not kept.** Starting the pass right after the compile walk, beside the preparation of objects: the
  GPU process was busy 100 % from then to the first picture anyway (main thread idle), so the first picture did not come
  sooner, and in 3 of 10 warm visits Kestrel's cliffs were missing from the picture (not seen with the pass at the load
  gate, 12 of 12). Drawing the player's person (loaded ahead, far behind the camera) in the pass removed the six
  links of the first frames of play (GPU-process tasks after the first picture 1-4 on a cold visit), but only in the
  early-start variant; from the load gate the person had not loaded yet.

Kestrel Outpost, Intel UHD 770, medium (automatic), headless Chrome, before = `35dd310a`, interleaved on a shared machine
(load average 6-20 from other jobs; one browser at a time). Before: 14 cold and 12 warm visits; after: 6 of each.

| | First picture cold | First picture warm | Links per load (cold / warm) | GPU-process tasks > 50 ms after the first picture, cold | Longest orbit frame, cold |
|---|---|---|---|---|---|
| Before | 17.3-24.8 s (median 19.9) | 8.2-12.5 s (median 9.1) | 78-96 / 85-101 | 7-18 (median 11.5) | 117-517 ms (median 330) |
| After | 15.6-23.9 s (median 15.7) | 8.1-19.2 s (median 8.5) | 60-66 / 65-68 | 5-23 (median 12.5) | 100-400 ms (median 133) |

Links per load fall by 22-25 (both visits). The first picture comes about 4 s sooner cold (one build of each lit
material instead of two); warm it is unchanged within the noise. The orbit after the load no longer meets programs (it
met 4-6 before, each a 300-500 ms frame cold). The GPU-process tasks after the first picture did not fall: most of
those left are the six programs of the player's person, linked when play starts (see above), and the driver's first use
of them. Hero shots (the settled picture of the warm visit) differ from the old build's by 3.9-4.4 / 255, its own runs by
3.5-4.3 / 255. The gate of this step (cold GPU tasks after the first picture at most 9, warm first picture under 6 s) is
not met; links per load is. What the warm first picture waits for is the GPU process: about 4 s of it busy before the
first picture (first use of the programs, the frames themselves), with the main thread idle for 1.5 s of that.

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
  `__AETHER_GEN_VERSION__` (a hash of the tree-shaken code generator output depends on, `scripts/vite/gen-version.ts`,
  ARCHITECTURE-STREAMING.md §3.5.2); IndexedDB
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

## Texture level bias below render scale (6 November 2026)

The bias already existed (`gpu/lod-bias.ts`): one uniform feeds a `log2(scale)` level bias to every mip-mapped colour sample of the
scene pass when the temporal upsample takes the scale (ultra/light chains in motion), clamped to [-2, 0] and 0 above scale 0.95.
Changing the scale only writes the uniform, so no program is recompiled. This pass added a switch and a fix:

- Switch: `__AETHER_LOD_BIAS = false` turns the bias off (the older `__NOBIAS = true` still works). On by default.
- Foliage: the mip-scaled alpha boost (`foliage-shading.ts`) read the unbiased derivative level while the colour texture is now read
  finer; it now subtracts the bias (a uniform fed by `onTextureLodBias`), so a biased leaf is not over-thickened.
- Specular AA (`gpu/specular-aa.ts`) is derivative based and needs no change: sharper normal maps raise the normal variance it widens by.
- Foliage edges: alpha-to-coverage stays off on purpose (`material-cache.ts`): the scene pass is single-sampled and coverage on it
  stipples the card. Under TAA the jittered alpha test is integrated by the upsample. No change.
- Harness: `tests/e2e/upscale-quality.e2e.ts --tier=ultra` pins the tier so the scene pass takes the scale (without it the canvas
  itself shrinks and no bias applies).

Kestrel Outpost, ultra, scale pinned 0.7, three orbit frames against the same frames at scale 1 (`scripts/upscale-metrics.py`):
bias on: detail ratio 0.87, SSIM after 4x down 0.9861; bias off: 0.80, 0.9839. Full-size PSNR 34.5 against 34.8 dB (the bias trades a
little pixel match for detail). Lisbon Hills captures were unusable in this run (a crashed browser, one black frame).

## Fewer materials, fewer view draws (6 November 2026)

Follow-up to stage 4a: the view pass of Lisbon Hills drew about 700 draws from 188 materials, and per-cell batches cannot
merge across materials.

**What the materials are** (opening view, one frame, `--eval` over three's draw calls): 186 materials, 147 distinct by value
(39 are copies of an equal material, nearly all the per-load copies of vehicle models that drive, so they cannot batch anyway),
58 distinct by structure. Of the materials that share a structure, 5 differ only by colour, 67 by colour and scalars
(roughness, metalness, emission), 40 only by texture (20 of them character skins, which are skinned and draw alone) and 26 by
texture and values. `MaterialCache` already shares every material it makes; the duplicates are in library models. Colour
alone is too rare to be worth a per-vertex colour variant, and texture arrays would mostly serve skinned characters, so
neither was done. The draws were in four places instead: the other parts of entities with virtual parts (windows,
balconies, wall copings: about 230 draws, never merged), models with levels of detail (street lamps and planters: about 100,
never merged), copies of models further apart than a merge cell, and scatter layers of many tiny copies.

- **Library-model instancing** (`sync/asset-instances.ts`, `__AETHER_ASSET_INSTANCES`): every static model's part draws as
  one instanced mesh for all copies, levels of detail included (one instanced mesh per part of each level). Each instanced
  mesh packs, for the camera drawing it, the copies that camera sees: at the level three's `LOD` picks for that camera, and
  inside its frustum, so each copy is still culled on its own and a part with no copy in view makes no draw call. It packs
  in the frustum test and again right before the draw, because three draws the shadow maps while it draws the view. Parts a
  merge takes (three parts of one material in a cell, such as a car's four wheels) stay merged.
- **Material dedupe** (`materialSignature`, `__AETHER_MATERIAL_DEDUPE`): instancing groups materials by what they draw
  (class, every value, the image and sampling of every texture), so separate loads of one model instance together. A model's
  body paint, tinted per entity, instances with the colour per copy (`instanceColor` times a white copy of the paint).
  Materials with node graphs stay out (a graph may read the object's matrix).
- **Virtual entities' other parts merge** (`__AETHER_MERGE_VIRTUAL_PARTS`, now on): per 160 m prop cell
  (`__AETHER_VIRTUAL_PART_CELL`), parts up to 30,000 vertices (`VIRTUAL_PART_MAX_VERTICES`; bigger parts are not bound by
  their draw call, and a merge copies its members). Merged pieces of anti-tiled finishes keep their own per-piece tone: the
  merge writes each piece's world origin per vertex (`PIECE_ORIGIN`, the same float32 translation, passed flat) and the
  anti-tile node reads it when the geometry has it. Props that merged before keep the merged mesh's tone, as they always had.
- **Small scatter layers merge** (`__AETHER_MERGE_SMALL_COPIES`): a layer over 8 copies still merges when all its copies
  together are at most 8,192 vertices (flower cards along a balcony), with the same per-piece origins.
- `scripts/arch-probe.ts --init=<file>` runs a script before the app (switches for A/B runs).

Measured with `scripts/arch-probe.ts` (Lisbon Hills, `GEN_GPU=intel`, low tier, shared office PC, niced, 5 GB scope,
resolution held at 0.5, 20 s orbit), two runs of each build interleaved (base `35dd310a`), cold and second visit:

| Lisbon Hills | Before | After |
|---|---|---|
| View draws, opening view (cold / second visit) | 696 / 686 | 412 / 412 |
| View draws, heaviest heading of the orbit | 1,063-1,094 | 580-598 |
| Draws per orbit frame, median / p95, second visit | 427 / 987, 360 / 1,000 | 304 / 567, 291 / 557 |
| `useProgram` per orbit frame, median, second visit | 53, 44 | 61, 60 |
| Orbit, second visit: p50 / p95 / p99 | 16.7 / 50 / 100, 33.3 / 66.7 / 133 ms | 16.7 / 33.4 / 50.1, 33.3 / 66.6 / 83.4 ms |
| Orbit, second visit: frames over 33 ms | 129 of 779, 221 of 557 | 122 of 822, 199 of 626 |
| Orbit, cold: p99 | 50.1, 99.9 ms | 100, 116.7 ms |
| Merged geometry (CPU, the GPU holds the same) | 74 MB | 120 MB |
| JS heap peak | 1,539-1,732 MB | 1,601-1,665 MB |

The opening view draws 40 % fewer (41 % cold, 40 % on a second visit), the heaviest heading 45 % fewer, and the p95 of the
orbit's draws per frame falls from about 1,000 to 560. The second visit's p99 improved in both pairs (two more runs of the
base build earlier the same day: 66.7 and 167 ms); the cold orbit's p99 did not (base 50-100 ms over four runs), it is
dominated by first-use preparation. Programs per frame rose slightly (the instanced variants).

Hero shots (mean pixel difference, 0-255, against two runs of the base build; the base against itself in brackets): Lisbon
Hills 0.2-2.1 (0.3-1.9), the establishing shot 1.0-1.2 (0.6-0.8) and identical by eye at twice the size; Cliff Sanctuary
0.05-1.8 (0.03-1.0); Kestrel Outpost 4.8-18.5 (13.5-18.3, its scene moves). Without the per-piece origins the merged
retaining walls and copings lost their stone-to-stone tone (Lisbon establishing 1.4, Cliff Sanctuary up to 3.7).

Memory: the Lisbon hero shots run near the 5 GB scope with both builds, and the after builds ran out of it in 4 of 8 Lisbon
runs against 1 of 5 for the base. The merged copy is the cost: uncapped, these merges doubled merged geometry (143 MB);
the 30,000-vertex cap keeps 412 draws for 120 MB (433 draws for 103 MB at 10,000).

## Time-of-day drags (6 November 2026)

Measured with `scripts/daylight-drag-probe.ts` (Casa del Patio, `GEN_GPU=intel`, low tier, shared office PC, niced, 5 GB
scope). Each slider is dragged slowly for 3 s (10:00 to 16:00), then fast across dawn, day, sunset and night and back
(2.4 s).

- **Cause.** The daylight study's slider applied the whole environment on every input event. Most of it is cheap (sun,
  sky, ambient and fog are uniforms), but when the sun crosses the lamps' cutoff at dusk or dawn the building's lamps
  are switched on or off. That changes the scene's set of lights, so every lit material needs a new program: 29-32 links
  of 85-130 KB of GLSL. Linking them on the frame held the GPU process for 1.7-5.1 s while the main thread sat idle (no
  long task). Input then queued behind the frozen frames: 7-9 input events reached the page in 5.5-7.8 s. On high and
  ultra tiers, each preset change also unbinds the photographed sky, shows the analytic sky until the next map has loaded,
  then rebinds. That changes the scene's environment twice, and every material follows each change.
- **Drag.** `setEnvironmentOverride(env, { live: true })`: once a frame (the studio coalesces input to
  `requestAnimationFrame`), only the cheap part follows (the lamps follow too since the change below). The photographed sky keeps its map, and the analytic sky's reflection image is redrawn at most every
  120 ms. Bakes under way stop at the first value. The full environment follows 250 ms after the last value, or at once
  when the slider is let go. The inspector's time slider previews the same way and commits one edit when let go.
- **Photographed sky.** One automatic map stays bound until the next has arrived, and two of them stay parked, so moving
  between the day, low-sun and night maps reuses them.
- **The switch after the drag.** On this driver a linked program is compiled again on its first draw: all lamp
  programs drawn in the same frame made one 2.1-2.9 s frame, with no link in that second. `gpu/first-draw-pacer.ts`
  draws one never-drawn pipeline per frame once the world is shown (not behind the load screen, not in captures). The
  same switch now takes about 30 frames of 100-170 ms, with the longest frame at 400-620 ms. Opt out with
  `__AETHER_FIRST_DRAW_PACE = false`.

| Daylight study, fast drag | before | after |
| --- | --- | --- |
| frame p95 / max (idle p95 33 ms) | 1750 / 1750 ms (other runs 1383-4233 / 2066-5100) | 16.7 / 16.8 ms |
| input events delivered | 8 in 7.8 s | 122 in 2.5 s |
| program links during the drag | 32 | 1 |
| longest frame after it is let go | 2083 ms | 400 ms |

Slow drags and the inspector's drags stayed within 2x the idle p95, with no task over 100 ms, before and after. Before,
the inspector showed nothing until the slider was let go. Both commit one undo entry per drag. Settled shots of a fixed
view at 06:30, 12:00, 18:30 and 22:00 on fresh loads differ from the previous build by a mean of 0.15-0.33 / 255, about
the same as two runs of one build.

## CPU copies after upload (6 November 2026)

Follow-up to the section above: its merges took merged geometry from 74 to 120 MB, held on the CPU and again on the GPU,
and Lisbon hero runs ran out of the 5 GB scope more often.

- **Render-only geometry lets its CPU arrays go once uploaded** (`gpu/cpu-release.ts`, `__AETHER_RELEASE_CPU_GEOMETRY`,
  on by default). three keeps every vertex and index array after upload, and the WebGPU renderer and its WebGL2 backend
  never call `onUploadCallback`. A registered geometry's arrays are swapped for empty arrays of the same type once three's
  backend holds a buffer for them (checked each frame and every 250 ms, since the load uploads most of it from the
  preparation queue without drawing a frame). three uploads only what a pass reads (the sun's depth pass reads positions),
  so each attribute goes when a pass that reads it has drawn, and one that no pass reads keeps its copy. Counts, item sizes
  and array types stay, and the bounds are computed first and then fixed.
- Registered: building and prop merges (all attributes and the index), shadow cell batches (positions; the index stays,
  because an eviction rewrites a range of it), and view cell batches (vertices; the index is the live cut).
- **Readers get the data from the owner.** Picking, physics, lightmaps and edits read the members, which keep their arrays
  as before; a merge is rebuilt from its members when they change. Shadow batches read a released merge's members'
  positions (`cpuPieces`), with the same triangles in the same order. glTF export asks for a full copy (`cpuGeometry`: a
  merge from its members, a view batch from its sources with the cut drawn now), and leaves out geometry nobody can make
  again rather than write it empty.
- Not released: textures (65 MB of KTX2 levels on Lisbon Hills; a tier change can upload them again) and the generator
  outputs behind entity geometry (the raw part streams sit next to their prepared streams: fields, occluders, softening and
  triangle counts still read them). Both are candidates for later.
- `scripts/arch-probe.ts --after=<file>` evaluates a page expression right after the orbit (memory census, what the orbit
  prepared and linked).

Measured with `scripts/arch-probe.ts` (Lisbon Hills, `GEN_GPU=intel`, low tier, resolution held at 0.5, 20 s orbit, 5 GB
scope), base `35dd310a` and this change on `2cdc54b4` interleaved, two visits each (before `f9640e86`, which now links
every program behind the load screen); the office PC ran other jobs (load average 15-95), so
frame times are noisy. CPU bytes are summed over the scene's geometry arrays (`census`), before the orbit and after it.

| Lisbon Hills | Base `35dd310a` | `2cdc54b4` | This build |
|---|---|---|---|
| Merged geometry, CPU (GPU) | 74 MB (74) | 120 MB (120) | 20 MB at load, 5.5 MB after the orbit (120) |
| Shadow cell batches, CPU | 58-68 MB | 59 MB | 23 MB |
| View cell batches, CPU | 142 MB | 142 MB | 76 MB, 70 MB after the orbit |
| CPU arrays released | 0 | 0 | 210 MB at load, 233 MB after the orbit |
| JS heap after the orbit | 1,444-1,694 MB | (1,445 before it) | 1,273-1,517 MB |
| JS heap peak during the load | 1,488-1,695 MB (median 1,610) | 1,610-1,684 MB | 1,591-1,680 MB (median 1,640) |
| View draws, opening view | 704 | 412 | 412 |
| Cold orbit p99 | 83-117 ms (seven runs), 167 once | 117-167 ms | 133-183 ms (four runs), 367 at load 94 |
| Second-visit orbit p99 | 83-233 ms | 100-133 ms | 117-167 ms |

The merged copy is gone from the CPU (5.5 MB left: merges never drawn yet, and attributes no pass reads), and the steady
JS heap is 100-200 MB below the base. The load's peak is not lower: it comes during the load, before the preparation has
uploaded what it holds, and is 30 MB above the base's median, inside the spread of both builds.

**The cold orbit.** What the orbit prepares is the same in both builds: every scatter field's levels of detail are
separate instanced meshes, and three builds a node graph per instanced mesh (its cache key holds the object), 20-50 ms
each on this GPU; 116-119 of them came into view during a cold orbit in both builds (2.4 s of main thread). Building them
all in the background after the first picture (387 meshes, 13 s) moved that work but made the orbit worse, and was not
kept. The difference between the builds is two program links mid-orbit, 400-600 ms frames: a street lamp alone in its
256 m region keeps its transparent glass as a plain mesh, and with the other lamps' glass instanced nothing else draws
that program before it comes into view (the base links it at load with the other copies). The compile walk links the
plain glass once at load, and its first draw in the orbit links two more programs for it. Instancing the lone copy
as well removed those links but doubled the cold orbit's median frame in three of four runs, and was not kept either. Not
fixed here.

Hero shots (Lisbon Hills, eight runs of each build interleaved): mean pixel difference against the base 0.68-0.92 (0-255),
the base against itself 0.65-0.76. One run of each build came out in a brighter variant of the light (pre-existing). Out
of the 5 GB scope: this build 1 of 8 runs, the base 0 of 8 (before this change: `2cdc54b4` 4 of 8, the base 1 of 5).
Through a probe: a merged bench moved 2 m was evicted, its merge was rebuilt from the members and its copy released again,
and a ray hit the bench before and after the move. A glTF export of the whole of Lisbon Hills runs out of the 5 GB scope
with either build; the export of released merges is covered by `test/cpu-release.test.ts`.

## Lamps at dusk and dawn without a link (6 November 2026)

The switch after a drag across dusk still linked 29-32 programs: an architectural lamp under the daylight cutoff was
hidden (`light.visible = false`), which takes it out of the scene's light set, and every lit program is keyed on that set.
Measured with `scripts/daylight-drag-probe.ts` on an Intel UHD 770 (`GEN_GPU=intel`, WebGL2), shared office PC, niced, 5 GB
scope; frame costs are GPU time (timer queries) of frames drawn back to back. New probe options: `--tier=`, `--cost`,
`--lamp-ab`, `--set-ab`; each run now also logs the lamps (shown, lit, slots) and the links during the shots.

- **What was measured.** (a) Keep the lamps in the set at zero intensity: four room lamps shaded at zero cost
  +48 % of a daylight frame at low and +95-108 % at medium (`--lamp-ab`: 25.4 against 37.5 ms, 34.2 against 71.0 ms). The
  current build already paid this after its first dusk, since the old slot pool kept its slots at zero. A uniform branch
  around each lamp's term skipped the arithmetic but not its weight on the program: still +6-9 % at low and +25-37 % at
  medium against no lamps (`--set-ab`); without the aperture code the residue was +6.7 % at medium, so it is code size
  (register pressure), not work. (b) Pre-warming both light sets doubles the lit programs at load, and on this driver a
  program is compiled again at its first draw even from a warm cache (the pacer's 100-170 ms frames), so a switch would
  still not be free. (c) A fixed light set it is, with the code of one lamp.
- **The change.** `LampSlots` now shades every shadowless point lamp through one `LampSet` light
  (`gpu/lamp-set-node.ts`): a loop over uniform arrays (colour, world position and range, decay, room clip, three
  apertures per lamp, all in the render group), as many passes as lamps have intensity this frame. The program holds the
  code of one lamp whatever their number, and depends on the set's capacity only (a slot for every lamp shown plus the
  template spares; it only grows). Lamps under the cutoff stay shown at intensity 0 and keep their slot, so a world
  loaded at noon has its night slots from the first frame; the forward budget ranks lamps by full strength, so the hour
  changes no light's place; a lamp with its own shadow map stays a light of its own, its map not redrawn while it is off
  (and `RoomLampNode`/`RoomSpotNode` skip their term behind a uniform branch at zero). The drag no longer holds the
  lamps: they follow the hour live. The night stars stay drawn by day at zero opacity (1,800 points, one draw); hidden,
  they linked their program at the first dusk.
- **Daylight cost** (`--set-ab`, lower quartiles of 12 alternations, Casa del Patio at 12:00): lamps in the set against no
  lamps 22.79 against 22.64 ms at low (+0.7 %), 25.5 against 24.9 ms at medium (+2.3 %).

| Casa del Patio, low tier, drag and release across dusk | before (`f717984e`) | after |
| --- | --- | --- |
| program links from the fast drag to settled | 29 (other runs 29-32) | 0 (four runs) |
| frames over 50 ms after release | 117-167 ms frames for 9.6 s | none |
| lamps during the drag | held off until release | lit live (4 of 4) |
| links while the shots cross dawn, noon, dusk, night | 0 (slots already at zero) | 0 |
| links at load (the shots' total) | 108 (after the drag's 29) | 78 |

Skyline Penthouse (low, four runs against two): 0 links in the drags and across the shots in both builds (it loads at
golden hour with its lamps on, so the current build had its slots from the load). Two of the four runs of this build had a
few frames of 83-233 ms 1-2 s after the fast drag's release, with no link and nothing preparing; the other two, and both
runs of the current build, had none. Night frame cost there is unchanged: GPU 17.9-18.1 ms at 22:00 against 18.6-29.0
for the current build (fastest bursts, `--cost`). At high tier on Casa del Patio (the photographed-sky path of the change above): no rebuild during either drag in
either build; after the fast drag's release the current build linked 39 programs with frames of 9.6, 2.9 and 9.3 s, this
one linked 1 with no frame over 133 ms. The frames of 50-133 ms after release at high tier come from the light volume and
lightmap bakes for the new hour, in both builds. Settled shots of the fixed view at 06:30, 12:00, 18:30 and 22:00 after
the drags differ from the current build by a mean of 0.07-0.13 / 255 on Casa del Patio (two runs of the current build
differ by 0.15-0.32). On fresh loads (shots only) 12:00, 18:30 and 22:00 differ by 0.11-0.31; the first shot, 06:30, by
5.4, in edges only: the current build crosses dawn on that shot, links the lamp programs and lowers its resolution scale.
The penthouse differs by 2.6-7.8, inside the 4.5-8.1 that two runs of the current build differ by there.

## Compressed geometry entries (6 November 2026)

The geometry cache and the cooked packs stored every generator output as raw float32 and 32-bit arrays (Lisbon Hills:
520 MB of packs, all downloaded raw, since static hosts do not compress `.bin`). Entries are now format 2
(`geometry/ddc-codec.ts`, ARCHITECTURE-STREAMING.md 3.5.1): each array quantized by its role and coded with meshopt, then
gzip. `__AETHER_GEOMETRY_COMPRESS = false` writes the old format.

**Where Lisbon's 545 MB of entry arrays went** (base cook, 270 entries; `raw` the generator's streams, `prep` the
prepared render streams the page draws):

| Stream | MB | Share |
|---|---|---|
| Positions (raw 66.6, prepared 52.5) | 119 | 22 % |
| Normals (raw 66.6, prepared 52.5, soft 4.9) | 124 | 23 % |
| Indices (raw 66.5, prepared 16-bit 41.0, 32-bit split copies 31.1, soft 1.2) | 140 | 26 % |
| UVs (raw 44.4, prepared 53.4, soft 3.3) | 101 | 19 % |
| Colours (raw 38.6, prepared 19.5) | 58 | 11 % |
| Colliders, splat weights, bounds | 2 | 0.4 % |

- Prepared streams are a second copy wherever metre UVs split corners (most parts). 42 MB are index arrays whose values
  equal another array of the entry (16-bit prepared indices and their 32-bit source, split indices).
- Identical arrays in different entries: 52 MB (raw indices 15, UVs 11, normals 8, colours 4: same topology or
  attributes on differently shaped outputs). Identical whole entries: 2 (4.3 MB). Library models are not in the cache at
  all; they load as glTF and instance per part (`2cdc54b4`).

**Sizes** (Lisbon Hills, `cook-report.json`):

| | Base | This build |
|---|---|---|
| Geometry packs (also the cache's bytes) | 520 MB, 87 packs | 99.4 MB, 48 packs (5.2x) |
| Whole package, raw | 556.6 MB | 137.0 MB (4.1x; the program sets, 37.5 MB of JSON, are now most of it and compress about 20 times when served) |
| Entry arrays after decoding | 545 MB | 480 MB (no 32-bit copy of 16-bit split indices) |

With every position quantized the packs were 72 MB (7.2x); parts big enough for virtual geometry keep exact positions (see
below), which costs 27 MB. Errors: positions at most 0.25 mm, normals under 0.06°, UVs 7.6e-6.

**Memory and load** (`first-picture-probe --player`, Intel UHD 770, `GEN_GPU=intel`, 5 GB scope, base `f717984e`
cooked, this build cooked and live, two interleaved rounds of cold then warm, plus an earlier round of the first version):

| | Base cooked | This build cooked | This build live |
|---|---|---|---|
| First picture, cold | 46.2, 44.1 s | 42.9, 43.0 s | 47.4, 45.6 s |
| First picture, warm | 36.6, 35.0 s | 36.7, 32.3 s | 31.1, 29.3 s |
| Entries read from the packs again, warm | 97, 49 (of 270) | 0, 0 | — |
| JS heap peak | 1,537-1,745 MB | 1,530-1,694 MB | 1,485-1,707 MB |
| Scope peak | 4,749-5,000 MB | 4,367-4,614 MB | 4,287-4,474 MB |
| Out of the 5 GB scope | 1 of 4 runs | 0 of 6 | 0 of 4 |

- The cold cooked load is 1-3 s sooner than the base's, and its peak is 300-450 MB lower: the lanes fetch 99 MB of packs
  instead of 520. The base reached the 5 GB cap in two runs and was killed in one.
- A warm cooked load no longer reads entries from the packs again: a seed that meets a full write backlog waits and reads
  its entry then. It is still 3-5 s slower than a warm live load, as before this change. Both read all their geometry
  from the cache; the cooked load spends 22-27 s of GPU-process tasks before its first picture against 16-21 s live
  (its boot program set links more at once). That is program work, not geometry, and is not fixed here.
- The JS heap peak did not move. The page holds the same decoded float32 streams as before (raw and prepared), and the
  entries are decoded in the lanes. Quantized attributes on the GPU and the CPU (normalized int16 positions with the scale
  in the matrix, octahedral or snorm8 normals) were not done: every reader of geometry (merges, cell batches, picking,
  physics, lightmaps, export, virtual geometry) would have to read them.

**Hero shots** (`--player --live --shots`, warm visit, so the geometry comes from the cache; mean pixel difference 0-255):
Cliff Sanctuary this build against the base 0.03-0.57, the base against itself 0.00-0.59. Kestrel Outpost against the
base's steady run 0.25-0.90, this build against itself 0.24-0.40. Lisbon Hills against the base's steady run 0.9-6.2
(swaying foliage and far buildings streamed in at a different moment), this build against itself 0.25-1.64. Each world
also had runs in a different light or camera pose with either build (10-45), as before. The first version of the format
failed this: on Cliff Sanctuary the terrain near the camera changed (2.4-6.8 against 0.3-0.6). Three causes, each found by
keeping one property lossless (`__AETHER_GEOMETRY_LOSSLESS`):
1. a warm visit drew quantized geometry while the cold one had drawn exact arrays, so the lightmap baked on the first
   visit was missed: lanes now reply with the decoded entry;
2. the triangle index codec rotates corners: indices now go through the order-keeping sequence codec (75.7 to 75.8 MB);
3. cluster simplification of virtual-geometry parts chose different levels of detail from positions a quarter-millimetre
   off: parts of 20,000 triangles or more keep exact positions.

Not done: identical arrays across entries (52 MB raw) are still stored per entry, and the cache stores identical entries
per key (2 in Lisbon). The tests and typecheck pass and the studio bundle is unchanged (203 / 203 kB; the meshopt codec is
in the generation worker only). Picking, physics, edits and export read the same float32 arrays as before and were covered
by the unit tests, not by a browser run.

## Cooked program sets: the tier the load draws with, and smaller files (6 November 2026)

A warm cooked load was slower than a warm live one (Lisbon Hills: 36.7 / 32.3 s against 31.1 / 29.3 s; 22-27 s of
GPU-process tasks before the first picture against 16-21 s). `first-picture-probe --links` (new: every link's source pair,
its latency and its first `useProgram`, `<run>-links.json`) showed what the cooked load linked that the live one did not.
Lisbon Hills, warm, base build (`a26adad7`), one interleaved pair:

- **Another tier's set, in full.** A renderer starts on the boot guess of its tier (medium on an Intel UHD 770) and the
  pre-warm started on it at 0.4 s: the cooked medium set, 96 pairs, all of them boot pairs (the cook's forced medium
  session), linked eagerly during generation (93 submitted). Lisbon is a heavy world (483 entities) and settles on low,
  but only at the end of generation (`startForWeight` at sync-done: 11.6 s cold). 72 of those 93 links were never drawn
  with. A live load never had a medium set to link.
- **The cooked low set did not hold the load.** It was capped at 64 pairs (`SET_CAP.low`), most of them from the cook's
  forced low session, which pushed out the automatic session's (its boot count was 3). Of the 126 programs the live load
  linked, 107 were in no cooked set: forced sessions run without the split chain an integrated GPU's automatic tier uses,
  so their programs differ.
- **The browser's own set displaced.** The cooked store merged the cooked pairs into the stored set as the most recent, so
  on a warm visit they pushed the browser's own (exact) entries out of the capped set, and wrote the cooked pairs into
  IndexedDB as if they had been used.
- **Geometry slowed by the links.** Cold, the cooked lanes' reads finished at 10.7 s against 6.7 s for live generation:
  93 links in flight beside them. With the fix: 2.1 s.
- **Programs linked twice.** three's synchronous path (environment-mapped materials compiled at render) never took a
  pooled program: Kestrel Outpost linked 8 of its boot pairs a second time.
- Links per load: cooked 205-208, live 120-126. Chrome's own program cache was not the difference: both warm loads read
  all their programs from it; the cooked one simply had 80 more to read and keep.

**Changes**

- A first world's weight is planned from the document (its entity count) before generation, not at its end, so a heavy
  world starts on its lower tier before anything is built: the pre-warm, the materials and the compile walk are on the
  tier the load draws with. This also removes a rebuild of every lit material on the live path (Lisbon live: 120-125
  links per load to 87-92).
- A tier change before the first picture re-targets the pre-warm (before, only before the compile began).
- The cooked store keeps the cooked set beside the browser's own: `boot(tier)` is the cooked boot pairs, linked first and
  through the compile; `later(tier)` the rest of the cooked set, linked only at rest after the first picture; other tiers'
  cooked sets are never fetched. Nothing cooked is written into IndexedDB; the session's save keeps what it drew.
- three's synchronous compile path takes a pooled program when there is one.
- The cook records each tier's boot pairs from the page (`ProgramCache.sessionPairs`: every pair of the load, in order,
  not the capped stored set), the automatic session's for the tier it settled on.
- Eager links in flight: 1, 2, 4 and 6 on Kestrel cold, two runs each, gave first pictures of 11.8-13.8, 11.4-12.5,
  12.4-12.7 and 12.3 s: no difference past the noise (more in flight delays the geometry, 0.9-1.7 s at 1 to 4.5 s at 6,
  but the GPU process is the bottleneck either way). Kept at 6.

**Program set files** (format 3, ARCHITECTURE-STREAMING.md 3.5.1): each distinct line of GLSL once per tier, a source as
runs of lines, gzipped, `programs/<tier>.bin`. Format 2 JSON is still read, so packages cooked earlier load unchanged
(the manifest format did not change).

| | Format 2 (JSON) | Format 3 | Package |
|---|---|---|---|
| Kestrel Outpost, four tiers | 11.3 MB | 0.79 MB (162-222 kB a tier) | 15.8 MB to 5.4 MB |
| Lisbon Hills, four tiers | 16.9 MB (510 pairs) | 1.0 MB | 112.9 MB to 100.4 MB |

**Load** (`first-picture-probe --player`, Intel UHD 770, `GEN_GPU=intel`, 5 GB scope, interleaved, one browser at a time,
with the cook of every template running beside it; first picture, links per load, GPU-process tasks over 50 ms before
the first picture):

Lisbon Hills

| | Cold | Warm | Links | GPU tasks, warm |
|---|---|---|---|---|
| Base, cooked | 38.4, 37.2 s | 25.0, 22.9 s | 174-207 | 13.5, 11.5 s |
| Base, live | 30.6, 32.0 s | 21.9, 18.8 s | 120-125 | 9.6, 6.8 s |
| This build, cooked, package of the base cook | 22.9, 22.8, 22.7, 19.9 s | 16.9, 15.3, 14.3, 13.3 s | 84-88 | 5.3-6.8 s |
| This build, cooked, package of this cook | 23.3, 22.4 s | 16.1, 13.0 s | 91-94 | 7.4, 5.4 s |
| This build, live | 27.7, 29.0, 29.7, 28.0 s | 15.8, 18.8, 25.2, 15.3 s | 87-92 | 6.3-9.0 s |

Kestrel Outpost

| | Cold | Warm | Links |
|---|---|---|---|
| Base, cooked | 11.8, 13.0 s | 7.9, 7.1 s | 69-77 |
| Base, live | 12.8, 13.6 s | 6.8, 6.5 s | 64-67 |
| This build, cooked (package of this cook) | 13.1, 11.9, 12.3, 13.1 s | 7.4, 6.2, 6.2, 6.8 s | 69-77 (69-75 with the synchronous path taking pooled programs) |
| This build, live | 13.4, 13.6, 12.8, 12.4 s | 7.3, 8.1, 6.2, 7.6 s | 63-69 |

- Lisbon: cooked cold 20-23 s against 28-30 s live (and 37-38 s cooked before); cooked warm 13-17 s against 15-25 s live
  (23-25 s cooked before). Links per load 205 to 84-94.
- Kestrel: cooked warm 6.2-7.4 s against 6.2-8.1 s live (means 6.7 and 7.3). Cooked cold is not clearly faster than
  live (means 12.6 and 13.1 s): Kestrel's live generation takes 0.6 s, so there is no idle GPU time for the pre-warm to
  fill; both loads are bound by the GPU process linking the same ~67 programs (GPU tasks 8.4-9.4 s either way), and a
  cooked package carries sources, not program binaries (WebGL has no way to load those).
- The exact boot set of the new cook did not make Lisbon's cold load sooner than the old package's three boot pairs
  (22.4-23.3 against 19.9-22.9 s): the GPU process is busy uploading during generation, and 7-9 of the boot pairs are not
  drawn with in a given load (materials whose graph changes when a texture lands).

**Hero shots** (`--player --shots`, warm cooked visit, this build on this cook's packages against the base on the base's;
mean pixel difference 0-255): Lisbon Hills against the base 0.34 / 8.2 / 2.1 (settled 3.2), this build against itself
0.28 / 2.3 / 5.4 (settled 4.8): swaying foliage, the same picture. Kestrel Outpost's second view 0.24 against the base and
0.33 against itself; its other two views 9-49 either way, because the camera pose of those shots differs from run to run
(the same with either build, as noted under Compressed geometry entries). Tests and typecheck pass; the studio bundle is
unchanged (203 / 203 kB).

**Re-cook.** Not needed: packages cooked before this change (format 2 program sets, including the running cook of every
template) load with the new runtime and get its gains (the Lisbon rows above "package of the base cook"). A re-cook
brings the smaller program files and exact boot sets. A build from before this change reads a format 3 file as no
program set and loads without the pre-warm.

## The player's person behind the load screen, and a first-use pass that draws (6 November 2026)

What was left after the first picture of a cold visit to Kestrel Outpost: six links when play starts (four of them the
skinned person, two programs of the world the first-use pass should have drawn), and the driver's first use of them.

- **The person loads with the world** (`SimulationOptions.preloadPlayer`, `WorldRenderer.preloadPlayer`, `Avatar.preload`).
  A world that opens into play (a launched game template in the studio, `startMode: 'play'` in the player) mounts the
  player's person when its sync starts, with the world's look; the group stays hidden until play places it. On Kestrel the
  rig is in at 3.4-4.1 s, long before the load gate (10-14 s). The first-use pass waits for a person still loading.
- **The first-use pass draws the person**: 4 m behind the camera (clipped), the whole body even where the editor's
  eye-level view hides it, after a step of the character system at that place (detail and shadow casting are picked by
  distance).
- **The first-use pass draws at all.** Its draws ran in the animation frame of the last viewport frame and reused that
  frame's scene pass: one composite draw, nothing met, and the round ended "clean" (Kestrel: 1 GL draw in the pass, the
  person's meshes never drawn; most programs first used on the first turn of the camera). The pass now advances the node
  frame before each of its draws, and draws only its representatives (one object per program, and the person): everything
  else the camera draws is hidden for that draw (the view's own objects drew in the frames before), and casters the camera
  does not draw stay.
- **The tier's own unlinked programs go into the pool at rest** (`ProgramCache.prime`): after the first picture, while
  the view rests, the rest of the tier's set (the browser's own entries, then a cooked world's `later` pairs) is linked
  one at a time and kept in the pool (`stats.pooledLater`), not deleted, until a mesh that comes into view takes it; the
  20 s trim leaves them, a tier change drops them. Linking them whenever nothing else linked (the view moving) was
  measured first and not kept: on a cooked cold visit to Lisbon Hills 12-18 of them landed in the orbit, p95 133 to
  233-333 ms. The neighbouring tiers are primed after them, as before.
- Probes: `first-picture-probe` reports the links in the first 10 s of play (it waits for them); `arch-probe` reports
  the links during the orbit.

Intel UHD 770, `GEN_GPU=intel`, headless Chrome, 5 GB scope, one browser at a time, interleaved with the base
(`3ee9ca0d`); the machine ran the cook of every template and other jobs (load average 4-40), so times are noisy.

Kestrel Outpost, studio, cold (`first-picture-probe --runs=cold`; base 8 runs, this build 4):

| | First picture | Links in the first 10 s of play | GPU-process tasks > 50 ms after the first picture | Longest orbit frame |
|---|---|---|---|---|
| Base | 13.8-16.3 s (median 15.3) | 6 (all runs) | 24-67 (median 40), 1.8-5.5 s | 233-650 ms (median 417) |
| This build | 16.4-19.8 s (median 17.1) | 0 (all runs) | 0-44 (median 16), 0-2.7 s | 50-133 ms (median 108) |
| Whole scene drawn in each pass draw (not kept) | 15.5-23.4 s (median 18.6) | 0 | 1-26 (median 8.5) | 66-150 ms |

The pass of this build takes 3.4-5.0 s against 2.2-4.6 s: the driver's first use of the programs out of view now
happens behind the load screen, as the pass was meant to do, and the first picture comes about 1.8 s later on a cold
visit. The tasks over 50 ms left after it are short (longest 74-112 ms), not links. Drawing the whole scene in each draw
of the pass took 1-2 s more.

Lisbon Hills, studio, cold, 20 s orbit at resolution 0.5 (`arch-probe`): links during the orbit 0 in every run of both
builds (the lone street lamp of "CPU copies after upload" no longer links mid-orbit in the base either); orbit p99 base
50-167 ms (median 133, seven runs; one more ran out of the scope), this build 83-150 ms (median 117, three runs, and
four of the variant above: 100-133); first picture 29.7-36.0 s against 32.0-33.0 s. Lisbon Hills cooked in the player,
cold and warm, two interleaved pairs: first picture cold 31.3, 31.4 s against 32.5, 29.7 s, warm 18.0, 19.0 s against
24.0, 23.8 s, and in two more pairs at a load average near 40 (the hero runs below) warm 57.6, 36.7 s against 48.3,
44.3 s; no link during the orbit in either build, and 0-1 programs pooled at rest per visit (the probe's orbit starts at
once).

Hero shots (`--player --shots`, cooked packages, two runs per build): Kestrel's first view 0.48-0.58 / 255 against the
base, 0.45-0.52 against itself (its other two views move from run to run, as noted before); Lisbon Hills 0.96-7.31
against the base, 0.26-8.73 within either build. Typecheck passes. The test suite passes except four timing and
time-out tests in packages this change does not touch (mock provider speed, generator speed, a 30-house stair check, the
Orbital Lab bot), which failed the same way when run alone at a load average of 36-40. The studio's initial download is
the base's: 203.01 kB gzip with either build (`check-budget.ts` rounds it to 203 and reports both over the limit).

Gate of this step: no link in the first 10 s of play, met; Lisbon cold orbit without links, met (as was the base), p99
within the noise; hero shots, met; cold GPU tasks after the first picture at most 9, not met (median 16 of 4 runs, from
40); first picture not slower, not met (Kestrel cold about 1.8 s later).

## One budget for every worker (6 November 2026)

About seventeen kinds of web worker each sized themselves from `navigator.hardwareConcurrency`. On an 8-thread machine,
Lisbon Hills kept on average **10.1 workers busy during generation** (sandbox lanes, generation lanes, DAG, raycast BVH,
compute, atlases), more than there are threads, beside the main thread and the GPU process. The worker scheduler
(`packages/core/src/worker-scheduler.ts`, design in ARCHITECTURE-STREAMING.md 3.6.1) gives them one budget: at most
`hardwareConcurrency − 2` busy workers (6 here), in priority classes. Bakes and background work wait for the first
picture, drags and a moving view, and a running lightmap bake parks between its slices while the view moves.
`window.__aetherWorkers` shows queued and running tokens and wait times per class.

**How it was measured.** One build (on `3ee9ca0d`), A/B by switch: `__AETHER_WORKER_SCHEDULER = false` grants every token at once and
sizes the pools as before ("before"). Both sides ran with `navigator.hardwareConcurrency` forced to 8 and the browser
pinned to 8 CPUs (`taskset -c 16-23`), so this 32-thread office PC behaves like the 8-thread laptop. Studio live path,
`GEN_GPU=intel`, low tier, 5 GB scope, `nice -n 10`. The PC was shared with a cook-and-upload service and other people's
jobs (at one point a 21-core evaluation), so runs were interleaved in pairs, alternating which side went first.
Values are medians, and "paired" is the median difference within pairs, with how many pairs improved.

- `scripts/arch-probe.ts`: Lisbon Hills, 12 pairs (cold load and a 20 s orbit in 9 of them). Casa del Patio, 10 pairs:
  cold load, then a lightmap bake (`bakeLight('medium')` after `setRenderTier` gives back the light volume that the
  performance ladder had cut on this loaded PC), and a 10 s orbit once the lightmap worker is baking.
- `scripts/first-picture-probe.ts --runs=cold --shots`: 3 pairs each, for GPU-process tasks over 50 ms and the hero
  shots.

**arch-probe additions.** Animation-frame pacing from navigation to the end of the load's settle (`loadFrames`), long
tasks over the whole load (`longAll`), the scheduler's readout at the end of the load (`workerSchedule`), and per worker
its busy spans (`workers[].spans`).

Lisbon Hills (cold, live generation)

| | Before | After | Paired |
|---|---|---|---|
| Workers busy during generation (mean) | 10.1 | 5.7 | −4.3, 7 of 7 |
| Generation (sync-start to sync-done) | 12.5 s | 11.0 s | −0.4 s, 9 of 12 lower |
| First picture | 40.9 s | 38.2 s | +0.6 s, 5 of 12 lower |
| Main-thread long tasks during the load | 57 (8.1 s) | 50.5 (7.8 s) | −4, 7 of 12 fewer |
| Longest long task | 1,803 ms | 1,345 ms | |
| Load frame p95 / p99 | 133 / 333 ms | 117 / 300 ms | p99 −33 ms, 10 of 12 lower |
| Load frames over 50 ms | 132 | 119 | −11, 10 of 12 fewer |
| Orbit frame p95 / p99 | 92 / 158 ms | 117 / 183 ms | p99 +0.1 ms, 4 of 9 lower |
| Orbit long tasks | 6 | 4 | −1 |
| GPU-process tasks > 50 ms before the first picture (first-picture-probe) | 65, 65, 74 (15.1-15.9 s) | 69, 72, 69 (15.0-15.3 s) | |
| … after the first picture | 40, 27, 43 (1.5-2.4 s) | 39, 39, 39 (2.4-2.7 s) | |
| First picture (first-picture-probe) | 37.2, 37.5, 38.1 s | 37.9, 37.4, 36.2 s | |

Casa del Patio (cold, then a lightmap bake under an orbit)

| | Before | After | Paired |
|---|---|---|---|
| Workers busy during generation (mean) | 6.3 | 5.4 | −1.0, 5 of 5 |
| Generation | 1.8 s | 1.7 s | −0.15 s |
| First picture | 21.4 s | 22.8 s | −0.5 s, 6 of 10 lower |
| Main-thread long tasks during the load | 19.5 (4.6 s) | 21.5 (3.7 s) | −5, 7 of 10 fewer; sum −0.65 s |
| Load frame p95 / p99 | 142 / 342 ms | 133 / 475 ms | p99 −25 ms, 6 of 10 lower |
| Orbit during the bake, frame p95 / p99 / max | 142 / 208 / 900 ms | 50 / 133 / 175 ms | p99 −58 ms, 8 of 10 lower |
| Lightmap bake, request to applied | 27.5 s | 41.6 s | +12.8 s |
| … of which in the worker (parked time included) | 18.0 s | 28.0 s | |
| GPU-process tasks > 50 ms before the first picture | 43, 42, 42 (10.6-10.9 s) | 43, 42, 42 (10.0-10.5 s) | |
| First picture (first-picture-probe) | 22.6, 19.6, 20.0 s | 18.0, 18.8, 19.5 s | |

- **Generation** keeps its speed with about half the busy workers: the extra lanes only shared the same eight threads
  (the sandbox's summed busy time was 80 s against 44 s for the same work). The main thread gets more of the machine:
  fewer frames over 50 ms during the load, and a lower load p99, on both worlds.
- **The orbit during a bake** is the clearest gain: the lightmap parks within 250 ms of the view moving and resumes when
  it stops, so the orbit's worst frame drops from about 0.9 s to under 0.2 s. The bake takes longer by the time it was
  parked (the 10 s orbit plus the light volume's bake, which now waits for the view to rest).
- **Lisbon's orbit** runs no worker at all, before or after (busy spans empty), so the scheduler cannot change it. Its
  orbit numbers moved within this PC's noise (p99 even in the paired median).
- **First picture**: no slower within noise on either world (paired medians +0.6 s and −0.5 s, first-picture-probe
  equal on Lisbon and lower on Casa). An earlier version without headroom for `load` delayed Casa's first picture by
  2-3 s: transcodes, compute and atlas jobs queued behind the generation lanes. `load` now takes one token over the
  budget, and waiters age one class every 0.5 s.
- **What waits** (Lisbon, at the end of the load): generation lanes 30 s in total over about 180 waits (they take
  turns: a lane yields once another of its class has waited 200 ms); load-critical jobs 32 s over 58 waits of 272;
  verification's warm-up 2-7 s, until the first picture.
- **Hero shots** (first-picture-probe, mean pixel difference 0-255): Lisbon settled 0.04-0.23 between any two runs, before
  or after; Casa del Patio settled 0.2-3.5 between runs either way (one before run 26, a different view). The first
  picture shots differ by up to 11.6 within one side and up to 15.8 across (the load screen leaves at a different moment
  of the fly-in).

Gate: fewer long tasks and a better p99 during the load on both worlds and during the orbit on Casa del Patio; Lisbon's
orbit is unchanged (no worker runs in it). First picture not slower, generation faster, hero shots within noise. Tests
and typecheck pass. The studio bundle is 205,154 B gzip against 205,153 B for the base (`check-budget.ts`, limit 204 KiB;
the scheduler goes into the chunks that use it).

## Re-lightable baked light (7 November 2026)

The lightmap and the light volume are baked once, at publish, as parts that the live light weights (docs/LIGHTING-BAKE.md).
Casa del Patio, Intel UHD 770, player on the cooked package (`scripts/baked-light-probe.ts`):

| Time-of-day drag | before (single-time bake) | after |
| --- | --- | --- |
| bakes during and after the drag | volume and lightmap rebaked, settled after 9.4–29 s | 0, settled after 3.0–4.6 s |
| program links during / after release (medium) | 3–7 / 1–2 | 0 / 0 |
| frame p95, slow drag, low / medium | 267–283 / 200–233 ms | 50–100 / 33–67 ms |
| lightmap reads per pixel, cost (in-page A/B) | 1 | 5: +0.8 % at low, within noise at medium |

Package: +8.8 MB of baked light on Casa del Patio (lightmap 5.5 MB, volume 3.3 MB). Bake at publish: 67 s on 12 threads
outside the page (940 s in the page's single worker).

## A ladder step without a link, and fewer triangles a frame (7 November 2026)

Kestrel Outpost (cooked) on the Intel UHD 770, WebGL2, measured with `scripts/first-picture-probe.ts --player` and the
base build interleaved with this one on a shared, busy GPU.

- **The ladder's tier cap keeps the materials.** A step to the medium or low cap used to rebuild every lit material
  (lights, sky detail, the scene pass's output): 34 links, page tasks of 210-370 ms and up to 16 GPU-process tasks over
  100 ms (longest 570-620 ms), and the slow frames of the rebuild made the ladder take the next step 4-6 s later. The cap
  now lowers only what the frame costs (`QualityOptions.ladderCap`): the lower tier's level of detail, draw distances,
  small casters and post passes, the composite kept. `QualityPlan.programTier` is the tier the materials are built for;
  the programs, the program set (`programs/<tier>.bin`) and the neighbours primed in idle time follow it. Firefox's
  cautious start still asks for the lightest programs. A heavy world on a weak GPU starts at the low cost with the
  automatic tier's programs (Lisbon Hills on Intel: the medium look, the composite and its grade, from the first picture).
- **No evidence from a rebuild.** Frames drawn while a plan change's programs link (a chosen tier, a cascades step) no
  longer feed the ladder or adaptive resolution.
- **Shadow-pass level of detail for scatter fields.** The sun map draws every field level through a stand-in with the
  next level's geometry and the same instance buffer (`FIELD_SHADOW_LAYER`); the levels themselves are skipped there.
  Cascade cameras draw the levels as before.
- **Field level of detail from the instance's centre.** A chunk took its level from the nearest point of its box padded by
  the instance radius: an 18 m pine counted 18 m nearer than it was. And heavy meshes switch level at a larger projected
  radius (`fieldLodPixels`: the switch radius grows with the square root of the level's triangles over 1,000).
- **Probe:** `--drop` forces one ladder step after 4 s of motion and reports links, long tasks and GPU-process tasks in
  the 6 s after it; `--tris` reports triangles per frame by pass and by mesh at the opening view (adaptive resolution off,
  ladder held), with the cached sun map and with it redrawn; `--tier=<tier>` starts the player on a chosen tier.

| Kestrel Outpost, Intel UHD 770 | base | this |
| --- | --- | --- |
| forced step medium to low (`--drop`, cold and warm): links in the 6 s after | 34, 34 | 0, 0, 0, 0 |
| longest page task in those 6 s | 1,536 ms, 71 ms | 64, 0, 0, 69 ms |
| GPU-process tasks over 100 ms in those 6 s | 11 (longest 634 ms), 2 | 0, 0, 0, 0 (longest 83 ms) |
| a further step from the rebuild's slow frames (all drop runs) | 3 of 8 | 0 of 10 |
| triangles a frame, opening view at medium, 1600×900, sun map cached (3 runs) | 692,000-711,000 | 525,000 (-25 %) |
| the same with the sun map redrawn | 1,248,000-1,282,000 | 853,500 (-33 %) |
| 8 s orbit, triangles a frame | 655,000-702,000 | 498,000-504,000 (-26 %) |
| GPU time of the frame, orbit (timer queries, a contended GPU; mean of 3 pairs) | 113 ms | 84 ms |

Lisbon Hills at medium: 3.50 M to 3.44 M triangles a frame (-2 %). The hero views of Kestrel Outpost, Lisbon Hills and
Casa del Patio (`scripts/experience-shots.ts --hero`, and the probe's opening views) show no loss: the pines, their
shadows and the buildings look the same; Lisbon on Intel now shows the medium grade from its first picture.

What dominates: Kestrel's opening view at medium, 1600×900: a pine field at its finest level (235,000 triangles), the
outpost's merged buildings (121,000), and in the sun map the same pines (184,000 of 596,000). Lisbon Hills: merged
buildings (1.26 M of 3.4 M in the view) and the per-cell shadow batches (2.4 M of 3.0 M in the sun map). Neither moves
here: the buildings are for HLOD streaming, and simplifying the shadow batches costs seconds of CPU at load.

Still open: an adaptive-resolution step resizes the canvas, 35-130 ms on this GPU in either build.

## Kits of small pieces keep every piece; uniform arrays keep their names (7 November 2026)

**Virtual geometry lost whole pieces.** Lisbon Hills' quay-row flowers and the bougainvillea on the retaining walls (pieces
of about 120 triangles, just over the kit test of `virtual/kit.ts`) are drawn as virtual geometry. Their cluster DAG
simplified groups of separate pieces until no triangle was left; the children of such a group got a parent that was never
built, and no cut reached them at any distance (the wall drapes of the "Retaining wall square" view, most window-box and
facade flowers of the hero view, and holes in the wall's limestone lip were missing on main). A group simplified to
nothing now keeps its clusters as roots (`cluster-dag.ts`; test in `virtual.test.ts`). The far-outside test that lets a
shadow caster keep its last cut used the first root's LOD sphere, which is not a bound of the mesh; it now uses the mesh's
bounding sphere (`virtual/view.ts` `sphereFarOutside`). DAGs are built in the viewer, so no package changes.

**Uniform arrays named by node id.** The GLSL backend names a uniform array's block `buffer<node id>`, and three counts
every node of the page, so the lamp set's seven arrays (and water's wave array) were named by how many nodes the load had
made before them. Cooked Lisbon Hills on main: its low set was recorded with `buffer25779-25785`, the player drew with
`buffer24607-24613`; the medium set matched by chance. They now take ids of their own per kind (`gpu/stable-node-ids.ts`).
Cold player, medium, two runs each: links 93 and 93 against 95 and 104, programs drawn that are not in the cooked set 1
against 4 and 7; warm 96 and 94 against 100 and 102. Every hosted program set holds the old names until it is cooked again.

## Quantized geometry on the GPU (7 November 2026)

The cooked packs store geometry quantized, but the lanes decode it to float32 and three uploaded what the CPU held: 12 bytes
a position, 12 a normal, 12 a colour. Registered geometry now goes up as integers while its CPU arrays stay float, so every
CPU reader (picking, merges, shadow batches, physics, lightmaps, export) is unchanged (`gpu/quantized-geometry.ts`):

- positions: normalized int16 on a power-of-two grid around the origin or the box centre, at least the packs' 2^-11 m
  (cooked positions keep their values) and at most 2^-10 m (an error of at most 0.5 mm; 2^-9 m for geometry whose
  anti-tiled material hashes its origin, which may not be translated; 2^-7 m for the depth-only shadow batches). The
  dequantization is folded into the object's world matrix for the draw (`M · T(c) · S`, a uniform scale), so no shader
  changes and the cooked program sets still match. Larger geometry keeps float positions. Not for instanced, batched or
  skinned meshes, nor materials with a position node, displacement, layers or shading expressions (object space); a
  geometry drawn by one after its upload goes back to float positions;
- normals: 10:10:10:2 snorm in one word (an error under 0.12°); colours and layer weights within 0..1: unorm16, other
  colours half floats; UVs within 0..1 (atlases, the lightmap) or -1..1: unorm16 or snorm16. Metre UVs stay float;
- the virtual-geometry index is 16-bit when the mesh's vertices fit, and sized for the finest cut of each instance (it was
  three times the base level or 196,608 triangles, whichever was more, for every mesh; it grows when an instance joins);
  virtual cell batches and per-cell shadow batches of up to 65,535 vertices take 16-bit indices too.

Entities' generator parts, merges, virtual-geometry instances, virtual and shadow cell batches, the ground and the land
ring are registered. WebGL2 only: on WebGPU the vertex format comes from the CPU array, and nothing changes there. No
change to cooked output or the generator code version.

**Measured** (cooked player, Intel UHD 770, `GEN_GPU=intel`, automatic tier, live GL buffer bytes once the cell batches
settled, `first-picture-probe --player` with a `bufferData`/`deleteBuffer` tally; interleaved, main `3eda6a64`):

| | Lisbon Hills main | this build | Kestrel Outpost main | this build |
|---|---|---|---|---|
| GPU geometry (MB, cold / warm) | 642-702 / 640-645 | 343 / 344-346 (-47 %) | 22.9-23.2 | 14.7 (-36 %) |
| index buffers (MB) | 278-304 | 113 | 3.5 | 2.7 |
| first picture cold (s), mean | 25.6, 30.0 (27.8) | 25.9, 27.9 (26.9) | 11.3-12.7 (12.2) | 11.3-14.4 (12.4) |
| first picture warm (s), mean | 21.8, 22.8 (22.3) | 22.6, 21.1 (21.9) | 6.2-7.6 (6.9) | 6.0-7.8 (7.0) |
| links cold / warm | 99-101 / 92-94 | 97-99 / 94-98 | 75 / 69-75 | 69-75 / 69-75 |

Two interleaved pairs on Lisbon, four on Kestrel, a contended machine. `complete-geometry-probe --cooked`: both worlds OK
(0 render objects without attributes, 0 merges shown empty). Opening views (`experience-shots.ts`, live): Lisbon's street
hero against main 0.26 mean (0-255; main against itself differed by up to 100, the second run caught another moment),
Kestrel's play view 1.29-1.52 against main's 0.78 run to run, the differences in the dust, the pines' sway, the fire and the
character: no geometry moved, no seams.

What is still float on Lisbon: 100 MB of positions in geometry beyond 64 m (cell batches and merges of 160 m cells, half of
it needing 2^-9 m, half 2^-8 m), 23 MB of metre UVs. Virtual-geometry groups whose every instance is drawn by a cell batch
keep their own vertex buffers (about 70 MB on Lisbon); freeing them is not in this change (a first try was measured on a
live load by mistake and is undecided). Encoding
costs the main thread about 70 ms per million vertices (positions, normals, UVs, colours), within the noise of the first
picture. ANGLE on D3D11 has no three-component 16-bit or signed 10:10:10:2 vertex formats and widens them at upload.

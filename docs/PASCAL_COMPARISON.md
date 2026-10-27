# Pascal Editor comparison

Source studied: https://github.com/pascalorg/editor, commit
`c0284b68e952196a944e9b5ea958227499ddc3c0` (MIT, Copyright (c) 2026 Pascal
Group Inc.). Shallow and then full clone into a scratch directory, read only:
no script, installer or build of theirs was run. Code taken from it is listed
in [THIRD_PARTY.md](THIRD_PARTY.md#code-adapted-from-mit-licensed-projects).

## Licence and asset audit

- Code: `LICENSE` is MIT; every `package.json` under `packages/` declares MIT.
- Assets: **nothing was taken.** MIT covers the code; the repository gives no
  per-file provenance for its binaries.

| Group | Files | Provenance stated | Verdict |
| --- | --- | --- | --- |
| `apps/editor/public/items/*/model.glb` + `thumbnail.webp` | about 146 GLB, about 290 with thumbnails | None. No copyright or author in any GLB header (generators: glTF-Transform, Blender I/O, `obj2gltf`, `FBX2glTF`, i.e. converted from third-party formats). Bulk-committed by one contributor ("items", "new items") with no licence note | Skip: unknown origin |
| `apps/editor/public/material/**` (KTX2 maps, WebP thumbs) | about 293 | None (names resemble public PBR sets, but nothing records the source or licence) | Skip: we already ship CC0 sets with recorded sources |
| `apps/editor/public/hdri/venice_sunset_1k.hdr` | 1 | None in repo | Skip: Aether already ships Poly Haven HDRIs with records |
| `apps/editor/public/audios/sfx` | 28 mp3 | None | Skip |
| `apps/editor/public/icons`, `docs/images`, `assets/*.svg/png` | about 110 | Fitting icons: AI-generated per their README (style-referenced); logos are trademark artwork | Skip |
| `packages/editor/src/lib/floorplan/pdf-fonts` | Liberation Sans, Geist Mono | Licence files present (OFL / SIL) | Not needed |
| `docs/media/next-demo` | 6 GIF | CC BY 4.0, Pascal Group Inc. | Not needed |
| `apps/ifc-converter/public/test-ifc-files` | 10 IFC (4 checked in) | Their own README: "publicly downloadable does not mean they may be reused" | Skip |

So the item catalogue (furniture, door and window GLBs) is not usable. Their
MCP catalogue only references those files by id, so there is nothing else to
borrow. Rendering stills of unlicensed models for evaluation was not done: any
step that copies them into our asset pipeline would create a licence record we
cannot fill in.

## Capability table

| Capability | Pascal | Aether | Verdict and reasons |
| --- | --- | --- | --- |
| IFC4 export | `ifc-converter` (STEP writer, IfcWall + voids + fills, slabs, spaces, stairs) | None before this change | **Borrowed (done).** STEP writer, GUIDs and entity builders adapted; the World IR mapper is ours. Risk: tessellated stairs and roofs are not parametric in BIM tools |
| Wall joins at corners and T | `wall-mitering.ts`: line-line mitres, junction grid, `MITER_LIMIT` 10 then butt | `wall-joins.ts`: angular-neighbour corner solver, extension cap 4 x thickness; `wall-network.ts` splits T-junctions at room vertices | Skip: equivalent result; theirs falls back to a butt joint on very acute angles, ours clamps the spike. Revisit only if a visible acute corner appears |
| Openings | CSG (three-bvh-csg) on a mesh | CSG-free wall builder cutting spans analytically (`openingSpans`) | Skip: ours is cheaper, exact, and needs no extra dependency |
| Roofs | Segments, hip/gable/shed/dormer/conical/glazed, auto elevation | flat, gable, hip, shed over a rectangle | Adapt idea (follow-up): dormers and conical roofs. Their code is bound to React node renderers and a different schema; port needs a new `PlanRoof` shape and fit/nav rules |
| Stairs | straight, curved, spiral, winders, guards, rise/going sizing, clearance | straight, L, U, guards, fit and checks (`stair-fit.ts`) | Adapt idea (follow-up): spiral. The curved step is an annular prism (`buildCurvedStepGeometry`), trivial to write fresh; the cost is in fit, walking line, guards and nav, not geometry. Not done in this pass |
| Windows, doors | many types (casement, awning, bay, bow, louvered, curtain wall) | 8 window and 8 door styles, bay, arched, muntins, surrounds | Skip: comparable; curtain wall is an idea for later |
| Columns, railings, fences | styled columns (bases, capitals), fence features, gutters | `arch-column` (round/square), `arch-railing`, gutters on roofs | Adapt idea: column base and capital styles |
| Slabs, ceilings | slab polygon ops, ceiling surfaces | slabs with holes, ceiling styles (vault, coffer, beams, cove) | Skip: ours richer in styles |
| Level modes, cut and X-ray | stacked, exploded, solo; cutaway and X-ray | levels explode, solo, walls-down, `cut` section param, X-ray | Skip: present |
| Item placement rules | furniture-fit skill, `check_collisions`, door keep-outs 65 cm | `placement.ts`, wall-space, front-clearance, clear-start, checks | Skip code; **adapt idea:** claim boundaries below |
| MCP tools | semantic builders, `verify_scene`, `measure_stair`/`fit_stair`, `scene_wipe_blocked`, `view_scene` | `export`, `edit`, `check`, `render`, stair fit, undo/redo | Adapt idea: refuse an edit that would empty a world |
| Agent skills text | `pascal-3d`, `furniture-fit` | prompt in `packages/agent` | Adapt idea (wording only, below) |
| Undo/redo | Zundo (zustand temporal) | patch history in core (`history.ts`) | Skip: ours is patch based and already feeds MCP undo |
| Plugins | plugin system with packs | none | Skip: out of scope |
| CLI | downloads a runtime, projects, MCP service | `aether start`, `doctor`, `mcp` | Skip |
| Measure and guides | measurement nodes, guides, construction dimensions | plan dimensions, snapping (`plan-edit.ts`) | Adapt idea: persistent dimension nodes |

## Ideas worth taking from the skills and tool design

Wording only, to be adapted when the tool descriptions are next edited (they
are not copied):

1. State the strongest valid claim: "the footprint fits at the tested pose
   under the checked clearances", not "the furniture fits"; list checks not
   made (height, delivery route, mesh contact) as `not checked`.
2. Report evidence after an edit: changed ids, checks run, unresolved issues,
   and what was not verified.
3. Refuse writes that empty a world unless the user asked to start over.
4. A placement refusal is a constraint, not a tool failure (`blocks_door`,
   `too_large_for_room`).

## What was ported

- IFC4 export: `packages/arch/src/ifc/` (three adapted files with the MIT text
  in their headers, one own mapper) and MCP `export` `format: ifc`.

## Not ported, and why

- Assets: no provenance; see the audit.
- Spiral stairs, dormers, conical roofs, column styles: ideas only here; each
  needs a new schema branch plus fit, nav and agent-doc work, and the upstream
  code is React and node-schema bound.
- CSG openings, mitre solver, undo store: ours already cover the use.

## Rendering and performance

Second pass, same commit (`c0284b68e952196a944e9b5ea958227499ddc3c0`), read only. Scope: `packages/viewer`,
`packages/nodes`, `packages/core` (paths below are relative to `packages/`). Pascal draws with three.js WebGPU through
React Three Fiber and post-processing in TSL (SSGI, merged outline, ink edges). Aether draws with vanilla three r186
through `packages/render` (WebGL2 and WebGPU). Measured here on the Intel UHD 770 (WebGL2 over ANGLE/GL), headless
Chromium, while the machine was busy with other jobs (load average 13 to 18 on 32 cores, the integrated GPU shared): a
`render()` call took 1 to 2 s in the busy turns (the tier-low frame is about 10 ms on a quiet machine), so **no claim
below rests on a GPU frame time**. Claims rest on counts (rebuilds, geometries, GL objects) and on CPU timings of code that
does not touch the GPU, taken back to back with the change stashed and applied.

| Technique | Where in Pascal | What Aether does now | Verdict and expectation |
| --- | --- | --- | --- |
| Manual frame loop (`frameloop="never"`), 50 fps cap with a remainder clock, pause while the canvas is covered | `viewer/src/components/viewer/frame-limiter.tsx`, `index.tsx` | On-demand draw (`needsDraw`), frame governor, adaptive scene-pass scale, pause on hidden tab (`Simulation.ts`). The idle path draws only when something is dirty; a world with moving residents or water is dirty every frame (skyline-penthouse at idle: 46 of 46 rAFs drawn in 3 s) | Skip: ours already stops drawing when nothing changes (a quiet-world idle figure was not re-measured in this pass) |
| DPR cap 1.5 (1.25 on coarse pointers) | `index.tsx` `maxDpr` | Scene-pass scale 0.5 to 1 steered by frame time, Catmull-Rom and temporal upsample, texture level bias | Skip: finer control than a fixed cap |
| `BatchedMesh` per level, material, attribute signature and shadow flags; incremental instance add and delete; tinted nodes released; settle window | `nodes/src/shared/node-batch/{store,system,candidates,types}.ts`, `nodes/src/wall/wall-batch-system.tsx` (`MIN_BATCH_WALLS` 8, `BATCH_SETTLE_MS` 180) | `sync/static-merges.ts`: merge per material per storey in a worker (`MIN_MERGE` 3), members that change are evicted and the group re-merged, plus instancing in `static-batches.ts` and `draw-batches.ts` | Skip: same effect (one draw per material per storey) with the merge off the page; their per-instance culling matters for scattered items, ours merges per storey and culls the merged mesh |
| Rebuild budget per frame: 8 walls or 8 ms, early exit on a wall with 6 or more openings, neighbours deferred to a trailing flush 80 ms after a drag | `viewer/src/systems/wall/wall-system.tsx` (`MAX_WALL_REBUILDS_PER_FRAME`, `WALL_PROGRESSIVE_TIME_BUDGET_MS`, `HEAVY_WALL_OPENINGS`, `DRAG_FLUSH_MS`) | Generators run in a worker; `gpu/task-queue.ts` runs queued jobs with a 6 ms budget per task; edits are committed per gesture, not per pointer move | Skip: the budget exists; there is no live 3D wall drag to throttle |
| Miter solution cached per level by exact inputs (no hash, 7 numeric compares per wall) | `viewer/src/systems/wall/level-miter-cache.ts` | No cache: an edit recompiles the whole building (about 15 ms) and then furnishes and checks it (50 to 70 ms in all) | **Adapt idea (done at the call level).** The studio tries candidate ops and commits the winner through the same call, which did the whole job twice. `applyArchOps` now answers an identical repeat on the same document from its last results. Measured: draw-room 135 to 71 ms and 111 to 62 ms (two buildings, median of 12 back to back runs), 44 to 47 % less |
| Skip a geometry rebuild when the node's build key is unchanged | `viewer/src/systems/geometry/geometry-system.tsx` (`GeometryBuildCacheEntry`) | `scene-sync.ts updateNode` compares the shape deeply; geometry is shared by generator output key (`RefCache`), generator outputs are an LRU of 256 | Skip: equivalent |
| Cutaway through material variants with a per-wall cache; camera thresholds 0.5 m and 0.3 m, 0.1 s throttle, 0.001 hysteresis | `viewer/src/systems/wall/wall-cutout-cache.ts` | `view/arch-view.ts`: 0.05 m camera threshold, hysteresis, a sectioned wall regenerates its geometry with a `cut` parameter | Skip: measured on skyline-penthouse, one full turn of the camera in cutaway makes 8 wall rebuilds and 32 geometry creations, and the GL geometry, texture and mesh counts stay flat over five turns (634 / 163 / 895), so there is no churn to remove |
| Level modes: Y offsets with a clamped smoothing step, `shadow-only` for hidden levels, level hold | `viewer/src/systems/level/level-system.tsx`, `lib/shadow-only.ts` | Matrix lift with a fixed-length animation; solo hides the other storeys (they no longer cast shadows) | Skip for speed (matrix-only in both). Quality note: a hidden storey that still casts its shadow keeps the lit look of the storey in view; not done here |
| Frustum and occlusion culling | three frustum culling; `frustumCulled = false` only on proxies and the dust pool | Frustum culling, per-field and per-group culling, virtual geometry (`virtual/`), LOD bias | Skip: Pascal has no occlusion culling either |
| Pointer picking: raycast result keyed by camera, ray, layers; accelerated raycast over the scene | `viewer/src/lib/pointer-events.ts`, `components/viewer/scene-bvh.tsx` (SAH, leaf 10) | `geometry/raycast-bvh.ts`: BVH built in a worker for large parts, allocation-free rays | Skip |
| CSG: one shared evaluator, bounds tree with leaf size 10, results cached per wall | `viewer/src/lib/csg-utils.ts`, `systems/wall/wall-cutout-cache.ts` | No CSG: openings cut analytically (`openingSpans`) | Skip: cheaper and exact |
| Merged outline for selection and hover: one pass, early-out on empty groups, private mask scenes, down-sampled mask | `viewer/src/lib/merged-outline-node.ts` | `view/highlighter.ts`: one `BoxHelper` per selected entity, refit when a frame is drawn | Skip: `BoxHelper.update` over a 600 object subtree costs 0.105 ms (node microbench), under 1 % of a frame; a screen-space outline would cost more |
| SSGI and AO with `sliceCount` 1, `stepCount` 4, no temporal filter; denoise; layer-masked scene pass; `?disable=ao,denoise,outline,postFx,draw` diagnostics | `viewer/src/components/viewer/post-processing.tsx`, `lib/layer-pass.ts` | AO at half resolution in the split chain, whole chain split by motion, tier ladder, frame-cost timers | Skip: ours is cheaper while moving; `?disable=` flags are covered by the `--rows` of `tests/e2e/default-perf.e2e.ts` |
| GPU timestamp queries and a perf panel | `viewer/src/components/viewer/perf-panel.tsx`, `lib/gpu-perf.ts`, `lib/perf-tracks.ts` | `gpu/frame-cost.ts`, `gpu/performance.ts`, the e2e harnesses | Skip: present |
| Shadow toggle through `renderer.shadowMap.enabled` (no program rebuild); one key light, frustum fitted to the building on an interval | `viewer/src/components/viewer/lights.tsx`, `index.tsx` | Sun maps planned once per tier, content-fitted, reused while the view moves (`gpu/sun-shadow-nodes.ts`) | Skip: present, and ours reuses the map |
| Shared cached materials flagged so disposal skips them; render-target owner disposes every pass; KTX2 with an RGBA fallback | `viewer/src/lib/dispose-object3d.ts`, `lib/post-processing-resources.ts`, `lib/ktx2-loader.ts` | `RefCache` with refcount disposal (geometries, materials, textures), KTX2 twins | Skip: measured no leak (five cutaway turns, counts flat) |
| Instanced pools (dust), `BatchedMesh` spike | `viewer/src/systems/construction-reveal/construction-dust.tsx`, `components/viewer/batched-mesh-spike.tsx` | Instanced fields, foliage atlases, particle pools in `vfx/` | Skip |
| Item model loading: retry 1 s and 3 s for network errors only, Meshopt and KTX2 | `nodes/src/item/model-loader.ts` | Asset cache, workers, decode off the page | Skip |
| Live drag state outside the store (`useLiveNodeOverrides`, `useLiveTransforms`); dirty marks refused for kinds without a consumer | `core/src/store/use-scene.ts` (`GuardedDirtySet`), viewer systems | Vanilla renderer driven by world diffs; no React in the hot path | Skip: it is a remedy for React and zustand costs we do not have |
| Headless capture without drawing (`disable=draw`, `disablePostFx`); notes that Chromium throttles rAF to 1 Hz when no frame is damaged | `viewer/src/components/viewer/frame-limiter.tsx`, `post-processing.tsx` | Bake and lightmap workers have their own render path | Skip; worth remembering if a headless run ever shows 1 Hz timers |

### What was changed

- `packages/arch/src/ops.ts`: `applyArchOps` keeps the last four results per world document (identity, ops serialised) and
  returns a copy of the arrays on a repeat. No render path, no lightmap key and no still is touched. Test:
  `packages/arch/test/ops-repeat.test.ts`.
- `tests/e2e/arch-view-perf.e2e.ts`: a new harness for the view modes (cutaway turns, exploded and solo toggles): `render()`
  JS time, wall rebuilds, geometry creations, GL geometry, texture and mesh counts, JS heap per turn. Counts that rise from
  turn to turn would show a disposal leak.

### What did not pay off

See the review log entry for the numbers: the cutaway wall regeneration, a graveyard for released geometries, the selection
box refit, the miter cache itself (Aether has no per-wall solver to cache), and GPU timings on a busy machine.

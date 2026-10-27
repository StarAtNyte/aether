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

# The Blender harness

How Aether makes things in Blender: worlds' pieces, props, buildings and characters, by the studio's assistant through
the local Blender bridge or by scripts in `scripts/blender/`. The principle is that the AI is the brain: it looks at what
it made, judges it against a reference, and fixes it; the checks (interpenetration, budgets, silhouettes) support that
judgement and never replace it.

Local only. The bridge is off by default, served under `/api/local/blender/*` on 127.0.0.1 with the session secret, never
on the paired bridge of hosted studios (the hosted site shows "Local run only"). Every action that runs code is planned
first and runs only after the user allows the exact code or command in the studio's dialog. Setup: `docs/DEPLOYMENT.md`
("Blender (optional, local only)").

## The method

One pass after another, each judged before the next starts. Every pass ends with pictures (Blender stills from fixed
cameras, then the same views in Aether) and a written critique; a change stays only if the pictures are better.

1. **Reference and brief.** What is being made, for whom, at what size: a short brief (real dimensions, the mood, the
   palette, the budget) and reference images. References are our own: generated concept art (marked as such, used as
   reference only) or the user's photos; never another studio's work to copy.
2. **Design document.** Before modelling: the elements with their real sizes and places, the palette with roles (key,
   shadow, accent), the lighting plan (sun direction and time, sky, practicals), the fixed QA camera list. Example:
   `docs/worlds/CLOUDWATCH_HARBOUR.md`.
3. **Light and colour first.** Sky, sun, exposure and the shading ramp on grey blockout forms. This pass is the baseline
   every later pass is compared against: if the light is wrong, detail will not save it.
4. **Materials.** The style's node materials (toon ramp or PBR), procedural variation (noise-broken albedo, brush strokes,
   wear), no external textures.
5. **Form.** The real geometry at real scale: a door is 2 m, a stair riser about 17 cm, a train car 20 m on its gauge.
6. **Lived-in detail.** What makes a place used: signs, wires with catenary sag, laundry, bicycles, pots, wear.
7. **Finishing.** Line art, glare, atmospheric perspective, the bake into web pieces, budgets.

Role passes. The same work is looked at in three roles, in this order, every pass:

- **Design**: does it read as the brief at a glance (silhouette, value structure, the palette's roles, composition from
  the QA cameras)?
- **Modelling**: is the form right (scale, proportion, topology, clean silhouettes in every view, no floating or sunk
  parts)?
- **Visual QA**: the pictures against the reference and the previous pass, harshly; the interpenetration check
  (`scripts/blender/cloudwatch/check_props.py` for placed props: each base touches what is under it within 3 cm, nothing
  sinks more than 3 cm into another; for characters, clothes against the body through the clip set); the budgets.

## The bridge's actions (studio assistant tools)

| Tool | Action | Runs code | What |
|---|---|---|---|
| `blender_scene_info` | `get_scene_info` | no | objects, sizes, positions of the user's open scene |
| `blender_look` | `look` | no | a picture of the scene (viewport, camera, angles) |
| `blender_python` | `execute_blender_code` | yes | Python in the user's Blender, in small steps |
| `blender_export_asset` | `export_glb` | yes | the scene or selection as a GLB, imported as a user asset |
| `blender_render` | `render` | yes | a Cycles render of the scene camera |
| `blender_bake` | `bake` | yes | a Cycles bake of one object into a texture |
| `character_create` | `character_create` | yes | the character pipeline from a brief (below) |
| `character_revise` | `character_revise` | yes | rebuild a character with notes |
| `character_review` | `character_review` | yes | the QA report and turnaround of a character |

The first six drive the user's own Blender through the MCP for Blender server. The character actions run a separate
headless Blender (`blender -b --factory-startup -P scripts/blender/character/build.py -- …`) in a folder per character
under the bridge's data folder (`<data>/blender/characters/<id>/`: `brief.json`, `sheet.png`, the GLB, `turnaround.png`,
`report.json`), so a revision and a review find the last build; they need Blender on the machine and the switch on, not
a running MCP session. Contracts: `packages/agent/src/bridge/blender-protocol.ts` (inputs, `CharacterBriefSchema`, the
run result's `glb`), `apps/bridge/src/blender/service.ts` and `characters.ts`, tools in `packages/agent/src/blender.ts`.

How the assistant should use them: write the brief and design first; build; look (`blender_look`, the turnaround a
character action returns); critique against the brief in the three roles; revise with specific notes; place the result
with `apply_patches` only when the review passes.

## Characters

The character pipeline turns a brief (and a concept sheet, generated by the local image backend when the brief comes
without one) into a rigged, animated, shaded character for the asset pipeline. Its first outputs are Kaho and Mio of
Cloudwatch Harbour's film and one character made from a brief alone.

Brief (`CharacterBriefSchema`): `id`, `name`, `style` (`anime` or `realistic`), `age`, `height_m`, `build` (`slim`,
`average`, `sturdy`), `head_ratio` (heads tall), `gender`, `skin`, `eyes`, `hair` (style from the hair library, colour,
length, parting, accessories), `outfit` (kit items with colours and parameters: pleat count and length, collar, ties,
shoes, bags, a watch), `notes`.

Stages (detail in `scripts/blender/character/`): a parametric base body (clean quads, subdivision; age, height, build,
head ratio, style) → face (for anime, normals transferred from an ellipsoid so the cel shadow on the face is clean;
eyes, brows and mouth painted) → hair from a library of sculpted clump styles with parameters → a clothing kit fitted to
the body with collision-aware offsets → the shared human skeleton (the `Bip01_*` Biped of `packages/render/src/characters`,
so the standard motion set and retargeting play unchanged) with weights and spring bones for hair, skirt and ties →
extra clips (look up, hand to chest, run stop, two fingers) → a shading preset (anime cel through the runtime's toon path,
two programs; or glTF PBR) → LODs → the GLB and its cast entry.

QA loop (`report.json`, iterated on failures where the pipeline can fix them): turnaround renders (front, side, back);
with a sheet, the silhouette IoU against it; proportions (head ratio, leg length); the palette against the brief's
colours; clothes against the body through sampled frames of the clip set; topology, triangle budget and weights (no
unweighted vertices, at most four influences).

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

The character pipeline turns a brief (and optionally a concept sheet) into a rigged, animated, shaded character for the
asset pipeline: `scripts/blender/character/`, Python modules run by a headless Blender. Its first outputs are Kaho and
Mio of Cloudwatch Harbour's film (installed as the cast's `kaho` and `mio`) and `harbour-fisherman`, made from a brief
alone. Everything is generated: no external models, textures, HDRIs or scans; the only input besides the brief is the
Biped's rest transforms read from the library bodies (`juno` for women, `marcus` for men).

### How to run

```
blender -b --factory-startup -P scripts/blender/character/build.py -- --brief <dir>/brief.json --out <dir> \
        [--sheet <dir>/sheet.png] [--revise <dir>/report.json] [--review]
```

Run it with the character's folder as the working directory; on a loaded machine wrap it as
`systemd-run --user --scope -p MemoryMax=8000M nice -n 10 blender …`. A build takes 20-30 s: up to three QA iterations
(about 8 s each) and the export. It writes in `<dir>`:

| File | What |
|---|---|
| `report.json` | the QA (below): `passed`, `issues[]`, the iterations' history and parameters |
| `turnaround.png` | front, her left side, back (orthographic, cel preview with outlines, the model-sheet stance) |
| `expressions.png` | the face through every morph |
| `silhouette.png` | with a sheet: our masks (blue) over the sheet's (red), per view |
| `<id>.blender.glb`, `<id>.meta.json` | the Blender export and its meta (springs, colliders, style) |
| `<id>.glb` | the runtime body, made by `scripts/characters/finish-character.ts` (`--install` when the brief says `"install": true`) |
| `<id>.lod1.glb` | the reduced level (decimated to 40 %, no morphs) |
| `<id>.blend`, `<id>.build.json` | the build, for `--review` (the QA again) and `--revise` |

`--revise` reads the brief's `revision_notes` and the last report's parameters and rebuilds. Notes are plain directives
a reviewer writes: "bigger eyes", "more hair volume", "longer skirt", "shorter hair", "slimmer", "wider shoulders",
"looser clothes", "fewer triangles", "taller" (and their opposites); anything else belongs in the brief itself (the
bridge's `character_revise` sends brief changes too).

The briefs of the first three characters are in `scripts/blender/character/briefs/`. Proof images:
`docs/screenshots/cloudwatch/character/kaho-vs-sheet.webp` (sheet, Blender and Aether from the same angles, close-ups of
every expression, her own clips and a run), `mio-turnaround.webp`, `harbour-fisherman-turnaround.webp`. The Aether shots
come from `STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/characters/kaho-shots.ts --body=<id> --out=<dir>
--only=turn,face,clips,run` and, in a run of its own, `--only=expressions` (see the limits below).

### Brief

`CharacterBriefSchema` (`packages/agent/src/bridge/blender-protocol.ts`): `id`, `name`, `style` (`anime` or
`realistic`), `age`, `height_m`, `build` (`slim`, `average`, `sturdy`), `head_ratio` (heads tall), `gender`, `skin`,
`eyes` (a colour, and words: "droopy" or "gentle", "narrow" pick the eye shape), `hair` (`style`: bob, long, ponytail,
short, bald; `colour`, `length` in metres from the crown, `parting` left/right/centre, `volume`, `accessories`: braid
with a `charm`, hairband, knit cap; `beard`), `outfit` (kit items with a `colour` and parameters: `pleats`, `length`
knee/mid-calf/long/mini, `sleeves` short/long, `lines` and `line_colour` of a sailor collar, `wrist` of a watch, `from`
of a bag strap, `sole_colour`), `notes` ("beauty mark" adds one), and the pipeline's own `install` and `look` (the cast
line). Colours are words or hex, the hex winning. Missing fields default from style, age and gender (an anime teen girl:
1.54 m, 6.5 heads).

### Stages

1. **Skeleton** (`skeleton.py`). The library Biped (hierarchy and rest rotations, exactly) with only joint offsets
   moved to the brief's landmarks: ankle, knee and hip heights (hip joint at 0.535 H for anime), chin and neck base from
   heads tall, the shoulder line and width, the hip width, arm segments (anime 0.145 / 0.115 / 0.09 H). Secondary bones
   (hair locks, braid, skirt panels, tie tails) get an identity world rest rotation, as the springs expect.
2. **Body** (`body.py`). One continuous quad mesh: a skin-modifier graph on the joints (torso from crotch to neck; legs
   with thigh, knee, calf and ankle profiles; feet with heel and ball; arms; hands with a palm, a knuckle bar and five
   three-segment fingers), subdivided twice, then shaped (buttocks, chest, the palm flattened in the hand's frame).
   Each vertex is labelled by its nearest limb segment: the regions garments and weights use.
3. **Face** (`face.py`). A quad sphere ray-marched onto a smooth union of forms (cranium, forehead, the face's cone to a
   soft chin, cheeks), subdivided and projected again, a nose bridge and tip pushed out, small ears. For anime the front
   takes its normals from an ellipsoid proxy (Data Transfer, weighted to fade at the jaw and temples), so the cel shadow
   crosses the face as one clean curve. Features are decals cast onto the face, with their own atlas cells and the
   proxy's normals: eyes (lids, layered iris, pupil, two catchlights, lashes with an outer flick, the crease), brows,
   nose, six mouths, blush, tears, marks. Morphs move decals: `smile`, `sad`, `surprised`, `teary`, `blink`,
   `mouth_open`, `determined`; a feature only an expression shows (an open mouth, the closed eye) is collapsed to a point
   at rest and opens in its morph.
4. **Hair** (`hair.py`). Clumps are lens-section locks lofted on the hair shell (the head pushed out by the volume),
   wide axis tangent to it, roots buried, falling with a flare to the style's tip; a cap under them closes the gaps; UV v
   follows height, so the strip's highlight band lines up into one ring (alpha 0.6: lit side only). Styles: `bob` (11
   locks with the inward curl, 7 bangs on the forehead, side-swept from a side parting, two side locks), `long` (13
   locks on three spring chains, a fringe, side locks), `ponytail`, `short`, `bald`; accessories: braid (nine
   alternating lobes on a two-bone chain, a bead and a ribbed seashell charm), hairband, knit cap; beard and moustache.
5. **Clothes** (`clothes.py`). Tight garments are cut from the body's own surface (by region), pushed out by ease and
   layer, cut with straight plane cuts at the hem and sleeve ends, solidified, and keep the body's weights vertex for
   vertex: blouse and T-shirt (a sailor blouse closes high under its collar), cardigan and jacket (open front, short or
   long sleeves), trousers, socks, boot shafts. The others are fitted by casting against the body: the pleated skirt
   (pleat count, real knife-pleat depth growing from the hips, an envelope hanging from the body's widest above each
   height, an A-line flare, 8 panel springs), the sailor collar (cut from the trunk's surface over the blouse: back
   flap and lapels by plane cuts, two lines near its edge), the neckerchief (knot and two tails on springs), loafers,
   sneakers and boots (lofted shells with soles, the loafer's strap), a watch on the back of the wrist, a bag strap
   across the body and its bag. Body faces under tight garments are removed (farther than 2-3.5 cm from an opening).
6. **Rig** (`rig.py`). Bone heat on a helper armature whose bones point at their child joints, two smoothing passes,
   hands, feet and neck kept to their own chains, at most four influences, normalized; garments keep the body's weights,
   other parts take them from the nearest trunk surface, the skirt blends from the pelvis into its panels.
7. **Clips** (`clips.py`): `look_up`, `hand_to_chest`, `two_fingers` (the right hand beside the face, a V), `run_stop`
   (replaces the shared one), keyed from the motion set's idle pose (sampled by `motion-poses.ts`) with world-axis
   turns, two-bone IK for the hands and finger curls. They are written into the file as glTF animations in the file's
   own rest frames, not through Blender's action export (Blender rolls some Biped bones differently).
8. **Shading** (`shading.py`). One 1024² atlas (flat swatches and the painted cells) whose alpha is the toon code;
   per-vertex `_TOON` (outline width, shade bias, rim): decals have no outline, the face a thinner one. Anime goes
   through finish-character's toon path (two programs); realistic keeps glTF PBR. The QA preview mirrors toon.ts in
   EEVEE: two tones split by the sun, the violet shadow, unshaded eyes, an inverted-hull outline.
9. **Export** (`export.py`). The glTF from Blender, then the patch (exact rest transforms, inverse bind matrices, the
   painted atlas with its alpha), the clips, `meta.json`, finish-character, the LOD.

### QA (report.json)

Each build is checked, and the loop rebuilds when it can correct something by itself (the body showing through a
garment: more ease; over the budget: one subdivision less), keeping the best-scoring build. The pictures still need an
art director's eye every pass; the checks support that.

- `silhouette_iou`: with a sheet, each view's mask against the sheet's figure (the background flooded from the border,
  guide lines removed by an opening, the three neighbouring views that match best), height-normalized and centred.
- `proportions`: heads tall against the brief, hip over height, leg length and shoulder width in heads.
- `palette`: each colour role's median rendered lit tone against the brief (CIE delta E), and with a sheet against the
  sheet's colour at the same place.
- `interpenetration`: the skin under each garment (well inside it: tilted rays hit it too) through sampled frames of
  walk, run, sprint, sit, crouch, jump, wave, pickup and the character's own clips; a vertex counts when the garment is
  no longer above it within its rest distance plus 1.5 cm. Skirt panels are first pushed out of the thigh capsules as
  the runtime springs do, and the skirt is checked through locomotion only.
- `weights` (unweighted, over four influences, not normalized), `topology` (triangles, open edges, loose vertices,
  morphs), `triangles` (anime 30-60 k), `bytes`, `lods`, `clips`, `skeleton`.

The first builds (November 2026):

| | Triangles | GLB | LOD1 | IoU vs sheet (front / side / back) | Palette dE | Interpenetration (worst frame) |
|---|---|---|---|---|---|---|
| kaho | 58,160 | 908 KB | 23,263, 467 KB | 0.66 / 0.76 / 0.66 | ≤ 0.4 vs brief; 2-5 vs sheet (hair, skin, blouse, skirt, collar) | blouse 0 %; skirt 63 % of the checked thigh vertices (sprint) |
| mio | 57,516 | 897 KB | 23,005, 462 KB | no sheet | ≤ 0.5 | T-shirt, cardigan 0 %; skirt 56 % (sprint) |
| harbour-fisherman | 54,100 | 846 KB | 21,639, 436 KB | no sheet | ≤ 0.6 (hair 5.8) | T-shirt 10 % at 10 mm (run); jacket 6.6 % |

Known limits: the silhouette IoU stays near 0.7 (the sheet's fuller skirt and hair, its legs apart); in sprint frames
the thighs come through the skirt (8 panels swinging at most 0.6 rad); faint decal rectangles show where the cel
terminator crosses an eye or the mouth; hands are simple (no nails; the thumb is a plain chain); the clumps have no
inner strands; expressions set right after a one-shot clip did not take in the proof run (the rig eases them only at
the near level of detail), so take the expression shots on their own.

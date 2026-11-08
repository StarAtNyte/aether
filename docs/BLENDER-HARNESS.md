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
| `building_create` | `building_create` | yes | the building kit from a brief (below) |
| `building_revise` | `building_revise` | yes | rebuild a building with notes |
| `building_review` | `building_review` | yes | the QA report and stills of a building |

The first six drive the user's own Blender through the MCP for Blender server. The character and building actions run a separate
headless Blender (`blender -b --factory-startup -P scripts/blender/character/build.py -- …`) in a folder per character
under the bridge's data folder (`<data>/blender/characters/<id>/`: `brief.json`, `sheet.png`, the GLB, `turnaround.png`,
`report.json`), so a revision and a review find the last build; they need Blender on the machine and the switch on, not
a running MCP session (buildings likewise in `<data>/blender/buildings/<id>/`: `brief.json`, `report.json`, `stills.png`,
the GLBs). Contracts: `packages/agent/src/bridge/blender-protocol.ts` (inputs, `CharacterBriefSchema`,
`BuildingBriefSchema`, the run result's `glb`), `apps/bridge/src/blender/service.ts`, `characters.ts` and `buildings.ts`,
tools in `packages/agent/src/blender.ts`.

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
| `<id>.lod1.glb` | the reduced level (decimated to 40 %, no morphs); installed with the body as `c/<id>.lod1.<hash8>.glb`, recorded in `ORIGINAL_LODS` (`original.ts`) |
| `<id>.blend`, `<id>.build.json` | the build, for `--review` (the QA again) and `--revise` |

`--revise` reads the brief's `revision_notes` and the last report's parameters and rebuilds. Notes are plain directives
a reviewer writes: "bigger eyes", "more hair volume", "longer skirt", "shorter hair", "slimmer", "wider shoulders",
"looser clothes", "fewer triangles", "taller" (and their opposites); anything else belongs in the brief itself (the
bridge's `character_revise` sends brief changes too).

The briefs of the first three characters are in `scripts/blender/character/briefs/`. Proof images:
`docs/screenshots/cloudwatch/character/kaho-vs-sheet.webp`, `mio-vs-sheet.webp`, `harbour-fisherman-vs-sheet.webp` (sheet, Blender from the same angles, silhouettes; first round also Aether close-ups of
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
   takes its normals from an ellipsoid proxy (Data Transfer, weighted to fade at the jaw and temples), and the face is
   lit as one shape: a per-vertex shade bias (`_TOON` y, added to N.L) of +0.55 over the face keeps it in the lit band
   unless the light comes from well behind its side, fading to the head's 0.1 at the jaw, temples and hairline; a band
   under the bangs (its lower edge in points), the underside of the jaw and the front of the neck under the chin take a
   negative bias, so those soft shadows come first; no rim over the face. Features are decals cast onto the face, with
   their own guttered atlas cells (6 px of edge colour round each, so filtering and mip levels never pull a neighbour
   in) and the head's final normals and bias interpolated under them, so their skin margins shade exactly like the skin
   around: eyes (lids, layered iris, pupil, two catchlights, lashes with an outer flick, the crease), brows,
   nose, six mouths, blush, tears, marks. Morphs move decals: `smile`, `sad`, `surprised`, `teary`, `blink`,
   `mouth_open`, `determined`; a feature only an expression shows (an open mouth, the closed eye) is collapsed to a point
   at rest and opens in its morph.
4. **Hair** (`hair.py`). Clumps are lens-section locks lofted on the hair shell (the head pushed out by the volume),
   wide axis tangent to it, roots buried, falling with a flare to the style's tip; a cap under them closes the gaps; UV v
   follows height, so the strip's highlight band (a clean arc per clump, alpha exactly 0.6: the toon shader shows it on
   the lit side only) lines up into one ring; black hair gets a cool sheen down each clump's middle instead of darker
   edges. Styles: `bob` (13 locks with the volume at the crown and cheeks, tapering to a rounded, turned-in end; five
   large pointed bangs, side-swept from a side parting; two side locks), `long` (two layers of clumps, 15 and 14, with
   pointed ends at staggered lengths, on three spring chains; a soft fringe of nine rounded locks; side locks),
   `ponytail`, `short`, `bald`; accessories: braid (nine
   alternating lobes on a two-bone chain, a bead and a ribbed seashell charm), hairband, knit cap; beard and moustache.
5. **Clothes** (`clothes.py`). Tight garments are cut from the body's own surface (by region), pushed out by ease and
   layer, cut with straight plane cuts at the hem and sleeve ends, solidified, and keep the body's weights vertex for
   vertex: blouse and T-shirt (a sailor blouse closes high under its collar), cardigan and jacket (open front, short or
   long sleeves), trousers, socks, boot shafts. The others are fitted by casting against the body: the pleated skirt
   (knife pleats: each pleat's face steps out across its width, 1.7 cm at the hem, and folds back under the next, the
   fold its own dark texels and each face shaded toward its tucked end with a light line on its folded edge; an
   envelope hanging from the body's widest above each height, then an A-line, the straight line from the waist that
   clears the hips and thighs, flaring at a quarter of that below the knee; 12 panel springs), the sailor collar (its
   back flap kept inside the shoulder line; cut from the trunk's surface over the blouse: back
   flap and lapels by plane cuts, two lines near its edge), the neckerchief (knot and two tails on springs), loafers,
   sneakers and boots (lofted shells with soles, the loafer's strap), a watch on the back of the wrist, a bag strap
   across the body and its bag. Body faces under tight garments are removed (farther than 2-3.5 cm from an opening).
6. **Rig** (`rig.py`). Bone heat on a helper armature whose bones point at their child joints, two smoothing passes,
   hands, feet and neck kept to their own chains, at most four influences, normalized; garments keep the body's weights,
   other parts take them from the nearest trunk surface. The skirt blends from the pelvis into its panels, and below the
   hips its front and back mostly follow the thighs (up to 97 % at the front and back, 58 % at the sides; crossfaded
   between the legs in the middle, narrowly for a knee-length skirt, widely for a long one), so a striding, running or
   climbing leg carries the cloth instead of cutting through it; below the knee a long skirt hands part of that to the
   calves (more at the back, where a heel kicks up). The panels' springs swing at most 0.75 rad at the sides and 1.35
   rad at the front and back. The bag strap is kept clear of everything under it and takes the body's own weights.
7. **Clips** (`clips.py`): `look_up`, `hand_to_chest`, `two_fingers` (the right hand beside the face, a V), `run_stop`
   (replaces the shared one), keyed from the motion set's idle pose (sampled by `motion-poses.ts`) with world-axis
   turns, two-bone IK for the hands and finger curls. They are written into the file as glTF animations in the file's
   own rest frames, not through Blender's action export (Blender rolls some Biped bones differently).
8. **Shading** (`shading.py`). One 1024² atlas (flat swatches and the painted cells) whose alpha is the toon code;
   per-vertex `_TOON` (outline width, shade bias, rim): decals have no outline, the face a thinner one. Anime goes
   through finish-character's toon path (two programs); realistic keeps glTF PBR. The QA preview mirrors toon.ts in
   EEVEE: N.L against the preview sun plus the shade bias, banded smoothstep(-0.02, 0.04) like the runtime, the violet
   shadow, unshaded eyes, an inverted-hull outline.
9. **Export** (`export.py`). The glTF from Blender, then the patch (exact rest transforms, inverse bind matrices, the
   painted atlas with its alpha), the clips, `meta.json`, finish-character, the LOD.

### Reading the sheet (sheet.py)

`sheet.py` (pure numpy, so it runs in Blender and in plain Python) reads a turnaround twice: before modelling, for what
the build fits to it (`spec['sheet_fit']`), and after, for the QA.

- **Segmentation is edge-based.** A pale figure on a pale ground (Mio's mint cardigan, beige skirt and white sneakers
  on light grey) has interiors of the ground's colour, but its line art closes them: the figure is what the ground
  cannot flood from the border without crossing an edge (Sobel on luminance, red and blue) or an off-ground pixel. The
  sheet's guides go first (long thin runs with ground on both sides, dashed rows by their coverage), pockets of plain
  ground enclosed by an arm stay background, and each figure is a connected component (the head-unit ruler and the
  labels are told apart by height, colour and area). Mio's IoU went from an unreadable 0.60 to 0.87.
- **Fitted before modelling:** the skirt's extent by height in each view, by its colour (nearer it than any other
  garment's or the skin's; an arm or a bag over it does not cut the run short, the wider side counts, the hem's pleat
  points trimmed), so the skirt's outer pleat faces lie on the ellipse through the sheet's front half-width and side
  half-depth at every height, and its hem is the sheet's; each outer garment's hem (`garment_hem`: the lowest height its
  colour shows beside the middle); the eyes' iris and dark colours, which the eye painting takes.
- **Corrected in the loop** (`sheet_corrections`), each by the measured ratio: the face template's jaw key (the face's
  half-width between mouth and chin), the fringe's length (the hairline), the hair's volume (its outer width at the
  cheeks).

### QA (report.json)

Each build is checked, and the loop rebuilds when it can correct something by itself (the body showing through a
garment: more ease; over the budget: one subdivision less; the sheet corrections above), up to four iterations
(`AETHER_CHARACTER_ITERATIONS`), keeping the best-scoring build. The pictures still need an art director's eye every
pass; the checks support that.

- `silhouette_iou`: with a sheet, each view's mask against the sheet's figure (sheet.py's edge-based segmentation),
  height-normalized and centred, our model in the sheet's stance (arms down, the feet a little apart).
- `colour_regions`: each view in a 12 x 4 grid of the figure's bounds, per cell our median colour against the sheet's
  (CIE delta E), rendered with the preview sun turned with each camera, as a model sheet is lit; a cell far off is a
  wrong colour role, a missing part or a part in the wrong place. Flagged over a mean of 12.
- `features`: the eyes, the mouth and the hairline found by the same detector on the sheet's front view and on ours, and
  the jaw's, chin's and hair's widths; differences in head heights, flagged over 0.06 (the eye blob's size is reported,
  not judged: it follows the painting's darks).
- `proportions`: heads tall against the brief, hip over height, leg length and shoulder width in heads.
- `palette`: each colour role's median rendered lit tone against the brief (CIE delta E), and with a sheet against the
  sheet's colour at the same place.
- `interpenetration`: the skin under each garment (well inside it: tilted rays hit it too) through sampled frames of
  walk, run, sprint, sit, crouch, jump, wave, pickup and the character's own clips; a vertex counts when the garment is
  no longer above it within its rest distance plus 1.5 cm. For the skirt a thigh vertex counts when the cloth lies
  between it and the thigh bone (the leg crossed it; a thigh leaving under the hem does not count). Skirt panels are
  first pushed out of the thigh capsules as the runtime springs do, within their swing limit, and the skirt is checked
  through locomotion only. `through` lists the frames over 0.5 %. The loop adds ease only when a tight garment fails.
- `weights` (unweighted, over four influences, not normalized), `topology` (triangles, open edges, loose vertices,
  morphs), `triangles` (anime 30-75 k: the hair's strands, the finer jaw line, knit and pleat detail; the far level
  carries 40 %), `bytes`, `lods`, `clips`, `skeleton`.

The builds (November 2026; the first ones in brackets):

| | Triangles | GLB | LOD1 | IoU vs sheet (front / side / back) | Palette dE | Interpenetration (worst frame) |
|---|---|---|---|---|---|---|
| kaho | 65,736 (58,160) | 1,060 KB | 26,294, 555 KB | 0.86 / 0.88 / 0.85 (0.66 / 0.76 / 0.66) | regions 10.2 | blouse 0 %; skirt 16 % in a jump (17.7 mm), locomotion clean |
| mio | 73,948 (57,516) | 1,204 KB | 29,579, 622 KB | 0.87 / 0.89 / 0.86 (0.60 unreadable) | regions 12.2 | T-shirt, cardigan 0 %; skirt 19 % in a jump |
| harbour-fisherman | 59,904 (54,100) | 952 KB | 23,960, 501 KB | 0.85 / 0.70 / 0.85 (no sheet) | regions 10.6 | T-shirt 10 % at 4.8 mm (run); jacket 4.9 % |

What changed in the pipeline with these builds (November 2026, second round): the sheet reading above; the skirt fitted
per view (Mio's no longer flares; its springs' radii cut to what clears the legs at rest, so a slim skirt hangs still);
a buttoned cardigan (a V by plane cuts, buttons, patch pockets, a ribbed hem and cuffs) worn over the skirt, which is
built first; an open front by plane cuts (the jacket); work trousers that hang straight; sneakers with laces, a rubber
toe cap and a striped sole, painted uppers (a loafer's gloss and apron seam); a flap bag with a buckle at the front of
the hip; the hair built after the clothes (long hair falls over the cardigan and the strap), strands at each lock's
edges ending above it, strand lines in the clump texture, a hairband that lies on the hair, seven bangs and thin points
between them for a bob, the braid out over the side hair; the eyes in layers (a deep top band, fibres, a lit lower
crescent, the limbal ring, two catchlights and a reflected arc, a heavy upper lash with three points); a finer head
mesh and the face template's keys; a bigger neckerchief with a fold; a rounded knit cap with a rolled cuff and a short
beard. The proof images (`*-vs-sheet.webp`: sheet, Blender cel preview, silhouettes, expressions) are Blender's; the
Aether frames of the first round were not retaken.

About a third of the IoU gain is the mask fix (the sheet's gap between the legs), the rest the model: the A-line skirt,
narrower shoulders, the fuller bob, the stance.

Known limits: a slim skirt fitted to its sheet lets a jumping thigh through its front (16-19 % of the checked thigh
vertices in `jump_air`; locomotion is clean); the skirt following the thighs reads a little like culottes in a sprint;
hands are simple (no nails; the thumb is a plain chain) and spread in the sheet stance; the fisherman's side view is
narrower than his sheet's stooped, boxy jacket (IoU 0.70) and his jacket has no collar; a sheet's hairline is read
where its fringe stops, so a long fringe over the eyes (Kaho's) reads as a lower hairline than ours;
expressions set right after a one-shot clip did not take in the proof run (the rig eases them only at the near level of
detail), so take the expression shots on their own.

### The far level at runtime

`CharacterSystem` loads a body's far level beside it (`farLevelOf(body)`: the cast entry's `lod1`, or `ORIGINAL_LODS`
for the project's own bodies; any pipeline character with `--lod1` gets it) and `attachFarLevel` (`packages/render/src/
characters/lod.ts`) moves its meshes into the body: under the same armature node, bound to the body's own skeleton (one
bone palette when the bind matches) and drawn with the body's own materials, so the tint and the toon pair are shared
and no program is linked for it. `BodyLevels` switches by the body's height on screen (CSS px): to the far level under
140 px, back over 175 px; a camera cut snaps, a body walking away cross-fades over 0.3 s of simulation time through a
complementary screen-space dither (the toon materials' `maskNode`, a per-object uniform; other materials switch at the
threshold). A far body casts its far level into the sun's map (on the scatter fields' stand-in layer,
`FIELD_SHADOW_LAYER`, the near level skipped there); a near body casts its full mesh, since the far one shadowing the
full surface it does not quite match speckled her hair with self-shadow. No morphs at the far level, so no expressions under 140 px.
`CharacterSystem.setFarLevels(false)` turns it off (A/B); `scripts/character-lod-probe.ts` measures both. The Rocketbox
cast has no far levels (its entries carry no `lod1`), so it is unchanged.

Measured over the whole of "Two Whistles" (Intel, WebGL2, 1600x900; the hosted cook was being refreshed, so the live
world; a loaded machine, so read the GPU times as a trend): off / on, the people's triangles in the view 157,938 /
124,057 a frame on average, in the sun's map 67,914 / 58,469; GPU time mean 16.4 / 15.4 ms, p95 20.8 / 17.7 ms; at least
one body at its far level in 94 % of the frames; no program linked in either pass. Kestrel Outpost (cooked): its one
person is a Rocketbox body, no far level, nothing changes.

## Buildings

The building kit turns a brief into a detailed, worn, checked house or shop: `scripts/blender/building/`, Python modules
run by a headless Blender, the same method as the characters (brief, light and colour, materials, form, lived-in detail,
finishing; design, modelling and visual QA passes). Everything is generated: no external models, textures or HDRIs (the
signs use Blender's built-in font as mesh). Its first use is Cloudwatch Harbour: the houses the film's shots come close
to are kit buildings (below).

### How to run

```
blender -b --factory-startup -P scripts/blender/building/build.py -- --brief <dir>/brief.json --out <dir> \
        [--revise <dir>/report.json] [--review] [--no-export] [--size 900x700]
```

A build takes 10-30 s on the RTX 4090 (the geometry under a second, the stills, the albedo bake on the GPU, on the CPU
when the GPU is busy). It writes in `<dir>`:

| File | What |
|---|---|
| `report.json` | the QA (below): `passed`, `issues[]`, `triangles` against the tier's budget, the contact rows, the fixes, history |
| `stills.png` | front, three-quarter from above, street eye level (1.5 m, close, looking up the facade); also each alone |
| `<id>.glb` | LOD0: one atlas with the painted albedo and its wear baked in, emissive windows and lamps kept emissive |
| `<id>.lod1.glb` | LOD1: collapse-decimated to 40 % on the same atlas |
| `<id>.blend` | the build, for `--review` (stills again) and `--revise` |

`--revise` reads the brief's `revision_notes`: "more wear" / "newer", "taller" / "lower", "steeper roof" / "flatter
roof", "deeper eaves", "more balconies" / "no balconies", "more plants", "more lit windows", "fewer triangles" (a tier
down) / "more detail", "shutters", "grilles", "plain windows", "add a stair" / "no stair", "another seed". The example
briefs are in `scripts/blender/building/briefs/` (a corner shop, an L-shaped terrace house with a stair, a three-storey
flat-roofed block, a realistic plaster house).

### Brief

`BuildingBriefSchema` (`packages/agent/src/bridge/blender-protocol.ts`): `id`, `name`, `style` (`anime`: Cloudwatch's
painted toon materials, so a kit building sits in that world and its bake; `realistic`: PBR), `kind` (`simple`, `L`,
`stepped`: a set-back upper storey over lean-to roofs, `flat`: concrete with a parapet and a stair house, `narrow`,
`shop`), `footprint` {w, d} in metres (the town passes its lots instead), `storeys`, `roof` {type: gable, hip, irimoya,
shed, flat; `pitch_deg`, `eaves_m`, `verge_m`, `axis`}, `palette` (a preset or {wall, wall2, trim, roof, accent}),
`wear` (0-1), `seed`, `detail` (`hero`, `mid`, `far`: what is modelled and the triangle budget, 16 k / 7 k / 3.5 k),
`budget_tris`, `features` {balconies, stair, shop_front, ac_wall, ac_ground, meters, plants_door, plants_balcony,
signage, window_style, lit, two_tone, corner_boards, door_wood, pent_roofs, gear}, `notes`.

### Stages

1. **Light and colour** (`render.py`). For `anime` Cloudwatch's own sun lamp and physical sky (`sky.build_light`), for
   `realistic` a higher sun on the same sky. The outline is a separate linked object that casts no shadow: a shell on
   the building itself shadowed every wall in EEVEE.
2. **Materials** (`materials.py`). One material per role (wall, cladding, trim, tile, ridge, glass, lit glass, sash,
   frosted panel, shutter, metal, rail, outdoor unit, pot, leaf, ...): toon (`common.toon_material`: the shared ramp,
   brush strokes, haze; tile rows and joints as stripes) or Principled. Wear goes into every albedo before its `ALBEDO`
   reroute (what the bakes read): the vertex attribute `bk_grime` times a streaky noise darkens toward a cool grey, and
   `bk_moss` with a patch noise greens the roof.
3. **Form** (`house.py`, `roofs.py`, `facade.py`). Massing from the kind; roofs: a sheathing slab with fascia and barge
   boards, real tile courses (wedges standing 3.8 cm off the course below, clipped by the hips), round-nosed eave tiles
   on hero, a layered ridge with end tiles, hip caps, half-round gutters; then the facade plan: every opening and
   fitting is placed on its wall as a rectangle before anything is built (door, shop bays, balconies, the stair's
   landing door, downpipes at the gutter ends, wall units, meters, pent roofs, then windows storey by storey in what is
   left, a smaller window where a big one will not fit). Walls are grids of quads cut around the openings, so each
   opening is a hole with a reveal (12 cm for windows, 30 cm for the porch): two sliding sashes on two tracks with
   their meeting stiles, sills with a drip, head flashings, storm-shutter boxes on rails, lattice grilles of real bars,
   hoods on brackets, bamboo blinds, curtains and a sky sheen on the glass; the genkan's sliding doors (frosted glass in
   a lattice, a transom) with a step, a lamp, a name plate and intercom, a mailbox, under a hood or a tiled pent roof;
   shop fronts (a lit glazed bay with mullions, a roll-up shutter in guides under its box, an awning, a noren);
   balconies (slab, drip line, posts, rails and balusters or a solid parapet; the sliding door onto it); external
   steel stairs (channel stringers, treads with nosings, a landing on a post, railings).
4. **Lived-in detail** (`lived.py`). Outdoor units on wall brackets, on balcony floors and on ground pads, each with its
   pipe cover to a wall cap; downpipes with an offset bend to the wall, brackets every 1.6 m and a shoe; gas and
   electricity meters with the gas riser and the conduit to the eaves; potted plants (shrub, tall, flowering) by the
   door and on balconies; signboards; roof antennas (on their own; the town places its own roof gear). Wear on the
   mesh: grime at the wall foot (splash) and under the eaves (soot), streak quads under the sills in the wall's own
   material, darkened at the top and fading out, moss on the low courses of the slopes turned from the sun.
5. **Finishing** (`qa.py`, `export.py`). The QA, the stills, the albedo bake and the LODs.

### QA (report.json)

The interpenetration check is the prop gate's rule, shared (`scripts/blender/contact.py`, also used by
`cloudwatch/check_props.py`): every fitting is a part (`kit.K.part`) with a support. A standing part's base (within 2
cm of its lowest point) must touch the body (walls, roofs, slabs) or the ground within 3 cm, with the prop gate's slope
allowance; a hanging part's back must touch its wall within 3 cm; no vertex of a part may lie more than 3 cm behind the
body's surface or another part's. The loop fixes what it can: a part off its support by under 30 cm is moved onto it, a
part sunk into another is removed, and dressing that still fails (a pipe cover, a pot, a conduit) is removed; each fix
is listed. Over the triangle budget the build is redone a tier lower. `triangles`, `materials` (draws before the
export merges them), `windows`, `balconies`, `height_m` complete it. The stills still need an art director's eye every
pass.

### Cloudwatch Harbour

`town.py` builds the houses the film's shots come close to with the kit: `building/hero_shots.py` casts a grid of rays
from every story camera (`camera`, `cameraTo` and `via` poses of `story.ts`) into the built world and lists each house's
largest screen share. Nine at the hero level (`KIT_HERO`: the five walls behind Mio's train window, the crossing's
houses, the shrine's neighbour, the corner shop) and eight at the mid level (`KIT_MID`: shares of 3.5-12 %, the views
over the town from the stair) come from the kit with the town's palettes, lots, gaps and stair sides; the other 51
keep `town.house` (40 m and more away in every shot). Nothing inside an opening (reveals, sashes, glass, door leaves)
gets an outline shell: it is seen only through the hole, and the shells were a third of the kit's triangles. Kit houses carry `kit: True` in `HOUSES`, so the prop pass
(`detail.py`) leaves their outdoor units and pots to the kit and still hangs laundry on their balconies; the shop records
its bays, and the banners stand in front of the glazed one. The bake gives the kit houses more texels: the face
attribute `cw_texel` (2 on hero, 1.4 on mid) scales their UV islands before the pack (`bake_export.texel_density`).
Story stills from the .blend or the baked pieces: `cloudwatch/story_stills.py --cams <cams.json>`.

Result (8 November 2026; before/after: `docs/screenshots/cloudwatch/before-after/20-buildings-blender.webp`, the film's
cameras in Blender, and `21-buildings-aether.webp`, the same shots in Aether on the Intel GPU):

| | Before | After |
|---|---|---|
| houses from the kit | 0 | 17 (9 hero, 8 mid), 71 k triangles, every fitting within 3 cm (3 fixes by the loop) |
| `town.glb` | 10.5 MB, 169 k triangles | 13.2 MB, 237 k triangles (+2.7 MB: the geometry of real openings, tiles and fittings; the atlas stays 4096 px) |
| `props.glb`, `laundry.glb`, `trees.glb` (re-baked: the prop pass places by the houses) | 4.94 MB, 234 KB, 666 KB | 4.58 MB, 205 KB, 665 KB |
| Intel GPU over the whole film | p50 16.8 ms, p95 25.7 ms | p50 16.7 ms, p95 17.5 ms, no frame over 50 ms, no program linked during the film |
| prop gate (`check_props.py`) | 78 props, 0 failed | 77 props, 0 failed |

Known limits: the far houses (51) are still `town.house`; a kit house is one object per house in one shared atlas, so
its painted wear is bounded by the town's texel density (twice the rest on hero); the standalone GLB's LOD1 is a plain
collapse decimation (no seam protection); a service wire is drawn only when a pole point is given (the town's poles are
placed after the houses, so its kit houses have the conduit and bracket but no drop); the town's EEVEE stills still
shadow their own outlines (the kit's stills draw the outline as a separate object); thin letters of baked signs (an I,
a T) fall below a texel and take the palette band's single colour, so they can vanish. The town atlas now keeps 64
palette rows (59 k thin islands; it was 32).

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
| `<id>.lod1.glb` | the reduced level (decimated to 40 %, no morphs); installed with the body as `c/<id>.lod1.<hash8>.glb`, recorded in `ORIGINAL_LODS` (`original.ts`) |
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

### QA (report.json)

Each build is checked, and the loop rebuilds when it can correct something by itself (the body showing through a
garment: more ease; over the budget: one subdivision less), keeping the best-scoring build. The pictures still need an
art director's eye every pass; the checks support that.

- `silhouette_iou`: with a sheet, each view's mask against the sheet's figure (guide and floor lines removed by an
  opening first, then the background flooded from the border, so the gap between the legs stays background; the three
  neighbouring views that match best), height-normalized and centred, our model in the sheet's stance (arms down, the
  feet a little apart).
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
  morphs), `triangles` (anime 30-60 k), `bytes`, `lods`, `clips`, `skeleton`.

The builds (November 2026; the first ones in brackets):

| | Triangles | GLB | LOD1 | IoU vs sheet (front / side / back) | Palette dE | Interpenetration (worst frame) |
|---|---|---|---|---|---|---|
| kaho | 57,392 (58,160) | 945 KB | 22,956, 481 KB | 0.82 / 0.77 / 0.85 (0.66 / 0.76 / 0.66) | ≤ 0.4 vs brief | blouse 0 %; skirt 0.5 %, 1.9 mm (sprint) (first: 63 % by the old test) |
| mio | 59,644 (57,516) | 1,000 KB | 23,857, 513 KB | no sheet | ≤ 0.5; hair 9.2 (the sheen on black) | T-shirt, cardigan 0 %; skirt 6.6 % (walk) |
| harbour-fisherman | 54,032 (54,100) | 856 KB | 21,612, 439 KB | no sheet | ≤ 0.6 (hair 5.8) | T-shirt 10 % at 4.8 mm (run); jacket 3.8 % |

About a third of the IoU gain is the mask fix (the sheet's gap between the legs), the rest the model: the A-line skirt,
narrower shoulders, the fuller bob, the stance.

Known limits: Mio's long skirt still lets a striding shin touch its front in some walk frames (6.6 % of the checked
thigh vertices), and a sprinting hand dips into Kaho's skirt at the hip; the skirt following the thighs reads a little
like culottes in a sprint; hands are simple (no nails; the thumb is a plain chain); the clumps have no inner strands;
expressions set right after a one-shot clip did not take in the proof run (the rig eases them only at the near level of
detail), so take the expression shots on their own.

The far level of detail is installed but not loaded yet. The runtime can pick `ORIGINAL_LODS[id].file` (the same skeleton,
clips, springs and toon extras; no morphs, so no expressions) when the body is beyond the rig's near distance or under
about 150 px tall on screen, and swap back with some hysteresis.

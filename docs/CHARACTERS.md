# Characters: the human cast and its motions

People in a world (the player's body, NPCs, bystanders) are rigged, skinned
and animated humanoid bodies from a small baked library. The runtime never
reads a source file: it loads glTF files built offline by
`scripts/characters/build.ts`, with checksums recorded next to them.

## Source and licence

| Item | Source | Licence |
| --- | --- | --- |
| 10 adult bodies | [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox), commit `0943055db6ec570bcef9f2c8b41c9e5467c808f9`, `Assets/Avatars/Adults/<name>/Export/<name>.fbx` | MIT, © 2020 Microsoft |
| 57 motion clips per gender | Same repository, `Assets/Animations/all_animations_max_motextr_{static,xy,xyz}/` | MIT, © 2020 Microsoft |
| 10 clips per gender | Keyframed in `scripts/characters/authored.ts` | MIT (this project) |
| Toon bodies `kaho`, `mio` | Built by the Blender character pipeline `scripts/blender/character/` (mesh, painted face, hair, clothes and every colour generated there; only the Biped's rest transforms are read from `juno`) | MIT (this project) |

The repository's `LICENSE.md` is copied unchanged to
`assets/characters-LICENSE.md` by the build. The in-app credit line and the
full MIT notice (`ROCKETBOX_NOTICE`) live in
`packages/assets/src/characters/credits.ts`; `characterCredit(ids)` lists the
cast members a world uses. No Mixamo or other restricted-licence character or
animation is used (see docs/THIRD_PARTY.md).

## The cast

Defined in `scripts/characters/cast.ts` (`CAST_SOURCES`); hand-kept traits
(age, skin, wardrobes, matching words) are in `CAST_TRAITS` in
`packages/assets/src/characters/library.ts`.

| id | Rocketbox body | Height (m) | Look |
| --- | --- | --- | --- |
| marcus | Male_Adult_03 | 1.807 | older man, grey hair, grey jacket |
| dario | Male_Adult_04 | 1.869 | young man, dark curly hair, dark hoodie |
| tomas | Male_Adult_05 | 1.812 | man in a green jacket and tan vest |
| felix | Male_Adult_06 | 1.831 | young man, red sweater |
| kofi | Male_Adult_12 | 1.807 | man, denim jacket and white shirt |
| walter | Male_Adult_14 | 1.796 | balding middle-aged man, grey shirt, khakis |
| sophie | Female_Adult_02 | 1.735 | woman, white blouse and skirt |
| edith | Female_Adult_04 | 1.766 | older woman, brown jacket and trousers |
| rosa | Female_Adult_11 | 1.736 | woman, brown dress and boots |
| juno | Female_Adult_17 | 1.751 | blonde woman, green top and jeans |

`resolveLook` (`looks.ts`) picks a body for a `CharacterSpec` deterministically
from a seed (the entity id): an explicit `body` wins, otherwise gender, age and
wardrobe narrow the cast and the seed chooses, preferring bodies not already
used nearby. `lookFromText` reads a phrase into a spec.

## Skeleton and scale

Every body uses the same 80-bone 3ds Max Biped skeleton (`Bip01`,
`Bip01_Pelvis`, `Bip01_Spine` .. `Bip01_Spine2`, `Bip01_Neck`, `Bip01_Head`,
`Bip01_L_Clavicle`, `Bip01_L_UpperArm`, `Bip01_L_Forearm`, `Bip01_L_Hand`,
`Bip01_L_Thigh`, `Bip01_L_Calf`, `Bip01_L_Foot`, `Bip01_L_Toe0`, the `R_`
mirror, and fingers `Bip01_<side>_Finger<0..4>[1|2]`, 0 = thumb). Rocketbox
centimetres are converted to metres. Each body records its standing height
(bind-pose bounding box), hip height (root bone) and facing (`faces`, +1 when
the mesh faces +Z).

Clips are rotation tracks per bone plus a `Bip01` translation track. Face
bones (eyes, brows, mouth, jaw and so on) are never baked. For the root, the
straight-line planar drift is removed and reported as the clip's `stride`
(m/s); sway and height are kept. Keys are reduced greedily and rotations are
stored as normalised int16. Gait clips also record foot contacts
(`[phase, foot]`).

Both motion sets are authored on the first cast body's skeleton; the male set's
reference hip is 0.895 m, the female set's 0.919 m. At runtime the rig scales
the root's height by `body hip / motion hip`, and `look.scale` scales the
whole body.

`packages/assets/src/characters/retarget.ts` holds bone maps from Mixamo-style,
Unreal and Rigify names onto the Biped and a world-space delta retargeting
function. It contains no animation data, and the current build does not call
it; the runtime never retargets (clips are baked).

## Animation set

Each gender's motion file holds 67 clips. From Rocketbox (`CLIPS` in
`cast.ts`, Rocketbox name without the `m_` / `f_` prefix in brackets where it
is not obvious):

- Idle: `idle`, `idle_breathe`, `idle_look`, `idle_nervous`, `idle_wait`,
  `idle_b` (idle_neutral_03), `idle_angry`, `idle_yawn`, `idle_scratch`.
- Walk: `walk`, `walk_slow`, `walk_fast`, `stroll`, `walk_hurt` (walk_bruised),
  `walk_drunk`, `walk_start`, `walk_stop`.
- Run: `jog` (run_slow_01), `run`, `sprint` (run_fast_01), `run_start`, `run_stop`.
- Crouch: `crouch`, `crouch_talk`, `crouch_in`, `crouch_out`.
- Talk and gesture: `talk`, `talk_b`, `talk_excited`, `talk_angry`, `talk_calm`,
  `listen`, `nod`, `shake_head`, `shrug`, `think`, `laugh`, `present`, `wave`,
  `wave_b`, `cheer`, `clap`.
- Sit: `sit_down`, `sit`, `sit_shrug`, `sit_breathe`, `stand_up`.
- Objects and doors: `take`, `read` (documents_check), `hold_papers`, `knock`,
  `door` (try_door_inwards), `drink`, `phone`.
- Turns: `turn_left`, `turn_right`, `turn_around` (180 degrees).

Authored in `authored.ts`, for motions Rocketbox does not have: `jump_start`,
`jump_air`, `fall`, `land`, `hit`, `attack` (melee swing), `throw`, `pickup`
(from the floor), `death`, `crouch_walk`. Each is a set of keyframed rotation
deltas laid over the Rocketbox `idle` pose, with a full rotation track set so
it crossfades cleanly against any Rocketbox clip.

## Outfit masks and tints

`scripts/characters/textures.py` converts each body's 2048 px TGA maps into
1024 px WebP: base colour, normal, metallic-roughness (roughness from the
specular map), the hair cards, and one mask image. The converter first writes
UV-space planes (surface height and head/neck/hand skinning share per texel);
the script marks a texel as cloth when it is not skin coloured (Lab distance to
a skin reference) and not on a hand, neck or head, then labels whole UV
islands top (torso, arms), bottom (legs) or, for one-piece garments, top;
shoes and boots are left out. Hair is found on the head map above the
hairline. The mask image is 1024x512: left half body (R top, G bottom), right
half head (R hair), feathered by one texel. `refs.json` gives the mean linear
luminance of each region, recorded as `tintTop`, `tintBottom`, `tintHair`.

At runtime (`packages/render/src/characters/tint.ts`) a variant is baked on the
CPU once when first needed: masked texels move to the target colour scaled by
their own luminance over the region mean, so folds and seams survive. The
result is an ordinary base colour texture; variants share materials by key
`bodyId|top|bottom|hair`.

## Files and checksums

- `assets/lib/c/<id>.<hash8>.glb`: one body (meshopt-compressed, WebP textures).
- `assets/lib/c/<id>.masks.<hash8>.webp`: its outfit mask.
- `assets/lib/c/motions-male.<hash8>.glb`, `motions-female.<hash8>.glb`: the
  skeleton node tree plus one animation per clip (`stride`, `duration` in extras).
- `assets/characters.json`: source, licence, commit, and per file the path,
  SHA-256 and size, plus triangles, vertices, bones, height, hip and tint refs;
  per motion set the clip table and reference hip.
- `packages/assets/src/characters/generated.ts`: the runtime subset of the same
  data (`GENERATED_LIBRARY`). Generated; do not edit.

## Kaho, Mio and the character pipeline

`kaho` (`style: 'toon'`, 1.54 m, 6.45 heads, 57.4 k triangles, 945 KB) and `mio` (1.54 m, 59.6 k triangles, 1,000 KB)
are built by the Blender character pipeline (`scripts/blender/character/build.py`; docs/BLENDER-HARNESS.md,
"Characters") from their briefs in `scripts/blender/character/briefs/`, and installed by
`scripts/characters/finish-character.ts` into `assets/lib/c/<id>.<hash8>.glb`, `assets/characters-original.json` and
`packages/assets/src/characters/original.ts` (`ORIGINAL_CAST`, appended to `CAST`). Kaho follows her model sheet
(`docs/worlds/cloudwatch-concept/`, generated concept art used as reference only): a summer sailor uniform (white
blouse; a sky-blue collar with two white lines and a square back flap; a deep-teal neckerchief with a knot and two
tails; a knee-length navy A-line skirt in twelve knife pleats with a fold and a shadow side), off-white socks to
mid-calf, brown loafers with a strap and a heel, a
black watch on her left wrist, a chin-length chestnut bob, full at the crown and cheeks, with the inward curl and five
large side-swept bangs, a
braid behind her left ear ending in a seashell charm, brown eyes. Mio follows her brief
(`docs/worlds/cloudwatch-concept/prompts/r4-mio.txt`): a pale mint cardigan open over a white T-shirt, a long
light-beige skirt in 24 pleats, white sneakers, a brown bag strap across her body, long straight black hair in two
layers of clumps with a soft fringe and a white hairband, droopy dark grey-brown eyes, a beauty mark under her left eye. (Until November 2026 Kaho
was lofted from primitives by `scripts/characters/anime-kaho.ts`, kept for reference; running it would replace the
pipeline's body.) Proof: `docs/screenshots/cloudwatch/character/kaho-vs-sheet.webp`, `mio-turnaround.webp`.

- One skinned mesh on the shared Biped, rest rotations exact and only bone offsets changed (long legs, short torso),
  so the female motion set plays unchanged. Secondary bones: 12 skirt panels, the braid (Kaho) or three chains of long
  hair (Mio), the side locks, the neckerchief's tails; 13 springs each, with capsules on the thighs, calves, forearms,
  hands, head, back, chest and hips.
- Morph targets `smile`, `sad`, `surprised`, `teary`, `blink`, `mouth_open`, `determined` (decals on the face, driven by
  `CharacterRig.setExpression`), and clips of their own, `look_up`, `hand_to_chest`, `two_fingers`, `run_stop`, which
  join the motion set by name (`run_stop` replaces the shared one).
- The file holds the skinned body twice (`<id>-body` and `<id>-outline` nodes sharing one geometry and its morphs),
  materials marked `toon: body|outline` in their extras, a `_TOON` vertex attribute (outline width, shade bias, rim
  strength) and, in the scene extras, `toon.springs` and `toon.colliders`. A spring link is kept out of a capsule at its
  tip and at its middle, so a skirt panel cannot cut through a thigh; below the hips the skirt's front and back are
  weighted mostly to the thighs, so the legs carry it. A per-vertex shade bias keeps the face lit as one shape
  (docs/BLENDER-HARNESS.md, "Stages"). Each build also writes a far level of detail (about 23 k triangles, no morphs),
  installed as `assets/lib/c/<id>.lod1.<hash8>.glb`, recorded as `lod1: { file, triangles, bytes }` in
  `assets/characters-original.json` and as `ORIGINAL_LODS[id]` in `original.ts`; the runtime does not load it yet.
- Rebuild: docs/BLENDER-HARNESS.md, "How to run" (about 30 s per character).
- Runtime corrections of a toon body after the clip (`rig.ts`): the arms hang
  6 degrees out (`armClearance`); standing, the head and neck ease back to
  rest from the idle clip's glances (`headSteady`), so a held close-up does not
  turn the head on its own; with `CharacterRig.ground` set (the story runner
  sets it from the stair's triangles) the feet stand on the treads.
- Runtime (`packages/render/src/characters/toon.ts`, `springs.ts`):
  `ToonShading` swaps in two shared node materials, so every toon person costs
  two programs (plus the shadow depth variant). The body is unlit like the
  baked world: the atlas colour banded by the sun direction into a lit tone
  warmed by the sun's hue and a violet shadow tone (0.62, 0.55, 0.8), hair
  highlights shown on the lit side only, eyes unshaded, and a warm rim on edges
  facing the sun. The outline is an inverted hull pushed out along the skinned
  normal by a width growing with the square root of the distance (thinner on
  screen far away), coloured a darker shade of the part under it, and hidden
  at the far level of detail. `world-renderer` feeds the sun
  (`characters.setToonLight`). Tints are not applied to toon bodies.
- Toon bodies pose on twos: `CharacterSystem` steps their rig at 12 Hz
  (`TOON_POSE_FPS`, `poseStep`) while the entity moves smoothly every frame.
  Springs run inside the rig step, after the clip and pose corrections.
- She is used only when named (`character: { body: 'kaho' }`,
  `player.character`), or for "anime" / "kaho" in `lookFromText`; the random
  picker never chooses a toon body. Her credit line names the female Rocketbox
  motion set that animates her, not her body.
- Proof shots: `STATIC_DIR=<dist> GEN_GPU=intel npx tsx
  scripts/characters/kaho-shots.ts --out=<dir>` (Cloudwatch Harbour at
  sunset); results in `docs/screenshots/cloudwatch/character/`.

### Driving a person from code

An entity with `character` that is moved every frame through
`renderer.setEntityProperty(id, 'transform.position', …)` or
`renderer.applyTransforms(…)` walks or runs by its speed (the rig tracks the
entity node) and idles when still, also in an idle editor: such moves keep
people animating for 4 s after the last one. To play a named clip:

```ts
const rig = renderer.characterRig(id);
rig?.playClip('wave');                  // one-shot actions return to locomotion
rig?.playClip('sit', { loop: true });   // any clip of the set, held until stopClip()
rig?.stopClip();
rig?.trigger('nod');                    // state-machine actions only
```

## Rebuilding

The build needs a local copy of the Rocketbox repository at the pinned commit
(at least `Assets/Avatars/Adults`, `Assets/Animations` and `LICENSE.md`) under
`$AETHER_CHARACTER_SRC` (default `~/.local/share/aether/characters-src`), and
Python 3 with NumPy, Pillow, SciPy and scikit-image for `textures.py`. Then:

```
npm run characters:build
```

It empties `assets/lib/c/`, rewrites every body and motion file, then
`assets/characters.json`, `assets/characters-LICENSE.md` and `generated.ts`.
`AETHER_CHARACTER_DEBUG=<dir>` also writes a `<id>-masks.png` overlay per body.
`npm run characters:preview` renders contact sheets of the built files in a
browser.

## Runtime

`CharacterSystem` (`packages/render/src/characters/system.ts`) loads bodies and
motion sets lazily through the model cache, applies tint variants and steps
level of detail (look-at and IK near, quarter-rate mixers and no shadows far).
Each `CharacterRig` drives its mixer from `LocomotionMachine`
(`packages/assets/src/characters/anim-state.ts`), a pure, deterministic state
machine over speed, vertical speed, grounded, crouch, sit, talk, NPC hint and
mood. Locomotion picks the gait clip (`walk_slow` .. `sprint`) whose stride is
nearest the actual speed, with hysteresis, and plays it at `speed / stride`
(clamped 0.6-1.7) so feet do not slide. A new gait is held for 0.3 s unless
the speed is far from it (no flicker through the ladder while speeding up),
and the `sprint` clip is shown only for a sprint. A crouch plays the standing
`idle` or `walk` under a crouch the rig lays over it (hips down and back,
knees bent by IK so each foot stays where the clip put it, back leaning,
eased in and out over about 0.4 s), so standing, crouching and crouch walking
blend without a pop. A player strafing with a gun turns the hips toward the
walking direction (up to 65 degrees) with the chest held on the aim, and
backing off plays the gait in reverse; the shouldered gun rides on the chest
(it sinks with a crouch), pitches with the aim and is lowered in a sprint.
Mood selects idle, walk and talk
variants; jump, fall, land, hit, attack, sit and death are states of their own;
one-shot actions (wave, nod, pickup, throw, knock, drink and others) interrupt
locomotion and return to it. The rig only reads the simulation and never
writes to it.

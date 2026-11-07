# Cloudwatch Harbour: design

An original scene in the style of hand-painted Japanese animation backgrounds: a hillside fishing town at summer dusk,
seen from a lookout above it, with a towering cloudscape over the sea. It is made in Blender by scripts
(`scripts/blender/cloudwatch/`), baked to web-sized glb pieces and assembled as an Aether world
(`apps/studio/public/templates/worlds/cloudwatch-harbour.json`). Everything is procedural: no models, textures, HDRIs or
scans from anywhere else, and no recreation of any film, show, character, scene or composition.

## Style, by its traits

- Painterly cel shading: two lit bands and one shadow band per surface, a soft step between them, shadows tinted
  violet-blue rather than darkened to grey, a warm rim where the low sun grazes an edge.
- Crisp dark line art on silhouettes and major creases (buildings, gate, poles, people), thin and warm-dark, never black.
- Saturated but tasteful: the sky carries the strongest colours; the town stays a step quieter so the sky reads first.
- Towering cumulus and cumulonimbus with hard sunlit tops, soft lavender shadow sides and cool blue-lavender undersides:
  cauliflower billows with crisp cel bands (shadow, a thin warm terminator, lit, sunlit crowns), a gold rim on the sun's
  side, smaller satellite clouds at several depths taking on the horizon's haze with distance.
- Sun glare and bloom on the sun, the sea glitter (a path of short bright streaks under the low sun that twinkles), lanterns
  and signal lamps; painted wave strokes on the water; a bright apricot glow band on the horizon; thin cirrus strands drawn
  in perspective, catching light near the sun.
- Dense foliage as clumps with one shading normal per clump (it reads as brushwork, not as leaves).

## Setting and real dimensions

Blender units are metres, Z up (Aether: Y up after glTF export). Sea level is z = 0. The sea lies to the south.

| Element | Size and place |
|---|---|
| Hillside | rises north from the shore (y = -30) to the lookout (y = +100, z = 34); about 220 m wide (x from -110 to +110) |
| Harbour | quay wall 1.6 m high along y = -30; a breakwater 70 m long curving east with a small red lighthouse (6 m); four fishing boats 6-9 m |
| Harbour road | 7 m wide along the quay, z = 1.6 |
| Railway | single track, standard gauge 1.067 m, on a terrace at z = 6.0, y = -4; one level crossing where the stair meets it |
| Town | 76 houses on four terraces (z = 6, 12, 18, 25) held by dressed-stone retaining walls 2.5-4 m high, in five forms (simple, L-shaped, stepped with a set-back upper storey, flat-roofed concrete blocks with parapets, tall narrow houses), 1-3 storeys; gabled, hipped, hip-and-gable and corrugated roofs with tile rows, eaves with fascias, lean-to roofs, balconies with railings, external steel stairs; antennas, water tanks on stands, solar heaters, AC units with pipe covers, gutters and downpipes, laundry and futons, potted plants, name boards and banners with invented text |
| Stone stair | 2.4 m wide, risers 0.16 m, treads 0.32 m, landings every 12-16 steps, from the road (z = 1.6) to the lookout (z = 44) |
| Shrine gate | at the z = 18 terrace on the stair: 2 posts 0.36 m across, 4.6 m apart, lintels at 4.2 and 4.8 m, vermilion with dark caps; two stone lanterns 1.6 m |
| Lookout | 16 x 10 m paved platform at z = 44, a railing 1.05 m with a gap where the stair arrives, a bench, a street lamp 4.5 m, a lone big tree |
| Telegraph poles | 8 m concrete/wood poles every 25-30 m along the road, the track and up the stair; 3-4 wires each with catenary sag |
| People | seven static figures (`people.py`), adults 6.8-7 heads tall, a child 5.2, built from joints with bent elbows and knees, shaped torsos, hair (long, bob, ponytail, spiky, grey) and colour-blocked summer clothes: a schoolgirl in a sailor uniform leaning on the lookout rail, an old man on a bench there, a man in a straw hat climbing the stair, a mother holding a pointing child's hand at the crossing, a boy with his bicycle at the shop, a woman in a sundress walking along the harbour road |
| Cloudscape | a cumulonimbus with a flattened anvil and an overshooting top in the left third of the opening view (az 170, scaled down to 2.4 km out, 0.78 km tall, its base on the horizon), six satellite cumulus at 1.3-2.4 km, a broken bank on the horizon, cumulus over the hills to the north, cirrus on the sky dome |

## Palette (sRGB)

| Role | Colour |
|---|---|
| Zenith | `#2c3f86` deep cobalt |
| Upper sky | `#5d6fc4` |
| Horizon band | `#f6b27a` apricot, `#ffd9a0` near the sun |
| Sun core / glare | `#fff3d6` |
| Cloud lit tops | `#ffe3c4` to `#ffc39a` |
| Cloud shadow sides | `#8e7fc0` lavender, `#6c6aa8` deep |
| Cloud bases | `#e79aa6` dusty pink |
| Sea near / far | `#1f4f7a` / `#6f86c0`, glitter `#ffe7b8` |
| Walls lit / shadow | `#f1e2c8` / `#8f8cb8` |
| Roof tiles | `#3d4b6b` slate blue, `#7a3f36` brick red, `#2f5d5a` teal |
| Wood | `#8a5a3c` |
| Foliage lit / mid / shadow | `#a8c25a` / `#4f8a4a` / `#2b4d5a` |
| Stone | `#c9bfae` / shadow `#7f7d9c` |
| Shrine gate | `#d8452f` vermilion, caps `#2a2730` |
| Lantern glow | `#ffb25c`, signal lamps `#ff4a3a`, vending machine `#d6f0ff` |
| Line art | `#2a2235` |

## Lighting plan

- Sun at azimuth 214° (south-south-west, low over the sea, inside the opening view), elevation 6.5°, colour `#ffc48a`, strength chosen so a lit wall reaches the
  top band without clipping. Long shadows run north-east up the hill.
- Sky light from the dome gradient, tinted lavender in shadow; no grey fill anywhere.
- Toon ramp (on the diffuse light, 0 dark .. 1 full sun): shadow band below 0.32, a soft 0.06 step, a mid band to 0.62,
  a narrow 0.04 step to the lit band; shadow colour multiplies the albedo by `#8f8cc8`, mid by `#d9c8d6`, lit by
  `#fff0dc`. A rim term adds `#ffb47a` at grazing sun angles on lit faces.
- Practical lights come on at dusk: lanterns along the stair, the shrine's stone lanterns, the crossing lamps, house
  windows (a few warm), the vending machine, the lighthouse.
- Exposure: the sky's horizon band sits just under white; bloom only on the sun, glitter, lamps and windows.

## Camera shots (the fixed QA list)

| Shot | Camera | Purpose |
|---|---|---|
| A, hero | the lookout, eye height just behind the railing, looking south over the roofs to the sea, the cloud tower (left third) and the low sun with its glitter path (right third), 20 mm | the whole composition: sky first, town second |
| B, stair | on the stair below the shrine gate, looking up through the gate to the lookout and the clouds, 28 mm | foreground detail, line art, lanterns |
| C, crossing | the level crossing at street level, looking along the track and the wires toward the sunset (west-south-west), 22 mm | wires, poles, signals, the headland |
| D, harbour | the end of the breakwater looking back at the town climbing the hill, 40 mm | the town as a whole, windows lit |
| S, sunset | the lookout, toward the sun, 30 mm | the sun, its bloom, the glitter path, the horizon band, the cirrus |
| P, people | across the track from the crossing, toward the mother and child and the sea, 35 mm | the people |

Each pass renders A-D in Blender (EEVEE, toon materials, line art) at 1600 x 900 and compares with the previous pass;
the finished stills are 3840 x 2160.

## Method

1. Light and colour first: sky dome, sun, palette, exposure and the toon ramp on grey blockout forms. This pass is the
   baseline every later pass is compared against.
2. Materials: toon node materials (Diffuse BSDF, Shader to RGB, colour ramp, shadow tint), procedural painted variation
   (noise-broken albedo, brush-stroke masks on walls and roofs).
3. Form: terrain, terraces, stair, houses, gate, railway, harbour, boats, trees, poles and wires.
4. Lived-in detail: laundry, bicycles, vending machines, potted plants, air-conditioner units, water tanks, signs with
   invented text, a mailbox, the crossing's barriers and signals.
5. Finishing: line art, bloom, glare, light shafts, sea glitter.
6. Gate: a floating and interpenetration check over every placed prop (`check-props.py`): each prop's base must touch the
   surface under it within 3 cm, and no prop may sink more than 3 cm into another.

## Bringing it into Aether

- The look is baked: Cycles bakes the diffuse light of every surface into a lightmap UV; the same toon ramp and shadow tint
  run on it in NumPy and multiply the painted albedo, giving one colour texture per piece. Pieces draw unlit
  (`KHR_materials_unlit`), so the renderer's PBR lighting cannot fight the painted look; emissive parts carry
  `KHR_materials_emissive_strength` so bloom finds them.
- Line art: inverted-hull outlines on buildings, gate, poles and people (a back-face shell, `#2a2235`), part of the glb.
- Pieces: the town's terraces and lanes (4096 px atlas) and the rest of the hillside (2048 px) apart, so a texel by the
  crossing is about 5 cm; houses (4096 px), the shrine on its own small atlas (in the town's atlas the gate's round posts
  were thinner than a texel and baked black), infra, props, people (1024 px), garden trees and the forest shell (vertex
  colours), sky dome (4096 x 2048), sun, sea, glitter.
- Atlas packing: islands are packed as boxes with a two-texel margin. The default packer (concave shapes, a scaled margin)
  left the town's ~30k smart-project islands as placed: 0.8 % of the 4096 px atlas covered and nearly every island,
  walls and roofs included, under a texel wide. Boxes cover about 12 %, so walls and roofs get real texels.
- Thin geometry: an island still under 1.25 texels across (a pole, a barrier arm, a fascia, a gutter, a trim) holds no
  texel centre, so the bake never writes it and it drew the cleared black or a neighbour's margin. Such islands are shaded
  per vertex instead (the same light and albedo bakes into colour attributes, the same ramp, the upper part of the corner
  light since corners against other geometry are occluded) and their UVs collapsed onto a 2 x 2 texel block in a palette
  band kept free at the top of the atlas (`PALETTE_ROWS`).
- Clouds are impostor cards: EEVEE renders the clouds alone from the lookout in eight 45-degree sectors (transparent film,
  the sea held out, the near plane at 400 m), each cropped to its clouds and laid on a flat card filling that sector's
  frustum 1250 m out. From the lookout the cards are the Blender render pixel for pixel; elsewhere in the town the clouds
  1-2.4 km away move a few degrees at most. Unlit, alpha-blended.
- The glitter is four groups of thin emissive quads on the water (1400 streaks) with a looping two-second visibility
  animation (each group shown or collapsed on its own pattern of quarter-second steps). A `model` whose file carries
  animation clips loops its first clip in the renderer (`scene-sync.ts`, through the asset animator and its distance
  levels of detail); the export merges the groups' actions into that one clip.
- An opt-in `environment.look.style: 'anime'` profile: a palette-preserving tone curve (no ACES hue shift or AgX
  desaturation), no automatic exposure trim, the grade's saturation and contrast caps lifted to cel-friendly values, a
  gentle bloom. Realistic worlds do not set it and are unchanged.
- Start mode `orbit` (showcase): the scene is a picture to look around, opened on shot A.

## How to rebuild

```
blender -b --factory-startup -P scripts/blender/cloudwatch/build.py -- --out <dir> [--size 3840x2160] [--shots A,B,C,D,S,P]
blender -b <dir>/cloudwatch.blend -P scripts/blender/cloudwatch/check_props.py -- --json <dir>/gate.json # the gate
blender -b <dir>/cloudwatch.blend -P scripts/blender/cloudwatch/bake_export.py -- --out <web> --samples 64
npx tsx scripts/blender/cloudwatch/world.ts <web>    # copies the pieces, writes the template in canonical form
STATIC_DIR=<dist> AETHER_FULL_QUALITY=1 AETHER_RENDER_TIER=high npx tsx scripts/blender/cloudwatch/aether-shots.ts --out=<dir>
```

Run Blender under `systemd-run --user --scope -p MemoryMax=12G nice -n 10`. The bake runs on the CPU by default: on a
shared GPU with little free memory, an OptiX bake came back black without an error (`--gpu` asks for it anyway). A full
bake takes about 35 minutes on 32 threads (the 4096 px terrain and town atlases take most of it); `--only` re-bakes
named pieces into the same folder.

Each still renders in three passes and is composited before the glare (`shots._render_layered`): the scene without
clouds, the clouds alone with the near plane at 300 m, and the coverage of everything in front of the sky. With one pass
and a 0.1 m near plane, the creases where billows intersect 2 km away came out as depth-precision staircases at 4K.

## Result (7 November 2026)

- **Look pass** (the opening view was pleasant low-poly, not background art):
  - The hero cloud was a soft lumpy blob of a few big metaballs with a smooth ramp. It is now a union of about 600
    spheres in a cumulonimbus anatomy: a flat shelf, congestus towers, a stacked column with turrets, an overshooting top
    and a flattened anvil. It is shaded with crisp bands from a normal that blends each billow's own normal with the
    normal of a smooth Gaussian field over all of them, so light falls across the whole mass and the terminator wobbles
    over the lumps. The clouds are lit by a painter's light swung toward the lookout; the true sun draws the gold rim.
  - Second pass on the cloud (it read as fish scales: hundreds of similar billows each drawing its own lit cap and dark
    crescent, see `before-after/6-cloud-scales.webp`):
    - The light comes in four scales: the whole mass and the heads (two wide Gaussian fields) set the light and the
      terminator; a tight field and each billow add only detail, which brightens the tops of billows far more than it
      darkens their creases, and only on the lit side. Shadow sides stay broad lavender shapes.
    - The tower is built of cauliflower heads whose sizes step down by about half per level (a big dome, crowns, a few
      fine billows on the crowns that face up), rises from the horizon haze on a wide flat base, and flares into a
      flat-topped anvil that spreads downwind; the upwind flare that read as a hat brim is gone.
    - The painter's light swung 110 degrees toward the lookout (from 80), so three quarters of the tower is lit.
  - Thin geometry baked dark (the crossing barrier, lamp posts, fascias and eaves drew as thick black bars). The atlases
    are now packed as boxes, and what is still under a texel is shaded per vertex through a palette band (see Bringing it
    into Aether; `before-after/7-thin-geometry.webp`).
  - The sun moved from azimuth 252 to 214 and elevation 10 to 6.5, into the opening view, so shot A holds the sun, its
    glitter path and the tower.
  - Sea: the far water reflects the horizon glow, a warm column on the sun's path, painted crests and troughs, and the
    glitter geometry. Sky: a two-tone gradient (warmer toward the sun), a thin bright horizon band and a rose glow above
    it, and cirrus drawn on a high plane in perspective.
  - The town was rebuilt (`town.py`, `town_dress.py`, the props in `detail.py`) and the people too (`people.py`).
  - Shot C's two artefacts:
    - The light smear on the bank by the railway was the terrain's single 2048 px atlas (0.19 m a texel) magnifying the
      baked wire shadows and sampling noise. The terrain is now split near/far.
    - The translucent blue shape left of the tunnel was the headland. South of the quay line, the terrain was painted
      with the seabed material even where the headlands rise out of the water. It is now forest floor with a rocky
      shore band.
  - The lookout deck sat at z = 34, buried 10 m under its own 44 m terrace. It now stands on the terrace, with a gap in
    the railing for the stair.
- **Gate**: 73 props checked, 0 failed (0 floating, 0 buried). One pair touches within tolerance: the mother's and
  child's joined hands, 1.4 cm.
- **Budget**: 14 glb pieces, 485 k triangles, 20.5 MB (from 376 k / 11.9 MB before the look pass):

  | Piece | Triangles | Size |
  |---|---|---|
  | town | 125 k | 8.6 MB |
  | props | 96 k | 5.0 MB |
  | infra | 53 k | 2.6 MB |
  | forest | 99 k | 1.8 MB |
  | people | 57 k | 1.5 MB |
  | trees | 34 k | 0.6 MB |
  | terrain near / far | 2 k / 5 k | 0.5 / 0.1 MB |
  | sky | 9 k | 0.3 MB |
  | clouds (8 cards) | 16 | 0.24 MB |
  | sea | 1 k | 0.09 MB |
  | glitter | 2.8 k | 0.09 MB |
  | shrine | 0.6 k | 0.05 MB |

  Triangle counts include the outline shells.
- **First picture** (`first-picture-probe --player`, Intel UHD 770, `GEN_GPU=intel`, 5 GB scope):
  - Cooked 3.6 s cold, 2.9 s warm; live the same, 3.6 / 2.9 s.
  - 43 programs and 0 links after the first picture.
  - Orbit p50 16.7 ms, p95 16.7-16.8 ms.
  - 235 draws a frame, up from 133: more pieces and materials, the cards and the glitter groups.
- **Cooked**: `cloudwatch-harbour/72399a70423ca127/` on the dataset (program sets only: low 25, medium 27, high 26,
  ultra 43 programs).
- **Shots**: `docs/screenshots/cloudwatch/` holds:
  - the Blender stills A-D, S and P at 3840 x 2160 (`blender-*-4k.webp`);
  - Aether's pictures at the high tier and at the low tier on the Intel GPU (`aether-{high,low}-*.webp`), with A and C
    also at 2560 x 1440 (`aether-high-*-1440p.webp`);
  - before/after pairs for each change of the look pass (`before-after/`).
- **Known weak spots**:
  - The figures are neat mannequins up close: mitten hands, a simple knee bend.
  - The house signs are too small to read from the lookout.
  - In a headless capture the clock is frozen, so the glitter's twinkle shows only in the browser. Its clip was checked
    by stepping the animator in Node.

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
- Towering cumulus and cumulonimbus with hard sunlit tops, soft lavender shadow sides and pale pink bases.
- Sun glare and bloom on the sun, the sea glitter, lanterns and signal lamps; light shafts through gaps in the cloud bank.
- Dense foliage as clumps with one shading normal per clump (it reads as brushwork, not as leaves).

## Setting and real dimensions

Blender units are metres, Z up (Aether: Y up after glTF export). Sea level is z = 0. The sea lies to the south.

| Element | Size and place |
|---|---|
| Hillside | rises north from the shore (y = -30) to the lookout (y = +100, z = 34); about 220 m wide (x from -110 to +110) |
| Harbour | quay wall 1.6 m high along y = -30; a breakwater 70 m long curving east with a small red lighthouse (6 m); four fishing boats 6-9 m |
| Harbour road | 7 m wide along the quay, z = 1.6 |
| Railway | single track, standard gauge 1.067 m, on a terrace at z = 6.0, y = -4; one level crossing where the stair meets it |
| Town | about 26 houses on four terraces (z = 6, 12, 18, 25) held by dressed-stone retaining walls 2.5-4 m high; houses 5-8 m wide, 6-9 m tall, one or two storeys, gabled and hipped roofs with tiles |
| Stone stair | 2.4 m wide, risers 0.16 m, treads 0.32 m, landings every 12-16 steps, from the road (z = 1.6) to the lookout (z = 34) |
| Shrine gate | at the z = 18 terrace on the stair: 2 posts 0.36 m across, 4.6 m apart, lintels at 4.2 and 4.8 m, vermilion with dark caps; two stone lanterns 1.6 m |
| Lookout | 14 x 9 m paved platform at z = 34, a railing 1.05 m, a bench, a street lamp 4.5 m, a lone big tree |
| Telegraph poles | 8 m concrete/wood poles every 25-30 m along the road, the track and up the stair; 3-4 wires each with catenary sag |
| People | five small static figures, 1.45-1.75 m, in simple summer clothes: one at the lookout railing, one on the stair, two at the crossing, one by a bicycle |
| Cloudscape | a cumulonimbus tower 6-9 km high at 18-25 km distance to the south-east, a broken cumulus bank on the horizon, high cirrus streaks; drawn on a sky dome |

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

- Sun at azimuth 235° (south-west, over the sea), elevation 7°, colour `#ffc48a`, strength chosen so a lit wall reaches the
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
| A, hero | the lookout, eye height, looking south-west over the roofs to the sea and the cloud tower, 35 mm | the whole composition: sky first, town second |
| B, stair | on the stair below the shrine gate, looking up through the gate to the lookout and the clouds, 28 mm | foreground detail, line art, lanterns |
| C, crossing | the level crossing at street level, looking along the track and the wires toward the sunset, 24 mm | wires, poles, signals, people |
| D, harbour | the end of the breakwater looking back at the town climbing the hill, 50 mm | the town as a whole, windows lit |

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
- Pieces and budget: terrain and town near, town far (a simplified copy for low tier), harbour and sea, props, people,
  sky dome. Target under 400 k triangles total, textures 2048 px webp (1024 px for the far pieces), under 12 MB.
- An opt-in `environment.look.style: 'anime'` profile: a palette-preserving tone curve (no ACES hue shift or AgX
  desaturation), no automatic exposure trim, the grade's saturation and contrast caps lifted to cel-friendly values, a
  gentle bloom. Realistic worlds do not set it and are unchanged.
- Start mode `orbit` (showcase): the scene is a picture to look around, opened on shot A.

## How to rebuild

```
blender -b --factory-startup -P scripts/blender/cloudwatch/build.py -- --out <dir> [--size 3840x2160]   # .blend + stills A-D
blender -b <dir>/cloudwatch.blend -P scripts/blender/cloudwatch/check_props.py -- --json <dir>/gate.json # the gate
blender -b <dir>/cloudwatch.blend -P scripts/blender/cloudwatch/bake_export.py -- --out <web> --samples 64
npx tsx scripts/blender/cloudwatch/world.ts <web>    # copies the pieces, writes the template in canonical form
STATIC_DIR=<dist> AETHER_FULL_QUALITY=1 AETHER_RENDER_TIER=high npx tsx scripts/blender/cloudwatch/aether-shots.ts --out=<dir>
```

Run Blender under `systemd-run --user --scope -p MemoryMax=12G nice -n 10`. The bake runs on the CPU by default: on a
shared GPU with little free memory, an OptiX bake came back black without an error (`--gpu` asks for it anyway).

## Result (6 November 2026)

- **Gate**: 57 props checked (lanterns, signs, vending machines, bicycles, laundry, the mailbox, boats, people, the
  lighthouse, stone lanterns), 0 floating, 0 buried, 0 overlapping pairs at 3 cm. Its first run found 28 failures: lantern
  and sign posts sunk 0.25-0.33 m (they now stand on footings), two people on the stair's top step (the track moved
  1.4 m north, which leaves a landing at the crossing), and the stone lanterns 3 cm into the lane.
- **Budget**: 11 glb pieces, 376 k triangles, 11.9 MB (town 55 k / 3.1 MB with a 4096 px atlas; infra 53 k / 2.5 MB;
  props 56 k / 2.3 MB; forest shell 99 k / 1.8 MB; clouds 54 k / 0.9 MB; trees 36 k / 0.7 MB; terrain 7 k / 0.25 MB;
  people 5 k; sky 9 k with a 2048 x 1024 texture; sea 1 k; sun 80). Every piece draws unlit or emissive: no lights,
  shadows or screen-space passes are spent on them.
- **First picture** (`first-picture-probe --player`, Intel UHD 770, `GEN_GPU=intel`, 5 GB scope): cooked 3.2 s cold,
  2.8 s warm; live 3.0 / 2.7 s. 42 programs, 0 links after the first picture, 0 generator runs, orbit p50 and p95
  16.7 ms, 133 draws a frame.
- **Cooked**: `cloudwatch-harbour/c88457a21d31f574/` on the dataset (program sets only: low 24, medium 26, high 25,
  ultra 42 programs; the world has no generator geometry, its pieces are the glb files the app serves).
- **Realistic worlds**: hero shots of Kestrel Outpost (full quality) differ from the build before by 0.00-0.63 / 255 mean
  per shot and Lisbon Hills by 0.09-0.76, about the run-to-run noise of a live load.
- **Shots**: `docs/screenshots/cloudwatch/` holds the Blender stills A-D at 3840 x 2160 (`blender-*-4k.webp`) and Aether's
  own pictures of A-D plus the sunset (`S`) at the high tier and the low tier on the Intel GPU (`aether-{high,low}-*.webp`),
  with A and C at 2560 x 1440 (`aether-high-*-1440p.webp`). A 3840 x 2160 capture of the headless studio came back
  black (the post chain at that size), so the 4K stills are Blender's.

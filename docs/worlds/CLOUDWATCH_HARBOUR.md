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
| Railway | single track, 1.067 m gauge, on a terrace at z = 6.0, y = -9.4; one level crossing where the stair meets it; electrified: steel H-masts south of the track every 25-30 m, a messenger wire in true catenaries and a level contact wire 5.0 m over the rail top, zigzagged 0.2 m |
| Train | a two-car electric multiple unit: cars 20 m over the body, 2.9 m wide, roof 3.72 m over the rail, floor 1.15 m; tapered cab fronts with raked windscreens, four double doors a side, a single-arm pantograph raised to the contact wire, two bogies a car (0.86 m wheels, 2.1 m wheelbase) |
| Town | 76 houses on four terraces (z = 6, 12, 18, 25) held by dressed-stone retaining walls 2.5-4 m high, in five forms (simple, L-shaped, stepped with a set-back upper storey, flat-roofed concrete blocks with parapets, tall narrow houses), 1-3 storeys; gabled, hipped, hip-and-gable and corrugated roofs with tile rows, eaves with fascias, lean-to roofs, balconies with railings, external steel stairs; antennas, water tanks on stands, solar heaters, AC units with pipe covers, gutters and downpipes, laundry and futons, potted plants, name boards and banners with invented text |
| Stone stair | 2.4 m wide, 249 steps: risers 0.17 m, treads 0.29 m (2 x riser + tread = 0.63 m), a level landing at least every 16 steps inside each bank and the terraces between banks, a handrail 0.9 m over the nosings, from the road (z = 1.6) to the lookout (z = 44) |
| Shrine gate | at the z = 18 terrace on the stair: 2 posts 0.36 m across, 4.6 m apart, lintels at 4.2 and 4.8 m, vermilion with dark caps; two stone lanterns 1.6 m |
| Lookout | 16 x 10 m paved platform at z = 44, a railing 1.05 m with a gap where the stair arrives, a bench, a street lamp 4.5 m, a lone big tree |
| Telegraph poles | 8 m concrete/wood poles every 25-30 m along the road, the track and up the stair; 3-4 wires each with catenary sag |
| People | six static figures (`people.py`), adults 6.8-7 heads tall, a child 5.2, built from joints with bent elbows and knees, shaped torsos, hair (long, bob, ponytail, spiky, grey) and colour-blocked summer clothes (the girl at the lookout rail is the world's animated character, not baked): an old man on a bench at the lookout, a man in a straw hat climbing the stair, a mother holding a pointing child's hand at the crossing, a boy with his bicycle at the shop, a woman in a sundress walking along the harbour road |
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

- Physically based light under the paint (`common.LIGHT`, `sky.build_light`): a sun lamp at azimuth 214° (south-south-west,
  low over the sea, inside the opening view), elevation 6.5°, colour `#ffc48a`, a 0.55° disc (crisp, slightly soft shadow
  edges), and a Nishita sky for the fill (no sun disc: the lamp is the sun; its rotation is the compass azimuth, measured).
  Both are scaled so the diffuse light of an open, level surface in shade is 1 (`common.lref`) and a face turned to the sun
  6 (`sun_ratio`, a clear sky at 6.5°: 5-7). Cycles carries four diffuse bounces, so walls facing sunlit lanes are lifted
  by their bounce. In the browser's frame the sun is `[-0.558, 0.1005, 0.8237]` (Aether Y up = Blender (x, -z, y)).
- Contact occlusion (an AO bake, 1.1 m reach) multiplies the light before the ramp: L x (0.32 + 0.68 x AO), so creases
  (wall foot, eaves, under railings, risers) drop a band.
- Toon ramp on the lit result, in stops: x = log2(L) plus the terminator break (`common.RAMP`). Five bands multiply the
  albedo: contact shadow `#55508f` (x < -1.75), shade `#7b77bd` (to -0.25: walls in shade), open shade `#9d97cf` (to 0.45:
  level surfaces under the sky, bounce-lit walls), low sun `#efc6aa` (to 1.75: level ground and grazing walls in the sun)
  and lit `#ffe8c8` (faces turned to the sun). The steps inside the shadow side are soft (0.4 and 0.6 stops: with crisp
  ones, the bake's residual noise and the bounce flickered walls between shade and open shade in blotches), the two
  sunlit steps crisp (0.1 and 0.08 stops), so cast shadows keep hard painted edges; inside a band 0.2 stop of
  brightness per stop of light is kept (clamped to 1 stop either side of the band's centre), so a band is a painted
  gradation rather than a flat fill. The quantize replaces nothing: it bands the physical light.
- Open Image Denoise (the compositor's Denoise node, guided by the baked albedo and normal) cleans the baked light and
  occlusion before the ramp, so band edges follow the light's shapes, not the path tracer's grain.
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
6. Painterly finish (`common.BRUSH`, `common.HAZE`, shared by the EEVEE materials and the bake):
   - brush strokes in every toon albedo: long level strokes (world-space noise squeezed vertically) a few per cent lighter
     and warmer or darker and cooler, with a finer dry-brush grain inside them;
   - a broken terminator: the light is nudged by a second brush noise before the toon ramp, so band edges wander;
   - atmospheric perspective: the shaded colour is mixed toward `#a9b0dc` by horizontal distance from the town's middle
     (none within 50 m, up to 62 % at 450 m and beyond), so the headlands, the far forest and the hill tops go bluer and
     lighter;
   - far coast layers painted on the dome above the sea line (`sky.RIDGES`): a far peninsula and a nearer one with a far
     town's lights under the cloud tower, two ranges west beyond the headland, each paler and bluer with distance;
   - the cloud bands in four values (core shadow, shadow, lit, sunlit crowns) plus the thin warm terminator, their edges
     broken by a broad brush noise, a soft lilac inner glow on the shadow side near the terminator, and a sun-bleached
     near-white edge along the lit silhouettes;
   - outlines with a hand-drawn wobble: each shell's width swells and thins along an edge (a `cw_wobble` vertex group of
     slow world-space noise, 0.45-1.3 times the nominal width, `finish.wobble_group`);
   - foliage clumps with broken edges (a ridged noise bites notches into each clump's outline).
7. Gate: a floating and interpenetration check over every placed prop (`check-props.py`): each prop's base must touch the
   surface under it within 3 cm, and no prop may sink more than 3 cm into another.

## Bringing it into Aether

- The look is baked: Cycles bakes the diffuse light of every surface into a lightmap UV; the same toon ramp and shadow tint
  run on it in NumPy and multiply the painted albedo, giving one colour texture per piece. A third, emission-only bake
  (a few samples) writes the world-space terms the other two do not carry: the terminator-break noise (red) and the haze
  factor (green); `bake_export.finish_np` applies them exactly as the EEVEE material does. Vertex pieces (trees, forest)
  and the per-vertex thin islands take the haze from their vertex positions. Pieces draw unlit
  (`KHR_materials_unlit`), so the renderer's PBR lighting cannot fight the painted look; emissive parts carry
  `KHR_materials_emissive_strength` so bloom finds them.
- Practicals: every lamp, lantern, lit window and vending machine is an emissive-only part whose material is named
  `practical_<name>`: `practical_window_lit` (house and train windows, the train's headlights and destination board),
  `practical_lantern_paper` (stair lanterns, the lookout's street lamp), `practical_lantern_glow` (the shrine's stone
  lanterns), `practical_vend_front` and `practical_vend_rows` (vending machines), `practical_lighthouse_lamp`. A runtime
  switches them on at dusk by scaling their emissive intensity; their base colour is the unlit glass, paper or bulb (a
  dim, greyed version of the glow), so off reads as an unlit lamp. The sun disc, the glitter and the crossing's signal
  lamps stay `<name>__emit` (always on).
- Moving extras (`extras.py`, created by the bake): the train (`train.glb`, entity `cw-train`), a two-car commuter train
  baked over the open sea (lit by the sun and the sky alone) and moved to its rest just inside the east tunnel for the
  export, length along Blender x; and the gulls (`birds.glb`, entity `cw-birds`), twelve birds circling over the harbour
  mouth in one 16 s looping clip (circling, a bob, banking, flapping in bursts between glides; one unlit vertex-colour
  material, double-sided). The model loader centres a model on its frame-0 bounds, which the entity position matches.
- Cloth in the wind (`laundry.glb`, entity `cw-laundry`): the laundry lines nearest the stair, two yard lines and the
  shop's two nobori banners are built as `sway_*` objects (`common.sway_object`) whose origin is the line they hang from
  (the pole, for a banner). The bake gives them one 1024 px atlas, then splits it back into a node per line (16 nodes,
  one material each), every node turned about its own line by one 6 s looping clip: a lean toward the onshore breeze, a
  slow swing (a 3 s beat) and a quicker flutter, each line on its own phase. The other lines stay still in `props`.
- Foam on the water's edge (in `glitter.glb`, on its clip, now 8 s: the twinkle's 2 s pattern four times): broken
  white strokes along the quay's sea face, both sides of the breakwater and the headlands' waterline (where `ground_z`
  crosses the sea level), in four drawings each a little further out, shown one at a time on half-second steps (a lap
  of the swell rolling in and back, twice a loop), the way hand-drawn effects animate. Unlit, one material.
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
- The compositing layer of the anime look (`gpu/satsuei.ts`, built into the composite of `gpu/post.ts` whenever the world's
  look is anime and the composite runs; original, it imitates no studio or film):
  - bloom on what is brighter than white and a soft diffusion glow of the bright mid-tones, both carried by the chain's one
    bloom (its high pass takes the two thresholds);
  - light rays from the sun: each texel of a quarter-resolution pass gathers the bright sky round the sun along its line to
    the sun (24 taps), so clouds, roofs and the headland cut shafts into the glow;
  - faint lens-flare ghosts mirrored through the frame centre, a veiling glow round the sun (all hidden when the picture at
    the sun is no longer brighter than white: a roof or a cloud in front), dust motes drifting in the light;
  - a colour fringe toward the corners, the vignette, a fine display-space grain, a gradient layer (a top and a bottom colour,
    soft light, at an amount) and letterbox bars toward 2.39:1.
  - Defaults come from `environment.look.satsuei` (`diffusion`, `godRays`, `flare`, `dust`, `grain`, `chroma`,
    `gradientTop`, `gradientBottom`, `gradientAmount`, `letterbox`, all 0..1, and `sunDirection`: the painted sun piece is
    not where the sky's sun light is, so Cloudwatch names it). Cloudwatch sets `sunDirection [-0.558, 0.1005, 0.8237]` and a
    gradient of `#9a8cd8` over `#ffc89a` at 0.12.
  - `renderer.setShotGrade(g | null)` (type `ShotGrade`, `@aether/render`) moves every one of them per shot, plus exposure
    (stops), saturation and contrast (multipliers), temperature, bloom (a multiplier on the world's), the vignette and
    `practicals` (0..1, the emission of the models' lamp, lantern, window and sign materials; the sun disc and the glitter
    are left alone). Uniforms only: the programs are linked at load, so a cinematic animating it links nothing. The low
    tier drops rays, flare and dust by their amounts; a tiled capture drops what depends on the frame.
  - `scripts/blender/cloudwatch/satsuei-shots.ts` shoots it through the post chain (`aether-shots.ts` draws without it) under
    a colour script: `world`, `off`, `afternoon`, `golden`, `dusk`, `blue`. Stills in `docs/screenshots/cloudwatch/satsuei/`.
- Start mode `story` (profile `showcase`): the world opens on its short film (see The film below); P plays as Kaho,
  Tab or O explores with the orbit camera, from the film or after it.

## The film: "Two Whistles"

An original slice-of-life short of about 100 seconds, written as data in the world (`world.story`, the shot list in
`scripts/blender/cloudwatch/story.ts`, written into the template by `world.ts`). It replaces "The Last Light" (80 s, a
girl races the sunset to the lookout), which had a goal but no turn, and whose last three shots repeated one framing.

Beat sheet:

- **Goal** (1-4). Kaho's best friend Mio leaves town tonight on the evening train, which Mio's father drives. Class ran
  late; Kaho races from the harbour road up to the level crossing to say goodbye ("6:31. Mio's train passes the crossing
  at 6:40.").
- **The turn** (5-8). The crossing bell; she arrives as the train is already passing; she waves, it does not stop
  ("Mio—!"); a Dutch-tilted close-up as it goes; a held silence on the empty crossing ("…I didn't even say goodbye.").
- **Memory** (9). Low against the sky she remembers Mio's promise: "If you ever miss me, run to the lookout. Dad always
  whistles twice at the cape."
- **The run** (10-14). The whole hill stair: high and wide down it, through the shrine gate on a long lens, a held "ma"
  on the cloud and the gulls, an insert of her feet on the last steps, the reverse from the lookout as she climbs in.
- **Payoff** (15-19). At the rail, over her shoulder toward the cape; two long whistles carry over the water; close and
  low she waves ("…See you, Mio."); the camera cranes up and back to the whole town, the sea and the sun touching it as
  the lamps come on.
- **Coda** (20). The town at blue hour from the harbour; the end card.

Storyboard: `docs/worlds/cloudwatch-concept/storyboard-{1,2,3}.webp` (generated reference, eighteen panels). The railway
cannot be seen from the lookout (the terraces' houses hide it), so the payoff is heard, with a caption for viewers
without sound, rather than shown.

| # | Shot | Length | Grammar | Lens |
|---|---|---|---|---|
| 1 | The sky over the sea, the title | 8 s | fade in, tilt down from the cloud to the glitter | 50 deg |
| 2 | Insert: her loafers on the road | 2.6 s | ground-level tracking alongside | 36 deg |
| 3 | The harbour road | 5 s | long lens into the low sun, she runs away from us; first line | 8 deg (telephoto) |
| 4 | The first steps | 4 s | leading three-quarter front, tracking up with her | 34 deg |
| 5 | Insert: the crossing lamps | 2.2 s | low, the bell starts | 24 deg |
| 6 | The crossing | 6 s | side-on, she in the right third, the train crosses the frame against her | 34 to 30 deg |
| 7 | Her face, the train behind | 3 s | close, Dutch tilt 11 to 13 deg (the only one) | 19 deg |
| 8 | Too late | 4.2 s | held wide, no move | 36 deg |
| 9 | She remembers | 6.4 s | very low, looking up at her against the sky and the cloud; push in | 27 to 24 deg |
| 10 | Down the stair | 5 s | high and wide, she climbs toward us | 44 deg |
| 11 | The shrine gate | 5 s | long lens from above the gate, framed by its posts, the sea behind | 22 deg |
| 12 | Ma: the cloud and the gulls | 4.5 s | held, a slow eased pan | 46 deg |
| 13 | Insert: her feet on the last steps | 2.6 s | low, leading down the stair | 30 deg |
| 14 | The last stair | 5 s | reverse from the lookout, push in | 34 to 25 deg |
| 15 | Arrival | 4.2 s | low three-quarter, she turns to the sea | 27 deg |
| 16 | Toward the cape | 5 s | over her shoulder | 24 deg |
| 17 | Two whistles | 4.6 s | long lens on the cape; the sound carries it | 9 deg |
| 18 | See you, Mio | 5.2 s | close, low and frontal; she waves | 24 deg |
| 19 | The crane up | 12 s | from behind her low, up and back on a spline to the town, the sea and the sun | 40 to 52 deg |
| 20 | The town at blue hour | 7 s | fade; from the harbour, windows lit | 40 deg |

- Cinematography: her way is screen right all film long; the cameras keep to the inland or east side of her line, which
  also puts the low sun ahead of the lens (back light and warm rims instead of flat front light); the train runs against
  her, screen left. Inserts (shoes, lamps, feet), a low angle against the sky, a high angle down the stair, two long-lens
  shots that compress the town and the cloud, one over-the-shoulder, one reverse, one Dutch tilt at the turn, one crane.
  Moves are eased (`inOut`); tracked shots aim through a lag (`trackLag`, a camera operator's weight); the crane runs on a
  centripetal spline through a `via` pose.
- Colour script: warm afternoon, golden, magenta dusk, blue hour, as `grade` / `gradeTo` on the shots (now with a little
  more contrast); the crossing lamps light for their insert (they are practicals), the town's lamps come on in the crane.
- Sound (`apps/studio/src/player/story-audio.ts`, WebAudio, all synthesized, nothing loaded): an original score in cues
  (`intro`, `run`, `tension`, `hush`, `hope`, `climax`, `coda`) built from a two-note motif (a rising sixth and a step
  down, the two whistles), an ambience bed (wind, waves, cicadas, gulls, the town) set per shot, and one-shot sounds
  (the crossing bell, the train passing with its rail joints and Doppler, the whistle with the valley's echo, gulls,
  steps, a gust, a chime, a heartbeat). M or the Sound chip mutes it (remembered); the player's volume and music levels
  apply; a browser that holds sound until a gesture starts it on the first key or click.
- The end: after the last shot the picture holds black under the end card's title for 0.8 s, then the black lifts over
  2.4 s onto the live world in the last shot's view and grade; Play, Explore, Watch again and Sound sit over the living
  scene on a soft scrim. Before, the end card stayed on full black (the story frame's fade was 1 for as long as the
  card showed), which read as a broken black screen. The same holds after a skip: the camera goes to the last shot's view.
- Kaho's feet on the stair: her path is laid on the ground every 0.5 m as before, and where it climbs the runner also
  samples the treads every 6 cm from the solid pieces' collider triangles (`TriangleGround`, vertical rays on a 2 m grid:
  a few thousand samples in milliseconds; the renderer's scene ray took about 50 ms each), and the rig places each foot on
  them (`CharacterRig.ground`): the pelvis drops by the lower foot's share and two-bone IK bends each leg, keeping the
  clip's swing height.
- Story format: all additions are optional fields (`camera.roll`, `via`, `trackLag`, `music`, `sounds`, `ambience`,
  `actions`); a story without them plays as before.

## Play

The pieces people stand on (terrain near and far, the stair, lookout, harbour and railway, the houses, the shrine) are
static triangle-mesh bodies (`physics: { collider: 'trimesh' }` on a `model`): the simulation asks the renderer for the
loaded model's triangles (`WorldRenderer.modelColliders`, `geometry/model-colliders.ts`; outline shells and transparent
cards left out). Before this, no entity had a body and the world had no ground, so the character fell from the spawn
forever. The player spawns at the foot of the stair on the harbour road; from the film, at Kaho's place at the lookout.

## How to rebuild

```
blender -b --factory-startup -P scripts/blender/cloudwatch/build.py -- --out <dir> [--size 3840x2160] [--shots A,B,C,D,S,P]
blender -b <dir>/cloudwatch.blend -P scripts/blender/cloudwatch/check_props.py -- --json <dir>/gate.json # the gate
blender -b <dir>/cloudwatch.blend -P scripts/blender/cloudwatch/bake_export.py -- --out <web> --samples 64
blender -b <dir>/cloudwatch.blend -P scripts/blender/cloudwatch/bake_preview.py -- --out <dir> [--shots A,B,C]  # the bake's look in minutes
blender -b --factory-startup -P scripts/blender/cloudwatch/glb_shots.py -- --glb <web> --out <dir> [--shots A,B,C,T]  # stills of the baked pieces
npx tsx scripts/blender/cloudwatch/world.ts <web>    # copies the pieces, writes the template in canonical form
STATIC_DIR=<dist> AETHER_FULL_QUALITY=1 AETHER_RENDER_TIER=high npx tsx scripts/blender/cloudwatch/aether-shots.ts --out=<dir>
```

Run Blender under `systemd-run --user --scope -p MemoryMax=8000M nice -n 10`. The bake runs on the CPU by default: on a
shared GPU with little free memory, an OptiX bake came back black without an error, and so did a CUDA bake on a GPU busy
with another job. `--gpu CUDA` (or `OPTIX`) asks for it anyway; every GPU bake is checked and a black one is baked again
on the CPU.

`bake_preview.py` renders the shot cameras in Cycles with the passes the bake reads (diffuse direct and indirect light,
diffuse colour, AO, emission, the terminator-break noise as an AOV, position) and runs the bake's own finish
(`common.finish_np`) on them: the lighting and the ramp can be tuned in a minute a shot instead of a full bake.
`glb_shots.py` imports the baked glb pieces into an empty scene (unlit, as the browser draws them) and renders the shots;
shot T is a close-up of the train, moved out of the tunnel for it. The EEVEE toon stills of `build.py` show the toon
materials (the same ramp and occlusion, EEVEE's own shadows), not the bake. A full
bake takes about 35 minutes on 32 threads (the 4096 px terrain and town atlases take most of it); `--only` re-bakes
named pieces into the same folder.

Each still renders in three passes and is composited before the glare (`shots._render_layered`): the scene without
clouds, the clouds alone with the near plane at 300 m, and the coverage of everything in front of the sky. With one pass
and a 0.1 m near plane, the creases where billows intersect 2 km away came out as depth-precision staircases at 4K.

## Result (7 November 2026)

- **Film pass** ("Two Whistles", Kaho rebuilt; see The film above):
  - Concept first: three generated design directions, the chosen one's turnaround, expressions, details with the palette
    and a silhouette study, and three storyboard pages (`docs/worlds/cloudwatch-concept/`, generated reference only).
  - Kaho rebuilt to the sheet (`docs/screenshots/cloudwatch/character/kaho-vs-sheet.webp`, before/after
    `before-after/16-kaho-before-after.webp`): bob in clumps, bangs on the forehead in profile, the braid and shell charm,
    sky-blue collar, teal neckerchief on springs, twelve pleats to the knee, the watch; the hands clear the skirt (arms 6
    degrees out, forearm colliders, springs checked at the link's middle); the head no longer turns on its own standing.
  - The film: twenty shots, the grammar and lenses in the table above; contact sheets before and after in
    `before-after/15-film-before-after.webp`, frames in `story/`.
  - Six passes of contact sheets, each critiqued for framing, screen direction, subject size and lens; what changed:
    the stair profile shot that framed a blank embankment became a leading three-quarter front with the stair and the sea
    behind; the Dutch close-up and the arrival were moved round to three-quarter front (from the back of her head); the
    gate shot's camera was inside the shrine hall (solid purple) and the feet insert's inside a wall; the mother and
    child crowded her at the crossing, so she waits a step to the right; the train passed outside the frame at the
    crossing; the railway proved invisible from the lookout (probe views at eight points along it), so the payoff became
    the sound of two whistles over a long lens on the cape.
  - End of the film: the black screen after the end card is gone (the card now fades onto the live last view, also after
    a skip); `story-shots.ts` checks it (mean brightness 49 of 255 after both, threshold 25).
  - Interpenetration of her path: `story-shots.ts` reports the closest wall to her body along every laid path
    (`clearance`); the step from the stair to her waiting place came within 0.15 m of the stair's side wall and was
    rerouted; every path now keeps at least 0.33 m (a shoulder is about 0.2 m from the body axis).
  - Programs: none linked by the film's own shots (the crane's middle pose was not prewarmed and linked one at 92 s; it
    is now). A single link at a varying time in the first 13 s happens in the old build too (29 to 30), so it is not the
    film's.
  - Frame times over the whole film on the Intel GPU, old film and new back to back on a machine at load 45-70 (so the
    numbers are noisy): old p50 17.3, 24.5, 26.1, 28.9, 25.7 ms; new 26.1, 26.3, 24.9, 21.9 ms (muted 24.3, 18.7). No
    regression shows; the sound costs little and nothing when muted (its graph is suspended).
  - Size: Kaho 583 KB to 614 KB (more skirt and hair rows, the braid, neckerchief, watch and charm); the story code adds
    about 30 KB of source (the sound module loads only with a film); concept art is in docs only (1.2 MB of WebP).
- **Physical pass** (the bake read flat and washed out, the stair and the crossing most: one shadow value, no contact
  shadow, cast shadows faint; the train a box; houses boxy; nothing moved but the glitter and the gulls):
  - Light: a physical sun and Nishita sky at a measured 6 : 1 key to fill, four bounces, an AO contact pass and Open Image
    Denoise, banded by a five-band ramp in stops (see Lighting plan). Long house, pole and railing shadows now cross the
    lanes and the road, creases hold a contact band, sunlit walls warm against violet shade
    (`before-after/15-bake-hero.webp`, `16-bake-stair.webp`, `17-bake-crossing.webp`: before left, after right, the baked
    pieces rendered by `glb_shots.py`).
  - Atlas: islands under ~1.25 texels leave the pack before it is redone (they are shaded per vertex anyway), so walls,
    roofs and ground get the freed room (the town had 25k such islands, each holding a box with margins). Pieces now
    export one primitive per distinct material: the town drew 65 primitives for 3 materials, the props 67 for 6; the
    pieces hold 81 primitives in all (from 239), the 16 laundry nodes and 4 foam drawings included.
  - The first crisp shadow-side steps showed the bake's residual noise and the bounce as blotches between shade and open
    shade on walls and lanes; those two steps are now soft (0.4 / 0.6 stops) and the indirect light is clamped. A sun-only
    pass that picks the sunlit bands by the sun alone (`RAMP["sun_mask"]`) is written but off until judged.
  - Train: a real two-car EMU to scale (see Setting), single-arm pantograph to a new overhead line (masts, cantilevers,
    messenger in catenaries, contact wire at 5.0 m) (`before-after/18-train.webp`). The train is now 40.9 m long (was
    31.7); its base and centre line are unchanged, so the story's path still applies.
  - Houses: window frames of four bars standing 0.1 m proud with the glass set back, tile courses as wedges on every
    tiled gable slope (no outline shell on them), the stair rebuilt to 0.17 m risers, 0.29 m treads and landings, its
    handrail following the landings. Telegraph wires hang in true catenaries (`common.catenary`).
  - Motion: `laundry.glb` (16 swaying lines and banners) and the shoreline foam flipbook on the glitter clip (now 8 s).
  - For the film: the first car's sea-side middle bay has two open windows onto a lit saloon (floor 1.15 m over the
    rail, longitudinal seats, grab poles, a light strip), and a western shore line (`form.build_west_line`): a low
    viaduct on piers along the western headland's cove-facing waterline from a portal by the quay's west end to a
    portal in the cape, with its own overhead line, the forest kept off it (shot W in `shots.py`: from the lookout,
    205 mm; the nearest west houses and trees still cover part of it from the lookout's middle).
- **Gate** (this pass): 78 props checked, 0 failed; the one touching pair is the mother's and child's hands.
- **Budget** (this pass): 17 pieces, 561 k triangles, 24.5 MB (from 16, 484 k, 21.4 MB): town 169 k / 10.0 MB (from
  125 k / 8.6: window frames, tile courses, a fuller atlas), infra 68 k / 2.9 MB (stair landings and nosings, the
  overhead line), train 10.5 k / 0.62 MB (from 3.5 k / 0.2: a 2048 px atlas for a hero seen at 5 m), laundry 2.9 k /
  0.22 MB (new), glitter 14.5 k / 0.36 MB (foam), the rest within a few per cent of before.

- **Painterly pass** (the look pass read as clean digital cel art: flat vector fills, one shadow value in the clouds, no
  depth past the headland; method step 6):
  - Brush strokes in every painted surface and a broken terminator (`before-after/11-stair-brush.webp`). The first
    strokes (noise squeezed 2.6 times, 11 % value swing, strong distortion) read as marbled, dirty plaster on the walls
    by the stair; they are now long and level (squeezed 4.5 times), 8 % and barely distorted.
  - Clouds in four values with broken edges, a lilac inner glow and a sun-bleached edge (`before-after/9-cloud-values.webp`).
    The first edge break (a fine 35 m noise) spotted the plateaus of the light with lit dapples; the break is now a
    single broad 80 m octave, which moves band edges in big painted lobes.
  - The sky: a ten-stop gradient per side (a lemon-gold rim, apricot, coral rose, a lilac turn, periwinkle, a
    saturated cobalt above) under soft level strokes.
  - Atmospheric perspective: the headlands, the far forest and the hill tops go bluer and lighter with distance, and
    far coast layers sit on the horizon under the tower and west of the headland (`before-after/12-far-coast.webp`,
    `14-aether-harbour-haze.webp`).
  - The sun path: 2300 glitter streaks (from 1400) over a wider path. A first try that also widened and brightened the
    warm column in the water and pushed the streaks to 4.2 / 7.5 bloomed into one white blob under the sun; the column
    is back as it was and the streaks are 3.6 / 5.0, so the path reads as separate sparks
    (`before-after/10-glitter-haze.webp`).
  - Lived-in detail readable from the stair and the lookout: the house name boards are up to 0.42 m letters (from 0.2),
    the roof billboard up to 0.75 m, two new boards along the stair (`KUMOMI SHRINE`, `KISSA NAGI`), more futons over
    balcony rails; the lookout has a vending machine, a 4.5 m street lamp, potted plants and a bicycle.
  - Outlines wobble in width along their length; foliage clumps have notched, broken edges.
  - Practicals: lamps, lanterns, lit windows and vending machines export as `practical_*` emissive materials with an
    unlit-glass base colour (see Bringing it into Aether).
  - Moving extras for the film: the train (`cw-train`) and the gulls (`cw-birds`). The static schoolgirl at the lookout
    rail is gone (the world's animated girl stands there).
  - Before/after: `before-after/8-painterly-hero.webp` (Blender, shot A) and `13-aether-hero.webp` (Aether, shot A).
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
- **Gate**: 78 props checked, 0 failed (0 floating, 0 buried). One pair touches within tolerance: the mother's and
  child's joined hands, 1.4 cm.
- **Budget**: 16 glb pieces, 484 k triangles, 21.4 MB (20.5 MB / 485 k before the painterly pass, 376 k / 11.9 MB
  before the look pass):

  | Piece | Triangles | Size |
  |---|---|---|
  | town | 125 k | 8.6 MB |
  | props | 101 k | 5.2 MB |
  | infra | 53 k | 2.6 MB |
  | forest | 99 k | 1.8 MB |
  | people (six figures) | 45 k | 1.2 MB |
  | trees | 34 k | 0.7 MB |
  | terrain near / far | 2 k / 5 k | 0.8 / 0.1 MB |
  | sky | 9 k | 0.3 MB |
  | birds (12 gulls, a 16 s clip) | 0.3 k | 0.3 MB |
  | clouds (8 cards) | 16 | 0.23 MB |
  | train | 3.5 k | 0.2 MB |
  | glitter | 4.6 k | 0.15 MB |
  | sea | 1 k | 0.1 MB |
  | shrine | 0.6 k | 0.06 MB |

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
  - The front name boards stay at 0.3 m letters (between the storeys there is no more room); from the lookout only the
    back boards and the roof billboard read.
  - The far coast is painted on the dome at about 11 texels a degree: soft at 4K, and in Aether (the sea pulled in to
    1.4 km) it stands about 0.7 degrees taller than in Blender.
  - The brush texture lives in the 4096 px town atlas: up close (a metre from a wall) it is soft rather than crisp.
  - The laundry, futons and banners do not sway; the train is a simple box design.
  - (Fixed in the film pass below: Kaho's head turning on its own in a held close-up, and the film's missing sound.)
  - No in-browser video export of the film yet.
  - The futons and the laundry lines away from the stair do not sway (draw budget); the foam is a flipbook, not a
    simulation.
  - Kaho's head turns on its own in a held close-up (the rig's look-at), so the film shows her from behind or at a
    distance rather than face-on.
  - The film has no music or sound of its own yet, and no in-browser video export.
  - In a headless capture the clock is frozen, so the glitter's twinkle shows only in the browser. Its clip was checked
    by stepping the animator in Node.

# Cloudwatch Harbour: concept art (generated, reference only)

**These images are generated concept art.** They were made with an image-generation model from written briefs (the
prompts are in `prompts/`), as design reference for Kaho and for the storyboard of the film "Two Whistles". They are
not part of the world and nothing in the world is traced or textured from them: the 3D body is built by code
(`scripts/characters/anime-kaho.ts`, `scripts/characters/kaho/`) and the town in Blender by scripts. The briefs ask for
an original character and an original film, resembling no existing character, studio or artist.

## Kaho

| File | What |
|---|---|
| `kaho-variant-a.webp`, `-b`, `-c` | Round 1: three hair and silhouette directions on the same uniform |
| `kaho-turnaround.webp` | The chosen design (variant B, chin-length bob and a braid behind the left ear): front, left profile, back, with head-height guides (about 6.5 heads) |
| `kaho-expressions.webp` | Expression sheet: neutral, out of breath, alarmed, sad, remembering, smiling through tears |
| `kaho-details.webp` | Hair as 7-9 clumps, the braid and seashell charm, collar and neckerchief, the twelve knife pleats, loafer, wristwatch, and the colour palette |
| `kaho-silhouettes.webp` | Silhouette study: front, side, back, running, waving, looking up |

Why B: the short bob and the single braid with its charm read at a glance in every view (the silhouette study), the
asymmetry gives her a profile that is hers, and a chin-length bob has a clean outline in profile and leaves the
collar and neck clear (the old ponytail and long side locks clipped and stood off the head).

What the 3D body takes from the sheet: the proportions; the bob in large clumps with the tips curling in; bangs parted
a little to her left and laid on the forehead (they follow the skull in profile); the braid behind her left ear with the
seashell charm, on two spring bones; brown eyes; the sky-blue collar with two white lines; the deep-teal neckerchief
with two pointed tails on spring bones; the chest pocket; plain short sleeves; the knee-length skirt in twelve knife
pleats; white socks, brown loafers; the black digital watch on her left wrist; the palette row. Shots of the model
against the sheet are in `docs/screenshots/cloudwatch/character/`.

## Mio

| File | What |
|---|---|
| `mio-turnaround.webp` | Kaho's friend Mio: front, left profile, back (made after her first build, from the brief in `prompts/r4-mio.txt`) |
| `mio-expressions.webp` | Her expressions (with two fingers, waving through a window) and palette |

Her model was rebuilt against this sheet by the character pipeline (`scripts/blender/character/briefs/mio.json`):
`docs/screenshots/cloudwatch/character/mio-vs-sheet.webp`. The skirt is fitted to the sheet's width and depth per
height, the cardigan is buttoned with its pockets and ribbed hem, and the silhouette check segments this pale sheet by
its line art (IoU 0.87).

## Old Genzo (the harbour fisherman)

| File | What |
|---|---|
| `harbour-fisherman-turnaround.webp` | Front, left profile, back of the fisherman on the quay (brief: `prompts/r6-fisherman.txt`) |

Built against it by the pipeline (`briefs/harbour-fisherman.json`) and placed on the quay as `cw-genzo`:
`docs/screenshots/cloudwatch/character/harbour-fisherman-vs-sheet.webp`.

## Storyboard

`storyboard-v2-1.webp` and `storyboard-v2-2.webp`: twelve panels for the second film (Mio seen: the promise, the
window, two fingers through the glass, the viaduct, the wave). `storyboard-1.webp` to `storyboard-3.webp`: the first
version's eighteen panels for the beat sheet (see "The film" in
`../CLOUDWATCH_HARBOUR.md`). The shot list in `scripts/blender/cloudwatch/story.ts` follows them, adjusted where the
real town's geometry decides (the railway cannot be seen from the lookout, so the payoff is heard from the cape).

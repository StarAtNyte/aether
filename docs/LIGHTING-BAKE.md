# Re-lightable baked light (7 November 2026)

A building's baked light (the light volume, `environment/light-volume.ts`, and the lightmap, `environment/lightmap.ts`) is
baked once, at publish, and never again: changing the time of day only re-weights what was stored. Code: `environment/relight.ts`
(the parts and their live weights), `gpu/light-volume-node.ts` (the shader), `scripts/cook.ts` (the publish bake).

## Decisions

- **Baking happens at publish (the cook).** A viewer (the player) loads the cooked package's lightmap and light volume and never
  bakes. The editor draws real-time light; **Display options → Preview baked light** bakes the publish bake in the background
  (a worker, through the page's worker scheduler) and shows it. The world's `environment.lightBake` is the publish quality
  (`off`: no baked light).
- **Re-lightable.** Direct sun stays real time (the shadow map). What is baked is the light that arrives after bouncing, as a sum
  of parts, each baked for a unit source; the live light weights them.
- **No program changes when the hour changes.** The weights are uniforms; the texture is allocated once per atlas size.

## The representation

Light transport is linear in its sources and does not mix colour channels, so the bounce light is exactly a weighted sum of:

| part | baked under | live weight (per channel) |
| --- | --- | --- |
| `sky0` | ambient `a = 1, b = 0` (the constant term of the sky hemisphere and image light; the open ground lit by it) | `ambient.a` |
| `sky1` | ambient `a = 0, b = 1` (its gradient `b · n.y`; signed) | `ambient.b` |
| `lamp` | every lamp at full strength | the lamps' daylight scale × the look's lamp strength |
| `sun k` | a white sun of irradiance 1 from key direction `k` (and the open ground it lights) | sun colour × intensity × the key's weight |

plus the sky visibility (`vis`, ambient occlusion of the sky), which depends on the geometry only.

**Sun keys.** The sun moves along a fixed arc (`sky-state.ts` `sunPosition`), and a drag of the daylight study holds it at a few
hours for whole stretches of the slider (the dawn sky clamps to 06:23–07:00, the sunset sky to 17:00–17:37). The keys are those
dwell hours and the worlds' default hours (6.38, 7, 8, 12, 13, 17, 17.62), then more at the angular middle of the widest gap until
there are 14, plus the moon's fixed direction: 15 keys. A sun between keys takes the two nearest, weighted linearly by angle.

**Storage.** The keys differ in where their light lands, hardly in its colour (the colour of the surfaces it bounced off; the
sun's own colour is a live weight). So each key is stored as luminance, three to a layer, and one shared chroma per texel (the
sum of the keys' RGB) colours them:

| lightmap layer (RGBA8, alpha = `vis` in every layer) | contents |
| --- | --- |
| 0 | `sky0` RGB |
| 1 | `sky1` RGB, signed around 128 |
| 2 | `lamp` RGB |
| 3 | the sun keys' chroma (RGB over its largest channel) |
| 4–8 | the 15 keys' luminance, three per layer |

Unsigned values are logarithmic over 16 stops below each value's 99.9th-percentile texel (`encodePart`); the signed sky gradient is
sqrt-coded. The light volume stores the same parts as L1 SH per probe: `sky0`, `sky1`, `lamp` as RGB (12 floats each), the keys'
chroma, and each key's luminance (4 floats): 100 floats per probe instead of 16 for one hour; it is combined for the live light
on the CPU (`combineVolume`, a few milliseconds) and only its bounce sub-volumes are re-uploaded.

### How it was chosen

Measured on Casa del Patio (25 k trace triangles, 234 meshes, 19 k probes; lightmap at medium: 512² atlas, 58 k texels, 48 rays)
in Node (the building's bake inputs dumped from the studio, the bakers run directly) against an exact reference: for each hour, a bake whose only sun key is that hour's sun direction (the
old single-time bake). The error is the RMS, over covered texels, of the difference in irradiance a surface receives on screen
(the bounce plus the sky through `vis`), relative to its mean. Two bakes with identical keys differ by 0.7–1.5 % (denoiser
weights), the floor of this measure.

| day keys (+ moon), placement | worst hour, on-screen RMS | where | GPU at 512² / 1024² |
| --- | --- | --- | --- |
| 4, even by angle over 06:06–17:54 | 48 % | 07:00 | 8 / 32 MB (RGB per key) |
| 6, even by angle | 35 % | 07:00 | 10 / 40 MB |
| 8, even by angle | 24 % | 17:00 | 12 / 48 MB |
| 8, even by hour | 43 % | 07:00 | 12 / 48 MB |
| 12, even by angle | 27 % | 07:00 | 16 / 64 MB |
| 7, the anchors only | 22 % | 15:30 | 11 / 44 MB |
| 10, anchors + fill | 7.6 % | 08:30 | 14 / 56 MB |
| **14, anchors + fill** | **4.0 %** (4.5 % with shared chroma) | 08:30 | **9 / 36 MB** (luminance + chroma) |

Low sun is where a key set fails: at 07:00 the morning sun clears the patio wall, and the bounce at 07:00 is not the mean of
06:40 and 07:16. Anchoring the keys at the hours the sun dwells at removes those errors where people look, and the fill keeps the
rest under 5 %. Storing keys as luminance with one chroma costs half a point and makes 14 keys cheaper than 6 in RGB.

Codings of the stored bytes (quantisation alone, against the unquantised parts, worst hour):

| coding | RMS | p99.5 | worst texel |
| --- | --- | --- | --- |
| sqrt over the 99.7th percentile (the old lightmap's) | 72 % (night: lamps clip) | 4.5 % | 90 % |
| sqrt over the maximum | 1.4 % | 5.7 % | 27 % |
| cube root over the maximum | 1.1 % | 2.9 % | 11 % |
| **log, 14 stops, over the maximum** | **1.1 %** | **2.4 %** | **7 %** |

The shipped coding is 16 stops over the 99.9th percentile: in the browser bake a lamp's own shade, a centimetre from the light,
took 3,000 times what the walls take (lamp scale 161 against about 0.05 on the walls), so over the maximum the walls' lamp light
sat at the code's floor and flickered between it and nothing from texel to texel (a speckle on lamp-lit walls at night). The
0.1 % that clip are those shades, whose own glow hides it.

## Runtime

- `LightVolume.relight` turns the live light into uniforms: the sky and lamp weights times each layer's scale, the sun's
  irradiance, and for the two keys around the sun their layer, channel and weight. `WorldRenderer.liveLighting` reads the sky
  state's sun direction (not the light's position, which the shadow fit moves a frame later).
- The lightmap branch of the light node reads layer 0 and 1 always, the lamp layer when the lamps are lit, and the chroma and one
  or two key layers when the sun (or moon) is up, behind uniform branches.
- A live drag re-weights the lightmap every frame and the volume at most every 100 ms (`RELIGHT_LIVE_MS`); the last value
  always reaches it.

## Bake at publish

`scripts/cook.ts` bakes in the last recording session of a world with buildings (default high: 1024² atlas, 32 texels per metre,
256 rays per texel; `--bake`, `--samples`): the page's light volume, then its lightmap worker. The files go to
`<id>/light/<key>.lmap`, `<key>.lvol` and `index.json`; the manifest's `lightmap` is `{ base: "light/", version }` (relative to the package folder). A viewer
reads them only when `version` is its own `BAKED_LIGHT_VERSION`; an older package loads without baked light, and the template
refresh (`scripts/cook-upload.ts`) counts a building template whose package has no current baked light as stale.

### From the editor

A world published from the editor (Publish → Fast-loading link, `apps/studio/src/publish/cook-publish.ts`) gets the same
baked light, made in the publisher's browser: `WorldRenderer.publishLightBake` waits for the light volume on screen, takes the
page's bake job (`LightmapController.bakeJob`, high: 1024², 256 rays, or the world's `lightBake`) and bakes it

- on this computer when the studio is served by the local server: `POST /api/local/bake/lightmap` (apps/server
  `local-bake.ts`) runs scripts/blender-bake.ts as the Node cook does (Cycles on the GPU, else the threaded CPU baker), the job
  sent as `.lbjob` (render `encodeBakeJob`);
- else on the page's workers (`view/publish-bake.ts`): one lane per worker of the page's budget, `max(1, cores − 2)`, and no
  more than fit in a quarter of `navigator.deviceMemory` (4 GB assumed when unknown) at the job's estimated size per worker
  (`laneBytes`, about 100–150 MB for a house) plus the finishing worker's whole atlas (`finishBytes`); each
  taking a `bake` token of the worker scheduler before its worker gets work (so at most the budget less one bake at once, and
  none while the view moves or a drag runs); the job cut into three shares per lane (`LightmapBaker` `split`, every `count`-th
  covered texel, a share keeping only its own texels); one worker finishes from all the shares (denoise, encode, the lossless
  image, `packAsset`), so the main thread only posts messages and sums progress.

The first worker gets the job itself (transferred) and copies it to the others over channels; walls the editor's view has
sectioned are baked as built (their trace copies, lit and with normals), so the editor bakes the meshes a viewer draws. The
publish dialog shows the bake's progress, its worker count and an estimate of the time left, and Cancel stops every worker.

A viewer whose package has baked light keeps the light volume's parts even when the performance ladder cuts the volume (they
are loaded from the package and never drawn, `LightVolumeController.setShown(false)`): the lightmap is applied against them,
so a weak GPU still gets the baked lightmap. This is the player's own behaviour; no package needs cooking again. Only worlds
that bake publish light (a building, `lightBake` not `off`). The files go to `light/` in the package with the manifest's
`lightmap` naming them (`files`: the upload function only accepts a package whose files are all listed); the upload sends the
`.lmap` (about 5.5 MB for Casa del Patio, over one request) in 4 MB chunks it joins again.

Keys: a lightmap file is named by the building (geometry rounded to 2 cm, the plan's atlas size and density, the volume grid, the
sun keys, the lamps at full strength), never by the light, so the hour never misses it.

## Results (Casa del Patio, Intel UHD 770, WebGL2, shared office PC under load 35–45 on 32 threads)

**A time-of-day drag** (`scripts/baked-light-probe.ts --drag`, the player on the cooked package; slow drag 10:00–16:00 over
3 s, then fast across dawn, day, sunset and night and back, then released):

| | before (live, its single-time bake) | after (cooked, re-lightable) |
| --- | --- | --- |
| bakes during a drag | volume and lightmap restarted at the first value | 0 |
| bakes after release | light volume and lightmap rebaked (settled after 9.4–29 s) | 0 (settled after 3.0–4.6 s) |
| program links during a drag / after release | medium: 3–7 / 1–2 | 0 / 0 (low and medium, five runs) |
| frame p95 during the slow drag | low 267–283 ms (13 long tasks up to 347 ms), medium 200–233 ms | low 50–100 ms, medium 33–67 ms |

A still player page links programs on its own once the view rests (idle priming of the cooked set: 39 links in 12 s after the
load); a probe that measured links "after release" right after the load counted those (4–9 in one run). With the idle stretch
taken first, the drags and their release link nothing. The editor's daylight study (`daylight-drag-probe.ts --sliders=arch`):
0 links and 0 bakes from before the drags to settled.

**Frame cost.** Frame times on this PC vary twofold between runs of the same build (another page on the GPU), so the cost of the
lightmap's reads is measured within one page (`--fetch-ab`): at 12:00, from inside, the five reads (sky, gradient, chroma, two
sun keys) against two (the sun's and lamps' reads skipped by their uniform branches), alternated twelve times: low 7.73 against
7.67 ms (+0.8 %), medium 8.63 against 9.24 ms (within noise). The single-time lightmap read one layer: the re-lightable one
costs under 1 % more on Intel at low and medium.

**Package size.** Casa del Patio cooked for low and medium: 12.8 MB, of which 8.8 MB is the baked light (lightmap 5.5 MB as a PNG
of 1024 × 10 240 at 256 rays, light volume 3.3 MB gzipped half floats) and 4.0 MB the rest (geometry 3.5 MB, programs 0.5 MB).
The old single-time lightmap at medium was 0.75 MB and was not part of the package. GPU memory: the lightmap is 9 layers of
1024² RGBA8, 36 MB (9 MB at 512²); the old one was one 1024² layer (4 MB).

**Bake time at publish.** 1024² atlas, 416 k texels, 256 rays, 15 sun keys: the page's single lightmap worker took 940 s; the
cook's bake outside the page on 12 threads (`scripts/blender-bake.ts --cpu`, the same baker split by texels) 67 s (91 s with the
job's transfer and the volume). Cycles on the RTX 4090 is used when the GPU has room (it had about 2 GB free and ran out of
memory, so the cook fell back to the threaded CPU bake).

**Pictures.** Editor, fixed poses (exterior, living room, main bedroom, kitchen), daylight study at 06:30, 12:00, 18:30 and 22:00,
high tier, the old build baking its medium lightmap again at every hour (9 bakes) against one medium preview bake re-weighted
(1 bake). Mean absolute difference per pixel 1.1–14.7 / 255 indoors (mean brightness within 2–13 %), exterior 2.5–6.7 except
12:00 (54: the eye's adaptation after the jump outdoors, not the baked light). Images: the compare folder of the report.

## Known limitations

- **Interpolation between keys** is linear in the angle: off the keys the bounce is within 4 % of an exact bake on Casa del Patio
  (8:30 and 10:00 worst); a building whose openings catch a low sun at one hour and not the next can do worse between keys.
- **Lamps** form one group with one live scale (the architectural lamps' daylight dimming and the look's lamp strength); a lamp
  switched off in play keeps its bounce.
- **The CPU bake's later bounces** come from the light volume (0.45 m probes), which lets some sky light through the walls of
  closed rooms; Cycles traces every bounce (where the GPU has room). This is the old bake's behaviour too.
- The ground's bounce into the lightmap was a third of its value in the single-time bake (it added the ground's radiance, not π
  times it); it is now right, which brightens floors and walls next to open ground a little.
- **The light volume's own bake** (the editor's real-time interior light, and a viewer's when a package has no baked light)
  carries 18 parts instead of one light: 37–52 s against 26–29 s for Casa del Patio on this loaded PC, in its worker. It is
  cached by the building, so it never runs again for an hour, a sky or a lamp scale.

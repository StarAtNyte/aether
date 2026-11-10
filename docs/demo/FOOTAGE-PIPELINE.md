# Footage pipeline

How the world shots of the product film are rendered and captured so they are calm, sharp and constant. Everything is a
real render of the real app (the published, cooked world in the player, or the editor for build replays). No generative
video.

## Why a new path

The first film cut used the player's "Render video" export for the world shots. Measuring its frames (not the film, the
frames) found these causes of flicker, pops and softness:

| Source | What it does | Fix |
| --- | --- | --- |
| In-page H.264 encoder at 0.12 bits per pixel | 1.2 to 7 Mbit/s at 1080p: blocking, keyframe pulses every 2 s (luma residual 3x the lossless render), blur from rate control | raw RGBA frames are piped into ffmpeg: lossless master, then CRF 13 |
| Camera path through tree crowns | A big foreground canopy vanishes between two frames (23 grey levels over 400 px in one frame) when the path crosses it | path windows chosen to clear the crowns; LOD planned for a 4x taller picture in capture |
| One draw per frame, shadow filter noise rotating per frame | Speckled shadow penumbrae, thin lines and window frames crawl | N sub-pixel jittered draws of the same moment, averaged |
| Micro-jitter of live-sampled drone paths | Speed changes and wobble | Gaussian low-pass (sigma 0.35 s) and eased start/stop |
| First frames of a shot | Programs, history and sun map not settled (frame 1 to 3 differ by up to 22x the normal frame difference) | warm-up draws on the opening pose, never encoded |
| Sky reflection map refreshed every 120 ms of wall time | Lighting steps depend on render speed | refreshed every frame in capture |
| Half-resolution planar water mirror | Soft, shimmering reflections | full resolution in capture |
| Eye adaptation | Exposure drifts inside a shot | optional lock (`lockEye`), set for build replays |
| Blending frames across time in the edit (replay smoothing, low-fps takes blended up) | Every tree shows as 3 or 4 faded copies | forbidden: every output frame is ONE moment |

## The renderer

`apps/studio/src/player/film-frames.ts` (`renderStoryFrames`) is the picture path of `exportStoryFilm` without the
encoder: the same story runner, the same exclusive capture session, the same fixed film clock. For each output frame:

1. the world is stepped to the frame's time (water, weather, people, foliage, sky all run on the fixed clock);
2. `subframes` draws are made at that moment, each shifted by a sub-pixel offset from the R2 low-discrepancy sequence
   (`jitter` in the capture session), and averaged in 32-bit integers;
3. nothing from other moments enters the frame: temporal anti-aliasing is off in the clean mode (`taa: false`) so no
   history buffer carries a neighbouring moment into this one. A shutter greater than zero spreads the sub-frames over
   a short interval of the frame's own time (accurate sub-frame poses, never blended neighbours); the default is 0.

Capture flags (`globalThis.__AETHER_CAPTURE = { on: true, ... }`, read by `world-renderer.ts` and
`environment-rig.ts`; absent in the product, so the live app is unchanged):

* `lodBoost` (4): level of detail and distance cuts of scatter fields planned for a picture that many times taller;
* `mirrorScale` (1): the planar water mirror at full size;
* `shadowMapCap` (4096): the sun's shadow maps raised to this edge;
* `lockEye` (off): exposure pinned for the shot;
* the sky reflection map refreshes every frame, the sun's shadow map is already redrawn every capture frame, the
  performance ladder and adaptive resolution never run in a capture (the tier is fixed at `ultra`).

`scripts/demo/render-clean.ts` drives it from Node (`scripts/demo/render-clean.sh` wraps it with `nice` and a memory
cap). Raw frames go to ffmpeg as FFV1 (a lossless master) with a `.frames.json` log per clip (tier, ladder level,
adaptive scale, sun-map draws, eye EV, frame time). Shots live in `scripts/demo/film/clean-clips.json`.

```
scripts/demo/render-clean.sh --clip=lisbon-drone --size=3840x2160 --sub=16 --taa=0 --warmup=24 --trim=0.3 --out=<dir>
scripts/demo/finish-footage.sh <dir>/lisbon-drone.mkv <out>/lisbon-drone.mp4 --scale=1920:1080
```

`--mode=legacy` reproduces the old capture (one draw per frame, no flags) for before/after measurements.

## The browser

`scripts/demo/footage-browser.ts` launches the real Google Chrome (`/usr/bin/google-chrome`), headed, on the X display,
with a clean profile and the window tucked into a corner (`--browser=chrome`, default), or the bundled headless Chromium
(`--browser=headless`). `scripts/demo/gpu-probe.ts` reports which GPU a launch really renders on. On this machine headed
Chrome with ANGLE over GL picks the RTX 4090 by itself (`ANGLE (NVIDIA ... GeForce RTX 4090 ... OpenGL 4.5.0)`);
forcing PRIME offload environment variables made it fall back to SwiftShader. The frame size does not depend on the
window: the capture session draws at the requested size (up to 4096 on a side) and reads the pixels back.

## Finishing

`scripts/demo/finish-footage.sh` turns a master into a delivery clip: a restrained filmic 3D LUT
(`make-film-lut.py`: soft toe, shoulder roll-off, cool shadows, warm highlights, a small saturation trim), a screened
highlight glow, fine temporal grain, optional `hqdn3d` (last resort, off by default) and CRF 13 H.264, optionally scaled
from a 4K master to 1080p with Lanczos.

## Measuring

`scripts/demo/footage-metrics.py` reports, per clip: luminance residual (exposure pops and pulsing), per-block residual
(shadow shimmer, local flicker), difference spikes (LOD and cell pops), edge crawl, per-region water and glass shimmer
(`--region name=x,y,w,h`), `blurdetect` sharpness, and from the frames log the tier changes, ladder level, adaptive scale,
eye EV and sun-map draws. `frame-crops.py` makes 100 % crops of chosen frames side by side. `blur-stills.py` measures
stills at delivery size.

## Measured results

Lisbon drone, scout window 17 to 21 s, 120 frames, 1080p, Intel iGPU, lossless masters (`footage-metrics.py`, water region
`1150,450,700,500`). Legacy is the old capture (one draw, TAA on). The other columns are the clean path.

| Measure | Legacy | TAA on, 8 draws | TAA off, 8 draws | TAA off, 16 draws, 180 deg shutter |
| --- | --- | --- | --- | --- |
| Luma residual, max (grey levels) | 0.394 | 0.054 | 0.025 | 0.112 |
| Luma residual, rms | 0.0378 | 0.0076 | 0.0065 | 0.0133 |
| Block residual p95, worst frame | 1.72 | 0.395 | 0.413 | 0.475 |
| Difference spikes (ratio to neighbours) | 1 (4.5x, first frames) | 1 (1.9x) | 1 (1.9x) | 0 |
| Water luma residual, rms | 0.0188 | 0.0051 | 0.0062 | 0.0038 |
| Water shimmer | 0.191 | 0.148 | 0.176 | 0.164 |
| Fine-detail noise (`grain_hf`) | 10.0 | 5.0 | 6.8 | 6.5 |
| blurdetect | 4.98 | 5.31 | 4.88 | 4.91 |
| Tier changes, ladder level | 0, 0 | 0, 0 | 0, 0 | 0, 0 |

* The tier never changed in either path (the capture pins `ultra`); the adaptive scale that the live viewport had left at 0.5
  is not applied in a capture. So the tier ladder was not a source of flicker.
* TAA on ghosts moving thin structures (trees on the Lisbon hillside show faded second copies at 100%): TAA off with
  jittered accumulation of one moment is crisper (blurdetect 4.88 against 5.31) and the clean mode uses it.
* Pops found in the old windows: Lisbon 17 to 24 s, frames 134 to 135 (a foreground crown vanishes at the near plane, 23
  grey levels over one 60 px block); Sanctuary falls path, frames 62 to 63 (44 grey levels). The clean clips start after them.
* The shipped v7 world clips (in-page H.264, 0.12 bits per pixel): luma residual rms 0.0355 against 0.0104 for the same
  render lossless, spikes of 17x to 22x at frame 3 of the drone and falls clips, 20 spikes (up to 416x) in the near-static
  house clip, blurdetect 5.2 against 4.99 lossless.
* blurdetect is a content-dominated measure (flat-shaded, soft-shadowed scenes; the photoreal Blender reference scores
  6.44). It is used as a relative check only: finished Lisbon 4.01 against 4.9 for the lossless base.

Softness experiments (same fixed frame; blurdetect, lower is sharper): TAA on 4.75, TAA off 4.77, 8 draws 4.96, grain off
4.92, halation and aberration off 4.90, AO and contact and SSR off 4.77, 4K rendered and downscaled 4.78, grade diffusion
0 4.96, grade bloom 0.9 to 0.4 4.30, luma unsharp 0.8 4.34 and 1.5 3.94. A textured interior frame stays at 6.0 for every
setting. Texture LOD bias is 0 at scale 1 (the capture never scales the scene pass) and anisotropy is already 16.

Render cost (4K, 16 draws, RTX 4090 through real headed Chrome, WebGL2 over ANGLE/GL): about 7 s per frame for the Lisbon
drone, 26 minutes for a 5.8 s clip. Editor-based replays are CPU-bound (the village costs 4 to 5 s per draw whatever the GPU), so they
are rendered at 1080p with 4 draws. WebGPU: works in the real app with `--gpu=nvidia-webgpu` (headed Chrome, Vulkan flags; the engine reports `backend: webgpu`,
`nvidia lovelace`). On the Lisbon frame it renders the same picture as WebGL2 (blurdetect 4.51 against 4.49, no extra
effects or tier appear), so it brings no quality here; every clip is rendered on WebGL2 (the more tested path).

Known weak spots: one interior shot (penthouse) has a screen-space dithered penumbra on a wall reveal that the jittered
accumulation does not average out; no depth of field (the engine's DoF focuses on the orbit target, which footage paths do not set).


## Build replays

`scripts/demo/film-build.ts --probe=1 --prompt=...` runs the offline planner and writes its commits;
`scripts/demo/film-replay.ts` replays them step by step with the same clean frame path: the camera orbits the building
closely and slowly, every frame is one moment of the world, exposure is locked. The only changes to the planner's own
environment patch are the hour (golden hour) and a thinner haze.

## Rules

* Never blend frames of different moments (no frame blending, no optical-flow interpolation, no temporal smoothing in the
  edit). Anti-aliasing is done within one moment.
* Quality is pinned for the whole capture: top tier, no ladder, no resolution scaling, no streaming-dependent detail.
* Video files are not committed; clips live under `~/.local/share/aether/demo/film8/`.

## Finishing and temporal noise (measured)

Mean absolute frame-to-frame difference of a patch after removing its mean (grey levels at 1920 wide, `noise-measure.py`),
lossless master, first finish (grain 5 at 1080p, unsharp 0.8), final finish (no grain, unsharp 0.5):

| Patch | Master | First finish | Final finish |
| --- | --- | --- | --- |
| terraces-falls sky | 0.58 | 2.26 | 0.79 |
| m-lantern sky | 0.27 | 2.15 | 0.39 |
| village-market lawn | 0.73 | 2.33 | 0.94 |
| villa-pool grass (textured, moving) | 2.31 | 3.71 | 2.72 |
| lisbon-drone water (moving waves) | 1.90 | 3.65 | 2.76 |

The per-frame film grain was the whole difference (+1.4 to +3.2 levels). The engine's own grain effect and the shots' grade
grain are off in clean mode, the soft shadow filter's pattern is fixed (a static dither, never flicker) unless
`__AETHER_CAPTURE.shadowNoise` is set, and finishing has no grain (`--grain` is 0).

## Clips (film8)

`scripts/demo/film/clean-clips.json` holds the shots; `render-film8.sh` renders and finishes them, `render-replays.sh` and
`film-arch-clean.sh` do the editor-based beats. Landed: lisbon-aerial (the Lisbon pick: flies east along the waterfront at
about 6 m/s with the camera tilted down toward the river and the red bridge; the old lisbon-drone stays on disk), terraces-falls,
m-ascent, m-lantern, kepler-domes, casa-pool, penthouse-a, sweep-penthouse, cw-open, cw-shop, cw-close (face-free: characters
only from behind), highland-dawn (nearly static), villa-pool and village-market (build replays), arch-cutaway (9 s).

Findings worth keeping: the AO pass on NVIDIA GL with TAA off leaves dark streaks over cloud layers (clean mode turns AO off,
interiors keep it); a story film's end card appears after its last shot (cut it with `finish-footage.sh --frames`); editor
worlds cost 2 to 8 s per draw whatever the GPU, so replays use fewer draws; Lisbon's far shore shows an upside-down mirrored tree
strip along the top (world content, crop it).

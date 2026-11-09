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

RESULTS_PLACEHOLDER

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

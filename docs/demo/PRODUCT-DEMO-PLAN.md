# Product demo (v5)

v4 was an anime-led showreel. v5 is a product demo: it shows what Aether does, in order, and the animated short is one
proof point of about five seconds.

## What the research said

Sources: agency and tool guides on SaaS demo and launch videos (Twine, vidpros, Branded, TechSmith, Screen Studio and
Focusee guides). They agree more than they differ. They are marketing blogs, not studies, and none of them dissects
Linear, Vercel or Framer films, so those conventions are taken from the common pattern, not from a source.

- Hook inside 3 to 5 seconds, with the result or a plain promise. No logo animation, no greeting.
- One promise, then three to five workflow steps, each short, each with a verb. Show the product doing the work for
  about half the runtime.
- One call to action at the end, not several. The address on a clean end card.
- Captions burn in: most people watch with sound off, so labels must carry the story alone.
- A zoom on each meaningful click is the biggest quality step over a raw screen recording. Cursor moves smooth and slow.
- Cut dead air. Speed up waits and say that they were sped up.
- Music subtle. Sound design is light: soft clicks and whooshes on the cuts.
- Lengths: a 60 to 90 s main cut and a 30 s social cut from the same shots.

## Structure of v5

Main cut, about 86 s (`scripts/demo/film/make-edl5.py`):

| Beat | Content |
|------|---------|
| Hook | Real shot of a waterfall world. "Describe a world. Aether builds it, lights it and publishes it." |
| 1 Describe | Prompt typed, world built (offline planner, labelled), then the recorded live AI session shown whole (labelled "Live AI session, recorded, sped up") |
| 2 Edit | Select and move, swap a material, ask for a change (offline planner, labelled) |
| 3 Relight | Time-of-day slider in the editor, then the baked house day to dusk: "relit live, not re-baked" |
| 4 Architecture | One editor take of a two-storey villa: Walls menu to Cutaway (room chips with name and area), Walls down, Exploded storeys, One floor, then the floor plan. The bar is zoomed as each menu is clicked. |
| 5 Publish | Publish hub, checks, share link ("Real link, nothing uploaded") |
| 6 Share | Same player in a laptop window and a phone window |
| Kinds | House, city drone, game, colony: under 2 s each, labelled with their kind |
| Build locally | Blender character from a brief ("Local run, Blender 4.2"), then a house from a brief |
| Proof | Animated short, about 5 s, standing and sky shots only, labelled |
| End | Name, promise, address |

30 s cut: same shots, one beat each, a 4.6 s version of the wall sequence (cutaway, walls down), no chat edit and no
local run.

## Rule: the whole app is always on screen, zoom is for detail

- Every UI beat opens on the full studio window edge to edge (zoom 1 = the 3840x2160 capture fills the 1080p frame, so the
  chat, viewport, panels and top bar are all legible), holds for 1 to 2 s, eases into a zoom on what matters (a clicked
  control, a panel's text, a slider, the share link) and eases back out before the cut. Roughly half of each beat is
  on the full app.
- While the camera is zoomed in past 1.4x a small whole-window thumbnail sits in the top-left corner (inset), so the viewer
  always knows where they are.
- The live AI take (1280x720) is shown whole and uncropped.
- Captions sit low-left as a short plate over the full view, never over the action; labels for the product's own
  states ("Offline planner, no model call") sit top right.
- Zooms are framed deliberately: no panel is cut through its edge.

## Characters

Until the skirt penetration fix lands on main, no walking or running shots of Kaho or Mio are used. The anime proof is the
Cloudwatch opening (two girls standing at the rail, sky and sea), and the local-run beat shows the turntable of the
standing character and a kit house. Every character frame was checked at full size.

## Treatment

- Type: Inter (SIL OFL 1.1, the studio's own font), sentence case, no tracked capitals, no middle-dot strings. Step
  captions are a numbered plate (the steps are a real sequence): verb at 60 px, one sentence at 32 px. Notes at 28 px.
- Motion: captions rise 26 px with a cubic ease and fade; UI takes use the eased camera of `film-cut.py`, speed ramps for
  waits, one grade. The architecture take paints at about 7 fps at 4K (the renderer is the limit, not the capture), so those
  segments are `smooth`: repeated frames are dropped and the painted ones blended to 30 fps by their paint time. The wall
  changes in the viewport animate; they were captured as painted.
- Sound: `scripts/demo/film-score.py` synthesises a pad, soft pulse, plucked line, clicks and whooshes with numpy. No
  samples, no outside music. Mixed to -16 LUFS, true peak under -1 dBFS.
- Honesty: only recorded takes; the chat edit is the offline planner and says so; the live take is the real Nov 1
  recording; the split screen is two real captures of the same player, not a mock-up. The one quirk of the app seen in
  the take: choosing a floor in the Storeys menu only switches to one floor when "One floor" is picked first, so the take
  does that.

## Skills and tools used

- frontend-design: type and caption direction. It pushed away from tracked all-caps labels, middle-dot meta strings and a
  single accented word; captions became sentence case with a numbered step plate only where the content is a sequence.
- ffmpeg (zoompan, xfade, overlay with expressions, mpdecimate and framerate, loudnorm, ebur128), Pillow for cards, numpy
  and scipy for the score, Playwright with Chrome screencast for the device and architecture takes
  (`film-ui.ts --scene=devices|arch`).
- Not added: Remotion and Motion Canvas (large dependencies, not needed).

## Rebuild

    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-ui.ts --scene=devices --out=<dir>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-ui.ts --scene=arch --slug=villa-pool --out=<dir>
    python3 scripts/demo/film-cards.py scripts/demo/film/cards5.json <cards> <fonts>
    python3 scripts/demo/film/make-edl5.py <dir>
    python3 scripts/demo/film-score.py <dir>/edl5.json <dir>/edl5.wav
    python3 scripts/demo/film-cut.py <dir>/edl5.json --out <mp4> --work <work>

# Submission cut (v6, about 2:55)

v6 keeps the v5 spine (product first, numbered step plates, full app then zoom then back out, honest labels, the original
score) and uses the three minutes for the app's range, with footage that is generated frame by frame wherever a real-time
capture would stutter.

## Capability checklist (what the app does, and whether v6 shows it as a real capture)

| Capability | In v6 | Source |
|------------|-------|--------|
| Describe a world, the AI works in steps, a build log | yes | typed prompt (offline planner, labelled). The recorded live session is not in v6: its prompt and world are a Japanese tea house garden, which is out of the film |
| Watch a world being built | yes | build replay: the real patches of an offline-planner build (a village, a valley) applied in steps and rendered frame by frame (`film-build.ts`), labelled. A villa replay was also tried and dropped (it did not finish on the loaded machine) |
| Refine by chat, undo | yes | edit take (offline planner, labelled) |
| Gizmos (move, rotate, scale), snapping, materials | yes | edit take and the tour take (`film-ui.ts --scene=tour`) |
| Time of day, relight, nothing re-baked | yes | edit take, penthouse sweep |
| Rules (Logic), checks, the playability bot, Play | yes | tour take on Coin Rush, tiles of the first mosaic |
| Terrain sculpt and paint, undo | yes | tour take on Highland Trail |
| Architecture: walls up, cutaway, walls down, exploded storeys, one floor | yes | frame-by-frame render (`film-arch.ts`, the architecture state driven, fixed clock) |
| Floor plan, room chips | yes | studio take (1080p real time), a short glimpse |
| Publish hub targets: game, video, still, 3D model, floor plan | yes | hub take, second mosaic |
| Command palette | yes | tour take |
| Share link that carries the world, opens with no upload | yes | the link made with the Player address set to the live site, opened on the live site in a laptop and a phone window |
| Featured gallery, Remix | yes | captured from the live site |
| Drone tour, walk, orbit, colony, floating isles | yes | offline-rendered shots |
| Story film made in Aether, Render video | yes | "Two Whistles", rendered with the player's Render video path from current main |
| Local Blender harness: character from a brief | yes | concept sheet and turntable, then the character in the world (labelled "Local run"). The kit shop house is left out: it has a Japanese-style tiled roof |
| Photo to room | no | needs a vision model and credit; only the finished example rooms exist, not shown as a live capability |
| Look presets (anime, realistic) | no | the app has graphics tiers and time of day, not look presets |
| VR | no | no WebXR mode in the app |

## Footage rules for v6

- World footage is rendered offline with a fixed clock (`beginCapture`), 1080p, ultra tier, warm-up frames before the first
  saved frame, flat frames discarded and rendered again. UI footage is real time and is smoothed to 30 fps by paint time.
- `scripts/demo/flicker-check.py` runs on every clip and on the cut: frame gaps, black frames, difference spikes,
  luminance flicker, shimmer in static regions. `scripts/demo/take-gaps.py` reports the paint gaps of the UI takes.
- The live-site shots are page captures in a drawn browser toolbar that shows the real address of the page captured.
- The Japanese house generator is not shown anywhere.

## Rebuild (v6)

    node scripts/demo/film-fonts.py <fonts>            (Inter instances)
    python3 scripts/demo/film-cards.py scripts/demo/film/cards6.json <cards> <fonts>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-build.ts --prompt="..." --out=<dir>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-build.ts --patches=<patches.json> --out=<dir>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-arch.ts --slug=villa-pool --out=<dir>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-ui.ts --scene=tour --kind=game|land|publish --slug=<world> --scale=1 --out=<dir>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-ui.ts --scene=publish --slug=villa-pool --out=<dir>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-ui.ts --scene=devices --link=<dir>/link.txt --out=<dir>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-ui.ts --scene=livehome --out=<dir>
    STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-shots.ts --only=two-whistles --out=<dir>
    python3 scripts/demo/film/make-edl6.py <dir>
    python3 scripts/demo/film-score.py <dir>/edl6.json <dir>/edl6.wav
    python3 scripts/demo/film-cut.py <dir>/edl6.json --out <mp4> --work <work> --sheet <contact.jpg>

## Result of the v6 run

- Length 2:55.4 (175.4 s container), 1920x1080 at 30 fps, H.264 and AAC, -16.4 LUFS integrated, true peak under -2 dBFS.
- Frame-by-frame renders (build replays, architecture, drone and walk shots, the animated short) have uniform 33.3 ms pacing
  in the encoded file. The real-time UI takes were captured on a machine with a load average of 50 to 80 and paint at 5 to
  15 frames a second (median gap 66 to 216 ms); they are blended to 30 fps by paint time, which hides most of it but not all.
  The editor take (select, material, chat) is the v5 capture.
- The live-site shots show a drawn browser toolbar around a page capture; the address is the real address of the page.
- The share link is the real 90 kB link of the Villa with a pool world, made with the Player address set to the live site, opened
  on the live site (laptop and phone windows). Nothing was published or uploaded.

# v7 fix pass (about 2:55 and a 60 s cut)

`scripts/demo/film/make-edl7.py` builds `edl7.json` (main) and `edl7-60.json` (short). Changes against v6:

- Transitions: no dissolve between two shots is longer than six frames (0.2 s); inside the animated short the cuts are three frames.
  Only the end card keeps its 0.8 s dissolve (a film frame into a dark card).
- The capability montage is three 2x2 mosaics (tiles about 920 x 500 on the frame, 38 px labels, tight crops of the panel that
  matters), 5.2 s each.
- The typed prompt is exactly the first replay's prompt ("a small medieval village with a market square"). The replays are of the
  real patches of offline-planner builds (village, then "a two-storey villa with a pool") with the hour set to the afternoon, the haze
  thinned and a slow orbit; captions quote the prompt and say "Build replay, frame by frame". A valley build was tried and dropped
  (flat and grey).
- Architecture: the frame-by-frame render now sets a clear afternoon with fog off before rendering, and is graded with a little contrast.
- Real-time UI takes were re-recorded on the integrated GPU, one at a time, niced, at 1080p (describe at 1.5x), medium gap
  30 ms or better; no blending of low-fps takes (the `smooth` option is no longer used).
- The "Build locally" chapter has a named slot: `BLENDER_REAL` in the edit list (`~/.local/share/aether/demo/aether-blender-real-shot.mp4`,
  1080p, 24 fps, 9 s used). When that file exists it is placed before the character turntable; until then only the turntable plays.
- Scripts added: `take-gaps.py --range` (gap statistics of the stretch a cut uses), `frame-sheet.py` (full-size frames for checking
  details such as skirts), `film-build.ts --rscale --hour`, `film-ui.ts --tier --hubOnly`.

# v8: a clearer film (storyboard)

Feedback on v7: the grids of four scenes in one frame could not be understood. v8 shows one idea at a time, full frame, as cause and
effect, with a plain sentence for every beat.

Rules: no mosaics, no picture-in-picture, no split screens (the one exception is the laptop and phone share scene: one world on two
devices, large). Five titled acts, each opening on a 1.3 s card (a big word, one line, five dots for the five acts): Describe, Shape it,
Prove it, Share it, Go further, then the end card. Captions are sentences with a verb, 44 px, on a numbered plate at the bottom, with
no jargon ("a bot plays your game", not "replay seal"). Beats run 3.5 to 6 s; the result is held for a full second; transitions are
at most three frames. Length about 2:56 (container at most 179 s) and a 60 s trailer with one beat per act.

Eleven capabilities, shown properly: describe a world; start from a photo; the AI builds it step by step; edit by hand; edit by chat; time of day without
re-baking; the architecture views; the playability bot and the checks; publish a link and open it on a laptop and a phone;
exports (one clip walks through the hub's targets); play modes (drone, walk, game); the local Blender harness; an animated short.
Dropped to one closing sentence: terrain sculpting, game rules beyond one beat, the command palette.

`make-edl8.py` is the single source: it writes `edl8.json`, `edl8-60.json` and `cards8.json` (captions and act cards), and
`--table` prints the table below. Captures: `film-ui.ts --scene=tour --kind=hub` (new: the pointer clicks each Publish target) is
recorded and dry-run tested; `--kind=game` now marks `checks-passed` and `verified` so the bot beat can hold the result; the phone
encode retries at the first frame's size (`film-ui.ts` devices).

## Storyboard

| Act | Beat | Caption | s | Source | Status | Needs |
|---|---|---|---|---|---|---|
| Hook | hook | Describe a world. Aether builds it, lights it and publishes it. | 5.5 | film8/clips/hook (fallback: v7 terraces shot) | world clip | world-footage pipeline |
| Act 1 | act1 | (title card) Describe: Type a world. Watch it appear. | 1.3 | card | new |  |
| Act 1 | a1b1 | Type the world you want, in plain words. | 5.2 | film7/describe (full app, then zoom to the box) | v7 capture good (0% of gaps over 50 ms) |  |
| Act 1 | a1b2 | The AI builds it step by step: the land and the market first, then the houses. | 5.2 | film7/build-village3 (offline render, fixed clock) | v7 render good; re-render if the world pipeline offers better |  |
| Act 1 | a1b3 | A house builds the same way: floors, then stairs, then the garden. | 4.8 | film7/build-villa2 (offline render, fixed clock) | v7 render good; re-render if the world pipeline offers better |  |
| Act 1 | a1b4 | Start from a photo: the AI rebuilds the room in 3D. | 0 | photo (CC0) + film8/clips/photo-hotel-walk.mp4 | LEFT OUT until the walk is rendered | film-shots.ts photo-hotel |
| Act 2 | act2 | (title card) Shape it: Change it by hand, by words, by light. | 1.3 | card | new |  |
| Act 2 | a2b1 | Click a piece, then drag it where you want it. | 5.0 | film7/edit (select, move gizmo) | RE-RECORD: gaps 3-6% over 50 ms; the click shows a wall brightness jump | edit scene, quiet machine |
| Act 2 | a2b2 | Swap its material with one click. | 3.9 | film7/edit (material presets) | RE-RECORD with the edit take (5.8% over 50 ms) | edit scene |
| Act 2 | a2b3 | Or just ask: "make the sofa dark green". | 5.6 | film7/edit (chat typed, result, Undo) | RE-RECORD: this stretch was 16% over 50 ms; hold the result a full second | edit scene |
| Act 2 | a2b4 | Drag the sun: the light changes at once, with nothing re-baked. | 5.0 | film7/edit (time sweep) | RE-RECORD with the edit take | edit scene |
| Act 2 | a2b5 | Cut a building open to see its rooms. | 4.33 | film7/arch-step (offline render, clear weather) | v7 render good |  |
| Act 2 | a2b6 | Or take every wall down. | 3.0 | film7/arch-step (offline render, clear weather) | v7 render good |  |
| Act 2 | a2b7 | Pull the floors apart to see each storey. | 3.83 | film7/arch-step (offline render, clear weather) | v7 render good |  |
| Act 2 | a2b8 | Switch to the floor plan, with the area of every room. | 4.4 | film7/arch (plan view) | v7 capture good (1% over 50 ms) |  |
| Act 3 | act3 | (title card) Prove it: A bot plays it. The checks run. | 1.3 | card | new |  |
| Act 3 | a3b1 | Press one button: a bot plays your game to prove it can be won. | 6.0 | film7/tour-game (click, the bot runs sped up, "Verified playable") | RE-RECORD: the take needs a "verified" mark and the result held 1 s | tour --kind=game (adds a verified mark) |
| Act 3 | a3b2 | Run the world's own tests: one clear badge says they pass. | 4.1 | film7/tour-game (Checks) | v7 capture acceptable |  |
| Act 3 | a3b3 | Game rules read like sentences: when the timer ends, you lose. | 3.8 | film7/tour-game (Logic panel) | v7 capture acceptable |  |
| Act 4 | act4 | (title card) Share it: One link. Any screen. Any kind of world. | 1.3 | card | new |  |
| Act 4 | a4b1 | Pick what to make: a game, a video, a picture, a 3D model or a floor plan. | 9.0 | film8/tour-hub (new: pointer clicks each target) | NEW capture | tour --kind=hub |
| Act 4 | a4b2 | One click makes a link that carries the whole world. | 5.0 | film7/publish (link made with the Player address set to the live site) | v7 capture good (1.5% over 50 ms) |  |
| Act 4 | a4b3 | Open it anywhere: the same world on a laptop and a phone. | 0 | film8/devices | LEFT OUT until captured | devices scene |
| Act 4 | a4b4 | Published worlds open in their own mode, and any of them can be remixed. | 5.0 | film7/livehome (live site, Featured) | v7 capture good (0% over 50 ms) |  |
| Act 4 | a4b5 | Fly over a whole city by drone. | 5.0 | film8/clips/drone-lisbon (fallback v6/v7 footage) | world clip | world-footage pipeline |
| Act 4 | a4b6 | Walk through a house, at any time of day. | 4.2 | film8/clips/house-walk (fallback v6/v7 footage) | world clip | world-footage pipeline |
| Act 4 | a4b7 | Or float over a landscape at golden hour. | 4.0 | film8/clips/landscape (fallback v6/v7 footage) | world clip | world-footage pipeline |
| Act 4 | a4b8 | Play a game as a character. | 3.0 | film2/ui/play (real-time 4K capture) or a film8 clip | REPLACE with a film8 clip if the pipeline renders a game shot |  |
| Act 5 | act5 | (title card) Go further: Characters, photoreal shots, a short film. | 1.3 | card | new |  |
| Act 5 | a5b1 | Describe a character: Blender builds it on your computer, front, side and back. | 6.0 | film2/tt-mio + sheet | existing |  |
| Act 5 | a5b2 | And it renders a photoreal shot of it, locally. | 0 | aether-blender-real-shot.mp4 | LEFT OUT until the file lands |  |
| Act 5 | a5b3 | Stories too: a short film written and rendered in Aether, with its own sound. (about 30 s, three captions carry the story) | 31.9 | film6/shots/two-whistles (offline render from current main) | existing; re-render if the pipeline improves it |  |
| Act 5 | a5b4 | And more: sculpt terrain, write game rules, search every command. | 3.8 | film8/clips/isles (one calm shot) | world clip |  |
| End | end | Aether. Describe it. Shape it. Share it. | 5.0 | card | existing style |  |

## Capture plan (after "go"; the machine is quiet, real time, one at a time, niced, integrated GPU)

| Capture | Command (scale 1.5, tier high) | Time |
|---|---|---|
| edit: select and drag, material, chat, sun | `film-ui.ts --scene=edit --scale=1 --tier=high` | about 5 min with a retry |
| game tour with the bot (adds the verified mark) | `--scene=tour --kind=game --slug=coin-rush --scale=1 --tier=high` | about 4 min |
| devices: laptop and phone on the live site | `--scene=devices --link=film7/publish/link.txt --scale=1.5` | about 4 min |

Kept from v7 (good pacing): describe, publish hub link, architecture plan, Featured on the live site, the replays, the architecture
render. Recorded already at the quiet time: `film8/tour-hub` (3.4% of gaps over 50 ms). Waiting on: world clips in `film8/clips/`
(hook, drone-lisbon, house-walk, landscape, isles; v6/v7 footage is the fallback) and `aether-blender-real-shot.mp4`.
Offline after the captures: cards, score, cut (about 15 to 25 min) and the trailer (about 10 min).

## Photo to 3D (added to Act 1)

The feature is real and has real saved runs: the four "Rooms rebuilt from a photo" examples (photo-hotel-bedroom, photo-twin-room,
photo-four-poster, photo-vaulted-bedroom) are saved runs of the photo-to-room flow (`apps/studio/src/showcase/manifest.ts`, "credit on
each card"; the run transcripts are in `tests/fixtures/photo`, for example `hotel.transcript.json`, and the twin room was re-recorded
from a live run). The source photos are in `tests/fixtures/photo` and each carries its licence in the manifest: the hotel bedroom is
CC0 1.0 (Markus Spiske, Wikimedia Commons), the twin room CC0 1.0 (Profpcde), the two others public domain (Government of the United
States Virgin Islands). So a real photo and its result can be shown side by side in time, with the credit on screen.

Beat a1b4, caption "Start from a photo: the AI rebuilds the room in 3D." (7.2 s): the CC0 hotel photo for 2.2 s with "Example photo:
Markus Spiske, CC0", then the saved run's room walked for 5 s (an offline render of the world from the player's spawn, the shot
`photo-hotel-walk` in `scripts/demo/film/shots.json`) with "Saved run of the photo flow, no model call now". Nothing is faked: no
live model call is made and the room is the one built from that photograph. A live capture can replace the whole beat: drop it at
`~/.local/share/aether/demo/aether-photo-to-3d-live.mp4` (`PHOTO_TO_3D` in `make-edl8.py`).

Capture needed after "go": render `photo-hotel-walk` with `film-shots.ts --only=photo-hotel-walk --out=film8/clips` (one 6 s clip,
about 5 minutes; check the first frame against the photo, adjust the camera in shots.json if it does not match). No generated
photo is needed, so no Codex image generation was used.

## v8 quality rules and what the capture tests found

**No frame blending, anywhere.** The v7-60s villa replay was blurred by temporal smoothing (`tmix`), which drew each pine as three
faded copies. `film-cut.py` no longer has any smoothing path and refuses any ffmpeg call that uses `minterpolate`, `tblend`, `tmix`,
`lagfun`, the `framerate` filter, `mpdecimate` or `blend` (the only blends left are the short xfade dissolves between two shots).
`scripts/demo/ghost-check.py --scripts` greps all edit scripts for them; `ghost-check.py <cut.mp4>` writes 100% crops of moving shots
(trees, wires, railings) to look at. Speed ramps drop or repeat whole frames. A take under 24 fps is re-recorded or dropped.

**Capture backends, all in `film-ui.ts`:**
- default: headless Chromium on the integrated GPU, CDP screencast (JPEG 95), scale 1 to 1.5. Median frame gap 17 to 33 ms.
- `--real=1`: real headed Google Chrome 150 on the real display, hardware GPU (the page reports ANGLE / NVIDIA RTX 4090), window on the
  4K monitor, `--png=1` for lossless frames, `--jpegQ`. Tested on the Publish hub scene at device scale 2 while the 4090 was busy with
  a Cycles render: PNG gave a median gap of 126 ms (8 fps), JPEG q100 73 ms (64% of gaps over 50 ms). The 4K frame readback of the
  screencast is the limit.
- `--grab=1`: the display itself, Chrome fullscreen (through its window API; `--kiosk` is ignored under Playwright) on the 4K monitor,
  ffmpeg x11grab, `-draw_mouse 0`, a white flash for the clock alignment. Fullscreen and the exact 3840x2160 page area worked and
  showed nothing foreign (checked on the grabtest scene). It does not reach real time: x11grab reads a 4K frame at about 2 fps on this
  machine (1080p: 32 fps), with or without lossless NVENC. So a 4K lossless real-time UI capture is not possible here, with CDP or
  with x11grab. The options for the final UI takes: real headed Chrome with the CDP screencast at device scale 1.5 and JPEG q95 once
  the GPU is free (to be measured after the render), or an x11grab of a 1920x1080 window at device scale 1 (32 fps, lossless, native
  1x text).
- The take scripts close their browser (`finally` in `main()`) and the grab stops its ffmpeg; check with `ps` afterwards.

**Images decoded before the first frame:** `imagesReady()` scrolls the page through, waits for every image to be complete and decoded,
logs the card images' natural widths, and `--minCard=1200` refuses to record while the old 640 px thumbnails are served.

**Blur target:** measure the v8 cut with ffmpeg `blurdetect=block_pct=80:high=0.12:low=0.06` on every 30th frame, a table per 10 s
(v7: mean 5.2 px, worst 3.9 to 6.8 around 130 to 170 s). Target: mean below 3.5, no segment above 4.5. The 4K master needs a
`--res 4k` path in `film-cut.py` (every pixel constant scaled, cards rendered at 3840x2160); that is not written yet.

## The drone tour (found in v7)

The v7 city drone shot (`film/shots/lisbon-drone.mp4`) is an offline render along a 7 s stretch of the player's real drone-tour path
(scout seconds 17 to 24), but in that stretch the camera barely travels (it hovers over one quay street), and there is no button.
So it does not read as the feature. v8 plan: a real-time take of the player on Lisbon Hills in which the Drone button is clicked and
the flight starts (full app first, then the flight): `film-ui.ts --scene=modes --slug=lisbon-hills --clickDrone=1` (the city starts
its own tour, so the take stops it, presses the button on camera, and marks `drone button pressed`). The footage-agent's drone clips
should use a window of the tour where the camera really flies (for example scout seconds 6 to 16).

## Decisions after the capture tests

- UI takes: real headed Chrome plus the CDP screencast at device scale 1.5 (2880 px wide), JPEG q95 (`--real=1 --scale=1.5 --jpegQ=95`),
  measured after the Cycles render ends. A take is accepted only if the median gap is at most 40 ms and fewer than 5% of the active
  gaps exceed 50 ms (`take-gaps.py --accept`); otherwise the fallback is an x11grab of a 1920x1080 window at device scale 1.
- One more option for the Edit and Publish takes if the above disappoints: a deterministic stepped capture with Chrome's virtual time
  (`Emulation.setVirtualTimePolicy`, 33.3 ms per tick, one lossless PNG per tick at device scale 2). To check first: that the UI
  animations, the typing effects and the world canvas advance under virtual time (the canvas may need the renderer's fixed-clock hook).
  At most about an hour; used only for a scene where it works.
- 4K master: not now. The deliverable is a sharp 1080p master (CRF 14, slow, one Lanczos resample from the high-resolution sources).
- Drone: a real-time take on Lisbon Hills that clicks the Drone button in the full app, then the flight; the first second after the
  click must show the camera clearly rising and travelling (checked on the frames before the take is used). World clips use a stretch
  of the tour where the camera really flies.
- After every run: the script's browser closed, x11grab/ffmpeg stopped, `ps` checked for leftovers of this run's own profile only.

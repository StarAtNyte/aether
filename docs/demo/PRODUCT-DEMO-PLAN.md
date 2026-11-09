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

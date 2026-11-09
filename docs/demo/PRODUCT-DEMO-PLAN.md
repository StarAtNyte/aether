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

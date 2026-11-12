# Demo video: automated, repeatable pipeline

The product demo (about two minutes, 1280x720, H.264 mp4, captions burned in) is produced by scripts, not by hand. The
script in [DEMO_SCRIPT.md](DEMO_SCRIPT.md) is the long, voice-over version for a machine with a free GPU; this
pipeline is the one that runs unattended on any machine, including one with only an integrated GPU.

Output: `~/.local/share/aether/demo/aether-demo.mp4` (never committed; `docs/demo-poster.jpg` is a poster frame).

## Regenerate

```bash
npm run build                      # the studio the recorder drives (apps/studio/dist)
GEN_GPU=intel npm run demo         # record -> compose -> verify
```

Under the heavy-job lock on a shared machine: `GEN_GPU=intel flock ~/.local/share/aether/heavy2.lock nice -n 19 npm run demo`.

The three steps can also run alone:

| Step | Command | What it does |
|---|---|---|
| record | `npm run demo:record -- [--scene=villa,photo,game] [--size=1280x720] [--ai=offline\|live]` | Starts the Aether server on a free port and drives the built studio in Chromium with Playwright, one scene group per raw take (`~/.local/share/aether/demo/raw/<scene>.webm` plus `<scene>.json`, the timeline of captions, titles, cuts and speed ramps). |
| compose | `npm run demo:compose` | ffmpeg: cuts and speed ramps from the timelines, captions and section titles burned in with `drawtext`, intro and outro cards, fades between scenes. |
| verify | `npm run demo:verify` | ffprobe duration under 180 s and resolution, `blackdetect` (no black segments), `freezedetect` (no frozen stretch over 2.5 s; moving cursor counts as motion), and 12 evenly spaced frames in `~/.local/share/aether/demo/frames/` to look at. |

Needs `ffmpeg` and `ffprobe` with libfreetype (system packages) and the Lato font; `FONT=/path/to/font.ttf` picks another
one. Nothing is added to `package.json` dependencies, and no music is used, so there is nothing to credit beyond the font
used while rendering the captions (Lato, SIL Open Font Licence, not redistributed).

## Why it is repeatable on a slow machine

- The browser runs on the integrated GPU (`GEN_GPU=intel`: WebGL2 over ANGLE/GL; the recorder removes `navigator.gpu`
  because WebGPU on this machine falls back to a software adapter at a few frames per second). The studio holds 60 fps
  there, so real-time capture through Playwright's screencast is smooth. On software GL the 3D scenes would stutter; use a
  GPU, or lower `--size`.
- Every pause is a script step (typing, cursor glides, held keys), so each take is the same sequence every time.
- Waiting is never hidden: a long build or light bake is kept, marked as a speed ramp and labelled "sped up xN" in the
  video. Booting and "preparing shaders" screens are cut.

## What is live and what is not (stated on screen)

- **Generation scenes use the offline planner**, not a connected AI. It only understands its fixed themes, so the prompts
  are `a two-storey villa with a pool` and `a coin collecting game on a tropical island` (the home page's own example
  chips), not open-ended ones. The video carries the note "Built by the offline planner (no AI connected), recorded in
  real time" for the whole scene. The edits ("make the sofa dark green") and the bot's verified-playable run are the
  app's real behaviour; they simply do not need a model.
- **The photo scene shows saved examples**: rooms an AI rebuilt earlier from credited photographs (the "Rooms rebuilt from a
  photo" cards). The video says "Saved examples ... not generated live" and shows the source photo with its credit line.
- Nothing recorded with the offline planner is presented as live AI output.

## Re-recording the generation scenes live

When a connected AI is available, start the local app and point the recorder at it:

```bash
npm run aether -- start --no-open                                  # connect Codex, Claude Code or an API key in Settings
AETHER_E2E_URL=http://127.0.0.1:<port> GEN_GPU=intel npm run demo:record -- --ai=live --scene=villa,game
npm run demo:compose && npm run demo:verify
```

`--ai=live` uses the open-ended prompt in `LIVE_PROMPTS` (`scripts/demo/record.ts`), drops the offline note, and the speed
ramps cover the longer wait. Raw takes of the other scenes are reused as they are, so only the scenes you name are
re-recorded. Check the first frames of each live take for anything personal (account names, paths) before publishing.

## Scenes

1. Home: the prompt box, a prompt typed at reading speed.
2. Build: the two-storey villa appears (rooms, stairs, doors), the bot's walkability check, a chat edit with its one-line
   diff and Undo.
3. Walk through the lit rooms in first person.
4. Photo: the example rooms rebuilt from photographs, one opened beside its source photo, then walked.
5. Game: a coin game, the bot's winning run and the verified-playable badge, a few seconds of play, then Publish and a
   share link.

Intro and outro cards carry only the app name and a one-line tagline.

## Files

- `scripts/demo/record.ts`: the scenes (selectors and pacing live here).
- `scripts/demo/lib.ts`: cursor, ring and zoom overlays, smooth pointer, slow typing, timeline recorder.
- `scripts/demo/compose.ts`: the edit.
- `scripts/demo/verify.ts`: the checks.

# User guide

This guide covers using the Aether studio: writing prompts, refining a world
by chat, playing it, reading the verification badges, rebuilding a room from a
photo, and publishing. To install and start Aether, see the
[README quick start](../README.md#quick-start).

## 1. Pick an AI connection

The model picker under the prompt and **Settings → AI connection** show
what is answering:

- **Codex** or **Claude Code** on this computer (local app only). These give
  the best results. The model plans, uses tools, looks at renders of its work
  and fixes it. Pick the model and reasoning effort in the picker.
- **Your own API key** (Anthropic, OpenAI, OpenRouter, Google Gemini). The
  browser calls the provider directly. A per-session call cap protects your
  bill.
- **Offline planner.** Always available, instant and free. It builds 21
  themes and places 40+ library objects by name, in English only. When it
  cannot do something, it says so instead of guessing.

If a connected model fails (signed out, rate limited, bridge stopped), the
turn falls back to the offline planner and the chat shows a notice.

## 2. Writing a first prompt

A good first prompt names **what you play or see**, the **setting**, and the
**goal**:

- *"A night forest adventure: collect 5 lanterns, avoid the wolves, reach the
  shrine to win"*
- *"An arcade kart race in a desert canyon, three laps with checkpoints"*
- *"A two-storey modern house with a pool, open-plan living room, kitchen and
  two bedrooms, people living in it"*
- *"A domino run that knocks over a bell tower"*
- *"A minecraft-like survival world"*

Tips:

- **Say the win condition** for a game ("collect 12", "reach the summit",
  "three laps"). The bot will verify exactly that.
- **Name the characters and their behaviour** in plain words: "a guard who
  patrols the gate and chases me when he sees me", "a shopkeeper who sells the
  key", "wolves that fear fire".
- **Buildings:** give room counts and the rooms you care about ("three
  bedrooms, a home office, a kitchen with an island"). Stairs, doors, windows
  and furniture are fitted automatically and checked.
- **Style:** worlds are realistic by default. Ask for "low-poly",
  "cartoon", "painterly" or "voxel" to get a stylised look, and later edits
  keep that style.
- A home-page prompt always starts a **new** project. Inside a project, the
  first prompt on the untouched starter scene builds a new world, and every
  later message refines it (see below).

While a connected model works, the chat streams its plan, the tool calls and
each review round. Corner brackets in the viewport show where new objects
will stand before they appear.

## 3. Refining by chat

After the first build, each message changes the current world. Nothing is
regenerated. Examples that work:

| You type | What changes |
| --- | --- |
| "make the sofa dark green velvet" | the sofa's upholstery slot only |
| "floral wallpaper on the main bedroom's back wall" | that wall face, seen from inside the room |
| "move the lamp a bit left" | the lamp, relative to your view |
| "make the second chair black" | the second chair only |
| "make this red" (with something selected) | the selection |
| "do the same for the other bedroom" | repeats the last edit on the other bedroom |
| "make the wolves slower", "collect 15 coins to win" | a speed value; the win rule |
| "make it night", "make it rain" | sky and weather |
| "add a window to the kitchen" | a window on the kitchen's widest clear outside wall |
| "move the shrine 6 m east" | the shrine and everything attached to it (its light, goal zone, altar) |

- Each edit shows a **compact diff** ("Sofa · upholstery: fabric → velvet")
  with **Undo**. The toolbar has Undo and Redo, and the History panel can check
  out any past state or make a branch.
- Many edits run **locally in about a millisecond with no model call**. The
  chat marks those as "no model call".
- **Ambiguous requests** ask which one ("Which tent?") and number the
  candidates in the viewport when you are offline. With a model connected, the
  model gets the candidates and decides.
- If a model's patch also changes objects you did not mention, the **edit
  guard** refuses it and the model tries again with a smaller patch.
- **Up to 40 undo steps are saved with the project**, together with the
  latest verdicts, so a reload keeps them.

## 4. Play mode

Press **Play** (top bar). Games open with a title card: title, objective,
controls, then **Start**. Stop restores the world exactly as it was.

| Key | Action |
| --- | --- |
| W A S D / arrows | move |
| Mouse | look (click the viewport to capture the pointer) |
| Space | jump |
| E | interact: open doors, drawers and windows, flip switches, run taps, pick up and throw, sit, talk |
| 1–6 | choose a dialogue option |
| Esc | stop |

In a **building walkthrough** (Walk on the building bar), 1 to 4 set the time
of day (morning, midday, golden hour, night), L switches every light, R swaps
finishes, and P is photo mode. Hinged doors are real physics joints and stop
against you.

**Block worlds:** left click breaks, right click places, number keys pick
the hotbar slot, and E opens the inventory and crafting. Health, hunger,
day and night, and mobs come with survival mode. Saves stay in the browser.

**Phones and tablets:** a stick to move, drag to look, jump and act buttons.

**Tweak while playing:** the "Tweak" prompt in play mode edits the game and
restarts it.

## 5. Verification badges

Two badges sit at the top of the viewport.

**Checks** (physics):

| Badge | Meaning |
| --- | --- |
| Run checks | the world has tests that have not run yet |
| Checks passed | every test of the world passed in a headless fork of the physics world |
| Checks failed | open the Checks panel to see which test failed and why; failures can go back to the agent with one click |
| Checks outdated | the world changed after the last run. Colour-only edits keep the verdict |

**Playability** (the bot):

| Badge | Meaning |
| --- | --- |
| Check playability | not played yet |
| Verified playable | the bot played this exact world to the win |
| Verified walkable | (buildings) the bot reached every room on foot |
| Not verified yet / Could not verify | the bot did not finish. The sentence says why ("could not reach coin-8", "the stair lands 0.78 m from the wall"), and any automatic fix is listed as one undoable step |

After a pass, a ghost replays the bot's run with pause, scrub and speed
controls. After a physics pass, translucent ghosts re-enact the verification
run and a seal shows the number of checks and the simulated seconds.

What the badges mean, precisely: a **deterministic replay check**, not a
formal proof. A win shows that the game can be won. A failed run is not proof
that it cannot be. A world's own tests are only as good as what they test.
See [PROOFS.md](PROOFS.md).

## 6. A room from a photo

1. Connect a vision-capable model (Codex, Claude Code or an API key).
2. Attach a photo of a room with the **+** button in the composer (up to four
   images).
3. Press **Recreate this image**. You can add a note ("ignore the
   people").

Aether reads the photo several times (three reads on a subscription, one on
a paid key) and merges the readings. It shows its assumptions as chips you
can tap to adjust. Then it builds the shell, windows and
doors, the furniture and the decor. Each round renders the room from the
photo's camera. A panel of AI judges looks at the render next to the photo and
decides, item by item, what still differs; the card says who judged. The
assistant then fixes what they found, and sets the room's light and colour
(exposure, white balance, fog, tints) from what it sees. A change is kept
when the judges find the new render closer to the photo; otherwise it is shown
as "not kept". Measured numbers (openings, inventory, placement, colour
difference) are shown as advice and never decide. On a subscription the loop runs until everything
matches or progress stalls. On a paid key it stops after 10 rounds.

Expect a few minutes and 20 to 40 calls. Vaulted ceilings, cornices, sash
windows and some door styles cannot be built yet. Offline, Aether says it
cannot rebuild a room from a photo and offers to build from text.

Any image attached to a normal prompt is a **reference**. It informs style
and content but does not trigger a reconstruction.

## 7. Editing by hand

The prompt is the main tool, but everything can be edited directly:

- Click, shift-click or marquee to select (in sync with the outliner); W, E
  and R switch between move, rotate and scale gizmos with snapping.
- The inspector on the right edits the selection, or the scene settings (sky,
  time of day, light, fog, ground, gravity, play camera, variables) when
  nothing is selected.
- **Assets** places library models, materials and HDR skies by click or drag.
  You can import your own GLB or glTF files, images and HDR skies.
- **Logic** shows WHEN/IF/THEN rule cards and behaviours, and **Checks** holds
  the editable tests and a "Run checks" button.
- Procedural objects expose sliders, a seed re-roll and scatter density. Tab
  enters mesh edit mode. Sculpt and paint brushes work on terrain and meshes.
- Ctrl/⌘+K opens the command palette. Free text in the palette becomes a
  prompt. `?` lists every shortcut.
- The agent sees your hand edits and never touches locked objects.

For buildings, the building bar has a cutaway, walls down, exploded and
single storeys, x-ray, a section cut, a daylight study, a studio render and
**Reveal** (the plan drawn in ink, then the walls rising). The floor plan
view shows room areas and dimensions, and you can draw rooms, doors and
windows on it.

## 8. Publishing and sharing

**Share** copies a link that carries the whole world after the `#`
(compressed, typically tens of kilobytes). Nothing is uploaded. The link opens a
read-only viewer with Play, Export and **Remix**, which copies the world into
your own projects. The link also carries the sealed proof, and the viewer can
re-run it on the visitor's device.

**Publish** opens one hub with presets, a preview, progress and Cancel:

- **Game:** a standalone web build (player only: renderer, physics, logic, no
  editor) with a title screen, pause menu, settings, credits, touch and
  controller support. Download it as a zip for itch.io, GitHub Pages,
  Netlify or any static host. In the local app you can also deploy it to
  **your own** Netlify, Vercel, GitHub Pages or itch.io account through the
  CLIs you are signed in to, or share it on your local network behind a
  random token.
- **Video:** a keyframe camera timeline, presets (orbit, fly-through, dolly,
  crane, reveal…), and a director that turns words into shots ("slow dolly
  through the living room then rise above the roof"). Frames are rendered
  offline and encoded in the browser (MP4 or WebM).
- **Render:** stills up to 4K (PNG, JPEG or WebP), rendered in tiles. A
  path-traced still is available for architecture.
- **3D model:** GLB or glTF with PBR materials. **Floor plan:** SVG or PDF at
  1:50 or 1:100.
- **Versions:** every publish saves a named version that you can restore as
  one undoable change.

Every bundled asset's credit appears in the credits panel, on the end-of-game
screen and in the exported `CREDITS.txt`.

## 9. Projects and recovery

Projects live in your browser (IndexedDB) with thumbnails, search, sort,
rename, duplicate, delete with Undo, and `.aether.json` export and import.
To recover from a world that will not load, open the studio with `?safe=1`,
which boots the starter scene and keeps your last world one Undo away.
`?debug=1` turns on verbose logging.

## 10. Driving Aether from another agent

`aether mcp` exposes create, edit, patch, verify, playtest, replay, render
and export as MCP tools for Claude Code, Codex or your own scripts. See
[MCP.md](MCP.md) and [AGENT_TOOLS.md](AGENT_TOOLS.md).

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
photo's camera. A panel of AI judges (three on a subscription, one on a paid
key) looks at the render next to the photo and decides, item by item, what
still differs; the card says who judged. The assistant then fixes what they
found, and grades the room's light and colour (exposure, white balance, fog,
tints, lamp strength; the `tune_look` tool) from what it sees. A change is
kept when the judges find the new render closer to the photo; otherwise it is
shown as "not kept" and the room goes back to the best state so far. Measured
numbers (openings, inventory, placement, colour difference) are shown as
advice and never decide. On a subscription the loop runs until everything
matches or progress stalls. On a paid key it stops after 10 rounds.

Four example rooms made this way (a hotel bedroom, a twin room, a four-poster
bedroom and a vaulted bedroom) are on the Templates page under **Photo to 3D**.

Expect a few minutes and 20 to 40 calls. Vaulted ceilings, cornices, sash
windows and some door styles cannot be built yet. Offline, Aether says it
cannot rebuild a room from a photo and offers to build from text.

Any image attached to a normal prompt is a **reference**. It informs style
and content but does not trigger a reconstruction.

## 7. Graphics quality

**Settings → Graphics → Quality** offers Auto, Low, Medium, High and Ultra.
Auto picks a tier for your GPU and machine: software renderers and weak
computers (four cores or less, or little memory) get Low or Medium, a
discrete GPU gets High. Higher tiers add effects, each of which has its own
switch below the picker:

| Tier | Adds |
| --- | --- |
| Low | no post effects |
| Medium | a composite pass, film grain, soft sun shadows |
| High | ambient occlusion, temporal anti-aliasing, contact shadows, sun cascades |
| Ultra | reflections, sun shafts, glow, lens fringing |

Sun shadows soften with distance from the caster. On High and Ultra the sun
also gets cascades: finer shadow maps around what you look at, so a chair leg
or a boot has its own shadow.

On Auto, a performance governor watches the frame time. When frames stay
slow after the resolution has already dropped, it gives up one cost at a time:
the baked light volume of buildings, the sun cascades, the post effects, then
particles. It never goes back up. Picking a tier yourself turns the governor
off and restores everything. The Performance overlay (top bar) shows frame
timing.

## 8. Editing by hand

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
single storeys, x-ray, a section cut, a daylight study, and a studio render. The floor plan
view shows room areas and dimensions, and you can draw rooms, doors and
windows on it.

## 9. Publishing and sharing

**Share** copies a link that carries the whole world after the `#`
(compressed, typically tens of kilobytes). Nothing is uploaded. The link opens a
read-only viewer with Play, Export and **Remix**, which copies the world into
your own projects. The link also carries the sealed proof, and the viewer can
re-run it on the visitor's device.

**Publish** opens one hub with presets, a preview, progress and Cancel. It
starts with **How it opens**: cards for **Walk through** (a guided tour of the
rooms at eye level), **Play** (a game with a title screen), **Showcase** (fly
in, then orbit), **City tour**, **Short film** and **VR**. The card that fits the
world is marked **Suggested** and already chosen; pick another to change it.
The start view, the short film and the quality check sit under the cards.
Then choose where it goes:

- **Link:** a link anyone can open. By default the world travels inside it
  (nothing uploaded); **Make a short link** uploads a ready-to-draw copy instead,
  so the link is short and opens fast; after an update that changes how worlds
  are built it opens the slower way until you publish it again. QR code,
  remix link and embed code are on the same tab; the replay proof and the
  player address are under **More options**.
- **Website:** a standalone web build (player only: renderer, physics, logic, no
  editor) with a title screen, pause menu, settings, credits, touch and
  controller support. Download it as a zip for itch.io, GitHub Pages,
  Netlify or any static host. In the local app you can also deploy it to
  **your own** Netlify, Vercel, GitHub Pages or itch.io account through the
  CLIs you are signed in to, or share it on your local network behind a
  random token.

**Products:** an object with product details (name, size, price, a short
description and a shop link) opens a product card when visitors click it in the
player, with an Enquire or Buy button; the Rug Exhibition Hall template comes
with a catalogue of its rugs.

**Showroom guide:** a world can have a guide (`guide` in the world file: a name,
one of the two people visitors can choose, a greeting and a few lines about the
shop). In the player the guide stands near the entrance, greets visitors and
answers questions about the products from the bottom-left panel ("Ask Ava").
Ask for something ("Show me something blue") and she walks you to it and opens
its card. **Take the tour** walks you past the main pieces one by one; any move
of your own pauses it, and Resume carries on. With the site's model she answers
in her own words; without one she still answers from the catalogue.

Or export a file:

- **Video:** a keyframe camera timeline, presets (orbit, fly-through, dolly,
  crane, reveal…), and a director that turns words into shots ("slow dolly
  through the living room then rise above the roof"). Frames are rendered
  offline and encoded in the browser (MP4 or WebM).
- **Picture:** stills up to 4K (PNG, JPEG or WebP), rendered in tiles. A
  path-traced still is available for architecture.
- **3D model:** GLB or glTF with PBR materials. **Floor plan:** SVG or PDF at
  1:50 or 1:100.
- **Versions:** every publish saves a named version that you can restore as
  one undoable change.

Every bundled asset's credit appears in the credits panel, on the end-of-game
screen and in the exported `CREDITS.txt`.

### Shared visits

Some worlds can be visited together: among the examples **Himalayan Valley**
(marked **Multiplayer** on its card in Featured and Templates), and any world
you publish with
**Multiplayer (shared visits)** turned on. The switch is under the title-screen
fields of **Link** and **Website** in the Publish dialog, off by default; it goes
into the downloaded website (`game.json`), the share link and the published copy.
It only lets visitors see each other and chat; nothing else about your world
changes.
Open it in the player and press **Invite** (top right): the link to this world
with a room in it (`…&room=<id>`) is copied, and anyone who opens that link
joins you. Up to 16 people share a room.

- Everyone else appears as a person walking where they are, with their name
  over their head. When you play (P) you are where your character is; while
  you look around, you stand on the ground under the camera.
- Press **N here** to open the panel: change your name (a random one is chosen
  the first time and remembered in this browser), pick a look (Kaho or Mio)
  and your colours, and chat. **Your colours** recolours your clothes and
  hair as others see you (skin, face and eyes stay as they are): pick one of
  the swatches, or leave it on **Auto** and you get a colour of your own for
  each visit, so two people with the same look are still easy to tell apart. A message also shows over your head for a few seconds. Esc leaves
  the text field. **Leave visit** disconnects.
- **Voice:** press the **Voice** button (microphone icon, next to **N here**)
  to talk. It is off until you press it; your browser asks for the microphone
  then, not before. Everyone in voice hears you from where your character
  stands, and you hear them from theirs: a voice is full up to 2 m away,
  quieter further off, and silent from about 40 m. Up to 8 people can be in
  voice at once; when it is full the button says so and chat still works.
  - **Open mic** (the default): the button reads **Mic on**; press it to mute
    yourself (**Muted**) and again to unmute. **Push to talk**: hold **V** (or
    hold the button) while you speak. Switch between the two in the panel.
  - In the panel, **People here** lists everyone, whether they are in voice,
    a mute button and a volume slider for each person, and **Leave voice**.
    A name tag shows small green bars while that person speaks.
  - Voice connects directly between browsers (no audio passes through a
    server). Some networks (strict company or hotel firewalls) block that;
    you then see "Voice couldn't connect to <name>" and can still chat.
    Use headphones on open mic, or the others may hear themselves echo.
- Only where people are and what they say is shared. The world itself is not:
  doors, the time of day or anything else you change stay on your screen.
- Shared visits go through the Aether server when there is one (the local
  app, `npm run aether -- start`, or a self-hosted server). The static hosted
  site has no server: there they go through the site's Supabase Realtime
  project instead, with the same rules (16 people a room, message and chat
  limits). Where neither is available the Invite button does not appear.

## 10. Projects and recovery

Projects live in your browser (IndexedDB) with thumbnails, search, sort,
rename, duplicate, delete with Undo, and `.aether.json` export and import.
Each project card has a visible actions button (…) and a trash button.
**Select** on the projects page picks several projects (Escape leaves it), and
**Delete selected** removes them with one confirmation and one Undo; Delete or
Backspace on a focused card asks to delete it. Inside a project, the Aether
menu has **Delete project…**. Example worlds are not projects and are never deleted.
To recover from a world that will not load, open the studio with `?safe=1`,
which boots the starter scene and keeps your last world one Undo away.
`?debug=1` turns on verbose logging.

## 11. Driving Aether from another agent

`aether mcp` exposes create, edit, patch, verify, playtest, replay, render
and export as MCP tools for Claude Code, Codex or your own scripts. See
[MCP.md](MCP.md) and [AGENT_TOOLS.md](AGENT_TOOLS.md).

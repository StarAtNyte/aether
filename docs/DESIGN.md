# Design

How Aether looks, moves and sounds, and why. This is the reference for
anyone adding a screen, a panel or a moment to the studio. The tokens live
in `apps/studio/src/styles/tokens.css`. Every rule here can be checked in
the stylesheets under `apps/studio/src/styles/`.

## Direction: a quiet instrument for a loud world

**The world is the hero. The interface is a well-made instrument around it.**
Aether's output is a living 3D world, full of colour, light and motion. The
interface that makes it stays neutral, precise and calm, so that nothing
competes with the world and every bit of colour in the UI means something.

Principles:

1. **Neutral chrome; colour only for meaning.** The primary action is a
   solid ink button on light and a paper button on dark. Secondary actions are
   outline or ghost. Selected and active states show with weight, a subtle
   neutral fill or an underline, never a hue. Colour appears for danger (red),
   warning (amber) and success (muted green), plus one small warm dot for the
   agent's presence. There is no blue anywhere in the chrome.
2. **Annotate the world, don't decorate the chrome.** The expressive layer
   lives in the viewport: plan marks drawn around what the agent places,
   labels that name what is being built, the ghost replay of a physics
   proof. Panels stay plain.
3. **Motion explains cause and effect.** Every animation answers "what just
   happened, and where did it go?" The prompt flies into the world, objects
   grow into their plan marks, and ghosts re-enact the proof. There are no idle
   loops in the chrome. Every animation stops under `prefers-reduced-motion`.
4. **Play is a different place.** Entering play hands the window to the
   world: the panels step aside, an iris opens the view and a game HUD takes
   over. The game HUDs use their own dark-glass palette, because they sit on
   the world rather than on the UI.
5. **Every pixel survives both themes and both renderers.** Light is the
   default and dark is a first-class twin. The WebGL2 path (Firefox, Safari,
   older GPUs) gets the same UI and the same moments as WebGPU.

### Directions considered

The direction was set when the studio UI was rebuilt; this stage extended it.
The comparison below is recorded so later work does not reopen it without a
reason. Each direction was scored from 1 to 5 against the criteria the
product needs.

| Direction | Concept | Beauty | Clarity | Originality | "Speak worlds into being" | Works for games | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Celestial glass | Deep-space gradients, frosted panels, aurora accents | 4 | 2 | 2 | 3 | 3 | 14 |
| Field notebook | Warm paper, ink, hand-drawn notes on the world | 4 | 3 | 4 | 4 | 2 | 17 |
| Arcade cartridge | Chunky colour, pixel type, playful motion | 3 | 3 | 3 | 2 | 5 | 16 |
| **Quiet instrument + annotated world (chosen)** | Neutral precision chrome; expressive annotation in the viewport; game HUDs only in play | 4 | 5 | 4 | 5 | 4 | **22** |

The chosen direction is a deliberate fusion. It takes the notebook's best idea
(the agent *draws its plan onto the world*) and the cartridge's (a bold,
game-native HUD, but only while playing), and leaves the glass gradients
out. Glass fights a full-colour world for attention and hurts contrast.

## Tokens

All colours are OKLCH custom properties on `:root`, redefined under
`:root[data-theme='dark']`. `/theme-boot.js` applies the theme before the
first paint. The values below are the light theme.

| Role | Tokens |
| --- | --- |
| Surfaces | `--bg` 97.2% · `--surface` 100% · `--surface-2/3/4` · `--canvas` (behind the viewport) |
| Lines | `--border` · `--border-strong` · `--border-hover` |
| Text | `--text` 21.5% · `--text-2` 43% · `--text-3` 52.5% · `--text-disabled` |
| Primary (ink / paper) | `--accent` is the ink (22%) on light and the paper (93%) on dark: primary buttons, slider fill, checked switches · `--on-accent` · `--accent-hover/-press` · `--accent-text` · `--accent-soft` (6% ink wash) · `--accent-border` · `--focus-ring` (2 px solid ink or paper) · `--presence` (the one warm dot) |
| Status | `--success*` · `--warning*` · `--danger*` (muted, never decorative) |
| Overlays | `--overlay` (84% white glass) · `--overlay-border` · `--scrim` · `--shadow-1/2` |
| Space | 4 px grid: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48 |
| Radii | `--r-1` 6 · `--r-2` 8 · `--r-3` 12 (panels, viewport, cards, seal) |
| Controls | 32 px (`--control-h`), 28 dense, 24 extra small; 44 px targets on coarse pointers |
| Motion | `--ease` cubic-bezier(0.2, 0, 0, 1) · `--dur` 150 ms · `--dur-slow` 200 ms |
| Layers | `--z-overlay` 10 · `--z-drawer` 30 · `--z-menu` 50 · `--z-toast` 60 · `--z-tooltip` 70 · `--z-palette` 80 |

Every text pair meets WCAG AA in both themes (`npm run check:ui-colour` computes every pair from the tokens; the lowest text pair is 4.97:1, the primary label on ink is 16.6:1). New UI must reuse these tokens and never add raw
colours. There are two exceptions. The in-world game HUDs (`voxel.css`, `npc.css`) and
the published player (`player.css`) have their own dark-glass palette, because
they sit on bright sky and dark caves alike; it is warm grey with a paper
primary, also without blue. The editor's selection outline, edit gizmos, path
and replay overlays are drawn in the 3D scene in white and warm grey.

Rules for new UI: warm-grey surfaces (hue 85, chroma under 0.01), few borders,
no gradients (scrims over images excepted), radii from `--r-1..3`, weights 400
to 600, hover is a step on the neutral ramp. `npm run check:ui-colour` fails on
a contrast miss or any blue or purple hue left in the stylesheets;
`scripts/ui-audit.ts` takes the screenshots for a visual check.

## Type and icons

- **Inter** (UI, variable, optical sizing) and **JetBrains Mono** (numbers,
  code, counts on plan marks). Both are self-hosted under SIL OFL 1.1, with a
  metric-matched fallback face so the swap never shifts layout (see
  `docs/THIRD_PARTY.md`).
- Scale: 11 / 12 / 13 / 14 / 16 / 20 / 24 px, plus 32 px for the hero line.
  Weights are 400, 500 and 600 only. Headlines use tight tracking (−0.025 em)
  and no synthetic italics. Tabular figures are used wherever numbers update
  (seal, HUD, perf).
- Icons are Aether's own family, hand-authored on a 24 px grid with one
  1.5-unit stroke in `currentColor` (`components/Icon.tsx`). No third-party
  icon sets. The logomark is a peak over a horizon line inside a rounded
  tile.

## Layout

- **Home** (`#/`): a sidebar (a bottom tab bar on phones) and a hero with
  the prompt bar front and centre ("Speak a world into being."). Under it sit
  one-tap example prompts, a stage of example worlds that drift through
  (cross-fade with a slow push-in, still under reduced motion, paused while
  the tab is hidden), then the templates and recent projects.
- **Editor** (`#/p/<id>`): a three-zone top bar, the icon rail with the left
  panel (Agent, Objects, Assets, Logic, Checks, History), the full-height
  viewport, and the inspector. Breakpoints: wide ≥ 1280, medium 1024–1279,
  tablet 768–1023 (drawers), phone < 768 (bottom sheet whose smallest snap
  is the prompt bar). The viewport keeps its place in the tree in every mode,
  so resizing never recreates the renderer.
- **Viewer** (`#/view/<token>`): a shared world, read-only. A slim bar holds
  the logo, the world name, a "Shared · read only" badge, Play, Export and
  Remix. Below it the full-bleed world, with no editing tools and no agent.
- **Play**: the side panels step aside ("Full-window play", on by default)
  and the game HUD takes the viewport. Touch devices get the virtual stick,
  jump, act and, in block worlds, break and place buttons.

## Moments

The signature moments, in the order a visitor meets them. Each one respects
reduced motion and costs nothing once it has finished.

| Moment | What happens | Where |
| --- | --- | --- |
| **Prompt flight** | The sent prompt lifts out of the composer as a pill, arcs into the viewport and dissolves into a ring that widens over the world (620 ms + 900 ms). Two short-lived DOM nodes, Web Animations. | `lib/promptFlight.ts`, `.prompt-flight`, `.vp-ripple` |
| **Plan marks** | When the agent builds, every new object is first bracketed (thin ink corner ticks around where it will stand), and the groups are named on the world ("Palm ×12", "Coin ×8", dashed ink labels). Objects then grow into their brackets after a 0.3 s lead. The marks hold for 1.8 s and fade over 0.7 s. The first world of a session just materialises, without marks. | `render/view/blueprint.ts`, `lib/planMarks.ts`, `.vp-label--plan` |
| **Materialisation** | Grow-in ripple from the centre of the scene outward, with an ease-out-back pop for small things and none for mountains. | `render/view/grow-in.ts` |
| **The proof** | After verification, translucent warm-grey ghosts of the bodies that moved re-enact the simulated run (recorded in the worker, not simulated again) while the originals step aside. The ghosts leave fading trails, hold the final pose, then dissolve. The camera brings the motion into view first if it is too small to read. The **seal** lands at the top of the viewport: a ring draws itself closed around a check, with "Proved · 4 of 4 checks · 7.3 s simulated" and a Replay button. A failed run gets a quiet warning chip that links to Checks. | `physics/trace.ts`, `render/view/proof-replay.ts`, `ProofSeal.tsx` |
| **Play** | An iris opens the viewport, the panels step aside, and the HUD (score/time, or the block-world hotbar, hearts and food) takes over. Esc returns to the exact pre-play world. | `.viewport.is-entering`, `[data-immersive]`, `PlayHud`, `VoxelHud` |
| **Share** | A link that carries the world itself (compressed, in the URL fragment), so no upload is needed and it works on any static host. It opens the viewer, and Remix makes it yours. | `lib/shareLink.ts`, `ViewerRoute.tsx` |

**Sound.** The interface sounds are opt-in (Settings → Interface sounds):
a soft rising tone on send, a consonant two-note chime when a proof passes,
and a short lift on Play. They are procedural WebAudio from the same synth as
the game sounds, quiet (gain ≤ 0.05) and rate-limited.

**Cursor.** In the viewport with the Select tool, the cursor is a fine accent
ring with a centre dot (an SVG data URI). The other tools keep the system
cursors that explain them (crosshair, grab).

## Extending the system

How each area applies the direction:

- **Block-world game HUD.** It lives in play only. It uses the dark-glass
  palette (`--vx-*`), pixel-crisp inline SVG for hearts, food and bubbles, and
  the same Inter type. The hotbar slot highlight is the only bright element,
  and it uses gold rather than the accent, since the accent means "Aether"
  and the hotbar belongs to the player.
- **Architecture views.** The building bar is a segmented overlay at the
  top centre (view, walls, storeys, x-ray, section cut, daylight study), so the proof seal
  moves under it. Room chips are plain labels. The floor plan is drawn in
  neutral ink with accent selection.
- **Asset browser.** Real rendered thumbnails on neutral tiles. Every tile
  names its source and licence (tooltip), stars mark favourites, and credits
  are one click away. No category colours.
- **Publish hub.** The "Published" section uses the same empty-state pattern
  (icon tile, one sentence, one action). A share link is the publish
  primitive: viewer plus Remix.
- **Settings / AI connection.** A segmented section switch with groups of
  toggle rows. Status uses a dot and a word (never colour alone), and
  sign-in codes are set in mono.

Rules for anything new:

- Overlays over the viewport use `--overlay` glass, `--overlay-border`,
  `--shadow-1` and `--r-2`/`--r-3`, and must not overlap one another
  (`npm run e2e:layout` checks this).
- Loading uses skeletons and a 2 px progress line, never spinners. Empty
  states use an icon tile, a title, one sentence and at most one primary
  action. Errors say what happened and what to do next.
- Interactive elements show a 2 px `--focus-ring` outline on
  `:focus-visible`, carry an accessible name, and are reachable by
  keyboard. Status changes are announced through a polite live region
  (agent status, seal, toasts, tour).
- Text from worlds or models is set with React text nodes or `textContent`,
  never as HTML.

## Onboarding and help

- **First run** (AI connection): shown once per browser and dismissible (see
  `onboarding/FirstRun.tsx`).
- **Tour**: three steps the first time an editor opens: *Describe a world*
  (the composer), *Watch it get proved* (the Checks button), *Press Play*. It
  is non-modal: a soft ring around the target and a small card beside it.
  Next, Back, ←/→, Esc or Skip end it, and "Take the quick tour" in the
  command palette replays it.
- **Keyboard shortcuts** (`?`): an overlay of every shortcut, grouped.
- **Command palette** (Ctrl/⌘+K): actions, panels, tools, camera, assets,
  objects, templates and projects. Free text that reads like a sentence
  becomes the first result, "Ask the agent: …" (in the editor) or "Build a
  new world: …" (on the home page).

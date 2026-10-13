# Review log

Self-review notes per change set: security and performance gates, with the
measurements behind each claim.

## Studio theme, typography and layout (light default, dark switch)

**What changed**

- Two themes on one token set in `apps/studio/src/styles/app.css`: light is
  the default (`:root`), dark is `:root[data-theme='dark']`. All ~90
  hard-coded colors outside the 3D overlays (status text, wells, code blocks,
  borders, scrims, shadows, axis labels, pill plates) became semantic tokens
  (`--ok-text`, `--well`, `--code-bg`, `--scrim`, `--shadow-lg`, …) with a
  value per theme. World chroma still tints both themes; in light mode the
  accents are mixed toward ink so accent text stays readable on white.
- Theme switch: a sun/moon button in the top bar and a "Dark theme" toggle in
  Settings, persisted as the boolean setting `darkTheme` (default `false`)
  through the existing validated settings loader. `src/lib/theme.ts` applies
  it (`data-theme`, `color-scheme`, `<meta name="theme-color">`); `main.tsx`
  applies it before React renders so a dark-theme visitor gets no light flash.
- Type: self-hosted Inter (UI and display, optical sizing) and JetBrains
  Mono (code, labels) replace the system serif/sans fallbacks, which rendered
  as DejaVu on Linux. Display text uses weight and tight tracking instead of
  synthesized italics.
- Alignment and symmetry: mirrored side panels (`--side-w`, equal widths at
  every breakpoint), one radius for panels and viewport, composer aligned to
  the chat gutters, a centered key hint, a two-column shortcut table with
  descriptions left and key caps flush right (one column on phones), a
  distinct gear icon (the old one looked like the new sun icon), and on
  phones the brand mark yields its space to the world name.

**SECURITY**

- New input boundary: the persisted `darkTheme` flag. It goes through
  `loadSettings`, which keeps only known keys of boolean type; a regression
  test checks that `"dark"` (string) is rejected.
- No `innerHTML`, `eval` or `new Function`. `applyTheme` writes only
  constant attribute values from a two-value union.
- CSP unchanged: fonts are same-origin (`font-src 'self' data:` already
  allows them) and the preload `<link>` is same-origin. No CDN, no new
  connect-src.
- Downloads verified: the Inter 4.1 and JetBrains Mono 2.304 release zips
  were fetched from their official GitHub releases. Archive SHA-256, subset
  file SHA-256 and the OFL 1.1 licence text are recorded in
  `docs/THIRD_PARTY.md` and shipped next to the fonts.
- No new npm dependencies; `npm audit --omit=dev`: 0 vulnerabilities.

**PERFORMANCE**

- No render-loop or per-frame code touched; the theme is pure CSS custom
  properties, swapped by one attribute write.
- Bundle: JS unchanged apart from about 1 KB (theme module and toggle).
  Stylesheet source 65.5 KB → 71.6 KB (gzip 13.1 → 14.4 KB, +1.3 KB). Fonts
  are 108 KB (Inter) + 43 KB (JetBrains Mono) woff2, Latin-subset from about
  350 KB + 300 KB upstream. Inter is preloaded; both use `font-display: swap`,
  so first paint and the first 3D frame never wait on them. They are
  separate HTTP-cached files, not part of the JS bundle.
- Firefox/WebGL2 measured too: the e2e `firefox-webgl2` run passes,
  including the theme switch step (light background channel mean 240, dark
  13).

**Verification**

- `tsc -p tsconfig.json --noEmit`: 0 errors.
- Vitest: 68 files, 1080 tests passed (new `apps/studio/test/theme.test.ts`).
- `npm run build -w @aether/studio`: ok. `npm run smoke`: 13/13.
- `npm run e2e`: Chromium WebGPU, Chromium WebGL2-only and Firefox WebGL2
  all passed. The new `themeSwitch` step checks the light default, that the
  self-hosted font loaded, the switch to dark, that the choice persisted,
  and the switch back.
- Visual check: desktop (1440×900) and phone (390×844) screenshots in both
  themes, plus the Settings dialog.

## Memory budgets (GPU budget, low memory mode, context-loss recovery)

**Measured problem.** Headless Playwright, 1440×900 viewport, production
build, offline mock provider. Process memory is PSS summed over the
browser's processes (`/proc/<pid>/smaps_rollup`).

| | Before | After |
| --- | --- | --- |
| Firefox, starter world idle (tab / whole browser) | 163–165 MB / 830–838 MB | 158 MB / 729 MB |
| Firefox, vite dev server, idle (whole browser) | 985 MB | 880 MB (no second renderer under StrictMode) |
| Firefox, vite dev server, after 6 agent runs | 1,461 MB | 1,373 MB |
| Chromium, starter world idle (tab / JS heap) | 123–160 MB / 36–53 MB | 115 MB / 36 MB |
| Chromium, after 20 agent runs + 20 play/stop (tab / heap after GC) | 268–280 MB / 66–76 MB (12 runs) | 284 MB / 102 MB (27 history entries, 48 chat entries, both capped) |
| Frames drawn by an idle editor on the starter world (fireflies) | 60 per second, forever | 0 after 30 s without input |
| Sun shadow map cap | 4096² (128 MB with its colour target) | 2048² (32 MB); 1024² in low memory mode |
| Pixel ratio cap | 1.5 on every GPU, no pixel cap | 1.25 integrated / 1.5 discrete / 1 software, plus a 2.1 / 3.7 / 1.4 MP cap |
| Estimated drawing-buffer + shadow GPU memory at 696×832 | — | 74–98 MB (26 MB in low memory mode) |
| QuickJS WASM files in the build | 4 (4.26 MB) | 1 (0.50 MB), loaded only for worlds with scripts |

What did *not* grow: 32 play/stop cycles left the Chromium heap flat
(50 → 51 MB). Agent runs plateau once the generator cache is warm
(~65 MB). History worlds are 24–46 KB of JSON each. GPU-side cost scales
with drawing-buffer pixels: SwiftShader's GPU process grew by 97 MB going
from 0.58 to 1.30 MP (≈135 bytes per pixel). On an integrated GPU that is
system RAM, which is why the pixel budget is the main lever. Headless
Firefox's parent process (≈550 MB with an empty world) is the browser's
own software GL and does not respond to the app's settings, so tab
memory is the budget metric for Firefox.

**What changed**

- `@aether/render`: `gpu/budget.ts` (pure): `classifyGpu` (WebGL renderer
  string / WebGPU adapter info), `renderBudget` per class and for low memory
  mode, `effectivePixelRatio` (ratio cap + absolute pixel cap).
  `gpu/backend.ts`: backend preference `auto | webgpu | webgl2`, with
  `pickBackend` / `adapterKnownGood`. Firefox gets WebGL2 on Linux, and
  WebGPU elsewhere only for a non-fallback NVIDIA/AMD/Apple adapter. The
  crash guard now also covers the adapter probe. `WorldRenderer`: budget-driven
  resize, `setLowMemory`, post pipeline released while unused and rebuilt
  lazily, `onContextLost` (replaces three's log-only handler), `memoryStats`,
  `frameCount`, and `render({ animate })` to freeze weather while idle.
  `EnvironmentRig.shadowMapCap` now shrinks the current map right away; the
  first frames of a low memory boot used to allocate 2048² anyway.
- `@aether/core` `History.setMaxEntries/size/entryLimit`. `@aether/procgen`
  `GeneratorCache` byte budget and `outputBytes`, plus idle termination of
  sandbox workers (60 s). `@aether/physics` collider caches are now
  byte-bounded too (32 MB each).
- `@aether/logic`: QuickJS is reached only through `scripting/lazy.ts`, and
  `runner.ts` imports the single `@jitl/quickjs-wasmfile-release-sync`
  build. A unit test walks the static import graph to keep it that way.
- Studio: `lowMemory: auto|on|off` and `backend` settings, migrated from
  `lowPower` / `preferWebGPU`. Automatic low memory mode turns on for
  `deviceMemory` ≤ 4, latched heap pressure or a lost context. It shows a
  "Low memory" top-bar badge and caps history at 40 entries. Context-loss
  recovery remounts the canvas through `rendererEpoch`, using WebGL2 after a
  lost WebGPU device, at most 3 times in 2 minutes. The loop pauses while
  the page is hidden (audio suspended) and weather freezes after 30 s idle.
  The perf HUD gains vram/heap rows. A superseded StrictMode attach no
  longer creates a GPU context.

**SECURITY**

- New input boundaries: the persisted `backend` / `lowMemory` settings are
  allowlist-validated strings (prototype-pollution payload tested).
  `navigator.deviceMemory` and `performance.memory` are feature-detected
  and must be finite positives. The WebGPU adapter info strings are capped
  (512 chars for classification, 256 for display) and used only in regex
  tests and text nodes. Context-loss messages are truncated to 200 chars
  and shown through React text, never as HTML.
- No `eval`, `new Function`, `innerHTML` or `dangerouslySetInnerHTML`
  added (grep). CSP unchanged: QuickJS loads the same WASM as before, from
  a lazy same-origin chunk. Verified in Chromium and Firefox that it is
  requested only on the first `validateScript`.
- No new subprocesses in the app. The e2e helper runs `ps` with an argument
  array, a 10 s timeout and a 16 MB output cap.
- Dependencies: `quickjs-emscripten` was replaced by its own sub-packages
  `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync`
  (0.32.0, exact, MIT, already in the lockfile). One `npm install` removed 4
  packages. `npm audit --omit=dev`: 0 vulnerabilities. Recorded in
  `docs/THIRD_PARTY.md`.

**PERFORMANCE**

- Per-frame allocations: the render options object is reused, and
  `syncPost` and the idle check allocate nothing in steady state. Stats
  (`memoryStats`) are collected at 4 Hz only. Allocation probe (Chromium,
  play mode, GC'd baseline, 4 s): no measurable heap growth.
- GPU resources: after 20 agent runs + 20 play/stop cycles and reloading
  the starter world, the reference-counted geometry cache (30), materials
  (17) and three's textures (24) match the warm baseline exactly in both
  browsers, and GPU geometries match within one (47 → 48, 49 → 49). This is
  asserted by `npm run e2e:memory`.
- Bundle: eager JS `vendor` 148.4 → 96.3 + 1.5 KB. QuickJS glue moved to a
  lazy 50 KB chunk. The eager entry is 619 → 575 KB, with `@aether/core` split
  into a shared 53 KB chunk. Dist WASM: −3.76 MB (3 unused QuickJS builds gone).
- First frame not regressed (e2e: Chromium WebGPU 2.7 s, Firefox 1.5 s on
  software GL). Firefox/WebGL2 measured throughout (table above).
- Memory bounded: generator cache 64/48/32/16 MB by tier and mode,
  collider caches 32 MB each, history 150/40 entries, chat 120 entries,
  idle sandbox worker reclaimed after 60 s.

**Verification**

- `tsc -p tsconfig.json --noEmit`: 0 errors. Vitest: 72 files, 1135 tests.
- `npm run build -w @aether/studio`: ok. `npm run smoke`: 13/13.
- `npm run e2e`: Chromium WebGPU, Chromium WebGL2-only and Firefox WebGL2
  passed. `npm run e2e:memory` with `AETHER_MEM_IDLE_S=120` and 20 cycles
  passed in Chromium (WebGPU + forced-WebGL2 context-loss recovery) and
  Firefox (WebGL2 + context-loss recovery). It was rerun with 6 cycles
  after the shadow-cap fix.

## Professional, responsive studio UI and projects home

**What changed**

- Design system rewritten from scratch (`apps/studio/src/styles/`: tokens,
  base, controls, editor, panels, home; the 3.6k-line `app.css` is gone).
  Cool neutral greys (OKLCH, hue 265, near-zero chroma) and one indigo
  accent, light by default and a quiet dark theme; 4/8 px spacing, three
  radii (6/8/12), two elevations, type scale 11–24 px with weights
  400/500/600, 32 px controls (28 px dense rows, 44 px on coarse pointers),
  one 150 ms ease-out curve on colour/opacity/transform only, reduced motion
  honoured. A metric-matched fallback face (`size-adjust` / ascent / descent
  overrides) means the Inter swap causes no layout shift; `/theme-boot.js`
  applies the saved theme, or the system one on a first visit, before first
  paint.
- Gimmicks removed: the glossy orb (now a two-stroke vector logomark), world
  chroma tinting of the UI, pastel and rainbow cards, all-caps letter-spaced
  labels (rule keywords included), the gradient italic headline, viewport
  corner brackets, the aurora "weave" and light sweep, entrance animations,
  heavy shadows. The performance HUD is off by default (View menu, display
  menu, Shift+P). The busy state is a 2 px progress line plus one status
  line; loading uses skeletons, never spinners.
- Editor information architecture: three-zone top bar (app menu, panel
  toggle, editable project name, save status | Play, undo/redo, Add, View |
  renderer chip, performance, command palette, Share, Export, inspector
  toggle); an icon rail switching the left panel between Agent, Objects,
  Assets, Logic, Checks and History; a sectioned inspector (scene settings
  with nothing selected — sky, time, weather, light, fog, ground, gravity,
  play camera, variables, viewport — object sections otherwise); viewport
  overlays: camera presets, checks button, display options, a tool dock
  (select / move / rotate / scale gizmos, add, focus, delete, frame, labels),
  an axis gizmo that resets the camera, a dismissible navigation hint,
  floating labels with screen-space collision culling, touch controls in
  play mode. Assets is a palette of 42 placeable objects with rendered
  previews (click or drag onto the viewport).
- Transform gizmos (`@aether/render` `TransformGizmo` over three's
  TransformControls, loaded lazily): the rendered object moves while
  dragging; one undoable `update` patch is committed on release (no-op drags
  are ignored); orbit is disabled while a handle is dragged and a click on a
  handle never changes the selection. Hidden in play mode and in captures.
- Command palette (Ctrl/⌘+K) on both halves of the app: actions, panels,
  tools, camera, view toggles, every placeable asset, templates, projects and
  every object in the world, fuzzy-ranked. One fixed-position tooltip
  element serves every control (label + shortcut), placed and clamped to the
  viewport, hosted inside modal dialogs when needed, never on touch.
- Responsive editor (`src/lib/layout.ts`): wide ≥ 1280 (rail + left panel |
  viewport | inspector, outer columns balanced at 320 px, resizable 240–440
  px by drag or keyboard, persisted), medium 1024–1279 (one side panel at a
  time, the other a rail), tablet 768–1023 (full-width viewport, drawers),
  phone < 768 (viewport above a bottom sheet with drag handle, three snap
  points, scrollable tabs; the smallest snap is a prompt bar), landscape
  phones get a compact bar. The viewport keeps its tree position in every
  mode, so resizing never recreates the renderer.
- Projects home (`#/`, `#/templates`, `#/projects`, `#/published`, `#/docs`;
  editor at `#/p/<id>`): collapsible sidebar (bottom tab bar on phones),
  search, "New project" dialog (prompt, empty or starter scene, template,
  import), template row and grid with real renders, "Recently opened" in grid
  or list view, card menu (open, rename, duplicate, export, delete with
  confirm and Undo), sort, drag-and-drop import, empty states, in-app
  documentation. Projects live in IndexedDB (`src/projects/`); the legacy
  single localStorage world is migrated into the first project once.
  The editor autosaves (debounced, serialized writes, "Saved" indicator) and
  captures a WebP thumbnail after agent turns, when the tab is hidden and
  when leaving.
- Template thumbnails (8 × 640×360 WebP, 6.6–17.3 KB) and asset previews
  (40 × 192×192, 0.8–4.9 KB; the two lights get an icon) are rendered by
  `npm run thumbnails` with the real renderer. `Simulation.thumbnail`
  waits (bounded, 6 s) for grow-in and camera flights: captures taken
  mid-materialisation were missing distant scenery.
- Bugs fixed on the way, each with a regression test: settings changed
  while the renderer was still starting were not applied to it (the attach
  read a stale snapshot — the perf overlay never started counting); menus
  could not take focus or close on Escape (focus attempted while the list
  was `visibility: hidden`).

**SECURITY**

- New input boundaries, all validated with caps:
  - URL hash routes: strict regexes for ids (`[a-z0-9]{8,32}`) and template
    slugs; 256-char cap; anything else is the home page (tested with
    traversal, script and oversize inputs).
  - IndexedDB records: metadata parsed with zod (`ProjectMeta`, including
    timestamps, slugs and counts); world bodies through
    `validateImportedValue` (prototype-pollution guard + `validateWorld`);
    chat through `reviveChat`; thumbnails accepted only as
    `image/webp|jpeg|png` ≤ 60 KB on write and re-checked on read (an SVG
    blob planted behind the repository is rejected — tested). 200 projects,
    6 MB per project; quota errors become actionable messages. IDB requests
    time out after 5 s; a blocked upgrade yields instead of hanging.
  - Imported files (picker and drag-and-drop): size checked before reading
    (5 MB), then `parseWorldImport`.
  - Reference images attached to prompts: PNG/JPEG/WebP only, ≤ 8 MB,
    decoded by the browser, re-encoded to ≤ 1024 px JPEG, at most 4.
  - Thumbnail data URLs from the renderer: allowlisted MIME, base64 only,
    length-capped before decoding.
  - localStorage: home preferences, panel widths (clamped) and the new
    settings (`repairs` 0–3, booleans) are type-checked; `theme-boot.js`
    caps the value it parses and only reads a boolean.
  - BroadcastChannel (cross-tab refresh): the payload is ignored; other tabs
    only trigger a re-read that is validated as above.
  - LLM/world text in the new UI (labels, tooltips, palette, cards) is set
    with `textContent` or React text nodes only.
- No `innerHTML` / `dangerouslySetInnerHTML`, `eval` or `new Function`
  added. CSP unchanged: `/theme-boot.js` is a same-origin script (no inline
  script); the select chevron is a CSS `data:` image (`img-src` already
  allows `data:`). No new connect-src, no secrets in the client.
- No new npm packages: `zod` (already in the workspace) became a direct
  studio dependency. TransformControls ships with `three` (MIT). Previews
  are our own renders; provenance recorded in `docs/THIRD_PARTY.md`.
  `npm audit --omit=dev`: 0 vulnerabilities.

**PERFORMANCE**

- Per-frame work: camera-dependent overlays (axis gizmo, labels) run outside
  React from a view listener called only on frames that redraw. Gizmo axes
  write `SVGAnimatedLength` values (no strings); label sizes are measured
  once per label set and culled with a preallocated rect buffer; a label's
  transform is rewritten only when it moves by a whole pixel. Allocation
  probe (Chromium, 120 orbiting frames, no GC in between): labels on vs off
  shows no measurable difference against the WebGPU backend's own per-frame
  bookkeeping (~6–14 KB/frame either way).
- GPU resources: `npm run e2e:memory` — after 20 agent runs + 20 play/stop
  cycles geometries 48 → 46 (Chromium) and 49 → 49 (Firefox), textures
  24 → 24, materials 17 → 17. Heap after the cycles 101–103 MB, as in the
  previous stage (102 MB); idle editor draws 0 frames in 3 s.
- Bundle: the editor and engine (three.js, physics glue, agent, render) are
  a lazy chunk, prefetched on intent (hover/focus of a card or "New
  project"). The home page now loads 463 KB of JS (entry 155 KB + React
  219 KB + vendor 96 KB; gzip ≈ 146 KB) instead of the whole engine; the
  editor chunk is 594 KB (gzip 198 KB). Stylesheet 71.6 → 86.8 KB (gzip
  14.4 → 16.0 KB). Static previews: 8 template WebPs (≈ 91 KB, all eager on
  the home row) and 40 asset WebPs (≈ 112 KB, lazy, only in Assets).
- First frame (e2e, software GPU): Chromium WebGPU 1.9–2.3 s (previous
  stage 2.7 s), Firefox WebGL2 1.2–1.9 s (previous 1.5 s; the editor chunk
  adds one request on a deep link). Home: template cards visible at 112 ms
  (Chromium) / 311 ms (Firefox), no layout shift observed.
- Firefox measured throughout: e2e, layout, projects and memory suites all
  run in Firefox; idle Firefox browser memory 729 → 446 MB (lazy editor).
- Thumbnail capture + WebP encode on the main thread: 12–31 ms, only at
  idle moments (after a turn, tab hidden, leaving) — not worth a worker
  round trip (OffscreenCanvas transfer is not uniformly available).
- Memory bounded: thumbnails as ≤ 60 KB blobs, object URLs revoked when
  stale or on unmount, 200-project cap, pending-run queue capped at 16.

**Verification**

- `tsc -p tsconfig.json --noEmit`: 0 errors. Vitest: 78 files, 1208 tests
  (new: router, project repository/model/migration/creation, query and
  fuzzy search, relative time, layout modes and panel routing, palette
  (every asset commits as a valid entity), thumbnails, reference images,
  labels and projection maths, tooltip placement, touch stick, sheet snaps,
  keyboard labels, gizmo wrapper, Studio project mode and autosave, gizmo
  commits, settings race regression).
- `npm run build -w @aether/studio`: ok. `npm run smoke`: 13/13.
- `npm run e2e`: Chromium WebGPU, Chromium WebGL2-only and Firefox WebGL2
  passed (boots through `#/new`; README screenshots regenerated, plus the
  projects home and the phone editor).
- `npm run e2e:layout` (new): 8 sizes × home, projects list, docs, editor
  agent, assets + selection, play, phone sheet — Chromium and Firefox, no
  violations. The checker treats content cut by `html`/`body` as off-screen
  and reports anything cut by a non-scrolling ancestor; it caught a composer
  clipped by 10 px on touch phones, a perf HUD overlapping the play HUD on
  phones and doubled focus outlines, all fixed.
- `npm run e2e:projects` (new): Chromium and Firefox passed.
- `npm run e2e:memory`: Chromium and Firefox passed.
- Visual review: more than four critique-and-fix rounds of screenshots at
  1440, 1280, 1024, 900, 844×390 and 390 px, light and dark, Chromium and
  Firefox (cards overflowing their columns, scrolled-away empty state,
  truncated project name, unbalanced rails, misaligned template row, label
  clutter, alarming idle fps colour, inner focus outlines, menu focus).

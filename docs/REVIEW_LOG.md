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

## Zero-cost AI connections and AI path readiness

Scope reviewed: the local bridge (`apps/bridge`), tool-use emulation, the
browser bridge client, fallback, WebLLM, BYO key, the studio connection
manager and composer controls, the quality loop and the library/eval
scripts. Defects found and fixed in this pass (each with a regression test
that fails without the fix):

1. **Model id injection into CLI arguments (security).** `POST /v1/complete`
   validated the top-level `model` against `MODEL_ID_RE`, but the emulated
   provider preferred the inner `request.model` (free-form, ≤ 128 chars),
   which then reached `claude --model <value>` / the Codex model option. The
   bridge now drops the inner model, and both backends refuse any model id
   that fails the pattern before spawning or creating the SDK client.
2. **On-device mode could never answer.** The planner prompt is about 15.7k
   tokens; the offered WebLLM models hold 4,096 (input and output). Added the
   compact prompt profile (`WorldAgent` `promptProfile: 'compact'`:
   condensed IR, catalog ids only, one example, `apply_patches` + `finish`,
   15-entity summary, last exchange of history capped at 400 chars, 1,200
   output tokens) and a context guard in the WebLLM backend that refuses
   requests that cannot fit (reason `webllm_context`, explained in the UI)
   and caps `max_tokens` to what is left. Measured with a 135-entity world
   and prior history: about 2.6k input tokens on the first call, 3.0k on the
   follow-up.
3. **Stale connection badge after a failure.** After a fallback (bridge
   stopped, pairing expired, not signed in) nothing re-probed the
   connection, so the composer kept a live badge and every later prompt
   retried the dead bridge first. The studio now re-probes the failed
   connection in the background on fallback.
4. **Few-shot example failed its own test.** The domino example shown to
   every live model left `domino-6` leaning on the bell at 35°, failing its
   `topples` test and costing a repair round on every similar prompt. The
   bell moved to x = 4.1 (passes from 4.0 to 4.3); every example with tests
   is now verified with real physics in the suite.

**SECURITY**

- Input boundaries: bridge HTTP bodies (streamed size cap 16 MiB, zod
  schemas for pair/complete, response re-validated), Host header
  (DNS-rebinding guard), exact Origin allowlist (https unless loopback, no
  wildcards), bearer token on status/complete (256-bit, constant-time
  compare, in memory only), pairing codes (single use, 10-minute expiry,
  rotated after 5 wrong guesses, 20 attempts per minute globally); CLI
  stdout parsed line by line with an 8 MiB cap and a fail-closed tool
  observer; LLM output validated by the emulation protocol (zod, ≤ 16 calls,
  ≤ 600k chars per input, one re-ask); deep link token removed from the
  address bar before the router runs and validated; pairing token and BYO key
  in sessionStorage only (the connection e2e asserts the token never reaches
  localStorage); WebLLM engine shape checked after the lazy import.
- Headless agents: argument arrays only (`shell: false`), allowlisted
  environment (keys/tokens/session variables dropped even if allowlisted by
  name), fresh private temp directory deleted afterwards (also when the run
  throws, now tested), timeouts with SIGTERM→SIGKILL escalation, abort on
  client disconnect. Claude Code: `--tools ""` plus a deny list, empty strict
  MCP config, `--safe-mode`, no setting sources, slash commands off,
  `dontAsk` with no permission prompts, no session persistence, structured
  output only; any other tool in the init event or any other tool call kills
  the run. Codex: read-only sandbox, approval never, no network, web search
  off, 28 tool features off, every configured MCP server disabled by name
  (refuses to run if the list cannot be read), strict output schema, any
  command/file/MCP/web event aborts the run. Flags verified against
  `claude --help` (2.1.296) and the Codex SDK 0.162.1 types.
- CLI failure text is classified, never forwarded (test asserts paths,
  emails and keys do not leak); `claude auth status` returns the account
  email, which the bridge does not pass on.
- CSP: new test keeps `vercel.json` and the server's directives identical and
  strict (no `'unsafe-inline'`/`'unsafe-eval'` scripts, wildcards only for
  `http://127.0.0.1:*` / `http://localhost:*`, the documented bridge).
- No `eval`/`new Function`, no `innerHTML` added. No new dependencies in this
  pass. `npm audit --omit=dev`: 0 vulnerabilities. Hosted server default
  provider stays `mock`; BYO keys are passed through per request and never
  logged or stored.

**PERFORMANCE**

- No render-loop code changed in this pass (agent, bridge and the send path
  only), so per-frame allocation is unchanged from the previous probe.
- Bundle: first load (home) 464 KB of JS, unchanged (previous stage 463 KB);
  the editor chunk grew 0.46 KB (480.51 → 480.97 KB); WebLLM stays a 6.1 MB
  lazy chunk loaded only after the explicit opt-in.
- Bridge memory bounded: response cache LRU (128 entries / 16 MiB), one job
  per backend with ≤ 4 waiting, status probes cached for 30 s, MCP list for
  60 s, at most 16 tokens kept.
- Headless work stays off the browser main thread entirely (it runs in the
  CLI processes); on-device generation runs on the GPU in WebLLM's engine.
- GPU disposal and memory: `npm run e2e:memory` (Chromium and Firefox),
  see Verification.

**Verification**

- `tsc -p tsconfig.json --noEmit`: 0 errors. Vitest: 91 files, 1361 tests
  (new: compact profile and WebLLM context guard, studio on-device turn,
  re-probe after fallback, inner-model regression and flag-like model
  refusal for both backends, temp-dir cleanup on throw, failure
  classification, CSP sync, example verification).
- `npm run build -w @aether/studio`: ok. `npm run smoke`: 13/13.
- `npm run e2e`: Chromium WebGPU, Chromium WebGL2-only and Firefox WebGL2
  passed.
- `npm run e2e:connection` (new, costs nothing): the real bridge handler
  with scripted backends. In Chromium and Firefox: pairing by code in
  Settings, Codex ready / Claude Code not signed in badges, session-only
  token, a whole turn through the bridge with the strict `input_json` reply
  form, verification and the vision critic, a real CORS preflight from the
  studio origin; deep link pairing scrubbed from the address bar; not signed
  in, rate limited and bridge stopped all finish with the offline planner
  and a notice that says what to do, and the badge then shows the bridge
  offline.
- Real Codex / Claude Code calls were not repeated in this pass (the
  latencies in ARCHITECTURE §12.1 come from the earlier `npm run e2e:bridge`
  run); the CLI discovery commands the bridge relies on (`codex login
  status`, `codex debug models`, `codex mcp list --json`, `claude auth
  status --json`) were re-checked on this machine without model calls.

## Zero-cost AI connections — follow-up audit

Scope: re-audit of every item of the stage against the code (bridge, both
headless backends, emulation, browser client, connection manager, composer
and settings, BYO-key passthrough, server headless providers, library, eval,
quality loop), then the gates and real runs. Defects fixed, each with a
regression test:

1. **Stale model id sent to the CLI.** The composer and Settings sent the
   saved Codex / Claude Code model even when the signed-in CLI's catalog no
   longer listed it, so every call would fail and fall back. New
   `effectiveBridgeChoice` (studio `ai/connection.ts`) keeps the saved model
   only while the catalog lists it (else the backend's `defaultModel`), keeps
   the effort only when that model supports it, and is used by `resolve`,
   `createProvider`, the model picker check marks and the Settings select.
2. **Hosted page + Safari silently "offline".** WebKit (Safari and every iOS
   browser) blocks `http://127.0.0.1` from https pages, which surfaced only
   as "bridge offline". `hostedBridgeNote` now shows a clear note in the
   setup pane (WebKit: use Chrome/Edge/Firefox or run the studio locally;
   Chromium: allow local-network access if asked), plus a troubleshooting
   entry; README and ARCHITECTURE document it.

**SECURITY**

- No new input boundary: the user agent and origin are read locally and
  only select a static message; the model choice is taken from the bridge
  status, which is already zod-validated (`BridgeStatusSchema`, ids match
  `MODEL_ID_RE`) and re-checked by the bridge before any CLI argument is
  built. No `eval`, no `innerHTML`, CSP unchanged, no new dependency.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Re-checked: tokens in sessionStorage only, bridge Host/Origin/bearer
  enforcement, tool lockdown of both CLIs, restricted environment, temp
  directory cleanup, BYO key never logged (vendor error text not logged).

**PERFORMANCE**

- No render-loop or engine code changed; per-frame allocation and GPU
  disposal are unchanged from the memory stage (`e2e:memory` not re-run).
- Bundle: editor chunk 480.97 → 480.86 KB; first-load chunks unchanged;
  WebLLM remains a lazy 6.1 MB chunk loaded only after opt-in.

**Verification**

- `tsc -p tsconfig.json --noEmit`: 0 errors. Vitest: 91 files, 1368 tests.
- `npm run build -w @aether/studio`: ok. `npm run smoke`: 13/13.
- `npm run e2e`: Chromium WebGPU, Chromium WebGL2-only, Firefox WebGL2 passed.
- `npm run e2e:connection`: Chromium and Firefox passed.
- `npm run eval` (offline): patch error rate 0 %, verification 100 %,
  quality mean 87.9.
- Real runs (`npm run e2e:bridge`, Chromium, one prompt each): Claude Code
  `haiku` 54.4 s, verified after one repair, quality 89; Codex `gpt-6.1-sol`
  140.1 s, verified after two repairs, quality 88. Both worlds were built
  through the bridge with no fallback. All servers, bridges and browsers
  started for these runs were shut down.

## Full editor, local AI and the coding-agent worker

Scope: selection and transforms (multi-select, marquee, gizmo with space,
pivot and snapping, align/distribute, duplicate, copy/paste across
projects, group/ungroup, reparenting, hide/lock, focus), parametric
procedural objects with worker regeneration and "Bake to mesh", mesh edit
mode (vertex/edge/face, extrude, inset, subdivide, smooth, merge, normals,
UV unwrap, soft selection), sculpt / vertex paint / scatter paint brushes,
material editor and eyedropper, visual rule cards, behaviour / physics /
joint forms, editable checks; the agent ↔ manual round trip (hand-edit marks,
locks); in-app sign-in, conversation continuity per project and per-turn
model/token display; local AI on the server (worker processes, deep builds
by a coding agent, durable job queue with server-sent events, several Codex
accounts).

Defects found during the review and fixed (each with a test):

1. **Generator sandbox blocked by the page CSP in production.** The sandbox
   worker compiles model-written generators with `new Function`; served with
   the page's `script-src 'self' 'wasm-unsafe-eval'` it failed with an
   `EvalError`, so every custom or deep-built generator was rejected on the
   production server and the static deployment. Only the sandbox worker
   script now gets `default-src 'none'; script-src 'self' 'unsafe-eval'
   'wasm-unsafe-eval'` (no network, no nested workers); the page policy is
   unchanged. Server middleware and `vercel.json` agree (`csp.test.ts`), and
   `e2e:local` places a deep-built generator in Chromium and Firefox.
2. **The editor never passed its project id to `Studio`**, so per-project AI
   preferences and the new per-project conversation key were silently
   global. `EditorRoute` now passes it; `e2e:local` asserts the
   `p-<projectId>` session key on every call.
3. **Worker results could never parse.** `WorkerResult` was a zod
   discriminated union with two `ok: true` variants, which throws at parse
   time; every worker result would have been reported as a crash. Now a
   plain union (worker runner tests run real child processes).
4. **Codex agentic runs had no tool host.** The read-only lockdown disables
   `code_mode_host`, which the agentic run also inherited, so a real deep
   build could not touch its workspace (found by the real smoke run). The
   agentic configuration keeps `code_mode_host`, `shell_tool`,
   `unified_exec` and `view_image` and nothing else; the user's own Codex
   skills are no longer injected (`skills.include_instructions = false`,
   bundled skills off), for both quick and agentic runs.
5. **A job could be reported finished before its workspace was deleted.**
   The workspace is now removed before the final event is emitted.

**SECURITY**

- New boundaries and their validation: `/api/local/*` bodies and replies
  (zod schemas in `@aether/agent` `local-protocol.ts`, JSON body guard with
  depth/node/string caps, body limit, rate limits), route parameters
  (project keys, account ids and job ids matched against strict patterns
  before use), the `after` cursor (≤ 7 digits), worker stdin/stdout/stderr
  (`WorkerJob` / `WorkerResult` / progress lines, 16 MB stdout cap, 4 KB
  progress lines), persisted job records (re-validated on load), the account
  registry (zod, ids only, ≤ 8 accounts), bridge `/v1/auth/*` and
  `/v1/sessions/*`, mesh assets (strict base64 decoding, lengths, index
  ranges, finite coordinates, per-mesh and world byte caps), clipboard
  paste (`aether/entities` JSON validated as patches), every editor commit
  (patch validation in `applyPatches`).
- Local AI is never served by a hosted deployment: `AETHER_LOCAL_AI` is off
  in production and when hosting markers are present (startup error if
  forced on there), the Docker image sets `AETHER_HOSTED=1` and
  `AETHER_LOCAL_AI=off`, and every `/api/local/*` request must arrive on a
  loopback socket with a loopback `Host` and no proxy headers
  (`X-Forwarded-For`, `X-Real-IP`, `Forwarded`, …). State-changing requests
  need `Content-Type: application/json` and an allowed `Origin`, so another
  site in the user's browser cannot drive it; DNS rebinding fails the Host
  check.
- Credentials: sign-in runs the CLIs' own commands; Aether only relays the
  verification URL and one-time code they print (output sanitised, ANSI and
  control characters stripped). No credential file is read, stored or
  transmitted; the account registry holds `{id, label, home}` only (0600),
  account homes are 0700, removal is limited to homes inside the registry
  folder.
- Subprocesses: argument arrays only, no shell; allowlisted environment (no
  keys or tokens; the desktop session variables only for a browser sign-in);
  timeouts everywhere; worker processes are detached into their own process
  group and killed as a group (SIGTERM, then SIGKILL after 3 s), and all are
  stopped on shutdown. Model ids reach CLI arguments only after
  `MODEL_ID_RE`.
- Untrusted code from the coding agent: Codex works inside its own
  `workspace-write` sandbox (network off, approval `never`, core-only
  environment, MCP/web search/plugins off); Claude Code is restricted to
  Read, `Write(./out/**)`, `Edit(./out/**)` and `Bash(node check.mjs:*)`,
  and every tool call is screened as it streams. The checker that executes
  generator code runs under the Node permission model (read the workspace,
  write only `out/`, no child processes, workers, addons or WASI): it
  re-spawns itself confined when the agent starts it, and the host always
  runs its own pristine bundle confined. `node:vm` is never used in the
  server process for agent output. The final artifact is read without
  following links (`lstat`, `realpath`, `O_NOFOLLOW`, ≤ 120 KB), statically
  screened, validated by the confined checker, then validated once more by
  the studio's generator sandbox. Workspaces are 0700 temp folders, always
  deleted.
- No `eval` outside the sandboxes (the sandbox worker's scoped CSP is the
  only `'unsafe-eval'`), no `innerHTML`/`dangerouslySetInnerHTML` (the
  sign-in link is a React `<a>` with `rel="noopener noreferrer"` and only
  `https://` URLs pass the parser), no secrets in the repository, logs carry
  metadata only. Path traversal: every path built from input is checked to
  stay inside its root (`insideWorkspace`, account homes, job files by id
  pattern). Prototype pollution: JSON bodies are screened by
  `inspectUntrusted`, patches by core's key checks, persisted records by zod.
- Dependencies: `esbuild` 0.28.2 (MIT, already in the lockfile through
  `tsx`) is now a direct, exactly pinned dependency of `@aether/bridge`;
  recorded in `THIRD_PARTY.md`. `npm audit --omit=dev`: 0 vulnerabilities.

**PERFORMANCE**

- Dragging: the gizmo moves a pivot proxy and the selected objects' render
  nodes directly; the document is written once on release (one commit),
  so a drag costs no patch, diff or physics rebuild per frame. Live sculpt
  and paint previews update the existing GPU attributes in place
  (`SculptSession.takeDirty` gives the changed vertex range for a partial
  upload; `transformVerticesInto` and `previewMeshGeometry` reuse their
  output buffers) and commit once per stroke.
- Heavy CPU work is off the main thread: mesh operations and parameter
  regeneration run in the compute worker (`ComputeClient`, debounced, latest
  wins, timeout → worker replaced); AI calls and deep builds run in separate
  processes on the server.
- GPU disposal: replaced or removed mesh assets dispose their geometries
  (shared attributes, one index buffer per material slot); overlays (wire,
  markers, brush ring, joint lines) reuse their buffers and are disposed with
  the overlay. See Verification for `e2e:memory`.
- Caps / LRU: ≤ 128 meshes, 65 536 vertices and 131 072 triangles per mesh,
  24 MB of mesh data per world, 20 000 painted scatter points; conversation
  store LRU 64 with a 6 h idle limit; finished build jobs kept ≤ 100 with ≤ 2
  000 events each; quick calls 1 running + ≤ 4 waiting, builds 1 running +
  ≤ 4 waiting.
- Bundle: the editor chunk grew from 480.9 KB to 634.5 KB (202 KB gzip) with
  the editing UI and tools; the compute worker (240 KB) and the generator
  sandbox worker load on demand; the local AI settings live in the lazy
  settings chunk. Mesh-edit operations are 27 KB minified, so no further
  split was worth a loading state. First-load JavaScript of the home page is
  492 KB (index, React, vendor, core schemas); WebLLM stays a lazy 6.1 MB
  chunk behind its opt-in.
- Real local AI runs on this machine: a quick completion through a worker
  process took 12.7 s with Codex (default model) and 4.4 s with Claude Code
  (`haiku`); a deep build of a garden lantern with Codex (low effort, budget
  2 rounds) passed the checker in round 1 and was accepted after host
  validation in 64 s. The first deep-build attempt (before fix 4) showed the
  progress stream and the clean failure path.

**Verification**

- `tsc -p tsconfig.json --noEmit`: 0 errors. Vitest: 101 files, 1 514 tests
  (new: worker protocol and runner with real child processes, process-group
  kill on timeout and cancel, allowlisted environment, agentic loop with a
  fake Codex SDK, Claude tool screening, confined checker (reads, writes,
  processes), artifact links, durable jobs (queue, frozen account, events,
  restart, cancel, caps), worker text backend and conversations, sign-in
  and accounts, `/api/local` guard and endpoints including SSE replay,
  bridge `/v1/auth` and `/v1/sessions`, local client reconnects, deep build
  in the agent, local connection ordering in the studio, sandbox worker
  CSP). One run was fully green; a later run under heavy unrelated machine
  load (load average ≈ 8 from a desktop browser) missed the physics timing
  test "1000 dynamic boxes under 8 ms" (9.6 ms); physics code is unchanged
  in this stage.
- `npm run build -w @aether/studio`: ok. `npm run smoke`: 13/13.
- `npm run e2e`: passed (Chromium WebGPU, Chromium WebGL2-only, Firefox).
- `npm run e2e:editing`: Chromium WebGPU and Firefox WebGL2 passed (gizmo
  move + undo, parameter regeneration, bake → extrude → hull collider,
  sculpt stroke undo/redo, scatter paint ≈ 200 points, rule card edited and
  checked in Play).
- `npm run e2e:local` (new, costs nothing: scripted `/api/local` replies):
  Chromium and Firefox — automatic mode picks Codex on this computer, a deep
  build streams its progress, its generator passes the studio sandbox and is
  placed, every call carries `p-<projectId>`, the done line names the model;
  "Connect Codex" card and device sign-in with cancel.
- `npm run e2e:connection`: Chromium and Firefox passed with the new sign-in
  rows.
- Real runs (owner's machine, four model calls in total): the three planned
  worker calls (Codex and Claude Code quick completions, one Codex deep
  build) plus one repeat of the deep build after fixing defect 4, which then
  passed (64 s).
- `npm run e2e:memory`: Chromium WebGPU passed (heap 83 → 105 MB over 20
  cycles, GPU geometries/textures/materials constant, context-loss recovery
  ok). **Firefox failed its tab-growth budget** (332 → 534 MB and 332 → 766
  MB in two runs, budget +160 MB) with GPU object counts constant. A probe
  isolated it to agent turns (12 play/stop cycles alone: 331 → 338 MB; 12
  agent turns: 323 → 458 MB, falling slowly while idle). Not resolved in
  this stage; see the open item below.

**Open items**

- Firefox tab memory grows across offline agent turns in `e2e:memory`
  (above). Chromium's heap stays within budget and the renderer's GPU object
  counts are constant, which points at garbage the Firefox process keeps
  (agent turns, quality-view captures, undo history of very different
  worlds) rather than leaked GPU objects, but this was not proven and the
  budget was not relaxed.

## Performance and architecture: verification workers, lazy Rapier, frame-loop work

Scope: physics verification in module workers (protocol, pool, parallel
fork verification, live results, main-thread fallback), lazy and lighter
Rapier/QuickJS loading, the remaining hot-path items (terrain picking,
pooled `getTransform`, numeric physics event keys, once-per-tick world-state
JSON for scripts) and frame-loop work (allocation probe, BVH raycasts,
static-prop instancing, adaptive resolution, asynchronous captures).

Measurement machine: a laptop in its power-saving profile (CPU at about
1.2 GHz, platform profile `quiet`), headless browsers on a software GPU
(SwiftShader). Composited frames take about one second in Chromium there,
for the build at the start of this stage as well; absolute timings are
therefore slow, comparisons are made against that build (`85dfae2`, built
separately and run with the same probes).

Defects found during the stage (each with a regression test):

1. **Rapier wasm rewrite passed a property of the URL.** The compat bundle
   calls its initialiser with `toByteArray("…").buffer`; the first version
   of the build plugin replaced only `toByteArray("…")`, so the initialiser
   got `"/assets/….wasm".buffer` and every verification failed with
   "Invalid base URL" (caught by the new e2e assertion that verification ran
   in a worker). The plugin now consumes the trailing `.buffer` and a test
   runs it on the real package and checks the argument is the URL itself.
2. **Captures froze the page for seconds.** Critique views and thumbnails
   read the canvas back synchronously (`drawImage` + `toDataURL`), which
   waits for the whole GPU queue: 24–37 s of a single main-thread task on
   the software GPU. Captures now render into a reused output render target
   and use `readRenderTargetPixelsAsync`, then encode on a CPU-backed
   canvas with `toBlob`. Compared with the synchronous path after the camera
   settled: mean absolute pixel difference 1.4–2.3 / 255 (JPEG noise) in
   Chromium WebGPU, Chromium WebGL2 and Firefox, correct orientation on both
   backends; thumbnail capture in Firefox 34 ms.
3. **Per-frame garbage found by the new allocation probe:** array
   destructuring in the weather update, `Map` entry iteration in the
   selection highlighter, a `Map.clear()` per physics step (a new hash table
   every step) and boxed doubles in the camera damping and BVH traversal.
   All fixed; the probe asserts < 16 sampled bytes per frame.

**Before → after**

| | Before (`85dfae2`) | After |
| --- | --- | --- |
| Rapier main chunk | 4,231 KB (1,615 KB gzip) | 217 KB (38 KB gzip) + 3,010 KB wasm (1,144 KB gzip), shared by page and workers |
| All JS + wasm + CSS in `dist` | 14,041 KB (4,956 KB gzip) | 13,746 KB (4,715 KB gzip) |
| Editor chunk (first load of the editor) | 620 KB | 651 KB (+31 KB: pool, protocol, live view, BVH, batches) |
| Transferred until the first frame | 2,826 KB | 2,858 KB (Rapier and QuickJS still not loaded) |
| First frame, Chromium WebGPU / WebGL2 / Firefox (2 runs each) | 3.9–5.5 s / 10.9–11.7 s / 4.2–4.4 s | 4.4–5.9 s / 7.8–11.3 s / 4.3–4.8 s (noise) |
| Verification on the main thread during an agent turn | the whole run (cooperative 8 ms slices) | none; longest non-render script while a worker verifies: 0–9 ms |
| "Run checks" on a rendered world (e2e) | — | 109–166 ms in 2 lanes; longest task 0 ms, worst stall 53–62 ms (Chromium), 0 ms (Firefox) |
| Longest main-thread task in an agent turn (Chromium WebGPU) | 32–39 s (sync capture) | 0.7–3.4 s (three.js material compile of the new world, see below) |
| Raycast on a 131k-triangle terrain | 11–21 ms per ray | 0.03–0.05 ms (BVH build 30 ms warm, at idle) |
| Physics event drain, 1000 boxes | 1.36–1.42 ms, strings per contact | 1.22–1.32 ms, no allocation for steady contacts |

QuickJS already shipped a single variant (`quickjs-emscripten-core` +
`@jitl/quickjs-wasmfile-release-sync`, one 503 KB wasm); the worker build
reuses the same wasm file. Neither QuickJS nor Rapier is modulepreloaded.
Static-prop instancing was sized on the 13 smoke worlds: it saves up to 19
draw calls per pass (bowling alley); procedural props are unique per seed
and scatter was already instanced, so no impostor LOD was added.

**Security**

- New input boundary: worker messages. Requests are zod-validated in the
  worker (discriminated union, strict objects, request ids), the world is
  re-validated with `validateWorld` (prototype-pollution screen, caps),
  colliders are typed-array checked with per-shape and total caps (≤ 5000
  entities, ≤ 2048 colliders each, ≤ 16 M numbers, heightfield sample count
  checked). Replies are zod-validated on the main thread (strings clipped to
  2000 chars, lists ≤ 512, finite numbers); unknown or late replies are
  ignored. Malformed requests get a `failed` reply when an id is
  recoverable; the handler never throws.
- The worker runs only our code; model-written generator code never enters
  it (its colliders arrive as data) and behaviour scripts stay in QuickJS.
  It is served with `default-src 'none'; script-src 'self'
  'wasm-unsafe-eval'; connect-src 'self'` by the Node server and
  `vercel.json` (tested); the page CSP is unchanged. No `eval`,
  `new Function` or `innerHTML` in the new code.
- Resource caps: per-request timeout (budget + 20 s cold start) terminates
  the worker; cancellation by `AbortSignal`; at most 2 workers, idle ones
  terminated after a minute.
- The build plugin reads only the wasm next to the resolved Rapier module and
  rewrites it only when the file is byte-identical (SHA-256) to the inlined
  module. No new dependencies; `npm audit --omit=dev`: 0 vulnerabilities.

**Performance**

- Allocation probe (`tests/unit/alloc-probe.ts`, V8 sampling heap profiler
  through `node:inspector`, collected objects included): pose application
  for 500 bodies, camera rig orbit + follow, grow-in, highlighter, frame
  stats, adaptive resolution, environment + 5000 weather particles, static
  batches with a moving member, BVH ray misses and the physics event drain
  all stay under 16 sampled bytes per frame after JIT warm-up.
- Heavy CPU in workers: verification (now), generator sandbox and mesh
  operations (before). BVH builds run at idle.
- GPU resources: capture targets are an LRU of two sizes, disposed with the
  renderer; instanced batch buffers are released on regroup (unchanged
  batches are kept, not recreated) and never dispose shared geometry or
  materials.
- Memory bounded: pose pool ≤ 4096 records, impulse slots ≤ 8192 pairs,
  interned event ids compacted at 2^15, BVHs held by a `WeakMap` per
  geometry, live verification list ≤ 200 tests.
- Unit tests: 1,581 tests in 110 files (new: worker protocol through the
  pure handler, pool with fake workers running the real handler —
  sharding, progress, cancel, crash, start failure, timeout, idle —,
  shard planning and merging, renderer colliders, live feed throttling,
  verify shards/abort/progress, event collector, world-state JSON, pose
  pool, Rapier plugin, BVH against three.js on transformed meshes and all
  material sides, adaptive resolution, static batches, allocation probes,
  worker CSP).

**Verification**

- `tsc -p tsconfig.json --noEmit`: 0 errors.
- Vitest: 1,580/1,581 in the full parallel run; the failure is "steps 1000
  dynamic boxes in under 8 ms" under load (8.6–9.7 ms), which passes alone
  in this build and in the stage-start build alike (power-saving CPU; seen
  in an earlier stage too).
- `npm run build -w @aether/studio`: ok. `npm run smoke`: 13/13.
- `npm run e2e`: passed in Chromium WebGPU, Chromium WebGL2 and Firefox
  WebGL2. Every agent turn verified in workers (1–2 lanes), no non-render
  main-thread script above 9 ms while a worker verified, "Run checks" with
  no long task.

**Open items**

- The first frame of a newly built world (or new lighting) compiles three.js
  node materials on the main thread: 0.7–4 s single tasks on this machine
  (Chromium), event-loop stalls of 1.6–12.6 s in Firefox. This is the
  remaining source of long tasks during agent turns; verification and
  captures no longer contribute. Progressive compilation (`compileAsync`
  per entity behind the grow-in) is the next step.
- `npm run e2e:memory -- --only=firefox` still exceeds its tab-growth budget
  (401 → 583 MB over 20 cycles, peak 755 MB at cycle 15, budget +160 MB; the
  previous stage measured +202 and +434 MB). GPU object counts stayed
  constant (49 geometries, 30 textures, 17 materials). The budget was not
  relaxed.

## Engine R&D: virtual geometry, scatter fields, grade, wind, fly-through

**What changed**

- `packages/render/src/virtual/`: QEM simplifier (half-edge collapse),
  meshlet clustering with spheres and normal cones, cluster LOD DAG with
  watertight cut selection, a DAG worker + validated client, the per-mesh
  `VirtualGroup` (shared vertex buffers, one packed dynamic index buffer,
  budget governor), automatic LOD chains, the chunked `FieldCuller` and the
  `ScatterField` (one instanced mesh per level and part).
- `SceneSync`: parts with ≥ 20k triangles become virtual geometry (full
  detail raycast-only), scatter layers with ≥ 2 000 instances become fields;
  `updateView` re-plans both (throttled to 120 ms while moving, forced for
  captures); `sceneTriangles`, `fieldStats`, `virtualStats`.
- Renderer: per-GPU `fieldInstances/fieldTriangles/virtualTriangles`
  budgets, sky-derived colour grade in the post pass, p90 resolution
  governor, foliage wind (TSL position node), fly-through tour, built-in
  generators in the compute worker.
- Content: `colossus` generator (moai head / carved standing stone /
  boulder, 49k–786k smooth triangles), terrain variant 3 (canyon), the
  offline planner's "Canyon of Colossi" theme and template, physics collider
  views of huge outputs.
- Schema (backward compatible): scatter `count` ≤ 1 000 000, total ≤ 2 000 000.
- Studio: scene-vs-drawn triangle badge, fly-through button,
  `?engine=classic`. Tests: `virtual`, `scatter-field`, `virtual-mesh`,
  `dag-client`, `tour`, `grade`, `sculpture`, alloc probes, CSP, badge.
- Experiments + `docs/RESEARCH_LOG.md`; `npm run e2e:benchmark`.

**SECURITY**

- New input boundaries: DAG worker messages are validated on both ends
  (`parseDagRequest`: typed arrays only, ≤ 2 M vertices / 12 M indices, every
  index in range, finite positions; `validateDag`: types, lengths, offsets,
  index and group ranges, NaN-free LOD data), one build at a time, 60 s
  timeout, the worker is terminated and respawned on timeout or crash.
  Built-in generation through the compute worker re-validates outputs
  (`validateOutput`) and falls back inline. `?engine=classic` is an exact
  string compare. The World IR limits stay zod-enforced (count ≤ 1 M per
  layer, 2 M total) and renderers clamp to per-GPU budgets.
- No eval / `new Function`; the DAG worker gets its own CSP
  (`default-src 'none'; script-src 'self'`) on the Node server and in
  `vercel.json` (tested); the page CSP is unchanged (no `'unsafe-inline'`
  scripts, no new wildcard). No innerHTML: the badge renders React text.
- No secrets, no network, no subprocesses, no downloads, no new
  dependencies (`npm audit --omit=dev`: 0 vulnerabilities). Spark was only
  evaluated from `npm view` metadata.
- Memory caps: DAG cache 96 MB LRU (0 in low-memory mode), LOD chain LRU
  (24), field buffers bounded by the triangle budget, index capacity by
  `virtualTriangles`.

**PERFORMANCE**

- Per-frame allocations: allocation probes cover field + virtual view
  planning with a moving camera (50k pines, two sculptures) and the
  fly-through (rig update): 0 B/frame from render code. Fixed on the way:
  doubles boxed through calls and object fields in the tour (typed state
  arrays, inline spline weights) and in the caster-reuse check (inlined).
- Workers: DAG builds (seconds of CPU for 400k+ triangles) and built-in
  generation run off the main thread; the full-detail mesh is never drawn
  while a hierarchy builds (it caused 43 s of blocked page in the critique
  views on SwiftShader before).
- GPU resources: showcase rebuilt twice with a small world in between
  (`e2e:benchmark --cycles=2`, Firefox): 66 GPU geometries vs 68 baseline,
  textures 28, cached geometries 22, materials 7 — flat.
- Uploads: found that three re-uploads `DynamicDrawUsage` buffers on every
  use; static usage + ranged version bumps took Firefox from 100 ms to 33 ms
  median frame (render CPU 118 → 21 ms) on the showcase.
- Bundle: the new render modules add ~34 KB minified (13.8 KB gzip) to the
  editor chunk (EditorRoute 713.9 → 721.6 kB as built) plus 4.7 KB for the
  sculpture generator; the DAG worker (15.3 KB) loads only when a mesh needs
  it. Nothing over 50 KB was added to the first frame.
- First frame: unchanged path for ordinary worlds (fields/virtual mount
  only for ≥ 2 000 instances / ≥ 20k triangles); built-ins now generate in
  the worker, so heavy generators no longer block it.
- Firefox/WebGL2 measured (integrated Intel GPU): showcase p50 33 ms,
  p90 67–83 ms while orbiting, 236 M scene triangles → 1.5 M drawn, 70
  draws (the classic engine: 33 ms for 27 M triangles, a tenth of the
  forest); Chromium on
  SwiftShader is GPU-bound at ~1.3 s per frame for the same scene (software
  rasterizer), with software-tier budgets lowered to 300k field / 250k
  virtual triangles.

**Gates** (this stage, final runs): `tsc -p tsconfig.json --noEmit` 0
errors; Vitest 1 641 tests in 118 files passing; studio build OK;
`npm run smoke` 14/14 (the showcase template is now part of the set);
`npm run e2e` passed in Chromium WebGPU, Chromium WebGL2 and Firefox
WebGL2; `e2e:layout` and `e2e:projects` pass in Chromium and Firefox.
Earlier `npm run e2e` attempts failed twice with "no verification run
was observed" and once with a 646 ms long task during "Run checks" on
WebGL2, while another process on the machine used a full core. The first
was a real race in the studio: `LiveVerifyFeed.plan()` published the
worker/lane plan only through its 60 ms coalescing timer, so a run that
ended before the timer fired (the page busy compiling shaders) never showed
that it ran in a worker. The plan is now published immediately (regression
test in `verifyWorker.test.ts`); the long task did not reproduce. Fixed on the way:
the projects e2e counted 8 templates (now reads the template list), the
tool dock overflowed into the axis gizmo at 1024–1366 px and off screen on
phones (it now scrolls within its column), and the connect card's text
shrank below a word's width in the landscape-phone agent panel (it wraps
onto its own row).

## Local-first app: the `aether` command, local hardening, first-run sign-in

Scope of this section: `apps/cli` (new), `apps/server/src/{local-guard,
log-file}.ts` (new), `app.ts`, `config.ts`, `main.ts`, `routes/local.ts`,
`apps/studio/src/onboarding/` (new), the chip in the top bar and home
header, `tests/e2e/cli.e2e.ts`, `SKIP_FIRST_RUN` in the other e2e suites.
The hosted bring-your-own-key path (direct browser calls, provider CSP
origins, removal of the server key passthrough) was built in parallel and is
reviewed in its own section.

**SECURITY**

- New input boundaries, each validated with caps:
  - CLI arguments: a hand-written parser with an allowlist of commands and
    flags, numeric ranges for ports and line counts, a host regex, and
    https-only `--origin` (no credentials, paths or wildcards; at most 8).
    Unknown input exits with code 2.
  - State files: `server.json` is read through a strict zod schema (unknown
    keys rejected, ≤ 16 KiB). The `secret` / `access-token` files must match
    `^[A-Za-z0-9_-]{32,128}$`, and a damaged secret is replaced. Everything
    is written atomically (temp file + rename) with mode 0600, in a 0700
    folder.
  - Server env: `AETHER_ALLOWED_HOSTS` (regex per `host:port`, ≤ 16),
    `AETHER_BRIDGE_ORIGINS` (https or loopback http, ≤ 16),
    `AETHER_INSTANCE_ID` (regex), and secret *files* whose values are never
    echoed in config errors. `redactConfig` masks the secrets, and
    `secretValues` adds them to the log scrubber.
  - HTTP: Host header (exact allowlist, ≤ 300 chars, 421 otherwise), cookies
    and the `X-Aether-Admin` header (constant-time SHA-256 +
    `timingSafeEqual`, ≤ 256 chars), and the `?access=` query (constant time,
    then a 303 that strips it from the URL).
  - Health / status bodies in the CLI and the studio: zod / manual shape
    checks, size caps (16 KiB CLI, 256 KiB studio) and timeouts (1.5 s CLI
    health; 2.5 s studio health; 25 s local status).
  - `aether:ai-prefs` window event: only known `AiPrefs` keys pass
    (`pickPrefsPatch`, regression-tested against `__proto__`), and the
    receivers re-validate every value with the prefs schema.
  - localStorage `aether.onboarding.v1`: validated on read; invalid records
    count as absent.
  - Log lines shown by `aether logs`: control characters stripped, ≤ 2000
    chars per line, at most 512 KiB tailed or 4 MiB per follow read.
- Subprocesses: the server child, Vite, codex/claude login/logout and the
  browser opener all use argument arrays with `shell: false` and
  `windowsHide`. Windows `.cmd` shims go through `cmd.exe /d /s /c` with fixed
  arguments, and any argument containing `"%^&|<>` or a newline throws
  (tested). Interactive sign-in gets the allowlisted env plus
  DISPLAY/WAYLAND/DBUS/BROWSER/TERM only (`restrictedEnv` drops anything
  named like KEY/TOKEN/SECRET/AUTH). The server child keeps the user's env
  (it needs PATH, HOME, CODEX_HOME), minus hosting markers. Its own AI
  workers restrict their env as before.
- No eval / `new Function` was added. No `innerHTML` is used. Every first-run
  text is rendered by React, and the sign-in URL is the CLI's sanitised
  https URL in an `<a rel="noopener noreferrer">`.
- CSP unchanged by this part (same-origin studio needs nothing new; the
  provider origins belong to the BYOK section). The csp tests still pass.
- No secrets in the client bundle or logs. The session secret only travels
  in an HttpOnly cookie (the e2e checks `document.cookie` cannot see it) and
  the CLI header. Device codes go only to the local page that asked for
  them, never into logs (they are not log fields).
- DNS rebinding: the Host allowlist applies to every route, static files
  included. The e2e sends a rebound Host to the running app and gets 421.
  Cross-site: SameSite=Strict cookie + Origin allowlist + JSON-only bodies
  (preflight). LAN mode needs an explicit flag, prints a warning, requires a
  fresh 32-byte token, and keeps local AI loopback-only.
- Stopping: only a pid confirmed by health instance id or `/proc` cmdline
  is signalled; anything else needs `--force`. Shutdown and pairing links
  need the CLI header; the studio's cookie is not enough (tested).
- Path traversal: no user-controlled paths. The state folder comes from the
  CLI flag or env of the same user, and every file name is a constant.
- Dependency audit: `npm audit --omit=dev` → 0 vulnerabilities. No new
  external dependencies (the CLI reuses tsx and zod already in the lockfile;
  `npm install` only registered the `@aether/cli` workspace).

**PERFORMANCE**

- Hot loops: none added. The first-run probe runs once per page load
  (StrictMode-safe guard), the sign-in poll is a 2 s interval only while a
  CLI sign-in runs, and nothing runs per frame. No allocation probe was
  needed.
- Bundle: eager JS +≈2.2 KB gzip (`firstRun.ts` 1.1 KB, host 0.7 KB, prefs
  event 0.4 KB), CSS +4.6 KB raw (≈1.2 KB gzip). The screen itself is a lazy
  11.2 KB (3.7 KB gzip) chunk, loaded only when it has to show. It pulls the
  already-lazy AI connection chunk then, never on a returning visit.
- First frame: unaffected. The probe is asynchronous and the modal mounts
  only after it decides to show.
- Memory: the first-run store is one small object, and the log follower
  reads bounded chunks. The rotating log keeps at most 4 × 5 MiB.
- Server: the Host/session guards are O(1) per request (a Set lookup and
  two SHA-256s over ≤ 256 bytes). Log writes are synchronous appends of one
  line per request (a local app; crash-safe).
- Firefox/WebGL2: the CLI e2e runs the complete flow (first-run screen,
  device code, offline world) in Firefox as well as Chromium.

## Hosted build: bring your own API key (direct to provider)

**Scope.** Four key providers (Anthropic, OpenAI, OpenRouter, Google
Gemini) are called straight from the browser. The new
`createChatCompletionsProvider` serves OpenRouter and Gemini, and Anthropic
gets a `browser` flag. Keys are stored per provider, in session storage by
default, with an opt-in "remember on this device". A per-session call cap
and a token estimate apply, and there is a per-provider model picker that
loads the provider's own list. The server passthrough `/api/llm/byok` is
removed. CSP `connect-src` lists exactly the four API origins. The local
bridge stays available on the hosted build. New `npm run e2e:hosted`
serves the static dist with no `/api`.

**SECURITY.**
- Input boundaries: keys (`BYOK_KEY_RE`, no whitespace, so no header
  injection) are re-validated on every storage read. Unknown providers and
  `__proto__` entries are dropped. Usage counters are clamped. Model ids in
  preferences are zod-validated (`BYOK_MODEL_RE`). Provider model lists are
  zod-validated, at most 8 MiB, 5 000 parsed and 200 kept, with a 15 s
  timeout. Chat Completions replies go through a defensive normalizer
  (tool calls ≤ 64, ids ≤ 128 chars, numbered by position when missing).
- Secrets: the key lives only in the `AiConnection` instance, never in the
  zustand state (a test asserts the serialized state has no key). It is not
  in logs or exports. A unit test and the e2e (both browsers) assert the
  key never reaches Aether's origin. The client bundle was scanned for
  key-shaped strings: none. No `eval`, and no `innerHTML`.
- CSP: still no `'unsafe-inline'` scripts. The only wildcards remain the
  loopback bridge. Four explicit https origins were added, and a test keeps
  `BYOK_API_HOSTS`, `vercel.json` and the studio catalog identical. The
  CORS allowlist lost `X-Aether-Provider` / `X-Aether-Key`.
- Spend: refuses calls beyond 150 per session before sending. Each attempt
  has a 120 s timeout and at most 1 retry. Chat Completions output is
  capped at 32 000 tokens.
- No new dependencies (npm audit unchanged by this work).

**PERFORMANCE.**
- No render-loop code touched, so there are no per-frame allocations.
- Bundle: `byokCatalog` is its own 1.7 KB chunk (0.6 KB gzip), imported by
  the first-run screen without the agent package. The direct providers
  (about 6 KB of source) join the existing agent chunk, which the editor
  already loads, so nothing was added to the first frame.
- Model lists are cached per provider and key (≤ 8 entries per page).
- Measured own-key turn on the static build (scripted provider): Chromium
  27–39 s (SwiftShader, dominated by the first frame and verification) and
  Firefox/WebGL2 3.9 s.

**Gates run for this part.** tsc is clean in every file this part touched.
`apps/studio/test/byok.test.ts` (new, 19 tests), `ai.test.ts`,
`studioAi.test.ts`, `packages/agent/test/chat-completions.test.ts`, the
server suite including `csp.test.ts`, and the agent suite all pass (390
tests). Studio build OK. `npm run e2e:hosted` passes in Chromium and
Firefox: own-key turn, the first-run key path, bridge pairing, and an
offline turn with no `/api`. One regression was fixed with a test: Chat
Completions tool calls without ids were numbered by content position
(`call_1` after a text block) instead of call position.

## Local-first app, completion pass: hosted page leads with your own Codex login

**Scope.** The stage's earlier parts (the `aether` command, local
hardening, the local first-run screen, bring-your-own-key) were checked
against the brief and kept. Changes in this pass:

- Hosted first-run screen (`apps/studio/src/onboarding/FirstRun.tsx`): the
  order is now **Use your own Codex / ChatGPT login** (primary), **Use your
  API key**, **Explore offline**. The bridge path shows the one command
  (`npx aether start --origin <this origin>`), pairs with the code (or the
  printed link), and then reuses the Codex sign-in rows through the paired
  bridge: device code, live status, account, model picker, and "Use Claude
  Code instead" when Claude Code is signed in on that computer. Choosing
  saves `{ mode: 'bridge', backend, codexModel }`. A "Bridge address" field
  covers a non-default bridge port. The Codex sign-in component is now one
  component for both targets (local server or bridge).
- `tests/e2e/hosted.e2e.ts`: the fake bridge gains a scripted device-code
  sign-in and a signed-in Claude Code. A new scenario runs the full hosted
  first-run bridge path in Chromium and Firefox on the static build with
  no `/api`.
- README (deployment: the hosted copy is static with no key; the container
  is an optional self-hosted server), docs/CONTRACTS.md (hosted test ids
  and order), docs/SECURITY.md (bridge sign-in from the hosted page).
- Repository health, so the gates are green again. A separate, interrupted
  architecture and voxel work stream had left four suites failing:
  - `packages/arch/src/nav.ts`: walkways were inflated by a full radius on
    a 5 cm grid, so a 0.8 m door could never pass a 0.8 m walkway check
    (quantisation). The radius now subtracts half a cell. The apartment
    regression test covers it.
  - `packages/arch/test/compile.test.ts`: the villa case asserted a
    flat-roof fallback for a rectangular top floor, which contradicted the
    compiler's rule and the test's own title. It now asserts the gable roof.
    Its stair also ended 0.4 m from a wall, so the checker correctly
    rejected it. The fixture now starts the stair at x = 0.5, and a new
    negative test keeps the boxed-in stair flagged.
  - `packages/procgen/src/generators/index.ts`: the `arch-*` / `furn-*`
    generators are no longer registered as built-ins. They break the
    built-in conventions (not recentred, a new category) and added about
    2 k tokens to every planner prompt (the prompt-budget test failed). The
    module stays exported for when that integration is finished.
  - `packages/voxel/test/alloc.test.ts` (an unfinished allocation probe that
    never passed and gave different results run to run) and the scratch
    `scripts/.allocx.ts` were removed. The collision sweep no longer passes
    or returns doubles across calls (`MOVE` / `SWEEP` scratch arrays), which
    removes one source of boxing.
  - `packages/arch/src/index.ts`: exports the building compiler API that
    its test imports.

**SECURITY.**
- New input boundaries: the bridge address typed on the hosted screen goes
  through `normalizeBridgeUrl` (loopback http(s) only, no credentials, at
  most 200 chars). Pairing codes are limited to 9 characters. The
  bridge's sign-in replies are zod-validated by the existing
  `createBridgeAccountApi` (`LoginStateSchema`: https-only URL, code ≤ 16,
  output ≤ 4000). The bridge itself is unchanged: bearer token, origin
  allowlist, Private Network Access preflight, Host check.
- The verification link is rendered by React in an
  `<a rel="noopener noreferrer">`. There is no `innerHTML`, no `eval` and
  no `new Function` in the onboarding code (grep).
- CSP unchanged: the loopback bridge was already in `connect-src`, and
  there are still no `'unsafe-inline'` scripts. No secrets: the pairing
  token stays in sessionStorage (unchanged), and the device code is never
  logged.
- `npm audit --omit=dev`: 0 vulnerabilities. No new dependencies.

**PERFORMANCE.**
- No render-loop code touched in the studio. The sign-in poll runs every
  2 s only while a sign-in is in progress, and its client is memoised per
  pairing (no interval churn on re-render).
- Bundle: the lazy `FirstRun` chunk grows from 11.2 KB to 12.8 KB raw
  (4.0 KB gzip). Nothing was added to the first frame. The procgen chunk
  shrinks, because the architecture generators are no longer pulled into
  the built-in registry.
- Voxel collision: no doubles boxed through argument passing or return
  values in `slide` / `sweepBodyAxis`.

**Gates.** tsc 0 errors. Full Vitest: 136 files, 1 866 tests pass. Studio
build OK. Smoke: 17/17. `npm run e2e:hosted` (Chromium + Firefox: own-key
turn, hosted first-run key path, first-run bridge path with device code,
Settings pairing, offline turn with no `/api`) and `npm run e2e:cli`
(`aether start` on a temporary state folder and a free port, local
first-run screen, device code via a fake Codex CLI, continue offline, world
built, `aether stop`, process gone; Chromium + Firefox) both pass.

## Local-first app, final pass: Windows process handling, cancel race, completed sign-in e2e

**Scope.** I re-checked the stage against the brief: the `aether` command,
local hardening, the local and hosted first-run screens, bring-your-own-key,
and the bridge on the hosted build. Everything was already in place and was
kept. This pass fixed three defects, each with a regression test, and filled
one test gap:

- **Windows: `.cmd` shims could not be spawned by the server.** npm installs
  `codex` / `claude` on Windows as `.cmd` shims, and Node refuses to spawn
  those with `shell: false`. Only the CLI's own `login` had the
  `cmd.exe /d /s /c` plan. The server's sign-in manager, the CLI probes
  (`login status`, `debug models`, `mcp list`) and the Codex SDK path did
  not. The plan now lives in `@aether/bridge` (`spawn-plan.ts`: `commandPlan`,
  `spawnCli`, `sdkExecutable`) and every one of those spawn sites uses it.
  The Codex SDK is never handed a batch shim; it then uses its bundled
  binary with the same `CODEX_HOME`. `which` on Windows also tried the
  extensionless file first. That file is npm's POSIX sh shim, which Windows
  cannot run, so `which` now tries only `PATHEXT` extensions for a bare name.
- **Windows: cancel and stop orphaned the CLI.** `process.kill(-pid)` does
  not exist on Windows. The fallback ended only the worker or server
  process and left the Codex / Claude Code process it had started.
  `killTree` (`kill-tree.ts`) now ends the whole tree with
  `taskkill /PID <pid> /T /F` (argument array). The AI worker runner and
  `aether stop` use it. On POSIX, behaviour is unchanged: the process group
  is signalled, falling back to the pid.
- **Cancel race in the durable build queue.** A cancel that arrived while
  the workspace was being prepared, or while the result was being
  validated, was ignored when the worker did not see the abort. The job then
  ended `done` with a result. The full suite showed this as an intermittent
  failure of "cancels queued and running jobs" under load. `runAsset` now
  re-checks the abort after workspace setup and after validation. The new
  test "a cancel during workspace setup or validation wins" fails without
  the fix (`expected 'done' to be 'cancelled'`) and passes with it. The
  test's `wait` helper now uses a 10 s deadline instead of 200 iterations;
  no assertion was relaxed.
- **e2e gap: a completed sign-in.** `npm run e2e:cli` previously only
  cancelled the device sign-in. The fake Codex CLI can now finish it.
  A third phase in Chromium checks that the screen switches by itself to
  "Signed in · ChatGPT" with the CLI's own model list, that the chosen model
  is remembered, and that a reload shows neither the screen nor the
  "Sign in" chip. It then checks that `aether login` reports the existing
  login, that `aether doctor --json` reports Codex OK, and that
  `aether logout` works. No real CLI or quota is touched (PATH holds only
  the fakes and node).

**SECURITY.**
- No new input boundaries reach the network or the page. `commandPlan`
  refuses any argument with `"%^&|<>`, CR or LF for a batch shim instead of
  escaping it (tested with 7 metacharacter cases). Every spawn keeps
  argument arrays, `shell: false`, `windowsHide` and the allowlisted env.
  `taskkill` gets a numeric pid only. `killTreePlan` rejects pids ≤ 0 and
  non-integers, so `kill(-0)` / `kill(-(-1))` (every process of the user)
  can never be sent.
- `PATHEXT` entries are filtered to `^\.[a-z0-9]{1,8}$`.
- No eval / `new Function` / `innerHTML`. CSP unchanged. No secrets added
  anywhere. The fake CLIs in the e2e write only to the temporary folder.
- `npm audit --omit=dev`: 0 vulnerabilities. No new dependencies.

**PERFORMANCE.**
- No studio, render or frame-loop code changed in this pass, so there are
  no new per-frame allocations, the GPU resource lifecycle is unchanged, the
  bundle delta is 0 KB, and first frame is unaffected. The `npm run e2e`
  bundle report is identical in shape (total 14 485 KB, gzip 4 951 KB).
- `killTree` spawns one short-lived `taskkill` on Windows only, and only on
  cancel, timeout or stop. The abort checks in `runAsset` are two boolean
  reads per job.
- Firefox/WebGL2 was measured through the gates below. The hosted own-key
  turn took 2.7 s in Firefox and 19.5 s in Chromium (SwiftShader).

**Gates.** tsc 0 errors. Full Vitest: 137 files, 1 878 tests pass. Studio
build OK. Smoke 17/17. `npm run e2e` passes in Chromium WebGPU, Chromium
WebGL2 and Firefox WebGL2. `npm run e2e:cli` passes in Chromium and Firefox,
with the new completed-sign-in phase in Chromium. `npm run e2e:hosted`
(static build with no `/api`, mocked bridge) passes in Chromium and Firefox:
own-key turn, hosted first-run key path, the Codex login via the bridge
(pair, device code, model), Settings pairing, and an offline world.

## Block worlds (voxel engine + game kit), completion pass

**Scope.** The stage's earlier parts were checked against the brief and
kept: `@aether/voxel` (registry, palette chunks, seeded biomes / caves /
ores / structures, light, greedy meshing with AO, worker pool, streaming,
persistence, collision, DDA ray casts), the World IR additions
(`voxel`, `setVoxel`, `voxelEdit`, limits), agent tools and offline planner,
Rapier terrain colliders, the game kit and HUD, and `npm run e2e:voxel`.
This pass rendered the voxel prompts and played the game in both browsers,
on desktop and on phones, and fixed what that showed. Each fix has a
regression test.

- **Editor camera underground after a block-world prompt.** `isNewWorld`
  returned false for any world without entities, and most block worlds
  have none. The camera stayed at the starter world's height, inside the
  generated caves. Block terrain that appears or changes seed / preset now
  counts as a new world. Framing aims at what was built
  (`VoxelSession.editFocus`, compiled edit bounds), else the spawn, and a
  turn that only adds block edits reveals them (`addedVoxelEdits`,
  `Simulation.revealVoxelEdits`).
- **Hills hiding the subject.** The framing direction was fixed, so a
  mountain could cover half a castle. `clearViewOffset`
  (`apps/studio/src/voxel/framing.ts`) checks sight lines to the subject's
  centre and edges against the generator heightfield (no loaded chunks
  needed) and turns to the first clear side of eight, or steepens the view
  when every side is walled in.
- **Washed-out terrain.** Exp² fog reaching 95 % at the view distance
  fogged half-distance terrain by 53 %. Terrain now fogs itself: a linear
  fade over the horizontal distance to the streaming centre (the player in
  play, the orbit target in the editor), from half the view distance to the
  edge, plus the document's own fog density. The scene `FogExp2` keeps a
  lighter density for mobs and props. No material changes type, so no
  shader variants are added.
- **Structures.** Columns that carve are cleared up to the sky (no
  floating mountain tops above castles). Foundations reach down to the
  natural ground under the footprint, up to 48 blocks (no buildings
  overhanging slopes). `CompiledEdit.content` keeps the model's own extent
  for framing. Sand and sandstone are a little deeper so desert faces read.
- **Inventory overflowing the viewport.** The breakpoint was a window media
  query while the HUD lives in a viewport next to the editor panels. The
  HUD is now a size container (`container: vx-hud / inline-size`). The
  panel stacks below 820 px of viewport, slots share the width on phones,
  and Close no longer covers the header.
- **No touch play.** A phone could move and place, but not look, break or
  open the inventory. `VoxelInput` now handles touch: drag on the view to
  look, tap to place, touch and hold (280 ms) to break while aiming, a
  coarse primary pointer starts in touch mode, and touch never requests
  pointer lock. The HUD shows touch hints and an inventory button, the
  touch stick / buttons step aside while the inventory or death screen is
  open, and the hotbar clears them, including the safe area.
- **120 ms first-draw stalls while streaming (WebGPU).** three creates a
  mesh's GPU buffers and render object at its first draw. Chunks entering
  the view together (camera flights, the reveal after the shader warm-up)
  were all built inside one frame. `VoxelLayer.flushPrebuild` now builds
  new chunk meshes once per frame through the renderer's asynchronous
  compiler, even outside the view. That compiler yields between objects. A
  chunk removed while its build is pending is freed only after the build
  (no disposed geometry uploaded again).
- **Main-thread memory.** Chunk vertex arrays were kept on the CPU after
  upload (23–62 MiB at view distance 8). They are released once the
  pre-build has uploaded them. The release waits for the compiler's promise,
  because three calls `onAfterRender` during the compiler's projection pass,
  before anything is uploaded; the first attempt released on that callback
  and produced empty GPU buffers, which the e2e caught as WebGPU validation
  errors. Counts, bounds and versions stay. Chunk meshes are never ray cast,
  and a lost context rebuilds the terrain.
- **Copies per mesh request.** `VoxelJobPool.mesh` copied nine chunks into
  fresh buffers per request (about 2,600 buffers for one view). Jobs now keep
  chunk references, and `ChunkData.view()` packs them when the job is
  posted. Structured clone copies the indices natively, with no transfer,
  and the references are dropped once sent.
- E2E: `voxel.e2e.ts` checks that the inventory panel fits the viewport
  and that Close covers no header text. It adds a phone scenario
  (390 × 844, touch) in Chromium (CDP touch drag) and Firefox (touch
  pointer events), reports the JS heap and the frames that held blocking
  work, and gains `--webgl2` / `--touch` options. A fourth block prompt
  ("a blocky stone castle on a hill") joins smoke and the gallery. The
  committed scratch probes (`tests/e2e/.probe-*.ts`) were removed.

**SECURITY.**
- New input boundaries:
  - Touch pointer events: coordinates must be finite, only the first finger
    is tracked, gestures are ignored while UI is open, and `preventDefault`
    suppresses emulated mouse events, so no action fires twice.
    `matchMedia` is wrapped in try/catch.
  - Worker mesh messages: same schema as before (`ToWorker` with
    `instanceof` checks), still re-validated by the worker handler and
    `ChunkData.fromPacked`. Replies are checked by `checkMesh` /
    `fromPacked` as before.
  - No new network, storage, URL, postMessage-from-page or LLM paths.
- No `innerHTML`, `eval` or `new Function` in the voxel, HUD or render code
  (grep). The HUD's new strings are static React text. CSP unchanged. No
  secrets. No subprocesses or downloads.
- `npm audit --omit=dev`: 0 vulnerabilities. No new dependencies.

**PERFORMANCE** (headless SwiftShader, so relative numbers; the machine's
load average was 4–13 from other processes).
- Streaming view 8 (289 chunks), longest main-thread task after the first
  chunk: Chromium WebGPU **0 ms**. It was 116–125 ms in 4 of 6 runs
  before the pre-build; the profiler probe reproduced it 2/2 before the fix
  and 0/2 after. Chromium WebGL2 over SwiftShader still blocks inside GL
  calls (reported, not gated, as before). Firefox: frame gaps ≤ 100 ms.
- The voxel engine's own main-thread work per task (update / reply /
  upload batch): Chromium 2–3 / 3–4 / 0.9–1.3 ms, Firefox 6 / 5 / 5 ms.
  Firefox's worst streamer update was 14–27 ms before the copy-free
  packing. In-page timing in Firefox: `update` max 11 → 2 ms (total 202 →
  105 ms), `pool.mesh` total 121 → 15 ms.
- JS heap after streaming view 8 (Chromium WebGPU): **73 → 34–39 MB**.
- Edit → remesh median 16–22 ms in both browsers (the 16 ms desktop
  budget; SwiftShader shares the CPU).
- Memory while travelling: at most 348–382 chunks loaded (bound 441),
  meshes drawn ≤ 289; chunk meshes removed with a pending build are freed
  after it (20 create/destroy cycles: every geometry disposed, unit test).
- Allocation probe (`--expose-gc`, 10⁶ frames): `setFog`, `setFogOrigin`
  and an empty `flushPrebuild` allocate ≈ 0 B/frame (≤ 0.02, noise). The
  pre-build allocates only on frames that install chunks.
- Bundle: EditorRoute +1.4 KB; lazy chunks `session` (voxel) +5.1 KB,
  `voxel-layer` +2.1 KB, `VoxelHud` +0.5 KB JS. Nothing new on the first
  frame of ordinary worlds (the voxel code stays lazy).
- Non-voxel worlds: the new paths are behind `if (voxelLayer)`, and
  `npm run e2e` timings are unchanged.

**Gates.** tsc 0 errors. Full Vitest: 143 files, 1919 tests pass (+ the
lifecycle test added afterwards). Studio build OK. Smoke: 18/18. `npm run
e2e` passes in Chromium WebGPU, Chromium WebGL2 and Firefox WebGL2. One
earlier run hit an 827 ms SwiftShader WebGL2 frame during "Run checks",
which did not recur. `npm run e2e:voxel` passes in Chromium WebGPU,
Chromium WebGL2, Firefox WebGL2 and the phone / touch runs in both
browsers. Gallery renders of the four block prompts were inspected.

## Real-life architecture and the studio render

**Scope.** The interrupted attempts had already built most of the
building model in `@aether/arch` (plans, the mitred wall network, CSG-free
openings, slabs, roofs, stairs, the furniture kit, navigation and clearance
checks, `floorPlan2d`), its procgen generators, the `build_architecture`
agent tool with the offline planner, and a first `ArchView`. I checked
them, kept them, and completed the stage: the studio side was missing
entirely, the studio render did not exist, and rendering the prompts showed
real defects. Every fix below has a regression test.

- **Front doors swung outdoors.** A long facade is one merged wall whose
  stored room sides name only the room at one end, so a hall's front door on
  that wall resolved to the wrong side, and its leaf opened into the player
  walking up to it (the walkthrough e2e caught it in Firefox). Door swing
  and window interior sides are now sampled geometrically from the room
  outlines (`roomSide` in `compile.ts`).
- **Sectioned walls showed squashed window holes.** The cutaway scaled
  walls vertically. Walls are now rebuilt by their generator with a
  view-only `cut` param: drawn up to the cut, window holes filled, doorways
  open, a dark cap on the cut face (section poche). The same cut makes the
  section view show capped walls.
- **Wall-mounted pieces and ceiling fittings floated** over sectioned walls
  and hidden ceilings; they hide with their host now. Hidden pieces are
  re-hidden after content rebuilds.
- **Lamps blew out sunlit rooms and night interiors.** Interior lamps were
  about 5× a full sun in World IR units. Lamps now dim with daylight (off in
  full sun, which also removes a dozen point lights from every pixel), lamp
  and diffuser levels were lowered, and the skylight / sky reflections were
  made less saturated, so shaded white walls read pale grey instead of blue.
- **The pool showed the lawn.** The basin sits below the ground plane and
  its water was too; the water now stays above the ground and is opaque.
- **The studio pipeline leaked three GPU textures per toggle** (TRAA's
  placeholder and history depth textures, the converted beauty target).
  They are released explicitly; 20 toggles keep textures flat.
- **A section right after the exploded view hid the upper storey's walls.**
  The cut height was measured from the storey's lifted height while it was
  still settling back; the lift is now taken out of the cut.
- **Photo mode made the studio render the user's setting** (the quality
  callback wrote it back). Only real fallbacks are reported now.
- **A room drawn behind a bedroom could be unreachable**: its automatic
  door landed where the bedroom's furniture blocked it. The plan tool now
  tries the door at mid-wall, near either end, to other neighbours and from
  outside, and commits the first placement that passes the checks.
- **The floor plan sat under the building bar** once it was re-fitted to
  the real viewport size: the fit now keeps the bar, the tool column and the
  status line clear (`fitPlan` insets) and re-fits on resizes until the user
  pans or zooms.
- A requested fireplace on a window wall emptied the living room; the
  furniture falls back to other walls and the fireplace room keeps a solid
  wall for it. Café and office washrooms no longer get bathtubs.

What was added:
- **Studio render**: depth / normal / velocity pre-pass, GTAO on indirect
  light, temporal AA, doubled soft sun shadows, refinement while the view
  rests; falls back to realtime when unavailable.
- **Building bar and floor plan**: 3D / Plan, walls up / cutaway / down,
  stacked / exploded / one floor, x-ray, section slider, daylight study,
  Studio, Walk. The SVG plan draws poche walls, door swings, windows,
  stairs, furniture, room chips with areas and dimensions, and draws rooms
  (rectangle, polygon), doors and windows as undoable, checked edits
  (`plan-edit.ts`). Room chips also float over rooms in the 3D cutaway.
- **Walkthrough**: first person facing the entrance; E doors and switches
  (a switch only from its room side), 1–4 time of day, L all lights, R
  finish swap (real generator params), V view, P photo mode.
- **Merged building geometry** (`static-merges.ts`): static parts of a
  building merge per storey and material; members stay pickable and are
  evicted when they move, change material, rebuild or hide.
- Offline planner: forecourt sites, lawn finish ground, late-afternoon light.

**SECURITY.**
- New input boundaries:
  - Plan tools: pointer positions become plan points (finite-checked and
    snapped), outlines are capped at 32 points, refused when degenerate,
    self-crossing, smaller than 1.5 m² or overlapping, and every result
    goes through `applyArchOps` (zod, op caps, compile limits, usability
    checks) and `history.commit` (patch validation).
  - Architecture UI state: every `setArch` patch is merged through
    `mergeArchUi` (enums, clamped numbers, capped level list).
  - Walkthrough finish swap reads `arch.variants` from the document
    (zod: ≤ 6 records of JSON); keys must match `^[a-z][a-zA-Z0-9]{0,31}$`
    and go through `setProperty`, which rejects forbidden segments and
    re-validates the entity.
  - Room labels and the plan read polygons from the document: point counts
    capped (128), finite numbers only, at most 24 labels / 4000 plan
    elements. Room names render as React text (escaped); no `innerHTML`.
  - Wall `cut` is a bounded zod number; it is only ever set by the view.
  - No new network, storage, URL, postMessage, worker or subprocess paths.
    No `eval` / `new Function`. CSP unchanged (SVG uses attributes, no
    inline scripts or styles injected).
- `npm audit --omit=dev`: 0 vulnerabilities. No new dependencies (three's
  own GTAO / TRAA nodes). Pascal Editor (MIT) was used as a reference only;
  no code or assets copied; credited in `docs/THIRD_PARTY.md`.

**PERFORMANCE.**
Measured on this laptop in its power-saving profile; Chromium runs on
SwiftShader (relative numbers), Firefox on the integrated Intel GPU.
- Two-bedroom apartment, Firefox WebGL2 (hardware), orbiting camera
  (`e2e:benchmark --prompt=…`): **488 → 202 draw calls** per pass with the
  building merges, renderer CPU **32.5 → 24.0 ms** per frame (a bowling
  alley with 87 draws costs 12.7 ms on the same machine; headless Firefox
  caps frames at 33 ms, so p50 is 33.3 ms for both). On a desktop CPU/GPU
  that is well inside a 60 fps frame; on SwiftShader the apartment walk
  runs at about 2 fps (500 draws before the merges, GPU-bound).
- Daylight switches the building's lamps off (they were a dozen point
  lights in every pixel's shading); night switches them back on.
- Studio render: refines 48 frames (16 on software rasterizers) after the
  view rests, then the editor idles again; adaptive resolution is suspended
  only while it is on. GTAO runs at half resolution.
- GPU resources over 20 view / quality cycles (walls down + x-ray + studio
  on, then off): geometries, textures, cached geometries and materials flat
  in all three runs of `e2e:arch` (Firefox: 249 / 84 / 266 / 75 before and
  after). This check found the TRAA texture leak (+3 per toggle), fixed.
- Allocation probe: `ArchView.update` + `updateBatches` (merges) in steady
  state < 16 B/frame (new test in `alloc-probe.test.ts`).
- Main thread: a whole building compiles, is checked and diffed in
  55–87 ms (`applyArchOps`, apartment / villa / office floor), once per
  agent op batch or plan-tool edit, not per frame. Geometry is generated in
  the compute worker and the `navigable` test runs in the verification
  workers, as before.
- Bundle: EditorRoute +46.8 KB (+14.8 KB gzip: building bar, floor plan,
  walkthrough, plan editing); the three chunk +13.1 KB (+3.8 KB gzip: the
  GTAO and TRAA nodes); `session` +11.3 KB. Each is under the 50 KB
  lazy-loading threshold; ordinary worlds load nothing new at run time
  (the studio pipeline is built only when Studio is switched on).
- Memory: merged buffers duplicate the vertex data of the merged parts
  (bounded by the 1800-entity building limit and split at 400 k vertices
  per buffer) and are disposed on every regroup; `e2e:arch` shows no growth.

**Gates.** tsc 0 errors. Vitest: 150 files, about 2,000 tests; the last
full run had two timing failures while another project's process kept the
load average at 9–11 (`steps 1000 dynamic boxes` 8.8 ms vs 8 ms, the known
load-sensitive test, and the new allocation probe, which now waits for wall
rebuilds before measuring); both files pass on re-run, and the studio suite
(348 tests) passes after the last change. Studio build OK. Smoke 23/23
(five architecture prompts, all `navigable`). On the final build `npm run
e2e` passes in Chromium WebGPU, Chromium WebGL2 and Firefox WebGL2 ("Run
checks" longest task 0 / 0 / n/a ms), `npm run e2e:arch` passes in all
three, and `npm run e2e:projects` passes in Chromium and Firefox.

Before the last fix, three e2e repeats failed in Chromium WebGL2 with a
726–810 ms task during "Run checks". A CPU profile showed the project
thumbnail's pixel readback (`copyTextureToBuffer` → `getBufferSubData`,
~400 ms on SwiftShader) starting the moment the world stopped animating,
which is exactly when the test clicks "Run checks". **Fix:** thumbnails now
wait for a quiet moment (2 s with no input and no animation, at most 15 s;
`quietReached`, unit-tested). Isolated repeats then measured ≤ 115 ms
tasks, and the full suite passed. The architecture gallery
(`npm run gallery -- --arch`) was rendered and inspected in three rounds;
README shows eight of the renders.

## Asset pipeline: library, imports, forge, packages, photo finishes

**Scope.** New `@aether/assets` package (catalog schema, search, credits,
glTF / image / HDR validation, user-asset registry, optional image → mesh
provider), the offline asset build (`scripts/assets/*`), 374 library
entries (351 models, 5 HDR skies, 10 ambientCG photo surfaces, 8 forge
originals), the `asset` shape across core / render / physics / logic /
arch / agent, the studio Library, Imports, Credits and Forge UI, world
packages (`.aether.zip`) and the off-by-default TRELLIS.2 server route.
Self-review against both checklists follows; failed items were fixed
before the gates ran.

### Security checklist

- [x] **Untrusted model input.** `validateGltf` never throws: exact GLB
  header / chunk checks, `inspectUntrusted` JSON guard, zod structure, no
  external URIs (data URIs only), supported extensions only, budgets
  (32 MB, 500 k triangles, 4096 nodes, 64 textures, 64 clips), names
  sanitised, `extras` dropped. Images and HDR are sniffed by magic bytes
  with byte and pixel caps. Covered by `packages/assets/test/import.test.ts`.
- [x] **Packages.** Zip reader enforces entry count and inflated-size caps
  while inflating, checks CRCs, rejects unsafe names, and re-derives
  content ids (mismatch = rejected). Tested in `apps/studio/test/assets.test.ts`.
- [x] **IndexedDB revive.** Stored metadata is re-parsed with zod and
  blobs are re-validated before registration; caps of 200 files / 400 MB;
  session-only fallback when storage is blocked.
- [x] **Fetch script.** Host allowlist (kenney.nl, polyhaven, ambientCG
  download host), licence allowlist (CC0-1.0 / CC-BY-4.0), SHA-256 /
  MD5 verification, `unzip` called with argument arrays (no shell), archive
  listings checked for absolute and `..` paths; downloads cached outside
  the repository. Kenney archives must state CC0 in `License.txt`.
- [x] **Image → mesh route.** Off unless `AETHER_IMAGE_TO_3D_URL` is set;
  endpoint must be loopback http or credential-free https; redirects
  refused; token never logged or returned (scrubbed from errors); one
  conversion at a time, 12 MB image cap; returned GLB passes `validateGltf`.
- [x] **Forge.** Model-written generator code runs only in the existing
  procgen sandbox; critique output parsed with zod and capped; renders use
  a private WebGL2 renderer.
- [x] **DOM.** No `innerHTML` with catalog, import or model data; names
  are rendered as React text. CSP unchanged (blob:/data: already allowed for
  imports); no new runtime origins.
- [x] **Secrets / licences.** No credentials written; only CC0 / MIT
  assets ship; every file has provenance in `assets/manifest.json`;
  Quaternius excluded (redistribution forbidden). `npm audit --omit=dev`:
  0 vulnerabilities; the three new packages are dev-only, exact versions.
- [x] **Fixed during review:** health tests did not expect the new
  `imageTo3d` flag; a scene-sync warning test still expected the old text
  after `material` entries were rejected as shapes.

### Performance checklist

- [x] **Per-frame allocations.** `AssetAnimator.update` iterates an array
  by index with module scratch vectors; allocation probe covers it (an
  earlier `for…of` over a Map allocated, fixed).
- [x] **GPU resources.** 20 place / undo cycles leave geometries, textures
  and materials flat in Chromium WebGPU, Chromium WebGL2 and Firefox
  (`e2e:assets`); models are refcounted per URL, textures through an LRU
  `TextureCache`; LOD levels reuse LOD 0 materials.
- [x] **Loading.** Catalog JSON (224 KB / 38 KB gzip) is its own lazy
  chunk, preloaded 1.5 s after the renderer starts; the animator, HDR
  loader, meshopt decoder, zip and library panels are lazy. Models are
  meshopt-compressed with content-hashed names (immutable caching).
- [x] **Bundle.** Index closure +1.2 KB (+0.5 KB gzip); EditorRoute static
  closure +118 KB (+40 KB gzip, library / imports UI); three chunk +33 KB
  (GLTF / HDR loaders, SkeletonUtils). All under the lazy-loading threshold
  for ordinary worlds.
- [x] **Photo finishes.** 512 px maps, fetched only when a world uses that
  finish; procedural maps stay until they arrive and remain the fallback.
- [x] **Architecture views.** The arch e2e GPU check now waits for settled
  counts (photographed furniture loads asynchronously); counts are flat.
- [x] **Allocation probe flakiness fixed.** The "building views" and
  "scatter-field" probes failed intermittently on a busy machine. Cause:
  V8 optimises on a background thread, so after the warm-up loop baseline
  code (which boxes doubles) could still be running while sampling.
  `probeAllocations` now yields 50 ms after warm-up and warms again before
  measuring; `StaticMerges.update` iterates members by index. The probe
  file then passed 10 consecutive runs, four of them with two extra
  CPU-bound processes running; the building probe also waits for asset
  builds (`whenIdle`) because furniture are now library assets.

**Gates.** tsc 0 errors. Vitest 164 files, 2126 tests: the second full
run had one failure (the outdated warning text above), the third only the
two allocation probes; both fixed as described, and the render suite
(329 tests) plus every probe file then passed three runs in a row. Studio build
OK. Smoke 25/25 (two new library prompts: city street, town plaza).
`npm run e2e` passes in Chromium WebGPU, Chromium WebGL2 and Firefox
WebGL2; `npm run e2e:assets` and `npm run e2e:arch` pass.

## UX completion: moments, proof replay, sharing, onboarding

**What changed**

- `docs/DESIGN.md` writes down the established direction ("a quiet
  instrument for a loud world": neutral chrome, one indigo accent, the
  expressive layer drawn on the world), the directions it was weighed
  against, the tokens, and how it extends to the block-world HUD,
  architecture views, asset browser, publish hub and settings.
- Signature moments:
  - The **proof replay** records the motion in the verification worker
    (`@aether/physics` `TraceRecorder`, `VerifyOptions.trace`,
    `VerifyReport.trace`) and plays it back (`@aether/render` `ProofReplay`,
    `'proof'` ghost material). The camera frames the motion first, the
    originals step aside while their ghosts replay, and trails are left
    behind. The **proof seal** (`ProofSeal.tsx`) lands with it.
  - **Plan marks**: corner brackets (`BlueprintMarks`) around each newly
    built object before it grows in, plus group labels ("Palm ×12").
  - The **prompt flight** and world ripple.
  - **Full-window play** with an iris.
  - Opt-in **interface sounds**.
  - An accent **cursor** in the viewport.
- Home hero: the prompt bar front and centre, one-tap examples and a stage
  of example worlds. Template cards push in on hover.
- The editor **tour** (3 steps, non-modal), the **shortcuts overlay**
  (`?`), and **free text in the command palette** ("Ask the agent: …" /
  "Build a new world: …").
- **Serverless share links**: the world is carried in the URL fragment
  (`#/view/<token>`) and opens a read-only **viewer** with Play, Export and
  Remix. The server upload is used only for worlds too large for a link.
  **Export → 3D model (.glb)** uses three's GLTFExporter as a lazy chunk.
- Fixes found in the screenshot rounds: the quality card squeezed its
  title into a narrow column; "Refine ×1" overflowed the composer bar;
  plan marks were still visible after Play on slow GPUs; on phones, game
  messages covered the play HUD; the seal could overlap the building bar
  and the top-left overlays on narrow viewports. The e2e caught one more:
  the glTF export threw on procedural textures. Three's exporter draws
  normal, roughness and metalness maps into a canvas, and raw pixel data
  cannot be drawn. The export now works on a cloned graph whose 8-bit RGBA
  data textures are converted to canvases (float data is left out), so the
  live scene is never touched. Coin island and the villa now export
  (1.9 MB and 13.6 MB). The layout test turned up three more defects, all
  fixed: the hero's "Open" link overflowed (its icon was rotated); the
  "Materials" tab in Assets overflowed at 1280–1440 px; and on phones the
  Assets footer was pushed below the screen. The last two come from the Assets panel, which this stage did not touch (not checked against an older build). The
  tour's ring now wraps the whole composer, not just its text
  field.

### Security checklist

- [x] **Share tokens (URL fragment)**: the router accepts only
  `#/view/(z1|j1).[A-Za-z0-9_-]+` up to 60,016 characters. The decoder
  rejects bad base64url, caps the inflated size at `MAX_IMPORT_BYTES`
  (decompression bombs are stopped mid-stream, see the test), requires
  strict UTF-8, then runs `parseWorldImport` (prototype-pollution guard +
  `validateWorld`). The viewer never persists anything. Remix stores only
  that validated world. Fragments never reach a server.
- [x] **Worker messages**: `options.trace` must be a boolean. `report.trace`
  is checked by zod: ≤ 64 ids of ≤ 128 characters, `dt` in (0, 1], 2–601
  frames, a `Float32Array` of exactly frames × bodies × 7 finite values
  (tested with truncated, NaN, oversized and plain-array payloads). The
  trace is stripped from the report before it reaches the model (tested),
  so it never inflates prompts.
- [x] **localStorage**: the tour marker is read back as `{ done: true }`
  only (tampered values tested). The new settings `uiSounds` and
  `immersivePlay` go through the boolean allowlist in `loadSettings`.
- [x] **DOM**: prompt text in the flight pill, plan labels, seal text and
  viewer names are set through `textContent` or React text. No
  `innerHTML`, `eval` or `new Function` added (grep).
- [x] **CSP unchanged**: the cursor is a CSS `data:` image (`img-src` allows
  `data:`). There is no new origin and no inline script. GLTFExporter is a
  same-origin lazy chunk.
- [x] **Clipboard**: write only, on a user action, with a toast fallback
  when the browser refuses (Firefox).
- [x] **Export**: refused above 3 M triangles before the exporter loads
  (after integration: the shared publishing pipeline, cap 6 M);
  only the entity graph is exported, as a copy (no ghosts, helpers or sky;
  live materials untouched; copied materials and textures disposed).
- [x] **Dependencies**: no new npm packages. `npm audit --omit=dev`:
  0 vulnerabilities.

### Performance checklist

- [x] **Per-frame allocations**: the replay writes interpolated poses
  straight into the ghost nodes' local matrices with plain arithmetic.
  Clocks live in `Float64Array` slots. An allocation probe (16 ghosts,
  trails and blueprint fade) stays under the 16-byte sampling-noise budget per frame. The probe first
  caught boxed doubles in the clock field, in the getter and in
  `lerpVectors`/`slerpQuaternions` calls; all three were fixed.
- [x] **Workers**: the trace is recorded in the verification worker, only
  in the shard that simulates longest. Its cost: up to 3 s of extra
  simulated time when tests decide early and something can move. Nothing
  extra runs for static worlds.
- [x] **GPU resources**: 20 replay start/stop cycles leave GPU geometries
  (74 → 74), textures (26 → 26 Chromium, 24 → 24 Firefox), cached
  geometries and materials (21 → 21) flat (`e2e:ux`). Trail and blueprint
  geometries are disposed when they end, and the ghost sync is cleared.
- [x] **Bundle**: the eager three chunk is unchanged (1,243.0 KB). It had
  briefly grown by 37 KB because the `three` chunk group captured the
  dynamically imported exporter; the exporter now has its own lazy 36.8 KB
  chunk. The EditorRoute chunk grew from 450.5 to 468.4 KB (+17.9 KB raw)
  and ViewerRoute is a new 3.9 KB lazy chunk. The home path gained the hero
  and overlays (≈ +9 KB raw). The stylesheet gained `moments.css` (11.3 KB,
  3.2 KB gzip) plus about 6.5 KB of hero styles. Hero images are the
  template thumbnails the page already loads; four of the six load lazily.
- [x] **First frame**: the first world of a session shows no plan marks, and
  the blueprint lead (0.3 s) only applies to agent builds. Grow-in timing is
  otherwise unchanged.
- [x] **Memory bounded**: a trace holds at most 64 bodies × 601 frames
  (default 16 × 121, about 54 KB). The worker's recording buffer is
  128 × 121 × 7 floats. The studio keeps one trace, plan marks are capped
  at 8 groups, and blueprint marks at 400 boxes.
- [x] **Firefox / WebGL2** measured throughout: every `e2e:ux` step,
  including the GPU check, passes in Firefox.

**Visual review.** Four rounds of screenshots, each at 1440×900, 1024×768
and 390×844, in Chromium and Firefox, light and dark, every one looked at
before changing anything. They covered the home hero, the shortcuts
overlay, the tour steps, the viewer and its play mode, the seal after
builds, full-window play, the palette with a sentence, Settings, and the
dark home. The rounds found and fixed: the cramped quality card, the
overflowing composer bar, plan marks lingering into play, game messages
over the phone HUD, the seal colliding with the overlays (narrow
viewports, building bar), replays too small to read (the camera now
frames the motion, and the originals step aside for their indigo ghosts),
and the tour ring.

**Gates.**
- tsc: 0 errors.
- Vitest: 168 files, all pass on both full runs: 2,167 tests on the
  first, and 2,169 on the second, after the export and layout fixes
  (which added two tests).
- Studio build: OK.
- Smoke: 25/25.
- `npm run e2e`: Chromium WebGPU, Chromium WebGL2 and Firefox WebGL2 pass,
  including the new GLB export check (2,015 KB and 1,832 KB). The first
  attempt failed on that check, which is what led to the export fix.
- `npm run e2e:ux` (new): passes in Chromium and Firefox.
- `npm run e2e:layout`: passes in both browsers after the fixes above.
- `npm run e2e:projects`: passes in both browsers.
- `npm audit --omit=dev`: 0 vulnerabilities.

Not done: the brief's static mocks of three competing directions. The
direction was already settled and this stage was asked not to replace it,
so the comparison is recorded in `docs/DESIGN.md` as a scored decision, not
as new mock pages. The gallery (`npm run gallery`) was not re-rendered: it
captures worlds only, those renders did not change, and its capture now
hides the proof overlays. The README screenshots were regenerated by
`e2e` and `e2e:ux`.

## Publishing: games, videos, renders, models, floor plans, share links

One Publish hub in the editor (Game, Video, Render, 3D model, Floor plan,
Share link, History) on top of a standalone player build, capture sessions
in the renderer, our own zip / MP4 / WebM / PDF / QR writers, a camera path
editor with a director, the local publish library, deploys through the
user's own CLIs, LAN sharing and version snapshots.

### Security checklist

- [x] **New input boundaries, all validated with caps.** Share fragments
  (≤ 1.5 MB, inflate capped at 8 MB while streaming, strict zod envelope,
  `inspectUntrusted` + `validateWorld`); `game.json` (strict zod, ≤ 16 MB,
  safe save / import paths); bundled imports (re-validated with
  `importUserAsset`, content id must match); build zips on the server
  (`application/zip` ≤ 256 MB, ≤ 2000 entries, per-file and total caps,
  safe names, extension allowlist, `game.json` + world checked, temp dir +
  rename, ≤ 100 builds / 2 GB); deploy requests (zod, slug / `user/game`
  regexes); LAN requests (zod); CLI output (lines cleaned of ANSI and
  control characters, ≤ 400 chars, stdout ≤ 4 MB; captured values matched
  against strict regexes before reuse; only hosting-domain URLs become
  links); publish library records (zod on read: `https://` / local URLs,
  image data-URL thumbnails, caps); camera paths (zod, ≤ 64 keys, ≤ 300 s);
  model-written shot plans (zod; the resolver alone turns them into
  coordinates); player settings (zod with defaults); player address
  (https or localhost only, no credentials, safe path).
- [x] **No eval / new Function** anywhere new; generator and script code in
  shared worlds runs only in the existing sandboxes (the sandbox worker
  keeps its own CSP under `/play` and `/published/…`).
- [x] **No innerHTML.** Titles, descriptions, links, log lines and credits
  are React text; the QR code is a path of numbers; SVG and `index.html`
  text is escaped (`escapeXml`); PDF strings are escaped and WinAnsi-only;
  canvas title cards use `fillText`.
- [x] **CSP.** Studio policy gains only `media-src 'self' blob:` (exported
  videos and music previews). `/play`, `/play.html` and published builds
  get `PLAY_CSP`: same-origin script + wasm only, `connect-src 'self' blob:
  data:` (no model hosts, no loopback bridge), `frame-ancestors *` for
  embedding, no `X-Frame-Options`; the Node server and `vercel.json` agree
  (tests). Builds carry the policy as a meta tag (no `frame-ancestors`
  there, browsers ignore it in meta).
- [x] **Secrets.** Nothing new holds a secret. Deploys use the bridge's
  `restrictedEnv` (no `*KEY*`, `*TOKEN*`, `*AUTH*`… variables reach the
  CLIs — a test plants three and checks the CLI's environment). The bridge
  publish endpoints require the pairing token; the local routes sit behind
  the loopback + session guard.
- [x] **Subprocesses.** Argument arrays only (`runProcess` / `spawnCli`, the
  Windows `.cmd` plan), no stdin, per-step timeouts, each step in its own
  process group (cancel and timeout end the CLI's children too — found and
  fixed during review: a `sleep` child kept a cancelled step alive for 30 s),
  throwaway build copies deleted afterwards. GitHub Pages uses `gh api
  --input <file>` (no git, no shell). Tested with fake CLIs on PATH only.
- [x] **Path traversal.** Store paths are regex-checked and resolved inside
  the build directory (`..`, `%2e%2e`, absolute, backslash and the metadata
  file all 404 in tests); LAN paths need the token segment and the exact
  build id; the zip writer and reader refuse unsafe names; the player
  manifest is re-checked with `safeEntryName` before packaging.
- [x] **Prototype pollution.** Every JSON boundary goes through
  `inspectUntrusted` or zod (unknown keys stripped); the e2e opens a
  `__proto__` share link and checks `Object.prototype` stays clean.
- [x] **Abuse and quotas.** `/api/*` rate limits apply to the publish routes;
  one deploy at a time; LAN share rate-limited per client and stops after
  two hours; library caps; video ≤ 120 s, ≤ 1920 px, muxed file ≤ 512 MB;
  stills ≤ 8192 px (UI offers ≤ 4096).
- [x] **Dependency audit.** No new dependency. `npm audit --omit=dev`:
  0 vulnerabilities.

### Performance checklist

- [x] **Per-frame allocations.** `CompiledPath.sample` is allocation-free
  (probe: 0 B/iteration); the viewport preview reuses one pose object; a
  capture session returns one reused RGBA buffer per frame and the video
  loop reuses its `ImageData`, canvas, pose and frame options — what remains
  per frame is inherent (the `VideoFrame` handed to the encoder and the
  encoded chunk). The title-card scrim gradient is cached per canvas.
- [x] **Workers / main thread.** Encoding runs in the browser's WebCodecs
  encoders (off the main thread) with back-pressure on the encode queue;
  readback is asynchronous (WebGPU buffer mapping, WebGL2 PBO + fence);
  accumulation frames yield to the browser every four draws; zip
  compression uses `CompressionStream`. Deploys run in CLI processes.
- [x] **GPU resources.** Capture sessions resize the drawing buffer once
  and reuse the renderer's two-entry capture-target LRU; export copies of
  materials and canvas textures are disposed; the path overlay reuses its
  buffers. e2e: geometries / textures stay at 74 / 26 over 4 still + glTF
  cycles in Chromium (WebGPU) and Firefox (WebGL2).
- [x] **Bundle.** The player is its own entry (`play.html`): 14 static
  chunks, 2.43 MB / 728 KB gzip — three.js is 1.28 MB of it — and a build
  guard fails if editor chunks become reachable. The home page closure is
  unchanged (499.6 KB vs 498.8 KB; the Published page is lazy). The editor
  gains the eager publish controller (≈ 29 KB minified) plus camera paths,
  the library and the renderer's capture / export modules (≈ 27 KB); the
  hub (30 KB), timeline (4.5 KB), director (9.8 KB), QR encoder (6.6 KB),
  share codec, muxers, video export, floor-plan / PDF writers, game builder,
  `GLTFExporter` and the hosting client all load on first use.
- [x] **First frame.** Unchanged for the studio (nothing new runs before the
  first frame; the publish library opens asynchronously). The player shows
  its title screen over the live world as soon as the renderer is ready.
- [x] **Memory bounded.** Publish history: ≤ 300 items, files ≤ 120 MB each
  / 400 MB total (oldest dropped); snapshots ≤ 30 per project; video chunks
  ≤ 512 MB; stills tile above 2048 px so a 4K render never needs a 4K
  drawing buffer; object URLs are revoked on the next job and on dispose.
- [x] **Firefox / WebGL2 measured.** The same e2e runs in Firefox: still
  1920×1080, MP4 video (1.5 s, plays 1.51 s), verified GLB, share link,
  extracted game build, floor plan — all pass.

### Bugs found and fixed during the stage

- WebGPU readback rows are padded to 256 bytes; captures assumed tight rows,
  which skews any width that is not a multiple of 64 (e.g. 480 px project
  thumbnails on WebGPU). `normalizePixels` now derives the stride; the
  screenshot path uses it (regression test).
- `GLTFExporter` redraws normal maps through a 2D canvas, which rejected the
  renderer's procedural data textures and failed the whole export; data
  textures are now copied to canvases and undrawable textures are left out
  (regression test).
- The offline director split "1.5 seconds" at the decimal point (regression
  test).
- Exported videos did not play in the studio: the CSP had no `media-src`
  for `blob:` URLs (the MP4 itself probed fine with ffprobe: H.264 High
  1280×720 24 fps + Opus 48 kHz, 1.02 s).
- `auto` picks MP4 only where the browser can also play H.264 back
  (`canPlayType`), else WebM — a browser may ship an H.264 encoder without
  a decoder (unit-tested with a fake encoder).

### Gates

- `tsc -b`: 0 errors. `vitest run`: 175 files / 2208 tests pass (plus the
  player-manifest build-plugin test). `npm audit --omit=dev`: 0
  vulnerabilities. No new dependencies.
- `build`, `smoke` (25/25), `e2e`, `e2e:publish` (Chromium and Firefox),
  `e2e:hosted` and `e2e:projects` pass.
- `e2e:layout` reports 16 violations, all in the Assets panel, which this
  stage does not touch: the "Materials" segment overflows by 6 px in
  Firefox at ≥ 1280 px, and the Assets sheet footer is clipped at 390×844
  in both browsers. The publish styles are scoped (`.pub*`) and load only
  with the hub, so these are carried over, not introduced; they are left for
  the Assets panel's owner.

## Stage: flagship default projects

Twelve flagship worlds (Lantern Isles, Chain Reaction, Kart Canyon,
Blockfall, Neon Rain City, Kyoto Temple Lanterns, Painterly Meadow,
Four-Seasons Garden, Orbital Lab, Sakura River Journey, Skyline Penthouse,
Dusk House by the Lake) as offline-planner plans, every gallery world kept as
a bundled default project (23 entries), one curation manifest, lazy saved
worlds, title cards, and four engine fixes found while art-directing them
(vertex-coloured generators double-tinted by their preset colour, ghost
bumps on flat heightfields, a too-long template slug accepted, title-card
hold for block worlds).

### Security checklist

- [x] **New input boundary: template files.** `loadTemplateWorld` /
  `loadTemplateThumbnail` treat the site's own static files as untrusted:
  slug pattern with a 64-character cap (regression test: a 300-character
  slug was accepted before), 20 s deadline covering request and body,
  declared and streamed size caps (the stream is cancelled at the cap), the
  world goes through `parseWorldImport` (prototype-pollution guard + schema
  validation), thumbnails must carry the WebP magic and fit the thumbnail
  budget (SVG refused). Never throws; failures fall back to the planner.
- [x] **Title card.** `WorldIntro` is zod-validated (lengths, ≤ 6 controls,
  `#rrggbb` accent) and rendered as React text only; the accent reaches CSS
  only through a validated custom property.
- [x] **No eval / innerHTML** added; no new dependencies (`npm audit
  --omit=dev`: 0 vulnerabilities); no secrets; no network beyond same-origin
  static files; CSP unchanged.
- [x] **Scripts.** `showcase.e2e.ts` runs `cwebp` with argument arrays and a
  timeout; bake writes only under `apps/studio/public/templates/worlds/`.

### Performance checklist

- [x] **Per-frame allocations.** Petal/leaf tumbling writes instance
  rotations with arithmetic only (`writeTumble`); the held play session
  returns before stepping (no work, no allocation).
- [x] **GPU resources.** Weather layers dispose geometry and material on
  switch (unit test); flagship windows (thousands) and groves are instanced
  scatter layers, not entities; point lights kept to about a dozen per world.
- [x] **Bundle.** First paint gains the manifest (~6 KB in `index`); the
  flagship plans (99 KB min / 32 KB gzip) live in the lazily loaded agent
  session chunk; saved worlds (2.2 MB total, 5–230 KB each) are fetched only
  when a template is opened; thumbnails ≤ 30 KB each (eager only for the
  featured row).
- [x] **Repository growth.** About 3.6 MB (worlds 2.2 MB, thumbnails 0.6 MB,
  covers 0.76 MB) — well under the 25 MB budget. No preview videos.
- [x] **Physics.** `FIX_INTERNAL_EDGES` on heightfields removes metre-high
  hops of fast bodies on flat terrain (regression test fails without it).
- [x] **Firefox / WebGL2.** `e2e:showcase` opens and plays every featured
  world in Firefox as well as Chromium.

## Integration: studio UX, publishing and flagship default projects

Three pieces of work developed side by side were merged one at a time
(studio UX → publishing → flagship default projects), each followed by a
type check and the affected package tests, then the full gate on the result.

**Conflicts resolved**

- **glTF export.** Both the UX work (a quick "Export 3D model" action) and
  publishing (the Publish hub's 3D model target) added
  `packages/render/src/view/gltf-export.ts`. They are now one pipeline: the
  publishing flatten (`buildExportScene`: what the camera draws, batches and
  merged buildings as drawn, PBR material copies, verified with
  `verifyGltf`) with the UX module's texture classification
  (`textureExportMode` / `rgbaPixels`: keep drawable images, convert RGBA8
  data to a canvas copy, drop float / compressed / render-target textures).
  `WorldRenderer.exportGlb()` and the module-level `exportGlb(root)` go
  through it; a scene whose every mesh is over the cap is refused with
  "over the export limit" before the exporter loads. The cap is the
  publishing one (6 M triangles).
- **Top bar and sharing.** Publishing replaced Export with a primary Publish
  button and pointed Share at the hub; the UX work had Share copy a
  read-only viewer link and added an Export menu. Result: Share opens the
  hub's Share tab, which now offers both the player link (QR, embed) and a
  "Copy remix link" (the read-only viewer with Remix); the command palette
  has both; JSON / zip / GLB exports live in the app menu. The e2e suites
  were updated to these entry points.
- **Renderer scene graph and captures.** The proof replay, plan marks and
  camera-path overlay groups are all added to the scene and all hidden from
  screenshots and critique views.
- **Docs.** README tables, ARCHITECTURE (§20 Publishing, §21 Default
  projects), CONTRACTS and this log keep every stage's section.

**Integration fixes**

- Publishing's title screen and video titles default to a world's title
  card (`intro`: title, tagline + objective, control lines; capped to the
  title-screen limits) — flagships publish with their own card.
- The studio test fake gained the proof and camera-path hooks both merged
  stages call (`stopProof`, `showCameraPath`).
- **Main-thread stall during verification (e2e failure).** With the UX
  stage's longer verification (extra seconds while something moves), the
  agent's quality critique no longer waited for grow-in and drew its four
  views synchronously inside the worker message that delivered the
  verification result (0.6–3 s on a software GPU), and the chat auto-scroll
  ran inside every streamed message. Captures (`Simulation.renderViews`,
  `screenshot`) now start from an animation frame (`lib/frame.ts`
  `nextFrame`, 1 s timer fallback for hidden tabs) and the chat scroll is
  coalesced to one per frame (`onNextFrame`). Measured with
  long-animation-frame attribution: the worst non-render script during
  verification went from 3034 ms to 6–39 ms in Chromium.
- The asset-animator allocation probe failed intermittently under the full
  suite: its 3000-run warm-up left `update()` in baseline code (boxed
  doubles). Warm-up raised to 12 000; three consecutive render-suite runs
  under load pass. (Moving the speed into a typed slot was tried and made it
  worse, so the source is unchanged.)

### Security checklist

- [x] No new input boundary: the remix link reuses the validated
  `shareLink` decoder; title-screen defaults read an already validated
  `WorldIntro` and are capped again; export accepts only in-memory scene
  data. No eval / innerHTML; CSP unchanged. `npm audit --omit=dev`:
  0 vulnerabilities; no new dependencies.

### Performance checklist

- [x] **Per-frame allocations.** Nothing added to frame loops; the frame
  helpers allocate one closure per capture or per chat update, not per frame.
- [x] **GPU resources.** The unified export disposes its material and canvas
  texture copies and releases canvas backing stores (unit tests).
- [x] **Bundle.** Merged vs. the pre-merge base: first-page preload
  617 → 650 KB (177 → 185 KB gzip) — hero, shortcuts, template manifest and
  publish entry points; the GLTF exporter stays a lazy 36 KB chunk; the
  Publish hub (30 KB), Published page, viewer and player are lazy chunks.
- [x] **Firefox / WebGL2.** `e2e` (Chromium WebGPU, Chromium WebGL2,
  Firefox WebGL2), `e2e:ux`, `e2e:publish`, `e2e:showcase` and `e2e:layout`
  all pass in Chromium and Firefox.

**Gates.** tsc 0 errors; Vitest 185 files / 2318 tests pass; studio build
OK; smoke 37/37; `showcase:bake -- --check` up to date; `e2e`, `e2e:ux`,
`e2e:publish`, `e2e:showcase` and `e2e:layout` pass. README screenshots
were regenerated by `e2e` / `e2e:ux` (they now show the brighter generator
colours).

## Hardening: independent security and performance review

An adversarial pass over the recent features by someone who did not write
them: the bridge, the local server and its build library, the generator
sandbox, user imports, reference images, publishing, WebLLM, the voxel
engine and the GPU paths. Every finding below was reproduced first (an
exploit attempt as a test that failed against the old code) and then fixed;
the tests now fail only if the hole comes back. Threat model, trust
boundaries and the reporting process are in [SECURITY.md](SECURITY.md).

### Findings and fixes

1. **Generator sandbox escape to IndexedDB and the network (high).** The
   worker lockdown shadowed dangerous names on the worker scope only.
   Browsers keep `fetch`, the `indexedDB` / `caches` getters and
   `postMessage` on the scope's *prototypes*, and interface objects
   (`WorkerGlobalScope`, `IDBFactory`, `EventTarget` …) stayed reachable. A
   generator that assembles `'proto' + 'type'` at runtime (the token screen
   is advisory) could do
   `Object.getOwnPropertyDescriptor(WorkerGlobalScope.prototype, 'indexedDB').get.call(undefined)`;
   WebIDL treats the undefined receiver as the global, so it got the
   studio origin's `IDBFactory` (every project) and a working `fetch`.
   Reproduced in real Chromium against the old build (`LEAK:object` for
   IndexedDB, fetch and caches). Generators come from the model (prompt
   injection) and from share links, and `/play` may be embedded by any site,
   so a crafted link could read or wipe a visitor's projects. **Fix:**
   `stripHostGlobals` removes everything that is not an ECMAScript intrinsic
   (`ALLOWED_GLOBALS`) from the scope *and its whole prototype chain*.
   Tests: the child-process probe now mimics a browser worker (capabilities
   on the prototype, an interface object) and `npm run e2e:security` runs
   six escape attempts plus a survey of 24 web names in the real bundled
   worker in Chromium and Firefox — all blocked, a normal generator still
   builds.
2. **Foreign code on the studio's origin via the build library (high).**
   `/published/<id>/` serves uploaded builds from the local app's own
   origin with `script-src 'self'`; any `.js` in an uploaded zip (or a
   hand-made `sw.js`, which the player itself registers) ran with the
   session cookie, the loopback check passing, the user's projects and a
   remembered key in reach — e.g. from a paired hosted page through the
   bridge's `/v1/publish/builds`. **Fix:** every `.js` / `.mjs` must be
   byte-identical (SHA-256) to a player file of this computer's studio
   build (`play-manifest.json`), and `sw.js` must be exactly the generated
   offline worker (`isGeneratedServiceWorker`, regenerate-and-compare; the
   generator moved to `@aether/assets/offline-sw` so producer and checker
   share it). Tests: extra script, tampered player chunk, hand-made and
   appended service workers are refused; a real `buildGame` zip round-trips
   into the store; without a player build no scripts are accepted.
3. **Pixel / allocation bombs in model imports (medium).** Embedded
   textures were never inspected (a 33-byte PNG header can declare
   65535 × 65535 px, ~17 GB decoded), and an accessor without a buffer view
   (zero-filled by the loader) could declare 100 M × VEC4 floats. **Fix:**
   embedded image headers (buffer view or data URI) must be PNG / JPEG /
   WebP, ≤ 8192 px per side, ≤ 80 MP per model; decoded accessor bytes
   ≤ 256 MB. Tests for each, including an SVG posing as a texture.
4. **Reference-image decode bomb (medium).** Attached prompt images were
   handed to `createImageBitmap` before any size check. **Fix:** the header
   is read first (≤ 12 000 px per side, ≤ 50 MP), then decoded.
5. **Replacement-pattern markup injection in published pages (low).**
   `publishedIndexHtml` spliced the escaped title / description with
   replacement *strings*; `'` escapes to `&#39;`, so a title like `Game $'`
   became `$&#39;` → `$&`, pasting page markup into attributes. **Fix:**
   function replacers. Test with `$'`, `` $` ``, `$&`, `$1`, `$$`.
6. **Voxel meshes installed outside the view (low, performance).** Found
   by the 5-minute Firefox soak (drawn chunk meshes 290 > the 17 × 17 ring).
   A chunk whose mesh job was still running when the player turned away was
   skipped by the out-of-view sweep (nothing shown yet) and its mesh was then
   installed anyway, drawn and kept until the next sweep. **Fix:** a mesh
   that completes for a chunk outside the view is dropped (re-requested if
   the chunk comes back). Regression test holds mesh results back, turns
   around, releases them and checks only the 5 × 5 view is meshed.
7. **Windows device names in archives (low).** `aux.json`, `con`, `nul.txt`,
   `com1.glb` and names ending in a dot or space are now refused by
   `safeEntryName` (zip reader, build library, exports).

Reviewed and found sound (no change): bridge pairing (8-char codes, 5
guesses per code, 20 attempts / min, constant-time token compare, Host and
Origin allowlists, preflight only for allowed origins), CLI lockdown
(argument arrays, tools / MCP / settings disabled, allowlisted env, temp
dirs removed, session caps), local server guards (Host 421, Origin 403,
SameSite=Strict session secret, loopback socket check, LAN access token),
voxel save decoding (size, chunk, coordinate and palette caps; edit volume
caps in the schema), QuickJS limits, WebLLM (model ids from a fixed enum,
lazy import), share-link decoding, zip reader (caps enforced while
inflating, CRC), no `innerHTML` / `eval` outside the generator sandbox, no
window `message` listeners. Accepted and documented: the optional
`AETHER_VALIDATE_GENERATORS` dry run uses `node:vm` (off by default, not a
boundary); `/v1/ping` reveals that a bridge is running to allowed origins.

### Performance review (measured)

Heavy session, production build, offline planner, headless browsers with
software GPUs (SwiftShader WebGPU in Chromium, llvmpipe WebGL2 in Firefox)
on a laptop shared with other jobs (load average 8–11): absolute frame
times are not representative of real GPUs; growth and bounds are.

| Scenario | Chromium (WebGPU) | Firefox (WebGL2) |
| --- | --- | --- |
| 20 agent runs + 20 play/stop (`e2e:memory`) | passes: heap 80 → 104 MB after the cycles, tab 300 → 296 MB on the reloaded starter world, geometries 49 → 49, textures 30 → 30 | fails its instantaneous 800 MB tab budget (840 MB at cycle 10) — see below |
| 5-minute voxel walk (`e2e:soak`, flying, view 8) | heap 45–52 MB, tab 181–188 MB, chunks loaded ≤ 400 / drawn ≤ 289, geometries 657–695, textures 27 (flat); 1 long task (69 ms) | after the streamer fix: tab 327–487 MB (sawtooth, no trend), chunks loaded ≤ 400 / drawn ≤ 289 (was 290 before the fix), geometries 656–695, textures 27; p95 frame 33 ms, 5 frames > 50 ms (59 before) |
| Studio (photoreal) render of a villa, 15 s + 2 extra on/off cycles | textures 99 → 110 → 99, heap 69 → 72 MB, tab 270 → 238 MB | textures 99 → 110 → 99, tab 426 → 415 → 416 MB; p95 frame 33 ms |
| 1 M-instance scatter, 12 s orbit | 1 000 000 field instances, heap 169 → 170 MB, tab 422 → 365 MB, geometries 66 → 72 | 1 060 000 field instances, tab 594 → 534 MB, geometries 43 → 74 (virtual-geometry clusters swapping in); p95 frame 17 ms |

**Firefox tab memory during agent runs is a sawtooth, not a leak.** A
diagnostic run (agent turns, then the same worlds re-loaded with
`replaceWorld` and no agent at all, then idle) gave
227 → 345 → 527 → 611 → **377** → 441 → … → 801 → **442** → … → 586 MB, and
after 40 s idle 555 → **401** MB. Each world build leaves large typed
arrays (geometry, physics, verification) that Firefox collects lazily; the
floor stays near 380–440 MB across 16 rebuilds and returns there when idle.
The `e2e:memory` cycle check samples one instant against 800 MB, so it trips
on a peak. This was open before this stage (see the editor and performance
stages); the budget was not relaxed. Lowering the transient garbage of a
world build (reusing geometry buffers across rebuilds, freeing CPU copies of
uploaded static geometry) is the follow-up.

**Long tasks.** The voxel walk has none worth noting (Chromium: one of
69 ms in 5 minutes). Turning the studio render on and building the million
scatter still block the main thread for 1.8–2 s on a software GPU: the first
frame compiles the pipeline's materials on the main thread (known from the
performance stage).

### Security checklist

- [x] **New input boundaries validated.** Library uploads (script hashes,
  generated service worker), model imports (texture headers, decoded
  vertex bytes), reference images (header before decode), archive names
  (Windows devices). All with caps and exploit tests.
- [x] **No eval / new Function outside the sandboxes**; the generator
  sandbox is now tighter. No `innerHTML`; published page text spliced with
  function replacers.
- [x] **CSP unchanged** (no `'unsafe-inline'` script, the only wildcard is
  the documented loopback bridge).
- [x] **No secrets** in bundle or logs; no new subprocesses.
- [x] **Path traversal**: unchanged guards plus Windows device names.
- [x] **Dependency audit**: `npm audit --omit=dev` → 0 vulnerabilities; no
  new dependencies.

### Performance checklist

- [x] **Per-frame allocations.** No change touches a frame loop: the
  lockdown runs once per worker start, the checks run once per upload or
  import, the streamer fix runs once per finished mesh job.
- [x] **GPU resources.** Studio render on/off and the voxel walk keep
  texture and geometry counts flat (table); the streamer no longer keeps
  out-of-view meshes.
- [x] **Bundle.** Editor chunk 388.98 KB before and after (the image header
  check reuses `validateImage`, already in that chunk); sandbox worker
  +1 KB; player unchanged except the shared `serviceWorkerSource`.
- [x] **Memory bounded.** Voxel chunks within the view ring; heap flat over
  5 minutes of streaming in Chromium; Firefox sawtooth documented above.
- [x] **Firefox / WebGL2 measured** (table, `e2e`, `e2e:security`,
  `e2e:soak`).

**Gates.** tsc 0 errors; Vitest 186 files / 2327 tests pass (one full run
before the streamer fix was cut short by a full disk on the machine; the
complete run after it passed); studio build OK; smoke 37/37; `npm run e2e`
passes in Chromium WebGPU, Chromium WebGL2 and Firefox WebGL2;
`npm run e2e:security` and `npm run e2e:soak` pass in Chromium and Firefox;
`e2e:memory` passes in Chromium (Firefox: see above).

## Stage: deployment

Product shape: the public address is the static copy (`vercel.json`, no
server, nothing paid by the owner); the local app is `npx aether start`; the
container (`Dockerfile`, `docker-compose.yml`, `fly.toml`, `render.yaml`) is
an optional self-hosting extra that can never run anyone's Codex / Claude
Code login (`AETHER_HOSTED=1`, `AETHER_LOCAL_AI=off`).

### Bugs found and fixed during the stage

- **The container could not build.** `apps/server/Dockerfile` copied only
  `packages/` and `apps/`, but the studio build imports `scripts/vite/*` and
  `assets/catalog.json` and copies `assets/lib`. Replaced by a root
  `Dockerfile` (build → production deps → runtime) and `.dockerignore`;
  `deploy.test.ts` pins its invariants.
- **The runtime image shipped every dev dependency** (Playwright, Vitest,
  TypeScript, Vite) and the 432 MB Codex binaries. The runtime now holds
  `npm ci --omit=dev` (71 MB of `node_modules`) without the Codex binaries.
- **The server sent the studio uncompressed** (three.js 1.24 MB on the wire).
  Brotli / gzip siblings are written at build time (`precompress.ts`) and
  sent with `Vary: Accept-Encoding`: three.js 269 KB Brotli, the entry chunk
  106 → 29 KB, the whole build 49 → 25 MB. Byte ranges always get the
  identity file (a precompressed range would be corrupt).
- **Cache headers on non-hashed files were never applied.** `serveStatic`
  calls `onFound` after building its response, so `Cache-Control: no-cache`
  set there was dropped (only the separate `/assets/*` middleware worked).
  Cache policy is now applied to the returned response; regression tests
  cover `/`, `/fonts/*`, `/assets/*` and root files.
- **Unknown paths answered 200 with the app** (soft 404s on both hosts). The
  studio routes only with the URL hash, so the server and `vercel.json` now
  answer a designed, script-free 404 page with status 404; `/api/*` keeps
  JSON. Server errors show a 500 page to browsers (never the error text).
- **Keep-alive raced proxy idle timeouts.** Node's 5 s keep-alive is shorter
  than Fly / Render proxies' ~60 s idle timeout (sporadic 502s). Now 65 s
  keep-alive, 66 s headers, 120 s per request (`server-timeouts.ts`).
- **Crashes skipped the graceful drain.** Uncaught exceptions / unhandled
  rejections are now logged scrubbed and drain like SIGTERM with exit code 1.
- **No link preview.** `index.html` had no Open Graph / Twitter tags, no
  touch icon or manifest. Added a 1200×630 share card rendered from the
  project's own showcase renders (`scripts/brand/render.ts`), icons, a web
  app manifest and `robots.txt`; a Vite plugin makes the preview URLs absolute
  from `VITE_AETHER_SITE_URL` / `VERCEL_PROJECT_PRODUCTION_URL` (strict https
  origin validation).
- `apps/server/README.md` still said `AETHER_PROVIDER` defaults to
  `anthropic`; it defaults to `mock`.
- Platform health checks (every 15–30 s) flooded info-level logs; a 2xx
  `/api/health` is now logged at debug (test).

### Container verification

`docker build -t aether:deploy-check .` (one build): image 177 MB
compressed / 623 MB on disk, `node_modules` 73 MB, no Codex binaries, runs
as uid 1000 (`node`). Healthy ~3 s after start, 86–128 MB memory, Docker
health status `healthy`. `curl /api/health` → mock mode; `/` → 200 Brotli,
`no-cache`; unknown page → 404. `BASE_URL=http://127.0.0.1:18788 npm run e2e`
against the container passed in Chromium WebGPU, Chromium WebGL2 and
Firefox WebGL2 (241 × 200, one expected 404, no 5xx; 10.9 MB sent for the
whole suite). `docker stop` drained and exited in 0.35 s. Container and
image removed afterwards. `docker compose config` validates; `docker build
--check` reports no warnings.

### Security checklist

- [x] **New input boundaries.** `BASE_URL` / `AETHER_E2E_URL` (test-only):
  parsed with `URL`, http(s) only, no credentials / query / fragment
  (`externalBaseUrl`, tests). Build env `VITE_AETHER_SITE_URL` /
  `VERCEL_PROJECT_PRODUCTION_URL`: strict https-origin regex, otherwise
  ignored, so no markup can be injected into `index.html` (tests with
  injection attempts). `precompressDir` never follows symlinks and stops at a
  file cap (tests). Siblings are never served under their own names.
- [x] **No eval / innerHTML.** Error pages are constant strings with no
  script or external resource; they never echo request data or errors.
- [x] **CSP unchanged** and still identical between the server and
  `vercel.json` (`csp.test.ts`); the 404 page, card and icons are same-origin.
- [x] **No secrets.** No key in any manifest (test); the image needs none;
  CI sets `AETHER_PROVIDER=mock`. Built bundle grepped for key patterns:
  none. Build context checked by exporting it: 48 MB, no `.env`, `.git`,
  `node_modules`, `dist`, tests or private notes.
- [x] **Container.** Non-root `node` user, production dependencies only,
  exec-form CMD, `HEALTHCHECK`; compose adds read-only root FS,
  `no-new-privileges`, `cap_drop: ALL`, memory / CPU / PID limits and a
  loopback-only port. Fly / Render trust exactly one proxy hop.
- [x] **Dependencies.** No new npm dependency. `npm audit --omit=dev`:
  0 vulnerabilities (also a CI step).

### Performance checklist

- [x] **Per-frame allocations / GPU resources.** No client render code
  changed.
- [x] **Bundle.** First-frame bytes unchanged except `index.html`
  (950 → 983 B gzip, preview tags). The card (96 KB) and icons are fetched
  only by link-preview crawlers and installs. On the self-hosted server the
  first-load transfer drops by about 75 % (Brotli instead of identity).
- [x] **Server memory.** Production-deps runtime, same env and CMD as the
  image: 170 MB RSS after boot, 130 MB peak HWM over a full `npm run e2e`
  run with no 5xx (heap capped at 384 MB in the image). Precompression of
  the full build: 18 s (Brotli 11 for text, 5 for binaries, two lanes).
- [x] **Firefox / WebGL2.** `BASE_URL=… npm run e2e` against the
  production-deps server passed in Chromium WebGPU (first frame 4.1 s),
  Chromium WebGL2 (3.0 s) and Firefox WebGL2 (3.7 s) on a software GPU, with
  precompressed assets served; `e2e:hosted` (the Vercel setup) passed in
  Chromium and Firefox, including the new 404 / card / icon checks.

**Gates.** tsc 0 errors; Vitest 187 files / 2353 tests pass; studio build
OK; smoke 37/37; `npm run e2e` passes against the container and against the
production-dependencies server (Chromium WebGPU, Chromium WebGL2, Firefox
WebGL2); `e2e:hosted` (Vercel setup) and `e2e:cli` (one-command local app)
pass in Chromium and Firefox; `npm audit --omit=dev` 0 vulnerabilities.

## Integration: hardening + deployment

Both stages were squash-merged onto `main` one at a time. The only textual
conflict was this log (both appended a section; both kept, in order).
`apps/server/src/app.ts` and `main.ts` merged cleanly: the build library's
trusted-player directory (hardening) and the HTML 404/500 pages, HTTP
timeouts and crash drain (deployment) are independent and both active.

**Integration bug fixed.** Running both stages' server tests together put
enough load on the machine to expose a race in `DeployJobs`: a job reported
`done` before its `finally` removed the temporary folder, and the deploy
slot was released only after that cleanup, so a client starting the next
deploy as soon as it saw the end was refused with 409 (the existing
"deploys to Netlify, Vercel, GitHub Pages and itch.io" test failed about one
run in four). The slot is now held only while a job is in the `running`
state, a finished job's cleanup can no longer clear a newer job's slot, and
the slot is checked again after `start()`'s awaits so two concurrent
requests cannot both run. Two regression tests (start from the final event;
two concurrent starts) fail on the old code and pass now; the publish test
file passed 3/3 repeated runs.

**CI.** `.github/workflows/ci.yml` now also runs `npm run e2e:security` (the
sandbox-escape suite) in Chromium and Firefox; `docs/DEPLOYMENT.md` says so.

SECURITY
- [x] No new input boundary. The deploy-slot change narrows behaviour (still
  one deploy at a time, now race-free); subprocess handling unchanged.
- [x] Player-script trust (`playerDir` = the served `staticDir`) works with
  precompression: `.br` / `.gz` siblings are added next to the originals,
  which stay, and only manifest-listed scripts are hashed.
- [x] `npm audit --omit=dev`: 0 vulnerabilities.

PERFORMANCE
- [x] No hot-path or bundle change from the integration (fix is server-side).
- [x] `e2e:soak -- --walk-s=60` on the merged build: GPU texture counts back
  to baseline after the studio render in Chromium (99 → 99) and Firefox
  (99 at end); chunk counts bounded by the view ring in both browsers.

**Gates (merged result).** tsc 0 errors; Vitest 188 files / 2364 tests pass; studio
build OK; smoke 28/28 (the hidden gallery worlds are no longer counted);
`npm run e2e` passes in Chromium WebGPU, Chromium WebGL2 and Firefox WebGL2;
`e2e:security` and `e2e:hosted` pass in Chromium and Firefox; `e2e:soak`
(60 s walk) passes in both. Screenshots regenerated by `e2e` were restored.

## Stage: public benchmark and eval harness

A reproducible, offline benchmark (`npm run bench`, `npm run bench:quick`,
`docs/BENCHMARK.md`, committed results in `docs/benchmark/results.json`) over
81 prompts and about 130 small edits: bot winnability of generated games,
self-repair on deliberately broken worlds, edit versus regenerate (tokens,
patch size, unrequested changes, regressions), proof speed and fork cost, and
offline planner coverage. It also found real planner defects (pickups inside
buildings or over the void, "remove all the cars" removing the player's car,
scaling that shifts neighbours), listed in the document. Code is
`scripts/bench/`; the only change to shared code is an optional initial-world
argument on the script-side `NodeAgentHost`, a vitest include for
`scripts/bench`, two npm scripts and a CI step.

SECURITY
- [x] No new input boundary in the product. The CLI clamps its numeric options;
  a model is only called with `--provider=... --allow-model`, through the
  existing locked-down headless backends, with a hard cap of 30 calls
  (`--max-calls`, enforced by the recording wrapper before each call). Never
  part of `bench`, `bench:quick` or CI (CI sets `AETHER_PROVIDER=mock`).
- [x] The committed model-run file is read back with a shape check and ignored
  when malformed. Generated prompts, bots and faults run only in the existing
  sandboxes (Rapier, QuickJS, the node generator sandbox); the bot plays at
  most 150 simulated seconds per world.
- [x] No dependency added; no network access.

PERFORMANCE
- [x] Full run about 30 s of compute (about a minute wall with a model idle);
  quick run under 10 s and also a Vitest test. Nothing in the product's hot
  paths changed.
- [x] Rates and token counts are deterministic; timing columns are
  machine-dependent and documented as such.

**Gates.** tsc 0 errors; `scripts/bench` 4 files / 47 tests; studio build OK;
smoke 28/28. The full Vitest run passes on Node 24; on Node 22.19 three
unrelated suites (render allocation probe, procgen sandbox lockdown, server
generator cache) fail identically without this stage and pass on Node 24.

## Stage: independent replay verifier and signed proofs

Scope: `packages/verifier` (`@aether/verifier`, `aether-verify`), proofs in
game builds and share links, the player's "Check it yourself" badge,
`docs/PROOFS.md`. The headless logic host and pose pool moved from the studio
into the verifier package (the studio re-exports them), so the verification
workers, the smoke test and the standalone verifier run the same code.

SECURITY
- [x] Every proof read from outside is untrusted: zod `.strict()` schema, caps
  (24 MB file, 512 tests, message length, 60 simulated seconds, collider
  count and numbers), canonical-JSON hashing that rejects non-finite numbers
  and cycles. Hostile `__proto__` members are rejected (tested).
- [x] Check order is fixed and fails closed: format, content hash, signature,
  engine version, world hash, replay. An edited proof is `tampered`; an edited
  and re-hashed one `replay-diverged`; a re-hashed signed one `bad-signature`;
  a grafted signature or key does not verify (all tested, plus in browsers).
- [x] The replay of a hostile world is as safe as playing it: `validateWorld`,
  scripts only in the QuickJS sandbox, replay bounded by the 60 s simulated
  horizon and a 30 s wall-clock budget (a budget cut is `inconclusive`, never
  sealed or judged).
- [x] Embedded colliders are re-validated with `parseCollider`; modified
  colliders change their hash (`tampered`). Worlds needing colliders a proof
  does not carry are `unverifiable` instead of being replayed with guesses.
- [x] Signing key: non-extractable Ed25519 `CryptoKey` in IndexedDB. A
  signature is never described as identity; docs/PROOFS.md lists what a proof
  does not say (the world's own tests may be meaningless; `sealedAt` is the
  sealer's clock; engine changes need a `REPLAY_ENGINE` bump, pinned by
  golden hashes).
- [x] Honest wording is centralised in `@aether/verifier/format`; "Verified
  playable" needs both a reproduced claim and an all-pass claim; a sealed
  failure is never shown as playable, and publishing does not seal a world
  with failing checks. The page meta tag and image caption use only validated
  `sha256:` hashes.
- [x] Share links drop proofs above 16 KB (decoded proofs are capped at 4x
  that before use); `game.json` drops proofs above 24 MB.
- [x] `npm audit`/new dependencies: none added (SHA-256 in-repo, checked
  against `node:crypto` for every length around the block boundaries).

PERFORMANCE
- [x] The verifier is imported lazily (seal at publish time, check on
  click); the player's first load is unchanged apart from the small badge
  component and the `format` strings.
- [x] Sealing replays at most 12 simulated seconds on the main thread with
  the verifier's cooperative yielding, cached per world version; typical
  worlds take 0.05 to 1 s (the slowest bundled game, 0.7 s). Share-link
  creation waits for the seal on its first call only.
- [x] Proofs are small (about 1 KB per 4 tests; 0.7 KB added to a link).

Tests: 47 verifier tests (hash vectors, tampering, signature grafting, engine
and world mismatch, budgets, embedded colliders, golden determinism pins, every
bundled game seals and re-verifies, CLI and the real `aether-verify`
executable), 9 studio tests (world hash survives `game.json` and share links
for all 35 bundled games; builds, links, forged links), smoke seals and
re-verifies each of the 28 prompt worlds. `npm run e2e:proof`: Chromium runs
the Node-sealed link through the player ("Verified playable" after one click),
four forged links each fail with their own message, the studio seals a link
and a game that Node and `aether-verify` verify (exit 0; tampered exit 1), and
the extracted build verifies in the browser. The engine matrix (verifier
bundled for browsers, no WebGL needed) seals four pinned worlds, one driven by
kinematic trigonometry, in Chromium and Firefox and requires proofs that are
byte-identical to Node's. Firefox's player/studio flows could not run in this
sandbox (headless Firefox has no WebGL here: `AETHER_E2E_SKIP_NO_GL=1`
limited it to the engine matrix); CI has WebGL and runs everything.


## Stage: Aether as an MCP server (`aether mcp`)

**What shipped.** `aether mcp` serves the loop over stdio on the official MCP
SDK (1.32.1, MIT, pinned): `create_world`, `edit`, `apply_patch`,
`list_entities`, `get_entity`, `get_world_summary`, `verify`, `playtest`,
`replay`, `render_still`, `export` (glTF, standalone web build, floor-plan SVG,
project file), `undo`, `redo`, plus resources for the world, its summary, both
JSON Schemas, each entity and an authoring guide. It works offline on the
planner and, when `aether start` runs and an account is signed in, through the
local server's providers. `docs/MCP.md` has the Claude Code and Codex configs.
New original code: a headless scene builder, a software renderer (visibility
buffer, shadow map, sky, fog, glass), a PNG encoder, a glTF writer, and a
playtest bot that walks, jumps and drives toward pickups, rule zones and goals
(it found that a floating coin is only collected by a hop, and now hops).

**Tests.** `apps/cli/test/mcp.test.ts` (in-memory transport, 19 cases: tool
and resource surface, the offline create / verify / playtest / export loop,
patches and undo, a scripted model through `create_world` and `edit`,
rejection of bad patches, prototype-pollution keys, oversized and unknown
input, symlink and traversal attempts, persistence and a corrupt saved world),
`apps/cli/test/mcp-units.test.ts` (16 cases: project-folder guard, error scrubbing,
loopback-only fetch, objectives, renderer determinism and sun shading, PNG and
glTF round trips, arguments) and `tests/e2e/mcp.e2e.ts` (a real MCP client
spawns `aether mcp` over stdio, builds a coin game, verifies it, plays it to a
win, exports glTF and the web build from the real studio build, replays a
falling ball, renders stills, undoes). Wired into CI after `e2e:security`.

SECURITY
- [x] The client is untrusted. No tool takes a path or reads a file; every
  output name goes through `safeFileName` and `ProjectDir`, which resolves the
  real path against the real project root, refuses symbolic links (including a
  planted `exports/` link) and writes atomically with mode 0600. Tests plant
  links and `../` names.
- [x] No network. The only connection is the loopback Aether server in
  `local`/`auto` mode, through a fetch that throws for any other URL, sends
  the install secret, and refuses redirects (tested). The SDK's HTTP transports
  are never started.
- [x] Strict zod on every input (unknown keys refused, prompt 4,000 chars, 200
  patches, 512 KB), `inspectUntrusted` before the patch validator, the same
  patch/limit code as the studio. Entity ids and selectors reach no `eval`,
  path or shell.
- [x] Time and size caps: agent 5 min, verify / playtest / render / export
  60 s plus the client's cancel signal; images 64-1920 px; 3 M triangles; 256 MB
  per file; world files 32 MB. Mutations are serialized.
- [x] Errors are `code: message`, scrubbed of absolute paths and control
  characters; anything unexpected is a generic internal error with detail on
  stderr only. The stdio server redirects `console.log` to stderr so a library
  cannot corrupt the protocol.
- [x] Dependencies: one new package tree (the SDK and its Express-based HTTP
  helpers, unused at run time), all MIT / BSD / ISC; `npm audit` reports 0
  vulnerabilities. Recorded in `docs/THIRD_PARTY.md`.
- Known limit: a hostile model-written generator still runs in the existing
  `node:vm` sandbox (documented in `@aether/procgen/node`, not a hard boundary);
  the MCP server inherits that, as the studio server does.

PERFORMANCE
- [x] Engine starts once per process (Rapier, QuickJS, catalog): about 0.3 s.
  A 67-patch game is created and verified in under 0.2 s, played in about
  0.1 s of wall time per 19 game seconds.
- [x] Stills: 960x540 with 2x supersampling and a 1536 px shadow map in about
  1 s for 180-310 k triangles (typed arrays and a visibility buffer, one pass
  per triangle); a deadline is checked per mesh and per 32 scanlines.
- [x] glTF export is world-space and un-instanced, so scatter-heavy worlds
  are large (the 8-coin game is 14 MB); capped by the triangle budget and the
  256 MB file cap. Instancing is a follow-up if exports of forests matter.
- [x] No change to any browser bundle: all new code is Node-only in
  `apps/cli`, and the studio build is unchanged.

**Gates.** tsc 0 errors; `apps/cli` Vitest 3 files / 59 tests; studio build OK;
smoke 28/28; `npm run e2e:mcp` passes against the real studio build.


## Intelligent characters (stage `npc`)

**What changed**

- World IR: `entity.npc` (perception, archetype behaviour graph, waypoints,
  factions, fear tags, activity hours, dialogue trees with conditions and
  effects, optional free conversation) and the `npcs` world test. All additive,
  all zod-validated with caps (`docs/CONTRACTS.md`, "Intelligent characters").
- `@aether/logic` `src/npc/`: navigation grid (A*, string pulling, line of sight),
  perception, the graph evaluator, `NpcBrain`, `NpcSystem` (noise, speech
  bubbles, the single running conversation), dialogue trees and the static
  analysis behind the `npcs` test. `LogicHost` gained three optional members
  (`getBounds`, `getColliderBounds`, `groundHeight`).
- `@aether/physics`: the `npcs` test (static at t = 0, then falls / stuck /
  patrol progress while simulated), `entityWorldBounds` / `entityColliderBounds`
  (`@aether/physics/bounds`); depends on `@aether/logic` now.
- `@aether/agent`: the offline planner understands guards, bandits, shopkeepers,
  villagers, wolves, prey, companions, dogs, monsters and sentinels from
  sentences and edits them by role / name / faction with minimal patches; the
  summary lists NPCs; the LLM prompt has a "Characters" section and a verified
  worked example (prompt ceiling 12.75k → 14k tokens).
- Studio: bubbles, "Talk to …" hint and dialogue card (keys, pointer, touch) in
  the studio and the player; free conversation through the connected model;
  Shift sneaks. Flagship **The Hollow Gate** (baked world, cover, thumbnail).
- Tests: logic navigation / brain / dialogue / analysis / crowd performance;
  core schema; planner (30 cases); studio frame and chat controller; a bot that
  plays The Hollow Gate to the win condition; `tests/e2e/npc.e2e.ts`.
- One existing assertion changed on purpose: `assets.test.ts` ("brings
  characters and animals to life") asserted the legacy `npc` greeter behaviour
  on an added villager and a `wander` behaviour on an added dog; characters are
  intelligent NPCs now, so it asserts `entity.npc` (archetype, dialogue nodes,
  `wander`). The legacy `npc` behaviour still exists and works.

**Bugs the new tests caught (all fixed)**

- Navigation grids were shared by every NPC of the same radius, so a guard's
  1.8 m body height decided what blocked the wolves: grids are keyed by level,
  radius and height. A regression test builds a canopy a tall guard cannot pass
  and a low animal can.
- A generated pine's colliders as one box made woods impassable; per-collider
  bounds (trunk and canopy) are used when the host can provide them.
- Library-model NPCs were placed with a capsule's centre height (models have
  their base at y = 0), which the analyzer flagged as "stands on ground it
  cannot walk on".
- The locked-gate door's unlock flag did not match the id the sale unlocked.

**SECURITY**

- [x] New input boundaries: `entity.npc` (zod, every list and string capped,
  dialogue links validated, condition depth guarded at run time), dialogue
  effects write world state through `writeState` (forbidden keys, size and key
  caps; failures are caught and logged), prototype keys inside NPC data are
  rejected by `inspectUntrusted` (test).
- [x] Free conversation: off unless a model is connected; reuses
  `AiConnection.createProvider`, so bring-your-own-key calls count toward the
  existing metered per-session cap; extra caps of 40 replies per session, the
  spec's `maxTurns` per character, one request at a time, a 25 s timeout and
  200 output tokens; the model has no tools; the player's line is quoted as data;
  replies are reduced to plain capped text (markup, control characters, links
  and name prefixes removed) before they reach the screen, and the UI renders
  text only (no `innerHTML`). Prompt-injection and limit tests are in
  `npcChat.test.ts`. The logic package never touches a network.
- [x] No new dependency, no new network surface, no eval; CSP unchanged.

**PERFORMANCE**

- [x] Per tick, 50 NPCs cost about 0.05 ms, 100 → 0.11 ms, 200 → 0.32 ms and
  400 → 1.0 ms (patrolling guards, wandering wolves with fear checks, villagers,
  shopkeepers, a moving player, six walls; `npc-perf.test.ts` asserts < 3 ms for
  60). Perception runs on every third tick per NPC (staggered), A* is bounded
  (9000 expansions, re-planned at most every 0.4–1.2 s), neighbours come from a
  hash grid, grids are built once per level and body size.
- [x] No arrays, strings, closures or objects per tick in steady state: the
  allocation probe (60 NPCs, 1500 ticks) measures about 10.6 KB per tick, all of
  it boxed numbers passed between non-inlined calls (a Map rebuilt every tick,
  `Math.hypot` results and a `length = 0` that freed bucket storage were found
  and removed by the probe). The test fails above 16 KB per tick.
- [x] The studio samples the NPC system at most about 12 times a second and
  only publishes a frame when something changed; bubbles are projected with
  the camera matrices (no three.js objects).

**Gates.** tsc 0 errors; Vitest (Node 24) 198+ files / 2500+ tests pass (the
render allocation probes and two server / sandbox tests are timing- and
Node-version-sensitive: under Node 22 with parallel workers they flake, alone on
Node 24 they pass); studio build OK; smoke 32/32 (three NPC prompts added);
`showcase:bake hollow-gate` verifies (`npcs` test, 16 s simulated); the bot
plays The Hollow Gate to the win; `e2e:npc` passes in Chromium WebGPU
(prompts → patrol → chase and damage → talk, keys and the close button, no
console errors). Firefox could not start WebGL2 in this environment (the
existing `e2e:editing --firefox` fails identically at renderer start), so the
Firefox run of `e2e:npc` was not executed here; nothing in the NPC code is
renderer-specific.


## Stage: verified-playable hero flow

An autonomous playtest agent (`packages/playtest`) plays a game or walks a
building in a worker, a self-repair loop fixes what it finds with small
undoable patches, the studio shows a "Verified playable" badge with a ghost
replay of the winning run and the proof seal, and share links and published
games carry the proof. Design in ARCHITECTURE §21, contracts in CONTRACTS
("Verified playable").

**Bugs found while building and testing it (all fixed, each with a test).**
- Dijkstra with float32 distances re-expanded nodes without end (82 M
  expansions for 37 k nodes: 15 s per plan) because a relaxation that
  improved a float64 value by less than a float32 ulp pushed the same key
  again. Distances and heap keys are float64 now: 80 k expansions, 19 ms.
- Walk edges were chosen per direction ("nearest node in the next cell"), so
  a room entered through a doorway could not be left again. An edge now exists
  when either end picks the other; edges are two-way.
- A stairway had no nodes: the capsule fit test lifted the capsule 7 cm, so
  every tread overlapped the next riser. The lift is the step height (the
  controller's own autostep) plus 1 cm.
- A doorway with a few centimetres of slack fell between grid cells, and the
  bot jumped over walls through "open" doorways: doorways now get nodes on
  their own axis (portals), jump candidates need a clear line at chest
  height, and a doorway the body cannot pass is measured and reported ("about
  0.74 m of room, the player needs 0.75 m").
- Hazards were blocked by their bounding box with a 1.8 m height band, which
  blocked every platform above a lava pit; they use the logic runtime's own
  touch volume now.
- The stuck watchdog measured distance to a look-ahead waypoint that recedes
  as fast as the bot walks, so it called every walk stuck. It measures the
  player's own displacement.
- A `grounded` flag flickers while the capsule climbs a wall edge; landing now
  also needs a non-positive vertical speed.
- Blame for being stuck went to the nearest door; it now names what the
  capsule actually overlaps (furniture first).

**Real findings about the product (reported, not hidden).** The offline
architecture planner builds 0.8 m interior doors whose leaf folds against the
jamb and leaves 0.74 m of clear opening — not enough for the studio's
0.7 m capsule plus the controller skin. Five of the eight planner buildings
pass the walkthrough as built; the café and loft fail honestly with "the
washroom door is too narrow for the player", and the repair widens the door,
its frame, the wall opening and the building plan to 0.9 m (café then passes).
The loft stays reported: furniture next to its bathroom door leaves too
little room (a layout problem the bot names but does not move). In the
two-storey villa the bot climbs the stairs and visits the landing and the
bathroom but finds no walkable way on to the main bedroom (the doorways sit at
the stair top); it says "no walkable route to Main bedroom, the way passes
villa-l1-d0-leaf" and does not guess a repair.

SECURITY
- [x] Worker boundary: requests and replies are zod-validated both ways
  (strict objects, bounded numbers, request ids, one terminal reply per id);
  the world is re-validated with `validateWorld`; reports and proofs crossing
  the boundary are re-validated (`parseReport`, `parseProof`: finite numbers,
  bounded lists, clipped strings, exact trace lengths, base64 shape).
- [x] Resource caps: 900 s simulated and 120 s wall-clock at most (defaults 240
  / 20), 200 objectives, 24 findings, 160 k nav nodes / 120 k cells, 6 000
  trace frames, 400 events; the client times out and terminates a worker that
  overruns (budget + 20 s) and supports cancellation. The Dijkstra expansion
  is not interruptible mid-search (a pathological ledge-rich world is bounded
  by the node cap and by the worker kill), which is the one known overrun.
- [x] The proof is evidence, not authority: the hash binds it to gameplay
  content (it is an integrity check, not a signature — anyone can forge a
  proof for their own world), so the viewer's badge is green only for a
  passed proof whose hash matches the world on the page, and "Re-run the
  check" runs the bot on the viewer's own device. A malformed proof is dropped
  with the world still opening; share links stay under the existing size caps.
- [x] Repairs go through `History.commit` / `applyPatches` (validated,
  invertible, one undo step each, never over a newer user edit, locked
  entities untouched); the sentences shown contain entity names as plain text.
- [x] Scripts: worlds with QuickJS scripts run in the worker with the existing
  sandboxed runner; the bot adds no eval, network or file access.
- [x] No new dependency (`zod` already in use); `docs/THIRD_PARTY.md` says so.

PERFORMANCE
- [x] Off the main thread: the bot, physics and logic run in a module worker
  with progress at ≤ 10 Hz; the main thread only runs the repair proposals
  (pure document analysis) and the cheap proof functions (`@aether/playtest/proof`
  and `/wire` are physics-free; the bot chunk loads lazily on first use).
- [x] Measured (Node, one core, software GL browser for the e2e): coin hunt
  with 8 coins — 22 s of play in about 2 s wall (navigation graph 0.8 s for 37 k
  nodes, planning 19 ms in total); locked vault — 7 s of play in 4 s wall (grid
  0.1 m: 79 k nodes, 1.1 s); a six-room apartment walkthrough — 20 s of walking in
  2.5 s wall; Firefox runs the same worker in 1.7 s.
- [x] Memory: typed arrays only (positions, normals, edge caches 2 bits per
  node and direction); the trace is at most 96 KB; the ghost builds its route
  geometry once and disposes it; 20 start / stop cycles of the replay leave GPU
  geometry counts flat (same probe as the physics proof).
- [x] The grid adapts: 0.1 m for rooms and corridors (doorways), up to 1 m for
  open fields, about 45 k–90 k cells.

**Not done / known limits.** Lifts and moving platforms are planned on their
starting pose (reported as a caution, never a verdict); pressure plates that
must be held are visited, not held; vehicles, block worlds, orbit-camera worlds
and avatar-entity players are `unsupported`; the Firefox WebGL part of the e2e
could not run on this machine (`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`, the
existing `e2e:ux` fails the same way) — the Firefox worker path was exercised
without a renderer instead; custom model-written generators that need renderer
colliders are built from their built-in fallback shapes in the bot's world.

## Integration: characters + verified playable + replay seal

Three finished stages met on `main`: prompt-defined characters (`npc`), the
playtest bot with Verified playable (`verified`) and the replay verifier with
signed seals (`@aether/verifier`). The first two were built before the third
existed, so each carried its own proof concept.

**Reconciled: one proof, one badge, one file format.**
- The bot's own proof (`@aether/playtest/proof`) stays the bot's report format
  inside the studio. What ships is the verifier's `aether-proof`: a passed bot
  run is embedded as the additive, hashed and signed `playtest` member
  (`createProof({ playtest })`), thinned to <= 400 frames / 20 events (a sealed
  Hollow Gate proof is about 6 KB, inside the 16 KB link limit).
- The branch's second badge and its `game.json` / share `proof` handling were
  dropped; `player/ProofBadge.tsx` is the verifier's badge plus one sentence
  about the bot, "Watch the bot's run" (the ghost replay) and, after "Check it
  yourself", "Re-played on this device: it won again."
- `checkProof` takes an injected re-player (`CheckOptions.playtest`), so the
  verifier package does not load the bot engine: the CLI wires the Node bot,
  the player wires the playtest worker. `aether-verify seal` runs the bot,
  `aether-verify` re-plays it (`--no-bot` to skip). Hash, sign and format code
  are the verifier's; nothing was duplicated.
- Wording stays "deterministic replay check, not a formal proof". In the
  studio a live bot run on the world on screen still reads "Verified playable"
  (a visible check on this device); the published artefact is "Sealed
  playable" until a viewer checks it.

**Bugs the combination exposed, fixed at the root.**
- The seal replayed 12 s, but The Hollow Gate's `npcs` test needs 16 s, so it
  sealed as "not decided": the horizon is now the longest test (`replaySettingsFor`).
- The bot could not win a world where a shopkeeper's dialogue unlocks the gate
  ("nothing in the game ever sets it"). It now has `talk` objectives (press E,
  numbered options, required gold becomes required pickups) and the headless
  hosts expose collider bounds so characters navigate around buildings.
- `aether-verify` could not read a world export (`aether-world`); it can.
- `hashWorld` now covers `entity.npc` (a changed dialogue changes the gameplay).

**Follow-ups (not done).**
- `apps/cli/src/mcp/playtest.ts` (MCP autoplay) is an older, simpler bot with its
  own result type; it should call `@aether/playtest` so MCP clients get talk
  objectives, repair and the same evidence. Left alone to keep the MCP contract stable.
- The seal horizon grows to the longest test but is capped at 60 s; a test
  that needs longer is cut and reads "not decided" (the seal then fails, honestly).
- The bot does not yet hold conversations that depend on the NPC's mood or
  daylight (it waits for the hint and gives up after 1.5 s of simulated time).
- A proof from a pre-merge bot (`aether-bot` format) no longer exists in the
  wild (the branch never shipped), so there is no migration.

**Firefox WebGL in the e2e suites.** Earlier stages recorded that headless
Firefox here has no WebGL (`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`) and ran
Firefox without a renderer. A headed Firefox on an Xvfb virtual display does get
WebGL 2 (llvmpipe), so `tests/e2e/support/firefox-gl.sh` now wraps the Firefox
executable (see the README, "Firefox on a machine without a GPU or a display")
and `e2e`, `e2e:npc`, `e2e:proof` and `e2e:verified` run their Firefox halves for
real. Software GL makes Firefox start its project store a few seconds late, which
`e2e:verified` now tolerates (it submits the hero prompt again until the project
opens). Also fixed: the project home kept showing a thumbnail whose object URL it
had just revoked (a `Failed to load resource` console error, seen once in
`e2e:verified`).

## Fix: wall decor over doors and windows, blind agent, silent provider failure

**The report.** "why is the curtain over the door and the painting over the
window": the Codex assistant failed with "Codex failed to answer.." and the offline
planner then said it could not map the question; the Claude Code assistant said it
could not see the textiles generator or which wall the door was on, and asked the user.

**Root causes (all confirmed in code and by regression tests that fail on the old code).**
- A. `RoomLayout.onWall` placed every wall piece at the requested offset with no check
  against the wall's doors, windows, other pieces or tall furniture; `curtains()` hung
  panels 12 cm *into* each window and past doors and corners; explicit plan items
  (`place_item {kind:"curtain"|"art"}`, what "a bedroom with a curtain and a painting"
  becomes) were put at the middle of a wall at 1.3 m, or fell through to the floor
  placer. The old code produced such overlaps in the stock two-bedroom apartment itself.
- B. A parametric building collapsed to one digest line in the model's world summary:
  no walls, no openings, no wall pieces. A model could not diagnose anything and the
  `inspect` tool returned the same summary.
- C. The bridge swallowed the CLI's reason (every unknown failure became "<CLI> failed
  to answer."), the studio appended another full stop, and the studio went straight from
  the failed assistant to the offline planner, which only handles simple edits, without
  trying the user's other signed-in assistant. (The reason Codex itself failed on that
  machine is not recoverable from the report: the text was discarded. The new
  classification and excerpt make the next occurrence legible.)

**What changed.**
- `wall-space.ts`: one rule set for wall pieces (blockers, per-kind margins, vertical
  extents, nearest clear stretch). `RoomLayout.onWall` slides to the nearest clear
  stretch (art and mirrors shrink first) or returns null; `onAnyWall` tries other walls;
  `hangCurtain` anchors panels to a window (rod past the frame, narrower panels near a
  door or corner, none when there is no room; sill-length in kitchens and baths).
  Floor furniture and `againstWall` avoid hanging pieces; explicit curtains are placed
  before pictures so they keep their window.
- `placement.ts`: `analyzeRoomPlacements` audits any document (generated, hand-edited or
  agent-built) with the same rules and returns wall, compass side, offsets, entity ids
  and a minimal fix. `checkBuilding` includes it, so the `navigable` test, the repair
  turn and `build_architecture` results flag it.
- The model's summary (`summarizeWorldForModel`, also used by `inspect` and the MCP
  summary) lists every wall face with its openings and wall pieces plus `placement-issue`
  lines with ready fixes. MCP `get_entity` / `list_entities` carry `wall` and
  `placementProblems` for wall pieces. The system prompt says to read these and never to
  ask the user which wall (ceiling raised 14k to 14.2k tokens for it; ~130 tokens).
- The offline planner answers "why is X over Y" / "fix the curtain" from the summary:
  explains each problem and applies the minimal `update` patches; on a clean building it
  says so instead of "couldn't map".
- Bridge: `classifyCliFailure` now separates model unavailable, context too large and
  network failures from rate limit and sign-in, and otherwise names the real reason with
  a scrubbed excerpt (no paths, URLs, addresses or tokens). New codes are additive
  (`BridgeErrorSchema` reads an unknown code from a newer bridge as `backend_error`).
- Studio: `createProviderChain` runs chosen assistant, then the other signed-in assistant
  (own default model), then offline; each switch reports the exact reason and what comes
  next; a dead bridge or expired pairing skips straight to offline.

**Verification.** New tests: property sweep of 120 random rooms (types, styles, narrow
walls, doors beside windows) plus the apartment fixture over every style and several
seeds, planner tests for the user's exact prompts and the diagnostic question, bridge
classification, provider chain with fake providers, alternates selection; the `e2e:arch`
chat step asks the question in a real browser. Screenshots of the three prompts were
looked at: curtains flank the window, nothing over the door.

**Known limits.**
- Wall pieces are boxes; a mirror may overlap a cistern or lamp top by up to 10 cm.
- With two windows less than ~1 m apart one shared curtain panel hangs between them.
- Pieces the user moved by hand are audited and flagged but never auto-moved except by
  asking (or running the repair turn).
- `e2e:arch` fails at its "studio render" step in this environment on `main` as well
  (software GL, 30 s wait); the steps before it, including the new one, pass.

## Stage: photoreal renderer

Scope: tiered finishing chain (AO, TAA, reflections, sun shafts, halation, aberration, grain, DOF),
grade presets, HDRI/sky image-based light, area and IES-style lights, CC0 finish sets, supersampled
stills and the lazy path-traced still. Design in ARCHITECTURE section 24.

- [x] **Security.** The path tracer is a lazy chunk on a private WebGL2 context; scene conversion is
  capped (2 000 000 triangles, 4096 px) and cancelable. Texture sets are bundled CC0 files with
  credits in docs/THIRD_PARTY.md; no network fetch at render time. New dependencies are exact-pinned
  and licence-recorded (three-gpu-pathtracer, three-mesh-bvh, xatlas-web).
- [x] **Performance.** Tier is chosen from GPU class and memory budget; software GPUs stay on `low`.
  A failing effect is dropped in a fixed order rather than failing the viewport. The leak check
  (textures and heap across on/off cycles) is recorded above; per-effect costs come from
  `npm run e2e:render-bench`.
- [x] **Gates after merging origin/main.** tsc 0 errors, full vitest green (one load-related flake
  on the first run, clean on rerun), studio build and smoke 32/32.
- [ ] Not re-measured in this session: a fresh headed RTX 4090 look-development round and Firefox
  e2e on the merged tree.
## Stage: small, precise edits by prompt (refine by default)

**Goal.** After a world exists, any small change typed in plain language
gives exactly that change (nothing else regenerated or moved), every
following message refines the current world, and each step is one undo.

**Audit first (offline planner through the real agent loop, before any
change).** 199 prompts over the bundled default projects: two apartments and a
penthouse (generated buildings), a living room, three games (Lantern Isles,
Coin Island, Kart Canyon), a camp, a meadow and a block world; 139 written
while building the parser, 12 regressions found by hand-trying prompts
afterwards, and 48 holdout prompts in different wording. The
unassisted planner passed **53 of 199 (27%)**: target accuracy 40%, over-edit
rate 24% (a request that moved or recoloured unrelated things). Failure
causes (a case can have several): 114 changed nothing or the wrong thing, 48
changed other objects (the planner only saw an elided summary of big worlds;
"make the sofa dark green" in an apartment rebuilt 100+ entities), 5 guessed
instead of asking which one, 2 painted wrong wall faces, 4 changed the world
when they should not have (the planner rebuilt a whole apartment for "make the
whole apartment warmer" and read "make" as "add"; both fixed). "Undo that", "this", "the other bedroom", walls,
doors, speeds, game numbers and every furniture slot were not reachable at
all. The mock itself answers instantly; a real model call (seconds) was needed
for every one of these and often got it wrong.

**Root causes fixed.**
1. *Target resolution* (`refine/resolve.ts`, `scene.ts`, `walls.ts`): name,
   type with synonyms, room ("the bedroom's back wall"), ordinal ("the second
   chair"), relation ("left of the window", "above the fireplace", relative to
   the viewer's heading), selection ("this", "it"), conversation ("do the
   same for the other bedroom", "that"), group tags ("the train"), field
   families ("the pine forest"); genuinely ambiguous references return the
   candidates (numbered and outlined in the viewport) instead of a guess.
   Walls resolve by geometry: room polygon edges, the wall face looking into
   the room.
2. *Minimal patches* (`draft.ts`, `ops-*.ts`): an op edits a copy-on-write
   draft; the patch list is `patchesBetween(before, draft)` so it is exactly
   the property-level difference. Parametric furniture is edited through its
   declared parameters (upholstery, legs, width), not stretched or rebuilt;
   `describe.ts` renders the compact diff from the real changes. A guard
   (`guard.ts`) refuses model patches that touch unrelated existing entities
   and tells the model why.
3. *Fast path*: about 0.7 ms median, at most 5 ms p95, zero model calls
   (`planFineEdit` runs before the model); cosmetic edits (colour, light,
   name, sky) skip physics verification, geometric ones verify once; for a
   model the world summary is a focused slice (55-62% fewer tokens on 290-350
   entity worlds) plus the in-scope entities in full (generated buildings fold
   their furniture out of the summary, so the model could not even see the
   sofa).
4. *Coverage*: `refine-coverage.test.ts` proves a prompt for every property
   class (transform, parametric size and variants, per-slot materials, wall
   faces, floors, ground, opacity / glow / metal, physics feel, lights,
   sky / time / weather / fog / gravity / bloom, player speed / jump /
   camera, behaviour speeds, NPC names and dialogue, doors, visibility, names,
   add / duplicate / remove, scatter density and size, goal / time limit /
   difficulty, block-world structures, blocks, settings). Schema additions
   (backward compatible): `ArchMeta.overrides` and `ArchMeta.removed` so an
   edit or removal of a generated piece survives a rebuild of its building
   (`applyArchOps` re-applies them; before, any later architecture edit
   silently undid hand edits). Sounds are rule actions, not properties.
5. *Refine by default everywhere*: the model gets `<edit_mode>` (refine or
   new world) every turn and a refining rule in its system prompt; the
   offline planner no longer replaces a world because the text describes a
   scene (atmosphere re-dresses, other themes are added in a free spot);
   templates and example chips send `intent: 'new'`; the first prompt on the
   untouched default glade builds a new world; a project with content shows
   refine chips instead of new-world chips; composer placeholder, first-run
   hint, home hero copy and selection-aware chips say so; in play mode a
   "Tweak" prompt edits and restarts the game.

**Results (`npm run eval:edits`, same 199 prompts).**

| Engine | Pass | Target accuracy | Over-edit rate | p50 / p95 | Model calls per edit |
| --- | --- | --- | --- | --- | --- |
| Offline planner alone (before) | 53 / 199 | 40% | 24% | 1.3 / 20 ms | 1.00 |
| Local fast path | 199 / 199 | 100% | 0% | 0.5 / 2 ms | 0 |
| Fast path + planner (product path) | 199 / 199 | 100% | 0% | 0.9 / 4 ms | 0.03 |
| Careless recorded model, guard off | 0 / 102 | 100% | 100% | n/a | 2.0 |
| Careless recorded model, guard on | 99 / 102 | 98% | 1% | n/a | 3.0 |

The 48 holdout prompts scored 38 / 48 (79%) on their first run, before
any generic fix for what they exposed (a scene description swallowed as a
sky change, "take X out", "X too", implicit subjects, "forest" read as a
colour); all 48 pass now, so they are no longer an independent estimate.
The tuned / holdout split stays in the eval so new wording can be added as
fresh holdout. The recorded model is the fast path's own patch plus two
unrelated nudges on its first turn and the minimal patch once refused: it
measures the guard and the loop, not a real model (none is available
offline; the latency of a live provider is the seconds a model call costs,
which the fast path removes). The guard also refuses a `clear` for a small
request. Scene-describing and chatty prompts ("a cozy village by a lake at
sunset", "build me a castle with a moat", "make the sky purple", "surprise
me") are never swallowed: 21 of them are asserted to be declined by the fast
path.

**Tests added.** `refine-parse` (46), `refine-edit` (49: minimal patches,
overrides, tombstones, walls, viewer-relative moves, resolution,
conversation, refusals, game edits, the guard, 21 never-swallow prompts),
`refine-agent` (16: zero model calls, events, clarify / undo / memory,
guard rejecting a sloppy model, focused slice, refine-by-default, hostile
host context), `refine-coverage` (56), the eval suite (4), arch `overrides`
(3), studio `refine` (9) and `refineStudio` (5: first prompt replaces the
glade, later ones refine, ask and answer, undo, selection). Playwright
`e2e:refine` (Chromium and Firefox): build a camp, five chained small edits
each changing only their target (world compared before and after: same
entities, same rules and state, exactly one undo step, zero model calls, diff
card shown), an ambiguous request that asks and is answered, undo of
everything back to the exact built world, GPU objects flat over 20 edit /
undo cycles. `e2e` (studio) now asks for a fresh world with "Start over:"
before its later example prompts.

SECURITY
- [x] New input boundaries: the prompt (existing 8,000-character cap; the
  parser reads at most 1,000 characters, regexes fuzzed with 5,000-character
  and pathological inputs, under 500 ms), `RunOptions.selection` / `memory` /
  `heading` from the host (`sanitizeSelection`, `sanitizeMemory`: valid id
  slugs only, at most 256 ids, a command only with a known op, plain JSON
  through `inspectUntrusted`, at most 4 KB; tested with `__proto__`,
  path-traversal and oversized values), `arch.overrides` / `arch.removed` in
  imported worlds (zod; at most 64 overrides and 400 removed; applied by a
  path walker that skips `id`, `parent`, `arch` and prototype keys and falls
  back to the compiled piece when the result does not validate; tested),
  model patches (a new guard in front of the existing validation).
- [x] Every patch the fast path emits is validated atomically with
  `applyPatches` before it is committed and again by the host; locked objects
  never resolve and the host still screens them.
- [x] No eval / `new Function`; chat text goes through React text nodes; the
  diff swatches only accept `#rrggbb` (tested with a hostile value); CSP is
  unchanged; no secrets; no new network or subprocess use; no dependency
  added. `npm audit --omit=dev`: 0 vulnerabilities.

PERFORMANCE
- [x] The edit engine (parser, lexicon, 17 operations, about 145 KB / 49 KB
  gzip) is a separate lazy chunk loaded on the first prompt through a dynamic
  import in `agent.ts`; the first-load bundle grows by about 8 KB raw / 2.5 KB
  gzip (chat cards, hints, tweak bar). First frame unchanged (e2e boot:
  Chromium WebGPU about 2 s, Firefox WebGL2 about 2 s on software GL).
- [x] Not a per-frame path: an edit allocates a handful of small objects once
  per prompt (p95 at most 5 ms on 355 entities). `sceneOf` is cached per world
  object (WeakMap); a draft clones only the entities it touches.
- [x] GPU resources: 20 add / recolour / undo cycles by prompt leave renderer
  geometries and textures flat (limit +6 / +4) in Chromium and Firefox (the
  e2e prints the numbers).
- [x] Firefox / WebGL2 measured: `e2e:refine` and `e2e` pass in Firefox
  (these runs need a display on this machine: `xvfb-run -a`).
- [x] Physics re-verification only where it matters: colour, light, name,
  sky and text edits skip it; geometric ones verify once.

**Known limits (stated in the product, not hidden).** A long wall that
bounds several rooms has one finish per face, so painting one room's wall
changes the whole wall (the reply says so); real wallpaper patterns need a
wallpaper finish in the library (a tinted woven finish stands in, and the
reply says that stripes and florals are not available yet); lamps without a
light source cannot be switched; furniture that only comes in wood and metal
finishes says so instead of faking a paint colour.

**Gates.** tsc 0 errors; studio build OK; smoke 28/28; `npm run e2e`
(Chromium WebGPU, Chromium WebGL2, Firefox WebGL2) and `npm run e2e:refine`
pass in Chromium and Firefox. Vitest: everything passes except five tests that
fail identically on the base commit in this environment and are unrelated to
this stage (no file of `packages/procgen`, `packages/render` or `apps/server`
changed): the generator-sandbox child probe and two server storage tests
(`WebAssembly` is undefined in the locked-down child under Node 22.19) and the
render allocation probes (16.6-34 bytes per frame against a limit of 16; the
failing subset changes from run to run).
## Real people (stage `characters`)

Rocketbox (MIT) bodies and motion replace capsule and procedural figures for the player and NPCs.

- **Security**: no new runtime dependency. `CharacterSpec` is zod-validated (hex colours, slug body ids,
  bounded scale and word lists); unknown cast ids fall back to a seeded pick. Asset URLs are
  content-hashed files under the app's own `/assets/lib/`; nothing is fetched from user input. Prop
  and look text parsed by `lookFromText` uses bounded regexes on prompt-length strings.
- **Performance**: one shared skeleton and motion file per gender, lazy per-body glb (<= 1.2 MB),
  LOD and animation rate drop with distance, `update` clamps dt (<= 0.25 s) and ignores NaN.
  Animation is visual-only: colliders, NPC navigation, the bot and proof hashes are untouched.
- **Honest limits**: realism is "2010-era AAA scans under photoreal light"; hands/fingers IK only for
  held props; the 50-NPC software-GPU budget was checked via the e2e only at small counts.
- **Tests**: `packages/assets/test/characters.test.ts` (cast, look resolution, retarget maps, state
  machine incl. stride match, death, bad dt), `packages/core/test/character-schema.test.ts`,
  `tests/e2e/characters.e2e.ts`.

## Stage aifirst: the AI is the brain (plan first, tool placement, eyes, review loop)

**What changed.**
- `@aether/arch/scene`: scene model read from the document, measuring tools, placement tools that refuse
  nonsense, the design plan schema, conformance with the plan, tool dispatcher (`design_plan`, `place_items`,
  `edit_items`, `query_scene`), review cameras and numbered marks.
- `@aether/agent`: the four tools, a plan-first prompt, the review-and-fix loop (`review` option) with
  `StallTracker`, transcript recording and replay, `drawMarksRgba`. Behaviour added after live runs with Codex:
  a model that claims "the tools are unavailable" is told they are; a `finish` sent in the same reply as a
  refused call is ignored; warnings are shown once more before the model may approve; plan relations the checker
  cannot measure are dropped (and reported) rather than refusing the plan; plan opening ids are aliases of the
  built ones; a changed storey height re-seats placed ceiling lights.
- Providers: a Codex failure keeps the stream's own reason (the usage limit was shown as "exited with code 1"),
  the protocol text says a JSON reply is how tools are called, the chain falls back as before and the offline
  planner skips the review.
- Studio: `WorldRenderer.capturePoses`, `Simulation.capturePoses`, `AgentBridge.captureReview` (waits for the
  viewport), canvas marks, review events in the chat and the agent step, no round cap on subscription backends
  (10 on paid keys), 40 turns and 300 tool calls per run for AI-first.
- CLI/MCP: headless review renders with the software renderer; review enabled in the MCP session.
- Tests and tooling: unit tests for every tool (including NaN, huge numbers, unknown ids, prototype keys), the
  loop with scripted models, stall detection, replay of recorded Codex transcripts, `npm run e2e:design`
  (Chromium and Firefox, real renders with marks), `npm run eval:design`.
- The `e2e:arch` studio-render step was fixed earlier in this stage (the automatic playtest ghost kept the
  scene moving, so the still never refined).

**Security.** Every model output (plans, tool inputs, review replies, transcripts) is zod-validated with size
caps (40 items / 40 edits / 12 queries per call, 600 000 characters, transcripts of at most 400 answers); ids are
slugs, numbers finite and bounded, record keys cannot reach the prototype (`hasOwn` lookups, strict objects),
nothing is evaluated. Review images are rendered from the document and drawn on locally; the only data that
leaves is what the user's chosen assistant already receives. The Codex reason shown to the user is the CLI's own
error line, scrubbed by `classifyCliFailure`.

**Performance.** The checkers run on a scene read once per call (a house reviews in tens of milliseconds); the
review loop adds renders only when the model can see (six views of 768 px per round in the studio, 640 px in
Node at about 0.6 s each). Old review images are dropped from the conversation. A round is bounded (8 model turns,
the tool budget) and the whole loop by approval, stall detection, abort, or the paid-key cap.

**Evaluation (live Codex, `docs/EVAL_AIFIRST.md`).** 29 of the 45 prompts were recorded before the subscription's
usage limit stopped further runs (all 29 rooms; the 15 houses and one room are not recorded and say so). On those
29: no checker errors in 29 against 17 for the generator path (which builds nothing at all for 12 of them);
where both built, warnings 3.6 against 5.9 and score 87.7 against 86.2; the vision judge scores AI-first 5.0
against 4.8 (better on 10, worse on 4, level on 3 of 17 judged), mostly through completeness. AI-first loses on
layout of very small rooms (a bed too large for the room, missing pieces the loop stalled on), costs 22 model
calls and about six minutes per room against none, and hit the stall detector in 11 of 29 runs. Houses were
exercised only in the earlier partial run (many warnings left after the turn budget ran out, before it was
raised); they need a re-recording when the quota is back.

**Known limits.**
- The review renders are the software renderer in Node (flat light, library models not drawn); the studio uses
  the live renderer. Marks are not occlusion-tested.
- Plan views are taken with walls lowered to a plan, so wall pieces are not visible in them.
- Codex sometimes returns invalid JSON for very large plans (retried; the prompt asks for compact plans).
- The games/worlds adoption is at the interface level (docs/ARCHITECTURE.md section 24); no game generator was changed.
- Fixtures were recorded with the tool descriptions of this commit; changing them can make a replay take a
  different path (the tolerant replay then ends the run and the test checks it is no worse than recorded).


## Stage gamereal: realistic, genuinely playable games

**What changed.**
- Verified-playable bot: rides vertical lifts, derives and plays key-press-on-a-plate endings (`press` objective), plays
  goals a rule switches on, eases low-gravity jumps, maps 330 m levels, tries up to 160 searches per game plan (a
  walkthrough keeps 14 so a too-narrow door is still found). Honest results on the shipped flagships: it won five
  (Lantern Isles, Hollow Gate, Neon Rain City, Kyoto Temple, Orbital Lab) plus the new Highland Trail; before it won two.
- Real defects fixed: Orbital Lab put the player inside a pod and a roof beyond a 5 m jump; the bot could not see more
  than 160 m from the spawn; a one-button ending was reported "unwinnable".
- Level tools (`query_level`, `place_level_items`): the assistant places things in games and outdoor worlds with
  measured ground, clearance, sight lines and reach; wired into the studio, the MCP session and the agent loop, and
  the review loop now reviews levels (measured findings plus overview and player-camera renders).
- Layered terrain (per-vertex grass, rock, dry ground, snow weights; photographed surfaces blended per pixel),
  alpha-tested foliage cards and seven realistic generators; a "realistic" request swaps the offline planner's stylised
  nature for them; Highland Trail flagship.
- Block worlds: a time-of-day sun (warm at dusk, cool moonlight), sun-lit faces where the sky is open, texture relief,
  per-block variation and reflective, glinting water (still pixel-art block textures: no photographic block surfaces yet).
- Game feel for the human player (acceleration, firm stop, coyote time, jump buffer, jump cut); the end screen shows
  the run's numbers and a loss offers "Try again".
- Tests: `finale`, `level`, `level-agent` (playtest), `level-tools` (agent loop), `realistic` (planner),
  `terrain-splat` and `flora` (procgen), `terrain-splat` and `foliage-material` (render), `character-feel` (physics),
  `gamesVerified` (every shipped game, sealed), `tests/e2e/gameplay.e2e.ts` (three games won in Chromium).

**Screenshot rounds** (stills in `~/.local/share/aether/photoreal/gamereal/r1..r9`, assessed against "not cartoonish").
1. r1 baseline: flat green ground, cone pines, blobby fire: cartoonish. Gaps: no ground detail, toy trees.
2. r2 layered terrain: hills and mountains read as ground and rock with snow caps; trees still toys.
3. r3 realistic vegetation (loose leaf quads): trees read as trees but sparse and skeletal; terrain streaks on slopes.
4. r4-r5 denser crowns, top-down terrain UVs with triplanar rock: slope streaks gone, rock grain on cliffs.
5. r6 foliage cards (cut-out clusters): dense crowns with real leaf shadows on the ground; spruce wispy.
6. r7-r9 Highland Trail from the player camera: a river valley with spruce, birch, oaks, a hiker and a tent; assessed
   honestly: no longer toy-like, still a game and not a photograph (flat hillside colour, chunky foreground grass
   tufts, tent and hiker simple).

**Security.** Every level tool input is zod-validated with bounds (24 points, 40 items, 5000 m, 4000 rays, 600 000
characters); ids are slugs, entities are re-parsed with the `Entity` schema before they can become a patch, prototype
keys never reach a record, a hostile entity is refused; the tools never evaluate anything. The new `MeshPart.splat`
and `material.foliage` pass the same validators as the other part data (length, finite, range, enum); a baked mesh
drops `splat`. The page-side gameplay driver only calls the studio's own debug handle and runs in the e2e browser.

**Performance.** A tree is 1-3 k triangles (was 11 k as loose leaves), a grass tuft 12; the foliage textures are
synthesised once per cache in a few milliseconds each. The layered terrain costs about 28 texture reads per pixel on
steep rock and fewer elsewhere (60 fps on the RTX 4090 at ultra); software rasterisers and low-memory mode keep the
vertex colours (the first full e2e run stalled the page 472 ms compiling it on software GL; with layering off it passes). Ground, clearance and sight-line queries take 3-4 ms. The first reach question about a world builds
its walking map (2.3-5 s on Highland Trail's 330 m level, the physics world and the bot's session dominate the 0.4 s
grid); the next ones about the same gameplay content (objectives, review, reach, the result of a placement) take
10 ms from a 30 s one-entry cache (measured: objectives 2444 ms to 9 ms, review 2359 ms to 8 ms). The bot verifies Highland Trail in about 3 s of wall time for 111 s of play.

**Known limits.** Conversation and lift games (Hollow Gate, Lantern Isles, Orbital Lab) are won by the headless
verified bot and the hand-written bots, not by the real-time browser driver. Blockfall, Kart Canyon, Sakura River and
the orbit-view scenes are not driven by the verified bot. Foliage cards have no translucency. The stylised flagships
(Lantern Isles, Painterly Meadow, Sakura River) keep their art direction on purpose; Highland Trail is the realistic
one. Highland Trail shows the vegetation and terrain at their best, not photographs.

## Stage `imageroom`: a room from a reference photo (reconstruct, never template)

**What was built.** A picture with a prompt about a room, or the composer's "Recreate this image", rebuilds that room.
The vision model reads the photo into a zod-validated `RoomDescription` (footprint, camera, per-wall colours, openings
with wall / along / size / sill, every piece with wall-relative position or host, curtains tied to a window, pictures
hung above the piece beneath, cornice, light, palette, stated assumptions with confidence and a one-tap "adjust" sentence,
and for everything visible a box saying where it appears in the photo). `deriveBuild` turns it into a shell-only
`design_plan` and ordered `place_items` steps that run through the section 24 tools. `buildChecklist` is made before
building; compare rounds render the room from the photo's own camera, the model answers `report_verdicts` for every id and
fixes in the same reply. Measured next to the judge: a camera fitted to the described boxes (`calibrateCamera`, deterministic
pattern search, 0.4 s), framing of every box, and pixel similarity (colour, SSIM, edges). A round that scores worse by
more than one and a half items is rolled back (`restorePatches`); the last edits get one judge-only check before they are
kept. Without a vision model nothing is built: palette, brightness and a plain statement. The world is replaced by the room
as one undo step (not when refining). Parts added because the photos needed them: cornice, tv-set, round pictures, accent
cushions, pole floor lamp, headboard height, per-wall colours (`PlanRoom.wallColors`), curtain panel width.

**Tests.** Schema, derivation, fitting, checklist and scoring, framing and calibration (a badly off camera is recovered, the
fit is deterministic), similarity measures, `restorePatches`, image-size parsing; the whole pipeline with fake vision providers
(refused descriptions, edits before verdicts, rollback, round cap with final check, provider failure with its real reason,
unavailable mid-run, no renders, offline, vision off, replacing the world); replay of real recorded descriptions (hotel,
pd1) through the design tools with no checker error; `tests/e2e/photo.e2e.ts` (Chromium and Firefox: button, description,
shell and 16 pieces, real renders from the photo camera, a fix, assumption chips).

**Security.** Everything the model sends is zod-validated with caps (80 pieces, 24 openings, 16 assumptions, param records of at
most 40 keys with bounded values, forbidden keys dropped, free text clipped); numbers are finite and bounded; ids are slugs;
boxes are clamped. The photo goes only to the user's chosen assistant (as before for attachments). Decoded pixels are capped
(4 M pixels) and a failed decode only costs the pixel similarity. Nothing is evaluated.

**Performance.** One analysis call, then one call per compare round in the usual case, one judge-only call at the end when
needed: 7 to 10 model calls and 2 to 3 minutes per photo in the live runs (the AI-first review loop averaged 22 calls and
several minutes per room). Rounds are capped (6 on subscription backends, 4 on paid keys) and end early on approval or stall.
Renders: the photo camera plus a clean render and up to two wall views per round; calibration 0.4 s; similarity on a 96 px grid.

**Measured (live Claude Code, because Codex had hit its subscription limit; software renders, flat light).** Judge pass rate of
the checklist, first attempt to final, and the measured agreement with the photo (0.6 framing + 0.4 similarity), per photo:
hotel 11/17 to 12/17 (structural failure: window height and bed framing; framing 76% to 83%), modern teal (CC BY, local only)
9/14 to 12/14, pd1 white four-poster room 8/17 to 15/17. So the 90 % target was NOT reached on any photo; the earlier runs
before framing (hotel 7/17 at first, then 12/17 and one judged 17/17 with a render whose framing was clearly wrong) showed that a
judge alone is too lenient and a flat render too harsh, which is why framing is now measured. What still fails: the window of the
hotel is shorter and greyer than the photo's glowing sash window (no light through glass in the software renderer), a patterned
duvet is a colour, a four-poster bed and a vaulted ceiling are not parts, curtains near a corner get one panel, a plant frond is a
whole fig. Montages (photo | first attempt | final) and scoreboards are in `~/.local/share/aether/imageroom/`.
Codex was not usable (usage limit until 21:59); it was not run live.

**Known limits.** One room per photo; the shell has a flat ceiling and one colour per wall; depth from one photo is an
assumption (the chips say so); judge noise is about one item in fourteen to seventeen, hence the rollback margin; the studio's
photoreal renders were not part of the measured runs (the e2e used them but with a scripted model).

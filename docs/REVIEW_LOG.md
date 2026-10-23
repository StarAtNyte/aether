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


## Stage `archreal`: architecture that looks like a render, and is interactive

**What was built.** Wall coverings as World IR fields (five wallpapers, panelling, slats, per-room `finish`, per-wall `walls`, `dado`, the `set_wall` op,
`design_plan` pass-through, prompt mapping of "floral wallpaper"), named material slots for every furniture kind, recessed downlights, a mediterranean
style, garden trees and a foliage finish, openable window casements, drawers / cabinet doors / fridge doors / a tap as their own entities (`furn-part`,
`operable`, `toggle`), physical hinged doors on revolute joints, props to pick up and throw, sofas and chairs to sit on, the aim-and-use crosshair prompt
with first-person look pitch, the plan reveal, the Casa del Patio flagship, `archshots` for eye-level stills. Fixes found on the way: wide sliding doors (> 3 m)
built an error placeholder (the leaf limit was 3 m), roof plates covered courtyards, `Walkthrough` ignored ceilings with lights.

**Verification.** `tsc` 0 errors; vitest suites for every behaviour (wall finishes and dado geometry, slots, parts and their generators, operable / toggle,
joint driving, raycastAll, setEnabled, interaction decisions and controller, reveal timeline / ink / camera, headless interactive apartment: props stay on tables,
drawer slides, cabinet door swings, tap, thrown mug, casement, physical door); Playwright `e2e:interact` and `e2e:reveal` in Chromium (WebGPU, WebGL2) and Firefox
(WebGL2), `e2e:arch` after the physical-door default.

**Security review.** `furn-part` params are untrusted: `of` must be an interactive furniture id (prototype keys refused), `part` matches `/^[a-z][a-z0-9-]{0,31}$/`,
the piece params are resolved against the generator's own spec, `size` is bounded; hostile inputs are covered by tests. `set_wall` and the new plan fields are zod
schemas with bounded numbers and the same prototype-key guards as the rest of the plan. The interaction controller only acts on entities of the validated world
(ids from the physics world), the use queue is capped, and prompts render as plain text (no markup from entity names). The ink overlay cleans room labels (control
characters removed, 40 characters) and caps strokes at 1 500. Joint driving takes finite numbers only and clamps to the joint's own limits (the solver, not the
caller, decides how far a door can open). No dependency was added.

**Performance review.** Drawers and doors are separate kinematic bodies: a kitchen adds about 13 parts, a furnished apartment about 40 bodies, well inside the
1 800-entity cap (one extra stat check in `compile`). The aim ray is one `raycastAll` per frame (≤ 10 hits); the carried prop is one `setVelocity`. Downlights add
two small meshes per ceiling. Foliage masses cost 3 k to 25 k triangles per tree (bounded by a test at 60 k). The reveal rebuilds the walls 24 times in 7.5 s
(about 50 ms each on a GPU, measured; the first section pays a one-off 1.5 s clipping setup that the paper overlay hides); frame time is clamped so a slow device
slows the reveal down instead of dropping frames of ink. Software rasterizers run the e2e within the existing timeouts.

**Honest gaps.** Photoreal quality is still short of Blender for trees, terrain and far hills; the studio render's ceiling patches under a low sun are an engine issue
(logged in `docs/ARCHITECTURE.md` section 25); casement windows are single-pane (no multi-sash); the fridge was not placed in the offline apartment layouts (its
doors are exercised in the unit test); sitting has no body animation; the live AI-first loop was not re-run (the Codex subscription limit), the replay fixtures still pass.

## Stage `lookinterior`: interior and architecture look

**What was built.** The root cause of the blotchy ceilings (a banded, low-frequency normal map on the `paint` finish seen at a grazing angle under close lamps;
see `docs/ARCHITECTURE.md` section 27) and its fix with regression tests; an analytic global-illumination approximation (warm floor-bounce hemisphere light, neutral
interior fill, eye adaptation of exposure and image light) that works on every tier; full-resolution ambient occlusion; an opt-in SSGI effect (off: too noisy); hero
framing for buildings (garden side, 21 degrees, clear sight line); a first-person start inside the entrance facing doors, windows or archways (`PlayerSpec.yaw`);
flagship scenery (realistic Dusk House vegetation, a skyline that rises above the Penthouse deck, lighter fog); calmer marble; look-development hooks in `archshots`.
Screenshot rounds against the casa-serra stills and the room-from-photo montage: 15 (ceilings, AO radius/noise, bounce strength, fill, eye adaptation, GI on and
off, framing, spawn views, photo bedroom).

**Verification.** `tsc` 0 errors; unit suites for each behaviour (finish normal flatness, bounce, eye adaptation, framing helpers, entrance view incl. rotated plans,
flagship spawn and scenery, effect tiers); `npm run showcase:bake -- --check` clean after re-baking the architecture worlds; `e2e:arch` updated for the new start.

**Security review.** `PlayerSpec.yaw` is a bounded finite number (zod); the new render helpers accept untrusted numbers only through clamps or finite checks (`setAo`,
`setEnvScale`, `setInteriorFill`, `adaptedLook`, `frontAzimuthDeg`) and are tested with NaN. `archshots --world` and the `js` hook are developer tools that run only
against a local build in Playwright, never in the shipped app. No dependency was added.

**Performance review.** Floor bounce and fill are two hemisphere lights (no shadows, no extra passes); eye adaptation touches uniforms at most every 80 ms and only
when the factor changes, ceilings are cached per world change. GTAO at full resolution costs about 2x the half-resolution pass on a discrete GPU (software GPUs never
run it: tier `low`). SSGI costs a full-resolution pass, which is why it is off by default.

**Honest gaps.** No true multi-bounce GI or baked light probes: sun patches do not bleed onto walls in the way a path tracer shows, the analytic fill is room-agnostic
(a windowless room is as bright as a sunlit one for the same sun); the photo-room render is closer (neutral light, soft contact shadows, no flat fills) but the
furniture meshes and fabrics are still far from the photograph; glass keeps blended transparency with environment reflections (no refraction); the live AI
photo loop was not re-run.


## Stage `qafix`: the QA defects that are not about looks

**What was fixed** (defect numbers from the hostile QA pass, each re-verified against current main first). D1, D2, D11: the offline planner never builds a default world for a prompt it did not map; it says so, names offline mode as limited, offers examples and the connect action, reports quantities it cannot honour, and shows no token counts or model calls for offline turns; check and quality claims without a run behind them get a note (also for real-AI paths). D3: error boundaries with Retry around the app, the editor panels and every lazy chunk. D4: undo, redo and time travel are refused while the agent builds. D5: touch hints on phones, the Tweak pill moved clear of the stick, buttons and (in landscape) the camera switch. D9: the player and NPC idle poses were re-checked (no T-pose in idle; the remaining arms-out NPCs are the blocky library figures, see below). D10: when several huge scatter fields exceed the field budget no single field may take more than 45 percent, so the ground cover is not starved (the canyon world requested 1.06 M against the 1 M software-tier budget). D12: a stopped build is labelled as partial and undoable. D13: every malformed share link ends on the same error page. D14: JSON with no world fields is refused on import. D15: measured properly (below) and fixed. D16: re-checked on main: Orbital Lab has no fog any more and the Hollow Gate coins are gold with emissive; they still read pale in the software renderer (a look item). D17: the hero stage came from a hard-coded slug list that the curated gallery no longer contained, so it was empty; it now falls back to the featured templates and shows a soft wash while a picture loads. D18: blueprint marks now expire by wall-clock time as well (slow frames advanced the animation clock too little). D19: the voxel loading label no longer stays at "100%". D20: the dialog carries `role="dialog"` and `aria-modal`. CI: `fix-ci` merged, runners pinned to `ubuntu-24.04`. People: a person-like entity without a character (capsule, box or cylinder of a person's size, or a stylised library figure) gets a rigged character from the design and edit tools, a `person-without-character` review finding and a `noCharacter` verification warning.

**Memory (D15), measured.** `npm run e2e:switch`: seven worlds opened and played in one tab, JS heap after a forced GC at the home page each round. Before: 29.7, 37.8, 44.7, 51.4, 58.9, 64.5 MB (about 7 MB per round). Cause (heap snapshot, retainer paths): three's `OrbitControls` registers its key interceptors on `canvas.getRootNode()`, so once the canvas is out of the page `dispose()` removes them from the detached canvas and the ones on `document` stay, keeping the controls, their change listener, the whole `WorldRenderer` and every rig clip alive; the device-lost callback also pinned the renderer. After: 23, 25, 26.1, 28.6, 29.1 MB (about 1.5 MB per round, which is the saved project of each visit). The e2e asserts at most 3 MB per round.

**Verification.** `tsc` 0 errors; new or extended suites: worldIO, scatter-field, blueprint expiry, camera-rig dispose, offline honesty (including the stopped build), ux (hero stage), touchHints, people (core), agent people attach, physics `noCharacter`; screenshot rounds in `~/.local/share/aether/qafix/shots` (phone portrait 360x640 and 390x844, landscape 844x390, home, offline state, not-understood chat, flagships) judged against the reference stills.

**Security review.** Imports stay size-capped and guarded; the new check only adds a refusal. The people helpers read ids, names, tags and roles as plain text (word split, no eval) and the patches they build go through `applyPatches` validation like any other edit. The error boundary renders error text as plain text and offers no data. `document` listener removal touches only the interceptors the controls registered.

**Performance review.** `bodilessPeople` is one pass over the entities (capped at 1 800) after an edit and once per verification. The field share cap is evaluated once per mounted field. The blueprint expiry adds one `performance.now()` per frame while marks are shown.

**Honest gaps.** Several bundled flagships still use blocky library figures for NPCs and spectators (Kart Canyon fans, Neon Rain City pedestrians, Kyoto monks, Lantern Isles' Mira); the fallback now flags them in verification and attaches rigged characters when they are edited through the tools, but the saved worlds themselves were not rewritten because the look stages own those files. The landscape title card and HUD toast are tight but no longer collide with the controls.


## Stage `lookvoxel`: block worlds look like a shader pack

**What was done.** Block terrain no longer uses pixel-art tiles for its surfaces. 32 CC0 ambientCG materials (SHA-256 pinned in `assets/voxel-textures.json`, listed in `docs/THIRD_PARTY.md`)
are scaled to 256 px into albedo, normal and occlusion / roughness / height sheets (`scripts/voxel/block-textures.ts`, committed output in `apps/studio/public/blocks/`) and loaded as
texture arrays with mipmaps and tier-dependent anisotropy. `packages/voxel/src/pbr.ts` binds every procedural tile of a world's registry to a material (grass, dirt, sand, stone, bricks, planks,
snow, ice, lava, metal, fabric …) with a tint that re-colours the photograph towards the block's own colour, so custom blocks and wool still work; sprites, glass frames and book spines keep the
atlas (now bilinear). The terrain shader (`render/voxel/terrain-material.ts`): normal mapping from screen derivatives, per-block random texture offsets, a warm sun with cascaded soft shadows
ray-marched over a column-height texture (the meshing worker now returns 256 solid and 256 foliage tops per chunk), sky hemisphere, baked vertex AO plus the post chain's SSAO, warm torch and
lava light, GGX-style highlights and analytic sky reflections, wet shores, lake-bed caustics, grass drawn as shader blades, leaves with clumped alpha, translucency and wind, ore flecks, grass and
snow fringes, emissive lava / glowstone / flames (bloom), depth-tinted translucent water with ripples, sun glints and shoreline foam, in-scattered haze toward the sun and, on `ultra`, sun shafts
through canopies and ridges. Four shader variants (`low`, `medium`, `high`, `ultra`) follow the render tier. Animals are rounded forms with fur bump; zombies are rigged cast people (the character
system's rig, tracked by the mob group). Also fixed: D19 (the "Generating terrain" card stayed at 100 % behind a start card because only the paused fixed step could finish the load; a frame now
starts the game when the spawn chunks exist, regression test in `voxelSession.test.ts`), per-frame garbage in `VoxelLayer.flushPrebuild` (closure context allocated every frame) and in the sun
update (recomputed only when the hour moves a visible step).

**Verification.** `tsc` 0 errors; new suites `pbr`, `block-sheets` (index validation, sheet slicing, shadow field wrap), `voxel-frame` (allocation probe of the per-frame calls, tier cost table, meshing
stays in the worker), `mesher-perf`, extended `light-mesh` (column tops, mesh validation requires them), `voxelSession` (loading finishes behind a start card). Full vitest: 2422 pass; the six that failed in
the parallel run (sandbox, storage, two alloc probes, ghost run) pass alone and fail only under machine load. `npm run e2e:voxel` passes on Chromium WebGPU, Chromium WebGL2 and Firefox WebGL2 (software
rasteriser); `npm run smoke` 34/34; studio build ok. Stills: `tests/e2e/voxelshots.e2e.ts` (cameras, hour, tier, mobs, `--bench`). Honest judgement of 22 screenshot rounds on the RTX 4090 (survival world,
block village, Blockfall, castle hill): surfaces, brick and plank walls, dusk and night, water glitter and torch bloom read as a shader pack; the silhouettes are still blocks, noon light is
flatter than a hand-tuned pack (cast shadows are soft and subtle), grass tops stay a little pale, tall grass and flowers are simple, glass is the old pixel frame, there is no moon-lit water refraction.
Frame interval on the 4090 (Chromium WebGPU, 1440 x 900, uncapped): survival world low 2.8, medium 2.3, high 3.4, ultra 4.3 ms; dense village low 6.6, medium 5.2, high 10.7, ultra 14.8 ms (p95 33).
Software rasteriser (SwiftShader, same size, `low`): 745 ms per frame with the photographs, 458 ms with the pixel atlas only (the first version took 1 701 ms; anisotropy 1 and a lean shader fixed most
of it); `medium` and `high` cost 1.5 to 1.8 s there and are never chosen automatically.

**Security review.** The sheets and their index are fetched from the app's own origin, size-capped (24 MiB per image, 64 KiB index, 4 096 px edge, 64 layers), decoded with `createImageBitmap` and
validated (`parseSheetIndex` rejects bad sizes, keys, slots and colours); any failure returns null and the terrain keeps the atlas. The mesher's new `heights` array is validated by `checkMesh`
(length 512) and transferred like the other buffers; the height texture only stores bytes. The texture download script allow-lists two hosts, checks every archive's SHA-256, lists archives before
extracting and caps their size. No dependency was added; no stateful browser storage.

**Performance review.** Meshing stays in the workers (a guard test reads the worker and layer sources); the height pass is one scan per column (256 per chunk). Per-frame calls allocate nothing in steady
state (probe test). The shadow march is unrolled per tier (low 0, medium 10, high 16, ultra 22 samples) so cheaper tiers pay nothing; the height texture (512 x 512 RG8, toroidal) is re-uploaded at most
once per frame and only when a chunk changed. Changing the tier rebuilds three materials (async compile, chunks stay hidden meanwhile). Texture memory: 3 arrays of 32 x 256 x 256 RGBA with mips, about 33 MB.

**Honest gaps.** No screen-space refraction (an attempt through the viewport texture made the WebGPU pipeline creation fail in one world, so it was removed; water is translucent with depth tint and
caustics on the bed); sun shafts are a height-texture approximation (no shadow-map rays), cascades are distance cascades of one heightfield (overhangs rely on the vertex sky light); the software
path is 1.6x slower than the pixel atlas; the world's seven custom-pattern tiles (stripes, dots) and sprites use the atlas; zombie skin cannot be tinted by the cast system (clothes only); mobs other than
zombies are soft but toy-like; an obvious tiling remains on very large flat grass fields at distance.

## Stage `lookoutdoor`: outdoor look, and every character looks human or properly animated

**What was built.** Part 2 (characters): `findStandIns` lint in `@aether/core` (people, animals and vehicles shown as capsules, boxes, block figures or cube pets),
wired into the quality review as a major coherence issue; every shipped project and every planner archetype now uses rigged cast people (fans, pedestrians,
monks, the lamplighter, villagers, ghosts as pale hovering figures, enemies); library "characters" resolve to capsule plus `character` in the planner; the prompt
tells the model to do the same. Modelled, animated animals (Farm Animals CC0, Fox) are in the library. Thirteen code-authored vehicles (kart with a helmeted driver,
race cars, sedan, taxi, police car, coupe, hatchback, SUV, van, delivery van) with a visual rig (wheels roll, front wheels and steering wheel turn, body pitches and
rolls) and per-entity paint tint; Kart Canyon uses karts for the player and the rivals. Part 1 (outdoor): `environment.fog.visibility` (aerial perspective that the
content-size policy no longer erases), richer hillside colour (straw, clover, mottle), hair-fine grass blades at twice the card resolution and denser tufts, rooftop
clutter and brighter facades in Neon Rain City; outdoor flagships set a visibility range.

**Verification.** `tsc` 0 errors; full vitest 3 461 tests (core lint over all bundled worlds and nine planner prompts, vehicle rig, vehicle catalog, fog visibility,
catalog licences); studio build; look-shots rounds on the RTX 4090 (Chromium, ANGLE/Vulkan WebGL2): baseline, people and karts, outdoor look, city and temple, plus the
model contact sheets of vehicles and animals.

**Security review.** The lint reads entities only (no evaluation). `fog.visibility` is a bounded number (30 to 20 000). The paint tint takes the validated
`material.color` hex only and clones materials per entity (disposed with the content). Vehicle files are first-party and built offline; the build refuses animal
archives whose licence file or checksum differ. No dependency was added.

**Performance review.** A vehicle is about 17 k triangles in 6 to 9 draw calls (merged per node and material); the rig is a few property writes per frame and allocates
nothing. Grass cards are 512 px (one shared texture). The fog change is a uniform.

**Honest gaps.** Deer, cats, birds and other cube pets still need modelled replacements (no permissive animated source was found); the lint flags them where a
character-like entity uses them. Road cars are stylised-real (rounded bodies, no interior), not Blender-grade. Water foam and refraction were not added (the
screen-space reflection path already mirrors the shore in Sakura River); volumetric shafts and the colour grade were left to the photoreal layer. Neon facades are still
flat shapes with window layers. Firefox was not run on this machine this round.

## Stage `outdoora`: outdoor look part A (physical sky, vegetation variety, natural cover)

**What was built.** A physically based clear sky (`environment/atmosphere.ts`: single scattering by air, aerosols and ozone through a spherical atmosphere) that paints the
dome per direction for the day, dawn, sunset and night presets, and feeds the zenith, horizon, sun colour and fog colour of the sky state; sun and moon sprites (moon with
maria, craters and a phase), crepuscular rays, a second high cirrus cloud layer, cumulus clouds with self-shadowing baked from their own density toward the sun, fog tinted
by the low sun. Vegetation: every flagship except the painterly one builds with the realistic leaf-card generators (stylised oaks, pines, bushes, grass, rocks and the hero
cherry tree exchanged through `Builder.realisticNature`), new `blossom` and `flower` card kinds, a blossoming broadleaf, a `wildflowers` generator, ground cover laid out by a
cluster process, card-aware LOD levels for far trees, macro colour variation in the layered terrain. Quality tier: the low tier drops the cirrus layer and the rays.
The 38 baked worlds were regenerated (eight changed); `scripts/showcase/bake.ts` reproduces them. QA defect D10 (Canyon of Colossi bare ground) was re-verified as
already fixed by the field-share cap and got its regression test (`scatter-demand.test.ts`); D16 (Orbital Lab fog) no longer applies (`fog: null`).

**Verification.** `tsc` 0 errors; new suites `atmosphere`, `card-lod`, `scatter-demand` (render), `flora-blossom` (procgen), `cluster` (agent); full vitest 3 610 passed. Seven
failures remain, none from this stage: two `storage` and one `sandbox` test need a `WebAssembly` global in a node child process (this machine's default node 22.19 under tsx;
they pass on node 24), and the `alloc-probe` tests flake with machine load (they pick a different test each run and the unrelated sites, `static-batches`, `cluster-dag`,
`applyTransforms`, fail the same way; the sky's own update site was reduced to one position write and one `lookAt`, as before). The prompt-size cap went 15.1k to 15.2k for
the new generator and option. Studio build and `npm run smoke` (34 of 34 prompts) pass. Six look-shot rounds on the RTX 4090 (Chromium, ANGLE/Vulkan WebGL2):
baseline, sky model, vegetation swap, ground cover and blossoms, relit flagships at dawn, dusk and night, final round over eleven views. `lookshots` gained
`slug:env-<sky>-<hour>` (relight a flagship's cover view; `SHOT_CAM` sets the camera) and `render-bench` gained a sky-detail row.

**Frame cost per tier** (render-bench, Chromium WebGL2, 1920x1080, 30 frames; median ms, p90 in brackets). RTX 4090: Lantern Isles low 10.2 (14.6), medium 9.5 (11.5), high 11.4
(11.9), ultra 14.5 (16.4); Kyoto Temple low 11.8 (16.1), medium 11.8 (15.6), high 19.0 (33.4), ultra 21.9 (26.9). The sky layers added here (cirrus veil and rays) cost 0.0 ms at
that resolution on the GPU (frames are bound by the CPU and the composite pass, not by two blended layers). On SwiftShader at 960x540 (Lantern Isles) the same two layers cost
about 6 ms per frame (2.6 ms off, 8.9 ms on) in a noisy measurement, which is why the low tier, the default there, drops them; the measurement on software rasterisers is
relative only. Sky colouring is CPU work paid when the environment changes: 8 to 80 ms (the first call includes JIT and the noise table), none per frame. Firefox was not run
on this machine this round; nothing here uses features beyond what the dome already did (vertex colours, DataTexture, classic materials, additive sprites).

**Security review.** No untrusted input reaches the new code: the atmosphere, bodies and clouds take numbers from the computed sky state (turbidity is clamped, `NaN` is
tamed, tested); `blossom` and `flower` are added to the schema enum and the sandbox's material allow-list (unknown kinds are still dropped); `clusterPoints` clamps count (20 000)
and area, rejects non-finite input and is deterministic; the card LOD reads generator output that `validateOutput` already checked, tolerates malformed card sets (falls back to the
usual simplifier) and never indexes out of range (tested with a corrupted index list). No dependency or asset was added.

**Performance review.** The dome is 96 x 48 vertices recoloured only on environment change; cloud textures (256 x 256) rebuild only when the quantised cover or the sun azimuth
(15 degree steps) changes; sun, rays and moon share one billboard frame (one `lookAt` per frame, nothing allocated). Far trees get 45 %, 26 % and 14 % of their cards, grown up to
2.8 times, so a field of 100 000 trees draws a fraction of the triangles; the clustered layouts are plain `points` (same render path as the Highland Trail). The macro variation is
three noise lookups per terrain fragment, only where the layered terrain runs (not on software rasterisers).

**Honest gaps.** No impostor billboards: far trees are thinned cards, not images; cloud shadows on the ground and wet shorelines were not done (the water level is not known to
the terrain material); volumetric god rays through foliage stay the ultra tier's shadow-map shafts, the lower tiers get the sky-space rays only; the sky is baked per environment
change, so clouds do not drift and the time-of-day slider recolours in steps of a few milliseconds rather than animating smoothly; night keeps its keyed colours (moonlit sky is not
physically modelled); a world with a photographed HDRI (Highland Trail) shows that photograph as its sky instead of the dome; blossom crowns read mauve under purple dusk light
(Kyoto Temple) and peach under golden light (Sakura River); the card trees still have visible card edges at the lowest LOD of close-ups; the Kart Canyon desert scrub is a leafy
shrub, not a desert plant.

## Stage `outdoorb`: water that looks like water, real animals, ambient life

**What was built.** Water: a TSL shader (WebGPU and WebGL2) for the `water` preset with six scale classes (`waterKind`: puddle, pond, stream, river, lake, sea; inferred from size and names when
absent), four wind-driven waves plus a detail normal map, ripple rings where bodies and the player enter (the `WaterSystem`), per-channel depth absorption from the scene depth, refraction,
shoreline and crest foam, caustics, sky reflection, a bright ceiling under the surface and underwater fog and sky when the camera dips, and an opt-in planar mirror (`high`). Tiers `simple`
(software and low memory), `standard` (every GPU), `high`. `environment.wind` drives water and vegetation sway through shared uniforms. Animals: twelve code-authored, skinned and animated models
(deer, doe, cat, bird, crow, seagull, hawk, duck, parrot, fish, koi, butterfly; MIT, first-party) built with a signed-distance sculpt kit (surface nets, bone weights from flesh distance, painted
coats); the NPC deer is the model instead of a box body; the stand-in lint knows the new species and flags ball-shaped birds and fish. Ambient life: `place_level_items` role `life` (species,
count, radius) with measured placement (ground slope and water, clear air, water depth and bank distance); Highland Trail, Sakura River Journey and Lantern Isles carry groups placed the same way
(colliders off, so the verified routes are untouched), wind and flowing rivers; the other water-bearing flagships name their water kind. Bundled worlds were re-baked.

**Screenshot rounds** (RTX 4090, Chromium, ANGLE WebGL2 and WebGPU; stills in `/tmp` only): r0 baseline (flat blue plane, no animals), r1 first shader (planar reflector via three's
`ReflectorNode` filled the frame and raised "destroyed texture" errors inside the post chain: replaced by our own mirror drawn before the frame), r2 and r3 (mirror, blocky and muddy), r4 tiers side
by side (the sky reflection of `standard` beat the half-size mirror, so `high` became opt-in), r5 gentler mirror, r6 all outdoor flagships on the default tier, r7 ripples, underwater and the
life close-ups (deer on a slope, fish under a clear stream, ducks afloat). Honest judgement: the river, lake and shallow-stream looks now read as water (depth gradient, caustics on the bed,
glitter path, rings that spread); the animals read as the right animal in the landscape but are stylised-real sculpts, not scans: the cat's head and limbs are rodent-like, wings are plates, fur has no
strands. Puddles needed their own dark colours. The planar mirror is half-size and unfiltered, so it stays off by default.

**Verification.** `tsc` 0 errors; new suites `water` (26), `water-mirror`, `water-bodies`, `life` (13), `life-flagships`, `living` (sculpt kit, 12 models), extended `standins`; Node 24 full vitest
(see the run recorded with this stage); studio build ok; look-shots as above. `tests/e2e/water-bench.e2e.ts` frame intervals (median, 1600x900, 60 frames, orbiting camera): RTX 4090, Chromium WebGPU,
Sakura River: classic water 12.6 ms, `simple` 13.4, `standard` 12.4, `high` 20.3; Highland Trail: 11.3, 11.7, 12.0, 20.4. Software rasteriser (SwiftShader, 800x450, 8 frames, Sakura River):
classic 1494 ms, `simple` 1578 (+5.6 %), `standard` 1648 (+10 %), `high` 1882 (+26 %); software and low-memory pick `simple`. Firefox WebGL2 was not run on this machine this round.

**Security review.** `planLife` and the level tool validate species against a table, cap counts (24 per group, 60 per call), radii (150 m) and coordinates (zod, 5000 m), limit rays per call, and
only emit data that passes `Entity.safeParse`; the planner never evaluates input. `waterKind`, `waterFlow` and `environment.wind` are enums and bounded numbers. The models are generated offline from
code (no network, no third-party files); the sculpt kit caps its grid by the primitives' boxes. The water shaders read only engine textures. No dependency was added.

**Performance review.** The shader adds a scene-colour and a scene-depth read (copied once per frame by three) and about forty texture-free ALU terms per pixel on `standard`; none on `simple`.
Rings are twelve slots in a uniform array, expired on the CPU; the `WaterSystem` loops over moving bodies only when the world has water and allocates nothing per frame. Wind is two uniforms. The
mirror (opt-in) costs one scene pass at a quarter of the pixels (+8 ms measured). Models are 1.6 k to 13.5 k triangles (deer 13.5 k with antlers), 40 to 360 KB; the flagships add 20 to 35 animals.

**Honest gaps.** The planar mirror is not good enough to be the default (muddy, half-size, no filtering); there is no screen-space reflection of the scene in `standard` (sky only), so a bank
is not mirrored in a lake; sea waves are normals only (no vertex displacement or true swell); no foam trails behind swimmers, no splash particles, no wet-body effect; fish and birds do not react to
the player (deer do, through the NPC brain); the cat and the wings are the weakest models; only butterflies exist as insects (no bee, dragonfly); `koi` cannot be placed in the shallow disc ponds of the
themes because they have no depth (the tool says so); the Kyoto and Seasons flagships name their pond but keep no fish; Firefox was not measured; the alloc-probe and sandbox tests fail on Node 22
(they need the Node 24 the project asks for).

## Stage `groundcity`: ground, walls, distant buildings and cameras

**What changed.**
- Root cause of the stretched stills, found with a trace of the real draw: the post chain's scene pass updates once per *node frame*, and the node frame advances once per animation frame. A capture drawn in the same frame as the viewport (another aspect, a camera moved a moment ago, the very first capture) did not re-render the scene; it re-composited the viewport's last scene pass into the capture size. Every capture whose aspect differed from the editor panel (portrait-ish, 784 x 836 here) was therefore stretched horizontally by up to 1.8x (thumbnails, the AI's critique views, the shots tooling) and the first capture of a freshly opened world had nothing to composite. Captures now advance the node frame, render through a temporarily resized buffer when their aspect differs or they are larger than the viewport, wait for the first three frames and for the scene's programs to compile, and retry (up to three times) when the result is blank. `tests/e2e/capture-aspect.e2e.ts` (`npm run e2e:capture`) asserts the scene is drawn at the requested aspect for three sizes, the first capture has content and the canvas is restored; unit tests cover `captureNeedsResize`, `pixelsAreBlank`.
- Cameras: the chase boom is probed with a ring of five rays (`BOOM_RADIUS` 0.3 m) so a wall beside the boom pulls the camera in before the near plane can cut it; the pull-in is instant, the camera is re-clamped after the easing so it can never trail behind a wall when the player turns, and the occlusion ray starts 0.25 m (was 0.6 m) from the player so a wall right behind them counts. First-person eye height eases small steps (stairs, kerbs) over about 55 ms. Tests in `camera-boom.test.ts` (a wall at 2.5 m is never crossed, not even on the first frame).
- Distant buildings: a `facade` finish (4 x 4 window bays per 12 m tile: recessed glass, mullions, spandrels, blinds; the ORM blue channel marks panes) and a `skyline-tower` generator (setback volumes whose volumes stay inside the footprint below, snapped to the 3 m bay and floor so the window grid lines up, roof deck with plant rooms, tank and mast, one collider, under 250 triangles). A single shared uniform driven by the sun's elevation lights 42 % of the windows by a hash of their 3 m cell, so no tile-sized pattern repeats down a tower and day, dusk and night need no recompile. Skyline Penthouse now has 64 such towers over a street grid 40 m below (the old Kenney towers are gone), the ground skirt that used to extend the roof to the horizon is switched off (`ground.skirt: false`), and Neon Rain City's towers use the facade (the 20 000 instanced window boxes are gone).
- Ground and walls: ground and masonry finishes get macro tone/roughness patches (contrast-stretched noise), a close-up micro lookup (fades out between 1.5 and 7 m) and a distance macro lookup (fades in between 10 and 60 m), a stronger normal for plaster (2.4) and concrete (1.7), and rain: a wet-weather uniform darkens and glosses all ground and fills flat, mirror-like puddles in asphalt, concrete, paving, gravel and soil (the old purple puddle discs in Neon Rain City are removed). The layered terrain adds a micro grass lookup near the camera (Highland Trail foreground). New ambientCG CC0 finishes: `cobble` (PavingStones138), `limestone` (Bricks083), `dry-earth` (Ground102), `cladding` (Planks021), SHA-256 pinned in `assets/sources.json` and `docs/THIRD_PARTY.md`. Applied to the penthouse roof deck (stone paving), Kart Canyon (photographed asphalt with a darker racing line), Neon Rain City (wet asphalt, cobbled pavements), the village plaza and the castle courtyard (cobble), the city street theme (asphalt, paving) and Casa del Patio's grass.

**Verification.** `tsc` 0 errors; new suites `camera-boom`, `ground-detail` (render), `skyline` (procgen); `generators.test.ts` lists the new generator. Full vitest (Node 22.19, loaded machine): 3583 pass; the prompt-size budget (new generator, +60 tokens, cap 15.1k to 15.2k per the file's precedent) and the penthouse skyline test (now checks `skyline-tower` volumes and `ground.skirt`) were fixed; the two storage and one sandbox test fail only on Node 22.19 (undici wasm) and pass on Node 24, and the render allocation probes fail only under load (a different one each run, none in code this stage touches). `npm run smoke` 34/34; `showcase:bake --check` up to date; the capture e2e also passes on the software rasteriser (SwiftShader) for the penthouse. Studio build ok; `npm run e2e:capture` passes on the RTX 4090 (WebGL2) for Kart Canyon and Highland Trail; `scripts/play-shots.ts` and `tests/e2e/archshots.e2e.ts` were used for the eye-level and play stills. Screenshot rounds (RTX 4090, `/home/at-office/.local/share/aether/groundcity/r1` to `r5`, plus the play and aspect probes): r1 baseline (stretched captures, flat tan and olive ground, Kenney towers); r2 skyline kit, roof paving, ground detail; r3 aspect found and fixed, first capture black (reproduced under load) and then fixed; r4 neon facade (windows blown out, then emission cut from 2.6 to 1.1) and neon puddles; r5 eye-level walls (Casa del Patio stucco now has real relief), the penthouse skyline by day and by night (windows glow clearly), the medieval village play camera against the castle gate (never inside the wall). Honest judgement: the skyline, the roof paving, the village cobbles and the stucco read as materials; the night windows are the biggest win. Still short of the Blender bar: the Casa del Patio and Dusk House fields are still wide, even lawns seen from the aerial camera (the macro patches are visible at eye level, subtle from above), Kart Canyon's asphalt is clean rather than worn (no rubber marks beyond the racing line, no cracks), the glass towers read warm-pink at sunset because the fog and sun tint dominate, and tower silhouettes are boxes with setbacks (no crowns, no balconies).

**Frame cost (RTX 4090, Chromium WebGL2, 1600 x 900, 24 frames, the loop looks capped near 60 Hz for the heavier tiers).** Kart Canyon (1.8 M triangles): low 9.9 ms, medium 10.1, high 16.3, ultra 17.0 (p90 34). Neon Rain City (0.63 M triangles, 918 draws): low 12.6, medium 11.4, high 16.0, ultra 18.6. The ground detail (about six extra reads per ground pixel) and the facade (one extra read and a hash per window pixel) are inside the noise of these numbers; they are switched off on software rasterisers and in low-memory mode (`MaterialCache.groundDetail`, `antiTile`), where finishes keep their classic single-lookup maps, so the software path is unchanged apart from the new finishes' textures (four more 512 px JPEG triplets, about 1.1 MB, loaded only by worlds that use them).

**Security review.** No new dependency, no network at run time. The four textures are fetched from the app's own origin through the existing catalog loader (size-capped, decoded with `createImageBitmap`, failure keeps the procedural maps); the download script's allow-lists and SHA-256 checks are unchanged. `skyline-tower` takes numeric parameters clamped by its param specs (width/depth 6 to 80 m, height up to 400 m, at most four sections), draws from the vertex budget like every generator and runs in the compute worker. The capture changes touch only the renderer: the temporary buffer size is clamped by `captureSize` (16 to 4096 px), the node-frame advance reads a private field defensively and is a no-op if it is missing, and the blank-capture retry is bounded (three attempts, 1.5 s waits). `ground.skirt` is a boolean in the schema (zod).

**Performance review.** The window grid costs nothing per frame (one uniform write per environment change); the ground detail adds a fixed number of texture reads per pixel, faded out by distance (the near lookup is dead past 7 m, the far one before 10 m), and is off on the weak tiers. `boomFreeDistance` casts five rays per frame instead of one (plus one re-clamp ray), against the same raycast the chase camera already used, with module scratch vectors (no allocation; the allocation probes of the camera rig still pass alone, they fail only under machine load as before). Captures now render fresh instead of reusing the viewport's pass, so a capture costs one extra frame (about 0.2 to 1 s on the 4090 including the readback, measured in the shots logs) and a resized buffer re-creates the post targets twice; they are rare and user-initiated.

**Honest gaps.** The play camera can still end up very close to a tree it hugs (scatter layers are not raycast; the boom only sees document meshes), so a pine can fill the view for a moment. Wet puddles need the screen-space reflection tier to mirror the sky; on `low` and `medium` they are dark glossy patches. Asphalt, grass and paving still come from 512 px photographs (one tile per 1.2 to 3 m); a 1K to 2K set for the hero ground and a decal layer (cracks, oil, tyre marks, leaves) would be the next step. Window colour variety (the cyan accent windows of the old neon city) is not in the facade. Firefox was not run this round; the changes are pure node (TSL) code identical on WebGL2, and the software path does not execute them.

## Stage `imageroom2`: room from a reference photo, second pass

**What was built.** Engine gaps that repeated in the first pass, fixed once for every photo:
- *Photoreal evaluation.* `scripts/lib/gpu-room.ts` draws the room in the studio on the GPU (Chromium, ANGLE/Vulkan) from the photo camera with the still chain (bounce light, eye adaptation, AO, no depth-of-field blur); `scripts/eval-photo.ts --render=gpu` uses it for the judge, the measure and the montage (`AETHER_E2E_GPU=1` for the real card, SwiftShader otherwise), `scripts/photo-gpu-shots.ts` re-renders finished runs into `photo | first attempt | final` montages and a scoreboard. Transcripts are kept next to the run and replace a committed fixture only with `--record-fixture` (a weaker live run had overwritten one).
- *Photo-matched exposure, white balance and tone* (`packages/agent/src/photo/grade.ts`): median and spread of luminance, saturation, and a white point from the brightest near-neutral pixels, trusted only as far as there are enough of them. The render is graded like the photo before the pixel similarity is taken; the environment exposure moves towards the photo's (at most three damped steps) and the new additive `Environment.grade` (temperature, tint, saturation, contrast, exposure offset; documented in CONTRACTS.md, used by the renderer in place of the sky preset's fields) is set from the measurement (two steps, half the measured difference, within +-0.35 temperature, 0.8 to 1.25 saturation, 0.9 to 1.2 contrast). A first version without those limits drove one room to maximum contrast and another to a strong blue cast; the limits and a test for them came from that.
- *Real-world priors* (`packages/arch/src/photo/reality.ts`, applied inside `parseRoomDescription`, every repair reported): sockets and switches at their heights, pictures inside the wall and 8 to 70 cm above the furniture beneath, plants sized to the room, palm for fronds, TV that stands on nothing becomes a wall-mounted TV, bed kept out of a corner, pieces standing in each other on one wall moved apart (the smaller), floor-length windows, door heights, eye height, a throw that takes the linen colour unless described (the part's own brown runner appeared in every bedroom), and words in the labels mapped to part options (four-poster, quilted headboard, floral duvet, wire side table, zigzag rug).
- *Parts the photos needed:* bed headboard shapes (slab, panel, tufted, slats), printed duvets, four-poster canopy; round and wire side tables with height and diameter; palm plant; woven rugs (zigzag, stripes); glowing windows (`daylight`: an emissive pane in the wall reveal behind the glass; the hotel window now blows out like the photo); vaulted gable ceilings with exposed trusses (the room's level grows by the rise, a `vault` on the room, no cornice then); curtains take the described drop (to the eaves, not the ridge); a panel at a window near a corner gathers flush into the corner over the glass edge instead of being dropped.
- *Layout fit* (`packages/arch/src/photo/layout.ts`): with the camera fitted, each piece's box in the photo depends on one number (its place along its wall); a deterministic search (+-0.7 m, 5 cm steps, inside the wall, clear of neighbours, only when its own box error falls by 0.05) proposes `edit_items` moves, pieces standing on a moved piece ride with it. Recovery from a displaced table and TV cabinet is tested from synthetic truth boxes; on the hand-annotated hotel boxes it correctly finds nothing to move.

**Tests.** Grade (neutral, warm, cool, coloured wall, match, bounded steps, malformed input), pipeline (exposure and grade move towards a warm bright photo; nothing moves when the render already matches), reality (every prior, model choices never overridden), parts (bed styles, side tables, palm, rug cost and facing), vault (geometry faces down, trusses bounded, derivation, build with no checker error, curtain drop), layout (recovery, no move when right, limits, too few boxes), corner curtains, `Environment.grade` bounds, and replay of the new recorded descriptions (pd2 and the second-round hotel, pd1, modern) through the design tools.

**Live results (Claude Code backend, GPU stills; Codex hit its subscription limit at the start and, when it came back, produced a weaker run; judge noise is large: the same hotel room scored 4/18, 13/17 and 14/16 on three runs).** Second-round runs, first attempt to final, item pass rate, structural failure: hotel 11/16 to 14/16 (88 %, none; still failing the right curtain panel and the TV), modern teal 7/12 to 11/12 (92 %, none; the palm frond was not described), pd1 12/20 to 12/20 (60 %, none), pd2 9/22 to 14/22 (64 %, structural: the vault and bed). Measured agreement (framing and pixel similarity) 52 to 64 %. So the 90 % bar was reached on one photo of four in one run, not as a reliable rate. Scoreboards and montages: `~/.local/share/aether/imageroom/round2/final/` (live runs in `live3`, `live4`, a Codex run in `codex-try`).

**Security.** The description fields added (`glow`, `daylight`, `vault`, bed, rug and table options) are zod-bounded (colours are `#rrggbb`, numbers clamped, trusses at most 14); the new geometry is bounded (a truss run is under 2 500 triangles, a palm under 60 000, rug bands are a few dozen quads). `applyReality` and `fitLayout` only read the validated description and the built scene and emit moves that go through `edit_items`, which audits them. `Environment.grade` is a bounded optional object. The GPU script starts the server and the browser it owns and closes them in a `finally`; the photo goes only to the user's chosen assistant as before. No dependency was added.

**Performance.** Grade estimation works on a 64-column grid (about 4 000 pixels); the layout fit evaluates a few dozen shifted boxes per candidate piece on precomputed geometry (milliseconds); GPU stills at final quality take a few seconds each, 5 to 10 model calls and 2 to 3 minutes per photo in the live runs.

**Defects of the early QA report re-verified.** D3 (white page offline, now an error boundary) and D4 (undo during a run) are already fixed on main; the others are outside this stage and were left to the stages that own them.

**Honest gaps.** The model's judgement is the weakest link: one run's verdicts disagree with the same room the next time, and it sometimes edits a good room into a worse one (a rollback margin limits this, not eliminates it). Rooms still have one rectangle and a gable at most (no hips, no sloping walls); the pd2 four-poster is a mid-room piece the model placed from a distant view and its depth is a guess; patterned throws and a leaf print on cushions are single colours or the floral print at a wall's scale; a palm frond that is described is built, one that is not described is not invented; the TV of the hotel stays a cabinet with a TV rather than the photo's wall bracket; sunlit views through windows are a flat glow, not the street. Firefox was not run for the GPU stills (they use the Chromium path); the photo e2e covers Chromium and Firefox.

## Stage flagaction: action, city and story flagships, first-minute polish

**Scope.** hollow-gate, kart-canyon, neon-rain-city, kyoto-temple, orbital-lab, chain-reaction. Eleven capture rounds (GPU Chromium on the RTX 4090 for rounds 1 to 3, then software-GPU Chromium WebGPU/WebGL2 and Firefox WebGL2, because an unrelated training job took the card's memory from round 4 on; the software path renders the same scene, so look decisions held). Captures are under `~/.local/share/aether/flagaction/r1` to `r10` (before: `r1`; after: `r5` to `r10` and the covers in `docs/screenshots/showcase`). The studio shots read `apps/studio/dist`, so every round rebuilt (`npm run build`) or copied the re-baked worlds into `dist/templates/worlds`.

**Fixed (engine and generators).**
- Live play stands the spawn point on the floor under it (`CharacterController` option `settleSpawn`, set only by the studio's `Simulation`; headless runs keep the exact document spawn so recorded proofs replay unchanged). The 1 m drop at the Hollow Gate spawn showed the airborne pose, arms thrown out sideways, for as long as the frame took (QA D9, a T-pose on a slow machine). Tests: settles on the floor, keeps a deliberate 4 m drop, settles onto a platform under the spawn, does nothing unless asked.
- Round primitives scale their facets with their width (`circleSegments`): a 44 m station deck and its 45 m ring were 24-sided polygons.
- House windows at night: a share of windows dark, curtains and a pelmet at the lit ones, no extra draws from the generator's random stream (so nothing else in a house moves).
- A code-authored grey wolf (smooth skinned body, idle, walk and run clips, MIT, `scripts/assets/living.ts`) replaces the faceted fox for wolf packs; the other creatures' files were left alone (regenerating them changes their hashes, so only the new entry was merged into the catalog, living and manifest files).
- `roadRibbon` in the showcase kit: one continuous asphalt mesh with the racing line blended in, and curbs in whole stripes that close around the loop. The row of boxes it replaces left wedges of sand open at every bend of Kart Canyon.
- Held torches no longer put their point light at the chest (a torch bearer was a white silhouette); the stall lantern no longer lights its own awning.
- The three racing karts' drivers wear coloured suits (they were near-black silhouettes under the white helmet); they are still a stylised figure, not a Rocketbox person.
- Lit windows are individual panes with their own strength and tone (Chain Reaction's dusk gradient, Neon Rain City shopfronts with a dim transom, Hollow Gate houses); car lamps are pairs.

**Fixed (worlds).** Kart Canyon scrub follows the canyon's meander (a fixed strip crossed the road), gantry and stands keep the earlier rebuild; Hollow Gate cover shows the stall, the fire, Mira and the guard; Chain Reaction gains a tinkerer and a spawn clear of the columns and is now bot-playable (verified, sealed); Kyoto shrines are gabled with lattice doors, a rope, streamers and an offering box and the halls have shoji lattice; Orbital Lab hull is satin composite, not chrome, and the moon is smooth; steel in Chain Reaction no longer carries the brown finish.

**Verified.** The verified-playable bot wins and the sealed run checks out for hollow-gate, neon-rain-city, kyoto-temple, orbital-lab, chain-reaction (and highland-trail, lantern-isles, painterly-meadow, four-seasons-garden); Kart Canyon is covered by its three-lap drive in `showcasePlaytest.test.ts`. Firefox WebGL2 captures of all six covers render correctly (`SHOT_BROWSER=firefox npx tsx tests/e2e/lookshots.e2e.ts <dir> <slug>...`).

**Security.** No new input paths; the spawn probe is one bounded ray (0.3 m up, 1.8 m total) against the world the player is already in; `circleSegments` is clamped (24 to 96) for any finite or non-finite size; generated meshes are built from constants and capped sample counts (road ribbon about 600 rows). No dependency added.

**Performance.** Chain Reaction +55 small panes and Kart Canyon scrub in 44 strips (was 4) bake to 133 KB and 513 KB; the kart road is two meshes instead of about 300 boxes (fewer draws); wide discs go from 24 to at most 96 facets; the shop panes add about 100 unlit-cost entities to Neon Rain City.

**Honest gaps.** The GPU captures after round 3 are software-GPU; no GPU re-shoot of the final worlds. Orbital Lab's deck is flat grey and the pods read as clean white eggs; Kyoto's lawn is a flat plane with tufts (there is no ground relief option and the temple is placed at y = 0); Hollow Gate's ground is flat; the Kart Canyon grandstand is one tier id (`grandstand-1`) with the rest of the stand not parented to it, so "move the grandstand" moves one terrace; coins are still disc-like at night; people in architecture interiors are another stage's.

## gpupath: the default Chrome WebGPU path as good as WebGL2

See `docs/WEBGPU.md` for the design, the audit and the frame costs.

**Done.** Standard and high water run on WebGPU through a scene backdrop pass (scene without the water, single sample, depth texture) instead of a depth copy from the multisampled canvas. Layered terrain is full quality under the sampler limit through three texture arrays (the compact mode is removed). Adapter and device acquisition retry with back-off and a per-request timeout, request all usable features and the adapter's limits, hand the device to three, and record a `BackendReport` shown in Settings; a null adapter falls back to WebGL2 with a logged reason. Parity tool and backend e2e added; the audit on the RTX 4090 found no failing effect and no graphics error on WebGPU.

**Security.** The adapter, limits and features come from the browser's own objects and are only filtered against fixed name lists; requested limits never exceed the adapter's. Event lines are capped (24 lines, 160 characters each) and contain no user data. Retries are bounded (3 rounds, 4 s per request, 6 rounds at most). The new e2e tools start and stop their own server and browser in a `finally`. No dependency was added.

**Performance.** WebGPU is equal or faster than WebGL2 in every tier measured except standard water, where the backdrop pass draws the scene a second time (about 4 to 8 ms at 1600x900 on an RTX 4090); the backdrop is only drawn when a standard or high water material exists and is skipped otherwise. Terrain now samples three arrays instead of twelve textures (fewer bindings, same lookups). Start-up gains up to about 0.5 s only when the first adapter request fails.

**Honest gaps.** Device loss while running is recovered on WebGL2 through the existing restart path; it was not forced in an e2e (a destroyed device is not reported as lost by three). The backdrop pass uses full-resolution scene materials rather than a depth-only material, so alpha-tested foliage over water is exact but the cost is a full scene draw. Firefox was not run on WebGPU (policy keeps it on WebGL2); the terrain arrays use the same path there and the unit suites pass. Screenshot rounds: the highland-trail and sakura-river pairs in `/tmp` were compared against each other and show no visible divergence; no render look was changed.

## Stage `flagnature`: flagship polish, outdoor games

**What changed.** Five featured projects (Highland Trail, Lantern Isles, Sakura River, Painterly Meadow, Four-Seasons Garden) judged from GPU stills (RTX 4090, Chromium; WebGL2 through ANGLE/Vulkan; the WebGPU path through SwiftShader for the software-GPU check) over twelve rounds, and the highest-impact causes fixed at the engine, generator and world level.
- *Clouds* (`cloud` generator): many overlapping smooth puffs with cauliflower relief, a rounded belly and a sunlit-crown to blue-grey-underside gradient replace faceted blobs (Lantern Isles gets a stratus floor and cumulus banks, the meadow's sky and the steam puffs benefit too).
- *River valley* (`terrain` variant 4): a flat, walkable floodplain beside the water (under 8 degrees), a 0.7 m waterline lip so the 0.38 m water has an edge and trees never stand in it, valley walls further out, wet pebbles only just above the waterline. Before, the banks were 40 degrees for the first 14 m: the Highland camp, fire and spawn stood on a dark cliff strip and nothing flat existed.
- *Draped meshes*: `groundRibbon` (a worn trail as one mesh, five samples across, so it follows cross-slope; the old row of pitched boxes floated and clipped on hillsides as pale slabs) and `railTrack` (ballast, a sleeper every 0.7 m, two steel rails, as two meshes) with `Builder.mesh`. A real defect found on the way: the offline planner chunked `apply_patches` by patch count only, so a plan with large mesh assets exceeded the tool's 600 000-character limit and silently built an empty world; it now chunks by size too (`chunkPatches`).
- *People and props*: character `pose: "sit"` and holds `paddle` and `backpack` (a rucksack worn on the spine bone; the satchel is no longer a box). Sakura River's canoe is a modelled hull (`boat` variant 3, outer and inner skin, gunwale, thwarts, seat, slats; riding the water, weightless) with a seated paddler who strokes when the boat moves; Highland's hiker wears a rucksack. The jump and fall poses no longer throw the arms out like a T-pose (the upper arms are eased in by up to 44 degrees while airborne; QA defect D9).
- *Water*: each of the four summed waves is domain-warped, so crests bend and merge instead of reading as parallel stripes (both Sakura River and Highland Trail showed them). Fireflies are 0.13 m (they were 0.24 m glowing orbs from an aerial camera).
- *Worlds*: Highland Trail (new trail, camp on the floodplain, a footbridge as long as the river is wide, river sensors that cover the whole wet width and both ends of the valley so the bridge is the only way over, stakes and summit further up the walls); Four-Seasons Garden and Painterly Meadow became walks (third-person player, four people each with a line of dialogue, stops and a goal that a rule switches on; bare winter trees via `tree-broadleaf` `leaf: 0`, snow drifts, hedges with the foliage finish, meadow grass and wildflowers up to the hedge; the meadow got the draped railway, panelled coaches with windows, a station with edge, bench and lamps, realistic trees, sheep and cows from the life planner, a warm grade through `Environment.grade`); Sakura River got a stronger ambient. The verified bot now plays both new walks (a rule that enables a goal makes what it reads required).
- QA defects of the early report re-verified: D5 (touch hints on phones) is already fixed on main; D8 (voxel NPCs in Lantern Isles) is gone, Mira is a Rocketbox person; D9 fixed here; D17 to D20 and the interior ones belong to other stages.

**Tests.** New suites: `procgen/test/flagnature` (smooth cloud, canoe, bare tree, floodplain slope and waterline over 26 sample rows), `agent/test/flagnature` (ribbon drape, order, winding, no physics; the railway's gauge and sections; Highland trail as one mesh; canoe and paddler; both walks; chunking; cloud sea), `render/test/character-props` (backpack, paddle, spec fields, `lookFromText`), `render/test/arm-relax` (the bone turn is exactly the world delta about the model's axis for any parent and model orientation). Changed: `gamesVerified` now has the bot win Painterly Meadow and Four-Seasons Garden, the fine-edit case for "make the animals slower" names the new sheep and cows, the cloud triangle budget. Full vitest on Node 24: 336 files, 3800 tests pass; `tsc` 0 errors; studio build ok; `npm run smoke` 34/34; `showcase:bake --check` up to date; `npm run e2e:showcase` (every featured template opens from its saved world and plays, Chromium then Firefox WebGL2) passes; the five covers also render on the software WebGPU path (SwiftShader, `soft/` captures); `tests/e2e/gameplay.e2e.ts highland-trail` on the GPU: won in 90 to 105 s of real time through the on-screen controls (the bot: 79 s; before this stage the real-time run had to be retried and the bot's own route went around the end of the river).

**Security.** No new dependency, asset or network use. `groundRibbon` and `railTrack` take numbers from world code (clamped sizes, at most 65 536 vertices per mesh, encoded through `encodeMesh`, which validates ranges and sizes); the new `pose`, `paddle` and `backpack` values are enum members of the existing zod schemas; `leaf` and the canoe variant are bounded generator params; the chunker only splits what the planner already produced.

**Performance.** Clouds: 4 to 13 k triangles each (20 to 40 per world; the old ones were 500). The railway is about 14 k triangles in two draw calls where the old line was 190 box entities; the trail is one mesh of about 2 k vertices. The water warp adds eight sines per pixel on the `standard` and `high` tiers only (the `simple` tier used on software rasterisers has no wave shader work). Airborne arms and the paddle stroke are two bone updates per character per frame, only while airborne or paddling. Template size: Painterly Meadow 784 KB (it was 483 KB; the mesh track), the others within 20 %.

**Captures.** Before: `/home/at-office/.local/share/aether/flagnature/r1`; after: `.../final` (covers and play stills of all five, RTX 4090 Chromium WebGL2), `.../soft` (software WebGPU), `.../gameplay` (the real-time win run), rounds r2 to r12 and p1 to p4 in between.

**Honest gaps.** Sheep and cows are still the small library models (612 and 796 triangles, flat colours), the weakest creatures left in these five; the tent, bench and campfire at the Highland camp are low-poly props; the far mountains are generic pale cones; the blossom crowns read plum on their shaded side under the sunset; the paddler's stroke is a two-bone swing, not an authored paddling clip and the canoe has no wake of its own beyond the water's ripple rings; the first Highland view still has no hiker in the cover frame; the lattice pattern of the rock texture is visible on a boulder at one metre; the cover cameras are shared with the other flagships' tuning in `tests/e2e/support/showcase-cameras.ts` and unchanged; Firefox was run only through the showcase e2e below.

## Stage `flagarch`: architecture and voxel flagships

**What changed.** Casa del Patio, Dusk Lake House and Skyline Penthouse got real landscape (a terrain `estate` variant with a level plot, hills, lake basin and drive, groves of real trees, meadow kept off the cover frames), residents and guests who live in the rooms (`BuildingPlan.residents`, `set_residents`; spots measured 0.62 m from walls, 1.55 m from doorways, 1 m off door-to-door lines, so nobody blocks a door), a penthouse guest, a plan `spawn`, and a walkthrough bot proof for the three houses (`apps/studio/test/flagshipWalkthrough.test.ts`). Blockfall: village start clear of houses facing the well, hillside terrain, the name on the skyline, half-metal block shading. This pass (after merging the nature and WebGPU stages): a real defect in Blockfall play was found by capturing on the RTX 4090 at the start frame. While the start card holds the fixed step, the camera read the last *sampled* input (yaw 0, north) instead of the heading chosen at the spawn, so every first frame looked at whatever stood north of the player (a lamppost and a wall a block away) and the authored village heading was ignored until the first step. The play camera now reads the live look (`VoxelInput.pitchRad`, `yawRad`), and a fresh start also turns away from a blocked view (`openestYaw` in `@aether/voxel`: nine rays over about 70 degrees at knee, chest and eye height, harmonic mean so a near wall on either side counts, the preferred heading kept when open for 10 blocks).

**Verification.** `tsc` 0 errors; full vitest on Node 24: 345 files, 3852 tests pass (new `open-yaw.test.ts`, earlier `residents`, `clear-start`, `keep-clear`, `flagshipWalkthrough`, terrain estate); `npm run smoke` 34/34; `showcase:bake --check` up to date after the merge; studio build ok. Captures (RTX 4090, Chromium WebGL2, `~/.local/share/aether/flagarch/`): rounds `r1` to `r14` (covers `r11`, Blockfall start `r12g/play1.png`, mob close-ups `r13`, Firefox WebGL2 Casa cover `r14ff/cover.png`). Firefox WebGL2 renders the Casa cover with the landscape, trees and residents. Honest judgement: Casa del Patio, Dusk House and the Penthouse read as architecture in a landscape or a city (cutaway covers, people in rooms, real hills, cobbled roof, lit towers); the foreground meadow of Casa still shows a visible tiling pattern from the aerial camera, the Dusk House cover keeps a floating exploded upper storey by design, and none of this is Blender-render quality yet (materials are real PBR, lighting is real-time). Blockfall now opens on the square with the well and the name; its mobs are soft rounded animals with fur bump and the zombie is a rigged animated human (ragged clothes, hurt stance), but the zombie reads as an ordinary person in a jacket, not undead, and the pig is a blob with limbs.

**Security.** `openestYaw` is pure, bounded (steps clamped 4 to 72, range 24, nine rays per heading) and only reads loaded voxels; residents come from a zod-validated plan field (0 to 8) and are ordinary entities that pass `Entity.safeParse`; the estate terrain parameters are bounded numbers. No dependency added.

**Performance.** The heading search runs once per fresh start (at most 25 headings x 9 rays x 3 heights of DDA over 24 blocks, well under a millisecond); the camera now reads two numbers instead of the sampled struct. Residents are NPCs on the existing runtime (about 1 to 4 per house).

**Honest gaps.** The `lookshots :play` path on the real GPU captured black once for Blockfall (the same world captured through a hand-driven play session is fine, and the software path is fine), so the play stills here come from a direct probe, not that script; the cause was not isolated. The medieval-village scene and the photo bedroom were not touched. WebGPU (as opposed to WebGL2) captures were not possible in headless mode on this machine (adapter unavailable), so WebGPU parity rests on the earlier stage's measurements.

## Photo-to-room: steady fidelity (deterministic measures, a judge panel, a relative gate)

**Problem.** The compare loop decided progress on one vision call's absolute pass rate. That number is noisy (the same room passed and failed the same item on consecutive rounds: `item-fl-1` and `item-floorlamp-1` flickered in two of the baseline runs below), so a lucky round became the "best" and later real fixes were rolled back, and stall detection stopped runs on flicker rather than on a lack of progress.

**What changed.**
- `measureFidelity` (`packages/arch/src/photo/fidelity.ts`): deterministic measures of the built room against the description, plus the render-side measures the host makes: openings (per wall, kind, centre, width, sill and head), inventory (F1, a re-placed piece of the same kind counts 0.8), placement (plan and height error, 1.2 m to zero), sizes (room and described params, relative error), materials (CIEDE2000 per visible wall, floor, ceiling and colour param; `colour.ts`, checked against the published Sharma reference pairs), clearance (the checker's geometric findings), framing, pixel similarity and region colour (ΔE inside each described box, photo vs graded render). Weighted sub-score, formula and weights in the module header and CONTRACTS.md. Snapshot `tests/fixtures/photo/hotel.fidelity.json`: the faithful hotel build scores 0.994 (the one issue is the armchair partly in front of the window, as in the photo).
- `photo/judge.ts`: a panel of N stateless critic calls (default 3; the studio uses 1 on a paid key), fixed system prompt and rubric (0..4, evidence required or the verdict is dropped), the clean photo-camera view every round, `temperature: 0` and a fixed seed per seat (honoured by the Chat Completions provider, which stops sending them after a 400 that names them; the Claude Code and Codex CLIs take neither), median per item. From the second look each seat sees the accepted render and the new one blind as A/B (alternating order), scores both and votes.
- `decideRound`: accept only if the sub-score does not fall by more than 0.015, no structural measure by more than 0.04, and the judges prefer the new state (a tie needs a measured gain); a rejected state is reverted before the fixing model sees the round, and it is told why. `ProgressTracker` stalls on no accepted, measurable progress for `stallRounds` rounds. `judges: 0` keeps the conversation model as the judge (now also gated by the sub-score).
- The fixing model gets the consensus (median score and evidence per failing item) and the largest measured differences each round. The studio shows judges, measured fidelity, overall, the per-measure line and "not kept".
- `scripts/eval-photo.ts --judges=N` records judge, measured and combined per round; `scripts/photo-judge-noise.ts` re-judges one fixed room to measure the judge's own spread.

**Tests.** Fidelity: determinism (same world, a JSON round trip, a rebuild), snapshot, a removed piece, a 0.3 vs 0.9 m move, a repainted wall, weights. Judge: A/B mapping, evidence rule, median, vote and paired-difference preference, the gate's every branch, the tracker, parallel stateless seats with fixed seeds and alternating order, a failing seat. Seeded noisy-judge simulation (a per-call mood plus per-item wavering, 200 runs of 10 rounds): pass-rate spread of one unchanged room 0.153 for one judge vs 0.093 for the median of three, items flipping between looks 3.46 vs 2.37; in the simulated loop good rounds rolled back 29 % vs 7.5 % of rounds, mistakes kept 3.6 % vs 1.2 %, false stalls 175 vs 22, true final quality 0.53 vs 0.63. Pipeline: the panel judges first, a preferred fix is kept, a non-preferred one is reverted before the model sees the round, the measures veto a removal the judges liked, and a silent panel falls back to the conversation judge.

**Live runs (hotel bedroom, Claude Code, medium effort, software renders, 5 rounds).**
- Before (old loop, 3 runs plus one replacement for a run the backend broke): final item pass 9/17 (53 %), 12/18 (67 %), error, 12/18 (67 %); 6 to 8 calls, 95 to 143 s. Within runs the pass rate went 67 → 61 → 67 % and 61 → 67 → 61 → 67 % on rooms that barely changed, and one run stopped as "stalled" at round 3.
- After (panel of 3): 18/18 (100 %, judges 79 %, measured 82 %), 14/18 (78 %, 69 %, 82 %), 10/18 (56 %, 60 %, 78 %); 21 to 25 calls, 172 to 240 s. In every run the reported score never went down: 61 → 72 → (rejected) → 78 → 100 %, 56 → 61 → 61 → (rejected) → 78 %, 44 → (rejected twice) → 56 → (rejected) %. Measured fidelity of the final rooms: 0.82, 0.82, 0.78 (spread 0.02).
- Judge noise on one fixed room (the first baseline's final world, 3 repeats): the old conversation judge, asked alone, gave 1/17, 2/17, 1/17 (sd 0.028), while in the run it had given the same room 9/17: it is context dependent as well as noisy. The panel's pass rate was 41, 59, 47 % (sd 0.073), its median rubric score 57, 62, 59 % (sd 0.018). Shown the same render as A and B, all three judges said "same" (a tie, so no false progress).

**Honest gaps.** End-to-end variance across runs is NOT reduced: the after runs ended at 100, 78 and 56 %, the before runs at 53, 67 and 67 %. Most of that spread comes before the loop (each run reads the photo into a different description and checklist: 16 to 18 items, different pieces) and from what the fixing model manages; the loop is now monotone and its decisions are reproducible, but it cannot make a weak description good, and 5 rounds ran out on a run that was still improving. The absolute panel pass rate still moves by up to 18 points on the same render (items sitting at the 3/4 boundary); decisions do not use it, they use the A/B comparison and the measures. The fidelity measures compare against the description, so a correct fix that departs from a wrong description costs a little placement or colour (small moves fall well inside the tolerance; a move to another wall would be refused). Three judges triple the compare calls (21 to 25 instead of 6 to 8 per run). Temperature and seed are not available on the CLI backends used here. `apps/studio/test/editGuard.test.ts` ("make the tower I just moved taller") fails on main before this change as well.

**Security.** Judge answers are untrusted: zod-parsed, ids must be checklist ids, scores clamped to integers 0..4, evidence 3 to 400 characters, at most 160 verdicts; `seed` is validated on the wire (integer, 31 bit). The measures only read the validated description and the document; region colours read rasters already bounded by `isRaster`. No dependency was added.

**Performance.** `measureFidelity` runs once per render (scene read, the fast checker and one `deriveBuild`; a few milliseconds on the hotel room); the panel's seats run in parallel, so a round costs about one judge latency more than before.

**Verification.** `tsc --noEmit` 0 errors; vitest on `packages/agent`, `packages/arch`, `apps/studio`: all pass except the pre-existing `editGuard` case; studio build ok.


## Photo-to-room: a steady reading of the photo (independent reads merged), no round cap on a subscription

**Problem.** After the judge panel the compare loop improved monotonically within a run, but final scores across three runs were 100, 78 and 56 %. Most of the spread came before the loop: each run read the photo once, and that one reading (16 to 18 checklist items, its own compass frame, its own positions) was the description, the checklist and the yardstick of the run. Two recorded reads of the hotel photo put the window on the north wall and on the west wall. The loop cannot repair the description it is measured against. The compare loop also stopped at round 5 while still improving: the eval script defaulted to 5 rounds, and the pipeline itself had a default of 6 and a hard cap of 12, which went against the rule that a subscription run ends on agreement or a stall, never on a round count.

**What changed.**
- The photo is read `reads` times (default 3; the studio uses 1 on a paid key, the same policy as the judges). The reads are independent, stateless and run in parallel, at temperature 0 with a seed per read where the API takes them.
- `@aether/arch/photo` `consensus.ts` (pure, deterministic, independent of the order the reads arrive in): `clusterReads` sorts the reads canonically and picks as anchor the read that agrees most with the others. It turns every read into the anchor's frame by quarter turns: things matched by their photo box vote with their walls, and the camera heading breaks ties. It then matches openings and pieces within a kind class (a nightstand and a "side table" read as a coffee table are one piece) by photo box, or by plan position as a fraction of the room. `consensusDescription` keeps the clusters a strict majority saw. Kind, placement mode, wall and references are decided by majority. Positions are the median fraction of the wall or room, sizes the median, and colours the CIEDE2000 medoid (a colour some read actually gave). Ids are canonical (`bed-1`, `art-2`, `window-1`, in photo order). A piece whose host was dropped is dropped too and reported. The result is validated and repaired by `parseRoomDescription`, and the checklist is `buildChecklist(consensus)`, so the same consensus always gives the same checklist.
- One `reconcile_room` call (`packages/agent/src/photo/reconcile.ts`) sees the photo and only the contested clusters: below the majority, or kept without every read. It may add a cluster some read saw or drop a kept, non-unanimous one, each with a reason. Unknown keys, unanimous pieces and reasons under 12 characters are ignored, and with no usable answer the majority stands.
- The `described` event carries `reads` (pieces per read, consensus, checklist size, dropped, contested, reconciliation reasons) and says it in words. A shell the builder refuses after a merge is corrected in a new conversation that carries the photo and the merged description.
- Rounds: `maxRounds` unset means no fixed cap. The loop ends when every item matches, the model stops with nothing to change, or `ProgressTracker` sees no accepted progress for `stallRounds` rounds. `PHOTO_ROUNDS_CEILING` (200) only stops a runaway. The studio caps paid keys at 10 (it was 4). The eval script has no round default (`--rounds=N` sets one) and gains `--reads=N` and `--reconcile=0`. `scripts/photo-consensus-probe.ts` merges recorded reads offline; on the three recorded hotel reads it found the rotated frame (3 quarter turns) and kept 11 pieces and 1 window.

**Tests.** `packages/arch/test/photo-consensus.test.ts`: median, mode and medoid helpers; frame rotations (round trip, inverse found from boxes); three divergent reads (a plant seen once is dropped, a TV missed once is kept, the side table read as two kinds is one piece, room width and bed position are the medians, the colour is the medoid, references follow the canonical ids); reads in other frames; determinism and order independence of the consensus and its checklist (also after a JSON round trip); reconciliation choices (add, remove, never a unanimous piece); orphans; a single read. `packages/agent/test/photo-reads.test.ts`: the pipeline with three scripted reads (stateless, temperature 0, seeds; one reconciliation call that gets the photo and the contested keys only; the plant added with evidence, a reasonless removal ignored). It checks that the checklist the loop judges equals `buildChecklist` of the independently computed consensus, that two runs whose reads arrive in different orders get the same checklist, `reconcile: false`, and the case where only one read was usable. It also runs a panel loop that keeps going past 12 rounds while the judges prefer each new state and stops on the stall, and checks that a paid key keeps its cap.

**Live runs (hotel bedroom, Claude Code, medium effort, software renders, 3 judges, no round cap; interleaved after/before; `~/.local/share/aether/imageroom/consensus/`).**
- After (3 reads merged): pieces per read 12/11/13, 13/13/11 and 12/12/13. Consensus 13, 13, 13 pieces, checklist 18, 18, 18, with the same canonical ids across runs (the reconciliation brought one piece back in two runs). Final 15/18 (83 %), 15/18 (83 %), 18/18 (100 %); measured fidelity 80, 81, 79 %; combined 74, 77, 80 %; 6, 9 and 4 rounds; 32, 41 and 21 calls; 259, 290 and 147 s.
- Before (1 read, same code otherwise, also uncapped): description 11, 13 and 12 pieces, checklist 17, 18, 18. Final 14/17 (82 %), 16/18 (89 %), 18/18 (100 %); measured 84, 73, 83 %; combined 77, 74, 79 %; 6, 6 and 7 rounds; 28, 25 and 29 calls.
- Spread (population sd). Description pieces 0.82 to 0; checklist size 0.47 to 0; measured fidelity 0.048 to 0.008. Final pass rate 0.073 to 0.079 and combined 0.021 to 0.024 (no change). The earlier 5-round runs ended at 100, 78 and 56 %.
- How runs ended: in both groups, every item matching (2 runs), the model stopping with nothing left to change (2), or a stall (2). None stopped on a round count.

**Honest gaps.** The reading is now steady: the same pieces, the same checklist and close measured fidelity in every run. The final pass rate is not steadier on this sample. Three runs per arm are too few to tell 0.073 from 0.079, and the items that still fail differ from run to run (the window, the TV and cabinet, the two pictures), which points at judge noise near the pass boundary and at what the fixing model manages, not at the description. The uncapped single-read runs were already better than the capped runs of the last section, so lifting the round cap explains most of that 56 % run. Three reads add 3 calls plus at most 1 reconciliation call per run. Kind can still differ inside a class from run to run (`chair-1` in one merge, an armchair in another), which changes an id. Temperature and seed are not honoured by the CLI backends, so reads differ only by sampling. `apps/studio/test/editGuard.test.ts` ("make the tower I just moved taller") passes on current main, at e1985b5 and at 61e7b26, on Node 20, 22 and 24, alone, with the studio config and in the full suite (355 files, 3957 tests). I could not reproduce the reported failure, so nothing was changed there and no commit on main touched it.

**Verification.** `tsc --noEmit` 0 errors; vitest `packages/agent`, `packages/arch`, `apps/studio` 156 files / 1650 tests pass; full suite before the change 355 / 3957 pass; studio build ok.

## Acceptance: a first-time user through the studio UI

**Method.** The built studio was served by the server with local AI on, and driven by Playwright in Chromium (real Intel GPU over ANGLE GL-EGL, WebGPU available), with a Firefox spot check. Every scenario ran from prompts only, offline and with Claude Code on this computer, and every screenshot was looked at:
- a night-forest game (build, three chat edits, the verify badge and replay, keyboard play, share link and game zip opened in fresh contexts);
- a two-storey house (walkthrough, play-mode doors, windows and residents, three targeted edits, undo);
- a room from a bedroom photo;
- a voxel survival world and Blockfall;
- Highland Trail on an iPhone 13 viewport;
- Spanish, Japanese and German prompts offline.

The defect list with repro steps and screenshots is kept outside the repo (`~/.local/share/aether/qa/acceptance-report.md`).

**Fixed (21 defects, each with a test).**
- First-run "Continue offline" now pins the offline planner. Before, a signed-in Claude Code answered anyway.
- Playtest self-repair handles losing to enemies. It tries slower, softer-hitting enemies one step at a time and applies only a step the bot then wins. It covers named enemies and guard, predator and sentinel archetypes.
- The offline planner honours collect-and-reach prompts: lanterns, a torii shrine goal that opens when everything is collected, and no clock unless one is asked for. A game is named after what you play. The villa follows the bedroom count and "people living in it".
- Chat edits:
  - "onto" and "put the X on the Y" are moves.
  - Characters' walking and running speeds are editable, and irregular plurals are understood ("wolves").
  - "the front door" colours the door leaf.
  - "the painting" no longer matches door frames.
  - Offline, an edit that names something absent gets a plain answer instead of a random added scene, and the thing before the place is added ("a bridge over the river").
  - Offline never says "Done — removed art" when nothing visible changed.
- Architecture:
  - Furniture keeps a 0.8 m walkway round stairs and stairwells. A landing sideboard had made the home page villa fail its walkthrough.
  - The building check climbs a stair only where its top step lands on open floor, and no longer waves through upper floors that no stair reaches. It agrees with the walkthrough bot now.
  - A second window on a wall joins the first instead of vanishing, and unplaceable windows are reported.
- Agent review requests stay within the four-image limit. Six review views had made Claude Code reject the fix round and fall back to the offline planner.
- A walkthrough replay is shown inside the building (a cutaway with the storeys apart) instead of a close-up of the roof.
- A room rebuilt from a photo is named after the room and drops the starter's outdoor weather.
- Overlaps fixed:
  - the navigation hint over the replay clock;
  - the "Talk to" prompt under the walk legend;
  - the Tweak pill over the voxel hotbar;
  - the check pills over the camera tabs on phones;
  - the proof seal over the building bar.

**Verification.**
- `tsc --noEmit`: 0 errors.
- Full vitest: 359 files, 3978 tests pass.
- Studio build ok; `npm run smoke` 34/34.
- `e2e:verified`, `e2e:arch` and `e2e:refine` pass in Chromium and Firefox.
- Re-run through the UI after the fixes:
  - Offline: the night-forest game is "Verified playable" after an enemy repair, and the house is "Verified walkable: all 6 rooms".
  - Claude Code: the forest game is verified, and the house is verified walkable after the stair check.
  - The published zip and the share link open and play.

**Open (honest).**
- Defects:
  - Claude's "move the shrine onto the hill" left the torii hovering above the new hill, and its review called the level clean. There is no floating check for objects on procedural terrain.
  - The chase camera goes inside tree crowns. These crowns do not stop the occlusion raycast; batched or instanced geometry is suspected.
  - After an auto-repair, "Checks outdated" sits next to "Verified playable".
  - The playtest bot does not evade enemies, so a wolf pack can pin it, and the verdict can flip after a user's own edit.
  - Undo history and the verify verdict do not survive a reload.
  - Offline cannot add a window (it does not know which walls are exterior).
  - Codex was not exercised: its CLI is installed only under Node 22 on this machine.
- Visual quality is still far from the Blender bar:
  - forest games use low-poly toy pines, a flat box as the river and a flat path;
  - houses are plain stucco boxes on a flat lawn with haze, and Claude's house interiors are sparse;
  - photo rooms miss vaulted ceilings, curtains and door styles the tools cannot build.

## Acceptance follow-up: the open defects fixed

The nine defects the acceptance pass left open are fixed, each with tests. The defect list with repro steps is kept outside the repo (`~/.local/share/aether/qa/acceptance-report.md`, O1 to O10).

**Floating objects (O1).**
- New grounding measure (`@aether/playtest/level`, `measureGrounding`):
  - Each object that should rest on something is measured with rays against the real colliders under its footprint: terrain, hills, platforms, floors and the ground plane.
  - The object's own parts are left out of those rays. Water surfaces count as support.
  - The smallest gap over the footprint is how high it hovers, so something on a slope touches at one corner.
- Left alone:
  - things tagged floating, flying, hanging, cloud, sky or platform;
  - bobbing, spinning, orbiting, collectible, goal and patrolling things;
  - sensors, moving bodies, characters, lights, buildings and terrain;
  - anything a solid touches from the side or above: a banner on a tower, a rock under a ledge, a bridge deck held by its ramps.
- Where it is used:
  - The level review reports a `floating` finding with the gap, what is below and the fix. It is an error from 0.5 m and a warning below that, or over open air.
  - `query_level {op:"grounding"}` lists every hovering object.
  - `place_level_items` moving an existing item now measures the surface without the item itself and sets its bottom on it. Before, a moved object could land on its own old position, and a group's origin was not its base.
  - A local "move X onto Y" outdoors is settled on the measured surface in the same undo step. The studio gives the offline planner the level tools for this, and the reply says where the object landed.
- Before tuning, a scan of the offline worlds found a castle banner, the Highland footbridge and the Sakura lantern posts. These were real contacts the first version missed: a wall, ramps, water. Now only the rocks under the Lantern Isles' floating islands remain, reported as warnings over open air.

**Chase camera inside tree crowns (O2).**
- Forest trees are scatter instances, which were never raycast one by one.
- Tall scatter layers now get coarse trunk and crown boxes in a grid, which the camera tests its rays against. It pulls in instead of entering a crown.
- The occlusion path now writes into typed arrays. It allocated on every blocked frame before, and an allocation probe guards it.

**Playtest bot and enemies (O4).**
- The bot plans around hostile characters' live positions. The ground near an enemy is expensive to cross, inside its attack reach far more so, and along its patrol slightly.
- It steps aside when an enemy closes in and re-plans every half second while hunted.
- By a guarded pickup it waits up to 10 s for a gap, and it runs for an objective it can reach before any enemy can cut it off.
- Jumps and drops near a hunting enemy cost more.
- Runs are deterministic (fixed simulation steps). The offline Lantern Hunt now verifies as built, after "make the wolves slower" and after a second "slower".

**Verify badge and persistence (O3, O5, O9).**
- After a playtest repair, the physics checks re-run on the repaired world, so "Checks outdated" no longer sits next to "Verified playable".
- With the autosave, a project now keeps:
  - up to 40 undo and 10 redo steps;
  - the bot's compact proof with its replay;
  - the physics verdict.
- Size caps: the session stays under 1.5 MB (fewer steps first, then none), within a 6 MB project.
- On open, the session is validated (zod). The history is kept only if it ends on the saved world, and each verdict only if it was made for that world.

**Offline window edits (O6).**
- `add_window` takes the side as optional and finds the room's storey itself. The compiler now records every room's exterior wall stretches with their openings (`CompiledBuilding.exterior`).
- A new window goes to the centre of the widest clear stretch, at least 0.4 m from corners and openings. When none is clear, a matching even row with room for one more is re-spread.
- The room's automatic windows become explicit specs first. Before, a room's first explicit window switched its automatic ones off, so "adding" a window could remove the others; the plan editor's click had the same bug.
- A refusal lists the clear wall per side.
- The offline planner maps "add a window to the kitchen" to this.

**Failed non-English prompt (O7).**
- A home-prompt project whose only exchange is the offline "could not build this" answer is deleted. The editor returns home with the reason.

**Stairs (O8).**
- `stair-fit.ts` measures a stair against the plan:
  - the footprint inside one room clear of the walls;
  - floor to step on, in front of the first riser or beside its first treads;
  - clear of doorways;
  - the stairwell inside one room upstairs;
  - at least 0.6 m of floor beyond the top step.
- `fitStair` searches the room's walls in 10 cm steps, every heading, straight before L before U, preferring full 0.9 m landings.
- `add_stairs` and `design_plan` stairs may give just the room; the fitted stair is reported. A misplaced stair is refused with the numbers and a stair that fits.
- `query_scene {q:"stairs"}` answers with the riser maths (for example 17 risers of 0.176 m for a 3 m storey) and a ready op.
- Stair fields sent on the op itself (the malformed call the model kept retrying) are accepted.
- Every stair the offline houses build passes the measure, so it agrees with the walkthrough.

**Codex on this machine (O10).**
- CLI discovery honours `AETHER_CODEX_BIN` / `AETHER_CLAUDE_BIN`. It then looks on PATH, in every nvm Node version, npm prefixes, Volta, pnpm, `~/.npm-global/bin`, `~/.local/bin` and the system folders, and accepts only executable files.
- The first-run screen and the status say how to install Codex or point at it.
- Codex is now installed under Node 24 too. A prompt through the bridge's local route answered "42 Aether".
- The usage-limit message says when the limit resets.

**Verification.**
- `tsc --noEmit`: 0 errors.
- Full vitest: 368 files, 4042 tests pass.
- Studio build ok; `npm run smoke` 34/34.
- `e2e:verified` and `e2e:refine` pass in Chromium and Firefox.
- Re-run through the built studio:
  - Offline house: "add a window to the kitchen" adds the window and stays verified walkable. After a reload, Undo works and both badges are back.
  - Offline café: the walkthrough repair ends on "Verified walkable" and "Checks passed".
  - Offline Lantern Hunt: verified as built with no repair, and again after "make the wolves slower".
  - A Spanish prompt offline leaves no project behind.
  - Claude Code: asked to put the shrine on a hill, it built a stepped mound and set the torii on the summit (grounding clean).
- Observed in that run, not fixed:
  - The chat edit guard refused Claude's changes to the shrine's own light and goal zone, so it added new ones.
  - The playtest repair then moved the goal zone off the hill to a reachable spot.

**Still open.**
- The grounding measure sees colliders only. A visual-only support (a hill with no physics body) does not count, and a support with a collider smaller than its mesh can be misjudged.
- Codex found in another Node's folder is a `#!/usr/bin/env node` script, so it needs a `node` on the bridge's PATH.
- Renaming a project from the home page drops its saved undo history on the next open (the session is tied to the world).
- The bot does not evade during jumps, drops or lift rides. Enemies faster than the player still need the slower-enemy repair. Wins can take longer, because it leads the pack away first.
- The visual quality gaps (V1 to V3) are separate work.

## What belongs to an object, and a studio run with Codex as the brain

**The re-run's defects (fixed with tests).**
- An object's dependents move and change with it (`@aether/core` `dependents.ts`):
  - `Entity.attachedTo` (additive) names an owner without parenting; `rename` rewrites it, a missing owner is ignored.
  - `dependencyIndex(world)` also finds owners by part names ("Shrine goal", "shrine-light", "Shrine platform") and by footprint: a shapeless light or an invisible, sensor or rule zone inside the smallest object around it (the shrine, not the hill under it).
  - The small-edit guard puts a target's dependents in scope. `apply_patches`, `place_level_items` moves and local moves carry them (`carryPatches`, a rigid move that swings them round a turned owner); a local remove takes the object's own lights and zones. The prompt documents `attachedTo`.
- Self-repair respects intent: an unreachable objective first gets steps (0.25 m risers) or jump blocks up to what it stands on, kept only when the bot then gets there. An objective that belongs to something is never moved off it; when nothing helps the sentence says so.
- Grounding is measured on the drawn surfaces (`surfaceWorld`): every visible shape is a static body following its rendered geometry. A hill without a body holds up its shrine, and a collider that does not follow its mesh no longer decides. Props and decor are set on the drawn surface.
- A home-page rename keeps the undo history and the verdicts (`renameSession`; every kept snapshot and title change takes the new name).

**Codex through the studio (forest game, house, photo room).** The defect list with calls, timings and screenshots is kept outside the repo (`~/.local/share/aether/qa/acceptance-report.md`, "Codex run"). Fixed:
- After the local server restarted, the open studio built offline: the stale status read is now re-read before falling back, with the turn marked busy meanwhile.
- "make the wolves patrol along the river bank" was refused by the guard. Everything a request names is in scope, irregular plurals included; function words name nothing, and a precise reference ("the second tent") is not widened.
- With a model connected, an edit that could mean several things goes to the model with the candidates instead of a local "Which shrine?". Offline still asks.
- NPC grids drape over terrain (`NavBuildOptions.surface`, `terrainSampler`; analysis, verification and runtime). Wolves on gentle hills had failed "stands on ground it cannot walk on", so Codex built flat stone discs for them.
- The playtest bot no longer leaps or drops through a hazard (the river under a jump respawned it in a loop), and a stuck report does not blame the floor.
- A targeted edit is not followed by the scene-wide quality pass, which had reshaped forests, paths and lights after "move the shrine".
- Front clearance ignores pieces above 2 m (ceiling lights in front of showers).
- A start inside furniture moves beside it (a photo room's walk began on the bed); an authored walk start facing a facade turns to the entrance.
- A cosmetic edit keeps the physics verdict (no "Checks outdated" after a colour change).

**Verification.**
- `tsc --noEmit`: 0 errors.
- Full vitest: 383 files, 4106 tests pass.
- Studio build ok; `npm run smoke` 34/34.
- `e2e:verified` and `e2e:refine` pass in Chromium and Firefox.
- Codex, through the built studio:
  - Forest game: 19 calls, 296 s, verified playable. Three edits: the shrine moved with its crystal, altar and light; the wolves patrol both banks; the lanterns glow warmer. Each was verified playable. Keyboard play works, and the published zip plays.
  - House: 17 calls, 230 s, verified walkable (7 rooms, 3 residents). A local sofa colour, a Codex kitchen window (9 calls) and a local reading lamp; Undo removed the lamp; the walk now starts at the front door.
  - Photo room: 25 calls, 662 s, measured fidelity 83%.

**Still open.**
- A kitchen window recompile re-placed an automatic bathroom plant into the shower (auto-furnishing).
- Input tokens per Codex call are high (about 0.5 M): the resumed thread is reused only when the new body extends the old one, and the world summary changes every turn.
- The house project name was cut mid-phrase ("… with a"); local edits repeat their sentence three times in the reply.
- Photo rooms miss cornices, sash windows and a full shell in the judges' renders.
- Visual gaps: the forest river is a flat box and the shrine hill a cylinder.
## Generated worlds look like the flagships (stage `genlook`)

**Problem.** The flagships looked good, but worlds built from a prompt (what a person actually gets) were toys: cone pines, a blue box for a river, a pink box for a path, plain stucco boxes on a flat hazy lawn, sparse interiors (acceptance V1 to V3).

**What changed.**
- *Realistic by default.* The offline planner builds with the realistic parts unless the request asks for a stylised look (low-poly, cartoon, painterly, voxel …); edits follow the world, so a painterly world stays painterly. `apply_patches` exchanges low-poly nature generators for the realistic set for the AI too (`ExecutorContext.realistic`) and says so.
- *Land, not a plane.* `naturalGround`: the estate terrain with a level plot round the scene, swells, wooded hills, leaf-card woods and clumped ground cover; everything placed afterwards stands on it (`Builder.ground`), scatter drapes over it and keeps out of water. Forest, meadow, winter (snow lying on the land), farm, park, haunted, village and castle use it; the desert carves a real sandstone canyon (stratified walls, desert varnish, 384 cells).
- *Water and paths.* A stream carved across the land with flowing water and a footbridge where the trail crosses it (`terrain` `streamHalf/Z/Bend/Depth`, `streamCourse`); trails and lanes are draped ribbons with tapered ends (`groundRibbon`), a village square is a ragged paved patch (`groundPatch`).
- *Games.* Lanterns to collect are the photographed lantern with a flame and a breathing light; a racing activity (circuit, curbs, gantries, ordered checkpoints, grandstand, tyre walls, karts and rivals, laps) that lays its circuit before the settings so the desert carves its canyon round it; a realistic `cactus` generator; real sheep; boulders take their rock texture per face (the streaked lattice is gone).
- *Medieval village.* A village, not a castle: old houses, market stalls with awnings and produce, a stone well, lantern posts, lanes to every door, villagers, cottage gardens.
- *Built structures* (second worker): houses, towers, walls, fences, bridges, lamp posts, barrels, campfire, tents and the other props in PBR finishes with plinths, reveals, frames, tiled roofs with fascia, gutters, corbels and coping.
- *Houses* (first worker): articulated facades per style, a compiled garden and wooded land (`set_site`), rooms dressed to a sensible density (`dress_room`); here, hedges grow leafy shrubs over their box, and the building review suggests `dress_room` for a bare room and `set_site` for a house on the bare plane (`room_sparse`, `no_grounds`, information only).
- *The AI's tools.* `shape_land` ({op:"land"}: terrain, stream, woods, cover in one call; {op:"path"}: a draped trail or an even road), documented in the prompt and CONTRACTS.md.

**Rounds** (Intel iGPU WebGL2, `tests/e2e/genlook.e2e.ts`, captures in `~/.local/share/aether/genlook/`): r0 before; r1 landscape, stream and lanterns; r2 race and village; r3 canyon strata, winter and farm; r4 with both workers' structures and houses; r5 haunted, plaza patch, boulder UVs; r6 hedges, finer canyon, final. Firefox WebGL2 (`r6ff`) and WebGPU on SwiftShader (`r6gpu`) render the same scenes. Claude Code through the local server: `c4` forest, `c6` canyon, `c7`/`c8` house (before: the acceptance shots `s1c-*`, `s2c2-*`).

**Before and after, per prompt.**
- *Night forest adventure* (lanterns, wolves, river, shrine). Before: cone pines, glowing cubes, a lake disc, a flat path. After: a clearing in rolling spruce and broadleaf woods with ferns, grass and flowers, a carved stream with a footbridge on the trail to the torii, lit wooden lanterns; verified playable (5 of 5 in 18 s). Claude Code: called `shape_land` with a stream and built on it (was a blue box river).
- *Two-storey modern house with pool.* Before: a white box on a flat lawn, four pieces in the living room. After: render and timber cladding, plinth, canopy, fascia, a garden with hedges, beds, trees, loungers and wooded land; dressed rooms; verified walkable. Claude Code: first run left the grounds and dressing out; with the review notes it called `set_site` (garden and estate land) and set the ground off.
- *Medieval village with a market.* Before: a grey castle with blue cone roofs and modern flat-roofed cottages. After: half-timbered and stone cottages on a cobbled square with stalls, a well, lantern posts, lanes and villagers in wooded hills.
- *Desert canyon racing game.* Before: a city street of white blocks beside green-skirted cones, no race. After: a three-lap circuit on the floor of a stratified sandstone canyon with a grandstand, gantries, rival karts and cacti; the bot drives it to the win in 45 s. Claude Code: carved the canyon with `shape_land` and laid an asphalt road (was walls of boxes).

**Verification.** `tsc --noEmit` 0 errors; full vitest 383 files, 4106 tests; studio build; `npm run smoke` 34/34; `npm run bench:quick` passes; `showcase:bake --check` up to date (bundled prompt worlds rebaked: they are realistic now). Test expectations changed honestly: the stylised-only assertions use a low-poly prompt, the prompt cap carries the new options, the planner speed budget is 120 ms per world (it samples the landscape heightfield), terrain winding tolerance 1.5 % at random extremes, the design loop takes one review turn for the dressing note.

**Security.** `shape_land` input is zod-bounded (sizes, counts, colours, at most 64 points) and produces only ordinary validated patches; library lookups are capped at 32 per call; no network, no new assets or dependencies.

**Performance.** A landscape adds one terrain (256 cells, 384 for a canyon) and a few thousand clumped cover instances; scatter stays within the renderer's instance and triangle budgets; the planner spends 20 to 60 ms sampling the heightfield.

**Honest gaps (still short of a Blender still).**
- Realtime lighting stays flat in interiors (bleached walls, little bounce); exteriors have no contact shadows under small props.
- Canyon walls still show 1.4 m facets from a distance; far hills are smooth.
- Ground between scatter clumps is a plain tinted surface; hedges are boxes with leafy tops; the lawn outside a garden is bare.
- Kart drivers, the torii gate and the farm animals are stylised library models; flames are glowing cones.
- The AI does not always use the tools it is told about on its first pass (it needed the review notes for the grounds, and rooms it lays out stay sparser than the offline ones).
- Stills are from the Intel iGPU (the RTX 4090 was busy); the genlook play still can show the playtest replay's selection outline.

**Follow-up from the Codex acceptance run.**
- River as a flat box: `shape_land` land takes `lake` as well as `stream`, and `apply_patches` answers any water added as a plain primitive with the `shape_land` call to use instead. Codex (`genlook/x1`, Node 24 CLI) then built the forest game on a carved stream with a footbridge.
- Shrine "hill" as a cylinder: a `mound` built-in generator (natural hill, level summit, heightfield collider) and `shape_land {op:"mound"}`; primitive hills get a note pointing there. In `x1` Codex raised a mound and stood the shrine on it. That game came back "not verified yet: ran too long", which is the playtest bot's, not the look's.
- Plant in the shower after a window was added: loose pieces keep 0.4 m off showers and baths, and a re-compile drops a compiled floor piece standing in a piece the model placed (regression test `wet-clearance.test.ts`; before the fix the re-compiled vanity stood in the shower).
- Sparse Codex interiors: with the `room_sparse` and `no_grounds` notes, a Codex house (`x2`) came back verified walkable with grounds, and with rugs, plants, lamps and curtains in the living room and both bedrooms.
- Full vitest after these: 385 files, 4113 tests.


## Turn layout: prefix-stable, resumable model calls

**What the numbers were.** Codex reports a thread's *running totals* on every
`turn.completed`, and its input count already includes the cached part. The
backend added the cached count on top and summed the totals call after call,
so a resumed thread looked quadratic: the forest build's "10.0 M input tokens"
and the house's "6.5 M" were mostly this accounting error. Measured on the raw
counters, a call read about 37–55 k tokens (the stable preamble alone is about
33 k), 85–95 % of it from the prompt cache. The real waste was elsewhere:
every chat edit, quality round or repair started a new thread (about 38 k
uncached tokens and 6–8 s before the first answer), and any review round with
renders rewrote earlier messages (images dropped in place), which broke the
resumed prefix.

**What changed.**
- Per-call usage: `codexTurnUsage` turns running totals into one turn's tokens
  (the session keeps the thread's totals; per-turn counters from another CLI
  version are recognised and taken as they are). `cachedInputTokens` is
  reported by Codex, Claude Code, Anthropic, OpenAI Responses and
  chat-completions providers, summed per run and shown in the chat ("… in
  (… cached)"). The agentic worker had the same double count.
- Append-only conversation: the agent no longer rewrites messages. Each request
  carries `requestView(messages)`: images that do not fit (earlier review /
  photo rounds, more than four) become an in-place `[image <key> removed]`
  text. The photo flow uses the same view.
- Stable transcript: images are `[image <key>]` (content hash), a removed one
  renders the same, so a body only ever grows; backends label each attached
  image with its key. A resumed call sends `resumeInput(...)`: the new part
  without the echo of the model's own last reply, and only images the thread
  has not seen (Codex and Claude Code; Claude Code used to resend every image).
  Re-asks keep the session body and send only the corrective instruction.
- Continued conversations: with a session key the run's conversation is kept
  (`ConversationStore`, LRU 16, 6 h, images as placeholders, 300 k character
  budget) with the world at its end. The project's next run (chat edit, the
  quality round, which now gets the same tools so the same system prompt)
  appends one turn with `<scene_changes>` — added / removed / changed things
  since the model's last turn, the user's own edits included — instead of the
  text history and the full summary. More than 40 changed entities or 6 000
  characters sends the full summary, still in the same thread. A failed run,
  a photo run or another system prompt starts afresh; deleting the project
  forgets it. The system prompt says what `<scene_changes>` means.
- OpenAI Responses requests carry a `prompt_cache_key` derived from the system
  prompt.
- Naming: the prompt asks the model to title a new world with `setMeta`
  (Codex now names them: "Lanterns of Moonfall", "Azure Court");
  `projectNameFromPrompt` takes the first clause and stops before a
  connective or a dangling word ("Two-storey modern house with a pool",
  "Night forest adventure", never "… with a").
- A local edit's reply is said once: the studio drops a reply that repeats its
  edit card (summary and notes) and keeps anything beyond it ("2 parts were
  refused"); the chat history falls back to the card's sentence.

**Measured (Codex, gpt-6.1-sol, low effort; `scripts/token-probe.ts`, the
studio's agent settings without renders; true per-call counts from the raw
counters for both runs).**

| Run | Calls | Input (true) | Cached | Uncached | Per call | Old report |
|---|---|---|---|---|---|---|
| Forest build + 2 edits, before | 11 | 436 k | 312 k | 124 k | 40 k | 1.90 M |
| Forest build + 2 edits, after | 10 | 408 k | 363 k | 45 k | 41 k | = true |
| House build + 2 edits, before | 15 | 681 k | 567 k | 114 k | 45 k | 6.59 M |
| House build + 2 edits, after | 19 | 911 k | 857 k | 55 k | 48 k | = true |

- Forest: uncached input −64 %; characters sent 313 k → 104 k; the shrine
  edit 24 s → 12 s (its first call sent 718 characters instead of 101 745).
- House: uncached −52 %; the window edit's first call 106 k characters → 4.8 k
  (54.7 k read, 52.9 k cached). The build itself made more calls (the review
  ran four rounds and approved instead of stalling after three).
- Quality: forest verified playable before and after (bot won, 5 of 5);
  physics checks pass in all runs; the house walkthrough bot failed in both
  headless runs (a room not reachable on foot; the studio's playtest repair is
  not part of the probe), so no change there. The studio run below is the
  badge check.

**The studio with Codex (built studio, local AI, renders on; edits sent in the
open page).** Earlier run's figures are as that build reported them
(cumulative, cache counted twice).

| Step | Calls | Input (cached) | Time | Result | Earlier run |
|---|---|---|---|---|---|
| Forest build | 14 | 619 k (569 k) | 222 s | verified playable (5 of 5), named "Lanterns of Moonwood" | 19 calls, "10.0 M", 296 s |
| Move the shrine 6 m east | 4 | 217 k (213 k) | 43 s | verified playable | 7 calls, "0.98 M", 103 s |
| Wolves patrol the river bank | 3 | 170 k (169 k) | 23 s | verified playable | 7 calls, "2.0 M", 62 s |
| Lanterns warmer and brighter | 2 | 116 k (115 k) | 16 s | verified playable | 2 calls, "0.16 M", 18 s |
| House build | 16 | 818 k (735 k) | 270 s | verified walkable (7 rooms, 3 doors), named "Poolside Modern House" | 17 calls, "6.5 M", 230 s |
| Sofa dark green velvet (local) | 0 | – | 2 s | one sentence (the card) | 11 s, three sentences |
| Large kitchen window | 2 | 154 k (151 k) | 12 s | verified walkable | 9 calls, "2.7 M", 102 s |

Uncached input over the whole session: about 51 k for the forest build and
under 5 k for each of its three edits; 83 k for the house and 2.4 k for its
window.

- Claude Code (sonnet, probe): forest build 5 calls, 326 k read (275 k
  cached), the shrine edit resumed the same session (2 calls, 103 k, 102 k
  cached); verified playable.
- Gates: `tsc --noEmit` 0 errors; full vitest 386 files, 4129 tests; studio
  build ok; smoke 34/34; `e2e:verified` passes; `e2e:refine` passes
  (Chromium and Firefox; its first run hit the GPU-resource growth check,
  91 → 98 geometries, the re-run was flat).

**Still open.** Every Codex call still re-reads the whole thread (cached): the
33 k-token preamble is the floor per call; shrinking it (catalogs and API
references on demand) is the next lever. Edit cards are not kept across a
reload (the stored turn shows its patch line).


## Playtest bot on generated worlds: finishing instead of running out the clock

**Problem.** After the generated-world upgrade (relief, carved streams,
footbridges, woods, draped trails), the Codex night forest (`genlook/x1`)
ended "not verified yet: ran too long", and the house walkthrough failed in
`scripts/token-probe.ts`. Reproduced headless with a new probe
(`scripts/bot-probe.ts`: world files, `prompt:` for the offline planner,
`plan:` for a building plan; prints wall time, simulated time, nav grid,
searches, evasions).

**What it was (profiled).** Not compute: every "ran too long" run used 5–6 s
of its 20 s budget and hit the 240 s *simulated* cap in a loop.
- *Hop loop under a footbridge* (`x1`). The route ran under the bridge deck
  (there is head room in the stream bed); the capsule stepped onto the low end
  of the ramp, walked the deck above its path and stood over a waypoint 2.6 m
  below. The stall watchdog measured movement in 3-D, so its own "hop" read as
  progress and reset it: 220 s of hopping in place.
- *Pinned by a pack* (offline-planner forest, `r6`/`c1`/`c3`). Four wolves
  hunting the player stood in the stream below the bank where a lantern lies;
  they could not climb out, the bot stepped aside, re-planned, stepped aside
  (3 405 evasions). Waiting for a gap only applies to calm enemies.
- *Non-deterministic first run.* Goals were read before the asset catalog was
  loaded: the first run in a process measured library pickups (lanterns,
  wolves) as unit boxes and could pass, every later run (the studio's worker,
  a second check) measured them right and failed. Same world, two verdicts.
- *Presence zone crossed early* (`x1`, once unblocked). The shrine zone sets
  `atShrine` and resets it on exit; the bot crossed it on the way to the last
  lantern, then waited elsewhere: "everything was done but the win never
  triggered".
- *The house was a real defect.* The stairwell balustrade picked the first
  edge facing the arrival direction: for an L stair that is the inner corner
  of the L, so it railed the real exit and left the inner corner open (the
  studio's repair has nothing to propose for it either). Centred on the
  opening's edge, the panels also narrowed a 0.9 m flight to 0.82 m where the
  head passes them.

**What changed.**
- `playtest`: the catalog is loaded before goals are read (also for the level
  probe); the watchdog counts ground movement only; standing more than 1 m
  above the path's surface re-plans from where the player is (`lost`, counted
  like a stuck); each walk may take 4× its length at full speed + 10 s and each
  objective 4× + 60 s, past which it is written off with the reason, so a run
  fails with a cause instead of "ran too long"; time spent stepping aside
  counts as waiting, and after 20 s per objective the bot runs for it (a
  person hesitates, then goes, taking a bite if need be); a presence zone is
  walked back to once when everything else is done. `BOT_VERSION` 2.
- Search: A* towards discs round the targets (the estimate is scaled to stay a
  lower bound, so routes stay the cheapest); every jump of a candidate route is
  simulated at once and the bad ones marked together; the far landing scan
  skips 8×8-cell blocks no jump or drop can reach (exact: same candidates,
  same order) and reads angles and bins from a per-graph table.
- `arch`: the balustrade leaves open the edge nearest to where the top step
  comes out and stands 5 cm back from the opening. Two bundled houses rebaked
  (`dusk-lake-house`, `villa-pool`: railing points only).

**Measured** (Node 24, this machine, headless; studio budget 240 s simulated /
20 s compute; wall = whole run including the nav grid).

| World | Before | After |
|---|---|---|
| Codex forest `x1` (stream, footbridge, mound, wolves) | ran too long, 240 s sim, 4.7 s wall | passed, 26.5 s sim, 3.6 s wall |
| Offline forest `r6` (= Claude `c1`, `c3`) | ran too long, 240 s sim, 5.9 s wall | passed, 42.9 s sim, 2.6–3.1 s wall |
| Claude forest `c4` | passed 22.0 s, 1.9 s wall | passed 22.0 s, 1.6 s wall |
| Planner forest (current) | passed 42.7 s, 2.9 s wall | passed 42.7 s, 2.2 s wall |
| Planner / `r6` canyon race | passed 45.5 s, 0.45 s | same |
| Planner / `r6` village | nothing to play (no game) | same |
| Planner house | passed 42.5 s, 2.8 s wall | passed 42.6 s, 2.5 s wall |
| Codex house `x2` | passed 47.1 s, 3.4 s wall | passed 47.4 s, 3.2 s wall |
| Codex house, token probe (saved) | failed: upstairs unreachable | same world still fails (railing baked in); its plan recompiled: passed 42.0 s, 1.8 s wall |
| Claude house `c7` | failed: upstairs unreachable | still fails: the stair now climbs, but its top lands 0.78 m from the exterior wall, narrower than the body (a plan defect, reported) |

Flagships (shipped files): every verdict unchanged. Highland Trail 78.7 s
(3.4 → 3.3 s wall), Lantern Isles 64.0 s (1.2 → 1.0), Chain Reaction 14.9 s
(3.3 → 2.6), Neon Rain City 61.4 → 63.4 s (2.4 → 2.3), Kyoto Temple 34.0 →
31.8 s (2.1 → 1.7), Painterly Meadow 41.4 → 41.5 s (1.9 → 1.8), Four-Seasons
Garden 29.7 s (2.7 → 2.1), Orbital Lab 49.0 → 39.2 s (10.7 → 9.8 s wall),
Hollow Gate 53.6 → 48.7 s (2.9 → 2.8), Skyline Penthouse 67.5 → 68.0 s,
Casa del Patio 30.5 → 30.9 s, Dusk House 46.4 → 47.2 s; Kart Canyon driven to
the win (76.3 s); Blockfall and Sakura River unsupported as before (own bots).
Search effort on the forest `x1`: 990 k → 499 k nodes expanded; jump/drop
discovery 2.7 → 1.5 s in a CPU profile.

**Tests.** `packages/playtest/test/run-length.test.ts`: the pinned-pack
forest (fixture without ground cover) and the Codex forest must pass well
inside the caps, the first and second run in a process must agree, an
unreachable coin fails long before the clock, and the Codex L-stair house
must be walked to every room within 20 s; both forest tests fail on the old
bot. `packages/arch/test/stair-well-rail.test.ts`: every heading × shape ×
turn leaves the arrival open and the flight its width (fails on the old
compiler). Gates: `tsc --noEmit` 0 errors; vitest 390 files, 4 167 tests;
studio build; `showcase:bake --check` up to date; smoke 34/34;
`e2e:verified` passed (Chromium and Firefox); `e2e:gameplay` kyoto-temple
won in the browser (software GL, the GPU was busy with training jobs);
Highland Trail and Neon Rain City were not run in the browser here (about
10 minutes each on software GL), their bot runs pass headless.

**Still open.** Orbital Lab (low gravity: 14 m jump reach everywhere) still
costs about 10 s of compute, mostly jump-link line tests; a coarser link
search for low gravity is the next lever. The 240 s simulated cap is not
scaled by world size: no generated world here comes near it once the loops
are gone. A saved world keeps a railing compiled before this fix until its
building is recompiled.

## Stair landings: a clear landing at both ends, measured for the body

**Problem.** Claude's house (`genlook/c7`, and the same plan in `c8`) failed its walkthrough: the straight stair
along the hall's east wall climbed, but its top step came out 0.78 m short of the south wall, with the stairwell
balustrade beside it. Between the balustrade's corner and the wall that left 0.69 m, narrower than the bot's body
(0.35 m capsule plus skin: 0.75 m), so the upper floor was unreachable. The stair measure accepted it (0.6 m of floor
beyond the top step, measured to the wall only), create_building never measured stairs at all, and the building
check walked the landing with the 0.8 m walkway radius and ignored railings, so it passed too.

**What changed.**
- `stair-fit.ts`: a landing is a strip as wide as the flight and `stairLandingDepth(width)` deep: the stair's width,
  never less than 0.9 m (a 0.70 m body with 0.10 m each side). It is required in front of the first riser or beside
  the first treads, and beyond the top step, measured to the walls' inside faces and kept clear of declared railings,
  other stairs, stairwells from below (with their balustrades) and furniture placed at a point. The top landing must
  also lead on: straight ahead, or sideways past the balustrade's corner, 0.9 m wide. The stairwell keeps clear of
  doorways upstairs as the flight does downstairs. Refusals give the measured depth and what stops it ("0.76 m of
  clear floor before the wall of landing on level 1, where a walker needs a landing 0.90 m").
- `fitStair` takes `near` (keep shape, heading, turn and width, then the least move) and `turn`; candidates need only
  the footprint in the room (a stair from an end wall is stepped onto beside its first treads).
  `settleStairs(plan)` moves each stair that does not work to the nearest that does.
- `create_building` settles the plan's stairs and says so ("stair moved: … moved to a straight stair 0.9 m wide in
  hall, first riser at (12.39, 0.26) …"); `exactStairs: true` builds them as drawn. `add_stairs` takes `replace`
  (swap the level's stair at that index); its refusal and design_plan's offer the nearest stair that works.
- Building check (`nav.ts`, so the review, the navigable test and every arch op report): railings block; each
  stair's foot and top landing are flooded with the body's radius (0.4 m on the 5 cm grid) and must get 1.5 m away or
  reach a doorway. A landing nobody can get off is an `unreachable_room` error on the stair with the clear depth and
  a ready op: `build_architecture {"op":"add_stairs","building":"house","level":0,"replace":0,"stair":{…}}`.
  The upper floor is not seeded through it.
- U stairs: with an odd riser count the return flight is a tread longer than the first, so its top step came out
  past the first riser under the slab. The opening now runs over it.
- The offline villa's stair moved from x 0.5 to 0.2 (its top landed 0.85 m short of the bathroom wall for the
  one-bedroom plan), the lake house's from z 0.6 to 0.66 (it ran 6 cm into the north wall). `villa-pool` and
  `dusk-lake-house` rebaked.
- `scripts/stair-probe.ts` measures every stair of a plan or world and prints the settled result and both building
  checks; `scripts/bot-probe.ts --exact-stairs`.

**Measured** (headless bot, Node 24).

| World | Before | After |
|---|---|---|
| `c7` plan through create_building | failed: 4/6 rooms, the landing pocket | stair slid to z 0.26 along the same wall, passed 6/6 in 38.0 s sim, 1.2 s wall |
| `c7` plan, `exactStairs` | building check passed | check: 3/6 rooms, "landing a walker cannot get off: 0.76 m"; bot fails as before |
| Fitted stair, every heading × straight / L left / L right / U left / U right (20) | | 17 pass the bot; see below |
| Each of those slid until the top is 0.8 m from the wall, then settled (20) | | 17 pass (the same three L) |
| `dusk-lake-house` / `villa-pool` / planner three-bedroom house | passed | passed 47.8 s / 27.9 s / 68.0 s sim |

**Tests.** `packages/arch/test/stair-landing.test.ts`: the c7 plan measured (0.7x m against 0.90), the check's
landing error with a ready op that fixes it (6/6 rooms, one stair), the review's error, create_building moving it,
add_stairs refusing it; every heading × shape × turn: a fitted stair passes the measure and the building check, the
same stair slid to land 0.8 m short is refused with the depth, caught by the building check, settled and then passes;
a railing and a sofa on the top landing, a landing boxed in on three sides. `packages/playtest/test/stair-landing.test.ts`:
the bot fails the c7 plan as drawn and walks every room once create_building has moved the stair. Changed: the
stair-arrival tests build with `exactStairs` (they test the check), the size refusal says 5.32 m for a straight
1 m stair (a 1 m landing at the top). Gates: `tsc --noEmit` 0 errors; vitest 390 files, 4 171 tests; studio
build; smoke 34/34; `showcase:bake --check` up to date after the two rebakes.

**Still open.**
- Three of the eight fitted 1 m L stairs (heading north turning right, south turning left, west turning right in
  the 8 × 8 m test hall) get the bot stuck on the last treads of the first flight: the capsule cuts the corner toward
  the second flight and its top meets the slab edge inside the L. This has nothing to do with the landings (same
  geometry before this change); which positions fail moves with 10 cm shifts and even 1.2 m L stairs fail in one
  heading, so it is the bot's path near the turn (or the well too tight for a 0.7 m vertical capsule), not fixed here.
- The landing measure uses the plan's furniture placed at a point; furniture the layout places is checked by the
  building check after compiling (the 0.8 m stair walkway keeps it off most landings).
- A saved world keeps its stair until its building is recompiled through create_building; the building check now
  reports it with the fix op.

## Interior light and close-up foliage (stage `look2`)

**Problem.** Generated interiors looked like a game: every surface lit by the same room-agnostic fills, white walls
clipping, no falloff from the windows, no contact shadows, lamps lighting the rooms behind the walls; up close, shrubs
and tree crowns read as large paper cut-outs (one card image repeated, pastel tones mixed toward white, no backlight).

**What changed.** (Design: ARCHITECTURE section 36.)
- *Baked light volume per building.* Probes every 0.45 m trace the shell and furniture proxies in a module worker
  (48 rays, six bounce passes, sun, lamps, open ground); first-order harmonics of sky visibility and bounce in one
  RGBA16F 3D atlas; a light node multiplies each material's ambient and image light by the visibility and adds the
  bounce (irradiance and reflections). Deterministic, cached until the building or the light changes; about 3 s of
  worker time and 10 to 20 ms of main-thread time for the benchmark house (11 000 probes, 13 000 triangles); falls back
  to 6 ms slices between frames without workers.
- *Eye, tone and shadows.* Exposure from the volume at the eye (opens in dim rooms, closes in lamp-lit rooms at dusk),
  snapped on camera jumps and before stills; the eye's exposure was applied twice on post tiers (fixed: renderer tone
  mapping only); warmer adapted interior grade; inside a building the sun's shadow map is fitted to the shell, so sun
  patches are crisp (it was a 320 m frustum).
- *Lamps.* Point lights are clipped to their room's box by their own light node; on until the sun is 16° up (an
  earlier tweak in this stage switched them off at 7° golden hour, which darkened the Penthouse; fixed).
- *Contact shadows* under furniture (one instanced draw); *painted surfaces* with a faint world-space mottle.
- *Foliage.* 2 × 2 card variants per atlas; tree, shrub and fern cards composed from CC0 Poly Haven leaves, fronds and
  tufts (SHA-256 pinned, `scripts/foliage/leaf-sprites.ts`, THIRD_PARTY.md) with overlap shadows and per-leaf tone;
  real-sized leaf clusters on big plants within triangle budgets; forward-scattered sun as emission, plant- and
  cluster-scale hue variation, leaf flutter; saturated sunlit tones; finer, root-darkened grass.
- *Water on software rasterisers* (coordinator request) mirrors an analytic sky gradient instead of reading grey.

**Rounds** (Intel iGPU WebGL2; the RTX 4090 was busy training throughout; captures in `~/.local/share/aether/look2/`):
r0 baseline; r1a–r1e and r1 light volume (found the double exposure, lamps lighting through walls, the 320 m shadow
frustum and a stale ceiling list that kept the old interior fill off after a fresh build); f0–f1c and r2 photographed
leaves on a foliage test world; r3 room lamps, metal reflections, warmer grade; flag-r2/r3a flagship regressions
(Penthouse corridor first too dark, then bleached: lamps off at golden hour, exposure not counting lamps); r4 contact
shadows (first invisible: three reads an alpha map from green); f5 grass; r6 full house and forest; flag-r6 to r8 final
flagships; `ff/` Firefox WebGL2 and Chromium WebGPU (SwiftShader) parity on the Dusk House interior (the same image).
Before images of the flagships and of water come from a build of `9798e88` (`flag-before`, `water-before`).

**Before and after.**
- *House living room* (r0 → r6): flat, evenly lit white room, ceiling as bright as the walls → light falls off from
  the window, darker ceiling and corners, warm white balance, soft footprints under the sofa and armchair.
- *Kitchen*: bleached grey-white everywhere → readable falloff between the two windows, warmer walls, marble keeps its
  tone (still a little cool: the sun never enters this kitchen).
- *Bedroom*: flat → crisp sun patch on the bed with the window's shadow, warm lamp, depth toward the corners.
- *House exterior and forest*: foreground shrubs as pale mint paper fans → clusters of photographed leaves with
  variation and shading; crowns from below show leaf shapes and veins; backlit leaves glow toward the sun.
- *Skyline Penthouse corridor*: bleached and flat (mean 169) → modelled walls and ceiling with lamp pools (final mean
  173: about as bright, now with gradients); cover view unchanged (119 → 111).
- *Dusk House*: interior spawn view gains contrast and warm lamplight (mean 178 → 133); garden and cover views keep
  their level (70 → 74, 91 → 86).
- *Water on SwiftShader* (Sakura River): grey-brown → blue sky reflection on the ripples.

**Verification.** `tsc --noEmit` 0 errors; vitest 400 files, 4 252 tests (new: `light-volume`, `light-volume-controller`
(worker protocol, settle, cancel, lamps and the eye), `foliage-photo`, `foliage-cells` (procgen), `room-lamp`,
`contact-shadows`, `paint-mottle`; the tree triangle budget test was kept and the card budget fitted under it); studio
build; `npm run smoke` 34/34; `npm run bench:quick` passed; `showcase:bake --check` up to date.

**Security.** Worker requests and replies are validated (grid within the allocation, triangle cap, finite numbers,
reply length) and stale replies are dropped by job id; the leaf sheet index is validated (bounds, kinds, finite means)
and its fetches are size-capped; the sprite script only downloads from `dl.polyhaven.org`, verifies SHA-256 and writes
committed artefacts. No new dependency.

**Performance.** Per lit fragment: four filtered 3D-texture reads and a few ALU for the volume, six smoothsteps per room
lamp, two noise lookups for foliage variation and for paint (paint only where anti-tiling runs). Nothing per frame on
the CPU (bake in a worker on change; eye sample every 80 ms). The atlas is 2.2 MB, allocated once; leaf atlases grow
from 256² to 512² per kind (2 × 2 variants at the old resolution; 256² in low-memory mode). Card counts of large trees
rise by about 1.6× (a 10 m tree stays under its 5 000-triangle test budget).

**Honest gaps.** No frame-time comparison on the RTX 4090 this stage (busy); stills are from the Intel iGPU on the low
tier (screen-space AO only on high and ultra, noisy on the iGPU). The volume is single-resolution (0.45 m): thin walls
between a sunlit and a dark room leak a little, door leaves are baked as they stand, and lamps count toward the eye's
exposure by room box, not by a traced line of sight. Spot lights are not clipped to rooms. Photographed leaves are
composed on the main thread once per kind (tens of milliseconds); grass stays procedural, needles, blossoms and flowers
keep procedural cards; hedges are still boxes with leafy tops. Kitchens without sun stay somewhat cool. Firefox and
WebGPU parity was checked on one interior view; a Firefox prompt build timed out on this loaded machine.

## Stairs walked along their walking line; ceilings open over the stairwell

**Problem.** The landing work left three of the twenty fitted 1 m stairs (heading × straight / L left / L right /
U left / U right) stuck on the last treads of an L's first flight, plus one 1.2 m L, with the failing positions moving
when the stair moved 10 cm. Three causes were suspected: the bot's path at the turn, a stairwell opening too tight
for head room, or the capsule against the slab edge.

**What it was (measured).** A matrix of every heading × shape × turn × width (0.9, 1.0, 1.2 m) at the fitted
position and six offsets (±0.1 m across, ±0.1 and +0.2 m along, +0.2 m across), 336 stairs in the 8 × 8 m test
hall, walked by the bot: **48 failed**, every one an L stair (25 left, 23 right), and 31 more passed only after being
stuck. The trace of the first one: the grid route came from the hall beside the first flight, stepped onto its low
treads from the side and climbed with the capsule's axis 0.12 m inside the flight's inner edge (the shortest way to
the second flight hugs the inside of the turn). The slab of the floor above starts at that edge, inside the L, at
head height on the last treads. The capsule (0.35 m radius at the head as at the shoulders) rode 9 cm above the
ramp (round foot on a 33° slope, skin), its top touched the slab's underside at 2.93 m with the feet at 1.23 m, and
it could neither climb nor slide out: 16 s against it.
- (a) the bot's path: **the cause**. Following the stair's walking line alone, all 336 pass, none stuck.
- (b) the opening: **not the cause**. The well is the stair's footprint (both flights and the landing), so the
  walking line is open to the floor above all the way; measured on the compiled building with a body disc
  (0.35 m round the line) the least head room along the line, landing included, is over 2.0 m for every case. The
  **ceiling** of the stair's room, though, was emitted with no holes: a plane 4 mm under the slab closed over the
  well (no collider, so the bot never saw it). From below it hid the well and the upper flight, and on the way up
  the head passed through it.
- (c) the capsule: contributes, not fixed. The nav graph tests the capsule from the ramp's surface, while on a slope
  it stands r·(1/cos θ − 1) higher (7 cm here), so nodes along the inner edge under the slab passed. Correcting that
  test alone left 44 of the 48 failures, so it is not in this change. A person playing who hugs the inner edge of
  the first flight can still wedge the same capsule under the slab.

**What changed.**
- `arch`: `stairWalkLine(params)`: the walking line in the stair's frame, from 0.4 m before the first riser up the
  middle of the first flight, to the landing's centre (the turn), along the middle of the second flight (a U crosses
  the landing to the return flight's centre line first) to 0.4 m beyond the top step. Ceilings are open over the
  stairs that rise through them (the same footprints as the slab above); a ceiling with a stairwell is flat (a
  cove's raised field has no openings) and drops downlights over the well.
- `playtest` (`stairs.ts`): every `arch-stair` entity's footprint and walking line in world space. A stretch of a
  route that climbs or descends a stair (route points on the stair's treads, within half its width of the line and
  at its height, changing height by at least half the rise) is walked along the line once the player stands on the
  stair: the grid's route gets it there, also when it steps onto low treads from the side. The bot goes to each
  vertex of the line (the landing's centre among them) before turning, aims 0.5 m ahead on the segment, and when
  more than 0.2 m off the line steers back onto it nearly square before going on. The floor under a U's upper flight
  is inside the footprint but far below the treads: not on the stair.

**Measured** (headless bot, Node 24, the 336-stair matrix; `scripts/stair-probe.ts` and `scripts/bot-probe.ts`
for the shipped houses).

| | Before | After |
|---|---|---|
| Matrix: failed | 48 (all L) | 0 |
| Matrix: passed after being stuck | 31 | 0 |
| 1 m L right heading north (the first failure) | stuck 16 s, then 8 stuck reports | 16.8 s sim to every room, never stuck |
| `dusk-lake-house` / `villa-pool` / planner three-bedroom house | 47.8 / 27.9 / 68.0 s sim | 45.9 / 26.9 / 70.4 s |

**Tests.** `packages/playtest/test/stair-walking-line.test.ts`: L stairs at 0.9, 1.0 and 1.2 m turning each way,
the 1 m L shifted 10 cm, straight and both U, each in all four headings (44 walks): every room, no stuck report, and
from the first flight's upper part to the top the feet within 0.25 m of the walking line (the old bot fails the 1 m
L cases). `packages/arch/test/stair-headroom.test.ts`: every width × heading × shape × turn has 2.0 m above the
walking line across a body's width, against the slab's underside and the ceilings (fails on the old compiler: the
ceiling 0.06 m above the feet). Rebaked `dusk-lake-house` and `villa-pool` (living room ceilings only).

**Still open.** The capsule can still wedge under the slab for a person playing who walks the inner edge of a first
flight on purpose; a balustrade collider on a flight's open sides (or a narrower head) would stop it. The nav
graph's capsule test does not lift the capsule on slopes.

## GPU-compressed textures (KTX2) and the image-to-3D licence notes

**Why.** Every library texture was a WebP / JPEG / PNG that the browser decodes to RGBA8: a 1k map holds 5.6 MB of GPU
memory with its mips, whatever its file size. A cast body alone held 37 MB, Kart Canyon's library images 490 MB.
(The often-quoted "565 textures" counts the 404 library thumbnails and the template and palette previews too; those
are UI images and never reach the GPU. What does: 289 images inside 195 library GLBs, 132 of them unique, the 69
photographed finish maps, the block sheets and the leaf sprite sheet.)

**What changed.**
- `scripts/assets/ktx2.ts` (`npm run assets:ktx2`): KTX-Software `ktx` 4.4.2 (Apache-2.0; pinned, SHA-256-checked
  download into `~/.cache/aether-tools`, or `AETHER_KTX` / `PATH`) writes a twin of each of the 195 textured models
  to `assets/lib/k/` (`KHR_texture_basisu`, required) and the block sheets as KTX2 array textures. Images are
  decoded to exact bytes in one headless Chromium (WebGL2 read-back). Albedo is ETC1S when its luma-weighted SSIM
  is at least 0.95 (203 of 215 albedos; the 12 UASTC ones include the 8 hair-card sets), UASTC otherwise; normal and ORM maps are UASTC with RDO and
  Zstandard; cut-out colour (hair cards, lantern and lamp glass) is UASTC without RDO with its colour bled under
  transparent texels; full mips; sRGB colour, linear data; RGB normals (no two-channel mode). `assets/ktx2.json`
  records variant and source SHA-256, sizes, per-texture codec and SSIM, and estimated GPU bytes.
- Runtime: `TextureCompression` per renderer sets up a `KTX2Loader` once the catalog is in, self-tests it (a
  377-byte embedded KTX2), and on GPUs with BC formats targets only BC (desktop drivers that also advertise ASTC
  or ETC decompress them; KTX2Loader would pick ASTC first). `createGltfModelLoader({ compression })` loads a twin
  and falls back to the original on any failure; block sheets likewise. `?textures=rgba` forces originals.
- The transcoder (three's `basis_transcoder.{js,wasm}`) is served from `apps/studio/public/basis/`. First browser
  run: the KTX2 path silently fell back because the transcoder's embind glue calls `new Function`, which the
  page's CSP forbids inside KTX2Loader's `blob:` worker. Fixed with `ktx2-worker.js`, KTX2Loader's own worker body
  as a static file (`scripts/assets/basis-worker.ts`, checked by a test), served with
  `default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'` by the server and `vercel.json`, whose
  page rule now excludes that path (two CSP headers would combine). The page policy is unchanged.
- The cast: base colours are compressed too (37 → 9.3 MB per body); outfit and hair tints, baked on the CPU, read
  the original file's embedded images (`glbBaseColourImages`, no mesh decoding) when the body came from its twin.
- glTF export decompresses compressed textures through three's WebGL2 texture utilities; the path tracer samples
  them on its own context; both only when that context supports the format (they were dropped before).
- `gpu/texture-memory.ts`: three counts a compressed texture as 1 byte and leaves out generated mips; corrected,
  and live texture bytes are broken down by kind (render targets, compressed, decoded images, data) in
  `memoryStats()`.
- Published games pack the twins and the transcoder.

**Measured** (`tests/e2e/ktx2.e2e.ts`, RTX 4090; WebGPU and WebGL2 in Chromium on the GPU, Firefox headed under Xvfb
on llvmpipe; each scene opened twice in fresh contexts, KTX2 and `?textures=rgba`). "Image textures" = compressed +
decoded-image textures (the library's; render targets and procedural data textures are unchanged by this work and
listed apart). Downloads are the library, transcoder and block files of the visit, on disk.

| Target | Scene | Image textures KTX2 / original (MB) | Ratio | All textures (MB) | Library download KTX2 / original (MB) |
|---|---|---|---|---|---|
| WebGPU | Lantern Isles | 15.1 / 49.8 | 3.3× | 188.7 / 245.5 | 11.0 / 7.8 |
| WebGPU | Kart Canyon | 184.4 / 490.5 | 2.7× | 330.8 / 663.9 | 45.7 / 16.4 |
| WebGPU | Skyline Penthouse | 48.0 / 163.5 | 3.4× | 275.2 / 412.8 | 21.7 / 12.2 |
| WebGPU | generated house (offline planner) | 56.0 / 206.2 | 3.7× | 349.7 / 501.7 | 30.1 / 16.0 |
| WebGPU | close-up (photographed models, two of the cast) | 61.6 / 236.4 | 3.8× | 250.2 / 425.0 | 32.1 / 15.9 |
| WebGL2 | Lantern Isles | 15.1 / 49.8 | 3.3× | 85.0 / 119.7 | 9.6 / 6.4 |
| WebGL2 | Kart Canyon | 80.5 / 490.5 | 6.1× | 141.0 / 551.1 | 40.7 / 14.1 |
| WebGL2 | Skyline Penthouse | 48.0 / 163.5 | 3.4× | 125.3 / 240.8 | 20.3 / 10.8 |
| WebGL2 | generated house | 56.0 / 206.2 | 3.7× | 149.9 / 300.0 | 24.3 / 12.4 |
| WebGL2 | close-up | 61.6 / 236.4 | 3.8× | 113.0 / 287.7 | 29.2 / 13.0 |
| Firefox | Lantern Isles | 15.1 / 49.8 | 3.3× | 85.0 / 119.7 | 9.6 / 6.4 |
| Firefox | Skyline Penthouse | 48.0 / 163.5 | 3.4× | 125.3 / 223.0 | 20.3 / 10.8 |
| Firefox | close-up | 61.6 / 236.4 | 3.8× | 104.4 / 269.9 | 29.2 / 13.0 |

What is left in "image" with KTX2 on is the cast's tinted copies (RGBA8 canvases baked on the CPU): Kart Canyon's
drivers and crowd are 113.7 MB of them on WebGPU and 49.8 MB on WebGL2 (more tint variants were live in the WebGPU
run). Compressed textures are BC7 everywhere here (`bptc s3tc` reported by all three targets).

Load time (navigation to the last library file) is within noise on WebGPU for the close-up and the penthouse (5.0 /
4.9 s, 6.8 / 8.1 s) but up to 50 % longer for some scenes (Lantern Isles 11.2 / 7.4 s), and on WebGL2 under ANGLE/GL
the KTX2 runs took longer throughout (Kart Canyon 66 / 44 s) on a machine shared with other build and test jobs: the
transcoder's set-up and self-test, normally 0.1 to 0.5 s, took 6 to 41 s there and every model waits for it. Moving
the set-up to catalog load helped on WebGPU; on a loaded machine it remains the cost of the feature.

**Visual checks.** Still pairs at fixed cameras for every scene and target, plus a path-traced pair and the GLB
export (37 images with KTX2, 34 without: compressed textures are exported) for the close-up. Mean absolute
difference 0.01 to 3.2 per channel; luma equal within 0.4 everywhere. Looked at: armchair fabric relief under a low
sun (normal maps read the same way round in all three targets), sRGB albedo (no washed-out or darkened colours,
red tinted top and blonde hair on the tinted body identical), hair-card cut-outs close up (no fringes or holes),
lantern and lamp glass (BLEND), Lantern Isles and Skyline Penthouse foliage. The leaf cards are composed from the
Poly Haven leaf sprites on a canvas at run time and stay RGBA8, so they are unchanged by design (identical in every
pair). Two harness problems were found and fixed on the way: the close-up's ground box z-fought with the default
ground, and the generated house had no fixed camera (its first pair compared two different framings).

**Trade-offs, honestly.** Downloads grow: UASTC normal and ORM maps are 3 to 5 times the 1k JPEGs they replace, so
the twins add 67 MB to the build (24.6 MB of sources; build about 160 MB in 1,400 files, largest file 6 MB, within
Vercel's limits for Git deployments) and a first visit downloads 1.2 to 2.8 times the library bytes (tinted bodies
also fetch their original file once). Library files are cached immutably afterwards.

**Not done.** The photographed surface finishes (`x/`, filled into shared RGBA8 texture arrays at run time) and the
leaf cards stay uncompressed; the tinted copies of the cast stay RGBA8 (a shader-side tint would remove them);
ETC1S could replace UASTC for ORM maps (about a third of the bytes at SSIM 0.89 to 0.93) if downloads matter more
than the brief's UASTC rule.

**Image to 3D.** `docs/IMAGE_TO_3D.md` corrected: TRELLIS.2 needs 24 GB VRAM (upstream README), and its GLB export
imports nvdiffrast and nvdiffrec, both NVIDIA Source Code Licences limited to research or evaluation use. TripoSG
(MIT, 8 GB, shape only) documented as the lower-VRAM option, with its own caveats found in its code: `diso`
(CC BY-NC 4.0) imported at module level, BRIA RMBG-1.4 (non-commercial) for background removal, `pymeshlab` (GPL-3.0).
Hunyuan3D-2 (no rights in the EU, UK and South Korea; over 1 M MAU needs a Tencent licence), SF3D / SPAR3D (free under
US$1 M revenue) and InstantMesh (CC BY-NC Zero123++ weights) listed as not recommended. None of that code ships: the
app has an HTTP client and the GLB validator only, the route exists only with `AETHER_IMAGE_TO_3D_URL`, and the server
now logs a licence notice when it is turned on (tested).

**Gates.** `tsc --noEmit` 0; new suites `packages/assets/test/ktx2.test.ts` (index, checksums against sources,
codec rules, block twins, transcoder and worker identical to three's, encoder planning helpers),
`packages/render/test/texture-compression.test.ts` (support detection, BC preference, byte accounting, block index,
export policy, cast images); `apps/server/test/csp.test.ts` and `image-to-3d.test.ts` extended. Full vitest (Node 24):
4459 of 4460 pass; the one failure is `packages/agent/test/prompt.test.ts` (system prompt 15,986 chars/4 against a
15,800 cap), which fails the same way on main without this work (the prompt grew with the gameplay-effects stage).
Studio build ok; `npm run smoke` 34/34; `npm run bench:quick` checks passed.

## Balustrades on stairs; NPCs on several floors

**Problem.** (1) A person playing who pressed toward the inner edge of an L stair's first flight still wedged the
capsule's top under the slab beside the last treads (the walking-line fix covered only the bot), and nothing stopped
anyone stepping off a flight or landing into the room below. (2) The NPC grid was one floor per level with nothing
between levels: residents stood where they were placed, a guard could not follow the player up a stair, packs had
only separation.

**What changed.** (Design: ARCHITECTURE section 37.)
- *Balustrades.* Every open side of a flight or landing gets a guard with upright box colliders 5 to 45 mm outside the
  edge (the flights keep their full width), 0.9 m above the pitch line, from 0.7 m up a flight that starts at a floor
  (the side landing beside the first treads stays open), under the floor above beside the stairwell and ending where
  its string would rise into the slab. Sides against a wall (the floor 0.2 m out is not the stair's room) get a wall
  handrail on brackets. Glass in a steel shoe (modern), round bars (industrial, mediterranean), painted spindles with
  an oak handrail and newels (scandinavian, japandi, classic); the stairwell railing upstairs follows (new `timber`
  railing). The building check counts them.
- *The step onto a landing.* Pressed against a guard, the character controller failed to autostep the last riser onto
  the landing and stood still (measured: a sloped hull, a pitched box, and with some inputs a wall did the same; a
  plain wall usually passed). Each flight's collider now closes its last riser with a wedge over the last four treads
  (under 40°, no sliding), and the guards are upright boxes about a tread long.
- *Layered NPC navigation.* In a world with buildings: a 0.25 m grid per floor level (bodies 0.3 m clear, steps 0.3 m),
  each stair a link along its walking line with the feet at the treads' height, routes across floors by Dijkstra over
  stair ends and grid regions, preallocated. NPCs walk a stair keeping right, a floor between foes blocks sight and
  reach, guards chase and investigate upstairs, followers follow. Residents have days (`npc.routine`: their spot, a
  room on another floor, a room on their own) and let the player go first on a stair. NPCs open key-operated doors as
  they pass. In doorways they squeeze past frames and step back to the corner when pushed off the path (found on the
  way: residents stood 15 s in a 1.4 m opening, cutting its corner from 0.2 m off the path; and the ground ray stood
  them on sofas and beds, as did the outdoor step of 0.55 m).
- *Steering.* `npc.flock` (cohesion and alignment with the pack), `npc.roam` (Reynolds wander) and an explicit arrive,
  on the seeded stream (Yuka read for the formulas; navcat evaluated and not installed, THIRD_PARTY.md).

**Measured** (Node 24, headless).

| | Result |
|---|---|
| Player pressing into an L's inner edge (1 m, heading north, both turns), 5 s | before: wedged at 1.23 m under the slab, 0.29 m of the capsule past the edge; after: climbs to the upper floor, the capsule stays 0.37 m inside the edge, head clear of the slab |
| Walkthrough bot, 420 stairs (3 widths × straight / L / U both turns × 4 headings × 7 offsets) | 404 pass, never stuck; 15 fail with and without balustrades and without the wedge (stairs shifted 0.2 m into a wall with `exactStairs`; the building check passes them, the bot does not, a gap noted below); 1 fails only with balustrades (a 0.9 m U pushed 0.09 m into a wall: 0.82 m left between the wall and the U's central guard) |
| Three residents, 240 s, two-storey house | 2 or 3 change floors, longest stuck report under 2.5 s (before the doorway fixes: 7 s), feet within 0.12 m of the treads' height on the stair |
| Guard sees the player downstairs, the player runs up and into the bedroom | the guard takes the stair, attacks from 1.35 m in the bedroom |
| 60 NPCs on two floors (routines and patrols across floors) | 0.14 ms per tick, steady state under the allocation budget; 60 NPCs on one floor unchanged (`npc-perf`) |

**Tests.** `arch/test/stair-balustrade.test.ts` (every heading × shape × turn: guards outside the flights, the walking
line keeps the full width, the side landing open, box colliders; the L's inner guard full height under the slab;
fitted stairs get a wall rail on the wall side and pass the building check; style per building; old stairs unchanged).
`playtest/test/stair-balustrade.test.ts` (pressing into the inner edge, guarded and bare; the bot on a balustraded
house). `playtest/test/npc-layers.test.ts` (links, three floors, routes up two stairs and down, unreachable, determinism,
no allocation per route, the NPC check on routines across floors). `playtest/test/npc-floors.test.ts` (residents'
day, feet on the treads, guard chase, a resident yielding to the player on the stair, replay identity).
`playtest/test/npc-floors-perf.test.ts`. `logic/test/npc-steering.test.ts` (arrive, wander, separation, flock; a herd
with flock keeps 15 % closer; roaming; an NPC opening a door that closes behind it). Rebaked casa-patio,
skyline-penthouse, dusk-lake-house (resident routines) and earlier dusk-lake-house, villa-pool (balustrades).
`tests/e2e/npcstairs.e2e.ts` photographs a resident on the stair (rigged cast body, walk clip).

**Looked at** (Intel iGPU WebGL2, realtime; `~/.local/share/aether/stairs-npc/`). The resident climbs the first flight
behind the painted spindles with the walk clip, crosses the landing mid-stride and comes up the second flight toward
the upper floor, feet on the treads; glass (modern), steel bars (industrial) and timber (classic, scandinavian)
balustrades on the same L stair from the hall. Fixed on the way: the timber stairwell railing upstairs had oak
spindles beside the stair's painted ones (now painted too); a U's central balustrade stood up 0.9 m beside the top
step (it now ends where the flight reaches the floor above, as the outer ones do). Glass reads mostly by its steel shoe
and cap rail in the realtime look.

**Still open.**
- Stairs pushed into a wall with `exactStairs` (15 configurations above): the building check says every room is
  reachable while the bot fails; the check does not measure the flight's own clear width against walls.
- Waypoints and routine stops take their floor from `y`; older worlds that wrote `y = 0` for an upstairs patrol would
  send it downstairs in a building with stairs.
- NPCs pass through each other on a stair when they meet (they keep right; there is no queueing), and in a crowd stress
  test 60 people use one stair at once. Dynamic (physics) NPCs are steered along a stair's line but not tested.
- The routine and flock fields add 9 tokens to the system prompt (`agent/test/prompt.test.ts`, under its budget on
  the final main).

**Gates.** `tsc --noEmit` 0 errors; vitest 417 files, 4 509 tests pass; studio build; `npm run smoke` 34/34;
`npm run e2e:verified` passed (Chromium and Firefox); `showcase:bake --check` up to date.

## Game feel and gameplay effects

**Problem.** Games were silent and static: no screen shake, hit-stop, squash or feedback presets anywhere, and no
gameplay particles (the only particles were weather; a torch's flame was an emissive sphere). three.quarks, the obvious
library, does not render on `WebGPURenderer` today.

**What changed.**
- World IR (additive): `world.feel` (tier and per-event cues for pickup, hit, damage, death, win, checkpoint, jump, land,
  explosion, launch), `entity.vfx` (continuous emitters), the `effect` rule action, `setMeta.feel`. Worlds without them
  are unchanged byte for byte; the presets live in `@aether/core` (`resolveFeelCue`).
- Logic: an optional `host.feedback` reports those moments with place, signed amount and the tick (the burst's seed).
  Nothing is read back: the same world produces the identical trace with no feel layer, a recording one and one that
  throws (`packages/logic/test/feedback.test.ts`).
- Render: `FeelDirector` (trauma-squared seeded shake applied for the draw only and restored, hit-stop, FOV kick,
  flash and vignette pulses, body squash, reduce motion) and `VfxSystem`: own TSL particles, two instanced draws over
  fixed rings, written once at birth and evaluated in the vertex stage, thirteen presets, tier budgets, floor-soft edges,
  emitters that follow scene objects (including the torch in a character's hand).
- Studio: floating score / damage text, flash and vignette overlay, rumble, audio ducking (footstep bus, published
  games' music), landing and jump detection, footstep dust and splashes by surface, hit-stop that postpones fixed steps,
  reduce-motion switches (studio settings, published games' pause menu, system preference), a Game feel inspector
  section with previews, the `effect` action in the rule editor.
- Agent: `tune_feel`; the local edit engine answers the common feel requests without a model; the offline planner gives
  new games a tier by genre and lights what burns. The system prompt stays under its 15.8k-token budget: the guidance
  lives in the tool description.

**Rounds (looked at in captures, `scripts/feel-shots.ts --gpu`, Hollow Gate and Neon Rain City).**
1. Explosion core: 34–42 additive puffs at intensity 4.5 blew out to a white disc with bloom over a third of the frame.
   Now 24–30 at 1.9, shorter lived, darkening to ember red, the shockwave ring 5 m at half opacity.
2. Campfire: the fire emitter at scale 1.4, rate 46 and intensity 3.6 stacked into a white blob on the generator's own
   glowing logs (night, bloom 1.2, the eye adapted up). Now rate 30, intensity 1.5, scale 1.1: a readable flame with
   embers.
3. Damage read as nothing in stills: the flash (τ 0.11 s) and vignette (τ 0.32 s) were gone before the screenshot
   landed. Lengthened to 0.14 / 0.45 s and the vignette starts nearer the centre; captures now freeze the effects
   (`fx.paused`), and the frame shows the red flash, the red edges, red sparks round the player and "-10".
4. The capture script's title-card click missed (an animated card); it now clicks the element directly.

**Gates.** `tsc --noEmit` 0; full vitest 417 files / 4509 tests; studio build; smoke 34/34; `e2e:verified` passed
(Chromium and Firefox); `bench:quick` checks passed; allocation probes:
an effects frame with six emitters allocates under 16 B (a burst under 96 B); `npm run e2e:vfx`: Chromium WebGPU,
Chromium WebGL2 and Firefox WebGL2 all render every preset with no shader or validation errors (16.8–16.9 % of the
frame changed; each preset changes 29–100 % of its own neighbourhood); bundled worlds rebaked
(feel and emitters only) and `showcase:bake --check` clean.

**Gaps.**
- Soft particles fade against the emitter's floor and near the camera, not against the depth buffer (WebGPU cannot
  sample its multisampled depth without the extra scene pass the water uses); a puff that meets a wall shows a hard
  edge.
- Continuous emitters run on the render clock, so their exact particles differ between machines; bursts are seeded by
  the logic tick and identical for the same run.
- No hit reaction for the player's own blows (there is no player attack in the shipped games) or for physics impacts
  between props; thrown props landing make no dust.
- Rumble works where the browser exposes `vibrationActuator` (Chromium); Firefox on Linux usually does not.
- Headless captures on this machine run WebGL2 over ANGLE/GL; WebGPU was checked by the e2e on SwiftShader, not on the
  real GPU.

## Rooted plants, leak-free interior light and photographic foliage (stage `look3`)

**Problem.** Generated trees were centred on their bounding box crown included, so any change to the leaf cards moved
their trunks up to 0.6 m in every world (the Lantern Isles regression). Interiors showed a bright halo along door
frames and the wall-floor junction: the 0.45 m light volume interpolated probes from behind thin walls, slabs and door
frames (outside light, the sunlit room next door), and probes buried in a wall were filled from both sides. Ceilings
read flat and dim brown: room lamps were clipped just above the lamp (under a tall ceiling) and a wood floor's bounce
tinted every white surface. Spot lights lit through floors. Up close, hedges were boxes under yellow-green paper
cards; needles, blossoms and flowers were procedural.

**What changed.** (Design: ARCHITECTURE section 36, including "Leaks" and "Plants stand on their root".)
- *Rooted plants.* `build({ anchor: 'root' })` (`ROOTED`) for trees, shrubs, ferns, grass, flowers, cacti and hedges:
  the root point built at the origin stays at the entity position. Trunk paths start at the origin, flared bases are
  flattened onto the ground, shrub cards and low spruce sprays stay above it, barrel cactus ribs fade at the root.
  The bush (a lumpy mound with no trunk) and rocks keep bounds centring. Contract test rewritten for rooted plants,
  plus a test that trunks stay at the origin across crown detail and bare winter crowns.
- *Lantern Isles.* With trunks back on their roots the bot dropped through the 1.3 m seam between a rune lift and the
  summit rim (it stalled at the platform edge). Lifts are now 3 m in the same 4.8 m gap (0.9 m seams; islands
  unchanged). A sweep of lift sizes showed the bot's lift boarding is sensitive to geometry (2.2/2.6/3.0 m pass,
  2.8/3.4 m fail): reported, the bot is another stage's.
- *Leak-free light volume.* Each probe stores its free distance along six axes (quantised down, buried probes zero) in
  a fifth atlas sub-volume; the shader reads the eight surrounding probes' distances, drops those that do not see the
  point and samples the light at the point matching the remaining per-axis weights (8 unfiltered + 4 filtered reads).
  The bake's bounce reads do the same, so a thin wall keeps a sunlit room out of a dark one (new test: a 0.12 m party
  wall; the dark face reads 0 % of the lit face's bounce, 15 % without the test). A wall-aware two-pass blur takes
  the 48-ray noise off ceilings.
- *Lamps and spots.* `RoomSpot` (IES-aware) is clipped to its room like `RoomLamp`; clip boxes run on the wall
  centrelines with an 8 cm fade (a 25 cm fade and 15 cm margin lit a stripe of the neighbour's walls along every
  corner) from the slab top to 8 cm above the room's ceiling (the ceiling is lit, the floor above is not).
- *Eye.* Interior white balance from the room light's red-blue ratio at the eye (45 % of the cast beyond a lived-in
  1.25 taken out), slightly warm grade on top; the eye makes up 88 % of the drop from the open site (was 75 %), up to
  4 stops (was 3: the two-window kitchen clipped at 3).
- *Wall corners.* Faces run 4 mm past a joined corner, closing sub-pixel seams.
- *Foliage.* `hedge` generator: small leaf-cluster cards over a rounded block (lumps, rounded edges, deep shade low
  and inside, lit top and sun side, every card inside the block) over a dark core; garden hedges in runs up to 6 m,
  Four Seasons Garden hedge rebuilt from it. Needle, blossom and flower cards composed from CC0 Poly Haven fir sprays
  (Fir Tree 01), periwinkle and celandine flowers and gazania heads (SHA-256 pinned in `assets/foliage-sources.json`,
  THIRD_PARTY.md), blossoms and flowers drawn grey so the vertex colour sets the petal colour. Darker, more saturated
  leaf tones with less yellow in the sun, wider plant-to-plant variation, gentler translucency, hand-sized shrub
  clusters (within the shrub's triangle test budget).

**Rounds** (Intel iGPU WebGL2 low tier unless noted; the RTX 4090 was busy with training throughout;
`~/.local/share/aether/look3/`): r1 leak test alone (door-bottom and skirting glow gone); r2 white balance, probe
blur, lamp clips (found the lamp boxes lighting the neighbour's corners and the ceiling below, the 0.25 m fade being
wider than interior walls); debug toggles (volume, sun, shadows, contact, lamps, textures, normal offset, hidden
entities) on a kitchen corner; r3 hedge, sprites, tones, house and forest; `r4high` HIGH tier on the iGPU; r5 gentler
balance; r6 fuller exposure; `flag/` Villa Pool, Four Seasons Garden, Lantern Isles, Dusk House and Skyline Penthouse
covers. Before images: `~/.local/share/aether/look2/r6` and `flag-r8`.

**Before and after.**
- *House living room*: glow along the door frame, under the door and along the skirting, warm sepia walls and a brown
  mottled ceiling → no glow, neutral white walls with a light ceiling and its downlights; flatter than before (part of
  the old gradient was the leak).
- *Kitchen*: right wall brighter toward the window through the wall leak, grey → leak gone; with the fuller exposure
  the walls read light grey, still somewhat cool and flat (no sun enters it).
- *House exterior*: foreground hedge a heap of large yellow-green cards → a clipped hedge of small dark-green leaf
  clusters with depth, a shaded side and a dark interior.
- *Covers*: Lantern Isles, Four Seasons Garden and Penthouse keep their composition; the garden's hedge reads as a
  hedge from above.

**Verification.** `tsc --noEmit` 0 errors; vitest 417 files, 4 509 tests (new: rooted trunk test, leak and free-distance
packing tests, white balance, room spot, sprite sheet kinds and the missing-sprite fallback; updated: the generator
contract for rooted plants, atlas size for five sub-volumes, the IES spot now a `RoomSpot`); studio build; `npm run
smoke` 34/34; `npm run bench:quick` checks passed; `showcase:bake --check` up to date (Lantern Isles, Villa Pool and
Four Seasons Garden rebaked); every showcase playtest, gamesVerified and walkthrough test passes.

**Security.** The sprite script still only downloads from `dl.polyhaven.org`, size capped and SHA-256 checked; the
free-distance codes go through the existing validated worker reply (length and finiteness). No new dependency.

**Performance.** Per lit fragment in a building: eight more unfiltered 3D-texture reads and some ALU for the leak test;
the atlas grows from 2.2 to 2.8 MB (allocated once). Bake: six axis rays and a blur per probe (a few percent). Hedges
cost about 6 000 triangles per 6 m run (Four Seasons Garden: 40 runs at detail 0.6).

**Honest gaps.** No RTX 4090 frame-time numbers (busy). HIGH tier on the iGPU looks hazy and low in contrast indoors
(screen-space AO/GI noise there); not tuned. A thin light band remains along some wall-ceiling junctions and inside
corners; it does not change with the volume's normal offset and shows with the volume off, so it is geometry or
material, not the light: not found this stage. Box lamp clipping cuts lamp light hard at a doorway between rooms
(no lamp shadows). Cards are not shrunk near the camera (no per-card centre in the vertex data); big tree cards are as
before. At dusk the darker leaf tones read olive-brown. The playtest bot's stair and lift handling is sensitive to
centimetre changes of its walking grid's origin (a hedge 1 cm longer broke the villa's walkthrough; hedge runs are
now exact): reported for the bot's owners. Dusk House's cover opens with its storeys apart (the lookshots cover, not
this stage's change).

## Lifts ridden by their clock (playtest bot, `BOT_VERSION` 3)

**Problem.** The bot's lift handling depended on geometry it did not model. A sweep of Lantern Isles' rune-lift decks
showed 2.2, 2.8 and 3.4 m failing while 2.6, 3.0 m passed; the stage that anchored trunks to their roots had to
widen the lifts to 3 m to get past a 1.3 m seam. A sweep of a plain floor, lift and ledge world (63 feasible
configurations: decks 1.0-4.0 m, gaps 0.3-1.5 m, slow to quick, 1-12 m of travel) failed 28 of them on the old bot.

**What it was (measured with per-frame traces).**
- *The graph's lift edge picked its nodes badly.* The boarding node was the nearest one at least 0.2 m from the deck
  (not necessarily at the edge, nor across the gap that was really there), the landing the one nearest the deck's
  centre (a node far into the ledge for a wide deck), with no check that the gap could be crossed at all: the planner
  found "no walkable route" or the bot walked off the edge.
- *Riding ignored the lift's rhythm.* It waited until the deck was within 0.1 m of its start, then walked to the
  centre and, at the top, walked to a node: with the deck level for 0.3 s the crossing was begun and abandoned.
- *The lift's start pose was read from the live session.* The session has run on while the nav grid was built, so a
  deck caught mid-travel gave a wrong "top of the deck" (the bot believed the deck 3 m below where it was).
- *A resting kinematic deck stops the capsule.* Teleporting the capsule onto a resting kinematic box and pushing
  forward moves it 0.3-0.6 m and then nothing (the controller reports 20 contacts at time of impact 0 and a zero
  movement; the same box as a static body, or the deck while it moves, is walked normally). That is why the old bot
  made it across some sizes and not others: it depended on how far from the deck's rim it needed to walk. Not fixed
  here (physics is another stage's); worked round, and reported below.

**What changed** (`packages/playtest`, no change to generators or physics).
- `lifts.ts`: a patrol is read into a `LiftClock` (pause, travel, mode `pingpong`/`loop`/`once`, any number of
  waypoints): deck top at any moment, spans within a band of heights, the longest stay, the mean wait for a window,
  and a `sync` that lines the clock up with the live deck when it drifts (it follows the live deck to 0.03 m over many
  cycles; test). `wireLift` joins ground level with the lowest stop (a drop of up to 0.7 m onto the deck, a step of up
  to 0.4 m up to a resting one) to ground level with each stop above it (a short hop up or a drop). Gaps are measured
  with rays along the line to the deck, a jump limit comes from the player's abilities, and the stay of the deck
  within reach of the stop must cover the crossing. A lift that cannot be used is kept with the reason.
- `liftride.ts`: wait at the boarding point until the clock says the deck is level for long enough; cross by a run
  (gaps up to `runGap`, 1.27 m at the default speed and gravity, where the capsule has dropped less than about half
  its radius when it reaches the far edge) or by a jump whose thrust is steered every tick to land on the deck's
  centre (the deck must then stay level for the whole flight: 1.2 s plus 0.4 s); stand still; at the landing jump
  off with the same steering, at once, when the deck is level with it. A resting deck is never walked over for more
  than a few steps (hops instead). Falls, a deck that left early, and a ride that takes more than three cycles are
  named in the finding.
- Planner: the ride edge costs the larger of its span and the expected wait plus the ride; a lift that cannot be used
  has no edge. New finding code `lift_unusable` (error when something required stays undone, otherwise a warning)
  with the reason in words: the gap and the longest jump, the seconds the deck stays level against the seconds the
  crossing needs (and the lift's speed and pause), or how far the nearest ground is from the stop it tops out at.
- `BOT_VERSION` 3. Documented in ARCHITECTURE and CONTRACTS.

**Measured.**

| | Old bot | New bot |
|---|---|---|
| Feasible sweep (63 worlds: 35 widths x gaps, 24 speed/pause/travel, 4 odd ones) | 28 failed | 63 passed |
| Lantern Isles with all three decks at 1.5, 2.2, 2.6, 2.8, 3.0, 3.4, 4.0 m | 2.2, 2.8, 3.4 failed | all pass |
| Broader exploration (widths 1/2/4, gaps 0.3-5.5, four rhythms, 2 and 6 m): 168 runs | not run | 72 passed; the other 96 are reported lifts that cannot be used, each with its reason (no unexplained failure) |

Flagships, simulated time, old to new: Chain Reaction 14.88 s (same), Highland Trail 78.65 s (same), Lantern Isles
65.58 to 64.98 s, Hollow Gate 45.17 s (same), Neon Rain City 63.43 s (same), Kyoto Temple 32.65 s (same), Orbital
Lab 39.17 s (same), Painterly Meadow 40.73 s (same), Four Seasons Garden 29.82 s (same); the generated platformer's
lift (obstacle course) 9.47 s (same). Wall time unchanged within noise (Orbital Lab 11.1 to 11.7 s, the rest 1-7 s).
All 15 flagships: the nine the bot plays pass in `gamesVerified` with sealed, re-checked runs; Kart Canyon, Sakura
River, Blockfall have their own bots (`showcasePlaytest`, passing), and the three buildings their walkthrough.

**Other moving platforms checked.** Orbital Lab's cargo lift (3 m deck, 9 m, 1.8 m/s, 2 s pause) and the generated
platformer's lift (2.6 m, 1.4 m, 0.9 m/s) are read and ridden. Kart Canyon's, the train's and the city's movers are
sensors or characters (not decks); Sakura River's ferry is a vehicle game with its own bot. Nothing shipped has a
horizontal deck.

**Tests.** `packages/playtest/test/lift-sweep.test.ts` (80): the clock against the live deck over 30 s and its
band queries; 63 feasible lifts must be ridden to the top; four infeasible ones (a 6 m gap, a quick lift that never
pauses, a lift that stops short of the landing, one that overshoots it) must fail inside 60 s of play with a
`lift_unusable` finding naming the reason; Lantern Isles at seven deck sizes; Orbital Lab and the obstacle course
with no lift left unusable; the same lift twice gives the same run; a lift with a pause at a middle stop lets the
player off there. Gates: `tsc --noEmit` 0 errors; playtest and verifier vitest 36 files, 337 tests; agent 51 files,
809 tests; studio 92 files, 671 tests (includes `gamesVerified` and `showcasePlaytest`); studio build; smoke 34/34;
`e2e:verified` passed (Chromium and Firefox).

**Honest gaps.**
- A jump onto the deck needs the deck level for 1.6 s: a lift with a gap wider than 1.27 m that pauses for less is
  reported as unusable although a person might time it. The limits (runGap, longest jump 0.8 of the physical reach
  less 0.55 m) are conservative.
- Only the waypoint heights are stops: a deck that passes a ledge between two waypoints is not a way off.
- Horizontal and orbiting decks, and lifts that start at their top, are not modelled (planned on the start pose, as
  before); a platform that rotates is not either.
- The resting-kinematic stall is a defect of the character controller seen by the bot; a person on a lift that has
  paused very likely feels it too (walking on the deck stops after a few steps while jumping works). It deserves
  its own fix in `packages/physics`.
- The Lantern Isles generator keeps its 3 m decks; the bot no longer needs them, so they can go back to a smaller
  size when someone wants the look.

## Walking on kinematic decks (character controller)

**Problem.** A player capsule walking on a resting kinematic floor (a lift deck that has paused, a moving platform at
rest, any `body: 'kinematic'` box) stopped after 0.3-0.6 m; jumping worked, and a floor that moved was walked
normally. The playtest bot had worked round it with hops (previous section).

**Cause (measured, headless).** Reproduced with a bare Rapier world (no Aether code): a kinematic box under the
capsule, a controller with a 0.02 m offset, the usual downward gravity step plus a sideways step. The controller
reports 20 contacts, all at time of impact 0 with the floor's upward normal, and applies zero movement (the cap on its
iterations). The same box as a fixed or as a dynamic body slides normally. The stall is tied to the small downward part
of the step against a kinematic obstacle: with a vertical part of zero or above, or a larger offset, it mostly goes
away (the outcome changes with the offset by millimetres, i.e. a tolerance effect in the engine's shape cast, not
something the settings control). Not the cause: autostep, snap to ground, the capsule's collision types, friction, the
kinematic body's velocity mode, normal nudge. Rapier carries a character with a kinematic floor by itself (full floor
displacement per frame, rotation included) but only on frames in which it does not loop, so a rider on a floor moving
sideways slipped back by 0.5 m over a second.

**Fix** (`packages/physics/src/character.ts`, `CharacterController.move`). When a move touched the upward face of a
kinematic body and the controller looped (8 or more contacts in one move) or lost more than half of the sideways step,
the move is redone in two phases: sideways with a 1 mm upward bias, then the remaining vertical motion alone, with
ground detection from the second. The redo is used when it is grounded or the first was not. Fixed ground never takes
this path, so every recorded run on static worlds is bit-identical (full suite, `gamesVerified`, `showcasePlaytest`,
`showcase:bake -- --check` unchanged). Platform carry stays Rapier's own: with the loop gone it works every frame
(an own carry on top of it doubled the movement; setting the body's velocity to zero does not reach the controller).

**Tests** (`packages/physics/test/character-platform.test.ts`, 12): a resting deck walked 5 m (not behind the same
box as a static body), human feel, other directions and diagonals, a wall on the deck, the deck's edge (walks off and
falls), stairs beside the deck, carried by a deck moving sideways (within 0.08 m of the deck over 2 s), a lift going up
and down (feet within 0.08 m of the deck top), walking across a rising deck, a rotating deck, a jump from a resting
deck (not carried in the air), and the same inputs twice giving identical positions. Eight of them fail without the fix.

**Bot.** `liftride.ts` walks to the middle of the deck (1.5 s, three tries) instead of hopping there; hops remain for
gaps wider than a run and for leaving the deck. `lift-sweep` 80/80 as before. `BOT_VERSION` stays 3: no verdict of a
shipped world changed, and a bump would only re-stamp proofs. Lantern Isles keeps its 3 m decks: a smaller deck means a
rebake of a bundled world for a cosmetic gain, which was not worth the churn (the sweep over deck sizes passes at 1.5 to
4.0 m, so it can be done when someone wants the look).

**Gates.** `tsc --noEmit` 0 errors; full vitest 419 files, 4603 tests; studio build; smoke 34/34; `e2e:verified`
passed (Chromium and Firefox); `showcase:bake -- --check` up to date.

**Honest gaps.**
- The cause is in the engine; the fix is a workaround keyed on its symptom (looping on a kinematic floor), not a
  change of the engine. A different engine version may make it unnecessary (the tests would then still pass).
- A rider is carried with the platform's motion of the last step, so on a platform that changes direction abruptly the
  rider lags by up to one frame (2 cm at 1.5 m/s); jumping off a fast platform does not inherit its velocity.
- The first frame on a new kinematic floor uses the engine's own carry, which is not always applied.
- A fixed deck slows a walk by about 3 % over 5 m (a one-frame contact per step); kinematic decks do not.

## Sun shadows: focus cascades, contact hardening and contact shadows

**Problem.** The sun had one shadow map fitted to the content, 15 to 30 cm per texel on a 300 m level and blurred
further by PCF. People, tents, benches, grass tufts and boulders had no shadow of their own, tree shadows at the cover
distance were faint smudges, and the depth bias (a fixed fraction of a range up to a kilometre) could lift a shadow
half a metre off the ground. There were no contact shadows and no penumbra that widens with distance from the caster.

**What changed.** (Design: ARCHITECTURE section 39.)
- *Focus cascades* on three's `CSMShadowNode` (its cascade lights, maps and life cycle) with Aether's placement: two
  boxes around the focus of the view (the followed player, the orbit target, or the surface below the centre of a
  posed view, ray cast at most 4 times a second and for each capture pose), each 3.5 times the last, texel-snapped
  and resized in √2 steps with hysteresis, plus the content fit as the outermost map (up to 320 m half size), chosen
  per fragment by containment with an 18 % blend band. Three's frustum-split placement was not used: it spends the
  finest map on the air in front of an orbit camera. World-space biases per map.
- *Contact-hardening filter* (`SoftShadowFilter`, TSL, the idea of drei's PCSS rewritten): the blocker search keeps
  the hardware depth comparison (bilinear taps; the sun shafts still march the outer map) and estimates the blocker
  distance from comparisons at four depths (E[D] = ∫ P(D > Δ) dΔ); penumbra = distance × the sun's apparent size
  (1.1°), at least 1.2 cm; taps rotate per frame for temporal AA. Tap counts are uniforms.
- *Screen-space contact shadows* (three's `SSSNode`) on the sun's direct light on high, ultra and stills, a `contact`
  effect with its own Settings switch; the instanced furniture footprints stay on every tier.
- *Tiers.* Low, block worlds, content under 16 m and software rasterisers keep the single fitted map with PCF. Medium,
  high, ultra and stills share one shader shape (three maps, the soft filter; taps 3/6, 6/10, 6/12, 8/16; 1024² near
  maps on medium), so a tier change rebuilds no material.
- *Tooling.* `renderer.sunShadowInfo`; `gpu-parity` configs `sun-medium`, `sun-high`, `sun-ultra` (plan as on a
  hardware GPU, assert every map is drawn); lookshots and render-bench run on the integrated GPU (`GEN_GPU=intel`);
  lookshots parses the `@` camera form in explicit cameras.

**Rounds** (Intel UHD 770 over WebGL2; the RTX 4090 was at 100 % with the user's training throughout; captures in
`~/.local/share/aether/shadows/`):
- r0/r1: baseline and first cascades. First captures fell back to SwiftShader WebGPU (the software plan keeps the
  single map by design); redone on the iGPU over WebGL2. The hiker's shadow came out detached and blurred: the play
  camera's focus was the stale orbit target 108 m away (fixed: the rig reports its followed subject) and the outer map
  had inherited about 0.5 m of depth bias (fixed: world-scaled biases).
- r2: generated sunny forest and house before/after; screen-space contact shadow A/B (subtle, at the bases of grass
  tufts and feet; the first A/B was invalid because adaptive resolution dropped one run to a lower resolution, so every
  later capture pins it off). A horizon cover view focused 250 m away; the focus ray now goes through the lower part of
  the frame.
- r2 bench: ultra and stills ran with no post at all. Each tier change rebuilt every lit material (2/3/4 cascades per
  tier), and the transient heap (250 to 700 MB) tripped the studio's 600 MB low-memory switch. One shader shape for
  every tier above low fixed it: 235 to 430 MB over eight tier changes, every tier keeps its effects.
- r3/r4: medium rendered every caster black (a no-search variant of the filter on WebGL2); dropped, medium takes a
  3-tap search. Draw-call probe: 368 casters cull themselves (`frustumCulled` off) and three drew all of them in
  every near pass; near passes now skip those whose light-space footprint misses their box (exact for a directional
  light): the two near maps went from about 24 ms to about 4 ms a frame on the iGPU.
- r5: Firefox (WebGL2 on Mesa's software GL under xvfb, plan forced to hardware) draws the three maps and matches
  Chromium on Casa Patio; WebGPU (SwiftShader, plan forced) compiles and draws every map at medium and high with no
  validation errors.
- final: before (main without these commits) and after on highland-trail (cover, play, camp), casa-patio (cover,
  mid), a generated sunny forest and a generated house, all at high.

**Before and after.**
- *Highland Trail play*: the hiker stood on the grass with no shadow → a shadow that meets his boots, sharp at the
  feet and softer toward the head; grass tufts, the tent, the bench and the NPC are grounded.
- *Highland Trail cover*: faint tree smudges → readable tree and pine shadows on the meadow.
- *Casa Patio*: shrub rows cast proper shadows across the ground at golden hour; wall and vine shadows on the house
  are softer at their far ends.
- *Generated forest*: the boulder and tufts get shadows, the clearing shows light pools between the pines; crowns are
  darker inside (leaf self-shadowing the old map was too coarse to resolve), so the forest reads darker overall.
- *Generated house*: the old hard diagonal shadow edge across the hedge is gone; the facade carries the tree's shadow.
  Interiors are unchanged by design (the shell fit and the baked room light).

## Look pass 4: leak-test slack, interior warmth, doorway lamps, leaf cards, Dusk Lake House cover (stage `look4`)

**Problem.** Known gaps from the previous look stage: a pale band along wall-ceiling joins and inside corners, kitchens
reading cool and grey, lamp light cut hard at a doorway between rooms, leaf cards at full size next to the lens, the
Dusk Lake House cover opening with its storeys apart, a hazy high tier indoors and a dusk exterior to check.

**What changed.**
- *Light volume leak test* (`probeSees`, the shader and the CPU read). A free-distance code holds the low end of a 6.4 cm
  step, so a probe 23 cm from a wall could read the wall 8 cm too close and reject every point in the last few
  centimetres in front of it. The slack was zero; it is now 1.6 steps (`FREE_SLACK`; a 0.12 m wall is 1.9 steps, so a
  probe behind it still sees nothing). When no probe sees a point, the fallback weight goes to probes that are not buried
  in a wall (the fallback used to be plain trilinear, which mixed in the wall probes' bright both-sides fill). A probe
  buried in a wall (all six distances zero) keeps none.
- *Room lamps through doorways.* Open apertures of the building (arches without a leaf) become portals of the lamps of
  their room, so a lamp's clip box no longer ends in a straight cut at the doorway (`roomApertures`, `setPortals`).
- *Foliage.* Light that crosses a leaf is filtered twice, so the transmitted colour is the leaf's own squared (gain 2.4):
  backlit leaves glow saturated green at sunset instead of olive-brown. Cards dissolve with screen-door dither between
  0.3 and 1 m from the camera (`FOLIAGE_NEAR_FADE`; temporal AA softens it).
- *Interior grade.* `INTERIOR_WARMTH` 0.18 to 0.45 (white-balance shift of a fully adapted interior view).
- *Dusk Lake House cover.* The cover camera now stacks the storeys and uses the cutaway view (was exploded).
- *Tooling.* `renderer.setLookTweak` (contrast, saturation, exposure, temperature multipliers on the grade, for look
  rounds), `GEN_GPU=intel` in the e2e Chromium args, `AETHER_OUTDIR` for the studio build output, `STATIC_DIR` honoured by
  the e2e server check and `archshots`.
- Casa Patio rebaked: its world file was stale on main (wall dado params no longer carry the default style and panels,
  from another stage's change).

**Rounds** (Intel UHD 770 over WebGL2, software and discrete GPU not used; captures in `~/.local/share/aether/look4/`):
r0 baseline (generated two-storey house, four views); r2 first build with the stage's uncommitted edits; dbg1 to dbg22
isolation tests on the kitchen corner (lights, environment, volume, textures, hidden walls, per-fragment flags, a CPU
replica of the shader read run in the page); r3 high tier, sunset exterior, leaf close-ups and the cover; r4 temperature
sweep; r5 to r8 after each commit.

**Findings from the isolation runs.**
- The kitchen's light comes from the volume alone once the other lights are off, and the band persists with the sun,
  the hemisphere, the lamps, the environment, every texture and the sky hidden: it is not geometry, material or sky seen
  through a crack, it is the volume read. Rows of pixels across the corner: the band is 2 to 4 pixels wide and 80 to
  110 levels above the wall.
- Along ceiling joins it was the zero slack above (a CPU replica of the read gave a leak-test weight of 0 for points 4 to
  9 cm below the ceiling; 0.4 to 0.5 with the 1.6 step slack).
- The vertical band at the inside corner of the generated house is **not fixed**. The CPU replica of the read gives a dark,
  smooth answer there (one unburied probe, bounce 0.047 against 0.093 on open wall), the GPU draws it bright, and the
  fragments that are bright are 4 to 8 cm before the corner on the wall face, not at the corner line. Not found: a
  wall-geometry change (dropping the mitre end caps) did not move it, so it was not kept.

**Measurements** (generated house, 1600 x 900 low tier composite unless noted; luminance 0 to 255):

| | before | after |
|---|---|---|
| ceiling join, kitchen, column x = 650 (peak above its neighbours) | +8 to +15 | 0 |
| ceiling join, kitchen, column x = 950 | flat | flat |
| vertical inside-corner band, kitchen (band minus wall) | 217 to 240 against 154 | 217 to 232 against 150 (unchanged) |
| vertical inside-corner band, living room | 194 to 226 against 127 | 196 to 218 against 125 (unchanged) |
| kitchen wall mean RGB, low tier | 154 156 152 (red/blue 1.013) | 153 153 145 (1.055) |
| kitchen wall mean RGB, studio quality | 139 140 138 (1.007) | 137 136 131 (1.046) |
| kitchen wall mean RGB, high tier | 127 128 125 (1.016) | 129 127 122 (1.057) |
| living wall mean RGB | 115 111 104 (1.106) | 118 111 101 (1.168) |
| high tier kitchen, luminance mean / stddev / 5th to 95th percentile | 107 / 27.8 / 62 to 135 (look3) | 101 / 28.4 / 57 to 130 |
| low tier kitchen, 5th to 95th percentile | 71 to 148 (r0 baseline, blotchy dark ceiling) | 109 to 161 |

The high tier indoors is not hazy in these captures (range 73, contrast unchanged from the previous stage); the low
tier is flatter than the r0 baseline because the dark blotches along ceilings and corners are gone (the 5th percentile
rose from 71 to 109), not because the highlights came down.

**Before and after.**
- *Kitchen*: cool grey walls with a white hairline along the ceiling joins → neutral to warm white walls, ceiling joins
  clean, the inside-corner hairline remains (faint in studio quality, clear in the realtime tiers).
- *Sunset exterior (generated house)*: leaves read saturated green and backlit, lit windows and a pink and violet sky;
  the pool reads flat and pale (not touched).
- *Leaf close-up (shrub at 1 m)*: readable leaves with a dither at the card edges; a hedge seen from 0.95 m in shade shows
  its dark core as a flat black wall (the hedge generator's core is baked into Four Seasons Garden; not changed here).
- *Dusk Lake House cover*: two storeys apart in the air → one house, cutaway, lit rooms visible.
- *Doorway lamps*: portals added with unit tests; not captured in a still of its own (the genlook house has no
  open archway between lit rooms).

**Verification.** `tsc --noEmit` 0 errors; vitest for `packages/render` 750 tests, `packages/arch` 475 tests (new: slack
and quantisation test for `probeSees`, aperture portals for room lamps; one allocation test in `assets.test.ts` failed
once under machine load and passed alone and on a rerun); `showcase:bake --check` up to date after the Casa Patio rebake;
`npm run smoke` 34/34.

**Honest gaps.** The vertical inside-corner band (above). Doorway lamps and the dusk house interior were not captured
side by side. The hedge core is black in shade up close. Close-up cards dissolve rather than shrink (no per-card centre
in the vertex data). The interior warmth is one global constant, not derived from the rendered colour. The captures are
iGPU WebGL2 and low-resolution studio refinement, so grain in the high tier is the iGPU's.

## Load and runtime performance

Why opening a world was slow, what was changed, and the numbers. Everything below was measured with
`npm run e2e:load-perf` (new: `tests/e2e/load-perf.e2e.ts`) on the production build of `apps/studio`, headless Chromium
(Playwright build 1248) on this machine's integrated GPU (Intel UHD 770, WebGL2 over ANGLE and Mesa; `GEN_GPU=intel`
with `navigator.gpu` hidden, otherwise the studio picks a software WebGPU adapter), 1280 x 720, device pixel ratio 1,
cold HTTP cache each run, CPU throttle through CDP `Emulation.setCPUThrottlingRate`. The 4090 was not used. The
machine was shared (load average 5 to 9 during the runs that are compared, up to 40 during exploration), so single
numbers carry about +-15 %; the changes below are larger than that where claimed. "Open" is the time from navigation
until the load screen is gone and the scene is synced; "blocking" is the sum of main-thread long-task time beyond 50 ms
over the same load (the page is frozen for that long); "frame" is the median interval of a slow camera orbit with the
automatic tier and adaptive resolution untouched.

**Dev server versus production.** The slowness over the tunnel is partly the Vite dev server: home page 369 requests and
17.1 MB (16.7 MB of unbundled, unminified JS) against 53 requests and 2.55 MB raw (1.15 MB on the wire from Vercel, 0.66 MB
of it JS) for the build; Highland Trail 757 requests and 54.6 MB against 148 requests and 19.4 MB raw. Judge load times
from `npm run build` and `vite preview` (or the hosted site), not from `vite dev`.

**The build itself** (before any change): `dist` is 164 MB, of which `assets/lib` 130 MB (`k/` KTX2 twins 68 MB, `m/` models
31 MB, `c/` characters 13 MB, `h/` HDRIs 7.4 MB, `x/` PBR JPEGs 6.1 MB, `t/` 3.1 MB), `blocks` 7.3 MB, `templates` 7.1 MB.
Entry chunks are small and the heavy ones are lazy: the three.js chunks (985 KB, 279 KB brotli) load when the editor
opens, Rapier's 3.1 MB wasm only when Play starts, the 6.1 MB WebLLM runtime only when chosen, the KTX2 transcoder
(0.5 MB) with the first model that has a twin. Nothing heavy blocks the home page. The module preload list is 26 chunks.
Vercel serves `/assets/*` immutable and brotli-compressed (GLB, HDR and wasm included).

**What was slow (found by CPU profile and a patched `linkProgram` / `getProgramParameter`).**
1. *Shader links.* Highland Trail linked 174 programs, on the main thread, one at a time, on first draw: 5 to 12 s of the
   page frozen inside `getProgramParameter(LINK_STATUS)` (half of the whole load). Causes: (a) three reads the matrices of a
   small `InstancedMesh` and the bones of a `SkinnedMesh` from uniform blocks whose array length and node id are written into
   the shader source, so every instanced mesh, every animal and every character was a program of its own (Highland Trail's 187 sources
   were 58 distinct programs once node ids are ignored); (b) the environment map arrived after the first frames and re-keyed, so recompiled, every material;
   (c) the first draws created static batches, scatter fields, virtual-geometry stand-ins and the post chain, each with a
   program, one synchronous link at a time; (d) a lit program is 50 to 115 KB of straight-line GLSL (2118 lines of `main`
   in the biggest), because the node graph is inlined, and the anti-tile, paint-mottle, ground-detail and layered-terrain
   lookups are a large share of it.
2. *Bytes.* Character bodies loaded their KTX2 twin (3 MB each) and then the original WebP file as well, because the tint
   is baked from the original: 10 MB for three people in Highland Trail, 36 MB of GLB in Kart Canyon.
3. *Per-frame CPU.* three's shadow pass copies each caster's `alphaTest` onto one override material, and every switch
   between alpha-tested and plain casters bumps that material's version, which makes three recompute the program key of
   every following object (`customProgramCacheKey` walks the node graph): 21 700 key computations per 20 frames on a house,
   about 20 % of a frame. Three sun cascades also draw the casters three times (1100 draw calls on a house).
4. *Headers.* `/basis`, `/blocks`, `/foliage`, `/palette`, `/templates` were `max-age=0, must-revalidate`.
5. *Weak machines.* The automatic tier followed the GPU class only: a four-core laptop with an integrated GPU got the
   medium tier like a desktop with the same chip.

**What changed** (all on `main`, one commit each).
- `gpu/backend.ts`: instance matrices and skeleton bones are read through attributes and a bone texture (the uniform
  block limit seen by three's node builder is 0). 174 links down to 59 to 66 on Highland Trail; identical rendering.
- `world-renderer.ts`: the first world (and any replacement adding 8 or more entities) is not drawn until its programs
  are linked: the environment map first (`HdriController.settled`), then one representative per material, geometry layout
  and object kind through `compileAsync` (it walks every render item and yields after each, so the whole list is too slow),
  with the batches, fields, virtual stand-ins and the post chain built first. The links run on the driver's threads: the main thread no
  longer blocks (about 55 ms in `getProgramParameter` over a house load, 5.2 s before). Later arrivals (models, people) link
  in rounds of at most 2.5 s with the draws held, never inside a draw. The load screen says what it waits for
  ("Building the world", "Loading the sky", "Preparing shaders"; names, not a made-up percentage) and only the first world
  reports. Software rasterisers keep the old path. Frames are never held longer than 20 s.
- `render-order.ts`: alpha-tested opaque items draw last, so the shadow pass switches once (version bumps 4653 to 66 per 20
  frames).
- Medium tier: one fitted sun shadow map, cascades for high, ultra and stills (a house: 1100 draw calls and 22.6 ms down
  to 614 and 14.3 ms).
- Characters load their WebP files, not the twin (10 MB down to 2.3 MB of character files in Highland Trail, 36 MB down to 12 MB of
  GLB in Kart Canyon).
- `vercel.json`: a day plus a week of stale-while-revalidate for `/basis`, `/blocks`, `/foliage`, `/palette`; five minutes plus a day for `/templates`.
- `gpu/performance.ts`: the automatic tier and pixel ratio follow cores and memory as well as the GPU class (two cores or 2 GB:
  low; four cores or 4 GB: low on anything but a discrete GPU, medium on one; pixel ratio 1), the anti-tile, ground-detail and
  layered-terrain lookups are dropped when the automatic tier is low (shader source of a house 2.5 MB down to 0.75 MB,
  links 51 to 32), and a governor steps down a ladder while the frame rate stays slow: after adaptive resolution has
  fallen to 0.72 (or at once under 12 fps) it gives up, in order, the baked room light, cascades, the post chain one tier,
  the post chain, and 3/4 of the particles (each step skipped when it would change nothing). It never goes back up (a step
  recompiles shaders), it is off when the user picked a tier, an explicit tier restores everything, and the player gets a toast.
  Thresholds: p90 frame time under 20 fps for 6 s, or under 12 fps for 1.5 s.

**Results** (iGPU, WebGL2, 720p, cold cache; before = `582e239`, after = this branch; local static server without
compression, so bytes are raw).

| world, throttle | open before | open after | blocking before | blocking after | frame before | frame after |
|---|---:|---:|---:|---:|---:|---:|
| Highland Trail 1x | 12.7 s | 12.3 s | 14.6 s | 5.3 s | 20.4 ms | 20.7 ms |
| Casa del Patio 1x | 10.3 s | 11.1 s | 10.9 s | 5.2 s | 18.3 ms | 10.6 ms |
| Kart Canyon 1x | 21.0 s | 6.8 s | 20.5 s | 3.4 s | 13.2 ms | 10.8 ms |
| Highland Trail 4x | 20.0 s | 13.0 s | 22.7 s | 5.7 s | 78 ms | 89 ms (steps to low) |
| Casa del Patio 4x | 15.2 s | 14.0 s | 16.7 s | 5.4 s | 77 ms | 49 ms |
| Kart Canyon 4x | 32.7 s | 10.3 s | 31.7 s | 12.5 s | 63 ms | 47 ms |
| Highland Trail 6x | 25.4 s | 17.0 s | 28.8 s | 8.6 s | 114 ms | 127 ms (low) |
| Casa del Patio 6x | 20.1 s | 17.9 s | 22.8 s | 8.8 s | 112 ms | 74 ms (low) |
| Kart Canyon 6x | 41.1 s | 28.9 s | 40.5 s | 21.4 s | 110 ms | 80 ms (low) |

Weak machine (the page told it has 4 cores and 4 GB, so the automatic tier is low from the start; before = the table above):

| world, throttle | open | blocking | frame | links | bytes |
|---|---:|---:|---:|---:|---:|
| Highland Trail 1x | 8.0 s | 1.8 s | 17.9 ms | 37 | 18.8 MB |
| Casa del Patio 1x | 6.8 s | 1.4 s | 8.9 ms | 32 | 16.5 MB |
| Kart Canyon 1x | 6.5 s | 2.3 s | 10.2 ms | not logged | 21.1 MB |
| Highland Trail 4x | 7.8 s | 2.6 s | 76 ms (steps to ladder 5) | | |
| Casa del Patio 4x | 7.0 s | 3.3 s | 39 ms | | |
| Kart Canyon 4x | 8.6 s | 8.1 s | 41 ms | | |
| Highland Trail 6x | 10.9 s | 4.3 s | measured while a late round held the draws | | |
| Casa del Patio 6x | 9.4 s | 3.9 s | 60 ms | | |
| Kart Canyon 6x | 17.2 s | 16.0 s | 71 ms (ladder 5) | | |

Bytes before to after, local (raw): Highland Trail 26.8 MB to 19.4 MB, Casa 24.9 to 17.4, Kart Canyon 44.5 to 22.0 (the weak
path fetches 0.6 to 1 MB fewer PBR JPEGs, which it no longer needs). Hosted (Vercel, brotli; measured from this machine, whose link to
Vercel is slow, about 150 KB/s, so wall times there are mostly the network): home page first button 0.9 to 1.2 s, FCP 1.1 to 2.0 s,
53 requests, 1.15 MB (JS 0.66 MB); Highland Trail 11.1 MB on the wire (images 3.7, GLB 4.4, JS 1.7, HDR 1.0, wasm 0.24), shader
stalls 1.7 s against about 12 s of `getProgramParameter` before.

Link and shader numbers (Highland Trail, 1x, same build): programs linked 174 to 59; time in `getProgramParameter` 10.6 to 12.7 s
down to 1.7 s (house: 5.2 s down to 1.1 s); shader source handed to the driver 2.7 MB to 1.9 MB (a house: 2.5 MB at medium after, 0.75 MB at low; not
measured before). What still links synchronously after the first frame: a campfire and the river's water shader
(0.4 to 0.6 s each), skinned fins, the bloom high-pass, small shadow-depth programs.

**Honest reading.** Time to open did not change on the medium tier of this machine for the two worlds with the most models
(Highland Trail, Casa): the link time moved off the main thread (the page stays responsive, the load text animates, blocking
fell 50 to 85 %) but the wall time of the parallel links on Mesa is about the same as the serial one, and the first frame now
waits for the build. Kart Canyon opens three times faster (it lost 14 MB of character files and 20 s of serial links). Under
CPU throttle the saving is large (25 to 70 % less open time, 55 to 80 % less blocking). The weak-machine path halves the open time
and the frame time. At 6x the governor still steps down inside the measurement window, so a frame number there is partly a
number taken while it steps.

**Not done, and why.**
- (Done afterwards, see "Bytes, room-light cache and the long task" below: PBR maps and skies.)
- The motion packs are 2.2 MB each (0.65 MB brotli) for every gender in the world.
- (Done afterwards: the light-volume cache, see below.)
- WebGPU on the Intel GPU was not measurable here (no Vulkan adapter for it in headless Chromium); the WebGL2 numbers are what a
  browser without WebGPU gets. On WebGPU pipelines are created asynchronously by the browser, so the link stalls above do
  not apply there, but the program count, the per-frame key cost and the draw calls do. Firefox and Safari's
  `compileAsync` yields through `requestAnimationFrame` after each item (Chromium uses `scheduler.yield`), which the
  representative list keeps short, but it was not timed there.
- Governor steps are one-way; recovering after a slow patch would need shader compiles to be hidden.
- (Done afterwards: the `npm run e2e` failure was a real long main-thread task, found and fixed, see below.)
- Not wired: the tier chosen by the player in Settings does not rebuild the material detail flags (they are set when the
  renderer starts).

**Verification.** `tsc --noEmit` 0 errors; vitest for `packages/render`, `apps/studio`, `apps/server`: 1626 tests (new:
`performance`, `render-order`, `hdri-settled`, `model-loader-characters`, updated `sun-shadows`; `assets.test.ts` "allocates
nothing" failed once under load and passes alone); `npm run smoke` 34/34; `showcase:bake --check` up to date; `bench:quick`
checks passed. Reproduce: `npm run build`, then `GEN_GPU=intel npm run e2e:load-perf -- --throttle=1,4,6
--worlds=highland-trail,casa-patio,kart-canyon [--hw=4,4] [--profile] [--url=https://…]`.

### Bytes, room-light cache and the long task

Same machine, build and method as above (iGPU, WebGL2, 720p, cold cache, local server without compression; the machine was
shared, load average 4 to 12). Commits: `a7f56c1a` (maps, skies), `fa60324a` (light-volume cache), `e4769cc1` and `111d4c9b` (texture
work in tasks).

**PBR maps.** Not KTX2. The finish maps are not uploaded as files: `FinishTextures` decodes each to RGBA pixels, resamples to the
tier's texture size (256 px on low and medium, 512 px on high) and copies them into its own textures and the layered-terrain texture
arrays (`SplatArrays`). A KTX2/UASTC or ETC1S container would have to be transcoded back to pixels on load, so it would save
bytes at best, cost a transcoder round trip and lose the GPU-memory benefit it exists for; ETC1S is also poor for tiled normal
maps. KTX-Software is therefore not used for these (it still makes the model twins and block sheets). What shipped instead, in
`scripts/assets/materials.ts`, is WebP in two sizes, made from the ambientCG sources (`assets:build -- --photo-only`, 23 finishes): a
512 px set (WebP quality 0.84 colour, 0.76 ORM, 0.88 normal) and a 256 px set (0.93, 0.90, 0.96) that the renderer picks whenever
its finish textures are 256 px or less (`material.small` in the catalog; `finish-textures.ts` chooses). WebP decodes in every browser
that runs the studio; a file that fails to decode keeps the procedural finish, as before. The 256 px set is the 2x reduction the
renderer would have made after decoding, done once at build time.

| | before (JPEG 512, all tiers) | after 512 px set | after 256 px set |
|---|---:|---:|---:|
| albedo, 23 files | 2.77 MB | 2.32 MB | 0.81 MB |
| ORM | 1.53 MB | 0.64 MB | 0.35 MB |
| normal | 1.87 MB | 1.44 MB | 0.54 MB |
| all 23 finishes | 6.17 MB | 4.40 MB (-29 %) | 1.70 MB (-72 %) |

`dist/assets/lib/x` stays 6.2 MB on disk (both sets ship); a visitor loads one. Highland Trail / Casa / Kart Canyon, images fetched
(all images, not only finishes): 3.71 / 4.85 / 3.65 MB down to 1.44 / 1.76 / 1.47 MB; whole page 19.44 / 17.44 / 22.02 MB down to
17.17 / 14.36 / 19.84 MB. Open time 15.3 / 10.2 / 6.9 s to 12.5 / 9.7 / 7.0 s and blocking 6.7 / 4.6 / 3.6 s to 5.5 / 4.6 / 3.3 s (single
runs at load 4 to 8: inside the noise for Casa and Kart Canyon; only the bytes are a firm result).

Parity. PSNR of the 256 px set against the old JPEG reduced to 256 px: albedo 37.1 dB mean (worst 27.6, grass), ORM 37.0 (29.2,
gravel), normal 39.4 (26.3, gravel); the 512 px set against the old JPEG: ORM 37.4, normal 39.7, albedo about 33 to 34 dB (each is
measured against a JPEG that was itself lossy). The worst files are the noisiest ground textures. Stills of Casa del Patio from
three camera poses, before and after, medium tier (deterministic): PSNR 52 to 57 dB, nothing visible. High tier: 40 to 45 dB, but
the same pose rendered twice with the old build also differs by 44 dB (TAA jitter, moving plants), so that is noise, not the
change. One high-tier "after" still showed a black ellipse near the pool that did not come back in four repeats of either build;
cause not found, probably an effect that had not settled when the still was taken. Highland Trail (foliage and water), two poses:
43 and 41 dB, water animation only. Stills and logs: `~/.local/share/aether/look5/`.

**Skies.** `h/<id>.512.<sha8>.hdr` is a 512 x 256 copy (2 x 2 average of linear radiance, so the energy is kept) of each of the five
skies: 0.36 to 0.42 MB against 1.44 to 1.73 MB. `HdriController` fetches it when the sky only lights the scene (`lightOnly`, or a
world HDRI with the background off: the automatic sky of the high and ultra tiers) and fetches the full file when the sky is the
background or becomes it; checked in the browser (379 KB and 1.44 MB requests). The sun is read from the brightest texel of
whichever file is loaded, so its direction is unchanged. Highland Trail draws its sky as the background, so its 1.4 MB
(about 1.0 MB brotli) stays; a smaller background needs a different encoding of the photograph (RGBE does not compress), which was
not attempted. The existing `.hdr` files and `assets:build --hdri-lite` (patches the catalog from the shipped files, no Poly Haven
sources needed) are the inputs.

**Room-light cache.** `environment/light-volume-cache.ts`, used by `LightVolumeController`. Key: a hash of the trace triangles,
their albedo and sidedness, the probe grid, sun, ambient, ground, lamps and `VOLUME_BAKE_VERSION`; so an edit, a lamp switched, another
time of day or a changed bake misses, and a hit is the data the bake would have made. (Not the "world hash": the world IR does not
determine the gathered geometry, the ambient depends on the sky that arrived, and a content key cannot be stale.) IndexedDB
`aether-light-volumes`, 12 entries or 48 MB, least recently used out, only bakes of 400 ms or more are stored, every failure is a
miss. The lookup runs after the gather (the gather and its hash are the main-thread cost; the bake was already in a worker), a hit
skips the worker, a change during the lookup drops it. Casa del Patio opened three times in one browser profile (iGPU):

| visit | open | room light ready after open | bake |
|---|---:|---:|---|
| 1 | 6.0 s | 3.2 s | 5.5 s in the worker (23 846 triangles) |
| 2 | 3.0 s | 5.2 s | 4.1 s in the worker (23 890 triangles: a different key, so a miss) |
| 3 | 3.2 s | 1.2 s | 0.14 s, from the cache |

The 1.2 s is the 0.6 s settle plus the gather; the room light no longer waits for a bake, so there is no multi-second period
where the rooms are unlit on a revisit. Caveat: the first revisit missed because the second visit gathered 44 more triangles
than the first (something is still arriving or differs on a cold start; not investigated), so the cache pays from the second
revisit on in this measurement. Worlds without a building have no volume (Kart Canyon: nothing to cache).

**The studio e2e failure was a real long task, now fixed.** `npm run e2e` failed again on a 426 ms script during verification
(`resolve-promise: Promise.resolve`; 337 ms before). CPU profile of one agent turn (software WebGPU, as the e2e runs):
(1) the read-backs of the photo finish maps (`getImageData`) all became ready in one microtask drain, 280 to 300 ms in one task;
(2) the photographed leaf atlases of every foliage kind were composed in one drain too, 130 to 280 ms per atlas (the canvas
rasterises its filters and shadows when the pixels are read); (3) `FoliageTextures.get` made the procedural atlas of each kind
synchronously inside material creation (`mountScatter` to `foliagePixels`, 0.4 to 0.9 s together). Fix: `gpu/task-queue.ts` runs
such jobs one at a time, several per task only while under 6 ms; read-backs go through it; a photographed atlas is composed a
half card variant per step; an atlas starts empty and is filled in a task each (procedural cards only for kinds without photos or
when photos fail, a card variant per step); the load screen on GPUs waits up to 3 s for the cards before the first frame. Longest
non-render script during verification: 426 ms to 28 ms; on the profile the slowest queued job fell from 200 ms to 76 to 112 ms.
`npm run e2e` (Chromium WebGPU, WebGL2, Firefox) PASSED, at load average 11 to 12: the machine was not quiet at any point, so this is
the worse case, not the best. Foliage on a software rasteriser can now be bare for a few hundred milliseconds after a world
opens (the cards fill in; captures wait through `foliagePending`). The long tasks that remain during a turn (up to 1.4 s) are
first-render shader graph building in the animation-frame callback, which the check does not count.

**Gates.** `tsc --noEmit`: 0 errors from this work; 4 errors in `packages/arch/test/wet-clearance-sweep.test.ts` (a test added to
`main` by another change: `w` and `d` possibly undefined) are not mine and were left alone. vitest `packages/render`,
`packages/assets`, `packages/procgen`, `apps/studio`: 217 files, 1999 tests pass. `npm run smoke` 34/34. `showcase:bake --check` up to
date. `bench:quick` checks passed. New tests: task queue, light-volume cache and controller cache paths, HDRI lite selection, 256 px
finish set, foliage fill order. Reproduce the numbers: `npm run build`, then `STATIC_DIR=<dist> GEN_GPU=intel npm run e2e:load-perf --
--throttle=1 --worlds=highland-trail,casa-patio,kart-canyon` (`STATIC_DIR` also serves an older build for the before column).

## Stairs tucked against the wall at the foot: plan check and building check vs. the bot

**Problem.** A model-built two-storey house (L stair, first riser 2 cm from the hall's south wall, east edge 2 cm from
the east wall) failed the walkthrough bot ("no walkable route to Bedroom", "stuck on house-l0-stair0", "stuck on
house-l0-w4") while `checkStair` said the stair works and the building check reached 7/7 rooms.

**Root cause.** With the first riser at a wall the foot cannot be entered from the front, so both checks relied on
"floor beside the first treads" (a 0.6 x 0.9 m strip) as the way on. The side of a flight is a wedge: a body pressed
against the wall behind the foot has its centre 0.37 m from the wall, which puts it 0.35 m along the flight, over treads
taller than the hop clears (measured with the character controller: hops from the side work to about 0.32 m along on a
0.27 m going and 0.175 m riser, fail from 0.34 m). The bot hopped onto the flight's side and wedged; no route existed
past the foot. The stair itself, its landing and the door leaves upstairs were fine (the same house with the stair moved
is walked in full). The error was in the check, not in the bot.

**Change.** `stairSideReach` / `stairSideBehind` (stair-fit): a side entry needs floor behind the first riser
(about 5.5 cm for the usual stair), and the side strips of `stairShape` start there, so `checkStair` refuses the stair
with the measured depth and `settleStairs` / `create_building` move it. The building check asks the plan for the same
(`stairSideEntry`) before it counts the besides-points of the grid (whose cells are too coarse for centimetres).
Also fixed a test stair in `stair-landing.test.ts` that stood on the wall, and a strict-index type error in
`wet-clearance-sweep.test.ts`.

**Tests.** `packages/arch/test/stair-side-entry.test.ts` (reach/behind numbers, the refusal text, building check as
drawn vs. settled), `packages/playtest/test/stair-side-entry.test.ts` (bot fails as drawn, passes through
create_building). arch 481, playtest 281, agent 820 tests pass, typecheck 0 errors, smoke 34/34.

**Open.** The offline planner's two-storey house, once its own stair (0.06 m behind the foot, marginal) is moved, lands
on a straight stair hugging the north wall that the bot cannot route up (no stuck point, nav finds no route); the
planner house is unchanged by this fix because 0.06 m is still enough. That second case is not investigated.

## Live check of the model-led judging, tune_look and the photo vocabulary (Codex, then Claude Code)

Everything below the judge, `tune_look`, the performance governor and the photo-room vocabulary had been tested only with
scripted models. This pass ran them against a live Codex (gpt-6.1-sol, medium effort, ChatGPT login) through the built
studio and `scripts/eval-photo.ts` (software renders, 3 judges, 3 reads, no round cap). Codex hit its subscription limit
twice during the pass (the first time while three runs were in flight, the second during the last photo); every result
says which backend produced it. Logs and montages: `~/.local/share/aether/qa/live/`.

**Photo to room, the four fixtures.** "Judged" is the panel of three AI judges (median per checklist item); "measured"
is the deterministic fidelity, which is advice only.

| Photo | Backend | Judged by AI | Measured (advisory) | Rounds | Calls | tune_look |
| --- | --- | --- | --- | --- | --- | --- |
| hotel | Codex, before the harness fix | 7/20 (35 %) | 83 % | 8 | 36 | 3 (exposure 0.92, 0.85, 0.77) |
| hotel | Codex, after | 8/20 (40 %) | 76 % | 7 | 34 | 2 (exposure 0.9 then 0.82, warmer) |
| hotel | Claude Code, after | 14/19 (74 %) | 80 % | 6 | 28 | 4 |
| twin | Codex | 9/29 (31 %) | 64 % | 6 | 29 | 2 |
| twin | Claude Code | 14/16 (88 %) | 68 % | 5 | 25 | 1 |
| pd1 | Codex | 6/22 (27 %) | 78 % | 7 | 33 | 2 |
| pd1 | Claude Code | 6/20 (30 %) | 71 % | 8 | 36 | 2 |
| pd2 | Claude Code (Codex hit its limit; not completed) | 9/20 (45 %) | 76 % | 8 | 37 | 4 |

The earlier 100 / 83 / 83 for the hotel were the model's own verdict and the measured numbers of earlier runs. They do not
compare with the panel: the panel is stricter by design (it fails items that the flat software render cannot show, such as
the content of the framed photographs, curtain pleats, a cropped cabinet). The measured fidelity of the hotel is unchanged
at 76 to 83 %, and the montage is as good as before: the cornice, picture-rail free plum walls, skirting and the sash window
(two sashes and a rail at the right height) from the new vocabulary are all built from the photo. Judged scores differ
more between backends (35 to 40 % Codex, 74 % Claude Code on the same photo) than between rounds.

Checks on the model-led design:
- `tune_look` was called 2 to 4 times a run, always after a render, always in the direction the photo showed (darker,
  warmer, more contrast for the plum hotel; neutral for the white pd1 room). One defect in the harness, not the tool: the
  software renders of `eval-photo.ts` forced `exposure: 2.0` whatever the world said, so a look change never showed in the
  model's own renders, and pd2 took 9 look calls hunting for it (exposure 0.75, 0.85, 0.75, 0.8, 0.7, 0.62, 0.58). The renders now
  scale by the stored exposure; the same photo took 4 calls (Claude Code) and the Codex runs 2.
- The loop ended by the assistant's own "good enough", by the stall rule, or at 6 to 11 rounds; none by a round cap.
- Judge noise is still large: pd2 on Claude Code (before the harness fix) went 11/21 at round 8 to 4/21 at round 11 although
  every step was preferred or tied against the accepted state, so the reported final is not the best seen. "Tie is
  accepted" lets small drift through; left as designed, and listed below.

**Defect found and fixed: the shell refused on a crowded wall.** The Codex twin run stopped at "shell refused": the reading
put window, door and second window 0.1 m or less apart on a 2.85 m wall (one gap printed as 0.10 m yet refused, one -0.07 m),
and the single correction round either failed or could not run (Codex was at its limit at the time), so the run ended there. `deriveBuild` now runs `separateOpenings`:
openings of one wall are pushed apart inside the corner margins, windows narrowed (not below 0.5 m), the last window dropped
when even that does not fit, doors keep their width, and every change is a note in the room's assumptions. The 0.1 m wall
rule in the design tool ignores a micro-metre of rounding (`gap < 0.1 - 1e-6`). Test: `photo-openings.test.ts`. The next
Codex twin run built and compared the room (no refusal).

**Prompt-built forest game with chat edits (Codex).** "A night forest adventure: collect 5 lanterns, avoid the wolves, reach
the shrine to win" built in 178 to 209 s and was "Verified playable" (the bot won in 23 to 27 s). Edits, each followed by a
fresh proof (the bot's time changed every time, and the replay bar appeared):
- "make the wolves slower": local edit, 17 to 28 s, proof re-run, passes.
- "warmer lanterns": five lantern lights to amber (#ffac48), proof re-run, passes.
- "move the shrine onto the hill": with a hill in the prompt, a local edit moved the shrine, plinth, heart and zone onto the
  summit (y 6.24 on a mound at z -27) in 13 s. Without a hill in the prompt the model found the hill its own build had made
  by measuring ground heights and moved the whole assembly onto the crest; proof passes.

**Defects found and fixed in the edit guard.** In the first run (Codex out of quota, Claude Code took over mid-turn, which the
studio announced) the same edit left the world half done: the model raised a hill, found it too steep, added a second one, and
the guard refused to remove the first ("unrelated existing object") and to move the torii gate named "Shrine torii"; the
shrine stood inside the old hill and the model said so honestly and stopped. Two changes (`refine/guard.ts`):
1. What the assistant added earlier in the same turn is not "existing" for the audit (the turn-start world is passed to
   `auditPatches`), so a failed first attempt can be replaced or removed; what was there at the start stays guarded.
2. Entities whose id extends a target's id with a name (`shrine-torii`, `shrine-beacon`) belong to the target; numbered
   siblings (`wolf-2`) do not.
Tests in `edit-dependents.test.ts`.

**Two-storey house with a bathroom (Codex).** "A two-storey modern house with a bathroom that has a walk-in shower, an
open-plan living room, a kitchen and two bedrooms": 323 s, "Verified walkable: all 7 rooms, 3 doors opened". "Add a large
window to the kitchen" enlarged the existing window to 2.4 x 1.8 m (45 s, still walkable) and "add a big plant in the
bathroom" placed one 1.8 m from the shower. C9 (an automatic bathroom plant overlapping the shower after a recompile) did not
reproduce, on Codex or on two Claude Code houses (one with a shower and an automatic bath plant, 2.6 m clear). The placement
rule is the wet clearance of `RoomLayout.fits` (dry decor keeps 0.4 m off a shower or bath) plus the removal of compiled
pieces inside a design-tool piece on re-compile (both from the hills commit). A sweep test (`wet-clearance-sweep.test.ts`: 7
bathroom sizes x 4 door walls x with and without a placed shower x with and without an added window, 112 rooms) now guards
it; no overlap in any.

The Claude Code houses found a different, real defect: one failed the walkthrough bot although the static checks passed (a
stair whose first riser is 2 cm from the wall). That is the entry above ("Stairs tucked against the wall at the foot").

**C15, photo shell detail.** The hotel render now carries the cornice with coving, skirting and a two-sash window whose
rail is where the photo has it; the judge still fails shell-size (the photo shows a tall room, the render more floor: a
camera and framing difference), the curtains (the plum curtains are missing in the Codex hotel's final render although the
description has them; refused and not retried) and the sideboard crop. Open.

**Performance governor.** Not exercised here: the headless runs had no frame budget to adapt to (one studio capture read
0.3 fps while three other jobs held the machine, the governor's case, but no tier change was logged).

**Open after this pass.** Codex pd2 not completed (limit); the curtains lost in the Codex hotel run; accepted ties let a
judged score drift down (final lower than best, pd2); the planner house's north-wall stair (above); the first Codex run's
half-finished hill edit was a Claude Code take-over after the limit, not repeated with Codex.

Gates: typecheck 0, vitest agent + arch + playtest 123 files / 1582 tests, smoke 34/34.

## Photo to room: best state kept by the judges, hung curtains, what the camera fit says about the room

Three items left open by the live check above. Scripted-model tests only; no live run was made in this pass (the Codex
limit had reset, but the fixes are about what the loop does with answers it already gets, and a live run is the next step).

**Final state below the best seen.** A tied round is accepted, so a run of ties could end under the best state (pd2: 11/21
then 4/21). The loop now remembers the best state by the judges' own word (the first look, then each state they found closer
than the accepted one or whose median score rose). When it ends on a different state, the panel looks at the last render and
the best render side by side (A/B order alternated per seat, as in every round) and the room goes back to the best only
when they find it closer; a tie or a vote for the last keeps the last. No score is compared in code. The summary says so
("compared the last state (round N) with the best one seen (round M) side by side ... the room is the best one"), the
score shown is the one the judges gave that state at its own round, and `judgedBy` is unchanged. One extra panel call, only
when the end state is not the best. Not done: the `judges: 0` mode (the assistant judging alone) has no such final check;
it already sees the best render each round but ties still drift there. Tests: `photo-pipeline.test.ts` (ties then a vote for the best
rolls back; a final tie keeps the last).

**Curtains lost in the Codex hotel run.** Reproduced offline from the recorded description. The model wrote one curtain item
with `panels: 2` and `gap: 1.48` (the whole dressing), and `placeCurtain` hangs a panel per side but passed those params to
each panel, so each side became a pair 3.4 m wide (1.09 to 4.49 m on a 4 m wall) that sat over the glass and the placement audit
refused it ("that wall has no clear stretch wide enough"). The model's retries repeated `panels: 2`, so it could not recover and
finished saying the placement checks reject the curtains. Fix at the cause (`scene/edit.ts`): each side panel is a single panel
whatever the caller wrote (`gap` dropped, kept to 0.2 only for a drawn panel); the photo prompt now says not to set panels or gap.
Test in `photo.test.ts` fails without the change. Side effect: `closed` on a hung side panel has little visual effect.

**Shell size and the cropped sideboard.** Cause found for shell size on the same recorded hotel: the camera fit (boxes only)
ends pinned against the room wall (x 0.15 m) and the photo's pieces are about 2x taller relative to their width than the
render's (window 5 to 72 % of the picture height in the photo, 24 to 68 % in the render; its width 17 % against 23 %). That is
the signature of a room taller (or narrower) than described, which the model reads worst from a flat picture, not of a framing
or a wrong field of view (a search over starting fields of view changed nothing). The old text told the model the camera was
fitted "as well as it can be", so it never looked at the room. `framingText` now adds, as evidence only, a scale line when the
median height ratio differs from the width ratio by 25 % (ceiling, window, door heights) and a note when the fit hit a wall or
a field-of-view limit (the photo was taken from further back, or the room is bigger). The model decides what to change. The
sideboard: the TV cabinet is cropped by the frame and its listed height (0.9 m) puts the TV much lower than in the photo
(TV 38 to 55 % in the photo, 57 to 71 % in the render); the scale advice excludes frame-cut boxes from the ratio but nothing
rebuilds the cabinet automatically. Not verified live: whether a model acts on the new lines and the judges then pass
shell-size. Tests: `photo.test.ts` (synthetic and the recorded live description, fixture `hotel.codex.description.json`).

**Environment note.** A worktree whose `node_modules` was symlinked from another checkout resolved `@aether/*` to that
checkout and gave 10 false failures; use `npm ci --ignore-scripts` in a worktree.

A worktree (or the main checkout) with a stale `node_modules` can hold `@dimforge/rapier3d-compat` 0.12.0 at the root while the lockfile and the root `overrides` pin 0.21.0; the physics code then fails with `R.JointData.revoluteWithAxes is not a function`. Not a code bug: run `npm ci --ignore-scripts` in the worktree (checked: a fresh `npm ci` installs 0.21.0 at the root) and never share or symlink `node_modules` between checkouts.

## Photo to room: live check of best-state keeping, curtains and the scale lines

Run on 2026-10-22 with `scripts/eval-photo.ts --mode=live` (3 judges, 3 reads, software renders); logs and montages in
`~/.local/share/aether/qa/live2/`.

| Photo | Backend | Judged by AI | Measured (advisory) | Rounds | Calls | Before (same backend) |
| --- | --- | --- | --- | --- | --- | --- |
| hotel | Claude Code | 16/19 (84 %) | 81 % | 8 | 37 | 14/19 (74 %) |
| hotel | Codex | not completed: subscription limit (resets 27 Oct), 6/20 at round 6, first attempt 4/20 | 76 % at round 1 | 6 | 29 | 8/20 |
| twin, pd1, pd2 | Codex | not run: the limit was reached during the hotel run | | | | 9/29, 6/22, not completed |

- Best-state keeping worked live: rounds 7 and 8 of the Claude Code hotel run were not kept by the judges and the room
  went back to round 6 (16/19), which is the final state.
- Curtains: the Claude Code run's checklist has no curtain item and no placement refusal appears in its log; the Codex run
  was cut off before a verdict on its curtain item. Not shown live either way.
- Scale and framing lines: the Claude Code run failed shell-size in rounds 1 and 2 and passed from round 3 on; the
  transcript does not store the host's text blocks, so whether the scale line itself was shown is not known (it only
  appears when the pieces are 25 % taller in the photo relative to their width). In the Codex run the model changed
  the room depth (4.2 to 4.7 m) after the shell-size verdicts, but kept the ceiling height, and shell-size kept failing.
- Prompt change: the compare prompt (judged and self-judged) now tells the model to check the room's width, depth and
  ceiling height against the photo (how much wall the door, windows and bed take, how much floor shows, the ceiling
  above the window head) before fixing single pieces, to say which number it changed, and not to leave a failing
  shell-size item while moving furniture. Metrics stay advice; the model and the judges decide. Test in
  `photo-pipeline.test.ts`. Not yet verified live (Codex limit).

## Stairs: a sweep of generated houses, and what it found (stage `stairsweep`)

**Problem.** The previous stage ended with an open case: the offline planner's two-storey house, once its own stair was
moved, got a stair against the north wall that the walkthrough bot could not route up. One house is an anecdote, so the
stair rules were put under a sweep: houses generated by seed (`packages/arch/test/support/house-gen.ts`: 7-15 m wide,
5-9 m deep, two or three storeys, a stair drawn at random on every storey, with and without furniture), run through
`create_building` (which settles the stairs), then the building check and the walkthrough bot.

**The planner case.** Not a stair at all. The planner's house walks fine with its own stair and with the moved one
(`[0.2, 1.2]` east, nearest fit `[1.46, 0.66]`, 0.26/0.66 and so on): 17 settled positions over 1 to 3 bedrooms, all
walked. It fails when people live in it ("a family of four/five/six"): a resident stood in the strip beside the flight
or on the top landing (nothing in the placement kept them off the stair's walkway; furniture had a 0.8 m keep-clear,
people had none) and the bot's route to the upstairs rooms ended there ("no walkable route to Landing", no stuck point).

**What the sweep found** (first 60 seeds: 13 houses the bot could not walk or the building check refused; each rule below
fixed a class, each class is a pinned test):
- *A flight starting over the stairwell of the stair below* (3 storeys): the plan check never compared a stair with the
  hole the stair under it leaves. Now refused ("stands in the stairwell of the stair from level N").
- *A stair standing on the landing the stair below comes out onto* ("stands on the landing where ...").
- *A slit between two stairwells (or a stair and the stairwell below) that no walker fits*, along a face or from corner
  to corner: gaps under 0.8 m and over 3 cm are refused (`lanePinch`).
- *A door whose leaf swings across the way from the stair* (`stairInDoorSwing`): hinged doors now carry their swing side
  and hinge (`levelDoors`); a stair or stairwell balustrade in the floor in front of the door (the leaf plus 0.85 m deep,
  the width of the doorway) or in a pocket 0.1 to 0.7 m beside the hinge is refused. A stair flush with the hinge side
  leaves no pocket and stays allowed (the fixture of `stair-landing.test.ts` is unchanged).
- *The hinge itself*: the leaf was hinged on alternate jambs by door count. A leaf hinged on the stair's side swings across
  the way of people arriving from the stair; with the balustrade behind them the bot stood boxed in against it. A swing
  door into a room with a stair or stairwell is now hinged on the jamb away from it (`hingeAwayFromStair`).
- *Furniture on the landing*: the keep-clear round a stair was 0.8 m, the landing a stair needs is its width (0.9 m at
  least, 1.0 for the usual stair): now the width plus 5 cm, never less than 0.95 m.
- *People* keep out of the same walkway (`ResidentRoom.avoid`).
- Bot, not stairs: walkthrough rooms whose centre lies in a stairwell (a landing is where the stair comes out) are walked to
  at the floor farthest from the opening; the planner chose, as the cheapest way to the floor below, a leap down the hole
  beside the stair (a link that fails when tried; two dozen of them along the balustrade used up the 14 attempts before
  it came to the stair), so a walkthrough builds its graph without leaps down (`noDrops`).


**Sweep, final** (each house through `create_building`, the building check, then the walkthrough bot; a house for which
`settleStairs` reports "nothing fits instead" is counted as refused: the plan comes back with the measured reason, and the
drawn stair is left in):

| sweep | houses | walked, every storey | refused | failed |
|---|---|---|---|---|
| first sweep, rules of the previous stage | seeds 1-60, with furniture | 47 | 0 | 13 |
| mid-stage rules (before the hinge, slit and bot changes), bare | seeds 61-340 | 266 | 3 (301, 317, 340; counted as failed then) | 11 |
| final, bare | seeds 1-250 | 248 | 2 (seeds 32, 155) | 0 |
| final, furnished | seeds 1-120 | 119 | 1 (seed 32) | 0 |

Seeds 301, 317 and 340 (outside the final range) are refusals too: three storeys of 7.5 x 5.5 m with two stairs left no
place for the second. `packages/playtest/test/stair-sweep.test.ts` runs 20 pinned seeds (the ones that broke each rule) and
12 more, bare and furnished (135 s), plus the planner house with people at home at three drawn stair positions
(`SWEEP_FROM` / `SWEEP_N` for more). The pinned fixtures of the new rules are in `packages/arch/test/stair-neighbours.test.ts`;
`packages/arch/test/residents-stairs.test.ts` keeps people 0.94 m off every flight and stairwell in 30 houses.

**What did not change.** The existing fixtures (`stair-landing`, `stair-side-entry`, `stair-walking-line`, the lift sweep)
pass unchanged: a stair flush with a door's hinge side is still allowed (the C7 house keeps its stair along the east wall of
the hall), and the planner's own stair at `[0.2, 1.2]` is not moved. Dusk House by the Lake and Villa with a Pool were
rebaked (a stair room's door hinges and furniture keep-clear changed); `showcase:bake --check` is clean.

**Open.**
- The planner house with *three* bedrooms, a family of four and a stair drawn at `[3.06, 0.66]`: the bot gets stuck on the
  stairwell balustrade (`villa-l1-rail0`) while a resident walks the same flight (routines take people up and down the
  stairs). Without the residents' routines it is walked in full; with the stair at `[0.2, 1.2]` or `[1.46, 0.66]` it passes.
  It is a person and the bot on a 1 m flight, not a placement; no yield rule exists in the bot.
- Furnished sweeps surfaced a furniture layout fault outside this stage: in a hall type `living` the sofa, two armchairs and
  a bookshelf formed a chain that sealed the opening to the next room (removing any one of the four cleared the building
  check). The generator now makes the entrance room a hall, so the sweep does not test that; not fixed.

## Inside-corner hairline: not the light volume, the sun's shadow (stage `look6`)

**Problem.** A lit hairline, 2 to 4 px wide and 80 to 110 levels above the wall, ran down the inside corners of rooms
(open since Look pass 4). Two earlier stages disagreed about it: look3 said it shows with the volume off, so it is geometry
or material; look4 said it persists with every light hidden and a CPU copy of the shader read gave dark, so it is the
volume read on the GPU. Candidates handed over: a trilinear tap across the wall, the normal-offset bias, a clamp,
quantisation, mitre geometry.

**Method.** The studio over Vite on the integrated GPU (Intel UHD 770, Chromium over ANGLE gl-egl, WebGL2, headless,
nothing left running), Scandinavian Living's north-west corner at 1600 x 900, at 2.3 m and at 4 m. One factor per capture,
toggled in the page (a throwaway debug uniform in the light node for the three that live in the shader), then the mean
luminance across the corner over 300 rows and the strip's excess over the columns 6 to 10 px either side
(`~/.local/share/aether/look6/scripts/an.py`; the capture script is `cap-final.ts` there).

| factor | excess over the wall (levels) |
|---|---|
| as drawn (baseline) | 50.3 (216 against 165) |
| no normal offset on the volume read (`p = pw`) | 49.7 |
| leak test off (plain trilinear over the eight probes) | 50.3 |
| light volume off | 29.1 (224 against 195; the room goes grey-blue, the strip stays white) |
| screen-space AO, contact shadows, GI, TAA each off; every post effect off | 50.3 each |
| exterior faces of all four walls hidden | 41.1 (strip still there) |
| wall `w0`, inside face (`part1`) hidden | strip gone: it is part of that face's mesh (noise 11.7 elsewhere) |
| sun intensity 0 | 1.2 |
| sun shadows off | the wall is lit to 216 along its whole length: the strip is the sun |
| walls' shadow side forced to front faces | 1.2 |

**Cause.** The volume read is innocent, which is why a CPU copy of it gave dark: the strip is sunlight. The sun's shadow
map is drawn, as three does for a single-sided material, from the faces behind the surface: for a wall lit from the west
the stored occluder is the inside face of the west wall, the plane the next wall's face meets at the corner. A receiver within the
depth bias of that plane (`-(0.6 texel + 0.01) / range`, 1.5 to 3.5 cm along the ray) counts as lit, so the strip within
about 1.5 cm of the corner is sunlit while the rest of the face is in the wall's shadow; the filter's penumbra is the
8 px fade. The same happens wherever a thin solid's far face meets the surface it shadows. Corner crops: `crop-corner-near-4x.png`,
`crop-corner-far-5x.png`.

**Change.** An architectural wall (`arch.role === 'wall'`) resolves to a solid material (`ResolvedMaterial.solid`, part of
the material key, `ResolveOptions.solid` from `scene-sync`), which sets `shadowSide = FrontSide`: its shadow is drawn from
the faces toward the sun, 12 to 28 cm from the faces it shades, well outside the bias. Glass, foliage cards and the ghost
are left alone. Nothing changes in the light volume and its shader (the debug uniform was removed again).

**Measured** (same captures, before: this commit's parent):

| | before | after |
|---|---|---|
| corner at 2.3 m, strip excess | 50.3 | 1.2 |
| corner at 4 m, strip excess | 39.9 | 1.8 |
| mean absolute difference, whole frame: two exterior views and an interior view of the same room | | 1.3 to 1.4 levels, 0.2 to 0.4 % of pixels over 12 levels, along shadow terminators beside walls only |
| Casa Patio cover, whole frame | | 0.8 levels, 2.8 % of pixels over 12 (the walls and the wind-moved grass) |

Casa Patio's cover shows the one visible change besides the corner: its sunlit stone plinth wall, which was mottled
(shadow-map noise on a face nearly parallel to the sun, by the look of it: the wavy pattern in `crop-casa-ext-wall.png`, not the finish's relief, since with the sun's
shadows off it is flat and pale, exactly as it is now), is flat and lit; the courtyard walls keep their vine and wall
shadows. No acne on any other wall face, floor or exterior in the captures (`crop-ext-ne.png`, `crop-casa-full.png`,
`crop-casa-4.png`: before, after, after with the sun's shadows off, after with the sun off).

**Not changed, seen on the way.** Pale rectangles with hard edges round the corner in the volume-on captures
(`corner-far.png`; they are gone with the volume off): a step in the baked room light, not investigated here; separate
from the hairline and still there. The CPU copy of the shader read that the look4 stage ran is not wrong; it is the
answer for the volume only.

**Tests.** `packages/render/test/wall-shadow-side.test.ts` (solid material: own cache key, front faces for its shadow,
the plain one untouched; glass, foliage and the ghost keep theirs; a wall entity gets it and a crate does not).

## Residents and the bot on a narrow flight; furniture that sealed a living entrance room (stage `stairyield`)

**Problem.** (1) The planner house with three bedrooms and a family of four, stair drawn at `[3.06, 0.66]`: the walkthrough
ended "the player got stuck on villa-l1-rail0" (also with the phrase "a 3 bedroom two-storey house for a family of four";
without residents' routines, or with the stair at `[0.2, 1.2]` or `[1.46, 0.66]`, it passes). (2) In a hall type `living`
the furniture could seal the opening to the next room.

**Cause, measured** (positions every 0.25 s). Not on the flight: at 46 to 51 s resident 2 walks the upstairs walkway beside
the stairwell (about 1 m between the railing and the wall) towards the bot. Kinematic residents ignored the player on the
floor grid (only on stairs did they yield), so the resident walked into the bot's capsule and pushed it east at 0.9 m/s
against the stairwell railing; once the capsule was lifted onto the glass railing's top (y 4.3 on a 3.25 m floor), the
watchdog marked the edges bad and the replanning cascade ended in the failure above. Removing the routines removed the failure.

**Changes.**
- NPC side (`packages/logic/src/npc/brain.ts`): in a building a calm NPC with the player within 1.2 m ahead on its floor
  stands for 0.5 s, then steps aside (right of its way, else left, else back, whichever the floor grid leaves open) at half
  pace, and goes on after 8 s at most (decaying while the way is clear). Hostile NPCs and dynamic bodies are unchanged.
- Bot side (`packages/playtest/src/agent.ts`): `yieldToResident`: (a) at the foot (or landing) of a stair about to be
  climbed, while a resident stands on that flight, the bot waits and backs off while it is within 1.4 m of it; (b) when the
  watchdog would mark a way bad and a calm resident is within 1.1 m, the bot backs off and waits instead (no bad edge). Both
  share a patience of 24 simulated s per objective; past it a `stuck` warning names the resident, the place and the time and
  suggests another stop or a wider way. Head-on on a flight or walkway the bot does not give way by itself: with both
  standing back (tried first) they held each other up for 25 s and failed; the NPC side gives way there.
- Furniture (`packages/arch/src/layout.ts`, `RoomLayout.fits`): a floor piece is refused if it would cut the room's doorways
  from each other, or cut off a pocket of floor a body (radius 0.34 m, as the building check) can stand on, 0.3 m2 or more,
  from the doors (flood over a 0.1 m grid; rooms already cut off are not made worse). This is a pocket rule, not only
  door to door: the failing cases had an armchair in front of the main door and a plant in the corner closing a pocket
  round the spawn, with the two doors still connected.
- Test support: `generateHouse` takes `residents`.

**Measured.** Repro, 4 phrasings x 3 stair positions: before 2 failed (stair at 3.06, 0.66 with three bedrooms), after all
pass. Bot-only (NPC change reverted): the repro still fails (a resident that walks into the bot cannot be stepped away from
in a 1 m walkway), so the NPC change is what fixes it; NPC-only passes too; the bot rule is the safeguard for flights. Living
entrance sweep (5 widths x 4 depths x 5 opening positions x 3 widths x 2 styles x 3 main-door walls = 1800 houses): 64
unreachable before, 0 after. 60 of them show another, separate fault (below).

**Tests.** `playtest/test/stair-yield.test.ts` (repro at the three stair positions; a resident walking at a standing player
does not push it more than 0.35 m or onto the railing in 70 s; fails without the NPC change), `stair-sweep.test.ts` (eight
generated houses with three residents; the planner house at five stair positions and four phrasings),
`arch/test/living-entrance.test.ts` (six pinned layouts and a 144-house sweep; fails without the rule).

**Gates.** tsc 0; vitest arch, playtest, agent, logic: 144 files, 1844 tests pass; smoke 34/34; `showcase:bake --check` clean
after rebaking `apartment` and `cafe-interior` (their furniture layouts changed with the rule).

**Open.**
- The bot's patience finding (a resident that never leaves) has no test: a resident standing in a corridor is treated by
  the static route planner as a wall ("cannot be reached"), so the wait is not reached in a small world; only the repro and
  sweep exercise the wait paths.
- A curtain overlapping tall furniture on the north wall (3.5 x 3.2 m living room, opening at 0.8) fails the building check
  in 60 of the 1800 houses; not related to doors, not fixed.
- Residents and the bot still pass through each other after the 8 s / 24 s patience.

## A black viewport on a weak machine: what was found, the watchdog, the lighter low tier

A saved world (Highland Trail) opened in Firefox on a weak machine, through a tunnelled Vite dev server, left the 3D
viewport black with no error shown (167 objects, "Saved", WebGL2, no frames per second). The console held WebGL driver
hints (shadow-map comparison filtering, premultiply and flip on texture uploads, a texture "incurring lazy
initialization" on repeated draws) and then `finish "brass" textures failed: the operation took longer than 20 s and
was stopped`, followed by `the compute worker was restarted` for six more finishes.

**What was not reproduced, honestly.** The black view itself did not appear here. Every combination below drew the world
(non-flat pixels at 5 s to 60 s, no page error): Chromium on the integrated GPU (WebGL2, `navigator.gpu` removed) and on
SwiftShader; Firefox on llvmpipe, also with the GPU string spoofed to an integrated Intel so that the real-GPU load path
(draws held until programs link) runs; CPU throttle 1x, 4x, 6x; 4 cores and 4 GB reported; a slow link (60 to 150 ms,
3 to 20 Mbit/s, which only delays the page: a dev server over 3 Mbit/s needed more than two minutes to start, nothing
black); assets held 40 s; the compute worker script held 30 s; all cores busy with a spinner on top of 4x throttle
(world open in 22 s, 117 to 287 ms frames, still drawn). `tests/e2e/weak-gpu.e2e.ts` (`npm run e2e:weak`) is that matrix
as a tool and as a regression test. The remaining difference to the failing machine is a real GPU under Firefox, which
this machine cannot run headless.

**A real defect, in the worker the console points at** (`packages/procgen/src/compute/client.ts`). Every request to the
compute worker (mesh edits, built-in generators for the entities of a world, the finish textures) started its 20 s timer
when it was queued, not when the worker began it. A world sends a hundred generator calls and the finishes at once; on a
CPU that needs more than 20 s for the queue, every timer expires together, the first one kills the worker, all pending
calls reject with `the compute worker was restarted`, and the callers fall back to running the generators inline on the
main thread (`procgen/generate.ts`), one synchronous generator per task, on the machine that could not keep up with the
worker. That matches the log line for line (the first request, `brass`, "took longer than 20 s", the rest "restarted"),
and it turns a slow start into a frozen one. The stall budget now runs from the last reply (three times as long for the
worker's own start-up), the request that was running fails alone, and the ones queued behind it go to a new worker.
Unit tests: a queue of eight 40 ms jobs behind a 120 ms budget all succeed; a stalled request fails alone and the next
one is answered by the replacement worker. I could not show that this alone turns a black view into a drawn one.

**Black-screen watchdog** (`gpu/watchdog.ts`, integrated in `WorldRenderer`, shown by `GraphicsAlert`). From the first
world on it watches two facts: frames being drawn, and a 16 x 16 read-back of the drawn frame (a `drawImage` of the canvas
in the same task, any backend) being one flat dark colour (spread <= 2, mean < 12) three samples 1.2 s apart. No frame
35 s after the world was handed over (the load hold alone may take 20 s), or a black read-back, takes the next step:
lowest tier; no post effects, baked room light or cascaded shadows; plain materials (`scene.overrideMaterial`); shadows off
and half resolution (on WebGPU the studio then restarts on WebGL2). An image in any sample ends the watch. Already on the
lowest tier, the first step applies the second with it. Each step logs why in the console (`black-screen watchdog (...)`
plus the whole diagnostics report), shows one honest sentence over the viewport with a Safe mode checkbox (remembered on
the device, applied at renderer start) and a Diagnostics panel with Copy. The report holds the user agent, cores and
memory, the backend decision and its events, the GPU string and WebGL limits (parallel compile, float targets), tier and
ladder, canvas size and pixel ratio, frames and draw calls, the last read-back, the watchdog's log, the slowest texture
jobs and the GPU-related console lines. Shader compile and program link failures (three's and the driver's wording; driver
performance hints are ignored) are caught from the console as they happen and shown as an error, not left as a black view.
Tests: `packages/render/test/watchdog.test.ts` (9) and the forced-black check in `npm run e2e:weak` (the read-back is made
to come back empty: the alert says the picture was black, the Safe mode switch reaches the renderer, the diagnostics panel
holds the report and the log, the reason is in the console). The editor draws on demand, so while no image has been seen
the watchdog asks for a frame once a second.

**Low tier on a weak machine.** Measured with the integrated GPU, 4 cores and 4 GB reported, CPU throttle 4x (frame times
are CPU-bound there; `GEN_GPU=intel`, dev server, median of 55 frames of a slow orbit, adaptive resolution left on):

| world | before | after |
|---|---|---|
| Highland Trail | 952 draw calls, 2.17 M triangles, 58 ms | 290 draw calls, 1.04 M triangles, 21 ms |
| Kart Canyon | 430 draw calls, 36.8 ms (earlier run) | 346 draw calls, 26 ms |
| Casa Patio | 598 draw calls, 35.2 ms (earlier run) | 582 draw calls, 31 ms |

Highland Trail's frame was dominated by the sun's shadow pass (shadows off: 27 ms) and then by animals: 359 skinned parts
of birds, fish, butterflies and crows cast shadows and were drawn. On the low tier now only the three nearest characters
(within 30 m) cast into the shadow map (10 within 60 m on medium); assets smaller than 0.9 m and scattered fields do not
cast; skinned assets beyond 55 m are not drawn (they return when the eye comes near or the tier rises). The low tier on a
weak machine also draws directly, without the bloom chain: it was the one post pass the tier could still run, and the
"lazy initialization" warnings on repeated draws in the failing console are what a post input that was never written looks
like, so this is the first suspect for the black view on that driver and the watchdog's second step removes it anyway.

**Dev server.** `npm run dev:fast` (`AETHER_DEV_PREBUNDLE=1`) pre-bundles the workspace packages: the home page goes from 373
to 120 requests and a world open from 758 to 346 (about the same bytes). It is off by default because pre-bundled packages
do not hot-reload. Production builds are unaffected. Judge load times from the build (see the section above).

**Not done.** A real-GPU Firefox run. The tint step of characters (`characters/tint.ts`, about 1 s of main-thread time at
4x per world with people) is still on the main thread. The low tier's shadow map still draws every building and large prop
each frame; a map that redraws only when something moves would halve the rest.

## Firefox on WebGL2: nearest shadow comparison, flag-free uploads, cleared targets, a light start that climbs

The same Firefox on a real GPU (WebGL2 only) that showed a black viewport also printed three driver hints: a depth texture
compared with LINEAR filtering ("behavior is implementation-defined"), pixel-store flags on uploads that are not DOM
elements ("deprecated") and a texture "incurring lazy initialization" on repeated draws. None could be reproduced headless
(no real GPU under Firefox here), so these are defensive changes on a path chosen by `geckoSafePath` (`gpu/gecko-safe.ts`:
Gecko user agent, WebGL2, and a GPU that is not a software rasteriser; software GL keeps everything as it was).

- **Shadow comparison.** three's PCF map samples its depth texture with LINEAR filtering plus a comparison. On the safe
  path the renderer uses `BasicShadowMap` (NEAREST plus comparison, well defined) and the sun's soft filter (Aether's
  blocker-search filter, taps from the medium tier) runs on every tier, including low, so the edge is still soft, filtered in
  the shader (`planSunShadows {nearestCompare}`).
- **Uploads.** The only typed-array textures with `flipY` on were the sky dome's sun, rays and moon sprites and the HDRI the
  loader returns. `bakeFlipY` flips the rows in the data once and turns the flag off (the HDRI sun is read before the flip).
  Every other `DataTexture` is created with the flag off; no texture sets premultiply. Image-bitmap loads already ask for
  `premultiplyAlpha: 'none'`.
- **Lazy initialization.** The water's scene copy and planar reflection targets are sampled by materials and used to be
  allocated untouched until the first water draw. They are cleared once at renderer start on the safe path
  (`gpu/prime-target.ts`, keyed by size, so a resize is cleared again). I did not find which texture the failing console
  meant; the post chain's own history targets (temporal AA) belong to three and are not cleared by us, but the safe path starts
  with no post chain, so they do not exist there until the governor climbs to a tier that has them.
- **Light start, then up.** The safe path starts at ladder level 4 (no baked room light, one shadow map, lowest tier, so no
  bloom chain; particles stay). `PerformanceGovernor` now also climbs: one level back after 10 s of p90 above 48 fps at full
  resolution, never sooner than 20 s after any move, and a step down within 45 s of a climb pins that level as a floor for the
  session (`lastMove`, `floor`, `start()`). `upFps` sits well above `lowFps` (20), so frames between them move nothing. The
  studio toasts a climb, and the View menu shows "Graphics: Low (automatic, saving frames; climbs when smooth)". The climb
  also applies on other browsers after a slow patch; before it never went back up.
- **Checked.** Unit tests (`gecko-safe.test.ts`, climbing tests in `performance.test.ts`, `graphicsSummary.test.ts`). `npm run
  e2e:weak` passes (Chromium). Firefox on llvmpipe with the GPU spoofed to an integrated Intel (`--browser=firefox
  --spoof-gpu`) takes the safe path (ladder level 4 at the first sample) and draws the world (146 colours at 30 s). Not
  checked: a real Firefox GPU, so whether the black view is gone is unknown; the watchdog remains the backstop.

**Photo compare turn: one ranking instruction.** With the differences ledger on, a round carried the written "BIGGEST
DIFFERENCE FIRST" line, the ledger's "DIFFERENCES: ... fix the largest first" and (later rounds) "Rank the differences
again": three statements of one step. `rankDifferencesText(round)` replaces them when a ledger runs: round 1 asks for
`report_differences` across the same kinds (amount, size 1..5), largest first, one change per difference, with the
`look_closer` hint; later rounds ask to judge every earlier id on the new render, add what is new, change approach for a
difference that did not shrink, then fix the largest open one. Without a ledger the written ranking is unchanged. Both forms
share one list of kinds and one `look_closer` sentence in `photo/prompt.ts`. The agent's system prompt is untouched (this is
user-turn text), so its token cap is unaffected; `prompt.test.ts` passes.

**tsc.** `npx tsc --noEmit` was already 0 on `origin/main` (5d05db1e) in a clean worktree; the two `land.test.ts` errors were
not present there, and are 0 after these changes too.

## Atlas Chisel comparison

Observation only, from ten screenshots of a public beta session of an image-to-room tool (Chisel). No code, assets or
prompts were taken; the ideas below are workflow patterns any such tool shares.

**What the tool does.** A model builds a clay (grey-box) scene graph of parametric shapes: walls with openings, a curtain, a
rug, artwork, trees scattered along curves and in groups. A "photo match" camera is solved to the reference photo; the agent
renders a clay capture from it and assesses it against the photo in a loop, names the biggest differences (proportion, curtain
position, artwork, rug, pendants) and fixes the largest first. It reads every tree, curve and group before editing, runs a
layout check for floating and buried parts, shows a visible plan with steps, offers a top-down blueprint with grid and line
controls, edits per-object parameters (size, fillet, boolean cut), then stages a camera set and writes output rows (cameras and
render prompts) for a separate generative render step with a style reference.

**What Aether already had.** A solved photo camera whose render is always the first compare image, numbered marks and a
legend on every piece, a top-down plan pose in the review views, a layout check (`query_scene review`, floating and buried
flags, level grounding), chat plan text during generation, independent judges, rollback of changes that make things worse,
and a measured-fidelity score used as advice only.

**What Aether lacked, and what was added.**
- The model could not ask for a closer look. Added `look_closer` in the compare turn: crops of the photo and the same crop of
  the render side by side, the whole pair in one image, and the plan from above with ids, sizes and the room's dimensions.
- The compare turn named a fix order only by checklist. Added an opening step in each round: rank the differences across
  proportion, position, colour, material, lighting and missing or extra items, name the largest, say by how much, fix it first.
- Trees, hedges and fence posts along a lane or bank needed one entity per tree or hand-typed points. Added
  `shape_land {op:"row"}`: an instanced line of any generator along a polyline, each instance on the ground height.
- No one-call read of groups. Added `inspect {groups:true}`: counts, bounds, neighbour distances, overlapping pairs and
  floating or buried instances for every scatter layer and every run of alike entities.
- Not added: a structured plan checklist widget (the existing plan text events already show the model's stated steps in
  chat), clay-to-generative output rows (Aether renders the real scene), and parametric fillet and boolean-cut shape editing.

**Where Aether is ahead.** The result is a playable, physical world, not a grey-box for a later render: Rapier physics, doors
and drawers on joints, NPCs and a playtest bot, with verification that fails a world that cannot be played or walked. It renders
in real time with PBR and a path-traced still, works offline with the planner and with local models, is open and runs in the
browser with no account. Its judges, rollback and measured checks are advisory, and the model decides.

**Tests.** `agent/test/land.test.ts` (row on terrain, both sides, refusals, group read), `photo-closer.test.ts` (crop boxes,
refusals, advertisement), `photo-pipeline.test.ts` (a scripted model calls `look_closer` and gets the pictures; the intro
carries the ranking step).

## Inspiration backlog

Source: the same ten screenshots as the comparison above (the Agent, Scene and Properties tabs, the viewport toolbar popovers,
the settings panel and the Output panel of an image-to-room tool). Ideas and workflow observations only; no code, assets, wording
or branding were taken, and nothing in Aether's interface names that tool. What the checks below say was verified by reading the
Aether source; nothing was run against a live model.

**Done in this round.**

Agent harness (`packages/agent`, scripted-model tests in `harness.test.ts`, `photo-differences.test.ts`,
`review-differences.test.ts`):
- Refused-call reflection, hopeless-repeat guard and the unresolved-calls list before finishing (the loop had no memory of
  refusals beyond the last one).
- Wrap-up heads-up before the turn and tool-call budgets (the run used to be cut off mid-edit with "Stopped after N turns").
- Compaction of old tool results past a size budget, in the run and for continued conversations (a conversation over 300,000
  characters used to be thrown away whole).
- Queue-a-message while a turn runs (`RunOptions.steer`), and continue-after-cancel (a cancelled run used to forget everything).
- `step` events with plain labels and, for a look at images, the pictures the model was shown (the tool shows "Assessing content"
  with thumbnails; the equivalent here is the folded step list with thumbnails).
- Photo compare kit: photo and render side by side from the same camera, region crops, colour readout; the ranked differences
  ledger with verify-after-fix; an independent fresh-eyes cross-check; unresolved differences named in the closing message.
  The same ledger and cross-check for the review of a prompt-built world, compared with the request and any reference pictures.
- Studio: the composer queues messages while a turn runs, "Step N" and "Still working…", the folded step list with thumbnails,
  the ranked differences list in the chat. Turned on for every studio run (`differences`, `crossCheck`).

**Not run.** No live model was asked to use the new tools, so what they do to output quality is unmeasured. Open questions for a
live check: whether the extra images per round (side by side plus up to four crops) help or crowd out the single views on a
subscription backend; whether models keep the ids stable between rounds; the cost of the cross-check call on metered keys
(one extra call per run; it is skipped without a vision model or a host that renders).

**Backlog, in priority order.**

1. *Ask the user mid-run* (`ask_user` tool; the chat shows the question and the answer resumes the turn). The tool's agent states
   assumptions and carries on; a question about a real fork (which of two doors is the main one) would save a round trip. Needs a
   run that can pause on an answer, which the loop does not have yet (the `clarify` event ends the run).
2. *Oscillation guard.* The ledger catches identical refused calls; it does not catch edit A → B → A on the same property across
   rounds. A per-entity edit history in the run, with a reflection on the third reversal.
3. *Persist the conversation.* `ConversationStore` is in memory, so a page reload drops the thread; storing the compacted
   conversation per project would make continue-after-reload work.
4. *Rewind to a step.* Every step is one undo entry already; the step list could offer "undo back to here" (per-step checkpoints).
5. *Properties editing with a boolean cut, mirror and radial repetition.* The inspector edits transform, shape size, material,
   physics and behaviours with undo; mirror and radial repeats and a cut/union/intersect between two shapes are not there. Aether
   builds rooms from parts and walls with openings, so the cut already exists for openings; a general repeat (mirror, radial) would
   serve furniture sets and columns. Larger.
6. *Viewport quality toggles* (outline through objects, hover outline, cavity, ink hatching, simplify while dragging, retina,
   single-pass outlines with a resolution slider). The studio has tier and per-effect switches (ambient occlusion, reflections,
   grain, …) but no outline or cavity options; the selection highlight is in `packages/render/src/view/highlighter.ts`.
7. *Blueprint options* (grid opacity, contour lines, line opacity, blueprint colours; geometry view with x-ray and "see inside
   rooms"). A plan view exists (`PlanView.tsx`); the opacity sliders and an x-ray are not
   there.
8. *Units toggle (metric / imperial).* Every length is metres in the model, the inspector and the tool results. A display setting
   (feet and inches in fields and readouts, parsed back to metres) touches every numeric field; keep the model side metric.
9. *Gizmo and snapping popover* (handles auto/3D/surface, global/local space, gizmo location origin/centre/bottom-centre, ground
   and surface snapping with landing normal/upright, wall snapping flush with turn/slide, grid snapping). `GizmoSettings` exists
   in the store; the surface and wall snapping modes were not checked and may be partly there.
10. *Navigation settings* (orbit, fly, run; fly and run speed, run height, jump height, scale speed with altitude, inverted
    look). The studio has orbit and a play mode with its own controller; a run-through mode for walking the built room at eye
    height before playing would help judging scale.
11. *Viewport settings* (frame selected, reset view, field of view, gizmo size, solid ground, hide back-facing surfaces). Framing
    the world exists (`frameWorld`); reset view, the field-of-view slider and the back-face toggle were not checked.
12. *Iterations of a design* (an Output panel with numbered iterations, each holding its own prompt, render, progress and style
    reference). Aether has branches and time travel in history (ARCHITECTURE §5); a gallery of branches with a thumbnail each
    and "compare two" would be the equivalent.
13. *Edit scene / render toggle, label and adjust bottom bar, tool-tip cards with "Got it".* The studio has the tour and
    shortcut tips; the bottom bar (label the selection, adjust it) is a quick-access idea for the selected object.
14. *Splat view of renders, style reference for renders, video render.* Not applicable: Aether renders the real scene (path-traced
    still, video export already exist).

**Observed in the tool, deliberately not copied.** Output rows (cameras and render prompts) for a generative render step; a
parametric clay scene graph as the only representation; a separate "Render" model pass. Aether keeps one world that is also the
game.

## Staged photo-to-room harness

What was added: a stage machine (capability, evidence, camera, shell, furniture, materials, lighting, repair, cross-check, delivery) with verdicts given by the model through `stage_gate`; repair order enforcement (`declare_repair` with a cause class, camera before geometry before materials before lighting, size 3 and up blocks later classes; `set_photo_camera` for the camera class); an assumptions ledger and a provenance record (photo hash, permission note, estimated scale, hidden-surface limits, repairs); a resume state for the repair stage; a checklist card and a record panel with exports in the studio. Design: `docs/PHOTO_TO_ROOM_HARNESS.md`. Opt-in through `PhotoOptions.harness`; the studio turns it on.

What was checked: scripted-model tests for every stage and gate, the guard and the resume (`packages/agent/test/photo-stages.test.ts`), the chat view model (`apps/studio/test/chat.test.ts`), typecheck, the agent and studio suites, smoke, `showcase:bake --check`.

What was not checked: a run against a live model (the Codex subscription is limited, so only scripted models were used); the new panel in a real browser (no photo run was driven through the UI); whether models call `stage_gate` and `declare_repair` reliably, which only real runs can show. Known gaps: the record is not inside the `.aether.json` project file (the world document has no field for it); a resumed run needs the photo still held in memory by the studio; the playable verification is the existing host verification, not a new walkthrough bot.

## Photo rooms that read as real: textures from the photograph, an optional image model, light and look

Report of 2026-10-22. The complaint: the room built from a photo looks cartoonish. What was found, what was built, what is still wrong.

**What read as cartoonish.** Two things. (1) The gallery cards of the four photo rooms were flat software previews (the headless
rasteriser: no bounced light, no textures, one flat colour per surface). (2) The studio render of the same worlds was physically lit
but dark and untextured: every surface a plain procedural finish, the exposure at 1 (nobody had called `tune_look`, the recorded
replays contain none), the view through the window a flat green plane under an analytic sky.

**What was built** (each step is its own commit on `main`; contract in `docs/CONTRACTS.md` "Texture sets", tool in
`docs/AGENT_TOOLS.md` `make_texture`, image findings in `docs/IMAGE_GENERATION.md`).

1. *Texture sets in the World IR*: `MaterialSpec.texture`, `arch.skins` for pieces, `WorldDoc.textures` (records with provenance),
   `setMeta textures`, an asset-store registry with tiers 256 / 512 / 1024 px (WebP) and byte caps, a studio IndexedDB store, packages
   that carry the files, credits that state photographed / AI-generated / procedural. The renderer binds a set like a finish.
2. *Photo-derived textures* (`@aether/procgen/photo-texture`): every texel of a floor or wall is projected through the solved camera
   (rectified, metric), what stands in front is masked (description boxes, outliers), the largest clean square is found and its
   holes filled, the large-scale light is divided out (plane fit and blur, per channel), the tile is made seamless (and quilted
   larger when the clean patch is small), and occlusion / roughness / normal maps are derived. Soft pieces (bed, chair, sofa,
   curtain) are cropped from their boxes. Before the first comparison the photo flow applies what reads clearly and tells the user,
   with the reason, which surfaces keep their procedural finish.
3. *`make_texture`*: image model (when connected and the model gave a prompt) then the photo then the library, naming the source and
   why the others were not used. Images: Codex's built-in image tool through the bridge or the local app, or an OpenAI Images key.
4. *Light*: the sun is put outside the window wall the photo shows (hour from the sky model's own bearing; a test keeps arch and
   render in step), warm and cool light lean the sun tint and white balance. Look (exposure, ambient, lamps, sky) is the reviewing
   assistant's call: `tests/fixtures/photo/<room>.look.json` records what was chosen from GPU stills next to the photos.

**Before and after** (`~/.local/share/aether/look7/`: `before/<room>.png` the old build on the GPU still renderer, `after/<room>.png`
the rebaked world, `before-after.png` photo | before | after, `thumbs-after.png` the new gallery cards; machine: `GEN_GPU=intel`,
Chromium WebGL2 over ANGLE GL; the stills are GPU renders at 1280 px, `final` quality). Honest reading of the sheet:

- Before: near black rooms with a flat green or grey window and bare surfaces. After: lit rooms with a photographic sky in the windows,
  fabric folds on the curtains (hotel), woven bedding, a printed armchair cover (four-poster), seamless photographed wall and floor
  tiles where the photo shows them. The gallery cards are now these GPU stills instead of the flat previews.
- Still wrong: the twin room's near bed texture is a coarse crumpled pattern (a small clean patch, enlarged by quilting; the repeat
  shows); the hotel is darker and less saturated than its photo (the photo is a filtered high-key picture; the look was set by eye,
  not fitted); the window view is still a cloud sky over a flat green plane, not the photographed lawn and trees; floors were
  textured only where the camera sees them (pd1 and pd2; the hotel floor is hidden by the bed, the twin floor too, so those keep their
  carpet finish); relief and roughness are heuristics from luminance plus the fine grain of the library finish of the same class, not
  measured; the textured surface keeps the description's colour (the pixels' mean is not albedo under that room's light).
- The recorded replays judge the same: checklist scores unchanged (hotel 8/17, pd1 5/17, pd2 14/22); the measured fidelity moved by
  at most 3 points. Nothing here changes what the judges see, because the replay returns recorded verdicts: whether the judges, live,
  rate textured renders higher was not measured.
- The hotel's right curtain panel is dropped by the usability check on rebake (it overlaps the north-wall furniture; the committed
  world predates later layout changes and the old pipeline no longer reproduces it either: `showcase:photo-rooms` fails the same way
  on `ea6c3d71`). `scripts/showcase/photo-rooms.ts` now removes a curtain the checker names with "Move … to".

**Not verified live.** Codex image generation (the usage limit resets on 27 October): the backend, the bridge route and the tool are
tested with a stand-in `codex` that writes the picture where the real CLI does and with fake generators; the first real run is the
check in `docs/IMAGE_GENERATION.md`. No OpenAI key was available, so the Images API client was only tested against fakes. A live model
calling `make_texture` in the compare turn was not run either (replays only).

**Gates** (worktree `aether-realism`, Node 24, under `heavy2.lock`): `tsc` 0 errors; `vitest run` 458 files, 4915 tests pass;
`npm run smoke` 34 / 34; `showcase:bake --check` ok for all worlds including the four rebaked rooms; `bench:quick` checks passed;
`npm run e2e:weak` "WEAK GPU OK". The bundled worlds fetch their texture files on open (checked in Chromium: three 256 px maps per
set, HTTP 200).

**What to do next.** Run the Codex image check after the 27th and let a live compare turn use `make_texture {prompt}` on a wallpaper
or a floor; fit the look by the measured evidence plus a look at the pictures instead of by eye alone; photograph-based window views
(an HDRI of the real outlook, or a sampled backdrop from the window region of the photo); texture the ceiling only where the photo
shows a pattern; anti-tile the large sets so the repeat of a small patch hides.

## People that move like people: sitting, jumping, the head

The report: in the four-poster bedroom the player's body stood on top of the armchair after "E Sit on" (the game thought he sat), his head turned
and then grew, the jump looked bad, and the outfit looked speckled. What was wrong, what changed, what was measured.

**The head that turned on and grew (root cause).** Three's animation mixer writes a bone only when the animated value changed since its
last write, so a clip that never changes a bone (the jump and fall poses are single static poses) leaves whatever was last put there.
The rig applied its corrections after the mixer, on top of the bone each frame: the look-at rotation, the arm relax, and the hip-scale
multiply of the skeleton's root node (`position.y *= hipScale`). In a static pose each frame compounded the last: the head turned on
and on and the body's scale ran away. Fix: before the mixer runs, every animated node is put back to the clean pose saved right after the
previous mixer step, so a correction is always applied to the clean pose once. Reproduced headlessly first (`rig-stability.test.ts`, a real cast body and the
real clips loaded without textures; look target, jumps, falls over 4000 frames): the head's world scale drifted by 0.12 before, stays within 1e-3 after.

**Sitting.** The old sit teleported the capsule to the seat surface and the body (which had no sit state) stood there: feet on the cushion.
Now: `seatPose` is an anchor computed from the kind and the piece's footprint (seat height, the pelvis toward the backrest for backed
seats, the way out; a bed is sat on at the side edge nearest the player, a stool takes its own height, loungers and beds are seats now).
`SeatSequence` (pure) walks the body to the approach point, turns it to face out of the seat, lowers it (the captured sit-down clip at
1.4x, the body slides back onto the seat), holds the seated clip with its breathing, rises and steps out. The capsule is disabled for
the whole time and returned at the approach point. In the rig the pelvis is placed on the seat surface (`seatTop` or a world
`seatAnchor` for NPCs), both feet are planted on the floor with two-bone IK, the hands rest on the thighs with arm IK, the thighs stay level.
NPC routine stops take `sit: <seat entity id>`: they stand at the stop, turn out of the seat, sit for the stay, stand up, walk on.
Measured headlessly (`rig-motion.test.ts`): pelvis within 3 cm of seat top + 11 cm for 42 cm, 45 cm and 65 cm seats, ankles within 6 cm of their standing height, head within 30 cm of
the pelvis horizontally (upright spine), thighs level within 14 cm, and after standing up the pelvis is back at 0.85 m or more with no model offset left.

**Jumping.** The captured jump start played a crouch while the body was already rising (physics leaves the ground at once), and the
jump and fall poses are static. Now the push-off keeps the soles on the launch point for 0.14 s as the legs extend, the knees and hips
tuck as the climb slows (the amount follows vertical speed against the jump's peak speed), the legs reach for the floor on the way
down, the arms swing up and then out, a fresh upward burst in mid-air reads as a second jump (a faster, fuller tuck, for a game feel that
allows it; there is no double jump in the controller today), and the landing keeps a share of the captured crouch scaled by the impact
speed with the feet planted and a small weight shift. Everything eases in and out of the clips.

**The head.** `LookController`: yaw within 70 degrees, pitch within 35, a turn rate limit, a slow return to forward, a fade-out while the
body jumps, lands, is hit, sits down or stands up, targets farther round than 110 degrees are given up (the head returns to forward, no
flip). The player's gaze follows the view only while the body is at rest; the body turns on the spot once the view is more than 70
degrees round. Tests circle a target (behind the body included) at head height and over it and assert limits and no single-frame step of 10 degrees or more.

**Stills** (`~/.local/share/aether/look13/strips1/strip-*.png`, Chromium WebGL2 over ANGLE GL on the Intel iGPU, 960 x 720, a camera
2.3 m to the side; `scripts/motion-strips.ts` records, `scripts/motion-montage.py` lays out): walk, jump, sit-down (the player walks to the approach point,
turns, lowers into the armchair), seated, stand-up. Honest reading: the sit reads as a person sitting in the chair, with the lean
forward of the captured motion on the way down; the jump shows the leg tuck and the landing absorb. Weaker: the arms are fairly straight
at the apex, the stand-up ends with one arm out as the captured clip does, the stills are 100 to 400 ms apart on this GPU so they are
samples, not a smooth strip, and walking is the captured gait (feet are not re-planted by IK: the clips are speed matched, which is
what keeps them from sliding, nothing more was done there).

**The speckle.** Not reproduced: the outfit textures render clean on this GPU in the stills above. In the report's screenshot the same grain is on the curtains, wall
and chair, so it is the scene's lighting noise (the other render work), not the character's recolouring. What was changed anyway: the recoloured
texture now always has a full mip chain (a minified photographic texture without one shimmers as salt and pepper), straight alpha and
at least 4x anisotropy. Not verified on the machine that showed it.

**Licences.** No new clips: everything procedural or IK on the existing captured set (credits unchanged in `docs/THIRD_PARTY.md`).

**Gates**: see the final report of the turn.

## 2026-10-22 Twin room: crowded, grainy, over-exposed, door stuck on the bed

User report (Walk mode, Ultra, Firefox WebGL2): flicker and aliasing, grainy photographed textures (crumpled bed), exposure 2.8 / ambient 1.4, a very small room, and the door jamming against a bed when it opens.

Principle applied: the model judges, the tools give it evidence. Hard rules are advice plus a safety net that reports.

What changed
- Review turns (photo compare, generation review, architecture review) now carry advisory room evidence: door swing arcs and the 0.9 m approach zone, walking paths from the doors to beds, desks and wardrobes on a 0.6 m body grid, pieces nobody can walk up to, clutter share, and standard sizes (bedroom 3.5 x 4 m, double door 0.9 m, 0.7 m between beds). Drawn on the plan image (green swing, amber approach, dashed blue path, red blocked) and listed as text; the text tells the model to decide what to move, remove or enlarge and to render again. `packages/arch/src/scene/advice.ts`, `photo/scale.ts`, `agent/src/review.ts`, studio `ai/marks.ts`. Placement refusals that already existed still report; nothing is silently rewritten. A tool `rescaleDescription` resizes a room keeping pieces against their walls. Hinged leaves on joints now sweep, wide swing doors hang as a pair.
- Photo analysis prompt sizes rooms from known furniture (a two-bed room is about 4 m across); tune_look guidance keeps exposure near 1.
- Textures: noise measured and regularised (bilateral filter on the measured noise, coring under the noise floor, ratio clamp); creases taken out of photographed covers so a bed does not repeat one crumple.
- Rendering: anisotropy 16 on every PBR and model map, alpha-to-coverage on foliage cut-outs, thicker skirting (16 mm) and panel beads (6 mm). TAA with jittered shadow noise, texel-snapped cascades, MSAA fallback and shadow bias already existed and were left alone.
- Walk camera: 70 degree lens (was 55) and 1.65 m eye (was 1.6 m).
- Look: the stored look of the four photo rooms was exposure 2.6 to 4 with ambient 1.2 to 2. Live walk-camera frames (Intel iGPU, ANGLE GL) showed why it looked washed out: the renderer's own eye adaptation already raises exposure indoors, so the stored value stacked on it. Exposure 1 with the default ambient reads correctly in all four rooms; the old values were a crutch from the software preview.
- Twin room: the recorded transcript was stale (an older tool vocabulary, so the replay never judged and shipped a half-furnished room). Re-recorded from a live run (claude-code, 9 model calls, 16 of 16 items judged matching), then widened by hand to 4.2 x 5.88 m (the model chose 3.6 m itself and did not enlarge further). All four rooms rebaked with the new texture path.

Measured, honestly
- Camera-orbit flicker score (`scripts/flicker-score.ts`, second temporal difference of live frames, Intel iGPU, ultra, twin room, textures not loaded in the harness): before orbit 1.392, still 0.598; after orbit 1.408, still 0.559. No measurable change on this scene. The anisotropy and thin-geometry changes help at grazing angles and distance, which this short orbit barely exercises; I do not claim a flicker fix beyond what these numbers show. The Firefox report was not reproduced here (Chromium only).
- Live frames at exposure 2.8 / ambient 1.4 against exposure 1 / default: the first is washed out, the second is correct.
- Gates: vitest arch, agent, procgen, render and scripts/bench pass; smoke 34/34; showcase:bake --check ok; e2e:weak ok. `tsc` has one error that is not from this work: `packages/agent/src/refine/ops-paint.ts(342)` reads `Look.preset`, which another commit on main introduced.

Not salvaged: the earlier uncommitted worktree changes that silently enlarged rooms and slid furniture clear of doors during the build (against the principle above; the evidence now goes to the model instead), and the PBR finish and fabric-geometry experiments in `aether-realism4-a/b/c` (unreviewed, touch the schema). The lightmap files were not touched.

## 2026-10-22 Real furniture models instead of primitives

User report: furniture and props look like Minecraft blocks and primitives; wanted real models without Blender, chosen and judged by the model.

Salvaged from the stopped worktree (`aether-lib`, uncommitted): the interior selection table, the catalog `interior` schema, the texture-tier script and the Poly Haven list limit. Everything else was built new and checked.

What changed
- Library: 98 photographed Poly Haven models (CC0) in `assets/lib/i/`, built by `build.ts --interior` from `selection-interior.ts`: metres, floor-centre pivot, meshopt, triangle budget 20k, one distance level, a light copy (256 px) for low tiers, 512/1024 px maps. Colours and styles are measured/recorded per model; types: sofa, armchair, chair, stool, table, coffee table, desk, bed, wardrobe, dresser, shelf, bookshelf, lamp, plant, vase, books, clock, mirror, picture, small appliances. Sources, authors and SHA-256 are in `docs/THIRD_PARTY.md`.
- Orientation was checked from straight-on renders (`thumbs.ts --front`): two models were turned. Six models were dropped after looking at them (broken leaf cards after simplification, black picture canvases, a 2.3 m throne chair, a plastic chair that ended up around a penthouse table).
- LLM flow: `find_model` (style, colour, size ranking with facts), `place_items kind "model:<id>"`, `model: "auto"`, `fit [w,h,d]`, upholstery recolour; anchoring, collisions and usability treat a model as the part it stands in for. Photo rooms ask for the closest model per piece (sized to the described part) and fall back to the part when it does not fit. Generated architecture takes models for seating, tables, beds, lamps and plants; cabinets, wardrobes, kitchens, mirrors and pictures stay parts (they open or vary). Fine edits that need part options send a piece back to its part.
- Image-to-3D: hook documented only (TripoSR, TRELLIS.2, Hunyuan3D); nothing was run.

Measured, honestly
- Shipped bytes: about 50 MB main files plus distance levels, 17 MB light copies; a scene fetches only what it places.
- Stills (Intel iGPU, `~/.local/share/aether/look10/{before,after,compare}`): the armchairs, plants, shelves and tables read as real objects; the rest of the rooms is unchanged. The photo rooms gain only one to four models each (beds, nightstands and curtains have no model in the library), so their difference is small. The hotel room was left as it was: with the model armchair the recorded replay lost a side table and a curtain.
- Gaps: no sink, toilet, bath, fridge, rug, curtain or modern bed exists among the CC0 sources checked; those stay parts. Cube shelves replace a book-filled parametric shelf in the apartment, which is arguably worse.
- Existing refine tests changed: sofa resize now scales the model; a cover material on a model goes back to the part.
- The twin-room verification failure seen on `main` before this work is fixed by the other agent's rebake; this work did not cause it.

## 2026-10-22 Fresh-clone gates, rapier versions, production build and hosted site

Rapier: the root `node_modules` held `@dimforge/rapier3d-compat` 0.12.0 (pulled by `@types/three`) while `packages/physics` wants 0.21.0 and sat on a nested copy. Verifier and studio import rapier directly, so from the root they resolved the 0.12 types and runtime. Fix: `apps/studio` and `packages/verifier` declare `0.21.0`, a root `overrides` entry dedupes it, and the lockfile now hoists a single 0.21.0 (no nested copy). The hoisted entry is kept as a production dependency (a first attempt left `"dev": true`, which made `npm ci --omit=dev`, used by the Dockerfile, drop rapier; checked with `--dry-run`).

Fresh clone of `main` (temp dir outside the repo), `npm ci --ignore-scripts`: one rapier 0.21.0, `tsc --noEmit` clean, vitest physics + verifier + playtest 56 files / 495 tests pass, `apps/studio` gamesVerified 11/11 (sealed replays unchanged), `showcase:bake --check` all 20 projects up to date.

Full vitest in chunks on the same clone: render 103 files / 851 tests (including the final scene-sync.ts edit), agent 890, arch 504, assets 110, core 252, logic 221, procgen 450, voxel 89, bridge 122, cli 61, server 179, studio 95 files / 693, scripts/bench 49. No failures. smoke 34/34. `bench:quick` passes its checks (offline 7/7; the codex model sample was 6/8 right kind, one game without a win rule: model variance, not a regression). `e2e:weak` ok (Chromium, SwiftShader, 4x throttle; the black-picture fallback to the lowest tier fired as designed).

Production build (`npm run build`, 1210 modules): `apps/studio/dist` is 235 MB, of which `assets/lib` is 193 MB (c 13, h 9.3, i 64, k 68, m 31, t 3.6, x 6.2 MB). Entry page loads 28 scripts/styles, 2.3 MB raw, about 744 KB gzip; the entry script itself is 122 KB. Largest lazy chunks: webllm 6.1 MB, three 985 KB, verify worker 873 KB, playtest worker 671 KB, rapier wasm 3.1 MB (1.19 MB gzip). No build warnings printed.

Hosted site: `https://aether-studio-lyart.vercel.app` serves `7bf28cb6` (deployment 13:40 UTC), not the newest `main`. Vercel refused the builds of the two later commits (`ff34784f`, `45d79e40`, lockfile and package.json only) with "Deployment rate limited, retry in 24 hours", on both Vercel projects (`aether-studio`, `deploy-bc88ec5`). Served asset hashes match a local build of current main except the entry script (`index-vc5Gu5ZL.js` live, `index-CFNkfnyH.js` local), which I did not trace. Nothing user-visible should be missing, but the rapier pin is not live until a redeploy succeeds.

Assets on the host: `assets/lib/**` is served `public, max-age=31536000, immutable` with content-hashed names (checked a model in `i/` and a texture in `t/`; `model/gltf-binary`). `templates/*` is cached 300 s. `templates/lightmaps/index.json` is `{ "keys": [] }`: no baked lightmaps are shipped yet. Lazy loading, measured in Chromium (40 s per world, software GPU): the highland-trail world requests no `lib/i` file, photo-twin-room requests 1, apartment 6, of 98 interior models. The catalog chunk (metadata only, 316 KB) is not preloaded by `index.html`.

## 2026-10-22 Baked lightmaps: finished, shipped for seven rooms, honest numbers

Task: finish the baked global-illumination lightmaps (path-traced bounce light and sky occlusion per surface, content-keyed assets, runtime on the medium and high tiers over the coarse light volume, `bake_light` for the model, visible status with cancel, graceful fallback).

What was on `main` already (reviewed, kept): the CPU path tracer and chart unwrap (`environment/lightmap.ts`, worker, validated request and reply), the `.lmap` file and IndexedDB cache, `LightmapController` with an in-process-worker test, bundled files through an index, the baking pill with cancel and the baked-light choice in the display menu, `environment.lightBake` and the `bake_light` tool (system prompt unchanged apart from the tool description; agent prompt tests pass). No three-gpu-pathtracer is used: the bake is a worker tracer, so it does not need WebGPU and runs on every machine; WebP is the image codec (PNG, then raw as fallbacks), KTX2 was not done.

Salvaged from the stopped worktree `aether-bake`: the key split (content hash of geometry and volume apart from the quality, so a bundled file of any quality applies when none was asked for) and the `scripts/showcase/lightmaps.ts` bundling script. Not salvaged: the `LM_DEBUG` console line in the renderer, the `package.json` script (another agent owns that file; run the script with `npx tsx`).

What was wrong and is fixed
- The lightmap never reached the screen. Measured with the volume switched off and the atlas on: the image was byte-identical to no light at all, even with the irradiance scaled twelve times. Cause: three keeps one program per mesh and material and looks at the geometry's attributes again only when the material's version changes. A mesh that swapped to the geometry with the `aetherLM` coordinates kept the program that never reads the atlas. `refreshProgram` (material `needsUpdate`) is now called on every swap and restore, in the controller and in the merged building geometry; a controller test pins it. With it, atlas alone vs nothing differs (mean 1.5 of 255 on the twin room), and atlas strength 0 vs 1 differs (2.2).
- Shell and volume depend on the camera: `cutaway` walls (and lowered walls in the view modes) change what the light volume traces, so a volume baked with the camera outside sees a room opened on one side (hotel room: 0.18 sky visibility at the eye) and one rebaked with the camera inside sees it closed (0.009, exposure +4 EV, the window blows out). This is older than the lightmap and is not fixed. Consequences: every mode of the stills below opens a fresh page and bakes from the state a world opens in, before the camera moves; the bundled files match the world as it opens (verified), and a world opened in another view bakes in the browser. I tried replacing a buried probe sample at the eye by its open neighbours: it did not change the measured case and was reverted.

Bundled (`apps/studio/public/templates/lightmaps/`, medium, 512 px atlas, 48 rays per texel; 2.4 MB for six files, each under the 2 MiB cap)

| world | meshes baked | texels | bake wall time (Intel iGPU box, nice 19, worker) | file |
| --- | --- | --- | --- | --- |
| photo-hotel-bedroom | 60 | 106 078 | 7.0 s | 229 KB |
| photo-twin-room | 60 | 103 677 | 6.7 s | 217 KB |
| photo-four-poster | 57 | 89 886 | 7.6 s | 249 KB |
| photo-vaulted-bedroom | 60 | 96 368 | 8.5 s | 259 KB |
| skyline-penthouse | 219 | 38 384 | 8.2 s | 733 KB |
| casa-patio | 273 | 51 437 | 8.6 s | 731 KB |

Two bake runs gave the same keys (deterministic). `showcase:lightmaps --verify` (dist containing the files): all six open with `source: static` and the atlas applied with no bake. The bake only starts after the light volume is on screen, so it never blocks the first frame; the volume itself took 0.3 to 17 s on these worlds. Other sizes, hotel room: low 256 px / 24 rays 0.8 s (14 366 texels), medium 7 to 11 s, high 1024 px / 96 rays 43 s (315 000 texels).

Before and after (stills under `~/.local/share/aether/look8/lm3/<world>-{off,medium}-{spawn,back,cover}.png`, side by side with a 6x difference in `.../compare/`)
- First-person interiors show it: corners and the ceiling line darken, the floor darkens along the walls, wall tone follows the window side (vaulted bedroom spawn: mean 8-bit difference 5.0, twin room 4.9, four-poster 3.6, hotel 2.9). The effect is soft, not dramatic: a few levels of 255 on average, more along edges.
- From the cover cameras of the two large houses the building is small in the frame and the difference is about 0.05 to 0.7 of 255: invisible. Skyline spawn: 0.08.
- Artifact seen: the vaulted bedroom has a pale blue blotch high on its left wall in the baked still (a chart seam near the ceiling reading the sky); not fixed.
- Exposure is identical in both modes (the eye's light comes from the volume), so the pairs are comparable.

Render cost: the draw cost per frame in these captures (median of 12 frames, headless Chromium on the Intel iGPU through ANGLE/WebGL2) is 1.2 to 13 ms with large run-to-run swings and no consistent sign between off and medium (hotel 1.5 vs 2.1 ms, four-poster 2.4 vs 1.2, skyline 11.2 vs 13.1, casa 5.0 vs 6.4). The timer measures frame spacing with the GPU asynchronous, so a difference of a few percent is not resolved here. What is known from the shader: a baked surface reads one 2D texture (two reads with the colour decode) instead of twelve 3D reads plus the leak test of the volume. No measured speed-up is claimed. A shader recompile for the swapped meshes follows an apply (a few hundred ms on the main thread of a weak machine, not measured separately).

Weak devices: the automatic bake does not start on the software tier, in low-memory mode, on weak hardware or on the low quality tier; a bundled file is still looked up and applied there (that is the case the bundle is for). `npm run e2e:weak` passes (software GPU, 4x throttle, highland-trail: not an interior, so it does not exercise the atlas).

Not done or not verified
- The WebGPU backend was not exercised for the lightmap: all captures are Chromium on the Intel iGPU through ANGLE (WebGL2). The same node code serves both, and the program-key problem is backend independent, but only WebGL2 was looked at.
- Baked light is stored as the browser cache plus the bundled folder, both content-keyed. It is not embedded in an exported or shared project file; a project opened on another machine bakes again (seconds to a minute) unless it is one of the bundled worlds.
- The `bake_light` tool was unit-tested and is in the prompt, but no live model run decided to call it in this work (the offline planner does not use it); the model's judgement from renders is untested.
- Bundled keys depend on the world and on the render code that feeds the bake: a rebaked world or a change to the unwrap invalidates its file (`--verify` finds it) and the browser bakes instead.

Gates (worktree `aether-bake2`): `tsc --noEmit` 0 errors; `vitest packages/render` 851 passed, agent prompt and bake-edit 16 passed; smoke 34/34; `showcase:bake --check` exit 0; `e2e:weak` passed.

## 2026-10-23 Interior exposure that does not depend on the camera (room exposure, as-built light volume, windows that let light in)

Task: the eye-adaptation exposure of a building followed the camera (hotel photo room: sky visibility 0.18 at the eye with the camera outside, 0.009 with it inside; exposure +1.6 EV against +4 EV and a blown window). The earlier attempt (replace a buried probe sample) did not touch the cause and was reverted.

What was really wrong (reproduced with `scripts/exposure-trace.ts`, before = the build of `bb3eb480`)
1. The light volume (and the lightmap) was traced from the scene as it stood, and the architectural view edits that scene: a `cutaway` wall facing the camera is regenerated at 1.05 m with its window holes filled, hidden ceilings stay, `down` and section cuts do the same. A volume baked with the camera outside therefore saw a room open at the top (vis 0.177 at the spawn); one baked with the camera inside saw a closed room (0.009). Hotel room, same world, walls `cutaway`: camera outside 0.177 and +1.65 EV, camera at the spawn 0.009 and +4.00 EV. The worlds open in that cutaway-from-outside state, so every bundled lightmap was baked from the leaky volume.
2. The eye read the volume at one point, six directions, so one step along the room moved the exposure: hotel room, five positions in one room, one bake, +1.24 to +2.11 EV (spread 0.88); in the closed-room volume +1.1 to +4.
3. Windows were solid in the trace: an `arch-window` carries a thin emissive "daylight" pane (the picture of the sky) that the trace treated as a wall. The probe map of the vaulted bedroom had 0 sky visibility next to its two windows. Everything that looked lit before was light leaking over the lowered walls.
(The adaptation smoothing was not the cause: 0.55 s time constant, snap on a jump of more than 1.5 m, unchanged.)

What changed
- `view/room-exposure.ts` (pure): one exposure per room, measured once per volume over the room's floor plan (5 x 5 points at 1.5 m, 0.45 m off the walls): the brightest 30 % (windows) and darkest 10 % of the points are dropped, the rest averaged as stops with the existing 0.88 share, held to -1.5..+3 EV (was -2..+4 per point). The weight of a room ramps over 0.45 m at its edge, rooms share an eye at a doorway (mean of both), the room the eye was in keeps its weight 0.25 m past its wall (hysteresis), a camera outside looking into a room through cutaway/lowered walls reads that room (full weight to 10 m, none at 22 m, within 0.62 rad of the view axis). Outside every room: the old point reading, held to the same range. The rooms are found from the `room` floors and the ceilings over them and recomputed when the volume changes. The existing 0.55 s smoothing stays. `environment.exposure` and the grade's `exposureEv` (the model's `tune_look`) multiply the adapted exposure (`toneExposure`): a bias on top, same value in every room.
- The volume and the lightmap trace walls as built (`asBuiltWall`: the generator is run again without `params.cut`, throw-away trace meshes; the lightmap still bakes onto the drawn meshes) and a window's daylight pane lets light through (`isDaylightPane`).
- `scripts/exposure-trace.ts` (exposure at a set of cameras and along a path), `volume-probe.ts`, `pixel-probe.ts` (debug).
- Tests: `room-exposure.test.ts` (10: same value for five eye positions in one room within 0.3 EV while the point reading spreads more than 0.3, window trimming, clamps, doorway sharing and hysteresis, subject room, tune_look as a bias), a daylight-pane test in `light-volume-controller.test.ts`, `lightmap-geometry.test.ts`.
- The six bundled lightmaps were rebaked (the volume changed, so every key changed; `LIGHTMAP_VERSION` is 2 for the second, unrelated change below); `--verify`: all six `static`.

Measured, after (Intel iGPU, Chromium, walls `cutaway`; numbers from `~/.local/share/aether/look14/after/trace.json`; positions: the spawn, its reverse and steps of 1.2 m around it; `east` is 1.2 m east of the spawn and, in the hotel and twin rooms, stands in the window wall just past the floor plan)
| world | in-room EV (spawn, back, west, north, south) | `east` | outside cameras through the cutaway |
| --- | --- | --- | --- |
| hotel bedroom | 3, 3, 3, 3, 3 | 2.3 | 2.99, 2.99 |
| twin room | 3, 3, 3, 3, 3 | 1.4 | 2.8, 3.0 |
| four-poster | 2.87 all | 2.87 | 2.82, 2.87 |
| vaulted bedroom | 3 all | 3 | 2.64, 3.0 |
| Skyline Penthouse | rooms differ (Gallery +1.04, Living -0.15, Main bedroom -0.8, Dining -1.2): +1.04 at the spawn and its reverse | n/a | -0.1; cover 0 |
| Casa Patio | 3 all (seven rooms, raw 3.3 to 10) | 3 | 3, 3; cover 0 |
Before (same cameras, one volume, walls `cutaway`): hotel 1.65, 1.65, 2.11, 1.76, 1.82 (east 1.24), vault 0.9, 0.9, 1.56, 1.31, 1.44, four-poster 1.9 to 2.2, twin 2.2 to 2.5, casa 2.5 to 2.8; and with the volume baked from another camera, +4.0 against +1.65 in the hotel room. Outside cameras through the cutaway read 0 (outside the volume's box) or whatever the nearest probe held. Walk from the outside view into the room (19 steps of about 0.5 m, 450 ms apart): the exposure holds the room's value while the camera looks in, dips to 1.4 to 2.6 as the eye crosses the wall (weights ramp), and returns to the room's value, with the largest step between two readings 1.6 EV (vaulted bedroom, at the wall).
Honest reading of these numbers: inside one room the exposure no longer depends on where the eye is, but four of six worlds sit on the +3 clamp (their raw demand is 3.3 to 10 EV), so part of the stability is the clamp. The camera dependence of the volume itself is gone: the same volume results from a camera outside and inside (vis 0.009 at the hotel spawn both ways).

Stills (`look14/after/`, `look14/before6/`, 640 x 360): the twin room and the hotel room read as before (twin: nearly the same picture; hotel window no longer driven to +4). The vaulted bedroom is darker and cooler than before (walls grey where they were cream): the old picture came from sky light leaking over lowered walls; with the room closed and its windows open only through the daylight panes, the volume's bounce is thin and +3 EV does not make up for it. I did not tune the volume's bounce or raise the clamp to hide this.

Not fixed, with what is known
- The pale patch high on the vaulted bedroom's left wall is still there. Found: in the volume-only render (`look8/lm3/...-off-spawn.png`) the same place is a dark, stair-stepped patch, so it is a light-volume cell artifact that the lightmap re-lights (pale blue sky tint); the pixel under it in the current world is the four-poster's canopy (a ray at that pixel hits `furn-bed`), i.e. a thin canopy inside the bed's box proxy, not a chart seam on the wall. Two things tried and kept as sound but not the cause: leftover untraceable texels take the building's mean light instead of full sky (was vis 1; `LIGHTMAP_VERSION` 2), and two-sided meshes stay out of the lightmap (none of the six worlds has one among its baked meshes, the key did not change). Open: exclude a bed's canopy from the proxy box or give the canopy its own sample.
- White squares and bars on the vaulted bedroom's walls and curtains in the new stills come from the other change merged during this work (curtain and decor pieces without their photographed texture in the headless run); not investigated here.
- Exploded storeys: the trace still uses the lifted positions.
- The room exposure uses the volume; with the volume cut by the performance ladder and only the lightmap on, the old ceiling-based boost applies as before.
- A lightmap bundled for a world opened with other walls cut keys differently (the drawn wall meshes are part of the key): a world opened in another view bakes in the browser.

Gates (worktree `aether-expo`): `tsc` 0 errors; vitest packages/render + packages/agent 166 files, 1756 tests passed (one earlier full run had a single failure that did not reproduce on rerun; not identified); smoke 34/34; `showcase:bake --check` exit 0; `showcase:lightmaps --verify` six static; `e2e:weak` WEAK GPU OK.

## 2026-10-23 Interior light: why the photo rooms asked for more than +3 EV, the sun behind the window wall, white squares, canopy and curtain boxes

Task: on the bundled rooms walls came out grey and darker than before, four of six worlds sat on the +3 EV clamp (raw 3.3 to 10 EV), a pale blotch stood on the four-poster canopy, and white squares and bars stood on walls and curtains.

Measured with a throw-away probe (room floor plan, 5 x 5 points at 1.5 m: sky visibility, bounce, raw demand), before = `59bf14ee`:
- Not a volume bug. The volume agrees with an independent estimate: in a clean 5.8 x 6.8 x 2.5 m box with two 1 x 2.2 m windows (albedo 0.6 to 0.8, sky only, the same bake code) the room mean is 55 to 70 % of the integrating-sphere value `flux / (area x (1 - albedo))`, and the baked vaulted room (2 910 triangles dumped from the browser, re-baked offline) reproduces the runtime volume to the byte. The lightmap does not dim twice (vaulted bedroom left wall, same camera: 122 of 255 with the bundled lightmap against 97 with the volume only; the floor 161 against 156). A room lit by about 4 m2 of glass is a few percent of the outdoor light, so a sky-lit room needs about 4.5 to 5 EV; that is physics, not a leak.
- The vaulted bedroom had no sun. Its world says `sky: dawn`, `timeOfDay: 18` (the description's pair). The sky model clamps the hour into the preset's window (dawn 6.4 to 7 h), so the sun stood in the east, behind a room whose windows face west: the volume saw 0.03 bounce (raw 4.9 EV), the room read as a grey sky-lit box. Only the four-poster (east window, morning) had a sun that could come in, and it is the one room below the clamp (2.87 EV). `deriveBuild` now keeps a golden-hour preset on the side of noon its hour is on (`dawn` after noon is `sunset`, `sunset` before noon is `dawn`; test `photo-light-hour.test.ts`). The bundled vaulted bedroom is set to `day` 16.4 h, the hour its own rule (`hourForWall`) gives for a west window, which keeps the sun on the window side and the walls cream (a `sunset` sun at 17.6 h gave salmon walls).
- Curtain panels were solid boxes in the trace (every `furniture` or `fixture` part is a box proxy): two panels beside a window shut most of it. `curtain` pieces are no occluders now (`SOFT_KINDS`): the bounce at the room's points rose by about a fifth (twin 4.81 to 4.52 EV raw).
- A four-poster's box proxy ran to the tips of its slim posts (2.1 m): a solid 2 x 2 x 2.1 m block that put the room's eye-height sample points inside it (zero light) and shadowed the room. A proxy is now as high as 90 % of the piece's surface (by triangle area) reaches (`surfaceTop`); a sofa or wardrobe keeps its whole box. (Pale canopy blotch: the volume-only render has none; the blotch in the lightmap stills was the next item, not the box.)
- White squares and bars: found by bisecting the render code with built commits (`bb3eb480` none, `79b482d3` volume only none, `1a3fd795` the lightmaps rebaked against the closed-room volume: squares and bars). The atlas stores sky visibility in the alpha byte and 0 means "no data" (the shader then shows open sky). In a closed room the visibility of most texels is 1/255 to 3/255 and the WebP the bundled files use rounds those to 0 over whole 8 x 8 blocks, so the blocks read as bluish white (hotel, twin, four-poster, casa and vaulted rooms all had them; decoding the bundled `.lmap` showed identical values inside and outside a square except that byte). Not the curtains' textures: the earlier note blamed a merged commit; the volume-only render has no squares. The byte is now stored as `16 + vis x 239` (`encodeVis`, shader reads `(a - 16/255) x 255/239`, no-data threshold 8/255), `LIGHTMAP_VERSION` 3. Leftover texels (a chart inside a solid) now take the light volume's value at their own spot instead of the building-wide mean.

Result (raw EV of the room, clamp +3; before to after; the clamp holds only where the room is physically that dark):
| room | before | after | note |
| --- | --- | --- | --- |
| vaulted bedroom | 4.89 | 3.47 | sun now enters the west windows; 0.47 over the clamp |
| four-poster | 2.87 | 2.62 | below the clamp |
| hotel bedroom | 5.18 | 5.10 | north window, overcast: sky light only |
| twin room | 4.81 | 4.52 | north window: sky light only |
| casa patio, daylit rooms | 3.15 to 4.13 | 3.15 to 3.98 | |
| casa patio, bathroom and hall | 10.2 and 6.9 | 10.3 and 6.9 | windowless; the ceiling lamps are off by day, so the room is dark by design |
| Skyline Penthouse | -1.96 to +1.04 | -1.95 to +1.03 | lamps on at dusk, off the clamp |

Honest reading: the clamp still holds the hotel, twin and most of the casa rooms. Their demand is real (north window, overcast or windowless), not a leak; I did not raise the clamp. What would lower the demand there is more light in the room (a sun on the window side, lamps), not a different bake.

Stills: `~/.local/share/aether/look15/before`, `after` (640 x 360, spawn and back); the squares and bars are gone in all six worlds, the vaulted bedroom reads cream with a sun patch, not grey.

Not done: a `sunset` golden-hour description still gives a deep orange room (physical for a 7 degree sun); the interior grade does not take much of it out.

## 2026-10-23 Photo to room: live runs on all four photos, what was wrong, what changed, honest numbers

Setup: Claude Code backend (Codex answered a trivial call but the limit was not tested for real runs, so everything below is Claude Code), full staged harness, three judges with cross-check, GPU-still renders on software GL (`--render=gpu`, SwiftShader, `nice -n 19` under `heavy2.lock`, one run at a time). Outputs: `~/.local/share/aether/qa/live3/{a,b,c}-<photo>/<photo>/{montage,final,first}.png` and logs `…/live3/*.log`. Run `a` is the harness before any change, `c` the harness after. Run `b` was an intermediate state (hotel failed on a Claude Code tool-exposure refusal, not a harness fault).

Judged items (3 judges, median; the checklist differs between runs because each run reads the photo anew, so totals move)

| photo | a (before) | b (middle) | c (after) |
| --- | --- | --- | --- |
| hotel | 19/19 (first attempt 5) | refused by backend | 11/19 (first attempt 4) |
| twin | 10/16 (first 6) | 4/17 | 10/16 (first 4) |
| pd1 | 5/19 (first 0) | 6/17 | 3/20 |
| pd2 | 3/21 (first 2) | 4/21 | 6/20 |

Read honestly: single live runs vary by more than my changes move the judged count (hotel 14/19 and 19/19 in earlier runs of the same code, 11/19 now). The judged number is not evidence of improvement or regression either way. What I trust is the side-by-side reading below.

What I saw in the final render beside the photo (largest remaining differences, before the change)
- hotel: curtains brown and half hidden (photo: heavy aubergine, floor to ceiling, both sides); window burnt out and narrow; four ceiling downlights the photo does not have; a white box at the foot of the bed; frames with large white mats.
- twin: the blue-and-red curtains at the glass door missing altogether; a stack of towels floating at headboard height; a fourth of the pieces refused in the first build and never recovered (desk, chair, lamp); two ceiling spots.
- pd1: wrong cool cast, drapes absent, lamp shade far too big, dresser small, floor grey instead of pale boards.
- pd2: dark walnut armchairs where the photo has cane chairs, no trunk or basket, window drawn where the photo shows sheer curtains.

Generic causes found and fixed (none is fixture specific; all are in the harness or placement)
1. Invented downlights: the arch compiler adds a downlight grid to every habitable room. A photo room now has none unless the description says the ceiling shows spots (`ceiling.downlights`, plan `room.downlights`; a plan whose id is the photo building defaults to none, so a model that resends the plan cannot bring them back).
2. Curtains refused at a glass door: `place_items` curtain, `anchorToOpening`, the wall-space anchor and the placement audit all required `kind: window`. A door 1.4 m or wider now takes curtains (panels flank it and may cover more of the glass, `curtainOverlap`), and the photo derivation lets a curtain name such a door. The twin build test (`packages/agent/test/photo-build-twin.test.ts`) hangs them.
3. Curtain pairs: a texture target named one panel; the other panel stayed untextured (hotel `…-curtain-1-r` had no skin). A texture for one panel now dresses its twin.
4. Items on a bed: anything placed `on` a bed stood at headboard height (towels floated). It now rests at the duvet (0.58 m, `BED_SURFACE`) and the support check accepts it.
5. Small refusals dropped pieces: the twin's desk chair overlapped a bed by 0.04 m, the checker named the spot (`Move … 0.06 m south (to x, z)`), and the piece was left out. A refusal asking for 0.15 m or less is now placed at that spot, facing as before; larger ones still go to the model.
6. The run log now names the refusals of the first build (it said only how many).

Effect seen in the `c` renders: twin has the blue curtains on both sides of the glass door and no ceiling spots; hotel has no spots and both curtain panels; the first-build refusals of the twin are down from four to the desk. No change in the judged counts that I can separate from noise.

Tried and removed: a rule that rejects a library model whose colour is far from the photo's. It would have turned a cream armchair of the recorded hotel into the plain part and cost a curtain panel in a pipeline test; the dark chairs of pd2 are tintable ("paint") models, so the rule would not have caught them anyway.

Not fixed, honest remaining gaps
- Lighting and exposure (washed or too dark first renders, cool cast in pd1, burnt windows) belong to the other agent's work on interior exposure; `c` was rendered on the studio build from before that commit.
- Scale: rooms still read narrow. Twin was built 3.28 m wide (the photo is a wide lens); the desk is still refused for lack of a 0.6 m path to the beds, and the model has to decide what to give up.
- Items the photo shows that the render lacks or invents: pd1 `c` invented a marble coffee table and a red window with a pink drape; pd2 `c` drew big windows where the photo shows sheer curtains; twin bed linen came out striped where the photo is plain with teal towels. These are reading errors of the model; a stricter "no object the photo does not show" check would help, left for later.
- Models: no cane or rattan chair, no modern bed or curtain model in the library; the part is used.
- Window views are still a sky and a plane; the lamp part in pd1 is oversized.
- Example rooms were not rebaked: the twin of `c` is better than its own `a` but not clearly better than the shipped, hand-widened twin (3.28 m against 4.2 m), and the other three are not better.
- Codex was not used: the limit makes a long run a gamble, and the task asked for Claude Code now.

Gates (worktree `aether-p2r`, Node 24): `tsc --noEmit` 0 errors; vitest `packages/arch` + `packages/agent` 108 files pass (incl. the new twin build test); smoke 34/34; `showcase:bake --check` all worlds up to date; `e2e:weak` WEAK GPU OK. No browser or server left running.

## 2026-10-23 Photo to room: why rooms come out narrow, misreads, missing models, flat window views (findings and one prompt change)

Evidence: `~/.local/share/aether/qa/live3/{a,c,d}-twin` (photo and render side by side in `montage.png`), run logs, `packages/agent/src/photo/prompt.ts`.

1. Narrow shell. The shell size is only the model's own estimate: three independent reads give `footprint.width` and the merge takes the middle one (run c reads 3.4, 3.1, 3.3 m; run d 3.4, 3.4, 3.1). No code anchors it to object heights, no default, and nothing resizes it later. The analysis prompt already said a two-bed room is "about 4 m across or more", and the model wrote "sized from single beds and a narrow walkway" and still answered 3.3. A wide lens makes the room look narrow in the picture, so the model reads the picture, not the beds. Placement refusals (door leaf hits desk or bed) change nothing in the shell; the compare loop could call `design_plan` but the compare text only said to fix the shell-size item when a judge failed it. Hotel twin rooms are about 3.8-4.5 m wide; the shipped hand-widened twin is 4.2 m. Change: the analysis text now asks for the across-the-room sum (beds + walking gap + desk depth) in the assumptions before the width, says a wide lens hides width, and gives the twin norm; the compare text says a space refusal means widen the shell by 0.3-0.6 m with `design_plan` and place the piece again, not drop it. Live check (run d, Claude Code, twin): reads still 3.4 / 3.4 / 3.1, built 3.4 m wide, 4 pieces refused at first build, judged 2/18 (c was 10/16, noise is large). So the prompt text did not move the width: the model does not follow a width rule from text alone. Not fixed. The next step that would work without a gate is to hand the model, in the first compare round, the measured sum (bed widths + gap + desk) next to the shell width as advisory text, or to regrow the shell on a space refusal in the build step. I did not add either.
2. Misreads (invented marble table, windows where sheer curtains hang). The prompt says "never invent furniture" but gives no step that makes the model look again at a region before listing it. Change: a LOOK BACK rule in the analysis rules (re-look at each box region, a sheer curtain over glass is a curtain, omit what cannot be clearly seen). Not shown to fix anything in the one run; the judges' cross-check is the real guard.
3. Models. `docs/THIRD_PARTY.md` lists Poly Haven chairs (painted, wooden, school, gallinera, monobloc, armchairs) and a wicker basket; no cane or rattan chair. Proposal: use `chair-wooden-01` tinted with `make_texture` (cane weave) for the seat and back as the nearest part. No CC0 cane chair was checked online, so none was added.
4. Window views. A window's `daylight` is one emissive colour pane just outside the glass (`WindowParams.daylight`), so the view is flat by design. The cheapest upgrade is to texture that pane with a crop of the photo's own window region (or `make_texture` landscape strip) instead of a colour; not trivial in the current tool set, not done.

Limit: single live run, render uses the studio build from before the exposure work (dark first and final images).

## 2026-10-23 Photo to room: measured room size from a monocular depth network (`measure_room`, advisory)

What: `measure_room` (`packages/agent/src/photo/measure.ts`, `depth-model.ts`, method in `packages/arch/src/photo/depth.ts`, CLI `scripts/measure-room.ts`). Depth Anything V2 Small (Apache-2.0; Base and Large are CC-BY-NC and not used), unsigned 8-bit ONNX, 27 MB, onnxruntime-web on the CPU, about 1.0 to 1.6 s per photo. The 8-bit `int8` export does not load in the wasm runtime (no ConvInteger kernel); `uint8` does. Weights are fetched on first use, SHA-256 pinned, cached under `~/.local/share/aether/models`; offline the tool says so and the flow is unchanged. Method: relative inverse depth, depth = 1 / (d + shift), pinhole back-projection, floor plane by RANSAC on the lower third, metric scale from an anchor (a whole door at 2.05 m taken from the description, or one the model names) or a 2.4 to 2.7 m ceiling; fov 65/75/90 and shift 0.2/0.3/0.45 are swept and the 10th to 90th percentile is the range. The first compare round shows it next to the model's own footprint, with the depth picture.

Estimates on the four fixture photos, no anchor (ceiling scale), against the shipped example rooms (themselves model guesses, the twin hand-widened; not measured truth):

| photo | estimate W x D x H (range of W / D) | shipped room W x D |
| --- | --- | --- |
| twin | 4.06 x 6.18 x 2.5 (3.2-4.4 / 5.0-7.3) | 4.20 x 5.88 |
| hotel | 3.24 x 5.30 x 2.5 (2.6-3.7 / 4.3-6.4) | 4.48 x 4.88 |
| pd1 | 4.06 x 5.88 x 2.5 (3.9-4.4 / 4.6-7.6) | 5.28 x 5.78 |
| pd2 | 4.28 x 6.01 x 2.5 (4.1-4.6 / 4.5-7.5) | 5.78 x 6.78 |

Reading: the twin is close; the other three read narrow by 1.0 to 1.5 m in width because the side walls fall outside the frame (width is the span seen, a lower bound; the tool says so), depth is within about 0.5 m on three of four. No constants were tuned on these photos beyond the first pick of the shift sweep.

Live check, Claude Code, twin (`~/.local/share/aether/qa/live3/f-twin`, against `d-twin`, same prompt, before): first build 3.4 m wide in both. With the depth line (door anchor: 3.88 x 5.91 x 2.44 m) the model widened the shell in the compare loop to 3.9 m inner (4.2 m outer rect; d-twin stayed 3.4). Judged items 8/15 in round 1, 12/15 in rounds 3 and 4, 10/15 at the end (d: 2/18, c: 10/16; the judge noise between runs is large). So the width moved toward the reference as intended and the judged count was not worse than the earlier runs, but one run cannot separate the gain from noise. The run ended with `R.JointData.revoluteWithAxes is not a function` in the walkthrough verification (the installed rapier does not match the source, present before this change) so there is no final score. Remaining: the first build still uses the model's own width (the depth line comes after it); running the network before the analysis and passing its width as a starting point would remove the widen step.

Follow-up (same day): the depth estimate is also run before the photo is read and added to the first analysis message (numbers, range, anchor, width labelled a lower bound, depth picture), so the first shell size is informed; no extra model turn, advisory, skipped silently when the network is unavailable. The compare round 1 line stays.

## 2026-10-23 Photo to room: the shell-size answer is explicit and accountable

The depth line reached the model but a 3.6 m shell stayed 3.6 m even when the shell-size item failed. Now the analysis writes a one-line `shell-size` reconciliation (width, depth evidence lower bound, beds plus walkway minimum, larger adopted or why not), and in repair a failed shell-size item or an unresolved space refusal must be answered in the round (design_plan, or declare_repair keep_shell with a reason recorded in the assumptions). No numeric rule; no extra analysis turn.

## 2026-10-23 CPU-side render cost: measured, three fixes

Measured with `tests/e2e/cpu-perf.e2e.ts` (new; per world: load, idle draws, orbit under the CDP sampling profiler, scene census; `--shot` for stills, `--profile-load`, `--heap`), Chromium headless on WebGPU over the discrete GPU, 1280x720, automatic tier (ultra on this machine), governor and adaptive resolution held off, one warm turn before measuring. `render()` JS ms is the time inside `WorldRenderer.render` for drawn frames (the draw submission included, GPU time not).

Ranked CPU costs found:

1. Shadow-pass render-object churn (three r186). The shadow passes draw every caster with one override material and copy the caster's `alphaTest` onto it; three bumps `material.version` on every on/off flip, so every render object saw a stale version each frame and recomputed its whole material cache key (property scan, regexes, strings: `getMaterialCacheKey` + `customProgramCacheKey` + `getOwnPropertyNames`, 8 to 13 ms and 5 to 11 MB of garbage per frame in the big worlds). Fixed in `packages/render/src/three-patches.ts`: no version bump for shadow-pass materials, the on/off bit goes into the render object's dynamic key instead, so a caster whose own alpha test really changes still rebuilds its program.
2. Skinned meshes were never frustum culled (`frustumCulled = false` on all of them: 368 meshes in Highland Trail, each a draw call in the main pass and in every shadow cascade whatever the view). `instantiateAsset` now gives each source skinned mesh a pose-computed bounding sphere widened by 1.5x + 0.5 m and culls by it (`geometry/model-loader.ts`; test `skin-bounds.test.ts`).
3. Animation mixers ran every frame for every animal. `AssetAnimator.update(dt, eye)` now steps assets beyond 45 m every 3rd frame and beyond 110 m every 6th (skipped time is owed, so pace is kept), and hidden ones not at all (test in `assets.test.ts`).

Before / after (render() JS median ms per drawn frame; draw calls of the last frame in brackets):

| world | before | after |
| --- | --- | --- |
| Hotel, Twin, Vaulted (photo rooms) | 0.2 to 0.3 | 0.2 to 0.3 (unchanged: nothing to win) |
| Skyline Penthouse | 5.1 (p90 24.2) | 3.9 (p90 6.2) |
| Casa Patio | 6.6 [716] | 4.2 [342] |
| Hollow Gate (people) | 2.2 | 1.9 |
| Highland Trail | 41.3 (p90 1149) | 11.6 |

Stills: pixel diff before/after on hotel, twin and vaulted is 0.00 to 0.02 / 255 mean (0.00 to 0.05 % of pixels over 8): the same pictures. Content-keyed lightmap hashes are untouched (no geometry is merged or changed).

Honest limits. The Highland "before" run fell back from WebGPU to WebGL after a black-frame watchdog step in that run, so its 41 ms is inflated; the repeatable part is the profile (cache-key work was 13 of 24 ms before, about 2.7 ms after). On this machine headless WebGPU on Highland and the game worlds is unstable (device lost, watchdog steps), so those numbers are from single runs. Every room and the two big architecture worlds are under the 16.6 ms JS budget on a fast CPU at ultra; the missing 60 fps on an integrated GPU is a GPU-side cost (the render submission waits in `writeTexture`/`submit` on the integrated GPU: 500+ ms per frame in one run), which belongs to the quality chain, not to this change. Not done and why: static merging and instancing already exist (`sync/static-merges.ts`, `static-batches.ts`); matrix updates are 0.3 ms/frame; per-frame allocation in the steady state is now small (the remaining three.js garbage is the render-object creation when an animal first enters a shadow frustum, spread over the first turn instead of one spike); WASM SIMD and workers had no hot loop over 2 ms to justify them. Startup (4 to 10 s to an open world at ultra here) is shader compile and world build; not changed.

## 2026-10-23 Studio render as the default view on an integrated GPU: where the frame went, what was cut

Task: studio render became the default view, which on an integrated GPU ran the whole ultra chain (ambient occlusion, reflections, sun shafts, contact shadows, halation, aberration, temporal AA) plus a doubled sun map on every frame, including while orbiting. Aim: 60 fps in motion at the default setting with the studio look kept where the picture rests.

Method. Intel UHD 770 (Mesa, ANGLE/GL, WebGL2), headless Chromium, 1856 x 1016 drawing buffer, a slow orbit of the default camera. The RTX was not used. The harness is `tests/e2e/default-perf.e2e.ts` (`GEN_GPU=intel npx tsx tests/e2e/default-perf.e2e.ts --worlds=... --rows=... --vsync=1`). Two traps found on the way: (1) with vsync off the frame interval is the CPU's submission time, not the GPU's (a 60 ms GPU frame read as 2 ms), so numbers are taken with vsync on (the interval of `requestAnimationFrame` is then the real frame time) and with `EXT_disjoint_timer_query_webgl2` wrapped around each draw for GPU milliseconds; (2) the iGPU was shared with other jobs, so every figure is the smallest of three blocks, and A/B pairs ran back to back.

What the GPU time is made of (hotel room, low tier, default orbit view, GPU ms per frame):

| piece | ms |
|---|---:|
| whole frame, direct draw | 23 to 26 |
| ground hidden | 8 |
| ground drawn with a plain standard material | 14 |
| half or quarter resolution | 6.7 (not 4x less: about 6.5 ms is fixed cost) |
| shadows off, lightmap off, light volume off, environment off | each 0 to 2 |
| anti-tiling of finish textures (all finishes) | 7 |
| full studio chain on top of the medium frame (hotel) | +36 (ssr, halation, aberration about 45 each when added to the high chain; shafts 13) |

Ranking of cost: (1) the per-pixel work of lit surfaces, and above all the ground (a lawn or plaza covers 40 to 65 % of the default view and is the heaviest material: layered, anti-tiled, weathered; 17 of 25 ms in the hotel view); (2) the studio post chain (pre-pass plus six screen-space passes, 36 to 57 ms at 1080p); (3) geometry that does not scale with resolution (skyline about 30 ms, casa about 40 ms of fixed cost: 0.75 and 4 million triangles per frame with the shadow pass); (4) shadows (about 12 ms on the skyline), light volume and lightmap (about 2 ms): not the problem.

What changed (all generic, no per-room code):
- The studio look splits into two chains on integrated and unknown GPUs when the tier is automatic (`QualityPlan.moveEffects`, `world-renderer.ts: syncRest`). While the view moves (camera, edits, resizes) the light chain draws (composite, bloom, grade, grain) and adaptive resolution holds the frame rate; 220 ms after the view stops, the full studio chain takes over at full resolution and refines for 48 frames, as before. Both pipelines stay built (the one not in use is kept as `postStash`, swapped without a rebuild; a stale one is dropped when the sun map is reallocated). Scenes that animate while the view rests (people, water) keep the full chain only while a frame stays under 34 ms; otherwise they keep the light chain until the quality is changed. Discrete GPUs, an explicit tier from Settings, final renders and stills are unchanged.
- That plan also plans its sun shadows once, as the medium tier does (one content-fitted map, no doubled map, no cascade rebuild), so a switch between the chains recompiles no material.
- Adaptive resolution is on for the split studio view, steps by what the frame time asks for (`sqrt(fps / 58)`, between 0.6 and 0.9 of the scale, floor 0.5), acts after 1 s below 50 fps instead of 1.5 s below 40, and steps up again after 5 s above 57 fps. Frames drawn at rest do not feed it or the performance ladder.
- The performance ladder's tier cap now reaches the studio chain (it did not before: a slow studio view could never step down).
- Ambient occlusion runs at half resolution in the split plan (full on discrete GPUs).
- The ground and its skirt draw after the opaque items with a small depth bias; this did not change the measured time here (the frame cost is the ground's own shading where it is visible), but it stops the nearest-by-centre sort from shading it under floors in other views.

Before and after, same machine, default orbit of the default camera, studio render, vsync on (frame interval; fps in brackets):

| room | before | after | scale in motion | GPU ms after |
|---|---:|---:|---:|---:|
| hotel bedroom | 66.7 ms (15) | 16.7 ms (60) | 0.75 | 11 |
| twin room | 66.7 ms (15) | 16.7 ms (60) | 0.52 | 9 |
| vaulted bedroom | 66.7 ms (15) | 16.7 ms (60) | 0.52 | 9 |
| skyline penthouse | 133 ms (7.5) | 33 to 50 ms (20 to 30) | 0.5 | 35 |
| casa patio | 267 ms (3.7) | 50 to 67 ms (15 to 20) | 0.5 | 51 |

The three photo rooms hold 60 fps in motion. The skyline and the casa do not: at the resolution floor their cost is geometry and the shadow pass (0.75 and 4 million triangles drawn per frame, 600 to 780 draw calls), which resolution does not reduce. Next levers, not done: a cached sun map for static content (the medium plan's map no longer depends on the camera, so it can be kept until content or sun change; needs a dirty signal from the scene sync), merged and instanced static meshes, a cheaper far ground. Stills: at rest the hotel and skyline look as before (viewed side by side); the skyline's leaf shimmer is calmer. Other things found: the skyline and the casa still bake their light in the browser on open (their bundled lightmap keys no longer match after later renderer changes; `showcase:lightmaps` regenerates them), and the lit material of anti-tiled finishes costs 7 of 25 ms in the hotel view with no single part (noise, second lookup, mottle) responsible.

Gates: `tsc --noEmit` clean; vitest `packages/render` and `apps/studio` pass (the adaptive-resolution tests were rewritten for proportional steps, a quality-plan test covers the split); `npm run e2e:weak` ok; smoke 34/34.

## 2026-10-23 Main-thread blocking: measured per flow, three offenders moved off the page

Harness: `tests/e2e/longtask.e2e.ts` (Chromium, integrated GPU through `GEN_GPU=intel`, machine shared with other jobs, so absolute times are inflated and noisy; the ratios are what to read). It records long tasks (over 50 ms), long animation frames with script attribution, rAF gaps and input delay (a key press every 100 ms through the flow), and attributes every long task from a CDP CPU profile (self and inclusive functions). Flows: open each of the 15 showcase worlds and the three photo rooms (cold page), then on highland-trail, casa-patio and skyline-penthouse: resize, chat edit, verify, export (.aether.json, .glb, share link), enter Play, leave Play.

Ranking before (total blocked ms = sum of long-task time above 50 ms; worst single task):

| flow | blocked | worst | what it was |
|---|---:|---:|---|
| open hollow-gate | 14 486 | 13 256 | the black-screen watchdog's 16x16 read-back (`drawImage` + `getImageData` of the canvas) waiting for the GPU to finish the first frame |
| open skyline-penthouse / sakura-river / dusk-lake-house / kyoto-temple | 11 379 / 9 386 / 9 346 / 8 031 | 9 283 / 7 398 / 7 619 / 7 079 | the same read-back |
| export .glb casa-patio / skyline / highland | 4 717 / 3 446 / 2 000 | 4 538 / 3 496 / 2 050 | three's GLTFExporter merging roughness and metalness maps with a full-size `getImageData` per texture, then `toBlob` of accelerated scratch canvases |
| open kart-canyon / neon-rain-city | 4 273 / 3 732 | 3 479 / 2 630 | three builds the post-chain and material node programs inside one frame (NodeBuilder, GC); neon also decoded its 2048 px character masks on the page (396 ms) |
| enter Play casa-patio / highland | 4 410 / 3 395 | 3 206 / 1 539 | native program/link time on the first play frames (not JS) |
| everything else | under 3 000 | under 1 200 | frame renders compiling programs; module evaluation of lazy chunks (90 to 170 ms); sky dome recolour in `setWorld` (60 to 115 ms) |

Chat edit, verify, export JSON, share link, resize and leave Play: no JS long task above 60 ms on these worlds (verification and procedural work already run in workers). Physics creation on entering Play is cheap (casa-patio: 217 bodies, 147 ms in total over several yields; highland 94 ms), so a physics worker was not built and the sealed-replay contract is untouched.

What moved (all generic, no per-world code):
- The watchdog's view sample: `createImageBitmap(canvas)` takes the snapshot in the frame's task and a worker (`view/frame-sample.worker.ts`) reduces it with the same `measureFrame`; the watchdog decision is unchanged. `e2e:weak --force-black` now empties the snapshot instead of the old 2D `drawImage` hook.
- GLB export: the metal-rough composite is built in `view/metal-rough.worker.ts` (same rules as the exporter's: cyan base, sRGB to linear) and both material slots then hold the one texture, which the exporter writes as it is; the exporter's scratch 2D canvases are software canvases for the duration of the export (`willReadFrequently`), so the PNG encode no longer waits for a GPU read-back.
- Character mask decode: `characters/mask-decode.worker.ts` (decode, draw, read-back off the page; falls back to the old path where workers are missing).

After (same harness; opens re-measured over all worlds, GLB re-measured on highland and skyline after the last change):
- Total blocked over every flow measured: 92.5 s to 46.5 s (before the GLB canvas change; the remainder is frame renders).
- Worst single task: hollow-gate open 13 256 to 935 ms; skyline-penthouse open 9 283 to 774; sakura-river 7 398 to 1 012; dusk-lake-house 7 619 to 1 672; kyoto-temple 7 079 to 1 414; casa-patio open 2 258 to 776.
- Input delay (max, key press during the flow): hollow-gate open 13 217 to 34 ms; sakura-river 7 324 to 51; kyoto 7 037 to 628; kart-canyon 3 395 to 57.
- GLB export worst task: highland 2 050 to 869 ms; skyline 3 496 to 1 065 (the rest is one `toBlob` of a 2048 px texture).

Not done, and why:
- OffscreenCanvas rendering in a worker: the studio draws through three's WebGPU/WebGL2 renderers with picking, DOM overlays, the gizmo layer, the capture/still path and a watchdog that reads the canvas and restarts the renderer on a context loss; a worker renderer would need all of those proxied and a second code path for the WebGL fallback. Not safe in this window. The long tasks that remain in frames are three building node programs (NodeBuilder, 300 to 2 800 ms for the studio post chain of kart-canyon and neon-rain-city: `pipeline.render()` builds the whole chain in its first call); they cannot be split from outside three and belong to the post/material code (a pre-build of the chain in slices, or fewer distinct programs).
- The first watchdog sample still costs 0.4 to 0.6 s once (`createImageBitmap` of a canvas whose frame the GPU has not finished); the watch ends after the first non-black sample.
- Sky dome recolour in `setWorld` (60 to 115 ms once per open), module evaluation of the lazy still/render chunk (90 to 170 ms), first-play program links (native): left, none exceeds the budget by enough to justify more machinery.

Gates: `tsc --noEmit` clean; vitest `packages/render` and `apps/studio` pass; smoke 34/34; `e2e:weak` (including the forced-black watchdog run) ok.

## 2026-10-23 Per-pixel shading cost on an integrated GPU: lean surface shading, cheaper light volume, startup

Task: per-pixel lit shading was the largest GPU cost of the default view (the ground covers 40 to 65 % of it), the post chain second. Measured on the Intel UHD 770 (WebGL2 over ANGLE/GL), 1856 x 1016, vsync on, GPU timer queries, smallest of three blocks, scale fixed at 1 (`tests/e2e/default-perf.e2e.ts`, rows `realtime-medium` and `medium-lean`).

What the numbers said (hotel, GPU ms): whole frame 24.5; ground hidden 8.5; a plain standard-material ground 14.2; image-based light alone 3.9 of the 5.7 a plain ground adds; shadows, lightmap and light volume 0.7 to 1.3 each; the medium post chain 0.9 (it is not the cost while moving). The three 3D gradient noises of the anti-tiled finishes cost 2.5; the lawn's 10 texture reads and tangent frame most of the rest.

Changes (generic, no per-room code):
1. Lean surface shading (`leanShading` uniform, set while the split studio view moves): anti-tiled finishes take one lookup per map, no repeat-hiding second lookup, no micro or macro detail and no relief. A branch on a uniform, so one program serves both and flipping recompiles nothing; at rest, stills and discrete GPUs the shading is exactly as before.
2. The blend and macro noise of those finishes come from one shared tileable noise texture (`materials/noise-texture.ts`, same spread as `mx_noise_float`) instead of three 3D noises per pixel.
3. Light volume: pixels beyond its fade distance skip its twelve reads and arithmetic (most of a lawn or plaza), and the eight probes are a shader loop instead of eight copies. Lesson recorded in the code: a shared TSL node is declared where it is first built, so anything a branch builds first (world normal, lighting-context variables) must be built before it, or the pixels that skip the branch read undeclared variables (the lawn outside the volume came out 40 % dark until fixed).

Fixed-scale GPU ms per frame, same machine, back to back (before = realtime-medium row, the old moving path; after = medium-lean):

| room | before | after |
|---|---:|---:|
| hotel bedroom | 24.5 | 15.0 |
| twin room | 24.5 | 16.6 (before the light volume change; about 15 after) |
| vaulted bedroom | 24.3 | 17.6 (about 16 after) |

Default view in motion (adaptive resolution on, frame interval; scale reached in a 3 s run): hotel 60 fps at 0.72 (before 0.60), twin 60 fps at 0.72 (0.52), vaulted 60 fps at 0.72 (0.60); GPU 8.4 to 8.9 ms at those scales. Skyline penthouse and casa patio still miss 60 (about 87 ms GPU at scale 1: geometry and shadow pass, not shading; lean saves 5 % there). Stills at rest: hotel, twin, vaulted and skyline pixel-diffed against before at the camera-noise floor (mean 0.7 to 1.6 / 255, under 0.7 % of pixels over 8); the lawn's macro patches differ in pattern (new noise field), same spread.

Startup (cold browser, first frame, `tests/e2e/startup-perf.e2e.ts`): hotel 4.5 s to 2.9 s, skyline 19.9 s to 15.0 s (108 programs, 10.4 MB of fragment source, was 11.8).

Tried and dropped: spherical-harmonics ambient replacing the two prefiltered environment lookups (fitted to the lookup itself on the GPU, matched within 2 levels) saved only 0.5 ms, because the rest of the cost is three's physical lighting model arithmetic, not the lookups. Not done: a lean lighting model (needs a fork of three's PhysicalLightingModel), cheaper foliage and water shaders (skyline), texture compression changes.

Gates: tsc clean; vitest packages/render and apps/studio 1570 pass; smoke 34/34; e2e:weak ok; showcase:bake --check up to date. The weak check failed on bcdb5270 until the follow-up a8c437cf (not this work).
## 2026-10-23 Geometry, terrain and shadow cost of the skyline penthouse and the casa patio

Task: 60 fps on an integrated GPU for the two heavy showcase worlds. Measured on the Intel UHD 770 (headless Chromium, ANGLE/GL, vsync on, cover cameras, 1856 x 1016, orbit; smallest of three blocks; GPU ms from timer queries). The iGPU is shared with other jobs: rows are only comparable when run back to back in fresh pages, and a hide/cast/receive row in one page is confounded by the performance ladder, so conclusions come from fresh-page rows. Harness: `default-perf.e2e.ts` (new rows `default-nocast`, `-frozen-map`, `-noshadow`, `-terrain-plain`, `-recv-off:<re>`, `-cast-off:<re>`, `-hide-*`), `geom-probe.e2e.ts` (triangles and draws by mesh group, shader dump). The harness no longer marks content changed every frame (`--forcedraw` restores it).

Where the casa frame went (GPU ms of about 53 at the 0.5 resolution floor): layered terrain material 11 (28 texture reads per pixel, four layers, two scales, triplanar rock), sun shadows 12 (pass about 6, receiving about 6; filter taps are not the cost: 1+1 taps saved 0.3), scatter foliage 8 (4 of it shadow receiving), the rest geometry and fixed cost. Skyline: backdrop towers 5 and ground 7 (fragment cost, not draw calls), shadows 4.

Changes (generic): heavy scatter layers below 2000 instances (330 oaks of 2.5k triangles) become culled, LOD'd fields with finer chunks; the field triangle budget is split by demand (before, ground cover of 10 000 blades took the share and a forest vanished); pooled update ranges (no per-replan allocation); layered terrain draws after the other opaque items; the terrain shader skips layers with no weight and takes only the large-scale lookup beyond 90 m (inside branches built from fresh nodes: a node first built in a branch is a variable declared there, and `normalWorld` and a shared distance node left unset variables, which showed as dark terrain until fixed); unique static procedural props merge per 160 m cell and material; the single sun map is reused while only the camera moves (dirty on content change, sun or frustum change; every 2nd frame while casters animate; every 24 frames as a net; cascades and captures always draw). Bundled lightmaps regenerated for skyline and casa; `showcase:lightmaps --verify` 6/6, `showcase:bake --check` up to date.

Before and after (task start build vs now, GPU ms in motion / frame interval):

| room | before | after |
|---|---:|---:|
| casa patio | 53.5 ms GPU, 59 ms (15-17 fps) | 28.5 ms GPU, 34 ms (30 fps) |
| skyline penthouse | 35 ms GPU, 40 ms (25 fps) | 24.5 ms GPU, 29-30 ms (33 fps) |
| hotel, twin, vaulted | 16.7 ms (60) | 16.6 ms (60) |

Still short of 60: casa (about 28 ms GPU) and skyline (about 24 ms). What is left is per-pixel work, not geometry: terrain and ground shading, foliage overdraw (LOD does not cut it: thinned cards grow to keep coverage), shadow receiving (6 ms casa, 4 skyline), and the backdrop towers' facade shader. Next levers, not done: a far/near split of the ground and facade materials like the terrain's, per-LOD receiving flags on far foliage, a lower resolution floor for these two worlds.

Stills at rest: skyline mean 8-bit difference 4.3 (p99 26); casa terrain matches, the whole difference is the foliage speckle that differs between any two captures (mean 21). Gates: tsc clean, vitest render/studio/core pass (one allocation probe, `assets.test` walkers, is flaky only in the full run under load), smoke 34/34, e2e:weak ok. Not tested: the WebGPU backend (no WebGPU on this machine) for the terrain branches.

## 2026-10-23 Library for any world: vetting, additions, crafted parts

Request: the library should serve any world the app builds (forest, desert, village, city block, harbour, farm, sci-fi corridor), not only rooms, plus the interior gaps seen in photo-to-room runs (cane chair, sink, fridge, rugs).

Vetting (licence text seen, then decision)
- Poly Haven models and HDRIs: `polyhaven.com/license` states CC0 for every asset; authors from the API `/info` record. Accepted. Of 108 outdoor candidates, 8 photoscanned trees and saplings (`pine_tree_01`, `fir_tree_01`, `fir_sapling_medium`, `pine_sapling_medium`, `jacaranda_tree`, `island_tree_01`, `island_tree_02`, `tree_small_02`) were rejected for browser use: the glTF geometry buffer is over 32 MB. After building and looking at contact sheets 24 more were dropped: kit sheets that lay many pieces side by side (apartment and factory facades, fort walls, pier, electricity poles, pipe and duct sets, street bench parts, a 92 m cliff, a 59 m coast rock), cut-out plant sheets whose single plants are spread over metres (grass, moss, three shrubs, three flowers, a dark scrub bush) and stumps and root clusters that read as rocks. 76 shipped.
- Kenney Space Kit, Castle Kit, Watercraft Pack: each zip's `License.txt` reads "License: (Creative Commons Zero, CC0)"; archive SHA-256 pinned in `assets/sources.json`. Accepted, labelled low-poly. 92 models.
- Poly Haven HDRIs: overcast, starry night, desert, industrial sunset, golden sunset added (CC0).
- KayKit (Space Base Bits, Medieval Hexagon Pack): `LICENSE.txt` in each GitHub repository reads CC0. Accepted as a source, not built: the repositories are not zip archives on an allowed download host.
- Sketchfab: the search API's CC0 filter works, download needs an account token, the licence is the uploader's claim; top hits are museum scans of 60k to 460k triangles. Rejected (gated, unverifiable at build time).
- Objaverse: licence is per object, inherited from Sketchfab, many CC-BY-SA, NC or unclear, some AI-generated. Rejected (no per-object allow-list).
- Smithsonian Open Access 3D: CC0 but scans of 100k to millions of triangles of museum objects. Rejected (not usable as props).
- Quaternius: unchanged (site licence page forbids redistribution as assets). ABO, Mixamo, Ready Player Me, MetaHuman: not used.
- ambientCG: CC0, already the source of the 23 finishes; more terrain sets need new `material.finish` names in the core schema and renderer, files other work is editing, so deferred.

What changed
- Pipeline: `selection-outdoor.ts` (76 rows) joins the `--interior` build; `selection-extra.ts` plus `build.ts --extra` builds the later Kenney kits and skies into `assets/extra.json` so earlier files keep their hashes; `--ids` runs upsert instead of leaving `interior.json` stale. Triangle budgets by size (3k under 0.6 m up to 16k above), 256 px maps under 0.8 m, JPEG quality 62; meshopt's topology-aware simplifier stalled at 50k triangles on photoscanned rocks (a vertex per triangle), so outdoor models fall back to the topology-free simplifier. Variants stay within a category. The fetch script skips (does not fail on) models over its size cap.
- Sizes: median main file of the 76 outdoor models 255 KB (largest 1.4 MB), 27 MB for all their main, distance and light files; the library is fetched on demand. Library on disk 170 MB (limit raised to 200 MB), catalog 464 KB (83 KB gzip). Studio JS 17,622 to 17,896 KB (+274 KB raw, +59 KB gzip), mostly the new procedural kinds and aliases.
- `find_model` takes `category` and `look` (realistic default, stylised, low-poly, any), biome words work as the style (forest, desert, coastal, urban, industrial, farm, scifi, fantasy...), lines show category and look; open worlds place with an `apply_patches` asset entity. Synonyms for hydrant, manhole, power pole, facade, pier, dead tree, stump, cactus, sword, picnic table and others.
- A model named "corridor with window" made the planner's "add a window to the kitchen" place the corridor instead of a window; renamed.
- Procedural (separate commit by the crafted-parts work): sink (pedestal, wall-hung, vessel, utility), cane chair (dining, bar, stool), fridge layouts, oven, extractor, rug patterns. Curtains (sheer, pleated, ripple), toilets, bathtubs and panelled wardrobes already existed.

Gates: tsc clean; vitest assets, agent, render, studio pass; smoke 34/34; showcase:bake --check up to date (no bundled lightmap hash changed).

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

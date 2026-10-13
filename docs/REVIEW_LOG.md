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

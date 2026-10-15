# Third-party components, licences and AI disclosure

This file covers every library, tool, service, asset and AI component used
by Aether, with its exact installed version, licence and provenance.

Versions and licences were read from each package's installed
`node_modules/<pkg>/package.json` and cross-checked against `package-lock.json`
on 2026-10-13. Aether's own code is [MIT](../LICENSE) (© 2026 Aether
contributors). All eight workspace packages (`@aether/*`) are private and
MIT-licensed.

**Summary:** all code that ships to users (the browser bundle and the
server runtime) is under **MIT or Apache-2.0**; the two self-hosted web
fonts are under the **SIL Open Font License 1.1**. All are permissive,
allow commercial use and redistribution, and are compatible with a public
source repository. Nothing is non-commercial, personal-use-only,
evaluation-only or strong copyleft. Items
that need a note are listed in [Flags](#flags-and-notes).

---

## 1. Direct runtime dependencies

These are bundled into the studio or executed by the server.

| Package | Installed version | Licence | Used by | Copyright / source |
| --- | --- | --- | --- | --- |
| [three](https://github.com/mrdoob/three.js) | 0.186.1 | MIT | `@aether/render`, studio (its `examples/jsm/exporters/GLTFExporter.js` powers Export → 3D model, loaded on demand as its own chunk; no new package) | © 2010–2026 three.js authors |
| [@dimforge/rapier3d-compat](https://github.com/dimforge/rapier.js) | 0.21.0 | Apache-2.0 | `@aether/physics` (installed at `packages/physics/node_modules`) | Dimforge / rapier.js authors |
| [quickjs-emscripten-core](https://github.com/justjake/quickjs-emscripten) | 0.32.0 | MIT | `@aether/logic` script sandbox (loaded lazily) | © 2019–2024 Jake Teton-Landis |
| [@jitl/quickjs-wasmfile-release-sync](https://github.com/justjake/quickjs-emscripten) | 0.32.0 | MIT (contains **QuickJS**, © 2017–2021 Fabrice Bellard and Charlie Gordon, MIT) | `@aether/logic`: the single QuickJS build the sandbox loads | © 2019–2024 Jake Teton-Landis |
| [zod](https://github.com/colinhacks/zod) | 4.6.6 | MIT | `@aether/core`, `@aether/agent`, studio (project records), validation everywhere | © 2025 Colin McDonnell |
| [react](https://github.com/facebook/react) | 19.3.0 | MIT | studio | © Meta Platforms, Inc. and affiliates |
| [react-dom](https://github.com/facebook/react) | 19.3.0 | MIT | studio | © Meta Platforms, Inc. and affiliates |
| [zustand](https://github.com/pmndrs/zustand) | 5.0.15 | MIT | studio state | © 2019 Paul Henschel |
| [hono](https://github.com/honojs/hono) | 4.13.13 | MIT | server | © 2021–present Yusuke Wada and Hono contributors |
| [@hono/node-server](https://github.com/honojs/node-server) | 2.1.4 | MIT | server | © 2022–present Yusuke Wada and Hono contributors |
| [tsx](https://github.com/privatenumber/tsx) | 4.23.15 | MIT | server runtime (TypeScript loader), `smoke` and `e2e` scripts | © Hiroki Osame |
| [@openai/codex-sdk](https://github.com/openai/codex) | 0.162.1 (exact) | Apache-2.0 | `apps/bridge` only (local Aether Bridge; never in the browser bundle or the hosted server) | © OpenAI |
| [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) | 0.2.86 (exact) | Apache-2.0 | studio, **lazy chunk** loaded only after the user opts in to on-device AI | © MLC contributors |

## 2. Transitive runtime dependencies

| Package | Installed version | Licence | Pulled in by |
| --- | --- | --- | --- |
| @jitl/quickjs-ffi-types | 0.32.0 | MIT | quickjs-emscripten-core, @jitl/quickjs-wasmfile-release-sync |
| scheduler | 0.28.0 | MIT | react-dom |
| @types/react | 19.3.0 | MIT | Type-only peer of zustand. Not present at runtime. |
| csstype | 3.2.3 | MIT | Type-only dependency of @types/react |
| esbuild | 0.28.2 | MIT (© 2020 Evan Wallace) | tsx (TypeScript transform on the server); the proof e2e (`tests/e2e/proof.e2e.ts`) bundles the verifier for browsers with it; also a direct, exactly pinned dependency of `@aether/bridge`, which bundles the asset checker (`check.mjs`) handed to the local coding agent. Its platform binary package `@esbuild/<platform>` 0.28.2 is MIT as well. |
| fsevents | 2.3.3 | MIT | Optional, macOS only (file watching) |
| @openai/codex | 0.162.1 | Apache-2.0 | @openai/codex-sdk (the Codex CLI; its platform package `@openai/codex-<platform>` ships a native binary, Apache-2.0). Runs only on the user's machine inside the bridge. |
| loglevel | 1.9.2 | MIT (© Tim Perry) | @mlc-ai/web-llm |

## 3. Development and build dependencies

These are not shipped to users. They are used to build, type-check and
test.

| Package | Installed version | Licence | Purpose |
| --- | --- | --- | --- |
| [typescript](https://github.com/microsoft/TypeScript) | 7.0.2 | Apache-2.0 | Type checking |
| [vite](https://github.com/vitejs/vite) | 8.3.4 | MIT | Studio dev server and bundler |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 6.1.2 | MIT | React support for Vite |
| [vitest](https://github.com/vitest-dev/vitest) | 5.0.4 | MIT | Unit and integration tests |
| [playwright](https://github.com/microsoft/playwright) | 1.64.0 | Apache-2.0 | Browser end-to-end test (`npm run e2e`) |
| playwright-core | 1.64.0 | Apache-2.0 | Dependency of playwright |
| @types/node | 26.6.5 | MIT | Node type definitions |
| @types/react | 19.3.0 | MIT | React type definitions |
| @types/react-dom | 19.3.0 | MIT | React DOM type definitions |
| @types/three | 0.186.0 | MIT | three.js type definitions |
| [@gltf-transform/core](https://github.com/donmccurdy/glTF-Transform) | 4.5.1 (exact) | MIT, © 2024 Don McCurdy | Asset library build script only (`scripts/assets/build.ts`): read, normalise, merge, write glTF. Never in the app bundle. |
| [@gltf-transform/extensions](https://github.com/donmccurdy/glTF-Transform) | 4.5.1 (exact) | MIT, © 2024 Don McCurdy | Same script: `EXT_meshopt_compression` writing and the material / texture extensions of the sources. |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) | 1.1.1 (exact; was already installed as a dependency of @types/three) | MIT, © 2016–2026 Arseny Kapoulkine | Same script: meshopt encoder and the simplifier for LOD files. The browser decodes with the copy of the decoder that ships inside `three` (examples/jsm/libs/meshopt_decoder.module.js, MIT). |
| property-graph | 4.1.0 | MIT, © 2021 Don McCurdy | Dependency of @gltf-transform/core (dev only) |
| ktx-parse | 1.1.0 | MIT, © 2020 Don McCurdy | Dependency of @gltf-transform/extensions (dev only) |

Transitive development packages (versions from the lockfile):

| Package | Version | Licence |
| --- | --- | --- |
| rolldown | 1.2.13 | MIT |
| @rolldown/pluginutils | 1.0.1 | MIT |
| @oxc-project/types | 0.153.0 | MIT |
| lightningcss (and its per-platform binaries) | 1.33.0 | **MPL-2.0**, see [Flags](#flags-and-notes) |
| detect-libc | 2.1.2 | Apache-2.0 |
| postcss | 8.5.29 | MIT |
| nanoid | 3.3.20 | MIT |
| picocolors | 1.1.1 | ISC |
| source-map-js | 1.2.2 | BSD-3-Clause |
| picomatch | 4.0.7 | MIT |
| fdir | 6.5.0 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tinybench | 6.2.2 | MIT |
| tinyexec | 1.3.1 | MIT |
| @vitest/mocker | 5.0.4 | MIT |
| @vitest/spy | 5.0.4 | MIT |
| chai | 6.3.0 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| assertion-error | 2.0.1 | MIT |
| expect-type | 1.4.0 | Apache-2.0 |
| es-module-lexer | 2.3.2 | MIT |
| estree-walker | 3.0.3 | MIT |
| @types/estree | 1.0.9 | MIT |
| magic-string | 1.4.3 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| obug | 3.0.0 | MIT |
| std-env | 4.3.0 | MIT |
| why-is-node-running | 3.2.1 | MIT |
| undici-types | 8.9.0 | MIT |
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0. Type-only dependency of @types/three; never imported or bundled. |
| @tweenjs/tween.js | 23.1.3 | MIT (via @types/three) |
| @types/stats.js | 0.17.4 | MIT (via @types/three) |
| @types/webxr | 0.5.24 | MIT (via @types/three) |
| fflate | 0.8.3 | MIT (via @types/three) |
| meshoptimizer | 1.1.1 | MIT (via @types/three) |

The lockfile also lists optional per-platform binaries for rolldown,
lightningcss and esbuild. Only the one matching the build machine is
installed, and each carries the same licence as its parent package.

Licence count across all 148 lockfile entries: 99 MIT, 27 Apache-2.0,
12 MPL-2.0 (all lightningcss, dev-only), 1 ISC, 1 BSD-3-Clause, and the
8 private `@aether/*` workspace packages (MIT).

## 4. External services

| Service | Use | Notes |
| --- | --- | --- |
| [Anthropic Claude API](https://www.anthropic.com/legal/commercial-terms) (Messages API) | Planner, coder and critic models when `ANTHROPIC_API_KEY` is set | Called only from the server, using the deployer's own key under their API terms |
| [OpenAI API](https://openai.com/policies/business-terms/) (Responses API) | Alternative provider when `OPENAI_API_KEY` is set | Called only from the server, using the deployer's own key under their API terms |

| Codex CLI with the user's own ChatGPT sign-in (via the local bridge) | Optional AI connection | Runs on the user's computer under the user's own OpenAI account and terms; nothing is proxied through the hosted server |
| Claude Code CLI with the user's own sign-in (via the local bridge) | Optional AI connection | The user's installed `claude` binary is spawned; `@anthropic-ai/claude-agent-sdk` is **not** bundled (its licence is not open source) |
| Netlify CLI, Vercel CLI, GitHub CLI (`gh`), itch.io `butler` — the user's own installs and logins | Optional "publish to your own hosting" from the local app | Spawned on the user's computer with the user's own accounts and under each service's terms; Aether ships none of them, passes them no credentials, and never deploys to an account of its own |
| Hugging Face / MLC model hosts (`huggingface.co`, `raw.githubusercontent.com`) | On-device model download, only after explicit opt-in | Only permissively licensed weights are offered (Qwen2.5 1.5B Instruct, Apache-2.0; Phi-3.5 mini Instruct, MIT; SmolLM2 1.7B Instruct, Apache-2.0); they are downloaded by the visitor's browser directly from the model host and cached there; Aether does not redistribute them |

Model ids are configuration (`.env`, Settings), not code. No model weights are
bundled or redistributed. With no keys and no connection, Aether uses its own
deterministic offline planner and calls no external service at all. Paid
API keys are only an optional bring-your-own setting: the hosted server never
uses an owner-paid key by default.

## 5. Assets

### 5.1 Curated asset library (`assets/`)

The library is described in [ASSETS.md](ASSETS.md). Every shipped file is
listed with its source archive, the file inside it, its licence, authors
and SHA-256 in the machine-readable **`assets/manifest.json`**; downloads
and their checksums are pinned in `assets/sources.json`. Only CC0-1.0 and
CC-BY-4.0 third-party assets are accepted; there are currently **no CC-BY
assets**, so no attribution is legally required — the app still credits
every source (credits panel, end-of-game screen, `CREDITS.txt` in exported
packages).

| Source | Version / date | Author | Licence (evidence) | Shipped |
| --- | --- | --- | --- | --- |
| [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) | 2.0 | Kenney (www.kenney.nl) | CC0-1.0 (`License.txt` in the archive) | 94 models |
| [Kenney Nature Kit](https://kenney.nl/assets/nature-kit) | 2.1 | Kenney | CC0-1.0 | 56 models |
| [Kenney Food Kit](https://kenney.nl/assets/food-kit) | 2.0 | Kenney | CC0-1.0 | 27 models |
| [Kenney Cube Pets](https://kenney.nl/assets/cube-pets) | 2.0 | Kenney | CC0-1.0 | 23 animated animals |
| [Kenney Car Kit](https://kenney.nl/assets/car-kit) | 3.1 | Kenney | CC0-1.0 | 18 models |
| [Kenney Graveyard Kit](https://kenney.nl/assets/graveyard-kit) | 5.0 | Kenney | CC0-1.0 | 18 models (5 animated characters) |
| [Kenney Pirate Kit](https://kenney.nl/assets/pirate-kit) | 2.1 | Kenney | CC0-1.0 | 15 models |
| [Kenney Survival Kit](https://kenney.nl/assets/survival-kit) | 2.0 | Kenney | CC0-1.0 | 15 models |
| [Kenney City Kit (Roads)](https://kenney.nl/assets/city-kit-roads) | 2.2 | Kenney | CC0-1.0 | 15 models |
| [Kenney City Kit (Commercial)](https://kenney.nl/assets/city-kit-commercial) | 2.1 | Kenney | CC0-1.0 | 13 models |
| [Kenney Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit) | 2.0 | Kenney | CC0-1.0 | 12 models |
| [Kenney Mini Characters](https://kenney.nl/assets/mini-characters) | 1.0 | Kenney | CC0-1.0 | 12 animated characters |
| [Kenney City Kit (Suburban)](https://kenney.nl/assets/city-kit-suburban) | 2.0 | Kenney | CC0-1.0 | 11 models |
| [Kenney Mini Market](https://kenney.nl/assets/mini-market) | 1.0 | Kenney | CC0-1.0 | 6 models (1 animated character) |
| [Poly Haven](https://polyhaven.com) models (API, 1k textures), retrieved 2026-10-14 | per asset (`assets/manifest.json`) | Kirill Sannikov, Ulan Cabanilla, Fran Calvente, James Ray Cock, Amal Kumar, Jorge Camacho, Rico Cilliers, Riley Queen, Josh Dean, Gabriel Radić (per asset in the manifest) | CC0-1.0 ([polyhaven.com/license](https://polyhaven.com/license)) | 16 models: armchair, sofa, round coffee table, nightstand, wooden side table, painted bench, succulent, clay pot, ceramic vase, pendant lamp, wooden lantern, barrel, cat and horse statues, street lamp, retro TV |
| [Poly Haven](https://polyhaven.com) HDRIs (1k `.hdr`) | per asset | Greg Zaal, Jarod Guest, Sergej Majboroda | CC0-1.0 | 5 skies: Kloofendal 48d Partly Cloudy (Pure Sky), Venice Sunset, Lebombo, Moonlit Golf, Brown Photostudio 02 |
| [ambientCG](https://ambientcg.com) PBR materials (1K-JPG), retrieved 2026-10-14 | per material (`assets/sources.json`, SHA-256 pinned) | Lennart Demes (ambientCG) | CC0-1.0 ([docs.ambientcg.com/license](https://docs.ambientcg.com/license/)) | 10 surface finishes: WoodFloor051 (oak), WoodFloor041 (walnut), Bricks090 (brick), Tiles107 (tile), Marble016 (marble), Concrete042A (concrete), PavingStones070 (stone), Fabric026 (fabric), Plaster001 (plaster), Terrazzo009 (terrazzo) |

Processing (`scripts/assets/build.ts`) changes the files: scale to metres,
pivot, merged meshes, LODs, linearised colours of two older Kenney kits,
re-encoded realistic textures, meshopt compression; ambientCG maps are
resampled to 512 px and converted to the renderer's finish format
(`scripts/assets/materials.ts`). Thumbnails in
`assets/lib/t/` are renders of these assets by this project.

**Evaluated and excluded:** Quaternius packs — the pack pages say CC0, but
quaternius.com/license.html forbids redistributing the assets as assets,
which a public repository would do (unclear licence → not shipped). No
Pascal Editor, Sketchfab or other assets are included.

### 5.2 Forge originals (first-party, AI-written code)

`hero-fountain`, `hero-statue`, `hero-lantern`, `hero-ship`, `hero-car`,
`hero-explorer`, `hero-cherry-tree`, `hero-gazebo` in
`packages/procgen/library/` (catalog pack `aether-forge`, MIT like the rest of
the project) are procedural generators written by **Anthropic Claude Code**
through the asset forge (`scripts/assets/forge-heroes.ts`) from text briefs
in that script — no reference images were used. See the AI disclosure below.

### 5.3 Other media

- **Geometry:** everything else is generated at runtime by Aether's own
  procedural kernel and its built-in generators, or by sandboxed generators
  written by the coder model at runtime.
- **Materials and skies:** procedural, built from colour and parameter
  presets plus shaders that ship with three.js, except the library models'
  own textures and the five HDR skies above.
- **Audio:** synthesised at runtime with WebAudio oscillators
  (`apps/studio/src/engine/sound.ts`). No audio files.
- **Fonts:** two variable web fonts are self-hosted from
  `apps/studio/public/fonts/` (never loaded from a CDN). Each is a Latin
  subset (`pyftsubset`, fontTools 4.66.1, all OpenType layout features kept)
  of the official release file; the full licence text ships next to each font.

  | Font | Upstream release | Licence | Shipped file (SHA-256) |
  | --- | --- | --- | --- |
  | [Inter](https://github.com/rsms/inter) 4.1 — UI and display type | `Inter-4.1.zip` (SHA-256 `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`), file `web/InterVariable.woff2` | SIL OFL 1.1, © 2016 The Inter Project Authors (`Inter-OFL.txt`) | `inter-var-latin.woff2`, 108 KB (`61bfb1520d2e7d081e984f35dada957961b56e36734837aa6ce5bebcbe1e243b`) |
  | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) 2.304 — code and labels | `JetBrainsMono-2.304.zip` (SHA-256 `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf`), file `fonts/variable/JetBrainsMono[wght].ttf` | SIL OFL 1.1, © 2020 The JetBrains Mono Project Authors (`JetBrainsMono-OFL.txt`) | `jetbrains-mono-var-latin.woff2`, 43 KB (`f4256d9ed255e928da20ca7a44a8d6a8b7f8e4128f63229c4de028c842868367`) |

  Neither upstream declares a Reserved Font Name; the subsets are still
  registered under the private family names *Aether Sans* and *Aether Mono*
  so they are never confused with the original releases.
- **Icon and logomark:** `apps/studio/public/favicon.svg` and the in-app
  logomark (`src/components/Logo.tsx`) and the stroke icon set
  (`src/components/Icon.tsx`) are original to this project.
- **Template and asset previews:** `apps/studio/public/templates/*.webp` and
  `apps/studio/public/palette/*.webp` are renders of Aether's own procedural
  worlds and objects, produced by `npm run thumbnails` with this
  application's renderer.
- **Transform gizmo:** three.js's `TransformControls` (examples/jsm, part of
  the MIT-licensed `three` package above), loaded lazily by the editor.
- **Screenshots:** `docs/screenshots/*.png` are captures of this application
  made by the e2e test.
- **User imports and `model` shapes:** models, images and HDRIs users import
  stay in their browser (IndexedDB) and are listed as "Your imports" in
  credits; they are never uploaded by the app. `model` URLs are restricted
  to same-origin, `blob:` or `data:` (the https allowlist is empty).
- **Optional image → 3D (TRELLIS.2, MIT):** off by default and not bundled;
  see [IMAGE_TO_3D.md](IMAGE_TO_3D.md).

## 6. Research references

The research papers cited in the [README](../README.md#research-inspirations)
(PWM, CoDeR, SceneMosaic, PAT3D, SceneSmith, Articraft, ESG, WorldBench,
3DCodeBench) were used **only as conceptual inspiration**. No code, models,
weights, datasets, prompts or assets were copied from them or from their
repositories.

The scale-geometry code in `packages/render/src/virtual/` (quadric-error
simplification, meshlet clustering, the cluster LOD DAG, scatter-field
culling) is an original TypeScript implementation of published techniques:
Garland & Heckbert, *Surface Simplification Using Quadric Error Metrics*
(SIGGRAPH 1997); Karis et al., *Nanite: A Deep Dive* (SIGGRAPH 2021
course); and the public design notes of meshoptimizer (MIT, Arseny
Kapoulkine). No source code was copied from meshoptimizer, Unreal Engine or
any other implementation, and no new dependency was added. The voxel
experiment (`experiments/voxel-meshing`) implements classic greedy meshing
(Lysenko, *Meshing in a Minecraft Game*, 2012) and the publicly described
binary greedy technique from scratch. `@sparkjsdev/spark` (MIT) was only
evaluated from its package metadata (`experiments/gaussian-splats`) and is
not installed.

## AI disclosure

- **AI coding assistants.** This codebase, including its tests and
  documentation, was written with AI coding assistants (**Anthropic Claude
  Code** and **OpenAI Codex**) under the direction and review of the human
  author. The author directed the design (World IR, package contracts,
  security and verification approach) and accepted every change. All code was
  written for this project from scratch: the first commit is dated
  2026-10-12, and the full commit history is public.
- **AI at runtime.** Depending on the connection the user picks, the app
  sends user prompts, a text summary of the world and optional images (user
  references, rendered views for the quality critique) to: the user's own
  Codex or Claude Code CLI through the local bridge, an on-device model in the
  browser, or Anthropic Claude / OpenAI models through the server proxy (the
  deployer's or the user's own key). The models return structured tool calls (World IR
  patches, procedural generator source, behaviour scripts), which are
  validated before use.
- **AI-generated assets.** 3D content created by AI at runtime is produced
  *as code*: procedural generators and behaviour scripts that run in
  sandboxes (see [ARCHITECTURE.md §9](ARCHITECTURE.md#9-sandbox-design)),
  including the asset forge's image / text → generator results. No AI-made
  meshes, images or audio are committed to the repository (the curated
  library models are human-made CC0 assets, see §5.1).
- **Offline generator library (AI-generated code).** The procedural
  generators in `packages/procgen/library/*.json` whose `provenance.source`
  is `"codex"` were **written by OpenAI Codex** (through the author's own
  ChatGPT sign-in, `scripts/build-generator-library.ts`, low reasoning
  effort) from short object descriptions in
  `packages/procgen/src/library-specs.ts`, and accepted only after automatic
  checks (static source check, sandboxed runs with three seeds, output
  validation, size/grounding/silhouette checks). The four entries with
  `"source": "example"` are the hand-reviewed few-shot examples. They are
  code, not meshes, and always execute in the generator sandbox.
- **Forge originals (AI-written code).** The eight `hero-*` generators in
  `packages/procgen/library/` (`provenance.source: "claude-code"`) were
  **written by Anthropic Claude Code** through the author's own sign-in,
  using the asset forge loop (`scripts/assets/forge-heroes.ts`: text brief →
  generator → sandbox acceptance checks → four rendered views → critique by
  the same model → patched code; two passes each, 33 model calls in total).
  They are code, not meshes; their thumbnails are renders by this project.
- **Offline mock.** The built-in mock provider is ordinary deterministic
  code (keyword matching plus world templates). It is not a model.

## Flags and notes

| Item | Status | Assessment |
| --- | --- | --- |
| **lightningcss 1.33.0, MPL-2.0** | Dev and build only | A CSS tool used internally by Vite. It runs on the build machine and none of its code ends up in the studio bundle or the server runtime. MPL-2.0 is a weak, file-level copyleft that applies only to modifications of its own files, which we do not modify or distribute. **No conflict** with commercial use or redistribution of Aether. It is flagged because it is the only licence outside MIT, Apache-2.0, ISC and BSD. |
| **Apache-2.0 components** (Rapier, TypeScript, Playwright, detect-libc, expect-type) | Rapier ships in the bundle and the Docker image; the others are dev only | Apache-2.0 is permissive and compatible. When redistributing Rapier, keep its licence text: it is preserved in `node_modules` inside the Docker image, and the licence is credited here. The package ships no NOTICE file. |
| **QuickJS (inside @jitl/quickjs-wasmfile-release-sync)** | Ships as WASM | MIT, © Fabrice Bellard and Charlie Gordon. Credited here. |
| **Docker base image `node:24-bookworm-slim`** | Deployment only (root `Dockerfile`) | Node.js (MIT) on Debian. The OS packages carry their own licences (some GPL), which is ordinary aggregation in a container image. Aether code is not linked into them. They are not part of the repository source. The runtime image holds production dependencies only (the Codex CLI binaries are removed). |
| **GitHub Actions** (`actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact`, `actions/download-artifact`, `docker/setup-buildx-action`, `docker/build-push-action`) | CI only (`.github/workflows/ci.yml`) | MIT (actions) / Apache-2.0 (Docker actions); run on GitHub's runners, never shipped. |
| **Share card and app icons** (`apps/studio/public/og.jpg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`) | Shipped (link previews, home-screen icons) | Original: rendered by `scripts/brand/render.ts` from the project's own logomark and its own showcase renders (`docs/screenshots/showcase/`), system fonts only. No third-party imagery. |
| **Chromium downloaded by Playwright** | Dev only (e2e) | Downloaded on demand by `npx playwright install` and never committed or shipped |
| **Inter and JetBrains Mono, SIL OFL 1.1** | Ship as static font files | OFL 1.1 permits use, embedding, modification and redistribution, including commercially, provided the copyright notice and licence travel with the fonts (they do: `apps/studio/public/fonts/*-OFL.txt`, copied into the build). Neither font declares a Reserved Font Name; the subsets are served as *Aether Sans* / *Aether Mono* anyway. The fonts may not be sold on their own, which Aether does not do. |
| **Two Rapier versions in `node_modules`** | Informational | 0.21.0 is the one actually used (`packages/physics`). 0.12.0 is only a type-level dependency of `@types/three` and is never imported. |

**Conclusion:** every code component Aether ships is MIT or Apache-2.0, plus
QuickJS under MIT; the two web fonts are SIL OFL 1.1. There are no non-commercial, personal-only,
educational-only, evaluation-only, share-alike or source-available
components, and the only third-party media are the two OFL fonts above.
Before each release,
regenerate this list if dependencies change, for example with
`npm ls --all` and a licence scan of `package-lock.json`.

### Block worlds (`@aether/voxel`)

No new dependency. Everything is original code; the published algorithms it
follows are credited here: 2D/3D simplex noise after Stefan Gustavson's
public-domain description; voxel ray traversal after Amanatides & Woo, "A
Fast Voxel Traversal Algorithm for Ray Tracing" (1987); per-vertex ambient
occlusion after the well-known "side1/side2/corner" rule described by Mikola
Lysenko (0fps.net, 2013); greedy meshing after the same author's write-up.
Block textures, item icons, mob models and sounds are generated procedurally
at run time (no image, model or audio assets). Saves use the platform's
`CompressionStream('deflate-raw')`.

### Real-life architecture (`@aether/arch`) and the studio render

No new dependency. The building model, wall network and mitre solver,
CSG-free openings, roofs, stairs, procedural furniture, navigation checks,
floor-plan drawing and editing tools, architectural view modes and the
walkthrough are original TypeScript written for Aether. Finish textures
(wood, stone, tiles, fabric, metals …) are synthesised procedurally at run
time; no texture, HDRI, model or audio asset was downloaded or added.

**Inspiration, credited:** [Pascal Editor](https://github.com/pascalorg/editor)
(MIT, © Pascal Group Inc.) was studied as a reference for an architectural
editor's user experience and data model: the site / building / level / wall /
slab / opening / roof / zone / item vocabulary, wall drafting with mitred
joins, room labels showing a coloured dot and the area, level selectors,
cutaway / exploded / single-level / x-ray views, and agent tools that edit a
building. Aether's implementation shares no code, assets or materials with
Pascal; the ideas listed above were re-implemented from scratch on Aether's
World IR, patch system and renderer. Walkthrough interactions (time-of-day
presets, light switches, a finish swap, photo mode) follow common
architectural-visualisation viewer conventions.

The studio render uses three.js's own post-processing nodes, part of the
`three` dependency (MIT, © three.js authors): `GTAONode` (ground-truth
ambient occlusion after Jimenez et al., *Practical Real-Time Strategies for
Accurate Indirect Occlusion*, 2016) and `TRAANode` (temporal reprojection
anti-aliasing), wired by Aether's `packages/render/src/gpu/post.ts`.

### Publishing (games, videos, renders, models, floor plans, share links)

No new dependency. The zip writer, share-link codec, QR code encoder, MP4
and WebM muxers, PDF writer, floor-plan drawing, camera paths and director,
title cards, the generated score and the standalone player are original
TypeScript written for Aether. Algorithms followed, credited: QR Code Model 2
(ISO/IEC 18004) — the encoder's structure follows Project Nayuki's QR Code
generator (MIT); ISO/IEC 14496-12 (MP4) and the "Opus in ISOBMFF"
specification; the Matroska / WebM element specification; RFC 7845 (Opus
identification header); the PDF 1.4 reference (base-14 Helvetica, WinAnsi).
Video and audio are encoded by the browser's own WebCodecs encoders (or
MediaRecorder); glTF export and its parse-back check use `GLTFExporter` and
`GLTFLoader` from the `three` dependency (MIT). No codec library, font,
music or image asset is bundled; the soundtrack is synthesised with Web
Audio at run time.

Replay proofs (`packages/verifier`, docs/PROOFS.md) add no dependency: the
SHA-256 is a small in-repo implementation (checked against `node:crypto` and
the published vectors), signatures use Web Crypto Ed25519, and the package
reuses `@aether/core`, `@aether/physics`, `@aether/logic`, `@aether/procgen`,
`zod` and `tsx` (the `aether-verify` bin runs the TypeScript sources like the
`aether` CLI).


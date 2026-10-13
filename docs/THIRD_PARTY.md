# Third-party components, licences and AI disclosure

This file covers every library, tool, service, asset and AI component used
by Aether, with its exact installed version, licence and provenance.

Versions and licences were read from each package's installed
`node_modules/<pkg>/package.json` and cross-checked against `package-lock.json`
on 2026-10-13. Aether's own code is [MIT](../LICENSE) (© 2026 Aether
contributors). All eight workspace packages (`@aether/*`) are private and
MIT-licensed.

**Summary:** everything that ships to users (the browser bundle and the
server runtime) is under **MIT or Apache-2.0**. Both are permissive and
compatible with the organizer's commercial, promotional and evaluation
licence and with the public-repository requirement. Nothing is
non-commercial, personal-use-only, evaluation-only or strong copyleft. Items
that need a note are listed in [Flags](#flags-and-notes).

---

## 1. Direct runtime dependencies

These are bundled into the studio or executed by the server.

| Package | Installed version | Licence | Used by | Copyright / source |
| --- | --- | --- | --- | --- |
| [three](https://github.com/mrdoob/three.js) | 0.186.1 | MIT | `@aether/render`, studio | © 2010–2026 three.js authors |
| [@dimforge/rapier3d-compat](https://github.com/dimforge/rapier.js) | 0.21.0 | Apache-2.0 | `@aether/physics` (installed at `packages/physics/node_modules`) | Dimforge / rapier.js authors |
| [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) | 0.32.0 | MIT | `@aether/logic` script sandbox | © 2019–2024 Jake Teton-Landis |
| [zod](https://github.com/colinhacks/zod) | 4.6.6 | MIT | `@aether/core`, `@aether/agent`, validation everywhere | © 2025 Colin McDonnell |
| [react](https://github.com/facebook/react) | 19.3.0 | MIT | studio | © Meta Platforms, Inc. and affiliates |
| [react-dom](https://github.com/facebook/react) | 19.3.0 | MIT | studio | © Meta Platforms, Inc. and affiliates |
| [zustand](https://github.com/pmndrs/zustand) | 5.0.15 | MIT | studio state | © 2019 Paul Henschel |
| [hono](https://github.com/honojs/hono) | 4.13.13 | MIT | server | © 2021–present Yusuke Wada and Hono contributors |
| [@hono/node-server](https://github.com/honojs/node-server) | 2.1.4 | MIT | server | © 2022–present Yusuke Wada and Hono contributors |
| [tsx](https://github.com/privatenumber/tsx) | 4.23.15 | MIT | server runtime (TypeScript loader), `smoke` and `e2e` scripts | © Hiroki Osame |

## 2. Transitive runtime dependencies

| Package | Installed version | Licence | Pulled in by |
| --- | --- | --- | --- |
| quickjs-emscripten-core | 0.32.0 | MIT | quickjs-emscripten |
| @jitl/quickjs-ffi-types | 0.32.0 | MIT | quickjs-emscripten |
| @jitl/quickjs-wasmfile-release-sync | 0.32.0 | MIT (contains **QuickJS**, © 2017–2021 Fabrice Bellard and Charlie Gordon, MIT) | quickjs-emscripten. This is the variant loaded at runtime. |
| @jitl/quickjs-wasmfile-release-asyncify | 0.32.0 | MIT | quickjs-emscripten. Emitted by the build but never loaded. |
| @jitl/quickjs-wasmfile-debug-sync | 0.32.0 | MIT | quickjs-emscripten. Emitted by the build but never loaded. |
| @jitl/quickjs-wasmfile-debug-asyncify | 0.32.0 | MIT | quickjs-emscripten. Emitted by the build but never loaded. |
| scheduler | 0.28.0 | MIT | react-dom |
| @types/react | 19.3.0 | MIT | Type-only peer of zustand. Not present at runtime. |
| csstype | 3.2.3 | MIT | Type-only dependency of @types/react |
| esbuild | 0.28.2 | MIT (© 2020 Evan Wallace) | tsx (TypeScript transform on the server). Its platform binary package `@esbuild/<platform>` 0.28.2 is MIT as well. |
| fsevents | 2.3.3 | MIT | Optional, macOS only (file watching) |

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

Model ids are configuration (`.env`), not code. No model weights are
downloaded, bundled or redistributed. With no keys, Aether uses its own
deterministic offline mock and calls no external service at all.

## 5. Assets

**No third-party 3D models, textures, HDRIs, images, fonts or audio are
included.**

- **Geometry:** every mesh is generated at runtime by Aether's own
  procedural kernel and its 35 built-in generators, or by sandboxed
  generators written by the coder model at runtime.
- **Materials and skies:** procedural, built from colour and parameter
  presets plus shaders that ship with three.js. No texture files.
- **Audio:** synthesised at runtime with WebAudio oscillators
  (`apps/studio/src/engine/sound.ts`). No audio files.
- **Fonts:** the CSS names *Inter* and *JetBrains Mono* first in the font
  stack, but **no font files are bundled or loaded from a CDN**. They are used
  only if already installed on the viewer's machine; otherwise system fonts
  apply.
- **Icon:** `apps/studio/public/favicon.svg` is original to this project.
- **Screenshots:** `docs/screenshots/*.png` are captures of this application
  made by the e2e test.
- **`model` shapes:** the World IR can reference glTF models, but the default
  configuration allows only same-origin, `blob:` or `data:` URLs (the https
  allowlist is empty). The repository includes no model files. Anyone who
  adds models must record their source and licence here.

## 6. Research references

The research papers cited in the [README](../README.md#research-inspirations)
(PWM, CoDeR, SceneMosaic, PAT3D, SceneSmith, Articraft, ESG, WorldBench,
3DCodeBench) were used **only as conceptual inspiration**. No code, models,
weights, datasets, prompts or assets were copied from them or from their
repositories.

## AI disclosure

- **AI coding assistants.** This codebase, including its tests and
  documentation, was written with AI coding assistants (**Anthropic Claude
  Code** and **OpenAI Codex**) under the direction and review of the human
  author. The author directed the design (World IR, package contracts,
  security and verification approach) and accepted every change. All code was
  written during the official build period: the first commit is dated
  2026-10-12, and the full commit history is public.
- **AI at runtime.** The app sends user prompts, a text summary of the world
  and optional user-supplied images to Anthropic Claude and/or OpenAI models
  through the server proxy. The models return structured tool calls (World IR
  patches, procedural generator source, behaviour scripts), which are
  validated before use.
- **AI-generated assets.** 3D content created by AI at runtime is produced
  *as code*: procedural generators and behaviour scripts that run in
  sandboxes (see [ARCHITECTURE.md §9](ARCHITECTURE.md#9-sandbox-design)). No
  pre-generated AI meshes, images or audio are committed to the repository.
- **Offline mock.** The built-in mock provider is ordinary deterministic
  code (keyword matching plus world templates). It is not a model.

## Flags and notes

| Item | Status | Assessment |
| --- | --- | --- |
| **lightningcss 1.33.0, MPL-2.0** | Dev and build only | A CSS tool used internally by Vite. It runs on the build machine and none of its code ends up in the studio bundle or the server runtime. MPL-2.0 is a weak, file-level copyleft that applies only to modifications of its own files, which we do not modify or distribute. **No conflict** with the organizer licence. It is flagged because it is the only licence outside MIT, Apache-2.0, ISC and BSD. |
| **Apache-2.0 components** (Rapier, TypeScript, Playwright, detect-libc, expect-type) | Rapier ships in the bundle and the Docker image; the others are dev only | Apache-2.0 is permissive and compatible. When redistributing Rapier, keep its licence text: it is preserved in `node_modules` inside the Docker image, and the licence is credited here. The package ships no NOTICE file. |
| **QuickJS (inside quickjs-emscripten)** | Ships as WASM | MIT, © Fabrice Bellard and Charlie Gordon. Credited here. |
| **Docker base image `node:22-slim`** | Deployment only | Node.js (MIT) on Debian. The OS packages carry their own licences (some GPL), which is ordinary aggregation in a container image. Aether code is not linked into them. They are not part of the submitted source. |
| **Chromium downloaded by Playwright** | Dev only (e2e) | Downloaded on demand by `npx playwright install` and never committed or shipped |
| **Two Rapier versions in `node_modules`** | Informational | 0.21.0 is the one actually used (`packages/physics`). 0.12.0 is only a type-level dependency of `@types/three` and is never imported. |

**Conclusion:** every component Aether ships is MIT or Apache-2.0, plus
QuickJS under MIT. There are no non-commercial, personal-only,
educational-only, evaluation-only, share-alike or source-available
components, and no third-party media assets. Before the final submission,
regenerate this list if dependencies change, for example with
`npm ls --all` and a licence scan of `package-lock.json`.

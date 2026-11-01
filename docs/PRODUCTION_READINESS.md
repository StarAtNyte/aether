# Production readiness

A measured pass over the repository at `3fb306aa` plus the fixes below. Fresh-clone gates were run from a scratch `git clone`
(`npm ci`, typecheck, tests, build, smoke); all passed.

## Gates (fresh clone, Node 24)

| Gate | Result |
|---|---|
| `npm ci` | pass |
| `npm run typecheck` | pass (52 s) |
| `npm test` | 521 files, 5286 tests pass (461 s with 2 workers) |
| `npm run build` | pass (134 s) |
| `npm run smoke` | pass (54 s) |
| `npm audit` (all deps) | 0 findings after the fix below (was 1 high, 1 moderate) |
| `npm run budget` | index 193 kB JS + 29 kB CSS gzip, player shell 67 kB + 0 kB (limits 203/31 and 71/1; was 925 and 1,360 kB before the home page stopped importing the agent, arch, procgen and assets; see REVIEW_LOG "Load weight") |
| `npm run licences` | all 168 production packages permissive and listed |

There is no linter configured. The strict TypeScript settings and the test suite are the static checks; adding one is a style decision left to the maintainers.

## Fixed

- **Dev server reachable through any tunnel.** `allowedHosts` was hard-coded to `.trycloudflare.com`. It is now empty by default and set with `AETHER_DEV_ALLOWED_HOSTS` (documented in the README and `.env.example`). The variable has its own name because `AETHER_ALLOWED_HOSTS` already means exact `host:port` values for the server.
- **Private three.js internals.** Every hook that wraps them (list and guards in `docs/CONTRACTS.md`, "three.js internals the renderer wraps") already feature-detected and restored on dispose. New `packages/render/test/three-internals.test.ts` pins the version in both `package.json` files, checks that the members still exist in the installed `three.webgpu.js` and fails with the member name after an upgrade, and proves that an unsupported renderer shape is left untouched by presentation, render-preparation, texture preparation and the render patches. Other prototype patches (`Material.alphaTest`, `Matrix3.setUvTransform`, `TextureNode.setup`, render-object cache key) are guarded the same way and listed in the same table.
- **Audit.** `body-parser` 2.4.0 (high, DoS on compressed bodies) and `fast-uri` 3.1.9 via lockfile-only `npm audit fix`.
- **Uncaught errors.** There was no global handler. `apps/studio/src/lib/globalErrors.ts` logs each uncaught error or unhandled rejection once, keeps a ring of the last 20, ignores aborts and the resize-observer notice, and shows at most one toast per 15 s.
- **CI.** Added `npm run budget` and `npm run licences` to the `check` job.
- **Cold open of an example (Slow 4G, 4x CPU, `tests/e2e/open-timeline.e2e.ts`, casa-patio, one run before and one after, software GPU on a busy machine so read the difference, not the value).** Before: editor chunks start downloading at 2.3 s (after the home bundle runs), editor mounted 10.9 s, first visible frame 16.6 s. Fixes: `editor-boot.js` (first tag in `<head>` of `index.html`, acts only on `#/new…` and `#/p/…`) preloads the whole editor chunk set and starts the example's world JSON at 0.34 s, and `loadTemplateWorld` takes that response instead of a second request; the card picture fetch runs beside the world fetch; the glTF exporter's `WebGLTextureUtils` has its own lazy chunk, which stops the editor importing the 366 kB `three-webgl` chunk (48 chunks in the editor set, none of them WebGL-renderer code). After: chunks start at 0.34 s, editor mounted 10.3 s, first visible frame 15.8 s (-0.7 s, -4 %). The open stays bandwidth bound: the editor set is about 1.4 MB compressed and the first frame also waits for about 0.9 MB of textures at 200 kB/s, so parallel fetch moves the start, not the end. Rapier's wasm is not on this path (physics loads on Play) and the WebGPU / WebGL2 choice is made by the renderer inside the one `three` chunk. Home stays at 197 kB gzip (limit 203). Next lever: the agent pipeline (`stages`, `photo`, planner chunks, about 350 kB compressed) is statically imported by the editor and only needed when a prompt is sent.
- **Docs.** `docs/README.md` index, `CHANGELOG.md`, this file.
- **Errors reach the operator.** Each distinct uncaught error in the studio is posted to `POST /api/errors` (only when a server answers `/api/health`, at most ten per page load); the server logs one scrubbed line through the normal rate limit and a 4 KB body cap. A static host sends nothing.
- **Switches usable by hand.** An entity with a `toggle` behavior is usable by aiming at it and pressing E even without an `interact` spec. Generated games had switches wired in logic that a player could not press.
- **Review renders that prove nothing.** The pose capture primes pipelines with a first pass (the first draw of new materials came out black), its far plane reaches distant cameras, and a review round whose renders are all black is retried and cannot be approved.
- **Sandbox lockdown test.** The probe exits once its result is flushed; Node 22's lazily loaded fetch internals failed at shutdown after the lockdown removed `WebAssembly`.

## Audited, nothing to change

- **Secrets.** Regex sweep of the full history (OpenAI/Anthropic/OpenRouter-style keys, AWS, GitHub, Slack, Google, Hugging Face tokens, private keys) found only obvious test fixtures (`sk-test-…`, `sk-ant-leakme…`, used to prove redaction). No `.env` or key file was ever committed; `.env.example` holds empty values. gitleaks is not installed here; CI could add it.
- **Licences.** 168 production packages: MIT 135, Apache-2.0 12, BSD-3-Clause 12, ISC 8, BSD-2-Clause 1. `docs/THIRD_PARTY.md` covers them (platform binaries of listed packages are covered by their parent entry).
- **Server** (`apps/server`): origin allow-list CORS and origin guard, per-route body caps, token-bucket limits (separate, stricter bucket for `/api/llm` and `/api/local/complete`, generator PUT), daily token budget, key redaction in config and logs, zod-validated bodies, ID-pattern-keyed file stores (no path from input), request ids, `/api/health`, generic 4xx/5xx bodies, host guard and access gate for the local app. Covered by `apps/server/test` (traversal, CSP, local guard, deploy).
- **Client safety.** No `innerHTML`, `dangerouslySetInnerHTML` or `document.write` in the studio or packages; the only `new Function` is the generator sandbox worker, served with its own CSP (`unsafe-eval` only there and in the KTX2 worker, which needs it for its transcoder glue). Main-page CSP has no `unsafe-eval`, allows `wasm-unsafe-eval`, `worker-src 'self' blob:`; the player page is sealed to `connect-src 'self'`.
- **Errors and degraded modes.** `ErrorBoundary` with retry and a page-level variant (offline, stale chunk, crash); `weak-gpu` and `backend` e2e suites cover no-GPU and WebGL2 paths; the AI-less mode runs on the offline planner.
- **Accessibility basics.** 305 `aria-label`s, `:focus-visible` rules, `prefers-reduced-motion` handling in 19 places, live regions for status; `ux.e2e.ts` exercises keyboard use. No automated contrast audit was run.
- **Source maps.** `sourcemap: false` in the production build (policy: not shipped).
- **Console.** Production logging goes through `lib/log.ts` (warnings and errors only unless `?debug=1`).

## Left, with reasons

- **No linter / gitleaks in CI.** Adding either changes the contribution workflow; propose before enforcing.
- **E2E suites not re-run.** They need browsers and a long GPU session; CI runs them. The changes here touch no rendering path.
- **Contrast.** Overlays were not measured with a tool; a Lighthouse or axe pass in CI is the follow-up.
- **`three` upgrades** remain a manual re-verification (the test says what to read), not an automatic one.

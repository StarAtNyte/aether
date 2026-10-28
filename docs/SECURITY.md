# Security model

Aether runs in two shapes, and the rules differ:

| | Local app (`aether start`) | Hosted static site |
| --- | --- | --- |
| Where it runs | Your computer, `http://127.0.0.1:<port>` | A static host (CDN), no Aether server |
| AI | Your own Codex / Claude Code login (CLI workers), your own API key, on-device model, offline planner | Your own API key (called straight from the browser), your own Codex / Claude Code through the local bridge, on-device model, offline planner |
| Whose account | Only the person sitting at the computer | Only the visitor's own key or own local login; never the site operator's |

The site operator's keys and subscriptions are never used for visitors. A
hosted copy has no server-side AI at all.

## Threat model

**What we protect.**

| Asset | Where it lives |
| --- | --- |
| The user's AI logins (Codex / Claude Code subscriptions) and quota | The CLIs' own credential files; reached only through the local server's `/api/local/*` routes and the token-paired bridge |
| A personal API key (bring your own key) | `sessionStorage` (or `localStorage` when the user asks to remember it) of the studio's origin |
| Projects, history, imports, publish history | IndexedDB of the studio's origin |
| The user's computer | Files, processes and network reachable by the local server, the bridge and the CLIs they start |
| Other visitors of a published game or share link | The player page (`/play`, published builds) |

**Who might attack.**

- **A web page the user visits** while Aether runs locally: tries to reach
  `127.0.0.1` (CSRF, DNS rebinding, Private Network Access), or embeds a
  share link / published game in an iframe.
- **A crafted world**: a share link, a project file, a game build, a model
  or image import. It contains attacker data, and may contain generator and
  behaviour-script *code*.
- **The model itself**: generator code, scripts, patches and tool calls come
  from an LLM that can be steered by prompt injection (a malicious image, a
  shared project, text in a prompt).
- **A device on the same network** when LAN sharing / LAN access is on.
- **A compromised or impersonated hosted page** that the user paired with
  their local bridge.

**Trust boundaries and what holds each one.**

| Boundary | Mitigation |
| --- | --- |
| Model output → code | Generators: static screen (advisory) + locked-down module worker (below) + output validation on the main thread; scripts: QuickJS (WebAssembly) with memory, stack and time limits; patches and tool calls: zod schemas + `validateWorld`. Nothing the model writes reaches `eval` on the page. |
| Model output → the user's computer | CLI runs have every tool, MCP server, plugin, hook and setting source disabled, an allowlisted environment, an empty throwaway folder and a timeout; a tool use kills the run (`tool_violation`). |
| Web page → local server / bridge | Host allowlist (421), Origin allowlist (403), JSON-only bodies (preflight), `HttpOnly; SameSite=Strict` session secret, loopback-socket check, bearer token from a one-time pairing code (bridge). |
| Untrusted files → browser | Header-level validation before any decoder (glTF structure and budgets, embedded texture sizes, image pixel counts), zip caps enforced while inflating, prototype-pollution guards, `validateWorld`. |
| Published build → the studio's origin | Builds in the local library are served on the studio's origin, so they may carry no code of their own: every script must be the installed player byte for byte, `sw.js` must be the generated worker (below). |
| Visitor → published game | `PLAY_CSP` (no inline or eval'd script, no third-party hosts), titles escaped, share links capped and validated. |

**Out of scope.** Malware already running as the user (it can read the CLI
credentials directly); a user who pastes their own key into a page they do
not trust; the optional server-side generator dry run
(`AETHER_VALIDATE_GENERATORS`, off by default) — `node:vm` is not a security
boundary, so do not turn it on for a public server.

## Local app

### Network exposure

- The server binds `127.0.0.1` by default (`HOST` defaults to `127.0.0.1`).
- `aether start --host 0.0.0.0` is refused unless `--allow-lan` is also
  given. Then a warning is printed and a fresh random **access token**
  (32 bytes) is required for every request except `/api/health`. The printed
  link carries it once (`?access=…`); the server swaps it for an `HttpOnly`,
  `SameSite=Strict` cookie and redirects to a clean URL.
- Local AI routes (`/api/local/*`) only answer requests whose socket is
  loopback, whose `Host` is loopback and that carry no proxy headers, even in
  LAN mode. Devices on the network can use the studio offline or with their
  own key, never this computer's AI login.

### DNS rebinding and cross-site requests

- **Host allowlist.** The CLI passes `AETHER_ALLOWED_HOSTS`
  (`127.0.0.1:<port>`, `localhost:<port>`, plus LAN addresses in LAN mode).
  Any other `Host` gets `421` on every route, static files included. A page
  that rebinds its own domain to 127.0.0.1 still sends its own domain as
  `Host`, so it is refused.
- **Origin allowlist.** `ALLOWED_ORIGINS` holds exactly the same addresses.
  CORS only answers those, and state-changing requests from any other
  `Origin` get `403`. Request bodies must be `application/json`, which forces
  a CORS preflight.
- **Per-install session secret.** On first start the CLI writes 32 random
  bytes to `<state>/secret` (mode 0600). The server sets it as an
  `HttpOnly; SameSite=Strict` cookie on the studio's HTML and requires it on
  every `/api/local/*` request. Other sites can neither send it (SameSite)
  nor read it (HttpOnly, same-origin). The CLI proves itself with the same
  secret in the `X-Aether-Admin` header. Only that header (not the cookie)
  may stop the server (`POST /api/admin/shutdown`) or mint bridge pairing
  links (`POST /api/local/bridge/pair`). Secrets are compared in constant
  time (SHA-256, then `timingSafeEqual`) and never logged.

### Your AI login

- Codex runs with **your own** login: `CODEX_HOME` (default `~/.codex`).
  Extra accounts added from the studio get their own `CODEX_HOME` under
  `<state>/data/local-ai/` (folders 0700, registry 0600 holding only
  id, label and folder). Aether never opens, copies or sends the files the
  CLI writes. Claude Code status comes from `claude auth status --json`;
  its credential files are never read.
- Sign-in runs the CLIs' own flows (`codex login`, `codex login
  --device-auth`, `claude auth login`). The studio only shows the
  verification URL and one-time code the CLI prints (sanitised, https URLs
  only).
- Every AI call runs in a separate worker process in its own process group,
  with an allowlisted environment (no API keys, tokens or cloud
  credentials), the CLI's tools disabled, an empty throwaway working folder
  and a hard timeout. Cancelling a job kills the whole group (SIGTERM, then
  SIGKILL after 3 s; on Windows, which has no process groups, the process
  tree is ended with `taskkill /T /F`).
- The account and model are frozen into a job when it is queued; switching
  accounts is refused while jobs run.

### Process and files

- All subprocesses are spawned with argument arrays and `shell: false`.
  Windows `.cmd` shims run through `cmd.exe /d /s /c` with fixed arguments
  that are checked for shell metacharacters. This one helper (`spawnCli` in
  `@aether/bridge`) is used by the CLI, the sign-in manager, the CLI probes
  and the AI workers. The Codex SDK is never handed a batch shim; it then
  uses its own bundled binary.
- State folder: `$XDG_STATE_HOME/aether` or `~/.local/state/aether`
  (`%LOCALAPPDATA%\Aether` on Windows), mode 0700. `server.json`, `secret`,
  `access-token` and the logs are 0600. Everything read back is validated
  with zod (size-capped).
- `aether stop` only signals a process it can identify: health must answer
  with this start's random instance id, or on Linux `/proc/<pid>/cmdline`
  must name the Aether server. Otherwise it asks for `--force`.
- Logs: JSON lines, scrubbed of configured secrets and of anything shaped
  like an API key or bearer token. Rotated at 5 MiB, three copies kept.

## Hosted static site

- No Aether server and no `/api`. The page's CSP `connect-src` allows `'self'`,
  the visitor's own loopback bridge (`http://127.0.0.1:*`,
  `http://localhost:*`), the four provider API origins used for
  bring-your-own-key, and the on-device model hosts. No other wildcard.
- The local bridge (for a visitor's own Codex / Claude Code) listens on
  127.0.0.1 only, accepts exactly the origins it was started with
  (`aether start --origin https://…`), and requires a pairing token. The
  token comes from a one-time code (8 characters, at most 5 guesses per
  code) or from a link whose token travels in the URL fragment. It is kept
  in `sessionStorage` only.
- The hosted first-run screen leads with that bridge ("Use your own Codex /
  ChatGPT login"). A Codex sign-in started from the page runs the CLI's own
  device-code flow **on the visitor's computer** (bridge `/v1/auth/login`,
  bearer token required). The page only shows the verification link (https
  only, `rel="noopener noreferrer"`) and the one-time code the CLI printed;
  it never sees a password or token. The bridge address field accepts only
  loopback origins (`normalizeBridgeUrl`).

## Self-hosted container

- The image (`Dockerfile`) sets `AETHER_HOSTED=1` and `AETHER_LOCAL_AI=off`:
  the server refuses local AI, so it can never run a Codex / Claude Code
  login on behalf of visitors. Without a configured key it serves the
  offline planner; it needs no secret.
- Runs as the unprivileged `node` user with production dependencies only
  (no compilers, test tools or the Codex binaries); the build context
  excludes `.env*`, `.git`, local data and private notes (`.dockerignore`).
- `docker-compose.yml` adds a read-only root file system, `no-new-privileges`,
  `cap_drop: ALL`, memory / CPU / PID limits and a loopback-only port.
- Browser navigations to unknown paths and server errors get static,
  script-free error pages that never echo the request or the error;
  `/api/*` keeps JSON errors. Logs carry method, path, status, duration and
  request id only (no bodies, queries or keys); uncaught errors are logged
  scrubbed and the process drains and exits for a clean restart.
- Socket timeouts bound slow clients (whole request within 120 s) while
  keep-alive outlives proxy idle timeouts (65 s).

## Bring your own key

A user's own API key (Anthropic, OpenAI, OpenRouter or Google Gemini) is
used **only from the browser, only toward that provider**:

- **Where it lives.** sessionStorage (`aether.byok.v2`), gone when the tab
  closes. It goes to localStorage (`aether.byok.device.v1`) only when the user
  ticks "remember on this device", and unticking or "Forget key" removes it.
  It is never in IndexedDB, project files, exports, share links, URLs or logs.
  Every read re-validates it (`/^[A-Za-z0-9_.-]{20,300}$/`: no whitespace, so
  no header injection), and unknown providers or `__proto__` entries are dropped.
- **Where it is sent.** Straight to the provider's API: `https://api.anthropic.com`
  (with `anthropic-dangerous-direct-browser-access: true`), `https://api.openai.com`,
  `https://openrouter.ai`, `https://generativelanguage.googleapis.com`. CSP
  `connect-src` names exactly these four origins (a test keeps the server's
  `BYOK_API_HOSTS`, `vercel.json` and the studio catalog in sync). Aether's
  server has **no** key route: the old `/api/llm/byok` passthrough was
  removed, and the hosted build has no `/api` at all. Requests send no
  cookies (cross-origin), and the referrer is cut to the origin.
- **Never in UI state.** The observable connection state holds the provider
  names, the "remembered" flag and usage counters, never the key. The
  settings show only "Key set" and a masked form (`maskKey`).
- **Caps.** At most 150 model calls per browser session
  (`BYOK_SESSION_CALL_CAP`). Past that, the call is refused before anything
  is sent, until the user resets the counter. Each request has a 120 s
  per-attempt timeout and at most one retry. Output tokens are capped
  (32 000 for Chat Completions providers). Model lists are zod-validated,
  at most 8 MiB, with at most 200 entries and a 15 s timeout.
- **Untrusted replies.** Provider responses go through the same normalizers
  and agent validation as every other provider. Tool arguments are parsed
  defensively, and patches are validated before they touch the world.
- **Never the owner's key.** The hosted build carries no key. A deployment
  that sets `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` uses them only on the
  server, behind `AETHER_PROVIDER`, and never in the client bundle.

## Sandboxes

AI-written generators and behaviour scripts run in the existing sandboxes
(see [ARCHITECTURE.md](ARCHITECTURE.md)): a locked-down worker with its own
CSP for generators, and QuickJS (WebAssembly) for scripts. Nothing in the
local app adds an `eval` path.

**Generator worker lockdown.** Before any generator runs, the worker:

1. captures the two capabilities it needs (`postMessage`, the `Function`
   constructor used to compile) in closures;
2. makes the constructors reachable from any function
   (`(() => 0).constructor`, async / generator variants) throw;
3. removes every global that is not a plain ECMAScript intrinsic
   (`ALLOWED_GLOBALS`) **from the worker scope and from its whole prototype
   chain** (`DedicatedWorkerGlobalScope.prototype`,
   `WorkerGlobalScope.prototype`, `EventTarget.prototype`). Browsers keep
   `fetch`, the `indexedDB` getter, `caches` and friends on those
   prototypes, and interface objects such as `WorkerGlobalScope` hand them
   out through `Object.getOwnPropertyDescriptor`; a WebIDL getter called with
   an undefined receiver falls back to the global object. Shadowing names on
   the scope alone (the previous lockdown) left that path open — see the
   hardening review in [REVIEW_LOG.md](REVIEW_LOG.md);
4. freezes the shared intrinsics so one run cannot tamper with the next.

The worker also gets its own CSP (`default-src 'none'`) where the host sends
headers.

**KTX2 transcoder worker.** The Basis Universal transcoder that turns the
library's KTX2 textures into GPU formats is Emscripten output whose embind glue
builds its bindings with `new Function`. three's `KTX2Loader` would start it as
a `blob:` worker, which inherits the page's policy (no `'unsafe-eval'`) and
fails. Instead it runs from the static, same-origin `basis/ktx2-worker.js`
(KTX2Loader's own worker body around three's transcoder, regenerated and
checked by a test), served with `TRANSCODER_WORKER_CSP`: `default-src 'none';
script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'` (no network, no nested
workers; the WebAssembly binary arrives by message). The page rule of
`vercel.json` excludes that path so the two policies never combine, and the
studio and player keep their strict policies. It only ever processes the
library's own files, and anything it fails on falls back to the original
images. `npm run e2e:security` runs the escape attempts in the real bundled
worker in Chromium and Firefox; they must all fail while a normal generator
still builds.

## Imported files

- **Models** (`.glb`, self-contained `.gltf`): exact GLB header and chunk
  checks; JSON size cap and prototype-pollution guard; zod structure; no
  external URIs (buffers and images must be embedded); only extensions the
  studio decodes; caps on bytes, triangles, nodes, meshes, materials,
  textures, clips, accessors and **decoded vertex bytes** (256 MB — an
  accessor without a buffer view is zero-filled by the loader, so its
  declared count counts too); every **embedded texture's header** is read
  before any decoder sees it (PNG / JPEG / WebP only, ≤ 8192 px per side,
  ≤ 80 megapixels per model): a 33-byte PNG can declare 65535 × 65535
  pixels. The output is a fresh, canonical GLB.
- **Images and skies**: format by magic bytes, never by extension or MIME;
  byte and pixel caps. Reference images attached to a prompt are checked the
  same way (≤ 12 000 px per side, ≤ 50 megapixels) before the browser
  decodes them, then downscaled to 1024 px.
- **Archives**: entry count, per-entry and total caps enforced while
  inflating (a deflate bomb stops at the cap), CRC checked, encrypted
  entries refused, names must be safe relative paths — no `..`, no absolute
  paths, no backslashes or control characters, no Windows device names
  (`con`, `nul`, `com1` …) and no parts ending in a dot or space.

## Importing models while you work

The local app can download and convert one 3D model on request (`POST /api/assets/import`, the agent tool `import_asset`, see
[ASSETS.md](ASSETS.md#importing-while-you-work)). It reaches out to the internet and runs a converter, so it is the part of the
local server with the most exposure. What bounds it:

- **Who may ask.** Only a server on the user's own computer (local AI on) serves it. A production or hosted server does not,
  unless the operator sets `AETHER_ALLOW_IMPORT=1`. Every request needs the per-install session cookie (or the CLI header), a
  loopback socket and Host, and no proxy header; the Host and DNS-rebinding guards of the local app apply before it. With
  `AETHER_ALLOW_IMPORT=1` on a shared host the loopback rule is dropped and the session cookie, if configured, is the only
  gate: leave the flag off on any host that strangers can reach.
- **Where it connects.** Only the SimReady Central search service and `huggingface.co` / `*.hf.co` over https, to URLs the
  server builds itself from a parsed search result or a pinned `<owner>/<dataset>@<40-hex commit>/<package>` ref. A request can
  carry a search text, or such a ref; it can never carry a URL, a path or a branch. Redirects are re-checked against the host
  list. No token or credential is read or sent.
- **What it accepts.** The package's own licence and the dataset card must both be on the allow-list (CC0-1.0, CC-BY-4.0, MIT;
  Apache-2.0 and BSD are findable but not importable yet). Everything else is refused before a byte is downloaded. Every file is
  checked against the Hub's SHA-256 or git blob id and the package's bill of materials.
- **Limits.** One job at a time, three waiting, ten starts per ten minutes, 150 MB per package, 200 files, twelve minutes per
  job, nine for the converter, 20,000 triangles and 6 MB for the result. Files land in a per-job temp folder that is removed.
- **Untrusted data.** Nothing from the download is executed. The converter is `python -I` (isolated mode: no current-directory or
  user-site imports) running a script from this repository on the USD, with a minimal environment (no keys, no tokens, `HOME`
  and `TMPDIR` set to the temp folder). The decimation runs in a Node child process with the same environment. The result is
  served only by content-hashed names listed in its own record.
- **In the studio.** The studio fetches the GLB, compares its SHA-256 with the record, and validates it again like any dropped
  file (`importUserAsset`) before storing it with the project.
- **Not covered.** A malicious USD could try to exploit the USD library in the converter (a parser bug); the sandbox is the
  isolated interpreter and the temp folder, not a container. The Python environment is created by `npm run assets:simready-setup`
  outside the repository and is never part of the runtime, the Docker image or CI.

## Publishing

- **Share links are data, never code paths.** The world travels in the URL
  fragment (never sent to a server). The player caps the fragment
  (1.5 MB) and the inflated JSON (8 MB, enforced while inflating, so a
  compression bomb stops at the cap), checks a strict envelope, guards
  against prototype pollution and validates the world with `validateWorld`.
  Generator and script code in it runs only in the existing sandboxes.
  Malformed, hostile and oversized links show an error screen (e2e).
- **The player page is narrower than the studio.** `/play` and published
  builds get their own CSP (`PLAY_CSP`): same-origin scripts and WebAssembly
  only, `connect-src 'self' blob: data:` (no model APIs, no bridge), no
  inline or eval'd script on the page, and `frame-ancestors *` so games can
  be embedded — the player runs no editor and holds no keys. Builds carry
  the same policy as a `<meta>` tag because static hosts send no headers.
- **Game builds** are made in the browser from a build-time file list
  (`play-manifest.json`); the build fails if editor code becomes reachable
  from the player. Bundled imports are re-validated by the player exactly
  like a fresh import, and their content id must match. Titles and
  descriptions are cleaned (control and bidi characters) and escaped in
  `index.html`; README / CREDITS are plain text.
- **Local library of builds** (local app only, behind the loopback +
  session guard): uploads are `application/zip` ≤ 256 MB, read with entry,
  per-file and total caps; every name must be a safe relative path with an
  allowed extension; `game.json` must be an Aether game with a valid world.
  Builds are written to a temporary folder and renamed into place
  (immutable), at most 100 builds / 2 GB. Nothing uploaded is executed by
  the server; files are served with the player CSP and `nosniff`.
- **No foreign code in the library.** Library builds are served from
  `/published/<id>/` on the studio's own origin — the origin of the session
  cookie, the local AI routes and the user's projects. A script there could
  drive the user's Codex / Claude Code login, read projects or a remembered
  key; a service worker there would keep doing it. So every `.js` / `.mjs`
  in an upload must be byte-identical (SHA-256) to a player file of the
  studio installed on this computer (its `play-manifest.json`), and `sw.js`
  must be exactly the offline worker the studio generates
  (`isGeneratedServiceWorker`). Everything else in a build is inert under
  `PLAY_CSP` and `nosniff` (no inline script; script only from `'self'`,
  where every script is now trusted code). A build made by a different
  Aether version is refused with a message saying so; rebuild it in this
  computer's studio.
- **Page text is never markup.** Titles and descriptions are escaped and
  spliced with function replacers (a replacement string would expand
  `$'` / `$&` typed into a title and paste the rest of the page into an
  attribute).
- **Deploying to the user's hosting** runs the user's own CLI (`netlify`,
  `vercel`, `gh`, `butler`) with argument arrays (no shell; values are
  regex-validated slugs or `user/game`), the allow-listed environment of
  the bridge (no API keys, tokens or other secrets — the CLIs use their own
  saved logins), no stdin, per-step timeouts in their own process group
  (cancel and timeout end the whole tree), capped output, and a throwaway
  copy of the build that is deleted afterwards. GitHub Pages goes through
  `gh api --input <file>` (no git, no shell). Only URLs on the hosting
  services' own domains are shown as links. Tests use fake CLIs on PATH.
- **LAN sharing** is off by default and explicit: a second, read-only
  listener serves exactly one build under a random 128-bit token path
  (constant-time compare), GET / HEAD only, with the player CSP, a request
  rate limit and an automatic stop after two hours. Everything else,
  including `/api` and the studio, is 404 on that port.
- **Publish history** lives in its own IndexedDB database; records are
  validated on read (only `https://` and local URLs, image data-URL
  thumbnails), with count and byte caps.

## Reporting a vulnerability

Please report security issues privately, not in a public issue: use
**Security → Report a vulnerability** (a private security advisory) on the
project's GitHub repository. Include what you tried, what happened, the
browser / OS and, if you can, a minimal world, file or request that
reproduces it. You will get an acknowledgement within a few days; fixes for
confirmed issues ship with a regression test (an exploit attempt that must
fail) and a note in [REVIEW_LOG.md](REVIEW_LOG.md).

When testing, use your own machine and your own accounts: never point
exploit attempts at someone else's hosted copy or local bridge.

# @aether/server

The Hono-on-Node API server for Aether. It proxies LLM calls so API keys
never reach the browser, stores share links and the generator cache, and in
production serves the built studio (`apps/studio/dist`).

```
npm run dev:server                 # tsx watch, from the repo root
npm run start -w @aether/server    # tsx, no watch
npx vitest run apps/server         # tests (offline; no real network)
```

`.env` at the repo root is loaded if present. Variables already set in the
environment take precedence. With no API key the server runs in **mock mode**:
`/api/llm` answers `503 {error:'mock-mode'}` and the studio switches to its
local deterministic mock provider.

## Layout

| File | Role |
| --- | --- |
| `src/main.ts` | Process bootstrap: `.env`, config, provider choice, listen, graceful shutdown |
| `src/app.ts` | `createApp(config, deps)`: middleware and routes, with every side effect injected |
| `src/config.ts` | zod-validated environment, with secret redaction |
| `src/middleware.ts` | access log, CORS allowlist, origin guard, rate limit, body limit, security headers |
| `src/routes/llm.ts` | `POST /api/llm` proxy |
| `src/routes/generators.ts` | content-addressed generator cache |
| `src/routes/worlds.ts` | world share links |
| `src/routes/local.ts` | local app only: `/api/local/*` (this computer's Codex / Claude Code login: accounts, login, jobs with event streams, bridge pairing) |
| `src/routes/image-to-3d.ts` | optional `POST /api/image-to-3d` (off unless `AETHER_IMAGE_TO_3D_URL` is set) |
| `src/static.ts` | studio hosting, `/play` (standalone player) plus SPA fallback |
| `src/routes/publish.ts` | local app only: build library, deploys, LAN share, `/published/:id/…` |
| `src/publish/*` | build store, hosting CLIs (`hosts.ts`), deploy jobs, LAN share, shared services |

## API

| Route | Notes |
| --- | --- |
| `GET /api/health` | `{ ok, mode: 'live'\|'mock', providers }`. Not rate limited. |
| `POST /api/llm` | Strictly validated `CompletionRequest`. Limits: body ≤ 1 MB, system ≤ 60k chars, ≤ 60 messages, ≤ 16 tools, ≤ 4 images, each a PNG, JPEG or WebP data URL ≤ 1.5 MB. The **server picks the model from `role`** and ignores any client `model`. `maxTokens` is capped. Upstream calls time out after 90 s and abort when the client disconnects. Upstream errors are mapped to fixed codes (`upstream-auth`, `upstream-rate-limited`, `upstream-timeout`, …) and never forwarded verbatim. |
| `GET /api/generators/:hash` | Cached `GeneratorDef` (immutable cache headers). |
| `PUT /api/generators/:hash` | `hash = sha256hex(stableStringify(GeneratorDef.parse(def)))`. The server recomputes the hash (a mismatch gives 400 with the expected hash), validates the def, and dry-runs it in the `@aether/procgen/node` sandbox when that is available (failure gives 422). Answers 201 when created and 200 when the def already exists. |
| `PUT` or `POST /api/worlds` | Validates with `validateWorld` (≤ 2 MB) and stores the world under a random 12-char base62 id. Returns `201 { id, editToken }`. |
| `GET /api/worlds/:id` | The stored `WorldDoc`. |
| `PUT /api/worlds/:id` | Replaces the world. Requires `X-Edit-Token` from creation; only its SHA-256 is stored. |
| `POST /api/image-to-3d` | Optional, off by default: forwards an image to your own TRELLIS.2 endpoint and returns the validated GLB ([`docs/IMAGE_TO_3D.md`](../../docs/IMAGE_TO_3D.md)). |
| `/api/local/*` | Local app only (registered when local AI is on; loopback socket and Host, no proxy headers): accounts, login / logout, `complete`, jobs and their event streams, bridge pairing, and the publish routes. Errors use the bridge format `{ error: { code, message } }`. |

Errors always look like `{ error: <code>, message?, issues? }`. Stack traces are never returned.

`GET /play` (and `/play.html`) serve the standalone player of share links
(`/play#w=…`; the world travels in the fragment, so nothing is stored) with
the player's own CSP (`PLAY_CSP`: no third-party hosts, embeddable).

## Security model

- Keys come only from the environment. Logs are structured JSON (method, path, status, ms, request id) with no bodies, and secrets plus key-shaped strings are scrubbed.
- CORS allowlist (`ALLOWED_ORIGINS`). Mutating requests that carry a foreign `Origin` get 403. JSON bodies must be sent as `application/json`, which forces a preflight.
- Per-IP token buckets: `/api/llm` defaults to 20/min with burst 5; other API routes default to 120/min with burst 60. Behind a proxy, set `TRUST_PROXY_HOPS`.
- **Daily token budget** (`AETHER_DAILY_TOKEN_BUDGET`, UTC day, in memory). Once it is spent, `/api/llm` returns 429 until midnight UTC. This protects the public deployment from abuse.
- Body limits per route. Untrusted JSON is screened for prototype-pollution keys, depth and node-count bombs before zod runs.
- Storage: ids and hashes are regex-validated and resolved paths are re-checked to stay inside `DATA_DIR`. Writes are atomic (temp file then rename), and entry counts and sizes are capped.
- Headers: CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`), `nosniff`, `Referrer-Policy`, COOP `same-origin`, `X-Frame-Options: DENY`, and HSTS in production.
- The generator dry-run uses `node:vm`, which is not a hard security boundary, so it is **off by default** (`AETHER_VALIDATE_GENERATORS=false`). When enabled it runs in a dedicated `worker_threads` Worker with a capped V8 heap and a terminate watchdog (`AETHER_GENERATOR_TIMEOUT_MS`, default 1 s), so it never blocks the HTTP event loop. At most `AETHER_GENERATOR_MAX_QUEUE` checks may wait (further uploads get 503), and generator uploads have their own stricter per-client rate limit. The browser always runs generators in its own Worker sandbox anyway.

## Configuration

| Variable | Default |
| --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` (the Docker image sets `HOST=0.0.0.0`) |
| `NODE_ENV` | `development` (`production` turns on static serving and HSTS) |
| `AETHER_PROVIDER` | `mock` (offline planner). `anthropic` / `openai` use that provider's key; `codex` / `claude-code` (local only) the signed-in CLI. |
| `AETHER_LOCAL_AI` | `auto` (on in development when no hosting platform is detected). `on` / `off`; `on` is refused on a hosted platform. |
| `AETHER_HEADLESS_MODEL` / `AETHER_HEADLESS_EFFORT` | CLI default / `low`. Model and effort for the `codex` / `claude-code` providers. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | none |
| `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` | none (the public APIs). https only. |
| `AETHER_PLANNER_MODEL`, `AETHER_CODER_MODEL`, `AETHER_CRITIC_MODEL` | Anthropic models per role (critic defaults to planner) |
| `AETHER_OPENAI_PLANNER_MODEL`, `AETHER_OPENAI_CODER_MODEL`, `AETHER_OPENAI_CRITIC_MODEL` | OpenAI models per role |
| `ALLOWED_ORIGINS` | `http://localhost:5173` (comma list) |
| `DATA_DIR` | `apps/server/data` |
| `STATIC_DIR` / `SERVE_STATIC` | `apps/studio/dist` / on in production |
| `TRUST_PROXY_HOPS` | `0`. Set to `1` behind Fly.io, Render or Railway. |
| `RATE_LIMIT_LLM_PER_MIN` / `RATE_LIMIT_LLM_BURST` | `20` / `5` |
| `RATE_LIMIT_API_PER_MIN` / `RATE_LIMIT_API_BURST` | `120` / `60` |
| `AETHER_DAILY_TOKEN_BUDGET` | `2000000` (`0` = unlimited) |
| `AETHER_LLM_TIMEOUT_MS` / `AETHER_MAX_OUTPUT_TOKENS` | `90000` / `16000` |
| `AETHER_LLM_MAX_BODY_BYTES` | `1048576` (1 MB `/api/llm` body cap) |
| `AETHER_IMAGE_TO_3D_URL` / `AETHER_IMAGE_TO_3D_TOKEN` | none (off). Optional image → GLB endpoint (loopback http or https) and its bearer token; see [`docs/IMAGE_TO_3D.md`](../../docs/IMAGE_TO_3D.md). |
| `AETHER_MAX_WORLDS` / `AETHER_MAX_GENERATORS` | `10000` / `5000` |
| `RATE_LIMIT_GENERATOR_PUT_PER_MIN` / `RATE_LIMIT_GENERATOR_PUT_BURST` | `10` / `5` |
| `AETHER_VALIDATE_GENERATORS` / `AETHER_GENERATOR_TIMEOUT_MS` / `AETHER_GENERATOR_MAX_QUEUE` | `false` / `1000` / `8` |
| `LOG_LEVEL` | `info` |
| `AETHER_ALLOWED_HOSTS` | none (any Host). Comma list of exact `host:port` values; any other `Host` gets 421 (DNS-rebinding defence). Set by `aether start`. |
| `AETHER_SECRET_FILE` | none. File holding the per-install secret: set as an HttpOnly SameSite=Strict cookie on the studio page and required on `/api/local/*`; the `X-Aether-Admin` header with it unlocks `POST /api/admin/shutdown` and `POST /api/local/bridge/pair`. |
| `AETHER_ACCESS_TOKEN_FILE` | none. LAN mode: every request except `/api/health` needs this token (`?access=` once, then a cookie). |
| `AETHER_INSTANCE_ID` | none. Echoed by `/api/health` so the CLI recognises its own server. |
| `AETHER_LOG_FILE` | none (stdout). Append logs here, rotated at 5 MiB, 3 copies. |
| `AETHER_BRIDGE_ORIGINS` / `AETHER_BRIDGE_PORT` | none / `8790`. Also run the token-paired bridge (127.0.0.1) for these https studio origins; needs local AI. |

## Local app

`aether start` (see the root README) runs this server detached with
`HOST=127.0.0.1`, `NODE_ENV=production`, `AETHER_LOCAL_AI=on`, the Host and
Origin allowlists, the session secret, the instance id and a rotating log
file in the user's state folder. Nothing extra is needed.

Publishing from the local app (`/api/local/publish/*`, see
`docs/CONTRACTS.md`): game builds are stored immutably under
`DATA_DIR/published/` and played at `/published/<id>/`; deploys run the
user's own `netlify`, `vercel`, `gh` or `butler` (argument arrays, no
secrets in their environment, per-step timeouts, cancellable); "Share on
local network" opens a second, read-only listener on all interfaces for one
build behind a random token, off by default and stopped after two hours.
With `--origin`, a paired hosted studio reaches the same services through
the bridge (`/v1/publish/*`).

## Deploying

The root `Dockerfile` runs this server and serves the studio from a single container
(see [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for Vercel, Docker, Fly.io and Render):

```
docker build -t aether .
docker run --rm -p 127.0.0.1:8787:8787 -v aether-data:/data aether
```

- **Fly.io**: `fly.toml` at the repository root (one always-on machine, `/api/health` check, volume at `/data`, `TRUST_PROXY_HOPS=1`).
- **Render**: `render.yaml` at the repository root (Docker web service, health check path `/api/health`, `TRUST_PROXY_HOPS=1`).
- **Docker Compose**: `docker-compose.yml` (loopback port, read-only root file system, resource limits, restart policy).
- The studio is served from the same origin, so `ALLOWED_ORIGINS` only matters for other origins, such as a separately hosted studio.
- Keep `AETHER_DAILY_TOKEN_BUDGET` set if you configure a key; by default the server needs none (offline planner).
- SIGTERM drains in-flight requests (10 s grace) and aborts upstream LLM calls; uncaught errors drain the same way with exit code 1.
- Static files are sent precompressed (`.br` / `.gz` written by `scripts/precompress.ts` in the image build); browser navigations to unknown paths get a 404 page, `/api/*` keeps JSON errors.

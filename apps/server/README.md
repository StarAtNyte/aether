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
| `src/static.ts` | studio hosting plus SPA fallback |

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

Errors always look like `{ error: <code>, message?, issues? }`. Stack traces are never returned.

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
| `PORT` / `HOST` | `8787` / `0.0.0.0` |
| `NODE_ENV` | `development` (`production` turns on static serving and HSTS) |
| `AETHER_PROVIDER` | `anthropic` (`openai`, `mock`). Falls back to the other provider if only its key is set. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | none |
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
| `AETHER_MAX_WORLDS` / `AETHER_MAX_GENERATORS` | `10000` / `5000` |
| `RATE_LIMIT_GENERATOR_PUT_PER_MIN` / `RATE_LIMIT_GENERATOR_PUT_BURST` | `10` / `5` |
| `AETHER_VALIDATE_GENERATORS` / `AETHER_GENERATOR_TIMEOUT_MS` / `AETHER_GENERATOR_MAX_QUEUE` | `false` / `1000` / `8` |
| `LOG_LEVEL` | `info` |

## Deploying

The image runs the server and serves the studio from a single container:

```
docker build -f apps/server/Dockerfile -t aether .
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=… -e TRUST_PROXY_HOPS=0 -v aether-data:/data aether
```

- **Fly.io**: run `fly launch --dockerfile apps/server/Dockerfile` and set `internal_port = 8787`. Then run `fly secrets set ANTHROPIC_API_KEY=…` and set `TRUST_PROXY_HOPS=1`. Mount a volume at `/data`. Health check: `GET /api/health`.
- **Render** and **Railway**: create a Docker service from the repo with Dockerfile path `apps/server/Dockerfile`, set the env vars above (`TRUST_PROXY_HOPS=1`), and attach a disk at `/data`. Health check path: `/api/health`.
- The studio is served from the same origin, so `ALLOWED_ORIGINS` only matters for other origins, such as a separately hosted studio.
- Keep `AETHER_DAILY_TOKEN_BUDGET` set on public deployments.
- SIGTERM drains in-flight requests (10 s grace) and aborts upstream LLM calls.

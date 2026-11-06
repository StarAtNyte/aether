# Deploying Aether

Aether ships in two shapes:

| Shape | What it is | Who pays for AI |
| --- | --- | --- |
| **Static hosted copy** (recommended public address) | `apps/studio/dist` on a static host (`vercel.json`). No server, no `/api`. Offline planner, templates, the generator library, on-device WebLLM, bring-your-own-key and the visitor's own Codex / Claude Code through the local bridge. | Nobody but the visitor: their own key, their own login, or nothing (offline). Hosting is free-tier static. |
| **Local app** (`npx aether start`) | The Node server plus the studio on the user's own computer, with local AI, deep builds and publishing. | The user's own Codex / Claude Code login or key. |
| **Self-hosted container** (optional) | The same server in Docker (`Dockerfile`, `docker-compose.yml`, `fly.toml`, `render.yaml`) for a team or a private machine. | Whoever sets a key on it (off by default: offline planner). |

The container never runs anyone's Codex or Claude Code login: the image sets
`AETHER_HOSTED=1`, which makes the server refuse local AI. **Never expose a
server with `AETHER_PROVIDER=codex|claude-code` or an owner-paid key to the
public internet**: every visitor would spend that account.

---

## 1. Static hosted copy (Vercel)

`vercel.json` is complete; import the repository in Vercel and deploy. It:

- installs with `npm ci`, builds with `npm run build -w @aether/studio` and
  publishes `apps/studio/dist`;
- sends the strict Content-Security-Policy (identical to the server's; a unit
  test compares them), with `connect-src` limited to `'self'`, the
  visitor's loopback bridge (`http://127.0.0.1:*`, `http://localhost:*`), the
  four bring-your-own-key model APIs and the WebLLM download hosts;
- gives the generator sandbox, verification and geometry workers and the KTX2
  transcoder worker (`/basis/ktx2-worker.js`) their own
  tighter policies, and the `/play` player an embeddable one;
- serves the Basis Universal transcoder from `/basis/` (three's files, copied
  into `apps/studio/public/basis/`) and the KTX2 twins of the library from
  `/assets/lib/k/` (see [ASSETS.md](ASSETS.md#gpu-compressed-textures-ktx2));
- caches `/assets/*` (content-hashed, including the asset library) and
  `/fonts/*` for a year, everything else is revalidated;
- serves `404.html` for unknown paths (the studio routes with the URL hash,
  so `/` is its only page) and maps `/play` to the player.

Build-time variables (Vercel → Settings → Environment Variables):

| Variable | Purpose |
| --- | --- |
| `VITE_AETHER_SITE_URL` | Public https origin (e.g. `https://aether.example.com`) used to make the link-preview image and URL absolute. Optional on Vercel: `VERCEL_PROJECT_PRODUCTION_URL` is used automatically. |
| `VITE_AETHER_PLAYER_URL` | Where share links of published games open (defaults to this deployment's `/play`). |
| `VITE_AETHER_HOSTED` | `1` forces the hosted first-run screen (detected automatically on a static host). |

Never put a model key in a `VITE_*` variable: everything `VITE_*` ends up in
the public bundle. The hosted copy needs no secret at all.

Size: the build is about 160 MB in some 1,400 files (the asset library with its
KTX2 twins is most of it), the largest single file under 7 MB. Vercel sets no
limit on build output size for Git deployments and flags only files over
100 MB; the 100 MB limit applies to source uploads with the `vercel` CLI on the
Hobby plan, which this repository (docs screenshots included) exceeds anyway,
so deploy through the Git integration.

Reproduce the Vercel setup locally (same files, same headers and rewrites,
no `/api`) with `npm run build && npm run e2e:hosted` (Chromium and Firefox).

## 2. Local app (one command)

```bash
npx aether start            # or: npm ci && npm run aether:start
```

It builds the studio when needed, starts the server detached on
`127.0.0.1` (port 4280 or the next free one) with the Host / Origin allowlists, a per-install session
secret and a rotating log, and opens the browser. `aether stop` drains it.
`npm run e2e:cli` exercises this flow end to end (Chromium and Firefox).

### Blender (optional, local only)

The local app can drive your own Blender through the MIT-licensed MCP for Blender server: scene info,
viewport pictures, Python, a "Blender asset" export into the project, Cycles render and Cycles bake. It is
off by default, served only under `/api/local/blender/*` (loopback, session secret; never the paired bridge
of a hosted studio), and every action that runs Python shows its exact code for "Allow once", "Allow for
this session" or "Cancel".

1. Install Blender 4.2+ (on PATH, in `~/tools/blender-*`, or set `AETHER_BLENDER`) and uv (`uvx`).
2. Install the add-on: `pip download --no-deps --no-binary :all: mcp-for-blender==2.2.7`, unpack it, take `addon.py`, install it in Blender
   (Preferences → Add-ons → Install from disk), or copy it to `<user scripts>/addons/mcp_for_blender.py`.
3. `blender -b --factory-startup --python scripts/blender/mcp-addon-setup.py` enables it, binds `127.0.0.1` and turns telemetry off.
4. Start Blender: the GUI with the add-on's server started from its sidebar, or headless with
   `blender -b --python scripts/blender/mcp-serve-headless.py` (listens on `127.0.0.1:9876`).
5. In the studio: Settings → AI connection → Blender, flip the switch. The status reads Ready, the
   assistant gets the Blender tools, and Assets → Imports shows Blender asset, Cycles render and Cycles bake.

## 3. Self-hosted container (optional)

```bash
docker build -t aether .
docker run --rm -p 127.0.0.1:8787:8787 -v aether-data:/data aether
# or
docker compose up -d --build
```

The image (`Dockerfile`, multi-stage on `node:24-bookworm-slim`):

- **build** stage: `npm ci`, studio build, then `scripts/precompress.ts`
  writes Brotli (`.br`) and gzip (`.gz`) siblings so the server sends
  compressed files without spending CPU per request (about 74 MB → 39 MB
  Brotli for the full build before the KTX2 twins; the build is about 160 MB
  with them, of which 67 MB are the twins and 7 MB the KTX2 block sheets,
  already Zstandard / Basis-compressed);
- **deps** stage: production dependencies only (`npm ci --omit=dev`), minus
  the Codex CLI binaries (local AI is off in the image);
- **runtime**: runs as the unprivileged `node` user, `HEALTHCHECK` on
  `/api/health`, exec-form `CMD` so `SIGTERM` reaches Node for a graceful
  drain, `NODE_OPTIONS=--max-old-space-size=384` so it fits a 512 MB machine,
  data on the `/data` volume.

`docker-compose.yml` adds a read-only root file system, `no-new-privileges`,
all capabilities dropped, memory / CPU / PID limits, log rotation and
`restart: unless-stopped`, and publishes the port on loopback only. Put a TLS
reverse proxy in front for other machines and set `TRUST_PROXY_HOPS=1`.

### Fly.io

```bash
fly launch --no-deploy --copy-config    # choose your own app name
fly volumes create aether_data --size 1
fly deploy
```

`fly.toml` keeps one machine always running (`auto_stop_machines = "off"`,
`min_machines_running = 1`), forces HTTPS, health-checks `/api/health` every
15 s, trusts exactly one proxy hop and drains on `SIGTERM` within 15 s.

### Render

Create a Blueprint from the repository (`render.yaml`): a Docker web service
with `healthCheckPath: /api/health` and `TRUST_PROXY_HOPS=1`. The free plan
sleeps after 15 idle minutes and has no persistent disk; choose a paid
instance for an always-on copy (or use the static site, which never sleeps).

### Testing a running container

Every e2e suite can target an existing deployment instead of starting its
own server:

```bash
BASE_URL=http://127.0.0.1:8787 npm run e2e      # or AETHER_E2E_URL=…
```

## 4. Environment variable reference

Server variables (container, Fly, Render, `npm run start`). The complete list
with every limit is in [`apps/server/README.md`](../apps/server/README.md#configuration).

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | The image sets `HOST=0.0.0.0`. Render injects `PORT`. |
| `NODE_ENV` | `development` | `production` (set in the image) turns on static serving and HSTS. |
| `AETHER_HOSTED` | unset | `1` (set in the image) marks a hosted server: local AI is refused. Fly, Render, Vercel, Railway, Cloud Run, Heroku and Kubernetes are detected automatically. |
| `AETHER_LOCAL_AI` | `auto` | `off` in the image. Never `on` on a public server. |
| `AETHER_PROVIDER` | `mock` | Offline planner. `anthropic` / `openai` only with your own key, budget and rate limits. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | none | Secrets: set with `fly secrets set`, Render's secret env vars or a `.env` that is never committed. Never logged or returned. |
| `AETHER_DAILY_TOKEN_BUDGET` | `2000000` | Hard daily cap across all clients (UTC); the studio falls back to the offline planner when it is spent. |
| `RATE_LIMIT_LLM_PER_MIN` / `RATE_LIMIT_LLM_BURST` | `20` / `5` | Per client IP. |
| `RATE_LIMIT_API_PER_MIN` / `RATE_LIMIT_API_BURST` | `120` / `60` | Per client IP; `/api/health` is exempt. |
| `TRUST_PROXY_HOPS` | `0` | `1` behind Fly, Render or one reverse proxy (client IPs for rate limiting). |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Extra origins allowed to call `/api` cross-origin. The same origin always works. |
| `DATA_DIR` | `apps/server/data` | `/data` in the image (shared world links, cached generators; bounded counts). |
| `LOG_LEVEL` | `info` | JSON lines on stdout: method, path, status, duration, request id. Never bodies, queries or keys. |

Build-time variables of the studio are listed in section 1.

## 5. Production behaviour of the server

- **Graceful shutdown.** `SIGTERM` / `SIGINT` stop accepting connections,
  abort upstream model calls, close idle keep-alive sockets and exit when
  in-flight requests finish (10 s hard limit). An uncaught exception or
  unhandled rejection is logged (scrubbed) and drains the same way with exit
  code 1, so the supervisor restarts a clean process.
- **Timeouts.** Keep-alive 65 s and header timeout 66 s (longer than proxy
  idle timeouts, so no 502 races on reused connections); a whole request
  must arrive within 120 s (slow-loris defence). Model calls time out after
  `AETHER_LLM_TIMEOUT_MS` (90 s).
- **Memory.** V8 heap capped at 384 MB in the image; caches are bounded
  (stored worlds and generators by count and size, rate-limit buckets by
  idle eviction, the generator validation worker by its own heap cap).
- **Static files.** Precompressed Brotli / gzip with `Vary: Accept-Encoding`
  (identity bytes for range requests), immutable caching for hashed assets
  and fonts, `no-cache` for everything else.
- **Error pages.** Browser navigations get a designed 404 / 500 page (no
  script, CSP-safe, follows light / dark); `/api/*` keeps JSON errors. The
  500 page never shows the error.
- **Sharing.** Open Graph / Twitter tags with a 1200×630 card (`og.jpg`),
  `robots.txt`, a web app manifest and home-screen icons
  (`npx tsx scripts/brand/render.ts` re-renders the card and icons).

## 6. Uptime and reliability checklist

Before announcing an address, and again after every deploy:

- [ ] **Static copy is the public link.** It has no server to fall over and
      costs nothing; the container is optional.
- [ ] **Health monitoring.** Point an external uptime monitor (UptimeRobot,
      Better Stack, Fly / Render built-ins) at:
      - static copy: `GET https://<host>/` expects 200 and the text `Aether`;
        also `GET https://<host>/og.jpg` (200);
      - container: `GET https://<host>/api/health` expects
        `{"ok":true,…}` every 1–5 minutes, alerting by email / push.
- [ ] **Keys.** Hosted static copy: none (verify the bundle with
      `grep -r "sk-" apps/studio/dist` → nothing). Container: none by default;
      if you add one, it is a secret (not a `VITE_*` variable), and
      `AETHER_DAILY_TOKEN_BUDGET` plus a spending limit at the provider are set.
- [ ] **Budget limits.** Provider dashboard monthly cap set below what you
      are willing to lose; `AETHER_DAILY_TOKEN_BUDGET` below it per day.
- [ ] **Rate limits.** Defaults (20 model calls / min / IP, burst 5) are on;
      `TRUST_PROXY_HOPS=1` behind a proxy so limits apply per visitor, not per proxy.
- [ ] **Fallback to offline.** With no key, an exhausted budget, a provider
      outage or a dead bridge the studio still builds worlds with the
      offline planner and the generator library. Check it once: open the
      site in a private window, choose *Offline*, build a template prompt.
- [ ] **Always on.** Fly: `min_machines_running = 1`, auto-stop off. Render:
      a paid instance (free sleeps). Vercel static: always on.
- [ ] **Both browser engines.** Open the address in Chromium (WebGPU) and
      Firefox (WebGL2) and on a phone; `npm run e2e` and `npm run e2e:hosted`
      cover the same paths automatically.
- [ ] **Release pinning.** Tag every deployed commit (`git tag deploy-YYYYMMDD`);
      roll back on Vercel with *Promote to Production* of the previous
      deployment, on Fly with `fly deploy --image <previous>`, on Render with
      *Rollback*.
- [ ] **Logs.** JSON lines on stdout; `fly logs`, Render logs or
      `docker compose logs -f aether`. 5xx responses are logged at `error`.
- [ ] **CI green.** `.github/workflows/ci.yml` runs typecheck, unit tests,
      build, smoke, the studio, hosted-copy and sandbox-security e2e suites
      in both browsers, a dependency audit and a container
      build + probe on every push and pull request.

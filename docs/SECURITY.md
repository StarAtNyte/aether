# Security model

Aether runs in two shapes, and the rules differ:

| | Local app (`aether start`) | Hosted static site |
| --- | --- | --- |
| Where it runs | Your computer, `http://127.0.0.1:<port>` | A static host (CDN), no Aether server |
| AI | Your own Codex / Claude Code login (CLI workers), your own API key, on-device model, offline planner | Your own API key (called straight from the browser), your own Codex / Claude Code through the local bridge, on-device model, offline planner |
| Whose account | Only the person sitting at the computer | Only the visitor's own key or own local login; never the site operator's |

The site operator's keys and subscriptions are never used for visitors. A
hosted copy has no server-side AI at all.

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
  SIGKILL after 3 s).
- The account and model are frozen into a job when it is queued; switching
  accounts is refused while jobs run.

### Process and files

- All subprocesses are spawned with argument arrays and `shell: false`.
  Windows `.cmd` shims run through `cmd.exe /d /s /c` with fixed arguments
  that are checked for shell metacharacters.
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

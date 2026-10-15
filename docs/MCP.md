# Aether as an MCP server

`aether mcp` exposes the Aether loop (describe, build, **prove**, look, ship)
to any agent that speaks the [Model Context Protocol](https://modelcontextprotocol.io):
Claude Code, Codex, editors, your own scripts. The agent drives Aether with
plain-language tools (`create_world`, `edit`) or exact ones (`apply_patch`,
`list_entities`), asks it to **prove the world works** (`verify` forks the
physics world headless and fast-forwards it; `playtest` lets a bot play the
game), looks at it (`render_still`, `replay`) and ships it (`export`).

It is a stdio server built on the official MIT-licensed TypeScript SDK
(`@modelcontextprotocol/sdk`, pinned to 1.32.1). It needs no browser, no GPU
and no network: with the built-in offline planner it works on a plane.

## Connect a client

Use the absolute path of your checkout. Run the server with `node`, **not**
`npm run`: npm prints a banner on stdout, which would corrupt the protocol.

### Claude Code

```bash
claude mcp add aether -- node /abs/path/to/aether/apps/cli/bin/aether.mjs mcp --project-dir /abs/path/to/my-world
```

or a project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "aether": {
      "command": "node",
      "args": ["/abs/path/to/aether/apps/cli/bin/aether.mjs", "mcp", "--project-dir", "/abs/path/to/my-world"]
    }
  }
}
```

### Codex

```bash
codex mcp add aether -- node /abs/path/to/aether/apps/cli/bin/aether.mjs mcp --project-dir /abs/path/to/my-world
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.aether]
command = "node"
args = ["/abs/path/to/aether/apps/cli/bin/aether.mjs", "mcp", "--project-dir", "/abs/path/to/my-world"]
startup_timeout_sec = 30
tool_timeout_sec = 300
```

### Any other client

Spawn `node apps/cli/bin/aether.mjs mcp` and speak MCP over its stdin and
stdout. Diagnostics go to stderr.

### Options

| Option | Meaning |
| --- | --- |
| `--project-dir DIR` (or `AETHER_PROJECT_DIR`) | The **only** folder the server reads and writes. Default `./aether-project`. The world is saved there and restored on the next start |
| `--provider auto\|offline\|local` | Who answers `create_world` and `edit`. `offline`: the built-in planner (no model). `local`: the Aether server on this computer (`aether start`) with your own Codex or Claude Code login. `auto` (default): `local` when that server runs and an account is signed in, otherwise `offline`; re-checked on every request, so logging in later just works |
| `--player-dir DIR` | The studio's production build used by `export build` (default: this checkout's `apps/studio/dist`, made by `aether start`) |
| `--state-dir DIR` | The `aether` state folder, to find a running local server |

## Tools

All tools take strict JSON objects (unknown keys are refused, sizes are
capped). Results are JSON text plus `structuredContent`.

| Tool | What it does |
| --- | --- |
| `create_world {prompt}` | New world from a description. Plans, builds with patches, verifies by fast-forwarding the physics, repairs what fails. The old world stays one `undo` away |
| `edit {prompt}` | Change the current world from a request; minimal patches, re-verified. One `undo` reverts the whole request |
| `apply_patch {patches, message?, atomic?}` | Exact World IR edits with no model. All-or-nothing by default; every failure is explained per patch. Read `aether://schema/patch` first |
| `list_entities {selector?, tag?, behavior?, text?, parent?, offset?, limit?}` | Compact rows (id, name, shape, position, behaviors, body; wall pieces add `wall`), paged |
| `get_entity {id}` | One entity in full, as `apply_patch` would write it. A wall piece (picture, curtain, mirror, TV, switch) also carries `wall` (wall id, compass side, room, offset along the wall, width, heights) and `placementProblems` (what it overlaps, with a fix) |
| `get_world_summary {}` | The planner's text summary (for each building: every wall face with its doors, windows and wall pieces, and any placement problem with a fix) plus counts and the active provider |
| `verify {}` | Run `world.tests` and diagnostics (physics as unit tests): stability, `reaches`, `eventually`, navigable buildings, floating or overlapping objects |
| `playtest {seconds?, goal?}` | A bot plays: walks, jumps, rides lifts, drives, toward pickups, rule zones, goals and checkpoints with real physics and logic. Reports win / lose / incomplete, objectives reached and collected, the game state, messages and the path |
| `replay {}` | Fast-forward the physics and summarise every body that moves (start, end, path, peak, keyframes); the full motion goes to `replays/replay.json` |
| `render_still {width?, height?, yawDeg?, pitchDeg?, fovDeg?, from?, lookAt?, at?, name?}` | PNG still (inline image plus `renders/<name>.png`). `at` shows a moment of the last `replay` |
| `export {format, name?}` | `gltf`: binary glTF (`exports/<name>.glb`). `build`: standalone static web game (`exports/<name>-web.zip`). `plan`: SVG floor plans per storey. `project`: the `.aether.json` the studio opens |
| `undo {}` / `redo {}` | One tool action per step |

### Resources

| URI | Content |
| --- | --- |
| `aether://world/current` | The whole World IR (JSON) |
| `aether://world/summary` | The compact text summary |
| `aether://schema/world`, `aether://schema/patch` | JSON Schemas for a world and for one patch |
| `aether://entity/{id}` | One entity |
| `aether://guide` | The authoring guide (loop, conventions, selectors) |

### A session

```text
create_world  "a coin collecting game: grab 8 coins before time runs out"
verify        -> passed, 3 tests, 5 s simulated in 20 ms
playtest      -> win in 18.8 s, {"score":8,"timeLeft":46}
edit          "make the coins gold and add a bell that rings on win"
render_still  -> renders/world.png
export        {"format":"build"} -> exports/world-web.zip
```

## What `render_still` is (and is not)

A deterministic software renderer: sun with shadow map, sky and fog, filmic
tone mapping, glass, 2x supersampling. It draws primitives, built-in and
model-written generators, buildings and scatter fields from the same
geometry kernel as the studio, so it is faithful for layout, scale, colour
and composition. It does not draw library models, sculpted meshes or the
studio's textures and global illumination (those entities are listed under
`skipped`); use the studio's render for the finished look.

## Safety model

The client is an LLM and is treated as untrusted.

- **Files.** Tools never take paths. Output names are reduced to `[a-z0-9._-]`
  and written under `exports/`, `renders/`, `replays/` or `.aether/` of the
  project folder. Each write re-checks the real path (symlinks resolved)
  against the real project root and refuses symbolic links. Writes are atomic
  (temporary file, rename, mode 0600). There is no tool that reads a file.
- **Network.** The server opens no connections, with one exception: in
  `local`/`auto` mode it calls `http://127.0.0.1:<port>/api/local/*` of the
  Aether server on this computer (found through the `aether` state folder,
  authenticated with the per-install secret, redirects refused). The fetch
  used for that is wrapped so any other URL throws.
- **Input.** Strict zod schemas; prompts at most 4,000 characters; at most 200
  patches and 512 KB of patch JSON per call; prototype-pollution keys, deep
  nesting and node bombs are rejected before validation; every patch is
  validated and limit-checked by the same code the studio uses.
- **Time.** Agent runs 5 min, verify, playtest, renders and exports 60 s each
  (and the client's own cancellation); the playtest plays at most 120 game
  seconds; images are 64 to 1920 px per side; exports at most 256 MB.
- **Errors.** Failures come back as `code: short message` (for example
  `invalid_patch: [1] update: no entity "ghost"`). Messages are scrubbed of
  absolute paths and control characters; unexpected errors become a generic
  "internal error" and the detail goes to stderr only.
- **Concurrency.** Changes run one at a time per connection, so two calls
  cannot interleave a half-finished edit.

## Develop and test

```bash
npx vitest run apps/cli/test/mcp.test.ts apps/cli/test/mcp-units.test.ts   # in-memory transport + units
npm run e2e:mcp                                                            # real client over stdio: build, verify, play, export
```

Code: `apps/cli/src/mcp/` (`server.ts` wiring, `tools.ts`, `resources.ts`,
`session.ts` state and operations, `playtest.ts`, `scene.ts` + `raster.ts` +
`png.ts` (stills), `gltf.ts`, `fsguard.ts`, `provider.ts`, `errors.ts`,
`limits.ts`).

# @aether/studio

Aether Studio is the browser editor and player (React 19, Vite 8, Zustand).
Describe a world in chat, watch the agent build and verify it, then edit it
by hand or press Play.

```bash
npm run dev          # from the repo root: http://localhost:5173 (proxies /api to :8787)
npm run build        # production bundle in apps/studio/dist (served by apps/server)
npx vitest run apps/studio
```

Without a running backend, or with a server in mock mode, the studio uses the
built-in offline mock agent and shows an "offline demo mode" badge.

## Layout

| Path | Role |
| --- | --- |
| `src/engine/Simulation.ts` | Owns the `WorldRenderer` and, in play mode, `PhysicsWorld`, `LogicRuntime` and the character controller. Fixed 60 Hz loop outside React, on-demand rendering in edit mode, exact restore on Stop, Rapier loaded lazily. |
| `src/engine/Studio.ts` | Controller called by the UI: history, persistence, import and export, share links, verification, agent streaming, safe-mode boot |
| `src/engine/AgentBridge.ts` | `AgentHost` implementation. Patches become History commits (`agent`), headless verification, generator dry-runs in the Worker sandbox, script compile checks, provider selection through `/api/health`. |
| `src/engine/headlessHost.ts` | `LogicHost` backed only by physics, used by verification and by `scripts/smoke.ts` |
| `src/engine/sound.ts` | Procedural WebAudio sound effects (no audio files) |
| `src/components`, `src/app` | Chat panel, viewport overlays, outliner, inspector, logic, verify and history panels, settings |
| `src/lib/examples.ts`, `src/showcase/manifest.ts` | The built-in templates (bundled default projects; the manifest curates them: 15 featured, the rest hidden but still reachable by link) |
| `src/engine/publish.ts`, `src/editor/publish/` | The Publish hub (game, video, render, 3D model, floor plan, share link, history) and the camera timeline |
| `src/publish/` | Share-link codec, QR encoder, camera paths and director, MP4 / WebM muxers, video export, music, title cards, floor-plan SVG / PDF, game builder, publish library, hosting client |
| `play.html`, `src/player/` | The standalone player of published games and share links (`/play#w=…`): no editor, no agent |

## Controls

- **Edit:** click to select, drag to orbit, edit in the inspector. Ctrl+Z undoes;
  Ctrl+Shift+Z or Ctrl+Y redoes.
- **Play:** WASD to move, Space to jump, Esc to stop. Stop restores the world
  exactly.
- **URL flags:** `?safe=1` or `?reset=1` boots the starter world (your last
  world stays one Undo away). `?debug=1` turns on verbose logs and
  `window.__aether`.

## Security

AI text is never rendered as HTML. Imported, stored and edited JSON is
size-limited, screened for prototype-pollution keys and schema-validated.
API keys never reach the browser: all LLM calls go through `/api/llm`.

## Processing feedback

The static boot screen shows a spinner before application scripts load. Renderer
startup, scene updates and mode switches yield a paint opportunity before starting
work. The viewport reports pending textures, shaders, lighting and captures,
with additional feedback for verification, playtests and terrain loading.
Background refinement stays quiet. Realtime rendering is the default; the Studio
button beside Daylight explicitly enables Studio rendering.
The transform animation supports reduced motion and does not depend on frame stats.

Run `node scripts/bench/processing-ui.mjs` from the repository root with
`AETHER_SMOKE_URL` pointing at the app to check startup paint ordering, scene and mode
feedback, compositor animation, toolbar clearance and reduced motion. This feedback
does not move rendering off the main thread.

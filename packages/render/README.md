# @aether/render

Aether's renderer, built on three.js r186. It prefers **WebGPU**
(`WebGPURenderer`) and falls back to **WebGL2** automatically. It mirrors a
`WorldDoc` incrementally and draws scatter with GPU instancing.

Public API: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md#aetherrender).

```ts
import { WorldRenderer } from '@aether/render';
import { createWorkerSandbox } from '@aether/procgen';

const renderer = await WorldRenderer.create(canvas, { sandbox: createWorkerSandbox() });
renderer.backend;                       // 'webgpu' | 'webgl2'
await renderer.setWorld(world);         // incremental: only changed entities are touched
renderer.applyTransforms(packed, order);  // zero-alloc pose sync from PhysicsWorld.writeTransforms
renderer.render(dt);
const png = await renderer.screenshot({ width: 768 });
```

## Features

- **Pipeline:** ACES tone mapping, sRGB, exposure from the environment, bloom
  through `RenderPipeline` (disabled automatically if it fails) and a capped
  pixel ratio.
- **`SceneSync`:** diff-driven add, remove and update; parent links;
  templates skipped; reference-counted geometry and material caches keyed by
  stable JSON; placeholders while generators run; stale results discarded;
  old resources released only after new content is mounted.
- **Scatter:** `InstancedMesh` with one shared matrix buffer. Placement is
  identical to `@aether/physics` (this is tested). `onSurface` projects onto
  terrain. Device budgets apply (150k instances or 12M triangles by default),
  and layers over 2000 instances cast no shadows.
- **Environment:** a sky dome for each preset with sun or moon and stars, sun
  direction and colour from `timeOfDay`, fog, ground, a shadow camera fitted
  to the scene, and instanced weather (rain, snow, dust, fireflies).
- **Cameras and tools:** orbit, follow and first-person cameras; `focus`
  fly-to; a capsule avatar; picking (including scatter layers); selection
  boxes; a ghost preview of proposed worlds; and debug overlays for
  colliders, bounds and diagnostics.
- **Capture:** `screenshot` and `renderViews` (top, front, side, iso) return
  JPEG data URLs.

## Conventions other packages rely on

- Point and spot light intensities are scaled ×20 to match three.js physical
  units.
- Spot and directional lights point along local −Y.
- Loaded models are centred and rest on y = 0. Model URLs must pass
  `isAllowedModelUrl` from `@aether/core`.
- `setWorld` does not wait for glTF downloads; `SceneSync.whenIdle()` does.
- Call `clearRuntimeOverrides()` when play stops.

## Tests

```bash
npx vitest run packages/render
```

The unit tests cover every GPU-free module. The GPU path is exercised by the
browser e2e run (`npm run e2e`) on both WebGPU and WebGL2.

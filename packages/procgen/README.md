# @aether/procgen

Deterministic procedural geometry for Aether. It produces plain typed arrays
(`MeshPart`s and `ColliderDesc`s) with **no three.js dependency**, so the same
generators feed the renderer, headless physics and the server. It also hosts
the **sandbox** for generators written by an LLM.

Public API: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md#aetherprocgen).

```ts
import { generateBuiltinSync, generate, createWorkerSandbox, catalog } from '@aether/procgen';

const tree = generateBuiltinSync('tree-oak', { height: 6 }, 42);   // { parts, colliders, bounds, stats }

// Custom (LLM-written) generators from world.generators only run through a sandbox:
const sandbox = createWorkerSandbox({ timeoutMs: 1500 });
const out = await generate({ kind: 'procedural', generator: 'my-arch', params: {}, seed: 1 }, world, { sandbox });
```

Node-only entry (tests and optional server validation):

```ts
import { createNodeSandbox } from '@aether/procgen/node';   // node:vm; NOT a security boundary
```

## Contents

- **Kernel** (`src/kernel`): box, sphere, cylinder, cone, torus, capsule,
  plane, lathe, extrude (ear clipping), tube (parallel-transport frames),
  heightfield and icosphere rock. Normals are correct under non-uniform scale
  and mirroring, displacement is seam-aware, and every call has a vertex
  budget.
- **Noise:** seeded simplex `noise2`, `noise3`, `fbm2` and `ridged2`.
- **35 built-in generators** (`src/generators`):
  - nature: tree-pine, tree-oak, tree-palm, bush, rock, grass-tuft, flowers,
    mushroom
  - architecture: house, tower, wall, fence, bridge, stairs, arch, ramp,
    windmill
  - props: lamp-post, bench, table, chair, crate, barrel, campfire, tent,
    dock, statue
  - vehicles: car, boat
  - terrain: terrain, island, mountain
  - fx: crystal, cloud, portal

  Each has typed params, 2 to 4 variants, several materials and colliders.
- **`GeneratorApi`:** the small typed surface given to both built-in and LLM
  generators. `GENERATOR_API_DTS` is its `.d.ts` text for the prompt, and
  `GENERATOR_EXAMPLES` are few-shot examples that are verified in tests.
- **Output:** `build()` places the base on y = 0 and centres x and z.
  `primitiveOutput` keeps primitives centred. `validateOutput` checks shape,
  NaN and size caps. `fallbackOutput` is a visible placeholder.
- **Cache:** an LRU `GeneratorCache` keyed by id, stable params, seed and
  source hash, with in-flight dedupe in `generate`.

## Heightfield layout

Heights are normalised to [0, 1] and stored X-major:
`heights[ix * (rows + 1) + iz]`. Rows are cells along Z, columns are cells
along X, and `size = [width, maxHeight, depth]`, centred in x and z. This is
Rapier's native layout, so it can be passed straight to
`ColliderDesc.heightfield`.

## Sandbox layers (browser)

1. `staticCheckSource` rejects `import`, `require`, `fetch`, `eval`,
   `Function`, `globalThis`, `postMessage` and similar tokens, even inside
   comments and strings.
2. A Web Worker pool, so the code never runs on the UI thread.
3. Lockdown inside the worker: shadowed globals, neutralised constructors,
   frozen intrinsics, no network.
4. A watchdog that terminates and restarts a worker on timeout.
5. Output re-validated on the main thread.

## Tests

```bash
npx vitest run packages/procgen
```

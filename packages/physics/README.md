# @aether/physics

Aether's physics layer, built on [Rapier](https://rapier.rs)
(`@dimforge/rapier3d-compat` 0.21.0, Apache-2.0). It is headless-capable, so
the same code runs in the browser, in Node tests and in the verification
loop. Beyond simulation, it lets the AI **prove** a world works: `verify`,
`diagnose` and `settle`.

Public API: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md#aetherphysics).

```ts
import { initPhysics, PhysicsWorld, verify, diagnose, settle, summarizeReport } from '@aether/physics';

await initPhysics();
const report = await verify(world, { logic: myLogicHookFactory, budgetMs: 2500 });
console.info(summarizeReport(report));   // compact text for the LLM repair turn

const pw = await PhysicsWorld.create(world);
const events = pw.step(1 / 60);
const branch = await pw.fork();          // exact copy of the running simulation
```

## Features

- **Bodies and colliders from the World IR.** `auto` gives exact primitive
  shapes. A torus becomes 12 convex segments and a plane a thin box.
  Unrepresentable non-uniform scales fall back to a hull. Procedural shapes
  use a `ColliderProvider` or run built-in generators headlessly. Scatter
  gets per-instance colliders (up to 2000) placed exactly where the renderer
  draws them. Provider output is validated and capped.
- **Joints:** fixed, revolute, prismatic and spherical, with limits and
  motors. Use `target: 'world'` to pin to the world. Invalid joints become
  `jointInvalid` diagnostics instead of crashing.
- **Stepping:** a fixed 1/60 s accumulator with at most 5 substeps and
  per-pair de-duplicated events. Ground contacts are reported as `GROUND_ID`
  (`'__ground'`).
- **Incremental `sync`:** a body is rebuilt only when its physical definition
  changes. Moves teleport and colour edits are ignored.
- **`snapshot` / `restore` / `fork`:** restore is size-checked,
  pollution-screened and zod-validated.
- **`CharacterController`:** a kinematic capsule. Its `position` is the feet
  point, and it handles slopes and step height.
- **`diagnose`:** overlaps, floating bodies, out of bounds, too many bodies
  and joint problems, each with a concrete fix.
- **`settle`:** drop and freeze, writing rest poses back as `update` patches.
- **`verify`:** runs all 9 `WorldTest` kinds on a fresh headless world with
  logic attached, within a compute budget. It yields every 8 ms so a UI
  thread stays responsive. Error-level diagnostics fail verification.

## Notes

- Default density comes from the material preset (wood 0.6, stone 2.4,
  metal 4 and so on). An explicit `mass` or `density` wins.
- `explode` applies a velocity change that falls off linearly with distance,
  so it does not depend on mass.
- The ground is built from tiles of at most 100 m, which avoids a precision
  sink in Rapier's snap-to-ground on very large boxes.

## Tests

```bash
npx vitest run packages/physics
```

The tests include benchmarks: 30 dominoes at 0.4 m spacing topple while
1.2 m spacing fails with a clear message; 1000 dynamic boxes average about
2.3 ms per step; fork stays exact after N steps; and the verify budget is
respected.

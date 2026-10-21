# @aether/logic

Aether's deterministic gameplay runtime. It runs WHEN/IF/THEN **rules**, 26
built-in **behaviours** and sandboxed custom **scripts** (QuickJS compiled
to WASM). It talks to the world only through the `LogicHost` interface, which
the studio implements with physics and render, the verifier implements
headless, and tests implement with fakes.

Public API: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md#aetherlogic).

```ts
import { LogicRuntime, EMPTY_INPUT, initScripting, createScriptRunner } from '@aether/logic';

await initScripting();                       // load QuickJS once (async)
const scripts = createScriptRunner();        // caller owns it; dispose() it yourself
const logic = new LogicRuntime(world, host, { scripts, seed: world.seed });
logic.start();
// every fixed step, after physics:
logic.tick(1 / 60, EMPTY_INPUT, physicsEvents);
logic.readState('score');
logic.log;                                   // "rule 'coin-pickup' fired: … → score 2→3"
```

## Rules

- **11 triggers:** start, tick, timer, collision, enter, exit, key, click,
  state, event, fallBelow.
- **17 actions:** set, add, spawn, destroy, impulse, setVelocity, teleport,
  setProperty, enableBehavior, explode, setGravity, emit, message, sound,
  win, lose, reset.
- Supports `once` and `enabled` flags and `if` conditions. `enter` and `exit`
  use sensor contacts or a containment fallback. `key` fires on press and
  accepts names like `e`, `KeyE` or `Space`.
- Safety rails: at most 64 firings per tick, emit depth 8, 256 queued events,
  and caps on spawns and zone checks. Unsafe property paths are rejected.
  `tick` never throws; failures go to `log`.

## Characters

`entity.npc` (see `docs/CONTRACTS.md`, "Intelligent characters") adds a
perceiving, navigating, talking character to any entity. The runtime lives in
`src/npc/`: `nav.ts` (grid, A*, line of sight), `obstacles.ts` (grids from the
document), `graph.ts` (archetype graphs and conditions), `brain.ts` (one NPC),
`system.ts` (all NPCs, noise, bubbles, the conversation), `dialogue.ts`
(trees) and `analyze.ts` (static checks used by the `npcs` verification test).

```ts
logic.npcs.prompt;               // { npc, name } when a character is in reach (E talks)
logic.npcs.dialogue;             // the running conversation, or null
logic.npcs.choose(0);            // pointer / touch route to the number keys
logic.npcs.damage('guard-1', 30);
```

## Behaviours

`BEHAVIOR_CATALOG` documents all 28 behaviours with params and requirements,
and the agent's prompt is generated from it:

spin, bob, orbit, patrol, follow, lookAt, wander, flee, collectible, door,
pressurePlate, spawner, lifetime, explosive, playerController, vehicle, npc,
pulseLight, conveyor, buoyancy, windZone, checkpoint, goal, hazard, launcher,
magnet, operable and toggle.

Moving behaviours on kinematic entities compose into one pose per tick.
Dynamic bodies are steered with velocities.

## Script sandbox

- QuickJS (WASM) with **no host functions**. Data crosses only as JSON.
- `Date`, `Promise`, `Proxy` and `RegExp` are removed, `eval` and `Function`
  throw, and `Math.random` is seeded.
- Each script has its own interpreter: 8 MB memory by default, 128 KB stack
  (capped at 256 KB), and a 128 MB shared heap budget.
- The call budget is 2 ms. A script is disabled after 3 overruns or 10
  errors. At most 24 script calls run per tick (round robin).
- At most 32 intents per call, validated twice (runner and runtime).
- `SCRIPT_API_DTS` describes the script context for the coder model.

## Determinism

Same world, seed, inputs and events give an identical log, state and host
calls (this is tested). The one exception is a script cut off by its
wall-clock budget.

## Tests

```bash
npx vitest run packages/logic
```

# @aether/core

The foundation shared by every Aether package. It holds the **World IR**
(zod schemas), pure patching with undo inverses, diffing, history with
branches, selectors and queries, deterministic utilities, and the compact
world summaries sent to the LLM. It has no DOM and no three.js dependency.

The schema in [`src/schema.ts`](src/schema.ts) is authoritative; the public
API is pinned in [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md#aethercore).

```ts
import { createWorld, applyPatches, History, diffWorlds, summarizeWorld } from '@aether/core';

const world = createWorld({ name: 'Demo' });
const { world: next, errors } = applyPatches(world, [
  { op: 'add', entity: { id: 'ball', shape: { kind: 'primitive', primitive: 'sphere' },
    transform: { position: [0, 3, 0] }, physics: { body: 'dynamic', restitution: 0.8 } } },
  { op: 'addTest', test: { id: 'ball-lands', kind: 'staysAbove', target: 'ball', y: -1 } },
]);
// errors: [{ index, op, message }] written for the LLM; nothing is thrown.

const history = new History(world);
history.commit([{ op: 'setEnvironment', set: { sky: 'sunset' } }], 'Sunset', 'user');
history.undo();
diffWorlds(world, next);         // { added: ['ball'], changed: [], ... }
summarizeWorld(next);            // deterministic, token-efficient text
```

## Modules

| Module | Contents |
| --- | --- |
| `schema.ts` | `WorldDoc`, `Entity`, `Patch`, `Rule`, `WorldTest` and every other zod schema and type |
| `patch/` | `applyPatches` (draft, apply, deferred forward references), `invertPatches`, `patchesBetween` |
| `validate.ts`, `refs.ts`, `issues.ts` | `createWorld`, `validateWorld`, `checkIntegrity`, referential checks, LLM-readable issues with "did you mean" hints |
| `guard.ts`, `limits.ts`, `urls.ts` | Prototype-pollution and size screening of untrusted input, `LIMITS`, the model URL allowlist |
| `diff.ts`, `merge.ts`, `json.ts` | `diffWorlds`, deep merge, `stableStringify`, `deepEqual` |
| `history.ts` | `History`: commit, undo and redo, checkout, branches, pruning, `toJSON` / `fromJSON` |
| `query.ts` | `resolveSelector`, `childrenOf`, `worldTransform`, `readStateKey`, `compare` |
| `random.ts`, `math.ts`, `ids.ts` | `rng` (sfc32), `hashString` (FNV-1a), Euler and quaternion conversion (three.js `XYZ`), `slugify`, `uniqueId` |
| `summary.ts`, `emitter.ts` | `summarizeWorld`, typed `Emitter` |

## Guarantees

- `applyPatches` is pure and never throws. Untouched entities keep object
  identity, and a no-op batch returns the same world object.
- Keys such as `__proto__`, `constructor` and `prototype` are rejected at any
  depth, and input depth, node count and string length are capped.
- Unknown patch fields are rejected with a hint, not silently dropped.
- `invertPatches` is exact for every op. This is covered by scenario tests and
  a seeded random-sequence test.

## Tests

```bash
npx vitest run packages/core
```

# @aether/agent

Aether's provider-agnostic LLM orchestration. `WorldAgent` runs the
**plan → patch → verify → repair** loop against any `AgentHost`. It works in
the browser (through the server proxy) and in Node.

Public API: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md#aetheragent).

```ts
import { WorldAgent, createHttpProvider, createMockProvider } from '@aether/agent';

const agent = new WorldAgent({ provider: createHttpProvider({ endpoint: '/api/llm' }), catalogs, maxRepairs: 2 });
for await (const ev of agent.run('Build a domino run that knocks over a bell tower', host, { signal })) {
  // status | plan | patches | generator | verify | repair | message | error | done
}
```

## Loop

- An async generator that **never throws**. Failures become `error` events,
  and the stream always ends with exactly one `done` event carrying usage.
- Tools (`AGENT_TOOLS`): `apply_patches`, `build_architecture`,
  `design_plan`, `place_items`, `edit_items`, `query_scene`,
  `write_generator`, `write_script`, `request_asset` (which hands the job to
  the coder model), `search_assets`, `inspect`, `run_verification`,
  `shape_land` and `finish`; level passes use `LEVEL_TOOLS` and small edits
  `COMPACT_TOOLS`. Each has a hand-written JSON Schema plus a zod validator.
  Results list each rejected patch by index and reason.
- When the model finishes after making edits, verification runs
  automatically. Failures produce a repair turn, bounded by `maxRepairs`,
  `maxTurns` and a tool-call budget. An `AbortSignal` stops the loop
  promptly, even mid-call.
- Inputs (prompt, up to 4 images, history) are size-checked. The world
  summary and the request are wrapped in tags, and any copy of those tags
  inside untrusted text is neutralised.
- The system prompt (about 11k tokens) is generated from the live catalogs
  and is byte-stable, so prompt caching works.

## Providers

| Factory | Notes |
| --- | --- |
| `createAnthropicProvider` | Server only. Raw `fetch` to the Messages API, cache breakpoints, per-role effort, thinking blocks carried across turns. |
| `createOpenAIProvider` | Server only. Raw `fetch` to the Responses API, `store: false`, reasoning items carried across turns. |
| `createHttpProvider` | Browser to `/api/llm`. Never sends a model id, and validates replies with zod. |
| `createMockProvider` | Deterministic offline planner: 21 themes, mood combinations and edit commands. It is the offline fallback and is used in tests. |

The networked providers retry 429, 5xx, 529 and network errors up to 3 times
with backoff and jitter, honour `retry-after`, use a timeout per attempt and
cap response size. Wire schemas (`CompletionRequestSchema`,
`CompletionResponseSchema`, `WIRE_LIMITS`) are exported for the server.

## Tests

```bash
npx vitest run packages/agent
```

No test makes a network call: the providers are tested against a fake
`fetch`. An integration test runs real physics and logic verification on
every mock theme.

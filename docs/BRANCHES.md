# Branches

`main` is the only maintained branch. Everything else on the remote is history kept for reference. None of it is merged,
and none of it is expected to build against current `main`.

| Branch | What it is |
| --- | --- |
| `wip/*` (`aa`, `bake`, `lib`, `realism-before`, `realism4`, `realism4-a`, `realism4-b`, `realism4-c`, `sharp`, `venue2`) | Archived uncommitted work from parallel agent worktrees, saved as one commit each on 2026-10-26 so nothing was lost. Experiments in anti-aliasing, lightmap baking, library additions, realism passes, sharpening and venue parts. The parts that proved out were re-done on `main` as small commits. |
| `fix-decor-anchoring` | An early checkpoint (2026-10-15) of the decor anchoring work, three commits ahead of the then-`main`. The change shipped on `main` afterwards. |
| `wip-photoreal` | The start of the photoreal stage (2026-10-15): the first e2e shots harness. Superseded by `tests/e2e/photoreal.e2e.ts` on `main`. |
| `worktree-wf_*-1` to `-4` | Branches from four parallel workflow agents (2026-10-16), for example the WebGPU path audit that became [WEBGPU.md](WEBGPU.md). Superseded by `main`. |

To look at one: `git fetch origin && git log origin/wip/bake`. To reuse a piece, cherry-pick it onto a fresh branch from
`main`. Do not merge these branches wholesale.

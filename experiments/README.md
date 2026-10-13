# Experiments

Small, measurable prototypes behind the renderer's scale-geometry work.
Each folder has a README with hypothesis, method, numbers and verdict;
`docs/RESEARCH_LOG.md` summarises them. Benchmarks run in Node with `tsx`
(keep the machine responsive: `nice -n 15`):

| Folder | Run | Verdict |
| --- | --- | --- |
| [`virtual-geometry`](virtual-geometry) | `npx tsx experiments/virtual-geometry/bench.ts 6 7` | shipped (`packages/render/src/virtual`) |
| [`scatter-field`](scatter-field) | `npx tsx experiments/scatter-field/bench.ts 1000000` | shipped |
| [`voxel-meshing`](voxel-meshing) | `npx tsx experiments/voxel-meshing/bench.ts` | algorithm wins, not integrated |
| [`gaussian-splats`](gaussian-splats) | desk evaluation | not integrated |

The in-browser measurement of the shipped work is `npm run e2e:benchmark`
(`tests/e2e/benchmark.e2e.ts`). `lib/meshes.ts` holds the shared test meshes.

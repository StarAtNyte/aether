import { probeAllocations, describeSites } from '../tests/unit/alloc-probe';
import { createBody, moveBody, type SolidQuery } from '../packages/voxel/src/collide';
const q: SolidQuery = { isSolid: (_x, y) => y < 10, isLiquid: () => false };
const b = createBody(0.5, 10.5, 0.5, 0.3, 1.8);
let t = 0;
const r = await probeAllocations(() => { t += 0.01; b.vx = Math.sin(t) * 4; b.vz = Math.cos(t) * 4; b.vy -= 0.5; moveBody(q, b, 1 / 60, true); }, { iterations: 600, warmup: 4000, match: /voxel\/src/ });
console.log('simple query', r.bytesPerIteration.toFixed(1), describeSites(r));

/**
 * Scatter fields — CPU-side measurements in Node.
 *
 * Run: nice -n 15 npx tsx experiments/scatter-field/bench.ts [instances]
 *
 * 1. LOD chains of the built-in vegetation/rock generators (triangles per level, build ms).
 * 2. Placement → packing → chunking cost for N instances, memory of packed vs matrix storage.
 * 3. Per-frame culler cost (classification only vs classification + rewrite) along a camera path,
 *    and drawn triangles against the naive "draw every instance at full detail" baseline.
 */
import { performance } from 'node:perf_hooks';
import { generateBuiltinSync } from '../../packages/procgen/src/generate';
import { buildLodChain } from '../../packages/render/src/virtual/lod-chain';
import { buildChunks, FieldCuller, packMatrices } from '../../packages/render/src/virtual/field-culler';
import { composeScatterMatrices, scatterPlacements } from '../../packages/render/src/geometry/scatter';
import { median } from '../lib/meshes';
const N = Number(process.argv[2] ?? 1_000_000);
console.log('LOD chains (triangles per level):');
for (const id of ['tree-pine', 'tree-oak', 'tree-palm', 'bush', 'rock', 'grass-tuft', 'flowers']) {
    const out = generateBuiltinSync(id, {}, 1);
    const t0 = performance.now();
    const chain = buildLodChain(out.parts);
    console.log(`  ${id.padEnd(11)} ${chain.map((l) => l.triangles).join(' > ').padEnd(28)} ${(performance.now() - t0).toFixed(1)} ms`);
}
const tree = generateBuiltinSync('tree-pine', {}, 1);
const chain = buildLodChain(tree.parts);
let radius = 0;
for (const p of tree.parts)
    for (let i = 0; i < p.positions.length; i += 3)
        radius = Math.max(radius, Math.hypot(p.positions[i], p.positions[i + 1], p.positions[i + 2]));
let t0 = performance.now();
const area = Math.sqrt(N) * 3;
const placements = scatterPlacements({ count: N, area: [area, area], seed: 7, scaleRange: [0.8, 1.3], randomYaw: true }, N);
const tPlace = performance.now() - t0;
t0 = performance.now();
const matrices = composeScatterMatrices(placements, 0);
const tCompose = performance.now() - t0;
t0 = performance.now();
const packed = packMatrices(matrices, placements.count);
const chunks = buildChunks(packed, placements.count, radius);
const tChunk = performance.now() - t0;
console.log(`\n${placements.count.toLocaleString()} instances over ${area.toFixed(0)} m²-side: place ${tPlace.toFixed(0)} ms, matrices ${tCompose.toFixed(0)} ms, pack+chunk ${tChunk.toFixed(0)} ms, ${chunks.chunkCount} chunks`);
console.log(`  storage: matrices ${(matrices.byteLength / 1048576).toFixed(1)} MB vs packed ${(chunks.data.byteLength / 1048576).toFixed(1)} MB`);
const pixelScale = 900 / (2 * Math.tan((50 * Math.PI) / 360));
const budget = 3_000_000;
const culler = new FieldCuller(chunks, { lodTriangles: chain.map((l) => l.triangles), radius, budgetTriangles: budget });
const capMB = culler.buffers.reduce((s, b) => s + b.byteLength, 0) / 1048576;
console.log(`  level capacities ${Array.from(culler.capacity).join(' / ')} instances (${capMB.toFixed(1)} MB of level buffers)`);
/** Frustum planes of a camera at (x, y, z) looking along yaw, 60° fov, aspect 16:9. */
function frustum(x, y, z, yaw) {
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const half = (60 * Math.PI) / 360;
    const hh = Math.atan(Math.tan(half) * 16 / 9);
    const planes = [];
    const add = (nx, ny, nz) => {
        const l = Math.hypot(nx, ny, nz);
        planes.push(nx / l, ny / l, nz / l, -(nx * x + ny * y + nz * z) / l);
    };
    // Left / right (rotate forward by ±(90° − hh)).
    for (const s of [1, -1]) {
        const a = s * (Math.PI / 2 - hh);
        add(fx * Math.cos(a) - fz * Math.sin(a), 0, fx * Math.sin(a) + fz * Math.cos(a));
    }
    // Top / bottom.
    add(fx * Math.sin(half), Math.cos(half), fz * Math.sin(half));
    add(fx * Math.sin(half), -Math.cos(half), fz * Math.sin(half));
    add(fx, 0, fz); // near (through the eye)
    return Float64Array.from(planes);
}
const classify = [];
const rewrite = [];
let tris = 0, inst = 0, rewrites = 0, uploaded = 0, fullUpload = 0;
for (let f = 0; f < 120; f++) {
    const yaw = f * 0.02;
    const view = { cx: Math.cos(f * 0.01) * 20, cy: 8, cz: Math.sin(f * 0.01) * 20, pixelScale, planes: frustum(Math.cos(f * 0.01) * 20, 8, Math.sin(f * 0.01) * 20, yaw) };
    const a = performance.now();
    const dirty = culler.update(view);
    const changed = dirty !== 0;
    for (let l = 0; l < culler.levels; l++) {
        if (!(dirty & (1 << l)))
            continue;
        uploaded += Math.max(0, culler.counts[l] - culler.dirtyFrom[l]) * 64;
        fullUpload += culler.counts[l] * 64;
    }
    const ms = performance.now() - a;
    (changed ? rewrite : classify).push(ms);
    if (changed)
        rewrites++;
    tris += culler.drawnTriangles;
    if (f === 60)
        console.log("  frame 60 per-level instances", Array.from(culler.counts).join(" / "), "visible chunks", culler.visibleChunks);
    inst += culler.drawnInstances;
}
const full = chain[0].triangles * placements.count;
console.log(`  update: ${median(classify).toFixed(2)} ms when unchanged, ${median(rewrite).toFixed(2)} ms with rewrite (${rewrites}/120 frames rewrote)`);
console.log(`  uploads: ${(uploaded / 120 / 1e6).toFixed(2)} MB/frame incremental vs ${(fullUpload / 120 / 1e6).toFixed(2)} MB/frame rewriting changed levels whole`);
console.log(`  drawn per frame: ${(inst / 120).toFixed(0)} instances, ${(tris / 120 / 1e6).toFixed(2)}M triangles vs ${(full / 1e6).toFixed(0)}M at full detail (${(full / (tris / 120)).toFixed(0)}x fewer)`);

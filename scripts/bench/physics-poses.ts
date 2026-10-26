/** Packed-pose CPU cost and matrix parity against a Git revision. Run with Node 24 and tsx. */
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { makeSync, world } from '../../packages/render/test/helpers';
import type { EntityInput } from '@aether/core';

const reference = process.env.AETHER_BENCH_BASE_REF ?? 'HEAD';
const revision = execFileSync('git', ['rev-parse', reference], { encoding: 'utf8' }).trim();
const source = execFileSync('git', ['show', `${revision}:packages/render/src/sync/scene-sync.ts`], { encoding: 'utf8' });
const start = source.indexOf('  applyTransforms('), end = source.indexOf('\n  /**', start);
if (start < 0 || end < 0) throw new Error('Baseline method unavailable');
const method = source.slice(start, end).trim().replace(/^applyTransforms/, 'function applyTransforms');
const chainStart = source.indexOf('function updateWorldChain(');
const chain = chainStart < 0 ? '' : source.slice(chainStart, source.indexOf('\n}', chainStart) + 2);
const { code } = await transform(method + '\n' + chain, { loader: 'ts', target: 'es2022' });
type Apply = ReturnType<typeof makeSync>['sync']['applyTransforms'];
// Only executes the selected repository revision, with its original module scratch values.
const baseline = new Function('Matrix4', 'Quaternion', 'Vector3', `
  const _inv = new Matrix4(), _pPos = new Vector3(), _pQuat = new Quaternion(), _pScale = new Vector3(), _q = new Quaternion();
  ${code}
  return applyTransforms;
`)(Matrix4, Quaternion, Vector3) as Apply;
console.log(JSON.stringify({ revision }));
for (const [parents, moving] of [[0, false], [1, false], [2000, false], [1, true], [2000, true]] as const) {
  const { sync } = makeSync();
  const entities: EntityInput[] = [];
  for (let i = 0; i < parents; i++) entities.push({ id: `parent-${i}`, transform: { position: [i, 2, 1], rotation: [0, 30, 0], scale: [2, 2, 2] } });
  const order = Array.from({ length: 2000 }, (_, i) => `body-${i}`);
  for (let i = 0; i < order.length; i++) entities.push({ id: order[i]!, ...(parents ? { parent: `parent-${i % parents}` } : {}) });
  await sync.setWorld(world(entities));
  const packed = new Float32Array(order.length * 7);
  for (let i = 0; i < order.length; i++) { packed[i * 7] = i; packed[i * 7 + 1] = 1; packed[i * 7 + 6] = 1; }
  const holders = Array.from({ length: parents }, (_, i) => sync.object(`parent-${i}`)!);
  const measure = (apply: Apply) => {
    for (let i = 0; i < holders.length; i++) { holders[i]!.position.set(i, 2, 1); holders[i]!.updateMatrix(); }
    const frame = () => {
      if (moving) for (const holder of holders) { holder.position.y += 0.001; holder.updateMatrix(); }
      apply.call(sync, packed, order);
    };
    for (let i = 0; i < 200; i++) frame();
    const times = [];
    for (let round = 0; round < 7; round++) {
      const start = performance.now();
      for (let i = 0; i < 100; i++) frame();
      times.push((performance.now() - start) / 100);
    }
    return times.sort((a, b) => a - b)[3]!;
  };
  const beforeMs = measure(baseline);
  const expected = order.map(id => sync.object(id)!.matrix.clone());
  const afterMs = measure(sync.applyTransforms);
  const differences = order.filter((id, i) => !sync.object(id)!.matrix.equals(expected[i]!)).length;
  console.log(JSON.stringify({ parents, moving, bodies: order.length, beforeMs, afterMs, ratio: afterMs / beforeMs, differences }));
  sync.dispose();
  if (differences) throw new Error('Pose matrices changed');
}

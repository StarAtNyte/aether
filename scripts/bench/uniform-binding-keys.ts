/** Three's real WebGL state method versus key reuse; isolates CPU and allocation cost from driver stalls. */
import { cacheUniformBindingKeys } from '../../packages/render/src/gpu/uniform-binding-keys';
import { probeAllocations } from '../../tests/unit/alloc-probe';

const path = 'three/src/renderers/webgl-fallback/utils/WebGLState.js';
const { default: WebGLState } = await import(path) as {
  default: { prototype: { bindBufferBase(target: number, index: number, buffer: object | null): boolean } };
};
async function measure(cached: boolean) {
  let nativeCalls = 0, tick = 0;
  const gl = { UNIFORM_BUFFER: 35345, bindBufferBase(_target: number, _index: number, _buffer: object | null) { nativeCalls++; } };
  const state = { gl, currentBoundBufferBases: {} as Record<string, object | null | undefined>, bindBufferBase: WebGLState.prototype.bindBufferBase };
  if (cached) cacheUniformBindingKeys({ gl, state });
  const a = {}, b = {};
  const frame = () => {
    const buffer = ++tick % 2 === 0 ? a : b;
    for (let i = 0; i < 8; i++) state.bindBufferBase(35345, i, buffer);
  };
  const run = () => {
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) frame();
    return performance.now() - start;
  };
  run();
  const times = Array.from({ length: 5 }, run).sort((a, b) => a - b);
  const allocations = await probeAllocations(frame, {
    iterations: 400, warmup: 3000,
    match: /(?:three\/src\/renderers\/webgl-fallback\/utils\/WebGLState|render\/src\/gpu\/uniform-binding-keys)/,
  });
  return { medianMsPer800kCalls: times[2], bytesPer8Calls: allocations.bytesPerIteration, nativeCalls };
}
console.log(JSON.stringify({ stock: await measure(false), cached: await measure(true) }, null, 2));

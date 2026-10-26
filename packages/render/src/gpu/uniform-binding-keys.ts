/** Reuse Three r186's uniform binding keys while preserving its state cache and reset behavior. */
interface GL {
  UNIFORM_BUFFER: number;
  bindBufferBase(target: number, index: number, buffer: object | null): void;
}
interface State {
  gl: GL;
  currentBoundBufferBases: Record<string, object | null | undefined>;
  bindBufferBase(target: number, index: number, buffer: object | null): boolean;
}
interface Backend {
  gl?: GL;
  state?: State;
}
const patched = new WeakSet<object>();

export function cacheUniformBindingKeys(backend: Backend): void {
  const gl = backend.gl, state = backend.state;
  if (!gl || !state || state.gl !== gl || patched.has(state) || !state.currentBoundBufferBases || typeof state.bindBufferBase !== 'function') return;
  const target = gl.UNIFORM_BUFFER;
  const keys = Array.from({ length: 64 }, (_, index) => `${target}-${index}`);
  const original = state.bindBufferBase;
  state.bindBufferBase = function (bindingTarget, index, buffer) {
    if (bindingTarget !== target || index < 0 || index >= keys.length || !Number.isInteger(index)) {
      return original.call(this, bindingTarget, index, buffer);
    }
    const key = keys[index]!;
    if (this.currentBoundBufferBases[key] === buffer) return false;
    this.gl.bindBufferBase(bindingTarget, index, buffer);
    this.currentBoundBufferBases[key] = buffer;
    return true;
  };
  patched.add(state);
}

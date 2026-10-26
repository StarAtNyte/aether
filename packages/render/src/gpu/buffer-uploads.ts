/** Exact change detection for Three r186 raw node uniform buffers. */
interface Binding {
  isNodeUniformBuffer?: boolean;
  buffer?: Float32Array;
  updateRanges?: unknown[];
}
interface Backend {
  get(binding: Binding): { bufferGPU?: object; buffer?: object };
  updateBinding(binding: Binding): void;
  updateBindings(group: { bindings: Binding[] }, ...args: unknown[]): void;
}
const installed = new WeakSet<object>();

export function cacheUniformUploads(backend: Backend): void {
  if (installed.has(backend) || typeof backend.get !== 'function' ||
      typeof backend.updateBinding !== 'function' || typeof backend.updateBindings !== 'function') return;
  installed.add(backend);
  const arrays = new WeakMap<Float32Array, { words: Uint32Array; copy: Uint32Array; version: number }>();
  const uploaded = new WeakMap<Binding, { gpu: object; array: Float32Array; version: number }>();
  const update = backend.updateBinding;
  backend.updateBinding = function (binding) {
    if (binding.isNodeUniformBuffer !== true) return update.call(this, binding);
    const array = binding.buffer;
    const gpu = this.get(binding);
    const handle = gpu.bufferGPU ?? gpu.buffer;
    if (!(array instanceof Float32Array) ||
        !(array.buffer instanceof ArrayBuffer) || (array.buffer as ArrayBuffer & { resizable?: boolean }).resizable ||
        array.byteLength === 0 || array.byteLength > 65536 || binding.updateRanges?.length || !handle) {
      uploaded.delete(binding);
      return update.call(this, binding);
    }
    let state = arrays.get(array);
    if (!state) {
      const words = new Uint32Array(array.buffer, array.byteOffset, array.length);
      state = { words, copy: words.slice(), version: 0 };
      arrays.set(array, state);
    } else {
      for (let i = 0; i < state.words.length; i++) {
        if (state.words[i] !== state.copy[i]) {
          state.copy.set(state.words);
          state.version++;
          break;
        }
      }
    }
    const previous = uploaded.get(binding);
    if (previous?.gpu === handle && previous.array === array && previous.version === state.version) return;
    update.call(this, binding);
    if (previous) {
      previous.gpu = handle; previous.array = array; previous.version = state.version;
    } else uploaded.set(binding, { gpu: handle, array, version: state.version });
  };
  // WebGL's bind-group creation/refresh writes uniforms directly, bypassing updateBinding.
  const updateGroup = backend.updateBindings;
  backend.updateBindings = function (group, ...args) {
    for (const binding of group.bindings) uploaded.delete(binding);
    return updateGroup.call(this, group, ...args);
  };
}

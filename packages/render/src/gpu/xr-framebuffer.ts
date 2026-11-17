/**
 * three r186's WebGL2 backend remembers each framebuffer's draw buffers in a WeakMap keyed by the framebuffer
 * (`WebGLState.currentDrawbuffers`). An XR session on a plain `XRWebGLLayer` draws into the layer's opaque framebuffer,
 * and a layer whose framebuffer is the default one reports `null` (the WebXR emulators do: iwer's emulated layer draws
 * straight to the canvas). The output pass of the XR frame then keys that WeakMap with `null` and throws "Invalid value
 * used as weak map key" on every frame. This keeps the map but answers for `null` itself: the default framebuffer
 * draws to BACK, which needs no `drawBuffers` call, so its entry reads as "already set" and is never written.
 */
interface DrawBufferMap {
  get(key: object): number[] | undefined;
  set(key: object, value: number[]): unknown;
  has?(key: object): boolean;
  delete?(key: object): boolean;
}

const patched = new WeakSet<object>();

/** Make `state.currentDrawbuffers` accept the default (`null`) framebuffer. Idempotent; a no-op on other backends. */
export function allowDefaultXRFramebuffer(backend: unknown, colorAttachment0: number): boolean {
  const state = (backend as { state?: { currentDrawbuffers?: DrawBufferMap } } | null)?.state;
  const map = state?.currentDrawbuffers;
  if (!state || !map || typeof map.get !== 'function' || patched.has(state)) return false;
  // The XR target has one color texture: [COLOR_ATTACHMENT0] matches it, so WebGLState makes no call for it.
  const defaultEntry = (): number[] => [colorAttachment0];
  const wrapped: DrawBufferMap = {
    get: (key) => (key == null ? defaultEntry() : map.get(key)),
    set: (key, value) => (key == null ? wrapped : (map.set(key, value), wrapped)),
    has: (key) => (key == null ? true : map.has?.(key) ?? map.get(key) !== undefined),
    delete: (key) => (key == null ? false : map.delete?.(key) ?? false),
  };
  state.currentDrawbuffers = wrapped;
  patched.add(state);
  return true;
}

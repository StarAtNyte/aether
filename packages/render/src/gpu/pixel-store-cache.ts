/** Keep Three r186's pixel-store cache initialized so texture copies never need a synchronous GL query. */
const defaults = [
  ['PACK_ALIGNMENT', 4], ['UNPACK_ALIGNMENT', 4],
  ['UNPACK_FLIP_Y_WEBGL', false], ['UNPACK_PREMULTIPLY_ALPHA_WEBGL', false],
  ['PACK_ROW_LENGTH', 0], ['PACK_SKIP_PIXELS', 0], ['PACK_SKIP_ROWS', 0],
  ['UNPACK_ROW_LENGTH', 0], ['UNPACK_IMAGE_HEIGHT', 0],
  ['UNPACK_SKIP_PIXELS', 0], ['UNPACK_SKIP_ROWS', 0], ['UNPACK_SKIP_IMAGES', 0],
  ['UNPACK_COLORSPACE_CONVERSION_WEBGL', 'BROWSER_DEFAULT_WEBGL'],
] as const;
interface GL {
  getParameter(name: number): unknown;
  [name: string]: unknown;
}
interface State {
  parameters: Record<number, unknown>;
  reset(): void;
}
interface Backend { gl?: GL; state?: State }
const installed = new WeakSet<object>();

export function cachePixelStoreState(backend: Backend): void {
  const gl = backend.gl, state = backend.state;
  if (!gl || !state || !state.parameters || typeof gl.getParameter !== 'function' ||
      typeof state.reset !== 'function' || installed.has(state)) return;
  // Read the real state once, before scene shaders are submitted. This also preserves
  // non-default state when the renderer was given an existing context.
  const entries: Array<{ name: number; reset: number | boolean }> = [];
  for (const [key, initial] of defaults) {
    const name = gl[key], reset = typeof initial === 'string' ? gl[initial] : initial;
    if (typeof name !== 'number' || (typeof reset !== 'number' && typeof reset !== 'boolean')) continue;
    entries.push({ name, reset });
    if (state.parameters[name] !== undefined) continue;
    const value = gl.getParameter(name);
    if (value !== null && value !== undefined) state.parameters[name] = value;
  }
  const reset = state.reset;
  state.reset = function () {
    reset.call(this);
    // Three's reset writes these exact defaults to GL, then clears its JS cache.
    // Repopulate it without querying the driver or changing any state again.
    for (const entry of entries) this.parameters[entry.name] = entry.reset;
  };
  installed.add(state);
}

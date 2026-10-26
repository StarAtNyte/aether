/** Sparse asynchronous GPU samples; unavailable/stale evidence falls back to frame timing. */
export function gpuFrameCost(backend: { gl?: WebGL2RenderingContext; trackTimestamp?: boolean }) {
  const gl = backend.gl;
  const ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined;
  const slots = Array.from({ length: 3 }, () => ({ query: null as WebGLQuery | null, pending: false, at: 0 }));
  const samples = new Float64Array(8), sorted = new Float64Array(8);
  let disposed = false, active = -1, frame = 0, filled = 0, cursor = 0, last = -Infinity;
  let width = 0, height = 0, scale = 1, variant: object | null = null;
  const clear = () => {
    filled = cursor = 0; last = -Infinity;
    for (const slot of slots) {
      if (slot.query && !gl?.isContextLost()) gl?.deleteQuery(slot.query);
      slot.query = null; slot.pending = false;
    }
  };
  return {
    begin(w: number, h: number, pipeline: object | null, sceneScale = 1): void {
      if (!gl || !ext || disposed || active >= 0) return;
      if (gl.isContextLost() || backend.trackTimestamp) { clear(); return; }
      if (w !== width || h !== height || pipeline !== variant || sceneScale !== scale) {
        clear(); width = w; height = h; variant = pipeline; scale = sceneScale;
      }
      const tick = frame++;
      if ((tick & 3) !== 0) return;
      const now = performance.now();
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { clear(); return; }
      for (const slot of slots) {
        if (!slot.pending || !slot.query) continue;
        if (now - slot.at > 1000) { clear(); break; }
        if (!gl.getQueryParameter(slot.query, gl.QUERY_RESULT_AVAILABLE)) continue;
        const seconds = Number(gl.getQueryParameter(slot.query, gl.QUERY_RESULT)) / 1e9;
        slot.pending = false;
        if (Number.isFinite(seconds) && seconds > 0 && seconds < 1) {
          samples[cursor] = seconds; cursor = (cursor + 1) % samples.length;
          filled = Math.min(samples.length, filled + 1); last = slot.at;
        }
      }
      // One measurement per eight rendered frames; never nest another timer user.
      if ((tick & 7) !== 0 || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;
        if (slot.pending) continue;
        slot.query ??= gl.createQuery();
        if (!slot.query) return;
        gl.beginQuery(ext.TIME_ELAPSED_EXT, slot.query); active = i;
        return;
      }
    },
    end(valid: boolean): void {
      if (active < 0 || !gl || !ext) return;
      const slot = slots[active]!; active = -1;
      if (gl.isContextLost()) { clear(); return; }
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      if (valid) { slot.pending = true; slot.at = performance.now(); }
      else { gl.deleteQuery(slot.query); slot.query = null; }
    },
    /** p90 of at least three recent samples at this exact size/pipeline. */
    get seconds(): number | undefined {
      if (disposed || filled < 3 || performance.now() - last > 500) return undefined;
      sorted.fill(Infinity);
      for (let i = 0; i < filled; i++) sorted[i] = samples[i]!;
      sorted.sort();
      return sorted[Math.floor(filled * .9)];
    },
    dispose(): void { if (disposed) return; this.end(false); disposed = true; clear(); },
  };
}

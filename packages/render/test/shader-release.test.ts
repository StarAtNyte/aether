import { describe, expect, it, vi } from 'vitest';
import { installShaderRelease, releasedShaders, RELEASE_MS } from '../src/gpu/shader-release';

interface Sh { id: number; source?: string; deleted?: boolean }
function fakeBackend() {
  const store = new Map<object, Record<string, unknown>>();
  let id = 0;
  const calls: string[] = [];
  const proto = {
    FRAGMENT_SHADER: 1, VERTEX_SHADER: 2, LINK_STATUS: 3,
    createShader(): Sh { return { id: ++id }; },
    shaderSource(s: Sh, src: string) { s.source = src; },
    compileShader(s: Sh) { calls.push(`compile ${s.id}`); },
    createProgram: () => ({ program: ++id }),
    attachShader(_p: object, s: Sh) { if (s.deleted) throw new Error('attached a deleted shader'); calls.push(`attach ${s.id}`); },
    detachShader(_p: object, s: Sh) { calls.push(`detach ${s.id}`); },
    deleteShader(s: Sh) { s.deleted = true; calls.push(`delete ${s.id}`); },
    getProgramParameter: () => true,
    isContextLost: () => false,
  };
  const gl = Object.create(proto) as typeof proto;
  const backend = {
    gl: gl as unknown as WebGL2RenderingContext,
    get(k: object) { let v = store.get(k); if (!v) { v = {}; store.set(k, v); } return v; },
    _completeCompile(_o: unknown, _p: unknown) { /* bindings */ },
  };
  /** three's createProgram: one shader per stage, kept. */
  const stage = (code: string) => { const st = {}; const s = gl.createShader(); gl.shaderSource(s, code); gl.compileShader(s); backend.get(st)['shaderGPU'] = s; return st; };
  /** three's createRenderPipeline + a completed link. */
  const link = (fs: object, vs: object) => {
    const pipeline = { fragmentProgram: fs, vertexProgram: vs };
    const programGPU = gl.createProgram();
    gl.attachShader(programGPU, backend.get(fs)['shaderGPU'] as Sh);
    gl.attachShader(programGPU, backend.get(vs)['shaderGPU'] as Sh);
    store.set(pipeline, { programGPU });
    backend._completeCompile({}, pipeline);
  };
  return { backend, calls, stage, link };
}

describe('shader release', () => {
  it('detaches shaders after link, deletes unused ones after the grace, and compiles a copy when one is used again', () => {
    vi.useFakeTimers();
    try {
      const { backend, calls, stage, link } = fakeBackend();
      installShaderRelease(backend as never);
      const fs = stage('fs'), vs = stage('vs');
      link(fs, vs);
      expect(calls.filter((c) => c.startsWith('detach'))).toHaveLength(2);
      expect(calls.some((c) => c.startsWith('delete'))).toBe(false);
      const before = releasedShaders.deleted;
      vi.advanceTimersByTime(RELEASE_MS + 1);
      expect(releasedShaders.deleted - before).toBe(2);
      const compiles = calls.filter((c) => c.startsWith('compile')).length;
      link(fs, vs);
      expect(calls.filter((c) => c.startsWith('compile')).length - compiles).toBe(2);
      // The copies stand in again on the next use: no third compile.
      link(fs, vs);
      expect(calls.filter((c) => c.startsWith('compile')).length - compiles).toBe(2);
    } finally { vi.useRealTimers(); }
  });

  it('keeps a shader that a new program uses within the grace', () => {
    vi.useFakeTimers();
    try {
      const { backend, calls, stage, link } = fakeBackend();
      installShaderRelease(backend as never);
      const fs = stage('fs'), vs = stage('vs'), vs2 = stage('vs2');
      link(fs, vs);
      vi.advanceTimersByTime(RELEASE_MS / 2);
      link(fs, vs2);
      vi.advanceTimersByTime(RELEASE_MS / 2 + 1);
      const vsId = (backend.get(vs)['shaderGPU'] as Sh).id;
      expect(calls.filter((c) => c.startsWith('delete'))).toEqual([`delete ${vsId}`]);
    } finally { vi.useRealTimers(); }
  });
});

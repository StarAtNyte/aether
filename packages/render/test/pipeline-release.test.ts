import { describe, expect, it, vi } from 'vitest';
import { installPipelineRelease, releasedPrograms, RELEASE_DELAY_MS } from '../src/gpu/pipeline-release';

function fake(linkDone: () => boolean) {
  const deleted: object[] = [];
  const store = new Map<object, Record<string, unknown>>();
  const gl = { isContextLost: () => false, deleteProgram: (p: object) => deleted.push(p), getProgramParameter: () => linkDone() };
  const backend = { gl: gl as unknown as WebGL2RenderingContext, parallel: { COMPLETION_STATUS_KHR: 1 }, get: (k: object) => store.get(k) ?? {} };
  const caches = new Set<object>();
  const pipelines = { _releasePipeline(p: object) { caches.delete(p); } };
  const pipeline = {};
  const program = { program: 1 };
  store.set(pipeline, { programGPU: program });
  caches.add(pipeline);
  return { backend, pipelines, pipeline, program, deleted, caches };
}

describe('pipeline release', () => {
  it('deletes a released program one wait after its link finished', () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const f = fake(() => done);
      installPipelineRelease(f.backend as never, f.pipelines);
      const before = releasedPrograms.deleted;
      f.pipelines._releasePipeline(f.pipeline);
      expect(f.caches.size).toBe(0);
      vi.advanceTimersByTime(RELEASE_DELAY_MS * 3);
      expect(f.deleted).toEqual([]);
      done = true;
      vi.advanceTimersByTime(RELEASE_DELAY_MS);
      expect(f.deleted).toEqual([]);
      vi.advanceTimersByTime(RELEASE_DELAY_MS);
      expect(f.deleted).toEqual([f.program]);
      expect(releasedPrograms.deleted - before).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('does nothing after dispose', () => {
    vi.useFakeTimers();
    try {
      const f = fake(() => true);
      const off = installPipelineRelease(f.backend as never, f.pipelines);
      f.pipelines._releasePipeline(f.pipeline);
      off();
      vi.advanceTimersByTime(RELEASE_DELAY_MS * 5);
      expect(f.deleted).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

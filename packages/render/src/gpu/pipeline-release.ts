/**
 * Delete the WebGL program of a render pipeline three.js has let go.
 *
 * Three r186 releases a pipeline when no render object uses it any more (`Pipelines._releasePipeline`): it drops it from
 * its cache and nothing else. The program stays alive in the driver until the browser happens to collect its JS
 * wrapper, which a busy page may not do for minutes. After a change of quality tier every lit material builds a new
 * program, so the old tier's programs (5-10 MB each on an integrated GPU's driver) stayed beside the new ones: switching a
 * hillside town to ultra ran the tab out of memory.
 *
 * A released pipeline's program is deleted once its link has finished, after {@link RELEASE_DELAY_MS} (a pipeline that
 * comes back in that time is a new pipeline with a program of its own, so nothing can still draw with the old one).
 * Opt out with `globalThis.__AETHER_PIPELINE_RELEASE = false`.
 */

/** Wait (ms) before a released program is deleted, and between checks of a program still linking. */
export const RELEASE_DELAY_MS = 2000;

interface Backend {
  gl?: WebGL2RenderingContext;
  isWebGPUBackend?: boolean;
  parallel?: { COMPLETION_STATUS_KHR: number } | null;
  get(key: object): Record<string, unknown>;
}
interface Pipelines {
  _releasePipeline?(pipeline: object): void;
}

/** Programs deleted so far (diagnostics). */
export const releasedPrograms = { deleted: 0 };
(globalThis as { __aetherPipelineRelease?: unknown }).__aetherPipelineRelease = releasedPrograms;

export function installPipelineRelease(backend: Backend, pipelines: Pipelines | undefined): () => void {
  const gl = backend.gl;
  if (!gl || backend.isWebGPUBackend || !pipelines || typeof pipelines._releasePipeline !== 'function') return () => undefined;
  if ((globalThis as { __AETHER_PIPELINE_RELEASE?: boolean }).__AETHER_PIPELINE_RELEASE === false) return () => undefined;
  const original = pipelines._releasePipeline;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  const ready = new WeakSet<WebGLProgram>();
  const settle = (program: WebGLProgram, tries: number): void => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (disposed || gl.isContextLost()) return;
      const parallel = backend.parallel;
      // A program still linking in parallel is deleted one wait after its link finished, so the completion step (which
      // queries it a few milliseconds after the link) is long done.
      if (parallel && tries < 30 && !ready.has(program)) {
        if (gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR) === true) ready.add(program);
        settle(program, tries + 1);
        return;
      }
      gl.deleteProgram(program);
      releasedPrograms.deleted++;
    }, RELEASE_DELAY_MS);
    timers.add(t);
  };
  const wrapped = function (this: Pipelines, pipeline: object): void {
    original.call(this, pipeline);
    const program = backend.get(pipeline)['programGPU'] as WebGLProgram | undefined;
    if (program) settle(program, 0);
  };
  pipelines._releasePipeline = wrapped;
  return () => {
    disposed = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (pipelines._releasePipeline === wrapped) pipelines._releasePipeline = original;
  };
}

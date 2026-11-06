/** Three r186's draw path links synchronously even when KHR_parallel_shader_compile is available. */
interface Pipeline { fragmentProgram: { code?: string }; vertexProgram: { code?: string } }
interface RenderObject { pipeline: Pipeline; getBindings(): unknown; context?: { textures?: Array<{ isPMREMTexture?: boolean; isCubeTexture?: boolean }> | null } }
interface Backend {
  gl?: WebGL2RenderingContext;
  isWebGPUBackend?: boolean;
  parallel?: { COMPLETION_STATUS_KHR: number } | null;
  get(key: object): { shaderGPU?: WebGLShader };
  set(key: object, value: object): void;
  createRenderPipeline(object: RenderObject, promises: Promise<void>[] | null): void;
  draw?(object: RenderObject, info: unknown): void;
  _completeCompile(object: { getBindings(): unknown }, pipeline: Pipeline): void;
}
export interface ParallelPrograms {
  readonly pending: number;
  /** Draws issued so far (running count), and those skipped because their program was still linking. */
  readonly draws: { issued: number; linking: number };
  idle(): Promise<void>;
  synchronous<T>(draw: () => T): T;
  dispose(): void;
}
/** Links slower than this are recorded in {@link slowLinks} (ms). */
const SLOW_LINK_MS = 1500;
/** Slow program links seen in this page (diagnostics: how long, and how big the shader source was). */
export const slowLinks: Array<{ ms: number; chars: number; head: string }> = [];
/** Longest a WebGPU pipeline job may hold the draws before it is let go (ms). */
const STUCK_PIPELINE_MS = 5000;
/** WebGPU pipeline jobs let go for never settling (diagnostics). */
export const stuckPipelines = { count: 0 };
/** Retain the bindings, not a mutable/disposable RenderObject, while a program links. */
/** The program pool a pipeline may take its program from (gpu/program-cache.ts). */
export interface ProgramPool {
  take(vertex: string | undefined, fragment: string | undefined): { program: WebGLProgram; ready(): boolean; done(): void } | null;
  note(vertex: string | undefined, fragment: string | undefined): void;
}
export function parallelPrograms(backend: Backend, changed: () => void, failed: (error: unknown) => void, pool: ProgramPool | null = null): ParallelPrograms {
  const jobs = new Set<{ cancel(): void; done: Promise<void>; ready(): boolean; complete(): void; pipeline: object }>();
  /** Pipelines whose program is still linking or compiling: drawing one would use a program with no bindings yet. */
  const linking = new Map<object, number>();
  const hold = (pipeline: object): void => void linking.set(pipeline, (linking.get(pipeline) ?? 0) + 1);
  const release = (pipeline: object): void => {
    const n = (linking.get(pipeline) ?? 0) - 1;
    if (n > 0) linking.set(pipeline, n); else linking.delete(pipeline);
  };
  const draw = backend.draw;
  const draws = { issued: 0, linking: 0 };
  const skipLinking = function (this: unknown, object: RenderObject, info: unknown): void {
    draws.issued++;
    if (!synchronous && linking.has(object.pipeline)) { draws.linking++; return; }
    return draw!.call(backend, object, info);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let submitted = 0;
  const poll = () => {
    timer = undefined;
    let completing = false;
    if (disposed || gl?.isContextLost()) { for (const job of [...jobs]) job.cancel(); return; }
    // A uniform/block query for a completed program can still wait behind other
    // programs in the GL command queue. Drain a whole ready batch before querying.
    try {
      if ([...jobs].every(job => job.ready())) {
        completing = true;
        const start = performance.now(), batch = submitted;
        // Reflection and binding setup are CPU work even after linking finishes.
        // Yield between programs so a large first-use batch cannot monopolize input.
        for (const job of jobs) {
          job.complete();
          if (disposed || submitted !== batch || performance.now() - start >= 4) break;
        }
      }
    } catch (e) { for (const job of [...jobs]) job.cancel(); failed(e); }
    if (!disposed && jobs.size) timer = setTimeout(poll, completing ? 0 : 8);
  };
  const original = backend.createRenderPipeline;
  const gl = backend.gl, parallel = backend.parallel;
  let disposed = false;
  let synchronous = false;
  const controller: ParallelPrograms = {
    get pending() { return jobs.size; },
    draws,
    synchronous(draw) {
      const previous = synchronous;
      synchronous = true;
      try { return draw(); } finally { synchronous = previous; }
    },
    async idle() { while (jobs.size) await Promise.all([...jobs].map(job => job.done)); },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      for (const job of [...jobs]) job.cancel();
      if (backend.createRenderPipeline === create) backend.createRenderPipeline = original;
      if (backend.draw === skipLinking) backend.draw = draw;
    },
  };
  if (typeof draw === 'function') backend.draw = skipLinking as typeof draw;
  if (backend.isWebGPUBackend === true && typeof original === 'function') {
    const createGPU = (object: RenderObject, promises: Promise<void>[] | null): void => {
      if (disposed || synchronous || (!promises && object.context?.textures?.some(texture => texture.isPMREMTexture || texture.isCubeTexture))) return original.call(backend, object, promises);
      const submitted: Promise<void>[] = [];
      original.call(backend, object, submitted);
      for (const pending of submitted) {
        let resolve!: () => void;
        const done = new Promise<void>(r => { resolve = r; });
        const finish = () => {
          if (!jobs.delete(job)) return;
          release(job.pipeline);
          resolve();
          if (!disposed && !jobs.size) changed();
        };
        const job = { done, cancel: finish, ready: () => false, complete: finish, pipeline: object.pipeline };
        jobs.add(job); hold(object.pipeline);
        // A pipeline promise that never settles held every draw and the preparation queue behind it: a furnished street
        // on WebGPU drew no frame in two minutes. Past STUCK_PIPELINE_MS the job is let go (the draw then waits on the
        // pipeline itself, as three does without this tracker).
        const started = performance.now();
        const stuck = setTimeout(() => {
          if (!jobs.has(job)) return;
          stuckPipelines.count++;
          slowLinks.push({ ms: Math.round(performance.now() - started), chars: -1, head: 'webgpu pipeline released' });
          finish();
        }, STUCK_PIPELINE_MS);
        pending.then(() => { clearTimeout(stuck); finish(); }, error => { clearTimeout(stuck); finish(); if (!disposed) failed(error); });
        promises?.push(done);
      }
    };
    backend.createRenderPipeline = createGPU;
    const dispose = controller.dispose;
    controller.dispose = () => { dispose(); if (backend.createRenderPipeline === createGPU) backend.createRenderPipeline = original; };
    return controller;
  }
  if (!gl || !parallel || typeof original !== 'function' || typeof backend._completeCompile !== 'function') return controller;
  function create(object: RenderObject, promises: Promise<void>[] | null): void {
    const pipeline = object.pipeline;
    if (disposed || synchronous || (!promises && object.context?.textures?.some(texture => texture.isPMREMTexture || texture.isCubeTexture)) || !gl || !parallel) {
      pool?.note(pipeline.vertexProgram.code, pipeline.fragmentProgram.code);
      return original.call(backend, object, promises);
    }
    // A program of the pre-warmed set (linked, or linking, ahead of need) is taken as it is: no link here.
    const pooled = pool?.take(pipeline.vertexProgram.code, pipeline.fragmentProgram.code) ?? null;
    const fragmentShader = pooled ? undefined : backend.get(pipeline.fragmentProgram).shaderGPU!;
    const vertexShader = pooled ? undefined : backend.get(pipeline.vertexProgram).shaderGPU!;
    const programGPU = pooled ? pooled.program : gl.createProgram();
    if (!programGPU) return original.call(backend, object, promises);
    const bindings = object.getBindings();
    if (!pooled) {
      gl.attachShader(programGPU, fragmentShader!);
      gl.attachShader(programGPU, vertexShader!);
      gl.linkProgram(programGPU);
    }
    const linkStart = performance.now();
    backend.set(pipeline, { programGPU, fragmentShader, vertexShader });
    let resolve!: () => void;
    const done = new Promise<void>(r => { resolve = r; });
    const finish = () => {
      if (!jobs.delete(job)) return;
      release(job.pipeline);
      resolve();
      if (!disposed && !jobs.size) changed();
    };
    const job = {
      pipeline,
      done,
      cancel: () => { if (!gl.isContextLost()) gl.deleteProgram(programGPU); finish(); },
      ready: pooled ? pooled.ready : () => gl.getProgramParameter(programGPU, parallel.COMPLETION_STATUS_KHR) === true,
      complete: () => {
        const ms = performance.now() - linkStart;
        pooled?.done();
        // Diagnostics: one slow link holds every other completion and the preparation queue (see poll).
        if (ms > SLOW_LINK_MS && fragmentShader && vertexShader) slowLinks.push({ ms: Math.round(ms), chars: (gl.getShaderSource(fragmentShader)?.length ?? 0) + (gl.getShaderSource(vertexShader)?.length ?? 0), head: (gl.getShaderSource(fragmentShader) ?? '').slice(0, 0) });
        backend._completeCompile({ getBindings: () => bindings }, pipeline); finish();
      },
    };
    jobs.add(job); hold(pipeline);
    submitted++;
    // Defer the first poll as well: the current task should submit, then yield.
    if (timer === undefined) timer = setTimeout(poll, 0);
    promises?.push(done);
  }
  backend.createRenderPipeline = create;
  return controller;
}

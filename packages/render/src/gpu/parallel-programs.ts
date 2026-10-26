/** Three r186's draw path links synchronously even when KHR_parallel_shader_compile is available. */
interface Pipeline { fragmentProgram: object; vertexProgram: object }
interface RenderObject { pipeline: Pipeline; getBindings(): unknown; context?: { textures?: Array<{ isPMREMTexture?: boolean; isCubeTexture?: boolean }> | null } }
interface Backend {
  gl?: WebGL2RenderingContext;
  isWebGPUBackend?: boolean;
  parallel?: { COMPLETION_STATUS_KHR: number } | null;
  get(key: object): { shaderGPU?: WebGLShader };
  set(key: object, value: object): void;
  createRenderPipeline(object: RenderObject, promises: Promise<void>[] | null): void;
  _completeCompile(object: { getBindings(): unknown }, pipeline: Pipeline): void;
}
export interface ParallelPrograms {
  readonly pending: number;
  idle(): Promise<void>;
  synchronous<T>(draw: () => T): T;
  dispose(): void;
}
/** Retain the bindings, not a mutable/disposable RenderObject, while a program links. */
export function parallelPrograms(backend: Backend, changed: () => void, failed: (error: unknown) => void): ParallelPrograms {
  const jobs = new Set<{ cancel(): void; done: Promise<void>; ready(): boolean; complete(): void }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = () => {
    timer = undefined;
    if (disposed || gl?.isContextLost()) { for (const job of [...jobs]) job.cancel(); return; }
    // A uniform/block query for a completed program can still wait behind other
    // programs in the GL command queue. Drain a whole ready batch before querying.
    try {
      if ([...jobs].every(job => job.ready())) {
        for (const job of [...jobs]) job.complete();
      }
    } catch (e) { for (const job of [...jobs]) job.cancel(); failed(e); }
    if (jobs.size) timer = setTimeout(poll, 8);
  };
  const original = backend.createRenderPipeline;
  const gl = backend.gl, parallel = backend.parallel;
  let disposed = false;
  let synchronous = false;
  const controller: ParallelPrograms = {
    get pending() { return jobs.size; },
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
    },
  };
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
          resolve();
          if (!disposed && !jobs.size) changed();
        };
        const job = { done, cancel: finish, ready: () => false, complete: finish };
        jobs.add(job);
        pending.then(finish, error => { finish(); if (!disposed) failed(error); });
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
    if (disposed || synchronous || (!promises && object.context?.textures?.some(texture => texture.isPMREMTexture || texture.isCubeTexture)) || !gl || !parallel) return original.call(backend, object, promises);
    const pipeline = object.pipeline;
    const fragmentShader = backend.get(pipeline.fragmentProgram).shaderGPU!;
    const vertexShader = backend.get(pipeline.vertexProgram).shaderGPU!;
    const programGPU = gl.createProgram();
    if (!programGPU) return original.call(backend, object, promises);
    const bindings = object.getBindings();
    gl.attachShader(programGPU, fragmentShader);
    gl.attachShader(programGPU, vertexShader);
    gl.linkProgram(programGPU);
    backend.set(pipeline, { programGPU, fragmentShader, vertexShader });
    let resolve!: () => void;
    const done = new Promise<void>(r => { resolve = r; });
    const finish = () => {
      if (!jobs.delete(job)) return;
      resolve();
      if (!disposed && !jobs.size) changed();
    };
    const job = {
      done,
      cancel: () => { if (!gl.isContextLost()) gl.deleteProgram(programGPU); finish(); },
      ready: () => gl.getProgramParameter(programGPU, parallel.COMPLETION_STATUS_KHR) === true,
      complete: () => { backend._completeCompile({ getBindings: () => bindings }, pipeline); finish(); },
    };
    jobs.add(job);
    // Defer the first poll as well: the current task should submit, then yield.
    if (timer === undefined) timer = setTimeout(poll, 0);
    promises?.push(done);
  }
  backend.createRenderPipeline = create;
  return controller;
}

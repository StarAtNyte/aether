/**
 * Free the compiled shader objects of linked WebGL programs.
 *
 * Three r186's WebGL backend compiles one shader object per programmable stage and keeps it for as long as the stage
 * exists, attached to every program linked from it, and never deletes it. A linked program does not need its shaders:
 * the driver keeps the executable in the program. But it keeps each attached shader's compiled form too, and on Mesa
 * those are large: a furnished terrace world with 157 programs held 1.9 GB in the GPU process on an integrated GPU
 * (~10 MB a program), against 53 MB of vertex and index buffers.
 *
 * So once a program has linked, both shaders are detached from it, and a shader no program holds any more is
 * deleted after {@link RELEASE_MS} without new use. A later pipeline from the same stage compiles the shader again
 * from its source (compiling is a fraction of linking). Compute stages are never released.
 * Opt out with `globalThis.__AETHER_SHADER_RELEASE = false`.
 */

/** Grace (ms) before an unattached shader is deleted: a load links many programs from the same stages in a burst. */
export const RELEASE_MS = 4000;

interface Pipeline { fragmentProgram: object; vertexProgram: object }
interface Backend {
  gl?: WebGL2RenderingContext;
  isWebGPUBackend?: boolean;
  get(key: object): Record<string, unknown>;
  _completeCompile(object: unknown, pipeline: Pipeline): void;
}

/** Shaders released so far, and compiled again for a later program (diagnostics). */
export const releasedShaders = { deleted: 0, recompiled: 0 };
(globalThis as { __aetherShaderRelease?: unknown }).__aetherShaderRelease = releasedShaders;

export function installShaderRelease(backend: Backend): () => void {
  const gl = backend.gl;
  if (!gl || backend.isWebGPUBackend || typeof backend._completeCompile !== 'function') return () => undefined;
  if ((globalThis as { __AETHER_SHADER_RELEASE?: boolean }).__AETHER_SHADER_RELEASE === false) return () => undefined;
  /** Source and type of every shader of this context (to compile a released one again). */
  const info = new WeakMap<WebGLShader, { type: number; source: string }>();
  /** Programs a shader is attached to and not yet linked. */
  const attached = new Map<WebGLShader, number>();
  const timers = new Map<WebGLShader, ReturnType<typeof setTimeout>>();
  /** A released shader's live stand-in: three keeps handing out the shader it created. */
  const standIn = new WeakMap<WebGLShader, WebGLShader>();
  const deleted = new WeakSet<WebGLShader>();
  const programShaders = new WeakMap<WebGLProgram, WebGLShader[]>();

  const own = gl as unknown as Record<string, unknown>;
  const createShader = gl.createShader, shaderSource = gl.shaderSource, attachShader = gl.attachShader;
  own['createShader'] = function (type: number) {
    const s = createShader.call(gl, type);
    if (s) info.set(s, { type, source: '' });
    return s;
  };
  own['shaderSource'] = function (shader: WebGLShader, source: string) {
    const i = info.get(shader);
    if (i) i.source = source;
    return shaderSource.call(gl, shader, source);
  };
  /** The shader to attach in place of `shader`: itself, or a compiled copy when it was released. */
  const live = (shader: WebGLShader): WebGLShader => {
    let s = shader;
    for (let next = standIn.get(s); next; next = standIn.get(s)) s = next;
    if (!deleted.has(s)) return s;
    const i = info.get(s);
    const fresh = i ? createShader.call(gl, i.type) : null;
    if (!i || !fresh) return s;
    info.set(fresh, { type: i.type, source: i.source });
    shaderSource.call(gl, fresh, i.source);
    gl.compileShader(fresh);
    standIn.set(s, fresh);
    releasedShaders.recompiled++;
    return fresh;
  };
  own['attachShader'] = function (program: WebGLProgram, shader: WebGLShader) {
    const s = info.has(shader) ? live(shader) : shader;
    if (info.has(s)) {
      attached.set(s, (attached.get(s) ?? 0) + 1);
      const t = timers.get(s);
      if (t !== undefined) { clearTimeout(t); timers.delete(s); }
      const list = programShaders.get(program);
      if (list) list.push(s); else programShaders.set(program, [s]);
    }
    return attachShader.call(gl, program, s);
  };
  const drop = (shader: WebGLShader): void => {
    const n = (attached.get(shader) ?? 1) - 1;
    if (n > 0) { attached.set(shader, n); return; }
    attached.delete(shader);
    timers.set(shader, setTimeout(() => {
      timers.delete(shader);
      if (attached.has(shader) || gl.isContextLost()) return;
      gl.deleteShader(shader);
      deleted.add(shader);
      releasedShaders.deleted++;
    }, RELEASE_MS));
  };

  const complete = backend._completeCompile;
  const wrappedComplete: Backend['_completeCompile'] = function (this: Backend, object, pipeline) {
    complete.call(this, object, pipeline);
    const program = backend.get(pipeline)['programGPU'] as WebGLProgram | undefined;
    const shaders = program ? programShaders.get(program) : undefined;
    if (!program || !shaders) return;
    // A failed link keeps its shaders attached for the error log; a linked program no longer needs them.
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return;
    programShaders.delete(program);
    for (const s of shaders) { gl.detachShader(program, s); drop(s); }
  };
  backend._completeCompile = wrappedComplete;
  return () => {
    if (backend._completeCompile === wrappedComplete) backend._completeCompile = complete;
    for (const k of ['createShader', 'shaderSource', 'attachShader']) delete own[k];
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}

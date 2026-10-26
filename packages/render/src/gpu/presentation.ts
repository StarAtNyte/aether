/** Prepare dependencies before opening the canvas pass. Incomplete frames never replace the last image. */
interface Context { textures?: unknown[] | null; fullscreenPass?: boolean }
interface Mesh { isQuadMesh?: boolean; material?: { version: number }; geometry?: unknown }
interface Object { object: Mesh; material: { version: number }; context: Context }
interface Port {
  _renderScene(scene: Mesh, camera: unknown, framebuffer?: boolean): unknown;
  needsFrameBufferTarget: boolean;
  getRenderTarget(): unknown; getOutputRenderTarget(): unknown;
  xr?: { isPresenting?: boolean };
  backend: {
    trackTimestamp?: boolean;
    beginRender(context: Context): void; finishRender(context: Context): void;
    draw(object: Object, info: unknown): void;
  };
  _nodes: { updateBefore(object: Object): void; updateAfter(object: Object): void };
}
export function preparePresentation(renderer: unknown, pending: () => boolean) {
  const r = renderer as Port, backend = r.backend, nodes = r._nodes;
  const scene = r._renderScene, begin = backend?.beginRender, finish = backend?.finishRender, draw = backend?.draw;
  const before = nodes?.updateBefore, after = nodes?.updateAfter;
  let phase = 0, atomic = 0, disposed = false, skipped = false;
  let root: Mesh | null = null, ready: Object | null = null, version = -1;
  const canvas = (context: Context) => context.textures === null && context.fullscreenPass === true;
  const supported = [scene, begin, finish, draw, before, after, r.getRenderTarget, r.getOutputRenderTarget].every(f => typeof f === 'function');
  function renderScene(object: Mesh, camera: unknown, framebuffer = true): unknown {
    if (disposed || atomic || phase || !object.isQuadMesh || !object.material
      || r.getRenderTarget() !== null || r.getOutputRenderTarget() !== null
      || (framebuffer && r.needsFrameBufferTarget) || r.xr?.isPresenting || backend.trackTimestamp) {
      return scene.call(r, object, camera, framebuffer);
    }
    root = object; ready = null; phase = 1;
    try {
      // This executes normal updateBefore/updateAfter and offscreen scene/effect passes,
      // but emits no canvas commands. It allocates no staging render target.
      scene.call(r, object, camera, framebuffer);
      const prepared = ready as Object | null;
      if (pending() || !prepared || prepared.material !== object.material
        || prepared.material.version !== version || prepared.object.geometry !== object.geometry) {
        skipped = true; return;
      }
      // Dependencies already ran in their original node-frame scope. Only present now;
      // running temporal updates twice would advance history twice in one frame.
      phase = 2;
      return scene.call(r, object, camera, framebuffer);
    } finally { phase = 0; root = null; ready = null; }
  }
  function beginRender(context: Context): void { if (phase !== 1 || !canvas(context)) begin.call(backend, context); }
  function finishRender(context: Context): void { if (phase !== 1 || !canvas(context)) finish.call(backend, context); }
  function drawObject(object: Object, info: unknown): void {
    if (phase === 1 && canvas(object.context)) {
      if (object.object === root) { ready = object; version = object.material.version; }
      return;
    }
    draw.call(backend, object, info);
  }
  function updateBefore(object: Object): void { if (phase !== 2 || object !== ready) before.call(nodes, object); }
  function updateAfter(object: Object): void { if (phase !== 2 || object !== ready) after.call(nodes, object); }
  if (supported) {
    r._renderScene = renderScene; backend.beginRender = beginRender; backend.finishRender = finishRender;
    backend.draw = drawObject; nodes.updateBefore = updateBefore; nodes.updateAfter = updateAfter;
  }
  return {
    get skipped() { return skipped; },
    beginFrame() { skipped = false; },
    synchronous<T>(fn: () => T): T { atomic++; try { return fn(); } finally { atomic--; } },
    dispose() {
      if (disposed) return; disposed = true;
      if (!supported) return;
      if (r._renderScene === renderScene) r._renderScene = scene;
      if (backend.beginRender === beginRender) backend.beginRender = begin;
      if (backend.finishRender === finishRender) backend.finishRender = finish;
      if (backend.draw === drawObject) backend.draw = draw;
      if (nodes.updateBefore === updateBefore) nodes.updateBefore = before;
      if (nodes.updateAfter === updateAfter) nodes.updateAfter = after;
    },
  };
}

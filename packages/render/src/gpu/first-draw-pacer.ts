/**
 * Draw at most one never-drawn render pipeline per frame once the world is shown (WebGL2).
 *
 * A program that has linked is not yet ready to draw on every driver: Mesa (Intel, through ANGLE's GL backend) compiles
 * the variant a draw needs on its first use, on the GPU process. When the scene's set of lights changes (the lamps of a
 * building switching on at dusk, off at dawn) every lit material gets a new program at once, and the first frame that
 * drew them all held the GPU process for 2-3 s while the main thread sat idle (measured on Casa del Patio: no long task,
 * no link in that second, one frame of 2.1-2.9 s). Drawing one new pipeline per frame spreads that cost over as many
 * frames; the objects waiting for theirs are left out of those frames and come in one by one.
 *
 * Off while the host says so (the load screen is up, a capture wants every object): pipelines drawn then count as drawn.
 * Full-screen passes (post-processing quads) are never held back.
 */

interface RenderObject { pipeline?: object | null; object?: { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isQuadMesh?: boolean } }
interface Backend {
  isWebGPUBackend?: boolean;
  gl?: WebGL2RenderingContext;
  draw?(object: RenderObject, info: unknown): void;
}

export interface FirstDrawPacer {
  /** Pipelines the latest frame held back (another frame is owed to them). */
  readonly pending: number;
  /** Pipelines held back so far (diagnostics). */
  readonly deferred: number;
  dispose(): void;
}

/** New pipelines drawn per frame while pacing. */
export const NEW_PIPELINES_PER_FRAME = 1;

const NONE: FirstDrawPacer = { pending: 0, deferred: 0, dispose: () => undefined };

/**
 * Pace first draws on `backend`. `frame()` numbers the frames (one budget per frame), `active()` says whether to pace,
 * `again()` asks for another frame when draws were held back.
 */
export function installFirstDrawPacer(backend: Backend, opts: { frame: () => number; active: () => boolean; again: () => void }): FirstDrawPacer {
  const draw = backend.draw;
  if (backend.isWebGPUBackend || !backend.gl || typeof draw !== 'function') return NONE;
  if ((globalThis as { __AETHER_FIRST_DRAW_PACE?: boolean }).__AETHER_FIRST_DRAW_PACE === false) return NONE;
  const drawn = new WeakSet<object>();
  const held = new Set<object>();
  let frame = -1;
  let fresh = 0;
  let deferred = 0;
  let asked = false;
  const wrapped = function (this: unknown, ro: RenderObject, info: unknown): void {
    const f = opts.frame();
    if (f !== frame) {
      frame = f;
      fresh = 0;
      held.clear();
    }
    const p = ro.pipeline;
    if (p && !drawn.has(p)) {
      const o = ro.object;
      const paced = o && o.isQuadMesh !== true && (o.isMesh === true || o.isPoints === true || o.isLine === true) && opts.active();
      if (paced) {
        if (fresh >= NEW_PIPELINES_PER_FRAME) {
          if (!held.has(p)) {
            held.add(p);
            deferred++;
          }
          if (!asked) {
            asked = true;
            setTimeout(() => {
              asked = false;
              opts.again();
            }, 0);
          }
          return;
        }
        fresh++;
      }
      drawn.add(p);
    }
    return draw.call(this, ro, info);
  };
  backend.draw = wrapped;
  return {
    get pending() {
      return held.size;
    },
    get deferred() {
      return deferred;
    },
    dispose(): void {
      if (backend.draw === wrapped) backend.draw = draw;
    },
  };
}

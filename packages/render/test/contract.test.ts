import { describe, expect, it } from 'vitest';
import * as render from '../src/index';

describe('@aether/render public contract', () => {
  it('exports WorldRenderer with the contract API', () => {
    const W = render.WorldRenderer;
    expect(typeof W.create).toBe('function');
    for (const m of [
      'setWorld', 'getGeneratorOutput', 'applyTransforms', 'setEntityProperty', 'addTransient', 'removeTransient', 'setCameraMode',
      'setPlayerAvatar', 'focus', 'pick', 'highlight', 'showGhost', 'showDebug', 'screenshot', 'renderViews', 'render', 'resize', 'stats', 'dispose',
    ]) {
      expect(typeof (W.prototype as unknown as Record<string, unknown>)[m], m).toBe('function');
    }
    expect(Object.getOwnPropertyDescriptor(W.prototype, 'camera')?.get).toBeTypeOf('function');
  });

  it('exports the GPU-free building blocks', () => {
    for (const name of ['SceneSync', 'MaterialCache', 'GeometryCache', 'computeSkyState', 'scatterPlacements', 'createProcgenGeometrySource', 'EnvironmentRig', 'isSafeModelUrl']) {
      expect((render as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it('create() rejects cleanly without a GPU/DOM (Node)', async () => {
    await expect(render.WorldRenderer.create({} as HTMLCanvasElement, { preferWebGPU: false })).rejects.toBeDefined();
  });
});

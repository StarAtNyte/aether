import { describe, expect, it } from 'vitest';
import * as render from '../src/index';
describe('@aether/render public contract', () => {
    it('exports WorldRenderer with the contract API', () => {
        const W = render.WorldRenderer;
        expect(typeof W.create).toBe('function');
        for (const m of [
            'setWorld', 'getGeneratorOutput', 'applyTransforms', 'setEntityProperty', 'addTransient', 'removeTransient', 'setCameraMode',
            'setPlayerAvatar', 'focus', 'pick', 'highlight', 'showGhost', 'showDebug', 'screenshot', 'renderViews', 'render', 'resize', 'stats', 'dispose',
            'frameContent', 'frameSphere', 'reveal', 'requestRender', 'setLowPower', 'clearRuntimeOverrides',
        ]) {
            expect(typeof W.prototype[m], m).toBe('function');
        }
        for (const getter of ['camera', 'contentSphere', 'cameraFlying', 'fogState']) {
            expect(Object.getOwnPropertyDescriptor(W.prototype, getter)?.get, getter).toBeTypeOf('function');
        }
    });
    it('exports the GPU-free building blocks', () => {
        for (const name of [
            'SceneSync', 'MaterialCache', 'GeometryCache', 'computeSkyState', 'scatterPlacements', 'createProcgenGeometrySource', 'EnvironmentRig', 'isSafeModelUrl',
            'contentFraming', 'framingPose', 'collectFramingItems', 'resolveFog', 'GrowIn', 'SurfaceTextures', 'boxProjectedUvs', 'sunBearing',
        ]) {
            expect(render[name], name).toBeDefined();
        }
    });
    it('create() rejects cleanly without a GPU/DOM (Node)', async () => {
        await expect(render.WorldRenderer.create({}, { preferWebGPU: false })).rejects.toBeDefined();
    });
});

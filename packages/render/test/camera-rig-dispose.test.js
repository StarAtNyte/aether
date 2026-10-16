import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraRig } from '../src/view/camera-rig';
describe('CameraRig.dispose', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('removes the key interceptors from document even though three removed them from the detached canvas', () => {
        const removed = [];
        vi.stubGlobal('document', { removeEventListener: (type, fn, opts) => removed.push({ type, fn, opts }) });
        const down = () => undefined;
        const up = () => undefined;
        const controls = {
            enabled: true,
            enableDamping: false,
            dampingFactor: 0,
            target: new Vector3(),
            update: () => false,
            dispose: vi.fn(),
            _interceptControlDown: down,
            _interceptControlUp: up,
        };
        new CameraRig(new PerspectiveCamera(), controls).dispose();
        expect(controls.dispose).toHaveBeenCalledOnce();
        expect(removed).toEqual([
            { type: 'keydown', fn: down, opts: { capture: true } },
            { type: 'keyup', fn: up, opts: { capture: true } },
        ]);
    });
    it('is a no-op without controls or without a document', () => {
        expect(() => new CameraRig(new PerspectiveCamera(), null).dispose()).not.toThrow();
        vi.stubGlobal('document', undefined);
        const controls = { enabled: true, enableDamping: false, dampingFactor: 0, target: new Vector3(), update: () => false, dispose: vi.fn() };
        expect(() => new CameraRig(new PerspectiveCamera(), controls).dispose()).not.toThrow();
    });
});

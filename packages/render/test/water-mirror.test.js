/**
 * The planar mirror and the wind: the mirror camera is the real camera reflected about the water plane (so what the
 * water shows is what a real mirror would), nothing is drawn from below the surface, hidden materials come back, and the
 * wind uniforms drive the vegetation sway and the water together.
 */
import { describe, expect, it } from 'vitest';
import { Matrix4, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGPUCoordinateSystem } from 'three';
import { PlanarMirror } from '../src/materials/planar-mirror';
import { applyWind, windGain, WIND_CALM_GAIN } from '../src/materials/wind';
import { currentWind, resetWater, setWind } from '../src/materials/water-state';
function stubRenderer(calls, hide) {
    const state = { target: null };
    return {
        coordinateSystem: WebGPUCoordinateSystem,
        getDrawingBufferSize: (v) => v.set(1600, 900),
        getRenderTarget: () => state.target,
        getOutputRenderTarget: () => null,
        getMRT: () => null,
        setMRT: () => undefined,
        setRenderTarget: (t) => void (state.target = t),
        autoClear: false,
        render: (_scene, camera) => void calls.push({ camera: camera.clone(), hiddenDuring: hide.map((h) => !h.visible) }),
    };
}
describe('planar mirror', () => {
    it('renders from the camera reflected about the water plane, at half size, and restores what it hid', () => {
        const mirror = new PlanarMirror();
        const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 500);
        camera.position.set(3, 6, 10);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const water = new MeshStandardMaterial();
        const calls = [];
        const drawn = mirror.render(stubRenderer(calls, [water]), new Scene(), camera, 1, [water]);
        expect(drawn).toBe(true);
        expect(mirror.ready).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.hiddenDuring).toEqual([true]);
        expect(water.visible).toBe(true);
        expect(mirror.target.width).toBe(800);
        expect(mirror.target.height).toBe(450);
        const m = calls[0].camera;
        // Position: y = 2 * 1 - 6 = -4, x and z unchanged.
        expect(m.position.x).toBeCloseTo(3, 5);
        expect(m.position.y).toBeCloseTo(-4, 5);
        expect(m.position.z).toBeCloseTo(10, 5);
        // The view direction is mirrored: the real camera looks down, the mirror camera up.
        const real = new Vector3();
        camera.getWorldDirection(real);
        const virt = new Vector3();
        m.getWorldDirection(virt);
        expect(virt.y).toBeCloseTo(-real.y, 4);
        expect(virt.x).toBeCloseTo(real.x, 4);
        expect(virt.z).toBeCloseTo(real.z, 4);
        // Oblique near plane: the projection's third row was rewritten (differs from the plain projection).
        expect(m.projectionMatrix.elements[2]).not.toBe(camera.projectionMatrix.elements[2]);
        mirror.dispose();
    });
    it('draws nothing from below the surface or exactly at it', () => {
        const mirror = new PlanarMirror();
        const camera = new PerspectiveCamera();
        camera.position.set(0, 0.5, 5);
        camera.updateMatrixWorld();
        const calls = [];
        expect(mirror.render(stubRenderer(calls, []), new Scene(), camera, 1, [])).toBe(false);
        expect(mirror.render(stubRenderer(calls, []), new Scene(), camera, 0.5, [])).toBe(false);
        expect(calls).toHaveLength(0);
        expect(mirror.ready).toBe(false);
    });
    it('restores hidden materials even when the render throws', () => {
        const mirror = new PlanarMirror();
        const camera = new PerspectiveCamera();
        camera.position.set(0, 5, 5);
        camera.updateMatrixWorld();
        const water = new MeshStandardMaterial();
        const renderer = stubRenderer([], [water]);
        renderer.render = () => {
            throw new Error('gpu lost');
        };
        expect(() => mirror.render(renderer, new Scene(), camera, 0, [water])).toThrow('gpu lost');
        expect(water.visible).toBe(true);
        void Matrix4;
    });
});
describe('wind', () => {
    it('sways vegetation more in a stronger wind, and never stands dead still', () => {
        expect(windGain(0)).toBeCloseTo(WIND_CALM_GAIN, 6);
        expect(windGain(10)).toBeGreaterThan(windGain(2));
        expect(windGain(1000)).toBe(windGain(30));
        expect(windGain(-5)).toBe(windGain(0));
    });
    it('puts the same node on every vegetation material and reads the shared wind', () => {
        resetWater();
        const a = new MeshStandardMaterial();
        const b = new MeshStandardMaterial();
        applyWind(a);
        applyWind(b);
        expect(a.positionNode).toBeTruthy();
        expect(a.positionNode).toBe(b.positionNode);
        expect(setWind(9, 180)).toBe(true);
        const w = currentWind();
        expect(w.speed).toBe(9);
        // Heading 180 blows toward +Z.
        expect(w.z).toBeCloseTo(1, 5);
        expect(w.x).toBeCloseTo(0, 5);
        resetWater();
    });
    it('clamps hostile wind values', () => {
        expect(setWind(Number.POSITIVE_INFINITY, Number.NaN)).toBeTypeOf('boolean');
        expect(currentWind().speed).toBeLessThanOrEqual(30);
        setWind(-4, 0);
        expect(currentWind().speed).toBe(0);
        resetWater();
    });
});

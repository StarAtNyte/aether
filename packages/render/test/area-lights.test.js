import { afterEach, describe, expect, it } from 'vitest';
import { RectAreaLight, SpotLight, Vector3 } from 'three';
import { LightSpec } from '@aether/core';
import { areaLightsReady, createEntityLight, disposeProfileTextures, loadAreaLights, LOCAL_AREA_SCALE, PROFILE_TEXELS, profileIntensity, profilePixels, registerLightSupport, updateLightParams, } from '../src/sync/lights';
const PROFILES = ['soft', 'downlight', 'narrow', 'wash', 'batwing'];
afterEach(() => disposeProfileTextures());
describe('light profiles', () => {
    it('are bounded in [0, 1], reach 0 at the cone edge and stay 0 outside it', () => {
        const alpha = (40 * Math.PI) / 180;
        for (const p of PROFILES) {
            let peak = 0;
            for (let i = 0; i <= 200; i++) {
                const v = profileIntensity(p, (i / 200) * alpha, alpha);
                expect(v, p).toBeGreaterThanOrEqual(0);
                expect(v, p).toBeLessThanOrEqual(1);
                peak = Math.max(peak, v);
            }
            expect(peak, p).toBeGreaterThan(0.9);
            expect(profileIntensity(p, alpha, alpha), p).toBe(0);
            expect(profileIntensity(p, alpha * 1.5, alpha), p).toBe(0);
            expect(profileIntensity(p, 0.1, 0), p).toBe(0);
        }
    });
    it('have the characters their names promise', () => {
        const a = (50 * Math.PI) / 180;
        const at = (p, t) => profileIntensity(p, t * a, a);
        // A narrow beam falls off faster than a soft one; a downlight stays flat near the axis.
        expect(at('narrow', 0.5)).toBeLessThan(at('soft', 0.5));
        expect(at('downlight', 0.3)).toBeCloseTo(1, 5);
        // A wash never drops to zero inside the cone; a batwing is dimmer on the axis than on its ring.
        expect(at('wash', 0.2)).toBeGreaterThan(0.3);
        expect(at('batwing', 0)).toBeLessThan(at('batwing', 0.45));
        expect(at('batwing', 0)).toBeGreaterThan(0.4);
    });
    it('bake into 8-bit texels over 0…π, and the cone angle changes the bake', () => {
        const px = profilePixels('soft', 30);
        expect(px.length).toBe(PROFILE_TEXELS);
        expect(px[0]).toBeGreaterThan(250);
        expect(px[PROFILE_TEXELS - 1]).toBe(0);
        // Texel 45 is 45° off the axis: outside a 30° cone, inside a 60° one.
        expect(px[45]).toBe(0);
        expect(profilePixels('soft', 60)[45]).toBeGreaterThan(0);
        // Out-of-range angles are clamped, never NaN.
        expect(profilePixels('soft', Number.NaN).every((v) => Number.isFinite(v))).toBe(true);
        expect(profilePixels('soft', 500)[0]).toBeGreaterThan(250);
    });
});
describe('area lights', () => {
    it('are rectangular panels of the requested size facing down (local −Y), without shadows', () => {
        const { light } = createEntityLight(LightSpec.parse({ type: 'area', intensity: 2, size: [3, 0.5], color: '#ffeedd' }));
        expect(light).toBeInstanceOf(RectAreaLight);
        const area = light;
        expect(area.width).toBe(3);
        expect(area.height).toBe(0.5);
        expect(area.intensity).toBeCloseTo(2 * LOCAL_AREA_SCALE);
        expect(light.castShadow).toBe(false);
        area.updateMatrixWorld(true);
        // The panel's emission axis (local −Z of a RectAreaLight) points down after the mounting rotation.
        const dir = new Vector3(0, 0, -1).transformDirection(area.matrixWorld);
        expect(dir.y).toBeCloseTo(-1, 5);
    });
    it('default to 1 × 1 m, scale their intensity with the lamp scale and update in place', () => {
        const { light } = createEntityLight(LightSpec.parse({ type: 'area' }), 0.5);
        const area = light;
        expect([area.width, area.height]).toEqual([1, 1]);
        expect(area.intensity).toBeCloseTo(LOCAL_AREA_SCALE * 0.5);
        updateLightParams(light, { type: 'area', intensity: 3, color: '#ff0000' }, 0.5);
        expect(light.intensity).toBeCloseTo(3 * LOCAL_AREA_SCALE * 0.5);
        expect(light.color.getHexString()).toBe('ff0000');
    });
    it('validate their size', () => {
        expect(() => LightSpec.parse({ type: 'area', size: [0, 1] })).toThrow();
        expect(() => LightSpec.parse({ type: 'area', size: [1, 500] })).toThrow();
        expect(() => LightSpec.parse({ type: 'area', size: [1] })).toThrow();
        expect(LightSpec.parse({ type: 'point' }).size).toBeUndefined();
    });
    it('need their lookup tables: unsupported without a registered loader, loaded once with one', async () => {
        registerLightSupport({ loadArea: undefined });
        await expect(loadAreaLights()).rejects.toThrow();
        let loads = 0;
        registerLightSupport({
            loadArea: async () => {
                loads++;
            },
        });
        expect(areaLightsReady()).toBe(false);
        await Promise.all([loadAreaLights(), loadAreaLights()]);
        await loadAreaLights();
        expect(areaLightsReady()).toBe(true);
        expect(loads).toBe(1);
    });
});
describe('spot light profiles', () => {
    it('use the registered IES spot light with a baked profile, else the plain cone', () => {
        const plain = createEntityLight(LightSpec.parse({ type: 'spot', profile: 'batwing' })).light;
        expect(plain.constructor).toBe(SpotLight);
        class FakeIes extends SpotLight {
            iesMap = null;
        }
        registerLightSupport({ ies: FakeIes });
        const profiled = createEntityLight(LightSpec.parse({ type: 'spot', profile: 'batwing', angle: 35 })).light;
        expect(profiled).toBeInstanceOf(FakeIes);
        expect(profiled.iesMap).not.toBeNull();
        const again = createEntityLight(LightSpec.parse({ type: 'spot', profile: 'batwing', angle: 35 })).light;
        expect(again.iesMap).toBe(profiled.iesMap);
        const unprofiled = createEntityLight(LightSpec.parse({ type: 'spot' })).light;
        expect(unprofiled).not.toBeInstanceOf(FakeIes);
        expect(() => LightSpec.parse({ type: 'spot', profile: 'laser' })).toThrow();
    });
});

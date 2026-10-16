import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataTexture, DataUtils, FloatType, HalfFloatType, RGBAFormat, Scene, Texture } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { AUTO_HDRI, EnvironmentRig } from '../src/environment/environment-rig';
import { clampRadiance, hdriRotationFor, hdriSun, HDRI_SUN_CLAMP } from '../src/environment/hdri';
import { MaterialCache } from '../src/materials/material-cache';
import { setCatalog } from '@aether/assets';
import { tick } from './helpers';
/** A W×H float RGBA equirect with a flat sky of `sky` and one bright texel (the sun) at (sx, sy). */
function skyTexture(w, h, sx, sy, sunValue, sky = 0.5, half = false) {
    const n = w * h * 4;
    const data = half ? new Uint16Array(n) : new Float32Array(n);
    const put = (i, v) => {
        data[i] = half ? DataUtils.toHalfFloat(v) : v;
    };
    for (let i = 0; i < w * h; i++) {
        put(i * 4, sky);
        put(i * 4 + 1, sky);
        put(i * 4 + 2, sky);
        put(i * 4 + 3, 1);
    }
    const o = (sy * w + sx) * 4;
    put(o, sunValue);
    put(o + 1, sunValue * 0.9);
    put(o + 2, sunValue * 0.8);
    return new DataTexture(data, w, h, RGBAFormat, half ? HalfFloatType : FloatType);
}
describe('hdriSun', () => {
    it('finds the brightest texel and turns it into azimuth and elevation (rows run top first)', () => {
        const w = 64;
        const h = 32;
        // Column 48 of 64 is u = 0.758 → azimuth +0.258 · 2π; row 8 of 32 is 0.266 from the top → +42° elevation.
        const sun = hdriSun(skyTexture(w, h, 48, 8, 100));
        expect(sun).not.toBeNull();
        expect(sun.azimuth).toBeCloseTo(((48.5 / 64 - 0.5) * Math.PI * 2), 6);
        expect(sun.elevation).toBeCloseTo((0.5 - 8.5 / 32) * Math.PI, 6);
        expect(sun.elevation).toBeGreaterThan(0);
        const d = sun.direction;
        expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 6);
        expect(d[1]).toBeCloseTo(Math.sin(sun.elevation), 6);
        expect(sun.peak).toBeCloseTo((100 + 90 + 80) / 3, 4);
    });
    it('reads half-float textures too', () => {
        const sun = hdriSun(skyTexture(32, 16, 3, 12, 40, 0.5, true));
        expect(sun.elevation).toBeLessThan(0);
        expect(sun.azimuth).toBeLessThan(0);
    });
    it('is null without readable pixel data', () => {
        expect(hdriSun(new Texture())).toBeNull();
        expect(hdriSun(skyTexture(2, 1, 0, 0, 1))).toBeNull();
        const black = new DataTexture(new Float32Array(16 * 4), 4, 4, RGBAFormat, FloatType);
        expect(hdriSun(black)).toBeNull();
    });
    it('finds the sun of the bundled HDRIs where their names say it is (regression: the rows are top-first)', () => {
        const dir = fileURLToPath(new URL('../../../assets/lib/h/', import.meta.url));
        const file = (prefix) => join(dir, readdirSync(dir).find((n) => n.startsWith(prefix)));
        const sunOf = (prefix) => {
            const buf = readFileSync(file(prefix));
            const parsed = new HDRLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
            return hdriSun(new DataTexture(parsed.data, parsed.width, parsed.height, RGBAFormat, parsed.type));
        };
        // "Kloofendal 48d Partly Cloudy": the sun stands 48° above the horizon.
        const cloudy = sunOf('sky-partly-cloudy');
        expect((cloudy.elevation * 180) / Math.PI).toBeGreaterThan(44);
        expect((cloudy.elevation * 180) / Math.PI).toBeLessThan(52);
        // Venice at sunset: the sun is a few degrees above the horizon.
        const venice = sunOf('sky-venice-sunset');
        expect((venice.elevation * 180) / Math.PI).toBeGreaterThan(0);
        expect((venice.elevation * 180) / Math.PI).toBeLessThan(12);
        expect(cloudy.peak).toBeGreaterThan(HDRI_SUN_CLAMP);
    });
});
describe('clampRadiance', () => {
    it('caps texels above the limit, keeping their colour, and leaves the sky alone', () => {
        const tex = skyTexture(16, 8, 5, 2, 1000);
        const changed = clampRadiance(tex, 10);
        expect(changed).toBe(1);
        const data = tex.image.data;
        const o = (2 * 16 + 5) * 4;
        expect(data[o]).toBeCloseTo(10, 5);
        expect(data[o + 1] / data[o]).toBeCloseTo(0.9, 5);
        expect(data[o + 2] / data[o]).toBeCloseTo(0.8, 5);
        expect(data[0]).toBeCloseTo(0.5, 6);
        expect(clampRadiance(tex, 10)).toBe(0);
    });
    it('works on half floats and survives bad input', () => {
        const tex = skyTexture(16, 8, 1, 1, 500, 0.4, true);
        expect(clampRadiance(tex, 8)).toBe(1);
        const data = tex.image.data;
        expect(DataUtils.fromHalfFloat(data[(1 * 16 + 1) * 4])).toBeCloseTo(8, 1);
        expect(clampRadiance(new Texture(), 8)).toBe(0);
        expect(clampRadiance(tex, 0)).toBe(0);
        expect(clampRadiance(tex, Number.NaN)).toBe(0);
    });
});
describe('hdriRotationFor', () => {
    it('turns the HDRI sun onto the sun light and wraps to (−π, π]', () => {
        // Sun light along +z (azimuth π/2), HDRI sun along +x (azimuth 0): a quarter turn the other way round (an
        // object turned by +a about +y has its azimuth reduced by a).
        expect(hdriRotationFor(0, 0, 1)).toBeCloseTo(-Math.PI / 2, 6);
        expect(hdriRotationFor(Math.PI / 2, 0, 1)).toBeCloseTo(0, 6);
        const r = hdriRotationFor(3, -1, 0);
        expect(r).toBeLessThanOrEqual(Math.PI);
        expect(r).toBeGreaterThan(-Math.PI);
        // Turning the HDRI by the result (azimuth −= r) lands on the light azimuth.
        expect(Math.atan2(Math.sin(3 - r), Math.cos(3 - r))).toBeCloseTo(Math.atan2(0, -1), 6);
    });
    it('is zero for a vertical light and bad input', () => {
        expect(hdriRotationFor(1, 0, 0)).toBe(0);
        expect(hdriRotationFor(Number.NaN, 1, 0)).toBe(0);
    });
});
const CATALOG = {
    version: 1,
    base: '/assets/lib/',
    packs: [{ id: 'p', title: 'P', author: 'A', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://example.org', version: '1' }],
    entries: Object.values(AUTO_HDRI).map((id) => ({ id, name: id, kind: 'hdri', category: 'sky', tags: [], style: 'realistic', pack: 'p', size: [0, 0, 0], tris: 0, bytes: 1, file: `h/${id}.00000000.hdr`, lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' })),
};
describe('automatic HDRI in the environment rig', () => {
    it('loads a photographed sky for the preset when switched on, keeps the dome as the background, cuts the sun and aligns it to the light', async () => {
        setCatalog(CATALOG);
        const requested = [];
        // The sun sits at azimuth 0 (u = 0.5 + 0.5/W): a quarter turn away from a light along +z.
        const source = {
            async load(url) {
                requested.push(url);
                return skyTexture(64, 32, 32, 8, 5000);
            },
        };
        const rig = new EnvironmentRig(new MaterialCache(), true, source);
        const scene = new Scene();
        rig.apply({ sky: 'day', sunIntensity: 2.5, ambientIntensity: 0.4 }, scene);
        await tick(10);
        expect(requested).toEqual([]);
        expect(rig.hdri.texture).toBeNull();
        rig.setAutoHdri(true);
        await tick(20);
        expect(requested).toEqual([`/assets/lib/h/${AUTO_HDRI['day']}.00000000.hdr`]);
        expect(rig.hdri.texture).not.toBeNull();
        // Lighting only: the analytic dome stays visible, no photographic background.
        expect(scene.environment).toBe(rig.hdri.texture);
        expect(scene.background).toBeNull();
        expect(rig.sky.group.visible).toBe(true);
        // The sun disc was cut down to the sky's level.
        const data = rig.hdri.texture.image.data;
        expect(Math.max(...Array.from(data).slice(0, 4096))).toBeLessThanOrEqual(HDRI_SUN_CLAMP + 1e-3);
        // And the map was turned so its sun matches the light.
        const l = rig.skyState.lightDirection;
        const expected = hdriRotationFor(rig.hdri.sun.azimuth, l[0], l[2]);
        expect(scene.environmentRotation.y).toBeCloseTo(expected, 6);
        // Switching off restores the analytic sky map and no rotation.
        rig.setAutoHdri(false);
        await tick(10);
        expect(rig.hdri.texture).toBeNull();
        expect(scene.environmentRotation.y).toBe(0);
    });
    it('never replaces a world HDRI, and space has none', async () => {
        setCatalog(CATALOG);
        const requested = [];
        const source = {
            async load(url) {
                requested.push(url);
                return skyTexture(16, 8, 4, 2, 50);
            },
        };
        const rig = new EnvironmentRig(new MaterialCache(), true, source);
        const scene = new Scene();
        rig.setAutoHdri(true);
        rig.apply({ sky: 'day', hdri: 'sky-moonlit', sunIntensity: 2.5, ambientIntensity: 0.4 }, scene);
        await tick(20);
        expect(requested).toEqual([`/assets/lib/h/sky-moonlit.00000000.hdr`].filter(() => Object.values(AUTO_HDRI).includes('sky-moonlit')));
        rig.apply({ sky: 'space', sunIntensity: 2.5, ambientIntensity: 0.4 }, scene);
        await tick(10);
        expect(rig.hdri.texture).toBeNull();
        expect(AUTO_HDRI['space']).toBeUndefined();
    });
});

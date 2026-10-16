import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera } from 'three';
import { spritePixels, streakPixels, WEATHER_CONFIGS, WeatherSystem } from '../src/environment/weather';
function column(m, k, c) {
    return [m[k + c * 4], m[k + c * 4 + 1], m[k + c * 4 + 2]];
}
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function camera() {
    const cam = new PerspectiveCamera();
    cam.position.set(3, 2, 5);
    cam.lookAt(0, 1, 0);
    cam.updateMatrixWorld();
    return cam;
}
describe('weather sprites', () => {
    it('snow, dust and fireflies are camera-facing soft sprites at their configured size', () => {
        for (const kind of ['snow', 'dust', 'fireflies']) {
            const parent = new Group();
            const w = new WeatherSystem(parent);
            w.set(kind);
            const mesh = parent.children[0];
            const cam = camera();
            w.update(0.1, cam);
            const m = mesh.instanceMatrix.array;
            const e = cam.matrixWorld.elements;
            const right = [e[0], e[1], e[2]];
            const back = [e[8], e[9], e[10]];
            const cfg = WEATHER_CONFIGS[kind];
            for (let i = 0; i < 12; i++) {
                const k = i * 16;
                const c0 = column(m, k, 0);
                const c2 = column(m, k, 2);
                // The quad's normal is the camera's back axis; its width axis is the camera's right axis.
                expect(dot(c2, back)).toBeCloseTo(1, 5);
                expect(dot(c0, right) / len(c0)).toBeCloseTo(1, 5);
                // Size: the configured width (fireflies pulse between 5 % and 100 % of it).
                expect(len(c0)).toBeLessThanOrEqual(cfg.size[0] + 1e-6);
                if (!cfg.flicker)
                    expect(len(c0)).toBeCloseTo(cfg.size[0], 6);
            }
            const material = mesh.material;
            expect(material.map).not.toBeNull();
            expect(material.transparent).toBe(true);
            w.dispose();
        }
    });
    it('rain is a streak along the fall direction that still faces the camera', () => {
        const parent = new Group();
        const w = new WeatherSystem(parent);
        w.set('rain');
        const mesh = parent.children[0];
        const cam = camera();
        w.update(0.1, cam);
        const m = mesh.instanceMatrix.array;
        const [vx, vy, vz] = WEATHER_CONFIGS.rain.velocity;
        const vl = Math.hypot(vx, vy, vz);
        const back = [cam.matrixWorld.elements[8], cam.matrixWorld.elements[9], cam.matrixWorld.elements[10]];
        for (let i = 0; i < 10; i++) {
            const k = i * 16;
            const up = column(m, k, 1);
            // The tail points up the fall direction, scaled to the streak length.
            expect(dot(up, [-vx / vl, -vy / vl, -vz / vl]) / len(up)).toBeCloseTo(1, 5);
            expect(len(up)).toBeCloseTo(WEATHER_CONFIGS.rain.size[1], 6);
            const right = column(m, k, 0);
            expect(len(right)).toBeCloseTo(WEATHER_CONFIGS.rain.size[0], 6);
            expect(dot(right, up)).toBeCloseTo(0, 6);
            // The quad faces the camera as well as an axis-aligned streak can.
            const normal = column(m, k, 2);
            expect(dot(normal, back)).toBeGreaterThan(0.4);
        }
        w.dispose();
    });
    it('releases the sprite texture with the particles', () => {
        const parent = new Group();
        const w = new WeatherSystem(parent);
        w.set('fireflies');
        const mesh = parent.children[0];
        const tex = mesh.material.map;
        let disposed = false;
        tex?.addEventListener('dispose', () => (disposed = true));
        w.set('clear');
        expect(disposed).toBe(true);
    });
    it('bakes round, soft sprite and streak textures', () => {
        const glow = spritePixels(16, 'glow');
        const alpha = (x, y) => glow[(y * 16 + x) * 4 + 3];
        expect(alpha(8, 8)).toBeGreaterThan(200);
        expect(alpha(0, 0)).toBe(0);
        expect(alpha(15, 8)).toBeLessThan(alpha(11, 8));
        const flake = spritePixels(16, 'flake');
        expect(flake[(8 * 16 + 8) * 4 + 3]).toBe(255);
        const streak = streakPixels(8, 32);
        const sa = (x, y) => streak[(y * 8 + x) * 4 + 3];
        expect(sa(3, 4)).toBeGreaterThan(sa(3, 28));
        expect(sa(0, 4)).toBeLessThan(sa(3, 4));
        expect(sa(3, 31)).toBeLessThan(10);
    });
});

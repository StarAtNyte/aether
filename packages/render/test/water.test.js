/**
 * Water: scale classes, wave sets, ripple physics, surfaces found in a world, the shader attaching to a material
 * and the system that turns bodies entering water into rings and the eye below the surface into a look.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Camera, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import { WorldDoc } from '@aether/core';
import { MaterialCache } from '../src/materials/material-cache';
import { materialKey, resolveMaterial } from '../src/materials/presets';
import { inferWaterKind, maxSlope, RIPPLE, underwaterDensity, WATER_CLASSES, waterTierFor, waveSet } from '../src/materials/water-params';
import { advanceWater, currentWind, resetWater, RippleField, rippleHeightAt, setWind } from '../src/materials/water-state';
import { WATER_SHADER_KEY } from '../src/materials/water';
import { findWaterSurfaces, surfaceAt, waterKindOf, withWaterKind } from '../src/sync/water-surfaces';
import { WaterSystem } from '../src/sync/water-system';
const KINDS = ['puddle', 'pond', 'stream', 'river', 'lake', 'sea'];
afterEach(() => resetWater());
function world(entities) {
    return WorldDoc.parse({ entities });
}
const lake = {
    id: 'lake',
    name: 'Lake',
    tags: ['water'],
    transform: { position: [0, 0.04, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    shape: { kind: 'primitive', primitive: 'cylinder', size: [40, 0.08, 40] },
    material: { preset: 'water' },
};
describe('water scale classes', () => {
    it('are ordered by size: waves lengthen and clarity grows from puddle to sea', () => {
        for (let i = 1; i < KINDS.length; i++) {
            const a = WATER_CLASSES[KINDS[i - 1]];
            const b = WATER_CLASSES[KINDS[i]];
            // Streams are short and steep, rivers longer, the sea the longest.
            if (KINDS[i] !== 'stream')
                expect(b.wavelength).toBeGreaterThanOrEqual(a.wavelength);
        }
        expect(WATER_CLASSES.sea.clarity).toBeGreaterThan(WATER_CLASSES.lake.clarity);
        expect(WATER_CLASSES.lake.clarity).toBeGreaterThan(WATER_CLASSES.pond.clarity);
        expect(WATER_CLASSES.puddle.clarity).toBeLessThan(0.3);
    });
    it('flow with the current only for streams and rivers', () => {
        expect(KINDS.filter((k) => WATER_CLASSES[k].followsCurrent)).toEqual(['stream', 'river']);
        expect(WATER_CLASSES.stream.shoreFoam).toBeGreaterThan(WATER_CLASSES.lake.shoreFoam);
    });
    it('infer the class from names, tags and size, names first', () => {
        expect(inferWaterKind(2, 2, ['puddle'])).toBe('puddle');
        expect(inferWaterKind(200, 200, ['River'])).toBe('river');
        expect(inferWaterKind(9, 9, ['koi', 'pond'])).toBe('pond');
        expect(inferWaterKind(1600, 700, ['Sea'])).toBe('sea');
        expect(inferWaterKind(1600, 700, [])).toBe('sea');
        expect(inferWaterKind(2, 2, [])).toBe('puddle');
        expect(inferWaterKind(8, 8, [])).toBe('pond');
        expect(inferWaterKind(120, 100, [])).toBe('lake');
        expect(inferWaterKind(120, 8, [])).toBe('river');
        expect(inferWaterKind(30, 4, [])).toBe('stream');
        expect(inferWaterKind(Number.NaN, 3, [])).toBe('pond');
    });
});
describe('wave sets', () => {
    it('have four unit-direction waves with positive wavenumber, speed and bounded slope', () => {
        for (const kind of KINDS) {
            const set = waveSet(kind, 6, 40, [0.5, 0]);
            expect(set).toHaveLength(4);
            for (const w of set) {
                expect(Math.hypot(w.dx, w.dz)).toBeCloseTo(1, 6);
                expect(w.k).toBeGreaterThan(0);
                expect(w.omega).toBeGreaterThan(0);
                expect(w.slope).toBeGreaterThan(0);
                expect(w.slope).toBeLessThanOrEqual(0.5);
            }
        }
    });
    it('steepen with wind on open water and follow the current in a river', () => {
        const calm = maxSlope(waveSet('lake', 0, 0, [0, 0]));
        const gale = maxSlope(waveSet('lake', 20, 0, [0, 0]));
        expect(gale).toBeGreaterThan(calm * 1.4);
        // A river runs along its current whatever the wind does: the main wave heads along +X for a current toward +X.
        const river = waveSet('river', 20, 123, [1.2, 0]);
        expect(river[0]?.dx).toBeCloseTo(1, 5);
        // A lake follows the wind: heading 0 blows toward -Z.
        const lakeWaves = waveSet('lake', 5, 0, [0, 0]);
        expect(lakeWaves[0]?.dz).toBeCloseTo(-1, 5);
    });
    it('survive hostile numbers', () => {
        const set = waveSet('sea', Number.NaN, Number.POSITIVE_INFINITY, [Number.NaN, 0]);
        for (const w of set)
            expect(Number.isFinite(w.dx + w.dz + w.k + w.omega + w.slope)).toBe(true);
        expect(waveSet('sea', 1e9, 0, [0, 0])[0]?.slope).toBeLessThanOrEqual(0.5);
    });
    it('pick the tier by device', () => {
        expect(waterTierFor('software', false, true)).toBe('simple');
        expect(waterTierFor('discrete', true, true)).toBe('simple');
        expect(waterTierFor('integrated', false, true)).toBe('standard');
        expect(waterTierFor('discrete', false, true)).toBe('high');
        expect(waterTierFor('unknown', false, true)).toBe('standard');
    });
    it('see farther underwater in clearer water', () => {
        expect(underwaterDensity('sea')).toBeLessThan(underwaterDensity('pond'));
        expect(underwaterDensity('puddle')).toBeLessThanOrEqual(0.9);
    });
});
describe('water material resolution', () => {
    it('carries the class and a default current, and keys them', () => {
        const r = resolveMaterial({ preset: 'water', waterKind: 'river' });
        expect(r.water?.kind).toBe('river');
        expect(r.water?.flow[0]).toBeGreaterThan(0);
        expect(resolveMaterial({ preset: 'water', waterKind: 'sea' }).water?.flow).toEqual([0, 0]);
        expect(resolveMaterial({ preset: 'water', waterKind: 'stream', waterFlow: [0, -2] }).water?.flow).toEqual([0, -2]);
        expect(resolveMaterial({ preset: 'stone' }).water).toBeNull();
        expect(materialKey(resolveMaterial({ preset: 'water', waterKind: 'river' }))).not.toBe(materialKey(resolveMaterial({ preset: 'water', waterKind: 'lake' })));
    });
    it('refuses a made-up class or a non-finite current', () => {
        const bad = resolveMaterial({ preset: 'water', waterKind: 'swamp', waterFlow: [Number.NaN, 1] });
        expect(bad.water?.kind).toBe('lake');
        expect(bad.water?.flow).toEqual([0, 0]);
    });
    it('is rejected by the schema outside its ranges', () => {
        expect(WorldDoc.safeParse({ entities: { a: { id: 'a', material: { preset: 'water', waterFlow: [99, 0] } } } }).success).toBe(false);
        expect(WorldDoc.safeParse({ entities: { a: { id: 'a', material: { preset: 'water', waterKind: 'river', waterFlow: [1, 0] } } } }).success).toBe(true);
        expect(WorldDoc.safeParse({ environment: { wind: { speed: 40 } } }).success).toBe(false);
        expect(WorldDoc.parse({ environment: { wind: { speed: 8 } } }).environment.wind).toEqual({ speed: 8, direction: 0 });
    });
});
describe('water shader on a material', () => {
    it('attaches nodes and a retune handle on every tier, and only the classic look without a tier', () => {
        for (const tier of ['simple', 'standard', 'high']) {
            const cache = new MaterialCache();
            cache.waterTier = tier;
            const h = cache.acquire({ preset: 'water', waterKind: 'river' });
            const m = h.material;
            const shader = m.userData[WATER_SHADER_KEY];
            expect(shader?.tier).toBe(tier);
            expect(shader?.kind).toBe('river');
            expect(m.normalNode).toBeTruthy();
            expect(m.emissiveNode).toBeTruthy();
            expect(m.opacityNode).toBeTruthy();
            expect(m.transparent).toBe(true);
            expect(m.normalMap).toBeNull();
            expect(shader?.mirrored).toBe(tier === 'high');
            expect(h.key).toContain(`water:${tier}`);
            cache.dispose();
        }
        const plain = new MaterialCache();
        const m = plain.acquire({ preset: 'water' }).material;
        expect(m.userData[WATER_SHADER_KEY]).toBeUndefined();
        expect(m.normalMap).not.toBeNull();
        plain.dispose();
    });
    it('retunes its waves when the wind changes', () => {
        const cache = new MaterialCache();
        cache.waterTier = 'standard';
        const m = cache.acquire({ preset: 'water', waterKind: 'lake' }).material;
        const shader = m.userData[WATER_SHADER_KEY];
        expect(shader).toBeTruthy();
        expect(setWind(12, 90)).toBe(true);
        expect(() => cache.retuneWater()).not.toThrow();
        expect(currentWind().speed).toBe(12);
        expect(setWind(12, 90)).toBe(false);
        cache.dispose();
    });
    it('gives each tier its own cached material and shares equal ones', () => {
        const cache = new MaterialCache();
        cache.waterTier = 'standard';
        const a = cache.acquire({ preset: 'water', waterKind: 'lake' });
        const b = cache.acquire({ preset: 'water', waterKind: 'lake' });
        expect(a.material).toBe(b.material);
        cache.waterTier = 'simple';
        const c = cache.acquire({ preset: 'water', waterKind: 'lake' });
        expect(c.material).not.toBe(a.material);
        cache.dispose();
    });
});
describe('ripple field', () => {
    it('emits a ring, spreads it and lets it die', () => {
        expect(RippleField.live()).toBe(0);
        RippleField.emit(3, 4, 1);
        expect(RippleField.live()).toBe(1);
        // At the ring's radius the surface moves; far outside it does not.
        advanceWater(0.1);
        advanceWater(0.1);
        advanceWater(0.1);
        const r = RIPPLE.speed * 0.3;
        let peak = 0;
        for (let a = 0; a < 40; a++)
            peak = Math.max(peak, Math.abs(rippleHeightAt(3 + r + (a - 20) * 0.01, 4)));
        expect(peak).toBeGreaterThan(0.003);
        expect(Math.abs(rippleHeightAt(40, 40))).toBeLessThan(1e-6);
        for (let i = 0; i < 40; i++)
            advanceWater(0.1);
        expect(RippleField.expire()).toBe(0);
        expect(RippleField.live()).toBe(0);
    });
    it('merges near-simultaneous rings and reuses the oldest of twelve slots', () => {
        const a = RippleField.emit(0, 0, 0.3);
        const b = RippleField.emit(0.1, 0.1, 0.6);
        expect(b).toBe(a);
        expect(RippleField.slots()[a]?.w).toBeCloseTo(0.6, 6);
        for (let i = 0; i < RIPPLE.max + 5; i++) {
            advanceWater(0.2);
            RippleField.emit(10 + i * 3, 0, 0.5);
        }
        expect(RippleField.live()).toBeLessThanOrEqual(RIPPLE.max);
    });
    it('ignores non-finite and zero-strength requests', () => {
        expect(RippleField.emit(Number.NaN, 0, 1)).toBe(-1);
        expect(RippleField.emit(0, Number.POSITIVE_INFINITY, 1)).toBe(-1);
        expect(RippleField.emit(0, 0, 0)).toBe(-1);
        expect(RippleField.live()).toBe(0);
    });
    it('advances only by positive finite steps, capped', () => {
        advanceWater(-1);
        advanceWater(Number.NaN);
        advanceWater(0);
        expect(RippleField.slots().length).toBe(RIPPLE.max);
        const before = (RippleField.emit(0, 0, 1), RippleField.slots()[0]?.z);
        advanceWater(5);
        RippleField.emit(50, 50, 1);
        const after = RippleField.slots()[1]?.z ?? 0;
        expect(after - (before ?? 0)).toBeLessThanOrEqual(0.25 + 1e-9);
    });
});
describe('water surfaces of a world', () => {
    const w = world({
        lake,
        river: { id: 'river', name: 'River', transform: { position: [0, 0.38, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'primitive', primitive: 'plane', size: [300, 0.1, 300] }, material: { preset: 'water' } },
        rock: { id: 'rock', transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, material: { preset: 'stone' } },
    });
    it('are found with their top height, footprint and scale class, largest first', () => {
        const s = findWaterSurfaces(w);
        expect(s.map((x) => x.id)).toEqual(['river', 'lake']);
        expect(s[0]?.y).toBeCloseTo(0.38, 6);
        expect(s[0]?.kind).toBe('river');
        expect(s[1]?.y).toBeCloseTo(0.08, 6);
        expect(s[1]?.kind).toBe('lake');
        expect(s[1]?.round).toBe(true);
    });
    it('answer which water is under a point, honouring round bodies', () => {
        const s = findWaterSurfaces(w);
        expect(surfaceAt(s, 0, 0, 0.1)?.id).toBe('lake');
        expect(surfaceAt(s, 0, 0, 0.5)?.id).toBe('river');
        // The corner of the lake's bounding box is outside the round pond, inside the river plane.
        expect(surfaceAt(s, 19, 19, 0.1)?.id).toBe('river');
        expect(surfaceAt(s, 400, 0, 0)).toBeNull();
    });
    it('name the class for a spec that has none, and respect one that has', () => {
        const e = w.entities['river'];
        expect(waterKindOf(e)).toBe('river');
        expect(withWaterKind({ preset: 'water' }, e)?.waterKind).toBe('river');
        expect(withWaterKind({ preset: 'water', waterKind: 'sea' }, e)?.waterKind).toBe('sea');
        expect(withWaterKind({ preset: 'stone' }, e)?.waterKind).toBeUndefined();
        expect(withWaterKind(undefined, e)).toBeUndefined();
    });
    it('ignore templates, hidden entities and non-primitive shapes', () => {
        const odd = world({
            a: { id: 'a', template: true, shape: { kind: 'primitive', primitive: 'plane', size: [5, 0.1, 5] }, material: { preset: 'water' } },
            b: { id: 'b', visible: false, shape: { kind: 'primitive', primitive: 'plane', size: [5, 0.1, 5] }, material: { preset: 'water' } },
            c: { id: 'c', shape: { kind: 'procedural', generator: 'waterfall', params: {} }, material: { preset: 'water' } },
        });
        expect(findWaterSurfaces(odd)).toEqual([]);
    });
});
describe('water system', () => {
    const surfaces = world({ lake });
    it('splashes where a falling body enters, then stirs rings while it wades', () => {
        const sys = new WaterSystem();
        sys.setWorld(surfaces);
        const pos = new Vector3(5, 2, 0);
        sys.track('ball', (out) => {
            out.copy(pos);
            return true;
        });
        expect(sys.update(0.016)).toBe(0);
        // Falls into the water.
        let emitted = 0;
        for (let i = 0; i < 40; i++) {
            pos.y -= 0.12;
            emitted += sys.update(0.016);
        }
        expect(emitted).toBeGreaterThanOrEqual(1);
        expect(RippleField.live()).toBeGreaterThanOrEqual(1);
        // Wades along the bottom: keeps stirring, bounded by the cooldown.
        const before = RippleField.live();
        pos.y = 0.0;
        for (let i = 0; i < 120; i++) {
            pos.x += 0.03;
            advanceWater(0.016);
            sys.update(0.016);
        }
        expect(RippleField.live()).toBeGreaterThan(0);
        expect(RippleField.live()).toBeLessThanOrEqual(RIPPLE.max);
        expect(before).toBeGreaterThanOrEqual(1);
    });
    it('stirs nothing for a body that stands still, is dry, or is outside every surface', () => {
        const sys = new WaterSystem();
        sys.setWorld(surfaces);
        const standing = new Vector3(0, 0, 0);
        const dry = new Vector3(0, 5, 0);
        const far = new Vector3(500, 0, 0);
        for (const [k, v] of [['standing', standing], ['dry', dry], ['far', far]]) {
            sys.track(k, (out) => {
                out.copy(v);
                return true;
            });
        }
        let n = 0;
        for (let i = 0; i < 100; i++)
            n += sys.update(0.016);
        expect(n).toBe(0);
    });
    it('treats a teleport as no splash and forgets untracked bodies', () => {
        const sys = new WaterSystem();
        sys.setWorld(surfaces);
        const pos = new Vector3(100, 0, 0);
        sys.track('x', (out) => {
            out.copy(pos);
            return true;
        });
        sys.update(0.016);
        pos.set(0, 0, 0);
        expect(sys.update(0.016)).toBe(0);
        expect(sys.tracked).toBe(1);
        sys.untrack('x');
        expect(sys.tracked).toBe(0);
    });
    it('puts the eye under the surface with the water colour and a density that follows clarity', () => {
        const sys = new WaterSystem();
        sys.setWorld(world({ lake: { ...lake, transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } }));
        const cam = new PerspectiveCamera();
        cam.position.set(0, 3, 0);
        expect(sys.underwater(cam)).toBeNull();
        cam.position.set(0, 1, 0);
        const look = sys.underwater(cam);
        expect(look?.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(look?.density).toBeGreaterThan(0.04);
        cam.position.set(100, 1, 0);
        expect(sys.underwater(cam)).toBeNull();
        expect(sys.dominant?.id).toBe('lake');
    });
});

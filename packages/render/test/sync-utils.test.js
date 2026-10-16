import { describe, expect, it } from 'vitest';
import { AmbientLight, DirectionalLight, HemisphereLight, PointLight } from 'three';
import { Entity, LightSpec } from '@aether/core';
import { renderableIds } from '../src/sync/renderable';
import { ghostWorld } from '../src/sync/ghost';
import { parsePropertyPath, setEntityPath, MAX_PATH_DEPTH } from '../src/sync/property-path';
import { createEntityLight, enforceShadowCap, LOCAL_LIGHT_SCALE, updateLightParams } from '../src/sync/lights';
import { box, patch, world } from './helpers';
describe('renderableIds', () => {
    it('excludes templates and their descendants, tolerates missing parents', () => {
        const w = world([box('a'), { ...box('t'), template: true }, { ...box('t-child'), parent: 't' }, { ...box('t-grandchild'), parent: 't-child' }]);
        expect([...renderableIds(w)].sort()).toEqual(['a']);
        const orphan = { entities: { x: { ...Entity.parse(box('x')), parent: 'ghost' } } };
        expect([...renderableIds(orphan)]).toEqual(['x']);
    });
    it('is cycle safe', () => {
        const a = { ...Entity.parse(box('a')), parent: 'b' };
        const b = { ...Entity.parse(box('b')), parent: 'a' };
        expect(renderableIds({ entities: { a, b } }).size).toBe(0);
    });
});
describe('ghostWorld', () => {
    it('contains only added/changed entities, flattened to world space without lights/physics', () => {
        const cur = world([box('a'), { id: 'holder', transform: { position: [10, 0, 0] } }]);
        const next = patch(cur, [
            { op: 'add', entity: Entity.parse({ ...box('new', [1, 0, 0]), parent: 'holder', light: { type: 'point' }, physics: { body: 'dynamic' } }) },
            { op: 'update', id: 'a', set: { transform: { position: [0, 3, 0] } } },
        ]);
        const g = ghostWorld(cur, next);
        expect(Object.keys(g.entities).sort()).toEqual(['a', 'new']);
        const n = g.entities.new;
        expect(n.parent).toBeNull();
        expect(n.transform.position[0]).toBeCloseTo(11);
        expect(n.light).toBeUndefined();
        expect(n.physics).toBeUndefined();
        expect(Object.keys(ghostWorld(null, next).entities).sort()).toEqual(['a', 'holder', 'new']);
    });
});
describe('property paths', () => {
    it('parses aliases and rejects hostile paths', () => {
        expect(parsePropertyPath('color')).toEqual({ ok: true, segments: ['material', 'color'] });
        expect(parsePropertyPath('__proto__').ok).toBe(false);
        expect(parsePropertyPath('material.__proto__').ok).toBe(false);
        expect(parsePropertyPath('transform.prototype').ok).toBe(false);
        expect(parsePropertyPath('id').ok).toBe(false);
        expect(parsePropertyPath('parent').ok).toBe(false);
        expect(parsePropertyPath('a b').ok).toBe(false);
        expect(parsePropertyPath('').ok).toBe(false);
        expect(parsePropertyPath('x'.repeat(200)).ok).toBe(false);
        expect(parsePropertyPath(Array(MAX_PATH_DEPTH + 1).fill('state').join('.')).ok).toBe(false);
    });
    it('sets nested values on a validated copy', () => {
        const e = Entity.parse(box('a'));
        const r = setEntityPath(e, 'transform.position.1', 7);
        expect(r.ok && r.entity.transform.position).toEqual([0, 7, 0]);
        expect(e.transform.position[1]).toBe(0.5);
        const m = setEntityPath(e, 'material.emissiveIntensity', 4);
        expect(m.ok && m.entity.material?.emissiveIntensity).toBe(4);
        expect(setEntityPath(e, 'material.roughness', 5).ok).toBe(false);
        expect(setEntityPath(e, 'transform.position.9', 1).ok).toBe(false);
        expect(setEntityPath(e, 'visible.x', 1).ok).toBe(false);
        const s = setEntityPath(e, 'state.hp', 10);
        expect(s.ok && s.entity.state.hp).toBe(10);
    });
});
describe('entity lights', () => {
    it('creates the right light type and scales local light units', () => {
        expect(createEntityLight(LightSpec.parse({ type: 'point', intensity: 2 })).light).toBeInstanceOf(PointLight);
        expect(createEntityLight(LightSpec.parse({ type: 'point', intensity: 2 })).light.intensity).toBe(2 * LOCAL_LIGHT_SCALE);
        expect(createEntityLight(LightSpec.parse({ type: 'directional' })).light).toBeInstanceOf(DirectionalLight);
        expect(createEntityLight(LightSpec.parse({ type: 'ambient' })).light).toBeInstanceOf(AmbientLight);
        const hemi = createEntityLight(LightSpec.parse({ type: 'hemisphere', color: '#ffffff' })).light;
        expect(hemi.groundColor.r).toBeLessThan(1);
        const spot = createEntityLight(LightSpec.parse({ type: 'spot', angle: 30 }));
        expect(spot.target?.position.y).toBe(-1);
    });
    it('updates params in place', () => {
        const l = createEntityLight(LightSpec.parse({ type: 'point' })).light;
        updateLightParams(l, { type: 'point', intensity: 0.5, color: '#ff0000' });
        expect(l.intensity).toBe(0.5 * LOCAL_LIGHT_SCALE);
        expect(l.color.getHexString()).toBe('ff0000');
    });
    it('caps shadow casters', () => {
        const mk = (id, wants) => ({ id, wants, light: createEntityLight(LightSpec.parse({ type: 'point' })).light });
        const ambient = { id: 'amb', wants: true, light: createEntityLight(LightSpec.parse({ type: 'ambient' })).light };
        const list = [mk('z', true), mk('a', true), mk('m', false), mk('b', true), ambient];
        expect(enforceShadowCap(list)).toEqual(['a', 'b']);
        expect(list.map((c) => c.light.castShadow)).toEqual([false, true, false, true, false]);
        expect(enforceShadowCap(list, 0)).toEqual([]);
    });
});

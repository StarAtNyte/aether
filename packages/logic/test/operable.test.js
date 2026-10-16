import { describe, expect, it } from 'vitest';
import { LogicRuntime } from '../src';
import { DT, FakeHost, run, worldOf } from './helpers';
function make(entities) {
    const host = new FakeHost();
    host.player = 'avatar';
    host.place('avatar', [50, 1, 50]);
    const rt = new LogicRuntime(worldOf(entities), host);
    return { host, rt };
}
const DRAWER = {
    id: 'drawer-1',
    transform: { position: [0, 0.5, 0] },
    shape: { kind: 'primitive', primitive: 'box', size: [0.5, 0.2, 0.02] },
    behaviors: [{ type: 'operable', params: { motion: 'slide', slide: [0, 0, 0.4], duration: 0.4 } }],
};
describe('operable', () => {
    it('stays shut until it is used, then slides out and back', () => {
        const { host, rt } = make([DRAWER]);
        run(rt, 30);
        expect(rt.readState('drawer-1.open')).toBe(false);
        rt.use('drawer-1');
        run(rt, 40);
        expect(rt.readState('drawer-1.open')).toBe(true);
        expect(host.getTransform('drawer-1')?.position[2]).toBeCloseTo(0.4, 3);
        rt.use('drawer-1');
        run(rt, 40);
        expect(rt.readState('drawer-1.open')).toBe(false);
        expect(host.getTransform('drawer-1')?.position[2]).toBeCloseTo(0, 3);
    });
    it('only the used entity moves, and neither the use key nor proximity opens it', () => {
        const second = { ...DRAWER, id: 'drawer-2', transform: { position: [0, 0.8, 0] } };
        const { host, rt } = make([DRAWER, second]);
        host.place('avatar', [0, 1, 0.5]);
        for (let i = 0; i < 30; i++)
            rt.tick(DT, { ...{ forward: 0, right: 0, jump: false, action: true, pointerYawDeg: 0 }, keys: new Set(['e']) }, []);
        rt.use('drawer-2');
        run(rt, 40);
        expect(rt.readState('drawer-1.open')).toBe(false);
        expect(rt.readState('drawer-2.open')).toBe(true);
    });
    it('a use is consumed once: it does not re-toggle on later ticks', () => {
        const { rt } = make([DRAWER]);
        rt.use('drawer-1');
        run(rt, 120);
        expect(rt.readState('drawer-1.open')).toBe(true);
    });
    it('opens from a state key like a door and swings on a hinge', () => {
        const host = new FakeHost();
        host.player = 'avatar';
        host.place('avatar', [50, 1, 50]);
        const cab = {
            id: 'cab',
            transform: { position: [0, 1, 0] },
            shape: { kind: 'primitive', primitive: 'box', size: [0.4, 0.6, 0.02] },
            behaviors: [{ type: 'operable', params: { trigger: 'state', stateKey: 'unlock', motion: 'swing', swingAngle: -100, hinge: 'left', duration: 0.2 } }],
        };
        const rt = new LogicRuntime(worldOf([cab], [], { state: { unlock: true } }), host);
        run(rt, 30);
        expect(rt.readState('cab.open')).toBe(true);
        const t = host.getTransform('cab');
        // Swung about the left edge: the free (right) edge moved toward +z.
        expect(t?.position[2]).toBeGreaterThan(0.1);
    });
    it('drives its physics joint to the open position and back (physical doors and drawers)', () => {
        const { host, rt } = make([
            {
                id: 'door-p',
                transform: { position: [0, 1, 0] },
                shape: { kind: 'primitive', primitive: 'box', size: [0.9, 2, 0.04] },
                physics: { body: 'dynamic' },
                joint: { type: 'revolute', target: 'world', anchor: [-0.45, 0, 0], axis: [0, 1, 0], limits: [0, 100] },
                behaviors: [{ type: 'operable', params: { motion: 'joint', jointOpen: 95 } }],
            },
        ]);
        run(rt, 5);
        expect(host.driven).toEqual([]);
        rt.use('door-p');
        run(rt, 5);
        rt.use('door-p');
        run(rt, 5);
        expect(host.driven).toEqual([
            { id: 'door-p', target: 95 },
            { id: 'door-p', target: 0 },
        ]);
        expect(host.kinematicWrites).toBe(0);
    });
    it('ignores malformed use ids', () => {
        const { rt } = make([DRAWER]);
        rt.use('');
        rt.use('x'.repeat(200));
        run(rt, 10);
        expect(rt.readState('drawer-1.open')).toBe(false);
    });
});
describe('toggle', () => {
    it('flips on use, shows the stream while on and drives lights', () => {
        const { host, rt } = make([
            { id: 'tap', transform: { position: [0, 1, 0] }, behaviors: [{ type: 'toggle', params: { show: ['stream'], light: ['lamp'], lightIntensity: 3 } }] },
            { id: 'stream', transform: { position: [0, 0.9, 0] }, visible: false },
            { id: 'lamp', transform: { position: [0, 2, 0] }, light: { type: 'point', color: '#ffffff', intensity: 3, range: 5, castShadow: false } },
        ]);
        run(rt, 3);
        expect(rt.readState('tap.on')).toBe(false);
        expect(host.properties.find((p) => p.id === 'stream')?.value).toBe(false);
        rt.use('tap');
        run(rt, 3);
        expect(rt.readState('tap.on')).toBe(true);
        expect(host.properties.filter((p) => p.id === 'stream').map((p) => p.value)).toEqual([false, true]);
        expect(host.properties.filter((p) => p.id === 'lamp').map((p) => p.value)).toEqual([0, 3]);
        expect(host.sounds).toContain('click');
        rt.use('tap');
        run(rt, 3);
        expect(rt.readState('tap.on')).toBe(false);
    });
});

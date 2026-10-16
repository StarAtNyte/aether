import { describe, expect, it } from 'vitest';
import { BuiltinBehavior, rotateVec3 } from '@aether/core';
import { BEHAVIOR_CATALOG, LogicRuntime } from '../src';
import { DT, FakeHost, input, keys, logText, run, worldOf } from './helpers';
function make(entities, opts = {}) {
    const host = new FakeHost();
    const w = worldOf(entities, opts.rules ?? [], opts.extra ?? {});
    if (opts.player !== null) {
        host.player = 'avatar';
        host.place('avatar', opts.player ?? [100, 1, 100]);
    }
    const rt = new LogicRuntime(w, host);
    return { host, rt };
}
const pos = (host, id) => {
    const t = host.getTransform(id);
    if (!t)
        throw new Error(`no transform for ${id}`);
    return t.position;
};
/** Heading (deg) of the entity's −Z forward axis; 0 = facing −Z, +90 = facing −X (CCW from above). */
const yaw = (host, id) => {
    const t = host.getTransform(id);
    if (!t)
        throw new Error(`no transform for ${id}`);
    const f = rotateVec3(t.quaternion, [0, 0, -1]);
    return (Math.atan2(-f[0], -f[2]) * 180) / Math.PI;
};
const close = (a, b, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);
describe('catalog', () => {
    it('documents every built-in behavior with params', () => {
        expect(BEHAVIOR_CATALOG.map((e) => e.type)).toEqual(BuiltinBehavior.options);
        for (const entry of BEHAVIOR_CATALOG) {
            expect(entry.description.length).toBeGreaterThan(20);
            for (const [name, spec] of Object.entries(entry.params)) {
                expect(name).toMatch(/^[a-zA-Z]+$/);
                expect(spec.default).not.toBeUndefined();
                if (spec.type === 'enum')
                    expect(spec.options).toContain(spec.default);
            }
        }
        expect(BEHAVIOR_CATALOG.find((e) => e.type === 'vehicle')?.requires).toMatch(/dynamic/);
    });
});
describe('kinematic motion', () => {
    it('spin rotates around the axis at speed deg/s', () => {
        const { host, rt } = make([{ id: 'coin', behaviors: [{ type: 'spin', params: { speed: 90 } }] }]);
        run(rt, 30); // 0.5 s → 45°
        close(yaw(host, 'coin'), 45, 0.01);
    });
    it('bob oscillates around the base position', () => {
        const { host, rt } = make([{ id: 'b', transform: { position: [0, 2, 0] }, behaviors: [{ type: 'bob', params: { amplitude: 0.5, period: 2 } }] }]);
        run(rt, 30); // quarter period
        close(pos(host, 'b')[1], 2.5, 1e-6);
        run(rt, 60); // three quarters
        close(pos(host, 'b')[1], 1.5, 1e-6);
    });
    it('spin + bob compose into one pose per tick', () => {
        const { host, rt } = make([
            { id: 'gem', transform: { position: [1, 1, 1] }, behaviors: [{ type: 'bob', params: { amplitude: 1, period: 4 } }, { type: 'spin', params: { speed: 90 } }] },
        ]);
        run(rt, 60);
        expect(host.callsOf('setKinematic')).toHaveLength(60);
        close(pos(host, 'gem')[1], 2, 1e-6);
        close(pos(host, 'gem')[0], 1, 1e-9);
        close(yaw(host, 'gem'), 90, 0.01);
    });
    it('spin composes with patrol (moving and turning)', () => {
        const { host, rt } = make([
            { id: 'p', behaviors: [{ type: 'patrol', params: { waypoints: [[4, 0, 0]], speed: 2, face: false } }, { type: 'spin', params: { speed: 180 } }] },
        ]);
        run(rt, 60);
        close(pos(host, 'p')[0], 2, 1e-6);
        close(Math.abs(yaw(host, 'p')), 180, 0.01); // half a turn about Y
    });
    it('orbit keeps its radius around a point', () => {
        const { host, rt } = make([{ id: 'moon', transform: { position: [5, 0, 0] }, behaviors: [{ type: 'orbit', params: { center: [0, 0, 0], speed: 90 } }] }]);
        run(rt, 60);
        const p = pos(host, 'moon');
        close(Math.hypot(p[0], p[2]), 5, 1e-6);
        close(p[2], 5, 1e-3); // 90° counter-clockwise in the XZ plane (x→z)
    });
    it('orbit follows a moving center entity', () => {
        const { host, rt } = make([
            { id: 'sun', transform: { position: [0, 0, 0] }, behaviors: [{ type: 'patrol', params: { waypoints: [[10, 0, 0]], speed: 1, mode: 'once' } }] },
            { id: 'planet', transform: { position: [3, 0, 0] }, behaviors: [{ type: 'orbit', params: { center: 'sun', speed: 45 } }] },
        ]);
        run(rt, 120);
        const s = pos(host, 'sun');
        const p = pos(host, 'planet');
        close(Math.hypot(p[0] - s[0], p[2] - s[2]), 3, 0.05);
    });
    it('patrol visits waypoints in order and loops; pingpong reverses', () => {
        const { host, rt } = make([
            { id: 'g', behaviors: [{ type: 'patrol', params: { waypoints: [[2, 0, 0], [2, 0, 2]], speed: 2, mode: 'loop' } }] },
            { id: 'h', transform: { position: [0, 0, 10] }, behaviors: [{ type: 'patrol', params: { speed: 4, mode: 'pingpong' } }] },
        ]);
        run(rt, 60); // 2 m → first waypoint
        close(pos(host, 'g')[0], 2, 1e-6);
        close(pos(host, 'g')[2], 0, 1e-6);
        run(rt, 60);
        close(pos(host, 'g')[2], 2, 1e-6);
        // default route for 'h' is back and forth 4 m along +X from its start
        const xs = [];
        for (let i = 0; i < 180; i++) {
            run(rt, 1);
            xs.push(pos(host, 'h')[0]);
        }
        expect(Math.max(...xs)).toBeCloseTo(4, 5);
        expect(Math.min(...xs)).toBeCloseTo(0, 5);
    });
    it('patrol waits at waypoints', () => {
        const { host, rt } = make([{ id: 'w', behaviors: [{ type: 'patrol', params: { waypoints: [[1, 0, 0], [0, 0, 0]], speed: 10, wait: 1 } }] }]);
        run(rt, 10);
        close(pos(host, 'w')[0], 1, 1e-6);
        run(rt, 40);
        close(pos(host, 'w')[0], 1, 1e-6);
    });
    it('follow chases the player and stops at the distance', () => {
        const { host, rt } = make([{ id: 'dog', behaviors: [{ type: 'follow', params: { distance: 2, speed: 5 } }] }], { player: [10, 1, 0] });
        run(rt, 300);
        const p = pos(host, 'dog');
        close(p[0], 8, 1e-3);
        close(p[1], 0, 1e-9); // flat: stays on its height
        close(yaw(host, 'dog'), -90, 0.5); // facing +X
    });
    it('lookAt faces the target', () => {
        const { host, rt } = make([{ id: 'statue', behaviors: [{ type: 'lookAt' }] }], { player: [0, 0, 10] });
        run(rt, 1);
        close(Math.abs(yaw(host, 'statue')), 180, 0.01); // forward −Z turned to +Z
    });
    it('wander stays within radius and is deterministic', () => {
        const trace = () => {
            const { host, rt } = make([{ id: 'sheep', transform: { position: [5, 0, 5] }, behaviors: [{ type: 'wander', params: { radius: 3, speed: 2, pause: 0.2 } }] }]);
            const out = [];
            for (let i = 0; i < 600; i++) {
                run(rt, 1);
                const p = pos(host, 'sheep');
                expect(Math.hypot(p[0] - 5, p[2] - 5)).toBeLessThanOrEqual(3 + 1e-6);
                out.push(p[0], p[2]);
            }
            return out;
        };
        const a = trace();
        expect(a).toEqual(trace());
        expect(new Set(a.map((v) => v.toFixed(2))).size).toBeGreaterThan(10);
    });
    it('flee runs away from a near threat and respects the leash', () => {
        const { host, rt } = make([{ id: 'rabbit', behaviors: [{ type: 'flee', params: { radius: 6, speed: 4, leash: 5 } }] }], { player: [-2, 0, 0] });
        run(rt, 30);
        expect(pos(host, 'rabbit')[0]).toBeGreaterThan(1);
        run(rt, 300);
        expect(Math.hypot(pos(host, 'rabbit')[0], pos(host, 'rabbit')[2])).toBeLessThanOrEqual(5 + 1e-6);
    });
    it('dynamic movers are steered with velocity instead of poses', () => {
        const { host, rt } = make([{ id: 'bot', physics: { body: 'dynamic' }, behaviors: [{ type: 'follow', params: { speed: 3, distance: 1 } }] }], { player: [10, 0, 0] });
        host.place('bot', [0, 0, 0]);
        host.velocities.set('bot', [0, -2, 0]);
        run(rt, 1);
        expect(host.callsOf('setKinematic')).toHaveLength(0);
        expect(host.velocities.get('bot')).toEqual([3, -2, 0]);
    });
    it('disabled behaviors do nothing', () => {
        const { host, rt } = make([{ id: 'x', behaviors: [{ type: 'spin', enabled: false }] }]);
        run(rt, 10);
        expect(host.callsOf('setKinematic')).toHaveLength(0);
    });
});
describe('gameplay objects', () => {
    it('collectible increments score, plays a sound and is destroyed', () => {
        const { host, rt } = make([{ id: 'coin-3', transform: { position: [0, 1, 0] }, shape: { kind: 'primitive', primitive: 'cylinder', size: [0.5, 0.1, 0.5] }, behaviors: [{ type: 'collectible', params: { value: 1 } }] }], { player: [5, 1, 0], extra: { state: { score: 2 } } });
        run(rt, 2);
        expect(rt.readState('score')).toBe(2);
        host.place('avatar', [0.3, 1.2, 0]);
        run(rt, 2);
        expect(rt.readState('score')).toBe(3);
        expect(host.destroyed).toEqual(['coin-3']);
        expect(host.sounds).toEqual(['pickup']);
        expect(logText(rt.log)).toContain('coin-3 collected by avatar → score 2→3');
        run(rt, 5);
        expect(rt.readState('score')).toBe(3);
    });
    it('collectible with respawn hides and reappears', () => {
        const { host, rt } = make([{ id: 'gem', behaviors: [{ type: 'collectible', params: { scoreKey: 'gems', value: 5, respawn: 1 } }] }], { player: [0, 0, 0] });
        run(rt, 1);
        expect(rt.readState('gems')).toBe(5);
        expect(host.properties.at(-1)).toEqual({ id: 'gem', path: 'visible', value: false });
        run(rt, 30);
        expect(rt.readState('gems')).toBe(5); // hidden, player still standing there
        host.place('avatar', [50, 0, 0]);
        run(rt, 40);
        expect(host.properties.at(-1)).toEqual({ id: 'gem', path: 'visible', value: true });
        host.place('avatar', [0, 0, 0]);
        run(rt, 1);
        expect(rt.readState('gems')).toBe(10);
    });
    it('collectible responds to physics sensor contacts', () => {
        const { rt } = make([{ id: 'c', transform: { position: [50, 0, 0] }, physics: { sensor: true }, behaviors: [{ type: 'collectible' }] }]);
        rt.tick(DT, input(), [{ type: 'sensorEnter', a: 'avatar', b: 'c' }]);
        expect(rt.readState('score')).toBe(1);
    });
    it('door opens by proximity (slide) and writes <id>.open', () => {
        const { host, rt } = make([{ id: 'door-1', transform: { position: [0, 1, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 0.2] }, behaviors: [{ type: 'door', params: { radius: 3, duration: 0.5 } }] }], { player: [10, 1, 0] });
        run(rt, 5);
        expect(rt.readState('door-1.open')).toBe(false);
        host.place('avatar', [0, 1, 2]);
        run(rt, 60);
        expect(rt.readState('door-1.open')).toBe(true);
        close(pos(host, 'door-1')[1], 3, 1e-6); // slid up by its height
        host.place('avatar', [10, 1, 0]);
        run(rt, 60);
        expect(rt.readState('door-1.open')).toBe(false);
        close(pos(host, 'door-1')[1], 1, 1e-6);
        expect(logText(rt.log)).toContain('door-1 opens (proximity)');
    });
    it('door opens from a state key and swings around its hinge', () => {
        const { host, rt } = make([
            {
                id: 'gate',
                transform: { position: [0, 1, 0] },
                shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 0.2] },
                behaviors: [{ type: 'door', params: { trigger: 'state', stateKey: 'unlocked', motion: 'swing', swingAngle: 90, hinge: 'left', duration: 0.25 } }],
            },
        ], { extra: { state: { unlocked: false } }, rules: [{ id: 'unlock', when: { on: 'key', key: 'u' }, then: [{ do: 'set', key: 'unlocked', value: true }] }] });
        run(rt, 30);
        expect(rt.readState('gate.open')).toBe(false);
        rt.tick(DT, keys('u'), []);
        run(rt, 30);
        expect(rt.readState('gate.open')).toBe(true);
        // Hinge at x = -1: center swings from (0,_,0) to (-1,_,-1) for +90° (CCW from above)
        const p = pos(host, 'gate');
        close(p[0], -1, 1e-6);
        close(p[2], -1, 1e-6);
        close(yaw(host, 'gate'), 90, 0.01);
    });
    it('door toggles with a key press when the player is near', () => {
        const { rt } = make([{ id: 'd', behaviors: [{ type: 'door', params: { trigger: 'key', key: 'e', radius: 3 } }] }], { player: [1, 0, 0] });
        rt.tick(DT, keys('e'), []);
        expect(rt.readState('d.open')).toBe(true);
        rt.tick(DT, keys('e'), []);
        expect(rt.readState('d.open')).toBe(true);
        rt.tick(DT, keys(), []);
        rt.tick(DT, keys('KeyE'), []);
        expect(rt.readState('d.open')).toBe(false);
    });
    it('pressurePlate is pressed while a body stands on it', () => {
        const { host, rt } = make([
            { id: 'plate', transform: { position: [0, 0.05, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [1, 0.1, 1] }, behaviors: [{ type: 'pressurePlate', params: { stateKey: 'bridge', event: 'plate-down' } }] },
            { id: 'crate', physics: { body: 'dynamic' } },
        ], { player: [20, 0, 0] });
        host.place('crate', [5, 0.5, 0]);
        run(rt, 2);
        expect(rt.readState('plate.pressed')).toBe(false);
        expect(rt.readState('bridge')).toBe(false);
        host.place('crate', [0.2, 0.6, 0.1]);
        run(rt, 1);
        expect(rt.readState('plate.pressed')).toBe(true);
        expect(rt.readState('bridge')).toBe(true);
        close(pos(host, 'plate')[1], 0, 1e-9);
        host.place('crate', [5, 0.5, 0]);
        run(rt, 1);
        expect(rt.readState('plate.pressed')).toBe(false);
        close(pos(host, 'plate')[1], 0.05, 1e-9);
    });
    it('spawner spawns on an interval and respects max', () => {
        const { host, rt } = make([
            { id: 'ball', template: true, physics: { body: 'dynamic' } },
            { id: 'gen', transform: { position: [0, 5, 0] }, behaviors: [{ type: 'spawner', params: { template: 'ball', interval: 0.5, max: 3 } }] },
        ]);
        run(rt, 300);
        expect(host.spawned.map((e) => e.id)).toEqual(['ball-1', 'ball-2', 'ball-3']);
        expect(host.spawned[0]?.transform.position).toEqual([0, 6, 0]);
        host.destroy('ball-1');
        rt.tick(DT, input(), []); // runtime doesn't know yet (host-side destroy) — still 3 alive in runtime
        expect(host.spawned).toHaveLength(3);
    });
    it('spawner replaces spawned entities destroyed by the runtime', () => {
        const { host, rt } = make([
            { id: 'mob', template: true, behaviors: [{ type: 'lifetime', params: { seconds: 0.6 } }] },
            { id: 'gen', behaviors: [{ type: 'spawner', params: { template: 'mob', interval: 0.5, max: 1 } }] },
        ]);
        run(rt, 200);
        expect(host.spawned.length).toBeGreaterThanOrEqual(3);
        expect(host.destroyed.length).toBeGreaterThanOrEqual(2);
    });
    it('lifetime destroys the entity after N seconds', () => {
        const { host, rt } = make([{ id: 'bullet', behaviors: [{ type: 'lifetime', params: { seconds: 1, event: 'gone' } }] }]);
        run(rt, 59);
        expect(host.destroyed).toEqual([]);
        run(rt, 2);
        expect(host.destroyed).toEqual(['bullet']);
    });
    it('explosive detonates on a hard hit only', () => {
        const { host, rt } = make([{ id: 'barrel', transform: { position: [1, 0, 1] }, physics: { body: 'dynamic' }, behaviors: [{ type: 'explosive', params: { threshold: 5, force: 30, radius: 4 } }] }]);
        host.place('barrel', [1, 0, 1]);
        rt.tick(DT, input(), [{ type: 'collisionStart', a: 'barrel', b: 'ground', impulse: 2 }]);
        expect(host.callsOf('explode')).toHaveLength(0);
        rt.tick(DT, input(), [{ type: 'collisionStart', a: 'rock', b: 'barrel', impulse: 9 }]);
        expect(host.callsOf('explode')[0]?.args).toEqual([[1, 0, 1], 30, 4]);
        expect(host.destroyed).toEqual(['barrel']);
        expect(host.sounds).toContain('explosion');
        expect(logText(rt.log)).toContain('exploded: hit by rock');
    });
    it('checkpoint sets the respawn point used by respawn hazards', () => {
        const { host, rt } = make([
            { id: 'cp', transform: { position: [20, 0, 0] }, behaviors: [{ type: 'checkpoint' }] },
            { id: 'spikes', transform: { position: [40, 0, 0] }, behaviors: [{ type: 'hazard', params: { mode: 'respawn' } }] },
        ], { player: [20, 0.2, 0] });
        run(rt, 1);
        expect(rt.readState('checkpoint')).toBe('cp');
        host.place('avatar', [40, 0, 0]);
        run(rt, 1);
        expect(host.callsOf('teleport').at(-1)?.args).toEqual(['avatar', [20, 1, 0]]);
    });
    it('goal wins when the player reaches it', () => {
        const { host, rt } = make([{ id: 'flag', transform: { position: [0, 0, -30] }, behaviors: [{ type: 'goal', params: { text: 'Made it!' } }] }], { player: [0, 0, 0] });
        run(rt, 5);
        expect(rt.status).toBe('playing');
        host.place('avatar', [0, 0.4, -30]);
        run(rt, 1);
        expect(rt.status).toBe('won');
        expect(host.gameOverResult).toEqual({ result: 'win', text: 'Made it!' });
    });
    it('hazard (lose) ends the game', () => {
        const { host, rt } = make([{ id: 'lava', shape: { kind: 'primitive', primitive: 'box', size: [4, 0.2, 4] }, behaviors: [{ type: 'hazard' }] }], { player: [0, 0.3, 0] });
        run(rt, 1);
        expect(rt.status).toBe('lost');
        expect(host.gameOverResult?.result).toBe('lose');
    });
    it('hazard (damage) removes health with a cooldown and loses at 0', () => {
        const { rt } = make([{ id: 'fire', behaviors: [{ type: 'hazard', params: { mode: 'damage', damage: 1, cooldown: 0.5, startHealth: 3 } }] }], { player: [0, 0, 0] });
        run(rt, 1);
        expect(rt.readState('health')).toBe(2);
        run(rt, 20);
        expect(rt.readState('health')).toBe(2);
        run(rt, 15);
        expect(rt.readState('health')).toBe(1);
        run(rt, 40);
        expect(rt.readState('health')).toBe(0);
        expect(rt.status).toBe('lost');
    });
    it('launcher launches what steps on it', () => {
        const { host, rt } = make([
            { id: 'pad', shape: { kind: 'primitive', primitive: 'cylinder', size: [2, 0.2, 2] }, behaviors: [{ type: 'launcher', params: { speed: 15 } }] },
            { id: 'ball', physics: { body: 'dynamic' } },
        ], { player: [30, 0, 0] });
        host.place('ball', [0.3, 0.5, 0]);
        run(rt, 1);
        expect(host.velocities.get('ball')).toEqual([0, 15, 0]);
        expect(host.sounds).toContain('whoosh');
    });
});
describe('input-driven behaviors', () => {
    it('playerController (dynamic) maps camera-relative input to velocity and jumps', () => {
        const { host, rt } = make([{ id: 'hero', physics: { body: 'dynamic', lockRotation: true }, behaviors: [{ type: 'playerController', params: { speed: 5, jump: 7 } }] }], { player: null });
        host.place('hero', [0, 1, 0]);
        rt.tick(DT, input({ forward: 1 }), []);
        const v = host.velocities.get('hero');
        close(v[0], 0, 1e-9);
        close(v[2], -5, 1e-9);
        rt.tick(DT, input({ right: 1, pointerYawDeg: 90 }), []);
        const v2 = host.velocities.get('hero');
        close(v2[0], 0, 1e-9);
        close(v2[2], -5, 1e-9); // camera turned left 90°: "right" is now −Z
        host.velocities.set('hero', [0, 0, 0]);
        rt.tick(DT, input({ jump: true }), []);
        expect(host.velocities.get('hero')?.[1]).toBe(7);
    });
    it('playerController respawns when falling below the threshold', () => {
        const { host, rt } = make([{ id: 'hero', physics: { body: 'dynamic' }, behaviors: [{ type: 'playerController', params: { respawnBelow: -10 } }] }], {
            player: null,
            extra: { player: { spawn: [1, 2, 3] } },
        });
        host.place('hero', [0, -11, 0]);
        run(rt, 1);
        expect(host.callsOf('teleport')[0]?.args).toEqual(['hero', [1, 2, 3]]);
    });
    it('playerController (kinematic) moves and jumps with built-in gravity', () => {
        const { host, rt } = make([{ id: 'hero', behaviors: [{ type: 'playerController', params: { speed: 6, jump: 5 } }] }], { player: null });
        run(rt, 30, input({ forward: 1 }));
        close(pos(host, 'hero')[2], -3, 1e-6);
        rt.tick(DT, input({ jump: true }), []);
        run(rt, 10);
        expect(pos(host, 'hero')[1]).toBeGreaterThan(0.5);
        run(rt, 120);
        close(pos(host, 'hero')[1], 0, 1e-9);
    });
    it('vehicle accelerates to its speed limit along its heading', () => {
        const { host, rt } = make([{ id: 'car', physics: { body: 'dynamic' }, behaviors: [{ type: 'vehicle', params: { maxSpeed: 10, acceleration: 20 } }] }], { player: null, extra: { player: { mode: 'vehicle', controls: 'car' } } });
        host.place('car', [0, 0.5, 0]);
        for (let i = 0; i < 120; i++) {
            rt.tick(DT, input({ forward: 1 }), []);
            const v = host.velocities.get('car');
            host.velocities.set('car', v);
        }
        const v = host.velocities.get('car');
        close(v[2], -10, 0.05);
        rt.tick(DT, input({ forward: 1, right: 1 }), []);
        expect(host.angular.get('car')?.[1]).toBeLessThan(0); // steering right = clockwise
    });
    it('vehicle (kinematic) drives and turns', () => {
        const { host, rt } = make([{ id: 'kart', behaviors: [{ type: 'vehicle', params: { maxSpeed: 5, acceleration: 50, always: true } }] }]);
        run(rt, 60, input({ forward: 1 }));
        expect(pos(host, 'kart')[2]).toBeLessThan(-3);
        run(rt, 30, input({ forward: 1, right: 1 }));
        expect(yaw(host, 'kart')).toBeLessThan(-10);
    });
    it('npc greets the player when near, talks, and returns to idle', () => {
        const { host, rt } = make([{ id: 'bob', name: 'Bob', behaviors: [{ type: 'npc', params: { lines: ['Hi there!', 'Nice day.', 'Mind the lava.'], greetRadius: 3, talkInterval: 1, farewell: 'Bye!', wander: false } }] }], { player: [20, 0, 0] });
        run(rt, 10);
        expect(rt.readState('bob.npcState')).toBe('idle');
        host.place('avatar', [2, 0, 0]);
        run(rt, 1);
        expect(host.messages).toEqual(['Bob: Hi there!']);
        expect(rt.readState('bob.npcState')).toBe('greet');
        run(rt, 61);
        expect(rt.readState('bob.npcState')).toBe('talk');
        expect(host.messages).toEqual(['Bob: Hi there!', 'Bob: Nice day.']);
        close(yaw(host, 'bob'), -90, 0.5); // facing the player at +X
        host.place('avatar', [30, 0, 0]);
        run(rt, 1);
        expect(rt.readState('bob.npcState')).toBe('idle');
        expect(host.messages.at(-1)).toBe('Bob: Bye!');
    });
    it('npc wanders while idle', () => {
        const { host, rt } = make([{ id: 'villager', behaviors: [{ type: 'npc', params: { wander: true, wanderRadius: 2 } }] }]);
        run(rt, 240);
        const p = pos(host, 'villager');
        expect(Math.hypot(p[0], p[2])).toBeGreaterThan(0);
        expect(Math.hypot(p[0], p[2])).toBeLessThanOrEqual(2 + 1e-6);
    });
});
describe('force fields and effects', () => {
    it('pulseLight animates light.intensity between min and max', () => {
        const { host, rt } = make([{ id: 'beacon', light: { type: 'point' }, behaviors: [{ type: 'pulseLight', params: { min: 1, max: 3, period: 1 } }] }]);
        run(rt, 60);
        const values = host.properties.filter((p) => p.path === 'light.intensity').map((p) => p.value);
        expect(values.length).toBeGreaterThan(30);
        expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...values)).toBeLessThanOrEqual(3);
        expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(1.9);
    });
    it('conveyor carries bodies on top along its (rotated) direction', () => {
        const { host, rt } = make([
            { id: 'belt', transform: { rotation: [0, 90, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [4, 0.2, 1] }, behaviors: [{ type: 'conveyor', params: { speed: 3, grip: 1000 } }] },
            { id: 'box', physics: { body: 'dynamic' } },
        ], { player: [50, 0, 0] });
        host.place('box', [0, 0.6, 0.5]);
        run(rt, 1);
        const v = host.velocities.get('box');
        close(v[0], 0, 1e-9);
        close(v[2], -3, 1e-9); // local +X rotated 90° about Y → −Z
    });
    it('buoyancy pushes submerged bodies up', () => {
        const { host, rt } = make([
            { id: 'lake', transform: { position: [0, -1, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [10, 2, 10] }, behaviors: [{ type: 'buoyancy' }] },
            { id: 'duck', physics: { body: 'dynamic' } },
            { id: 'bird', physics: { body: 'dynamic' } },
        ], { player: [50, 0, 0] });
        host.place('duck', [1, -0.5, 1]);
        host.place('bird', [1, 3, 1]);
        run(rt, 1);
        expect(host.velocities.get('duck')[1]).toBeGreaterThan(0);
        expect(host.velocities.get('bird')).toBeUndefined();
    });
    it('windZone accelerates bodies inside', () => {
        const { host, rt } = make([
            { id: 'wind', shape: { kind: 'primitive', primitive: 'box', size: [10, 10, 10] }, behaviors: [{ type: 'windZone', params: { direction: [0, 0, 1], strength: 6 } }] },
            { id: 'leaf', physics: { body: 'dynamic' } },
        ], { player: [50, 0, 0] });
        host.place('leaf', [0, 0, 0]);
        run(rt, 60);
        close(host.velocities.get('leaf')[2], 6, 1e-6);
    });
    it('magnet attracts tagged bodies within its radius', () => {
        const { host, rt } = make([
            { id: 'mag', behaviors: [{ type: 'magnet', params: { target: '#metal', radius: 5, strength: 10 } }] },
            { id: 'nail', tags: ['metal'], physics: { body: 'dynamic' } },
            { id: 'wood', physics: { body: 'dynamic' } },
        ], { player: [50, 0, 0] });
        host.place('nail', [2, 0, 0]);
        host.place('wood', [1, 0, 0]);
        run(rt, 1);
        expect(host.velocities.get('nail')[0]).toBeLessThan(0);
        expect(host.velocities.get('wood')).toBeUndefined();
    });
});

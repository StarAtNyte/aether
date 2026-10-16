/**
 * Test doubles for @aether/logic: a recording LogicHost and world builders.
 */
import { createWorld } from '@aether/core';
import { EMPTY_INPUT } from '../src';
/** LogicHost fake: records every call and keeps a tiny world of poses/velocities. */
export class FakeHost {
    calls = [];
    transforms = new Map();
    velocities = new Map();
    angular = new Map();
    spawned = [];
    destroyed = [];
    messages = [];
    sounds = [];
    properties = [];
    gameOverResult;
    resets = 0;
    kinematicWrites = 0;
    player;
    /** When false, setKinematic is counted but not recorded (perf tests). */
    recordKinematic = true;
    rec(fn, ...args) {
        this.calls.push({ fn, args: JSON.parse(JSON.stringify(args)) });
    }
    /** Calls of one kind. */
    callsOf(fn) {
        return this.calls.filter((c) => c.fn === fn);
    }
    /** Place an entity (or the player avatar) at a position. */
    place(id, position, quaternion = [0, 0, 0, 1]) {
        this.transforms.set(id, { position: [position[0], position[1], position[2]], quaternion: [...quaternion] });
    }
    getTransform(id) {
        return this.transforms.get(id);
    }
    setKinematic(id, position, quaternion) {
        this.kinematicWrites++;
        const t = this.transforms.get(id);
        if (t) {
            t.position[0] = position[0];
            t.position[1] = position[1];
            t.position[2] = position[2];
            t.quaternion[0] = quaternion[0];
            t.quaternion[1] = quaternion[1];
            t.quaternion[2] = quaternion[2];
            t.quaternion[3] = quaternion[3];
        }
        else
            this.place(id, position, quaternion);
        if (this.recordKinematic)
            this.rec('setKinematic', id, position, quaternion);
    }
    applyImpulse(id, v) {
        this.rec('applyImpulse', id, v);
    }
    setVelocity(id, v) {
        this.velocities.set(id, [v[0], v[1], v[2]]);
        this.rec('setVelocity', id, v);
    }
    getVelocity(id) {
        return this.velocities.get(id);
    }
    setAngularVelocity(id, v) {
        this.angular.set(id, [v[0], v[1], v[2]]);
    }
    teleport(id, p) {
        const t = this.transforms.get(id);
        this.place(id, p, t?.quaternion);
        this.rec('teleport', id, p);
    }
    explode(center, force, radius) {
        this.rec('explode', center, force, radius);
    }
    setGravity(v) {
        this.rec('setGravity', v);
    }
    spawn(entity) {
        this.spawned.push(entity);
        this.place(entity.id, entity.transform.position);
        this.rec('spawn', entity.id);
    }
    destroy(id) {
        this.destroyed.push(id);
        this.transforms.delete(id);
        this.rec('destroy', id);
    }
    setProperty(id, path, value) {
        this.properties.push({ id, path, value });
        this.rec('setProperty', id, path, value);
    }
    message(text, duration) {
        this.messages.push(text);
        this.rec('message', text, duration);
    }
    sound(name) {
        this.sounds.push(name);
        this.rec('sound', name);
    }
    gameOver(result, text) {
        this.gameOverResult = { result, text };
        this.rec('gameOver', result, text);
    }
    reset() {
        this.resets++;
        this.rec('reset');
    }
    /** Joint servo targets requested by physical doors and drawers. */
    driven = [];
    driveJoint(id, target) {
        this.driven.push({ id, target });
    }
    playerId() {
        return this.player;
    }
}
/** Build a validated world from loose input. */
export function world(input = {}) {
    return createWorld(input);
}
/** Shorthand world from entities and rules. */
export function worldOf(entities, rules = [], extra = {}) {
    const map = {};
    for (const e of entities)
        map[e.id] = e;
    return createWorld({ ...extra, entities: map, rules });
}
/** Input with overrides. */
export function input(over = {}) {
    return { ...EMPTY_INPUT, ...over };
}
/** Input holding the given keys. */
export function keys(...k) {
    return input({ keys: new Set(k) });
}
/** Fixed step used in tests. */
export const DT = 1 / 60;
/** Run `n` ticks with constant input and no events. */
export function run(rt, n, inp = EMPTY_INPUT) {
    for (let i = 0; i < n; i++)
        rt.tick(DT, inp, []);
}
/** Texts of a runtime log. */
export function logText(log) {
    return log.map((e) => e.text).join('\n');
}

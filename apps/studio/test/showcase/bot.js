/**
 * Headless playtest bot: plays a world the way a person does — physics, the
 * player capsule (or a driven vehicle) and the logic runtime stepped at the
 * studio's fixed rate with keyboard-like input — so tests can prove a
 * template's main loop is completable (reach every pickup, ride the lifts,
 * win) without a browser.
 */
import {} from '@aether/core';
import { EMPTY_INPUT, LogicRuntime } from '@aether/logic';
import { CharacterController, PhysicsWorld } from '@aether/physics';
import { HeadlessLogicHost } from '../../src/engine/headlessHost';
import { PLAYER_CAPSULE, PLAYER_PSEUDO_ID } from '../../src/config';
/** Fixed step of the studio simulation. */
export const BOT_DT = 1 / 60;
/** Logic host whose "player" is the bot's capsule (or the driven vehicle). */
class BotHost extends HeadlessLogicHost {
    character;
    vehicle;
    messages = [];
    pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    constructor(pw, world, character, vehicle) {
        super(pw, world);
        this.character = character;
        this.vehicle = vehicle;
    }
    getTransform(id) {
        if (id === PLAYER_PSEUDO_ID && this.character) {
            const p = this.character.position;
            this.pose.position[0] = p[0];
            this.pose.position[1] = p[1];
            this.pose.position[2] = p[2];
            return this.pose;
        }
        return super.getTransform(id);
    }
    teleport(id, p) {
        if (id === PLAYER_PSEUDO_ID && this.character)
            this.character.teleport(p);
        else
            super.teleport(id, p);
    }
    message(text, duration) {
        this.messages.push(text);
        super.message(text, duration);
    }
    playerId() {
        return this.vehicle ?? (this.character ? PLAYER_PSEUDO_ID : undefined);
    }
}
/** A world being played by the bot. */
export class Bot {
    world;
    pw;
    host;
    runtime;
    character;
    vehicle;
    time = 0;
    input = { ...EMPTY_INPUT, keys: new Set() };
    constructor(world, pw) {
        this.world = world;
        this.pw = pw;
        this.vehicle = world.player.mode === 'vehicle' && world.player.controls ? world.player.controls : null;
        this.character = this.vehicle ? null : new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_PSEUDO_ID });
        this.host = new BotHost(pw, world, this.character, this.vehicle);
        this.runtime = new LogicRuntime(world, this.host, { seed: world.seed });
        this.runtime.start();
    }
    /** Start playing `world` (call `initPhysics()` first). */
    static async play(world) {
        return new Bot(world, await PhysicsWorld.create(world, { fixedDt: BOT_DT }));
    }
    /** The player's (or vehicle's) position. */
    get position() {
        if (this.character)
            return this.character.position;
        const s = this.vehicle ? this.pw.getState(this.vehicle) : undefined;
        return s ? [s.position[0], s.position[1], s.position[2]] : [0, 0, 0];
    }
    /** Game result so far. */
    get outcome() {
        return this.host.outcome.result;
    }
    /** A world state value (score, lanterns …). */
    state(key) {
        return this.runtime.readState(key);
    }
    /** Advance `seconds` with the given input held. */
    step(seconds, input = {}) {
        const n = Math.max(1, Math.round(seconds / BOT_DT));
        this.input.forward = input.forward ?? 0;
        this.input.right = input.right ?? 0;
        this.input.jump = input.jump ?? false;
        this.input.pointerYawDeg = input.pointerYawDeg ?? 0;
        this.input.keys.clear();
        for (const k of input.keys ?? [])
            this.input.keys.add(k);
        for (let i = 0; i < n && this.outcome === null; i++) {
            if (this.character)
                this.character.move({ forward: this.input.forward, right: this.input.right, jump: this.input.jump, yawDeg: this.input.pointerYawDeg }, BOT_DT, this.world.player.moveSpeed, this.world.player.jumpSpeed);
            const events = this.pw.stepFixed();
            this.runtime.tick(BOT_DT, this.input, events);
            this.time += BOT_DT;
        }
    }
    /**
     * Walk toward (x, z) until within `radius` (horizontal) or `timeout`
     * seconds pass; jumps when blocked. Returns whether it arrived.
     */
    walkTo(x, z, opts = {}) {
        const radius = opts.radius ?? 0.6;
        const deadline = this.time + (opts.timeout ?? 30);
        let stuck = 0;
        let last = this.position;
        while (this.time < deadline && this.outcome === null) {
            const p = this.position;
            const dx = x - p[0];
            const dz = z - p[2];
            const d = Math.hypot(dx, dz);
            if (d <= radius)
                return true;
            const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
            const slow = d < 1.5 ? Math.max(0.35, d / 1.5) : 1;
            this.step(0.1, { forward: slow, pointerYawDeg: yaw, jump: opts.jump === true || stuck > 6 });
            const moved = Math.hypot(this.position[0] - last[0], this.position[2] - last[2]);
            stuck = moved < 0.05 ? stuck + 1 : 0;
            last = this.position;
        }
        return Math.hypot(x - this.position[0], z - this.position[2]) <= radius;
    }
    /** Heading (degrees, 0 = facing −Z) of the driven vehicle. */
    get heading() {
        const q = this.vehicle ? this.pw.getState(this.vehicle)?.quaternion : undefined;
        if (!q)
            return 0;
        const [x, y, z, w] = q;
        // Forward = q · (0, 0, −1)
        const fx = -2 * (x * z + w * y);
        const fz = -(1 - 2 * (x * x + y * y));
        return (Math.atan2(-fx, -fz) * 180) / Math.PI;
    }
    /**
     * Drive the vehicle toward (x, z) with throttle and steering (like a
     * player holding W and A/D) until within `radius` or `timeout` seconds.
     */
    driveTo(x, z, opts = {}) {
        const radius = opts.radius ?? 4;
        const deadline = this.time + (opts.timeout ?? 20);
        while (this.time < deadline && this.outcome === null) {
            const p = this.position;
            const dx = x - p[0];
            const dz = z - p[2];
            if (Math.hypot(dx, dz) <= radius)
                return true;
            const want = (Math.atan2(-dx, -dz) * 180) / Math.PI;
            const err = ((want - this.heading + 540) % 360) - 180;
            const right = Math.max(-1, Math.min(1, -err / 25));
            const throttle = (opts.throttle ?? 1) * (Math.abs(err) > 60 ? 0.45 : 1);
            this.step(1 / 30, { forward: throttle, right });
        }
        return Math.hypot(x - this.position[0], z - this.position[2]) <= radius;
    }
    /** Stand still until `cond` holds (or `timeout` seconds pass). */
    waitUntil(cond, timeout = 20) {
        const deadline = this.time + timeout;
        while (this.time < deadline && this.outcome === null) {
            if (cond())
                return true;
            this.step(0.1);
        }
        return cond();
    }
    /** Release physics and logic. */
    dispose() {
        this.runtime.dispose();
        this.character?.dispose();
        this.pw.dispose();
    }
}

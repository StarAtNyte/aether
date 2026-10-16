import { EMPTY_INPUT, LogicRuntime } from '@aether/logic';
import { CharacterController, PhysicsWorld } from '@aether/physics';
import { PLAYER_CAPSULE, PLAYER_ID, PlaytestHost } from './host';
import { TRACE_STRIDE, PLAYTEST_LIMITS } from './types';
/** Fixed step of the studio simulation. */
export const STEP = 1 / 60;
/** Below this height the studio respawns the player at the spawn. */
export const KILL_Y = -40;
const NO_KEYS = new Set();
/** A running playthrough. */
export class Session {
    world;
    pw;
    host;
    runtime;
    character;
    time = 0;
    steps = 0;
    falls = 0;
    input = { ...EMPTY_INPUT, keys: NO_KEYS };
    keySet = new Set();
    frames = [];
    events = [];
    traceDt;
    nextSample = 0;
    recording;
    yaw = 0;
    scripts;
    constructor(world, pw, scripts, opts) {
        this.world = world;
        this.pw = pw;
        this.scripts = scripts;
        this.recording = opts.trace;
        this.traceDt = 1 / Math.max(1, Math.min(30, opts.traceHz));
        this.character = new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_ID });
        this.host = new PlaytestHost(pw, world, this.character);
        this.runtime = new LogicRuntime(world, this.host, scripts ? { scripts, seed: world.seed } : { seed: world.seed });
        this.runtime.start();
    }
    /** Build a session for `world` (physics must be loadable; scripts optional). */
    static async create(world, opts = {}) {
        const pw = await PhysicsWorld.create(world, { fixedDt: STEP });
        try {
            return new Session(world, pw, opts.scripts, { trace: opts.trace ?? true, traceHz: opts.traceHz ?? 12 });
        }
        catch (err) {
            pw.dispose();
            throw err;
        }
    }
    /** Feet position of the bot. */
    get position() {
        return this.character.position;
    }
    /** True when the game has ended (win or lose). */
    get over() {
        return this.host.seen.outcome !== null;
    }
    /** Facing of the bot in degrees. */
    get yawDeg() {
        return this.yaw;
    }
    /** Record a replay event at the current time. */
    note(kind, label, position) {
        if (this.events.length < 400)
            this.events.push({ t: Math.round(this.time * 100) / 100, kind, label: label.slice(0, 80), position: position ?? this.position });
    }
    /** One fixed tick with the given input. */
    tick(input) {
        if (this.over)
            return;
        this.yaw = input.yawDeg;
        this.host.yawDeg = input.yawDeg;
        this.character.move({ forward: input.forward, right: input.right, jump: input.jump, yawDeg: input.yawDeg }, STEP, this.world.player.moveSpeed, this.world.player.jumpSpeed);
        if (this.character.position[1] < KILL_Y) {
            this.character.teleport(this.world.player.spawn);
            this.falls++;
            this.note('fall', 'fell out of the world');
        }
        const events = this.pw.stepFixed();
        const s = this.input;
        s.forward = input.forward;
        s.right = input.right;
        s.jump = input.jump;
        s.pointerYawDeg = input.yawDeg;
        if (input.keys && input.keys.length > 0) {
            this.keySet.clear();
            for (const k of input.keys)
                this.keySet.add(k);
            s.keys = this.keySet;
        }
        else {
            s.keys = NO_KEYS;
        }
        this.runtime.tick(STEP, s, events);
        this.time += STEP;
        this.steps++;
        if (this.recording)
            this.sample();
    }
    /** Idle for `seconds` of simulated time. */
    idle(seconds) {
        const n = Math.max(1, Math.round(seconds / STEP));
        for (let i = 0; i < n && !this.over; i++)
            this.tick({ forward: 0, right: 0, jump: false, yawDeg: this.yaw });
    }
    sample() {
        if (this.time + 1e-9 < this.nextSample)
            return;
        if (this.frames.length / TRACE_STRIDE >= PLAYTEST_LIMITS.MAX_TRACE_FRAMES) {
            this.recording = false;
            return;
        }
        const p = this.character.position;
        this.frames.push(p[0], p[1], p[2], this.yaw);
        this.nextSample += this.traceDt;
    }
    /** Force a final sample (so the replay ends exactly where the run did). */
    finishTrace() {
        if (this.frames.length < TRACE_STRIDE * 2 && !this.over && this.time === 0)
            return undefined;
        const p = this.character.position;
        if (this.frames.length / TRACE_STRIDE < PLAYTEST_LIMITS.MAX_TRACE_FRAMES)
            this.frames.push(p[0], p[1], p[2], this.yaw);
        const frames = this.frames.length / TRACE_STRIDE;
        if (frames < 2)
            return undefined;
        return { dt: this.traceDt, frames, poses: Float32Array.from(this.frames), events: this.events.slice() };
    }
    /** Every sampled position (for the path summary). */
    sampledPath() {
        const out = [];
        for (let i = 0; i + 2 < this.frames.length; i += TRACE_STRIDE)
            out.push([this.frames[i], this.frames[i + 1], this.frames[i + 2]]);
        return out;
    }
    /** Reads a world state value. */
    state(key) {
        return this.runtime.readState(key);
    }
    /** Entity runtime state (door `open` …). */
    entityState(id) {
        return this.runtime.entityState(id);
    }
    /** Release physics, logic and the script runner's runtimes (the runner itself is the caller's). */
    dispose() {
        try {
            this.runtime.dispose();
        }
        catch {
            /* already disposed */
        }
        try {
            this.character.dispose();
        }
        catch {
            /* already disposed */
        }
        this.pw.dispose();
    }
}

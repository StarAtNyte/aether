/**
 * Autoplay: a bot plays the world the way a person does (physics, the player
 * capsule or a driven vehicle, and the logic runtime stepped at the studio's
 * fixed rate with keyboard-like input) and reports whether the game can be
 * finished. Unlike `verify`, which fast-forwards without a player, this one
 * moves: it walks to the objectives (pickups, goals, checkpoints, rule
 * zones) in a sensible order, jumps when blocked and waits for lifts.
 */
import { resolveSelector } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime } from '@aether/logic';
import { CharacterController, PhysicsWorld } from '@aether/physics';
import { PLAYER_CAPSULE, PLAYER_PSEUDO_ID } from '../../../studio/src/config';
import { HeadlessLogicHost } from '../../../studio/src/engine/headlessHost';
const DT = 1 / 60;
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
        if (this.messages.length < 20)
            this.messages.push(String(text).slice(0, 200));
        super.message(text, duration);
    }
    playerId() {
        return this.vehicle ?? (this.character ? PLAYER_PSEUDO_ID : undefined);
    }
}
const PICKUP_TAGS = new Set(['pickup', 'collectible', 'coin', 'lantern', 'gem', 'star', 'key', 'orb', 'collect']);
const GOAL_TAGS = new Set(['goal', 'finish', 'win', 'exit']);
/** Find what the bot should walk to (pure; exported for tests). */
export function findObjectives(world, goal) {
    const out = [];
    const seen = new Set();
    const add = (e, kind) => {
        if (seen.has(e.id) || e.template)
            return;
        seen.add(e.id);
        const t = e.transform.position;
        out.push({ id: e.id, kind, position: [t[0], t[1], t[2]], reached: false, collected: false });
    };
    if (goal) {
        for (const id of resolveSelector(world, goal)) {
            const e = world.entities[id];
            if (e)
                add(e, 'target');
        }
        return out;
    }
    const entities = Object.values(world.entities);
    for (const e of entities) {
        const types = new Set(e.behaviors.filter((b) => b.enabled).map((b) => b.type));
        if (types.has('collectible') || e.tags.some((t) => PICKUP_TAGS.has(t)))
            add(e, 'pickup');
    }
    for (const rule of world.rules) {
        if (!rule.enabled || rule.when.on !== 'enter')
            continue;
        if (rule.when.who !== 'player' && rule.when.who !== '*')
            continue;
        for (const id of resolveSelector(world, rule.when.zone)) {
            const e = world.entities[id];
            if (e && !seen.has(id))
                add(e, 'zone');
        }
    }
    for (const e of entities) {
        const types = new Set(e.behaviors.filter((b) => b.enabled).map((b) => b.type));
        if (types.has('goal') || e.tags.some((t) => GOAL_TAGS.has(t)))
            add(e, 'goal');
        else if (types.has('checkpoint'))
            add(e, 'checkpoint');
    }
    return out;
}
const tick = () => new Promise((r) => setImmediate(r));
/** Play `world` and report (see module docs). Call `initPhysics()` first. */
export async function playtest(world, opts) {
    const pw = await PhysicsWorld.create(world, { fixedDt: DT });
    const vehicle = world.player.mode === 'vehicle' && world.player.controls ? world.player.controls : null;
    const character = vehicle ? null : new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_PSEUDO_ID });
    const host = new BotHost(pw, world, character, vehicle);
    const runtime = new LogicRuntime(world, host, { seed: world.seed });
    runtime.start();
    const input = { ...EMPTY_INPUT, keys: new Set() };
    let time = 0;
    const horizon = Math.max(1, opts.seconds);
    const path = [];
    let nextSample = 0;
    let abort;
    const position = () => {
        if (character)
            return character.position;
        const s = vehicle ? pw.getState(vehicle) : undefined;
        return s ? [s.position[0], s.position[1], s.position[2]] : [0, 0, 0];
    };
    const heading = () => {
        const q = vehicle ? pw.getState(vehicle)?.quaternion : undefined;
        if (!q)
            return 0;
        const [x, y, z, w] = q;
        const fx = -2 * (x * z + w * y);
        const fz = -(1 - 2 * (x * x + y * y));
        return (Math.atan2(-fx, -fz) * 180) / Math.PI;
    };
    const step = (seconds, drive) => {
        const n = Math.max(1, Math.round(seconds / DT));
        input.forward = drive.forward ?? 0;
        input.right = drive.right ?? 0;
        input.jump = drive.jump ?? false;
        input.pointerYawDeg = drive.yaw ?? 0;
        for (let i = 0; i < n && host.outcome.result === null; i++) {
            if (character)
                character.move({ forward: input.forward, right: input.right, jump: input.jump, yawDeg: input.pointerYawDeg }, DT, world.player.moveSpeed, world.player.jumpSpeed);
            const events = pw.stepFixed();
            runtime.tick(DT, input, events);
            time += DT;
            if (time >= nextSample) {
                if (path.length < 120)
                    path.push(position());
                nextSample += 1;
            }
        }
    };
    const over = () => host.outcome.result !== null || time >= horizon || abort !== undefined;
    const check = async () => {
        if (opts.signal?.aborted)
            abort = 'cancelled';
        else if (Date.now() > opts.deadline)
            abort = 'ran out of wall-clock time';
        await tick();
    };
    const gone = (o) => host.getTransform(o.id) === undefined;
    const where = (o) => host.getTransform(o.id)?.position ?? o.position;
    const reach = async (o) => {
        const radius = o.kind === 'zone' ? 0.8 : o.kind === 'pickup' ? 0.3 : 0.55;
        const until = Math.min(horizon, time + 40);
        let stuck = 0;
        let last = position();
        while (time < until && !over()) {
            if (o.kind === 'pickup' && gone(o))
                return true;
            const target = where(o);
            const p = position();
            const dx = target[0] - p[0];
            const dz = target[2] - p[2];
            const d = Math.hypot(dx, dz);
            if (d <= radius)
                return true;
            if (vehicle) {
                const want = (Math.atan2(-dx, -dz) * 180) / Math.PI;
                const err = ((want - heading() + 540) % 360) - 180;
                step(1 / 30, { forward: Math.abs(err) > 60 ? 0.45 : 1, right: Math.max(-1, Math.min(1, -err / 25)) });
                if (d <= 4)
                    return true;
            }
            else {
                const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
                const slow = d < 1.5 ? Math.max(0.35, d / 1.5) : 1;
                step(0.1, { forward: slow, yaw, jump: stuck > 6 });
                const moved = Math.hypot(position()[0] - last[0], position()[2] - last[2]);
                stuck = moved < 0.05 ? stuck + 1 : 0;
                last = position();
            }
            await check();
        }
        const t = where(o);
        return Math.hypot(t[0] - position()[0], t[2] - position()[2]) <= radius;
    };
    /** Hop on the spot toward a pickup that floats above the ground until it is taken. */
    const grab = async (o) => {
        for (let i = 0; i < 6 && !gone(o) && !over(); i++) {
            const t = where(o);
            const p = position();
            const yaw = (Math.atan2(-(t[0] - p[0]), -(t[2] - p[2])) * 180) / Math.PI;
            step(0.25, { forward: 0.3, yaw, jump: true });
            await check();
        }
    };
    const objectives = findObjectives(world, opts.goal);
    let finalPosition = [0, 0, 0];
    const state = {};
    try {
        step(0.5, {}); // settle onto the ground
        const todo = objectives.filter((o) => o.kind !== 'goal' && o.kind !== 'checkpoint');
        const tail = objectives.filter((o) => o.kind === 'goal' || o.kind === 'checkpoint');
        const visit = async (list) => {
            const rest = [...list];
            while (rest.length > 0 && !over()) {
                const p = position();
                let best = 0;
                let bestD = Infinity;
                for (let i = 0; i < rest.length; i++) {
                    const o = rest[i];
                    const d = Math.hypot(o.position[0] - p[0], o.position[2] - p[2]) + Math.abs(o.position[1] - p[1]) * 0.5;
                    if (d < bestD) {
                        bestD = d;
                        best = i;
                    }
                }
                const [o] = rest.splice(best, 1);
                o.reached = await reach(o);
                if (o.reached && o.kind === 'pickup')
                    await grab(o);
                o.collected = gone(o);
                if (o.collected)
                    o.reached = true;
            }
        };
        await visit(todo);
        await visit(tail);
        // Let timers and end-of-game rules run.
        for (let i = 0; i < 40 && !over(); i++) {
            step(0.25, {});
            await check();
        }
        finalPosition = position();
        const keys = new Set([...Object.keys(world.state), ...world.hud.map((h) => h.key)]);
        for (const k of [...keys].slice(0, 40)) {
            const v = runtime.readState(k);
            if (v !== undefined)
                state[k] = v;
        }
    }
    finally {
        runtime.dispose();
        character?.dispose();
        pw.dispose();
    }
    const result = host.outcome.result;
    const missed = objectives.filter((o) => !o.reached);
    const reason = result
        ? undefined
        : abort
            ? `playtest ${abort}`
            : time >= horizon
                ? `time limit reached (${Math.round(horizon)} s of play)`
                : missed.length > 0
                    ? `could not reach ${missed.slice(0, 4).map((o) => o.id).join(', ')}${missed.length > 4 ? ` and ${missed.length - 4} more` : ''}`
                    : objectives.some((o) => o.kind === 'pickup' && !o.collected)
                        ? `stood at ${objectives.filter((o) => o.kind === 'pickup' && !o.collected).slice(0, 4).map((o) => o.id).join(', ')} but it was not collected (pickup range too small, or no collectible behavior)`
                        : objectives.length === 0
                            ? 'nothing to play toward: the world has no pickups, goals or enter-zones (pass "goal" to name a target)'
                            : 'all objectives reached but the game never ended (no win rule fired)';
    return {
        outcome: result ?? 'incomplete',
        ...(reason ? { reason } : {}),
        seconds: Math.round(time * 10) / 10,
        finalPosition,
        objectives: objectives.map((o) => ({ id: o.id, kind: o.kind, reached: o.reached, collected: o.collected })),
        state,
        messages: host.messages,
        path,
    };
}

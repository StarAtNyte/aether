/**
 * Minimal `LogicHost` backed only by a `PhysicsWorld` — used to run world
 * rules/behaviors headless during verification (no renderer, no audio, no
 * UI). Bodiless kinematic poses are tracked in a side table so zone and
 * position queries stay consistent.
 */
import { worldTransform } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime } from '@aether/logic';
import { entityColliderBounds, entityWorldBounds } from '@aether/physics/bounds';
import { PosePool } from './pose-pool';
const MAX_TRACKED_POSES = 5000;
/** LogicHost implementation over a headless physics world. */
export class HeadlessLogicHost {
    pw;
    world;
    poses = new Map();
    destroyed = new Set();
    /** Reused per-entity pose records (getTransform runs many times per tick). */
    pool = new PosePool();
    outcome = { result: null, text: '', messages: 0 };
    constructor(pw, world) {
        this.pw = pw;
        this.world = world;
    }
    getTransform(id) {
        if (this.destroyed.has(id))
            return undefined;
        const slot = this.pool.slot(id);
        if (this.pw.readPose(id, slot.position, slot.quaternion))
            return slot;
        const p = this.poses.get(id);
        if (p)
            return p;
        if (!Object.prototype.hasOwnProperty.call(this.world.entities, id))
            return undefined;
        try {
            const t = worldTransform(this.world, id);
            return this.pool.fill(id, t.position, t.quaternion);
        }
        catch {
            return undefined;
        }
    }
    setKinematic(id, position, quaternion) {
        if (this.pw.has(id))
            this.pw.setKinematicTarget(id, position, quaternion);
        if (this.poses.has(id) || this.poses.size < MAX_TRACKED_POSES)
            this.poses.set(id, { position: [...position], quaternion: [...quaternion] });
    }
    applyImpulse(id, v) {
        this.pw.applyImpulse(id, v);
    }
    setVelocity(id, v) {
        this.pw.setVelocity(id, v);
    }
    getVelocity(id) {
        return this.pw.getVelocity(id);
    }
    setAngularVelocity(id, v) {
        this.pw.setAngularVelocity(id, v);
    }
    driveJoint(id, target) {
        this.pw.driveJoint(id, target);
    }
    teleport(id, p) {
        this.pw.teleport(id, p);
        const pose = this.poses.get(id);
        if (pose)
            pose.position = [...p];
    }
    explode(center, force, radius) {
        this.pw.explode(center, force, radius);
    }
    setGravity(v) {
        this.pw.setGravity(v);
    }
    spawn(entity) {
        this.destroyed.delete(entity.id);
        // Logic spawns are clones of templates from the validated world.
        this.pw.addEntity(entity, { trusted: true });
    }
    destroy(id) {
        this.destroyed.add(id);
        this.poses.delete(id);
        this.pool.release(id);
        this.pw.removeEntity(id);
    }
    setProperty(_id, _path, _value) {
        // Visual-only in a headless run.
    }
    message(_text, _duration) {
        this.outcome.messages++;
    }
    sound(_name) {
        // Silent in a headless run.
    }
    gameOver(result, text) {
        if (this.outcome.result === null) {
            this.outcome.result = result;
            this.outcome.text = text.slice(0, 200);
        }
    }
    reset() {
        // A reset during verification would loop forever; ignored.
    }
    playerId() {
        return undefined;
    }
    getBounds(id) {
        return entityWorldBounds(this.world, id) ?? undefined;
    }
    getColliderBounds(id) {
        return entityColliderBounds(this.world, id);
    }
    groundHeight(x, z, fromY, exclude) {
        const hit = this.pw.raycast([x, fromY, z], [0, -1, 0], fromY + 8, exclude);
        return hit ? hit.point[1] : undefined;
    }
}
/**
 * Build the `logic` option of `@aether/physics.verify`: each call constructs
 * a fresh headless `LogicRuntime` against the given physics world. Runtimes
 * are tracked so the caller can dispose them once verification finished.
 */
export function createVerifyLogic(world, opts = {}) {
    const runtimes = [];
    const factory = (pw) => {
        const host = new HeadlessLogicHost(pw, world);
        const scripts = opts.scripts?.();
        // Track the runner before constructing the runtime so it is freed even if construction throws.
        const entry = { runtime: null, scripts };
        runtimes.push(entry);
        const runtime = new LogicRuntime(world, host, scripts ? { scripts } : {});
        entry.runtime = runtime;
        runtime.start();
        return {
            tick: (dt, _pw, events) => runtime.tick(dt, EMPTY_INPUT, events),
            readState: (key) => runtime.readState(key),
        };
    };
    const dispose = () => {
        for (const r of runtimes.splice(0)) {
            // Separate guards: a failing runtime dispose must not leak the QuickJS runner.
            try {
                r.runtime?.dispose();
            }
            catch {
                /* already disposed */
            }
            try {
                r.scripts?.dispose();
            }
            catch {
                /* already disposed */
            }
        }
    };
    return { factory, dispose };
}

/**
 * Visual rig of modelled vehicles (library models with named nodes, see `scripts/assets/vehicles.ts`):
 * wheels roll with the distance driven, front wheels and the steering wheel turn with the heading change,
 * and the body pitches under acceleration and rolls into corners on a damped spring. Everything is a pure
 * function of how the entity moved (like the animal and character animation), so it is the same in play,
 * in replays and in proofs, and it never touches physics. The per-frame update allocates nothing.
 */
import { Quaternion, Vector3 } from 'three';
/** Largest steering lock of the front wheels (rad) and body lean (rad). */
export const MAX_STEER = 0.5;
export const MAX_PITCH = 0.045;
export const MAX_ROLL = 0.06;
const _pos = new Vector3();
const _fwd = new Vector3();
const _q = new Quaternion();
/** True when `root` contains the named nodes of a modelled vehicle. */
export function isVehicleModel(root) {
    return root.getObjectByName('wheel_fl') !== undefined && root.getObjectByName('wheel_rr') !== undefined;
}
/** Shortest signed angle difference a - b. */
function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI)
        d -= Math.PI * 2;
    while (d < -Math.PI)
        d += Math.PI * 2;
    return d;
}
/** Drives every modelled vehicle of one scene. */
export class VehicleRig {
    items = new Map();
    list = [];
    /** Number of rigged vehicles. */
    get size() {
        return this.items.size;
    }
    /** Rig the vehicle `root` of entity `id`; its movement is read from `tracked`. Returns false when it has no wheels. */
    add(id, root, tracked) {
        this.remove(id);
        const wheels = [];
        for (const n of ['fl', 'fr', 'rl', 'rr']) {
            const spin = root.getObjectByName(`wheel_${n}`);
            if (!spin)
                continue;
            const steer = n[0] === 'f' ? (root.getObjectByName(`steer_${n}`) ?? null) : null;
            const radius = Math.max(0.05, (steer ?? spin).position.y);
            wheels.push({ spin, steer, radius });
        }
        if (wheels.length < 4)
            return false;
        const rig = {
            tracked,
            chassis: root.getObjectByName('chassis') ?? null,
            wheels,
            wheel: root.getObjectByName('steer_wheel') ?? null,
            last: new Vector3(),
            heading: 0,
            speed: 0,
            steer: 0,
            pitch: 0,
            roll: 0,
            rolled: 0,
            primed: false,
        };
        tracked.getWorldPosition(rig.last);
        this.items.set(id, rig);
        this.list.push(rig);
        return true;
    }
    /** Forget one vehicle. */
    remove(id) {
        const r = this.items.get(id);
        if (!r)
            return;
        this.items.delete(id);
        const i = this.list.indexOf(r);
        if (i >= 0)
            this.list.splice(i, 1);
    }
    /** Signed forward speed (m/s, smoothed) of a vehicle, or null. */
    speedOf(id) {
        return this.items.get(id)?.speed ?? null;
    }
    /** Advance every vehicle by `dt` seconds. Returns true when anything moved (a redraw is needed). */
    update(dt) {
        const list = this.list;
        if (list.length === 0 || !(dt > 0))
            return false;
        let moved = false;
        const k = Math.min(1, dt * 7);
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            r.tracked.getWorldPosition(_pos);
            r.tracked.getWorldQuaternion(_q);
            _fwd.set(0, 0, -1).applyQuaternion(_q);
            const heading = Math.atan2(-_fwd.x, -_fwd.z);
            const dx = _pos.x - r.last.x;
            const dz = _pos.z - r.last.z;
            r.last.copy(_pos);
            if (!r.primed) {
                r.primed = true;
                r.heading = heading;
                continue;
            }
            // Signed speed along the heading; a teleport (a frame jump) is not driving.
            const raw = (dx * _fwd.x + dz * _fwd.z) / dt;
            const driven = Math.abs(raw) < 60 ? raw : 0;
            const yawRate = Math.abs(angleDelta(heading, r.heading) / dt) < 8 ? angleDelta(heading, r.heading) / dt : 0;
            r.heading = heading;
            const accel = (driven - r.speed) / dt;
            r.speed += (driven - r.speed) * k;
            const speed = r.speed;
            // Wheels roll with the distance driven (forward is -Z, so the angle runs the other way about X).
            for (const w of r.wheels) {
                w.spin.rotation.x -= (driven * dt) / w.radius;
                if (w.spin.rotation.x < -1e4 || w.spin.rotation.x > 1e4)
                    w.spin.rotation.x %= Math.PI * 2;
            }
            // Ackermann-like steering from the heading rate (kept visible at a crawl).
            const wanted = Math.max(-MAX_STEER, Math.min(MAX_STEER, Math.atan2(yawRate * 2.6, Math.max(1.5, Math.abs(speed))) * Math.sign(speed || 1)));
            r.steer += (wanted - r.steer) * k;
            for (const w of r.wheels)
                if (w.steer)
                    w.steer.rotation.y = r.steer;
            if (r.wheel)
                r.wheel.rotation.x = Math.max(-2.4, Math.min(2.4, r.steer * 4.4));
            // Body: nose lifts under power and dips when braking; leans away from the turn.
            const pitchTarget = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, accel * 0.0032));
            const rollTarget = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, -yawRate * speed * 0.0042));
            r.pitch += (pitchTarget - r.pitch) * Math.min(1, dt * 5);
            r.roll += (rollTarget - r.roll) * Math.min(1, dt * 5);
            if (r.chassis) {
                r.chassis.rotation.x = r.pitch;
                r.chassis.rotation.z = r.roll;
            }
            moved = moved || Math.abs(driven) > 0.01 || Math.abs(yawRate) > 0.01;
        }
        return moved;
    }
}

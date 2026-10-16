/** Default reach of a use (metres from the eye). */
export const DEFAULT_REACH = 2.4;
/** Distance in front of the eye at which a carried prop is held. */
export const HOLD_DISTANCE = 1.15;
/** Throw speed (m/s) along the aim direction. */
export const THROW_SPEED = 8.5;
/** Fastest a carried prop is pulled toward the hold point (m/s). */
export const CARRY_MAX_SPEED = 9;
/** A usable entity this close behind the first thing the ray hits still counts (a drawer front sits inside its cabinet's collider). */
export const HIT_TOLERANCE = 0.14;
/** The ray starts this far ahead of the eye (the player's own capsule is filtered out by the session). */
export const RAY_START = 0.05;
/** Seat surface height (metres above the floor) by furniture kind; kinds without an entry cannot be sat on. */
export const SEAT_HEIGHT = Object.freeze({ sofa: 0.42, armchair: 0.42, chair: 0.45, 'office-chair': 0.46, 'bar-stool': 0.65, bench: 0.45 });
/** Eye height above the seat surface while sitting (metres). */
export const SEATED_EYE = 0.72;
/**
 * Seat pose on a piece at `piece` (its floor point) turned `yawDeg` (the
 * front, local +Z, faces world (sin yaw, cos yaw)). Sofas seat the player
 * where they approached (clamped to the cushions of a `width` m piece); other
 * seats are centred. Null for kinds that are not seats.
 */
export function seatPose(kind, piece, yawDeg, player, width = 1) {
    const h = SEAT_HEIGHT[kind];
    if (h === undefined || !Number.isFinite(yawDeg + piece[0] + piece[1] + piece[2]))
        return null;
    const t = (yawDeg * Math.PI) / 180;
    const fx = Math.sin(t);
    const fz = Math.cos(t);
    // Local +X in the world: front rotated by −90°.
    const rx = Math.cos(t);
    const rz = -Math.sin(t);
    let lateral = 0;
    if (kind === 'sofa' || kind === 'bench') {
        const reach = Math.max(0, Math.min(1.4, width / 2 - 0.4));
        lateral = Math.max(-reach, Math.min(reach, (player[0] - piece[0]) * rx + (player[2] - piece[2]) * rz));
    }
    const forward = kind === 'sofa' ? 0.06 : 0.02;
    const x = piece[0] + rx * lateral + fx * forward;
    const z = piece[2] + rz * lateral + fz * forward;
    const out = 0.85;
    return { feet: [x, piece[1] + h, z], yawDeg: yawDeg + 180, stand: [x + fx * out, piece[1] + 0.02, z + fz * out], eye: SEATED_EYE };
}
/** The entity (or its parent) carrying `interact` that a ray hit resolves to. */
export function usableEntity(world, hitId) {
    if (hitId === null)
        return null;
    const e = world.entities[hitId];
    if (!e)
        return null;
    if (e.interact)
        return e;
    const parent = e.parent !== null ? world.entities[e.parent] : undefined;
    return parent?.interact ? parent : null;
}
/** Verb and noun for an interactable in its current state. */
export function describeInteraction(spec, name, state, carried) {
    const noun = (spec.label ?? name ?? spec.kind).toLowerCase();
    switch (spec.kind) {
        case 'pickup':
            return { verb: carried ? 'Drop' : 'Pick up', noun };
        case 'tap':
        case 'switch':
            return { verb: state['on'] === true ? 'Turn off' : 'Turn on', noun };
        case 'seat':
            return { verb: 'Sit on', noun };
        default:
            return { verb: state['open'] === true ? 'Close' : 'Open', noun };
    }
}
/** The prompt for an aimed entity (null when it is out of reach). */
export function promptFor(entity, state, distance, carried) {
    const spec = entity.interact;
    if (!spec)
        return null;
    if (distance > (spec.reach ?? DEFAULT_REACH))
        return null;
    const { verb, noun } = describeInteraction(spec, entity.name, state, carried);
    return { id: entity.id, key: 'E', verb, noun, text: `E · ${verb} ${noun}`, hint: carried ? 'Click · Throw' : null };
}
/**
 * Where a carried prop is held: `HOLD_DISTANCE` ahead of the eye along `dir`,
 * pulled back when a wall (`wallDistance` along the ray) is closer so props
 * never go through geometry, and never below `floorY + 0.15`.
 */
export function holdPoint(eye, dir, wallDistance, floorY) {
    const reach = wallDistance === null ? HOLD_DISTANCE : Math.max(0.5, Math.min(HOLD_DISTANCE, wallDistance - 0.25));
    const y = Math.max(floorY + 0.15, eye[1] + dir[1] * reach - 0.15);
    return [eye[0] + dir[0] * reach, y, eye[2] + dir[2] * reach];
}
/** Velocity that moves a carried prop from `pos` toward `target` within one frame, capped. */
export function carryVelocity(pos, target, gain = 14) {
    const vx = (target[0] - pos[0]) * gain;
    const vy = (target[1] - pos[1]) * gain;
    const vz = (target[2] - pos[2]) * gain;
    const len = Math.hypot(vx, vy, vz);
    if (len <= CARRY_MAX_SPEED || len === 0)
        return [vx, vy, vz];
    const k = CARRY_MAX_SPEED / len;
    return [vx * k, vy * k, vz * k];
}
/** Velocity of a thrown prop: the aim direction at {@link THROW_SPEED}, a little lift, plus the player's own motion. */
export function throwVelocity(dir, playerVelocity = [0, 0, 0]) {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return [(dir[0] / len) * THROW_SPEED + playerVelocity[0], (dir[1] / len) * THROW_SPEED + 1.2 + playerVelocity[1], (dir[2] / len) * THROW_SPEED + playerVelocity[2]];
}
/** The aim-and-use controller of one play session. */
export class PlayInteraction {
    session;
    aim;
    events;
    carried = null;
    last = null;
    disposed = false;
    constructor(session, aim, events) {
        this.session = session;
        this.aim = aim;
        this.events = events;
    }
    /** The prop being carried, if any. */
    get carrying() {
        return this.carried;
    }
    /** Look at what the crosshair is on (call once per frame): updates the prompt and moves a carried prop. */
    frame() {
        if (this.disposed)
            return;
        if (this.session.isSitting())
            return this.report({ id: 'seat', key: 'E', verb: 'Stand up', noun: '', text: 'E · Stand up', hint: null });
        const a = this.aim.aim();
        if (!a)
            return this.report(null);
        if (this.carried !== null) {
            this.moveCarried(a);
            const e = this.session.world.entities[this.carried];
            return this.report(e ? promptFor(e, this.session.entityState(e.id), 0, true) : null);
        }
        const { target, distance } = this.cast(a);
        this.report(target ? promptFor(target, this.session.entityState(target.id), distance, false) : null);
    }
    /** The use key was pressed. Returns true when it acted (the key must not also reach the game). */
    use() {
        if (this.disposed)
            return false;
        if (this.session.isSitting()) {
            this.session.stand();
            return true;
        }
        if (this.carried !== null) {
            this.drop();
            return true;
        }
        const a = this.aim.aim();
        if (!a)
            return false;
        const { target, distance } = this.cast(a);
        if (!target || !promptFor(target, this.session.entityState(target.id), distance, false))
            return false;
        if (target.interact?.kind === 'pickup') {
            if (!this.session.isDynamic(target.id)) {
                this.events.toast('Too heavy to lift');
                return true;
            }
            this.carried = target.id;
            this.events.sound('pickup');
            return true;
        }
        if (target.interact?.kind === 'seat') {
            if (!this.session.sit(target.id))
                this.events.toast('Nowhere to sit there');
            return true;
        }
        this.session.use(target.id);
        return true;
    }
    /** A click while carrying throws the prop. Returns true when it did. */
    throwCarried() {
        if (this.disposed || this.carried === null)
            return false;
        const a = this.aim.aim();
        const id = this.carried;
        this.carried = null;
        if (a) {
            this.session.setVelocity(id, throwVelocity(a.dir, this.aim.playerVelocity()));
            this.session.setAngularVelocity(id, [(a.dir[2] ?? 0) * 6, 2, -(a.dir[0] ?? 0) * 6]);
            this.events.sound('whoosh');
        }
        return true;
    }
    /** Let go of the carried prop. */
    drop() {
        if (this.carried === null)
            return;
        this.session.setVelocity(this.carried, [0, 0, 0]);
        this.carried = null;
    }
    dispose() {
        this.disposed = true;
        this.carried = null;
        this.report(null);
    }
    /**
     * What the crosshair is on: the nearest solid hit (distance from the eye, for
     * walls) and the usable entity at or just behind it, if any.
     */
    cast(a) {
        const origin = [a.eye[0] + a.dir[0] * RAY_START, a.eye[1] + a.dir[1] * RAY_START, a.eye[2] + a.dir[2] * RAY_START];
        const hits = this.session.raycastAll(origin, a.dir, 4, this.carried ?? undefined);
        const first = hits[0];
        if (!first)
            return { wall: null, target: null, distance: 0 };
        for (const h of hits) {
            if (h.distance > first.distance + HIT_TOLERANCE)
                break;
            const target = usableEntity(this.session.world, h.id);
            if (target)
                return { wall: first.distance + RAY_START, target, distance: h.distance + RAY_START };
        }
        return { wall: first.distance + RAY_START, target: null, distance: first.distance + RAY_START };
    }
    moveCarried(a) {
        const id = this.carried;
        if (id === null)
            return;
        const pos = this.session.position(id);
        if (!pos) {
            this.carried = null;
            return;
        }
        const target = holdPoint(a.eye, a.dir, this.cast(a).wall, this.aim.floorY());
        // Too far from the hand (the player walked away or the prop snagged): let go.
        if (Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]) > 3.5) {
            this.drop();
            return;
        }
        this.session.setVelocity(id, carryVelocity(pos, target));
        this.session.setAngularVelocity(id, [0, 0, 0]);
    }
    report(p) {
        const key = p ? `${p.id}|${p.text}|${p.hint ?? ''}` : null;
        if (key === this.last)
            return;
        this.last = key;
        this.events.prompt(p);
    }
}

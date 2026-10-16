/**
 * Movement behaviors: spin, bob, orbit, patrol, follow, lookAt, wander, flee.
 *
 * Kinematic entities are posed through the shared anchor/offset composition
 * (so e.g. bob + spin + patrol compose); dynamic bodies are steered with
 * velocities where that makes sense.
 */
import { quatMultiply } from '@aether/core';
import { axisAngleQuat, copy3, distXZ, normalize3 } from '../vec';
import { faceDirection, halt, moveToward, steeringPosition } from './move';
const KINEMATIC = 'physics.body = kinematic or no physics (static bodies are posed like kinematic ones)';
const MOVER = 'kinematic/no physics (posed) or physics.body = dynamic (steered with velocity)';
const spinQ = [0, 0, 0, 1];
export const spin = {
    type: 'spin',
    description: 'Rotates continuously around a local axis (coins, fans, turntables). Composes with bob/orbit/patrol.',
    requires: KINEMATIC,
    params: {
        axis: { type: 'vec3', default: [0, 1, 0], description: 'local rotation axis' },
        speed: { type: 'number', default: 90, min: -3600, max: 3600, description: 'degrees per second (negative = reverse)' },
    },
    create(self, p) {
        const axis = p.vec3('axis');
        const speed = p.num('speed');
        let angle = 0;
        return {
            update(env, dt) {
                angle = (angle + speed * dt) % 360;
                env.pose(self);
                axisAngleQuat(spinQ, axis, angle);
                quatMultiply(self.extraRot, spinQ, self.extraRot);
            },
        };
    },
};
export const bob = {
    type: 'bob',
    description: 'Floats up and down (sine wave) around its position. Composes with spin/orbit/patrol.',
    requires: KINEMATIC,
    params: {
        amplitude: { type: 'number', default: 0.25, min: 0, max: 50, description: 'meters from the center' },
        period: { type: 'number', default: 2, min: 0.05, max: 120, description: 'seconds per full cycle' },
        phase: { type: 'number', default: 0, min: 0, max: 1, description: 'cycle offset 0–1 (desync groups)' },
        axis: { type: 'vec3', default: [0, 1, 0], description: 'world direction of the motion' },
    },
    create(self, p) {
        const amp = p.num('amplitude');
        const period = p.num('period');
        const phase = p.num('phase');
        const axis = normalize3([0, 0, 0], p.vec3('axis'));
        let t = 0;
        return {
            update(env, dt) {
                t += dt;
                const s = amp * Math.sin(2 * Math.PI * (t / period + phase));
                env.pose(self);
                self.offset[0] += axis[0] * s;
                self.offset[1] += axis[1] * s;
                self.offset[2] += axis[2] * s;
            },
        };
    },
};
/** Resolve a Vec3-or-selector target to a position (copied into `out`). */
function targetPosition(env, target, out) {
    if (target === undefined)
        return false;
    if (typeof target !== 'string') {
        copy3(out, target);
        return true;
    }
    const ids = env.resolve(target);
    const first = ids[0];
    if (first === undefined)
        return false;
    const p = env.positionOf(first);
    if (!p)
        return false;
    copy3(out, p);
    return true;
}
export const orbit = {
    type: 'orbit',
    description: 'Circles around a point or another entity on the horizontal plane (planets, guards, birds).',
    requires: MOVER,
    params: {
        center: { type: 'vec3', default: [0, 0, 0], description: 'world point [x,y,z] OR a selector string like "sun"' },
        radius: { type: 'number', default: 0, min: 0, max: 10000, description: 'meters; 0 = keep the starting distance' },
        speed: { type: 'number', default: 30, min: -3600, max: 3600, description: 'degrees per second (negative = clockwise)' },
        face: { type: 'boolean', default: true, description: 'face the direction of travel' },
    },
    create(self, p) {
        const centerSpec = p.vec3OrSelector('center');
        const speed = p.num('speed');
        const face = p.bool('face');
        let radius = p.num('radius');
        const center = [0, 0, 0];
        const target = [0, 0, 0];
        let angle = 0;
        let startCenterY = 0;
        let initialized = false;
        return {
            update(env, dt) {
                if (!targetPosition(env, centerSpec, center))
                    return;
                if (!initialized) {
                    const start = steeringPosition(env, self);
                    if (radius <= 0)
                        radius = distXZ(start, center);
                    angle = Math.atan2(start[2] - center[2], start[0] - center[0]);
                    startCenterY = center[1];
                    initialized = true;
                }
                angle += (speed * Math.PI / 180) * dt;
                target[0] = center[0] + Math.cos(angle) * radius;
                target[1] = self.basePos[1] + (center[1] - startCenterY);
                target[2] = center[2] + Math.sin(angle) * radius;
                if (self.dynamic) {
                    moveToward(env, self, target, Math.abs(speed * Math.PI / 180) * radius * 1.5 + 0.5, dt, { flat: true, face: false });
                    return;
                }
                env.pose(self);
                const dx = target[0] - self.anchor[0];
                const dz = target[2] - self.anchor[2];
                copy3(self.anchor, target);
                if (face)
                    faceDirection(self, dx, dz, 0, dt);
            },
        };
    },
};
export const patrol = {
    type: 'patrol',
    description: 'Walks/flies through waypoints in order, optionally waiting at each (guards, platforms, elevators).',
    requires: MOVER,
    params: {
        waypoints: { type: 'vec3[]', default: [], description: 'list of [x,y,z] points; empty = back and forth 4 m along +X' },
        relative: { type: 'boolean', default: false, description: 'waypoints are offsets from the start position' },
        speed: { type: 'number', default: 2, min: 0, max: 200, description: 'meters per second' },
        mode: { type: 'enum', default: 'loop', options: ['loop', 'pingpong', 'once'], description: 'what happens after the last waypoint' },
        wait: { type: 'number', default: 0, min: 0, max: 600, description: 'seconds to pause at each waypoint' },
        face: { type: 'boolean', default: true, description: 'turn toward the direction of travel' },
    },
    create(self, p) {
        const speed = p.num('speed');
        const mode = p.str('mode');
        const wait = p.num('wait');
        const face = p.bool('face');
        const relative = p.bool('relative') || !p.has('waypoints');
        let points = p.vec3List('waypoints');
        if (points.length === 0)
            points = [[0, 0, 0], [4, 0, 0]];
        const route = points.map((w) => relative ? [self.basePos[0] + w[0], self.basePos[1] + w[1], self.basePos[2] + w[2]] : w);
        let index = 0;
        let dir = 1;
        let waiting = 0;
        let finished = false;
        const arriveDist = self.dynamic ? 0.35 : 1e-4;
        return {
            update(env, dt) {
                if (finished || speed <= 0)
                    return;
                if (waiting > 0) {
                    waiting -= dt;
                    halt(env, self);
                    return;
                }
                const target = route[index];
                const remaining = moveToward(env, self, target, speed, dt, { flat: self.dynamic, face });
                if (remaining > arriveDist)
                    return;
                if (self.dynamic)
                    halt(env, self);
                waiting = wait;
                if (route.length === 1) {
                    finished = true;
                    return;
                }
                if (mode === 'pingpong') {
                    if (index + dir < 0 || index + dir >= route.length)
                        dir = -dir;
                    index += dir;
                }
                else if (mode === 'once') {
                    if (index === route.length - 1)
                        finished = true;
                    else
                        index++;
                }
                else {
                    index = (index + 1) % route.length;
                }
            },
        };
    },
};
export const follow = {
    type: 'follow',
    description: 'Chases a target (default the player) and stops at a distance (pets, enemies, companions).',
    requires: MOVER,
    params: {
        target: { type: 'selector', default: 'player', description: 'who to follow' },
        distance: { type: 'number', default: 2, min: 0, max: 1000, description: 'stop this many meters away' },
        speed: { type: 'number', default: 3, min: 0, max: 200, description: 'meters per second' },
        range: { type: 'number', default: 0, min: 0, max: 10000, description: 'only chase when closer than this (0 = always)' },
        face: { type: 'boolean', default: true, description: 'turn toward the target' },
        flat: { type: 'boolean', default: true, description: 'stay on the ground plane (false = fly in 3D)' },
    },
    create(self, p) {
        const target = p.str('target');
        const distance = p.num('distance');
        const speed = p.num('speed');
        const range = p.num('range');
        const face = p.bool('face');
        const flat = p.bool('flat');
        const goal = [0, 0, 0];
        return {
            update(env, dt) {
                if (!nearestOf(env, self, target, goal))
                    return halt(env, self);
                const pos = steeringPosition(env, self);
                const d = flat ? distXZ(pos, goal) : Math.hypot(goal[0] - pos[0], goal[1] - pos[1], goal[2] - pos[2]);
                if (range > 0 && d > range)
                    return halt(env, self);
                if (d <= distance) {
                    halt(env, self);
                    if (face && !self.dynamic) {
                        env.pose(self);
                        faceDirection(self, goal[0] - pos[0], goal[2] - pos[2], 360, dt);
                    }
                    return;
                }
                // Aim at the point `distance` meters short of the target.
                const k = (d - distance) / d;
                goal[0] = pos[0] + (goal[0] - pos[0]) * k;
                goal[1] = flat ? pos[1] : pos[1] + (goal[1] - pos[1]) * k;
                goal[2] = pos[2] + (goal[2] - pos[2]) * k;
                moveToward(env, self, goal, speed, dt, { flat, face, turnSpeed: 360 });
            },
        };
    },
};
/** Position of the nearest live entity matching `selector` (excluding self) into `out`. */
function nearestOf(env, self, selector, out) {
    const ids = env.resolve(selector);
    const pos = steeringPosition(env, self);
    let best = Infinity;
    let found;
    for (const id of ids) {
        if (id === self.id)
            continue;
        const q = env.positionOf(id);
        if (!q)
            continue;
        const dx = q[0] - pos[0], dy = q[1] - pos[1], dz = q[2] - pos[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) {
            best = d;
            found = id;
            copy3(out, q);
        }
    }
    return found !== undefined;
}
export const lookAt = {
    type: 'lookAt',
    description: 'Turns (yaw) to face a target, e.g. turrets, statues watching the player, NPC heads.',
    requires: KINEMATIC,
    params: {
        target: { type: 'selector', default: 'player', description: 'who to face (nearest match)' },
        turnSpeed: { type: 'number', default: 0, min: 0, max: 3600, description: 'degrees per second (0 = instant)' },
        range: { type: 'number', default: 0, min: 0, max: 10000, description: 'only track targets closer than this (0 = always)' },
    },
    create(self, p) {
        const target = p.str('target');
        const turnSpeed = p.num('turnSpeed');
        const range = p.num('range');
        const goal = [0, 0, 0];
        return {
            update(env, dt) {
                if (self.dynamic || !nearestOf(env, self, target, goal))
                    return;
                const pos = self.anchor;
                if (range > 0 && distXZ(pos, goal) > range)
                    return;
                env.pose(self);
                faceDirection(self, goal[0] - pos[0], goal[2] - pos[2], turnSpeed, dt);
            },
        };
    },
};
export const wander = {
    type: 'wander',
    description: 'Roams randomly (seeded, deterministic) within a radius of its start (animals, crowds).',
    requires: MOVER,
    params: {
        radius: { type: 'number', default: 5, min: 0, max: 1000, description: 'meters from the start position' },
        speed: { type: 'number', default: 1.5, min: 0, max: 100, description: 'meters per second' },
        pause: { type: 'number', default: 1, min: 0, max: 600, description: 'seconds to idle between legs' },
        face: { type: 'boolean', default: true, description: 'face the direction of travel' },
    },
    create(self, p, random) {
        const radius = p.num('radius');
        const speed = p.num('speed');
        const pause = p.num('pause');
        const face = p.bool('face');
        const goal = [0, 0, 0];
        let hasGoal = false;
        let waiting = 0;
        let legTime = 0;
        return {
            update(env, dt) {
                if (waiting > 0) {
                    waiting -= dt;
                    halt(env, self);
                    return;
                }
                if (!hasGoal) {
                    const a = random() * Math.PI * 2;
                    const r = Math.sqrt(random()) * radius;
                    goal[0] = self.basePos[0] + Math.cos(a) * r;
                    goal[1] = self.basePos[1];
                    goal[2] = self.basePos[2] + Math.sin(a) * r;
                    hasGoal = true;
                    legTime = 0;
                }
                legTime += dt;
                const remaining = moveToward(env, self, goal, speed, dt, { flat: true, face, turnSpeed: 270 });
                // Dynamic bodies may be blocked: give up on a leg after a generous timeout.
                const timeout = speed > 0 ? (radius * 2) / speed + 2 : 0;
                if (remaining <= (self.dynamic ? 0.4 : 1e-4) || legTime > timeout) {
                    hasGoal = false;
                    waiting = pause;
                    halt(env, self);
                }
            },
        };
    },
};
export const flee = {
    type: 'flee',
    description: 'Runs away from a threat when it comes close, staying within a leash of home (prey, shy NPCs).',
    requires: MOVER,
    params: {
        from: { type: 'selector', default: 'player', description: 'what to run from' },
        radius: { type: 'number', default: 6, min: 0, max: 1000, description: 'panic distance in meters' },
        speed: { type: 'number', default: 4, min: 0, max: 200, description: 'meters per second' },
        leash: { type: 'number', default: 20, min: 0, max: 10000, description: 'never go farther than this from the start (0 = unlimited)' },
        face: { type: 'boolean', default: true, description: 'face away while fleeing' },
    },
    create(self, p) {
        const from = p.str('from');
        const radius = p.num('radius');
        const speed = p.num('speed');
        const leash = p.num('leash');
        const face = p.bool('face');
        const threat = [0, 0, 0];
        const goal = [0, 0, 0];
        return {
            update(env, dt) {
                if (!nearestOf(env, self, from, threat))
                    return halt(env, self);
                const pos = steeringPosition(env, self);
                const d = distXZ(pos, threat);
                if (d > radius)
                    return halt(env, self);
                let ax = pos[0] - threat[0];
                let az = pos[2] - threat[2];
                const len = Math.hypot(ax, az);
                if (len < 1e-6) {
                    ax = 1;
                    az = 0;
                }
                else {
                    ax /= len;
                    az /= len;
                }
                goal[0] = pos[0] + ax * speed;
                goal[1] = pos[1];
                goal[2] = pos[2] + az * speed;
                if (leash > 0) {
                    const hx = goal[0] - self.basePos[0];
                    const hz = goal[2] - self.basePos[2];
                    const h = Math.hypot(hx, hz);
                    if (h > leash) {
                        goal[0] = self.basePos[0] + (hx / h) * leash;
                        goal[2] = self.basePos[2] + (hz / h) * leash;
                    }
                }
                moveToward(env, self, goal, speed, dt, { flat: true, face, turnSpeed: 540 });
            },
        };
    },
};
/** All movement behaviors. */
export const MOTION_BEHAVIORS = [spin, bob, orbit, patrol, follow, lookAt, wander, flee];

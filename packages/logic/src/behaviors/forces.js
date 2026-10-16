/**
 * Force-field behaviors acting on other bodies: conveyor, buoyancy, windZone,
 * magnet, plus the pulseLight effect.
 *
 * Forces are applied as velocity changes (acceleration × dt), which keeps them
 * independent of body mass — predictable for generated worlds.
 */
import { rotateVec3 } from '@aether/core';
import { insideZone } from '../bounds';
import { normalize3 } from '../vec';
const vel = [0, 0, 0];
const probe = [0, 0, 0];
const GRAVITY = 9.81;
/** Movers that are dynamic bodies (forces only affect simulated bodies) plus, optionally, the player. */
function affected(env, who, selfId, includePlayer) {
    const ids = who === '*' ? env.movers() : env.resolve(who);
    if (ids.length === 0)
        return ids;
    const pid = env.playerId();
    const out = [];
    for (const id of ids) {
        if (id === selfId)
            continue;
        if (id === pid ? includePlayer : env.entity(id)?.dynamic === true)
            out.push(id);
    }
    return out;
}
export const conveyor = {
    type: 'conveyor',
    description: 'Belt / moving walkway: bodies resting on top are carried along a direction.',
    requires: 'carried things must be dynamic bodies (or the player, if the host supports setVelocity on it)',
    params: {
        direction: { type: 'vec3', default: [1, 0, 0], description: 'belt direction in the entity\'s local space' },
        speed: { type: 'number', default: 2, min: -100, max: 100, description: 'belt speed in m/s' },
        grip: { type: 'number', default: 8, min: 0.1, max: 100, description: 'how quickly items match the belt speed (1/s)' },
        height: { type: 'number', default: 1.2, min: 0.05, max: 10, description: 'detection height above the belt' },
        who: { type: 'selector', default: '*', description: 'what it carries' },
    },
    create(self, p) {
        const local = normalize3([0, 0, 0], p.vec3('direction'));
        const speed = p.num('speed');
        const grip = p.num('grip');
        const height = p.num('height');
        const who = p.str('who');
        const dir = [0, 0, 0];
        return {
            update(env, dt) {
                rotateVec3(self.hasPose ? self.outRot : self.baseRot, local, dir);
                const k = Math.min(1, grip * dt);
                for (const id of affected(env, who, self.id, true)) {
                    if (!env.onTopOf(self, id, height))
                        continue;
                    const v = env.velocityOf(id) ?? [0, 0, 0];
                    vel[0] = v[0] + (dir[0] * speed - v[0]) * k;
                    vel[1] = v[1];
                    vel[2] = v[2] + (dir[2] * speed - v[2]) * k;
                    env.setVelocity(id, vel);
                }
            },
        };
    },
};
export const buoyancy = {
    type: 'buoyancy',
    description: 'Water volume: dynamic bodies below the surface are pushed up and slowed down so they float and bob.',
    requires: 'floating things must be physics.body = dynamic; put it on a (sensor or non-physics) water entity',
    params: {
        level: { type: 'number', default: 0, min: -1e4, max: 1e4, description: 'surface height offset from the top of this entity' },
        strength: { type: 'number', default: 1.6, min: 0, max: 20, description: 'upward push as a multiple of gravity at 1 m depth' },
        drag: { type: 'number', default: 1.5, min: 0, max: 50, description: 'water resistance (1/s)' },
    },
    create(self, p) {
        const levelOffset = p.num('level');
        const strength = p.num('strength');
        const drag = p.num('drag');
        return {
            update(env, dt) {
                const center = self.hasPose ? self.outPos : env.positionOf(self.id) ?? self.basePos;
                const surface = center[1] + self.zone.half[1] + levelOffset;
                const damp = Math.max(0, 1 - drag * dt);
                for (const id of affected(env, '*', self.id, false)) {
                    const q = env.positionOf(id);
                    if (!q || q[1] >= surface)
                        continue;
                    // Inside the footprint (generous vertically: anything below the surface counts).
                    probe[0] = q[0];
                    probe[1] = center[1];
                    probe[2] = q[2];
                    if (!insideZone(self.zone, center, self.hasPose ? self.outRot : self.baseRot, probe, 0))
                        continue;
                    const depth = Math.min(surface - q[1], 1);
                    const v = env.velocityOf(id) ?? [0, 0, 0];
                    vel[0] = v[0] * damp;
                    vel[1] = (v[1] + GRAVITY * strength * depth * dt) * damp;
                    vel[2] = v[2] * damp;
                    env.setVelocity(id, vel);
                }
            },
        };
    },
};
export const windZone = {
    type: 'windZone',
    description: 'Invisible (or visible) volume that pushes bodies inside it in a direction, optionally gusting.',
    requires: 'pushed things must be dynamic bodies (or the player, if the host supports it)',
    params: {
        direction: { type: 'vec3', default: [1, 0, 0], description: 'world wind direction' },
        strength: { type: 'number', default: 6, min: 0, max: 500, description: 'acceleration in m/s²' },
        gust: { type: 'number', default: 0, min: 0, max: 1, description: 'random strength variation 0–1 (seeded)' },
        who: { type: 'selector', default: '*', description: 'what it pushes' },
        player: { type: 'boolean', default: true, description: 'also push the player' },
    },
    create(self, p, random) {
        const dir = normalize3([0, 0, 0], p.vec3('direction'));
        const strength = p.num('strength');
        const gust = p.num('gust');
        const who = p.str('who');
        const pushPlayer = p.bool('player');
        return {
            update(env, dt) {
                const a = strength * (1 - gust + gust * 2 * random()) * dt;
                for (const id of affected(env, who, self.id, pushPlayer)) {
                    if (!env.touching(self, id, 0))
                        continue;
                    const v = env.velocityOf(id) ?? [0, 0, 0];
                    vel[0] = v[0] + dir[0] * a;
                    vel[1] = v[1] + dir[1] * a;
                    vel[2] = v[2] + dir[2] * a;
                    env.setVelocity(id, vel);
                }
            },
        };
    },
};
export const magnet = {
    type: 'magnet',
    description: 'Attracts (or repels) matching dynamic bodies within a radius; pull grows toward the magnet.',
    requires: 'affected things must be physics.body = dynamic',
    params: {
        target: { type: 'selector', default: '#metal', description: 'which bodies are affected (e.g. "#metal", "*")' },
        radius: { type: 'number', default: 8, min: 0.1, max: 500, description: 'reach in meters' },
        strength: { type: 'number', default: 15, min: 0, max: 1000, description: 'acceleration at the center in m/s²' },
        mode: { type: 'enum', default: 'attract', options: ['attract', 'repel'], description: 'pull in or push away' },
    },
    create(self, p) {
        const target = p.str('target');
        const radius = p.num('radius');
        const strength = p.num('strength');
        const sign = p.str('mode') === 'repel' ? -1 : 1;
        return {
            update(env, dt) {
                const c = self.hasPose ? self.outPos : env.positionOf(self.id) ?? self.basePos;
                for (const id of affected(env, target, self.id, false)) {
                    const q = env.positionOf(id);
                    if (!q)
                        continue;
                    const dx = c[0] - q[0], dy = c[1] - q[1], dz = c[2] - q[2];
                    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (d > radius || d < 1e-4)
                        continue;
                    const a = (sign * strength * (1 - d / radius) * dt) / d;
                    const v = env.velocityOf(id) ?? [0, 0, 0];
                    vel[0] = v[0] + dx * a;
                    vel[1] = v[1] + dy * a;
                    vel[2] = v[2] + dz * a;
                    env.setVelocity(id, vel);
                }
            },
        };
    },
};
export const pulseLight = {
    type: 'pulseLight',
    description: 'Smoothly pulses a light\'s intensity (or a material\'s glow) with a sine wave — beacons, alarms, magic.',
    requires: 'a light (entity.light) for "light.intensity"; an emissive material for "material.emissiveIntensity"',
    params: {
        min: { type: 'number', default: 0.2, min: 0, max: 1000, description: 'lowest value' },
        max: { type: 'number', default: 2, min: 0, max: 1000, description: 'highest value' },
        period: { type: 'number', default: 1.5, min: 0.05, max: 600, description: 'seconds per cycle' },
        phase: { type: 'number', default: 0, min: 0, max: 1, description: 'cycle offset 0–1' },
        property: {
            type: 'enum',
            default: 'light.intensity',
            options: ['light.intensity', 'material.emissiveIntensity', 'material.opacity'],
            description: 'what to animate',
        },
    },
    create(self, p) {
        const lo = p.num('min');
        const hi = Math.max(lo, p.num('max'));
        const period = p.num('period');
        const phase = p.num('phase');
        const property = p.str('property');
        const cap = property === 'material.opacity' ? 1 : property === 'material.emissiveIntensity' ? 50 : Infinity;
        let t = 0;
        let last = NaN;
        return {
            update(env, dt) {
                t += dt;
                const s = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t / period + phase));
                const value = Math.min(cap, Math.round((lo + (hi - lo) * s) * 1000) / 1000);
                if (value === last)
                    return;
                last = value;
                env.host.setProperty(self.id, property, value);
            },
        };
    },
};
/** All force/effect behaviors. */
export const FORCE_BEHAVIORS = [conveyor, buoyancy, windZone, magnet, pulseLight];

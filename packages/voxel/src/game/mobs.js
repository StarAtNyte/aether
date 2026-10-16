import { createBody, moveBody } from '../collide';
/** Mob table. */
export const MOB_SPECS = {
    sheep: { kind: 'sheep', hostile: false, health: 8, speed: 1.6, halfWidth: 0.45, height: 1.3, damage: 0, drops: [['white_wool', 1, 1], ['raw_mutton', 1, 2]], sound: 'baa' },
    pig: { kind: 'pig', hostile: false, health: 10, speed: 1.7, halfWidth: 0.45, height: 0.9, damage: 0, drops: [['raw_porkchop', 1, 3]], sound: 'oink' },
    chicken: { kind: 'chicken', hostile: false, health: 4, speed: 1.5, halfWidth: 0.2, height: 0.7, damage: 0, drops: [['raw_chicken', 1, 1], ['feather', 0, 2]], sound: 'cluck' },
    zombie: { kind: 'zombie', hostile: true, health: 20, speed: 2.4, halfWidth: 0.3, height: 1.95, damage: 3, drops: [['rotten_flesh', 0, 2]], sound: 'groan' },
    spider: { kind: 'spider', hostile: true, health: 16, speed: 3.1, halfWidth: 0.6, height: 0.9, damage: 2, drops: [['string', 0, 2]], sound: 'hiss' },
};
/** Create a mob standing at (x, y, z). */
export function createMob(id, spec, x, y, z, yaw) {
    return {
        id, spec, body: createBody(x, y, z, spec.halfWidth, spec.height), health: spec.health, state: 'idle', timer: 1, tx: x, tz: z, yaw,
        phase: 0, walk: 0, hurt: 0, cooldown: 0, fallFrom: y, dead: false,
    };
}
const GRAVITY = 28;
const JUMP = 8.4;
/** Hostile mobs notice the player within this range (blocks). */
export const AGGRO_RANGE = 18;
/** Melee reach of a hostile mob (blocks, centre to centre, horizontal). */
export const ATTACK_RANGE = 1.3;
function angleTo(dx, dz) {
    return Math.atan2(-dx, -dz);
}
function turn(m, target, rate, dt) {
    let d = target - m.yaw;
    while (d > Math.PI)
        d -= Math.PI * 2;
    while (d < -Math.PI)
        d += Math.PI * 2;
    const step = rate * dt;
    m.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
}
/** True when stepping into column (x, z) from height y is safe (no cliff > 3, no lava, no deep water) — wander only. */
function safeStep(w, x, y, z) {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const fy = Math.floor(y);
    for (let d = 0; d <= 3; d++) {
        const cy = fy - d - 1;
        if (w.isHazard(fx, cy + 1, fz) || w.isHazard(fx, cy, fz))
            return false;
        if (w.isLiquid(fx, cy, fz))
            return d === 0 && !w.isLiquid(fx, cy - 1, fz);
        if (w.isSolid(fx, cy, fz))
            return true;
    }
    return false;
}
/**
 * Advance one mob by `dt`. `px/py/pz` is the player's feet position,
 * `night` enables hostile chasing, `rand()` is the game's seeded RNG.
 * Returns the damage the mob deals to the player this tick (reused object).
 */
export function tickMob(m, w, dt, px, py, pz, playerAlive, night, rand, out) {
    out.hit = 0;
    out.kx = 0;
    out.kz = 0;
    if (m.dead)
        return out;
    const b = m.body;
    m.timer -= dt;
    m.hurt = Math.max(0, m.hurt - dt);
    m.cooldown = Math.max(0, m.cooldown - dt);
    const dx = px - b.x;
    const dz = pz - b.z;
    const dist = Math.hypot(dx, dz);
    // Decide.
    if (m.spec.hostile && playerAlive && dist < AGGRO_RANGE && Math.abs(py - b.y) < 8 && (night || m.state === 'chase' || m.state === 'attack' || dist < 6)) {
        m.state = dist < ATTACK_RANGE + m.spec.halfWidth ? 'attack' : 'chase';
    }
    else if (m.state === 'chase' || m.state === 'attack') {
        m.state = 'idle';
        m.timer = 1 + rand() * 2;
    }
    else if (m.state === 'flee' && m.timer <= 0) {
        m.state = 'idle';
        m.timer = 1 + rand() * 3;
    }
    else if (m.state === 'idle' && m.timer <= 0) {
        const a = rand() * Math.PI * 2;
        const r = 3 + rand() * 7;
        m.tx = b.x + Math.cos(a) * r;
        m.tz = b.z + Math.sin(a) * r;
        m.state = 'wander';
        m.timer = 4 + rand() * 6;
    }
    else if (m.state === 'wander' && (m.timer <= 0 || Math.hypot(m.tx - b.x, m.tz - b.z) < 0.6)) {
        m.state = 'idle';
        m.timer = 2 + rand() * 5;
    }
    // Steer.
    let speed = 0;
    let heading = m.yaw;
    if (m.state === 'wander') {
        heading = angleTo(m.tx - b.x, m.tz - b.z);
        speed = m.spec.speed;
    }
    else if (m.state === 'flee') {
        heading = angleTo(-dx, -dz);
        speed = m.spec.speed * 2;
    }
    else if (m.state === 'chase') {
        heading = angleTo(dx, dz);
        speed = m.spec.speed;
    }
    else if (m.state === 'attack') {
        heading = angleTo(dx, dz);
        speed = m.spec.speed * 0.4;
        if (m.cooldown <= 0 && dist < ATTACK_RANGE + m.spec.halfWidth + 0.3 && Math.abs(py - b.y) < 1.6) {
            m.cooldown = 1;
            out.hit = m.spec.damage;
            const inv = dist > 1e-6 ? 1 / dist : 0;
            out.kx = dx * inv;
            out.kz = dz * inv;
        }
    }
    turn(m, heading, 6, dt);
    let vx = -Math.sin(m.yaw) * speed;
    let vz = -Math.cos(m.yaw) * speed;
    // Wandering never walks off cliffs or into lava.
    if ((m.state === 'wander' || m.state === 'flee') && speed > 0 && b.onGround) {
        const ahead = b.halfWidth + 0.4;
        if (!safeStep(w, b.x - Math.sin(m.yaw) * ahead, b.y, b.z - Math.cos(m.yaw) * ahead)) {
            vx = 0;
            vz = 0;
            if (m.state === 'wander') {
                m.state = 'idle';
                m.timer = 0.5 + rand();
            }
        }
    }
    // Knockback decays into the walking velocity.
    const blend = b.onGround ? Math.min(1, dt * 10) : Math.min(1, dt * 1.5);
    b.vx += (vx - b.vx) * blend;
    b.vz += (vz - b.vz) * blend;
    if (b.liquid > 0) {
        b.vy = Math.min(b.vy + 14 * dt, 2.2);
        b.vx *= 0.9;
        b.vz *= 0.9;
    }
    else {
        b.vy = Math.max(-50, b.vy - GRAVITY * dt);
    }
    const wasGround = b.onGround;
    moveBody(w, b, dt, false);
    // Hop up a one-block step when walking into it.
    if ((b.hitX || b.hitZ) && b.onGround && speed > 0)
        b.vy = JUMP;
    if (!wasGround && b.onGround && b.liquid === 0) {
        const fall = m.fallFrom - b.y;
        if (fall > 3.5)
            hurtMob(m, Math.floor(fall - 3), 0, 0, rand);
    }
    if (b.onGround || b.liquid > 0)
        m.fallFrom = b.y;
    else
        m.fallFrom = Math.max(m.fallFrom, b.y);
    const moving = Math.hypot(b.vx, b.vz);
    m.walk += ((moving > 0.2 ? 1 : 0) - m.walk) * Math.min(1, dt * 8);
    m.phase += moving * dt * 4.2;
    return out;
}
/** Damage a mob (knockback along kx/kz); passive mobs flee. Returns true when it died. */
export function hurtMob(m, amount, kx, kz, rand) {
    if (m.dead || amount <= 0)
        return false;
    m.health -= amount;
    m.hurt = 0.35;
    m.body.vx += kx * 6;
    m.body.vz += kz * 6;
    m.body.vy = Math.max(m.body.vy, 5);
    if (!m.spec.hostile) {
        m.state = 'flee';
        m.timer = 3 + rand() * 2;
    }
    else {
        m.state = 'chase';
    }
    if (m.health <= 0) {
        m.dead = true;
        return true;
    }
    return false;
}
/**
 * Slab test of a ray against a mob's box; returns the hit distance or
 * Infinity. Used for melee targeting.
 */
export function rayMob(m, ox, oy, oz, dx, dy, dz, max) {
    const b = m.body;
    let t0 = 0;
    let t1 = max;
    for (let a = 0; a < 3; a++) {
        const da = a === 0 ? dx : a === 1 ? dy : dz;
        const oa = a === 0 ? ox : a === 1 ? oy : oz;
        const lo = a === 0 ? b.x - b.halfWidth : a === 1 ? b.y : b.z - b.halfWidth;
        const hi = a === 0 ? b.x + b.halfWidth : a === 1 ? b.y + b.height : b.z + b.halfWidth;
        if (Math.abs(da) < 1e-9) {
            if (oa < lo || oa > hi)
                return Infinity;
            continue;
        }
        let ta = (lo - oa) / da;
        let tb = (hi - oa) / da;
        if (ta > tb) {
            const t = ta;
            ta = tb;
            tb = t;
        }
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1)
            return Infinity;
    }
    return t0;
}

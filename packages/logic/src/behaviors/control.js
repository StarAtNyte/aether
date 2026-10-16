import { ParamReader } from '../params';
import { clamp, yawOfQuat } from '../vec';
import { faceDirection, halt } from './move';
import { wander } from './motion';
const DEG2RAD = Math.PI / 180;
const GRAVITY = 9.81;
const vel = [0, 0, 0];
const angVel = [0, 0, 0];
/** Camera-relative input → world XZ direction (scaled by stick magnitude, ≤ 1). Forward is −Z at yaw 0. */
function inputDirection(env, out) {
    const f = clamp(env.input.forward, -1, 1);
    const r = clamp(env.input.right, -1, 1);
    const yaw = (Number.isFinite(env.input.pointerYawDeg) ? env.input.pointerYawDeg : 0) * DEG2RAD;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    // forward = (−sin, 0, −cos), right = (cos, 0, −sin)
    out[0] = -s * f + c * r;
    out[1] = 0;
    out[2] = -c * f - s * r;
    const len = Math.hypot(out[0], out[2]);
    if (len > 1) {
        out[0] /= len;
        out[2] /= len;
        return 1;
    }
    return len;
}
export const playerController = {
    type: 'playerController',
    description: 'Makes this entity the player avatar: WASD/stick moves it relative to the camera, jump makes it jump, and falling below `respawnBelow` respawns it at the last checkpoint.',
    requires: 'physics.body = dynamic (velocity control, lockRotation recommended) or kinematic/no physics (simple built-in gravity)',
    params: {
        speed: { type: 'number', default: 6, min: 0, max: 100, description: 'run speed in m/s' },
        jump: { type: 'number', default: 6, min: 0, max: 100, description: 'jump take-off speed in m/s (0 = no jumping)' },
        respawnBelow: { type: 'number', default: -20, min: -1e5, max: 1e5, description: 'respawn when y drops below this' },
        face: { type: 'boolean', default: true, description: 'kinematic: turn to face the movement direction' },
    },
    create(self, p) {
        const speed = p.num('speed');
        const jump = p.num('jump');
        const respawnBelow = p.num('respawnBelow');
        const face = p.bool('face');
        const dir = [0, 0, 0];
        let vy = 0;
        let jumpCooldown = 0;
        let wasJump = false;
        return {
            update(env, dt) {
                const mag = inputDirection(env, dir);
                const jumpEdge = env.input.jump && !wasJump;
                wasJump = env.input.jump;
                jumpCooldown = Math.max(0, jumpCooldown - dt);
                const pos = self.dynamic ? env.positionOf(self.id) : self.anchor;
                if (pos && pos[1] < respawnBelow) {
                    const to = env.respawnPoint ?? env.playerSpawn;
                    env.teleport(self.id, to);
                    vy = 0;
                    env.log(`${self.id} fell below ${respawnBelow} → respawned`);
                    return;
                }
                if (self.dynamic) {
                    const v = env.velocityOf(self.id);
                    let y = v ? v[1] : 0;
                    const grounded = Math.abs(y) < 0.25;
                    if (jumpEdge && grounded && jump > 0 && jumpCooldown === 0) {
                        y = jump;
                        jumpCooldown = 0.25;
                    }
                    vel[0] = dir[0] * speed;
                    vel[1] = y;
                    vel[2] = dir[2] * speed;
                    env.setVelocity(self.id, vel);
                    return;
                }
                env.pose(self);
                const ground = self.basePos[1];
                const grounded = self.anchor[1] <= ground + 1e-6;
                if (jumpEdge && grounded && jump > 0)
                    vy = jump;
                vy -= GRAVITY * dt;
                self.anchor[0] += dir[0] * speed * dt;
                self.anchor[2] += dir[2] * speed * dt;
                self.anchor[1] += vy * dt;
                if (self.anchor[1] <= ground) {
                    self.anchor[1] = ground;
                    vy = 0;
                }
                if (face && mag > 0.05)
                    faceDirection(self, dir[0], dir[2], 720, dt);
            },
        };
    },
};
export const vehicle = {
    type: 'vehicle',
    description: 'Arcade car: forward/back accelerates and brakes, left/right steers (steering scales with speed), sideways slip is removed. Driven when it is the player-controlled entity (player.mode = "vehicle", player.controls = its id).',
    requires: 'physics.body = dynamic (host should support setAngularVelocity for steering) or kinematic/no physics',
    params: {
        maxSpeed: { type: 'number', default: 20, min: 0.1, max: 200, description: 'top speed in m/s' },
        acceleration: { type: 'number', default: 10, min: 0, max: 500, description: 'm/s² under throttle' },
        brake: { type: 'number', default: 20, min: 0, max: 500, description: 'm/s² when braking against motion' },
        drag: { type: 'number', default: 2, min: 0, max: 100, description: 'm/s² coasting deceleration' },
        turnRate: { type: 'number', default: 90, min: 0, max: 720, description: 'degrees per second at full lock' },
        reverseRatio: { type: 'number', default: 0.4, min: 0, max: 1, description: 'reverse top speed as a fraction of maxSpeed' },
        grip: { type: 'number', default: 8, min: 0, max: 100, description: 'how quickly sideways slip is removed (1/s)' },
        always: { type: 'boolean', default: false, description: 'respond to input even when not the controlled entity' },
    },
    create(self, p) {
        const maxSpeed = p.num('maxSpeed');
        const accel = p.num('acceleration');
        const brake = p.num('brake');
        const drag = p.num('drag');
        const turnRate = p.num('turnRate');
        const reverse = p.num('reverseRatio');
        const grip = p.num('grip');
        const always = p.bool('always');
        let speed = 0;
        return {
            update(env, dt) {
                const pid = env.playerId();
                const driven = always || pid === self.id || pid === undefined;
                const throttle = driven ? clamp(env.input.forward, -1, 1) : 0;
                const steer = driven ? clamp(env.input.right, -1, 1) : 0;
                let heading;
                if (self.dynamic) {
                    const t = env.host.getTransform(self.id);
                    heading = t ? yawOfQuat(t.quaternion) : 0;
                    const v = env.velocityOf(self.id);
                    const fx = -Math.sin(heading * DEG2RAD), fz = -Math.cos(heading * DEG2RAD);
                    if (v)
                        speed = v[0] * fx + v[2] * fz;
                }
                else {
                    heading = self.yawDeg + yawOfQuat(self.baseRot);
                }
                if (throttle !== 0) {
                    const braking = speed * throttle < 0;
                    speed += throttle * (braking ? brake : accel) * dt;
                }
                else {
                    const d = drag * dt;
                    speed = Math.abs(speed) <= d ? 0 : speed - Math.sign(speed) * d;
                }
                speed = clamp(speed, -maxSpeed * reverse, maxSpeed);
                // Steering is proportional to speed (no turning on the spot), reversed when backing up.
                const turn = -steer * turnRate * clamp(speed / Math.max(maxSpeed * 0.25, 1e-3), -1, 1);
                const fx = -Math.sin(heading * DEG2RAD), fz = -Math.cos(heading * DEG2RAD);
                if (self.dynamic) {
                    const v = env.velocityOf(self.id);
                    const vx = v ? v[0] : 0, vz = v ? v[2] : 0;
                    // Forward speed is driven directly; sideways slip decays with `grip`.
                    const along = vx * fx + vz * fz;
                    const keep = 1 - Math.min(1, grip * dt);
                    vel[0] = fx * speed + (vx - fx * along) * keep;
                    vel[1] = v ? v[1] : 0;
                    vel[2] = fz * speed + (vz - fz * along) * keep;
                    env.setVelocity(self.id, vel);
                    if (env.host.setAngularVelocity) {
                        angVel[0] = 0;
                        angVel[1] = turn * DEG2RAD;
                        angVel[2] = 0;
                        env.host.setAngularVelocity(self.id, angVel);
                    }
                    self.state['speed'] = Math.round(speed * 10) / 10;
                    return;
                }
                env.pose(self);
                self.yawDeg += turn * dt;
                self.anchor[0] += fx * speed * dt;
                self.anchor[2] += fz * speed * dt;
                self.state['speed'] = Math.round(speed * 10) / 10;
            },
        };
    },
};
export const npc = {
    type: 'npc',
    description: 'Character with a name, persona and dialog lines: wanders while idle, greets the player who comes within greetRadius, then cycles through its lines while the player stays near, and says farewell. Writes "<id>.npcState" (idle/greet/talk).',
    requires: 'kinematic/no physics for wandering and facing (dynamic NPCs only talk)',
    params: {
        name: { type: 'string', default: '', description: 'display name (defaults to the entity name)' },
        persona: { type: 'string', default: '', description: 'personality description (for authoring / future LLM dialog)' },
        lines: { type: 'string[]', default: ['Hello, traveler!'], description: 'dialog lines; the first is the greeting' },
        greetRadius: { type: 'number', default: 4, min: 0.5, max: 100, description: 'distance at which it greets the player' },
        talkInterval: { type: 'number', default: 4, min: 0.5, max: 120, description: 'seconds between lines' },
        farewell: { type: 'string', default: '', description: 'said when the player walks away ("" = nothing)' },
        wander: { type: 'boolean', default: true, description: 'roam while idle' },
        wanderRadius: { type: 'number', default: 3, min: 0, max: 100, description: 'idle roaming radius' },
        speed: { type: 'number', default: 1, min: 0, max: 20, description: 'walking speed' },
    },
    create(self, p, random) {
        const name = p.str('name') || self.spec.name || self.id;
        let lines = p.strList('lines');
        if (lines.length === 0)
            lines = ['Hello, traveler!'];
        const greetRadius = p.num('greetRadius');
        const talkInterval = p.num('talkInterval');
        const farewell = p.str('farewell');
        const roam = p.bool('wander')
            ? wander.create(self, new ParamReader(wander.params, { radius: p.num('wanderRadius'), speed: p.num('speed'), pause: 2 }), random)
            : undefined;
        let phase = 'idle';
        let lineIndex = 0;
        let timer = 0;
        const setPhase = (next) => {
            phase = next;
            self.state['npcState'] = next;
            self.state['talking'] = next !== 'idle';
        };
        const say = (env, text) => {
            env.host.message(`${name}: ${text}`, Math.min(talkInterval, 6));
        };
        setPhase('idle');
        return {
            update(env, dt) {
                const pid = env.playerId();
                const pp = pid !== undefined ? env.positionOf(pid) : undefined;
                const here = self.dynamic ? env.positionOf(self.id) ?? self.anchor : self.anchor;
                const d = pp ? Math.hypot(pp[0] - here[0], pp[2] - here[2]) : Infinity;
                if (phase === 'idle') {
                    if (d <= greetRadius) {
                        setPhase('greet');
                        say(env, lines[0]);
                        env.log(`npc ${self.id} greets ${pid ?? 'player'}`);
                        lineIndex = 1;
                        timer = 0;
                    }
                    else {
                        roam?.update?.(env, dt);
                        return;
                    }
                }
                // greet / talk: stand still, face the player, cycle lines.
                halt(env, self);
                if (pp && !self.dynamic) {
                    env.pose(self);
                    faceDirection(self, pp[0] - here[0], pp[2] - here[2], 360, dt);
                }
                if (d > greetRadius * 1.5) {
                    if (farewell)
                        say(env, farewell);
                    env.log(`npc ${self.id} stops talking`);
                    setPhase('idle');
                    return;
                }
                timer += dt;
                if (timer >= talkInterval) {
                    timer = 0;
                    if (phase === 'greet')
                        setPhase('talk');
                    if (lines.length > 1) {
                        if (lineIndex >= lines.length)
                            lineIndex = 1;
                        say(env, lines[lineIndex]);
                        lineIndex++;
                    }
                }
            },
        };
    },
};
/** All control/character behaviors. */
export const CONTROL_BEHAVIORS = [playerController, vehicle, npc];

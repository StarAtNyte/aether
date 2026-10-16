import { angleDelta, yawFromDirection, yawOfQuat } from '../vec';
const vel = [0, 0, 0];
/** Current position used for steering (anchor for kinematic, physics for dynamic). */
export function steeringPosition(env, self) {
    if (self.dynamic)
        return env.positionOf(self.id) ?? self.anchor;
    return self.anchor;
}
/** Turn a kinematic entity's yaw toward `targetYaw`, limited by `turnSpeed` (deg/s, 0 = instant). */
export function turnToward(self, targetYaw, turnSpeed, dt) {
    const d = angleDelta(self.yawDeg, targetYaw);
    if (turnSpeed <= 0)
        self.yawDeg += d;
    else {
        const maxStep = turnSpeed * dt;
        self.yawDeg += d > maxStep ? maxStep : d < -maxStep ? -maxStep : d;
    }
    self.yawDeg = ((self.yawDeg % 360) + 540) % 360 - 180;
}
/** Turn a kinematic entity so its −Z forward axis points along (dx, dz) in world space. */
export function faceDirection(self, dx, dz, turnSpeed, dt) {
    if (dx * dx + dz * dz < 1e-12)
        return;
    turnToward(self, yawFromDirection(dx, dz, 0) - yawOfQuat(self.baseRot), turnSpeed, dt);
}
/**
 * Move `self` toward `target` at `speed` m/s for one step. Returns the
 * remaining distance after the step (0 when arrived).
 */
export function moveToward(env, self, target, speed, dt, opts) {
    const pos = steeringPosition(env, self);
    const dx = target[0] - pos[0];
    const dy = opts.flat ? 0 : target[1] - pos[1];
    const dz = target[2] - pos[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (self.dynamic) {
        const v = env.velocityOf(self.id);
        const s = d > 1e-6 ? Math.min(speed, d / Math.max(dt, 1e-6)) / d : 0;
        vel[0] = dx * s;
        vel[1] = opts.flat ? (v ? v[1] : 0) : dy * s;
        vel[2] = dz * s;
        env.setVelocity(self.id, vel);
        return d;
    }
    env.pose(self);
    if (d < 1e-9)
        return 0;
    const step = Math.min(speed * dt, d);
    const k = step / d;
    self.anchor[0] += dx * k;
    self.anchor[1] += dy * k;
    self.anchor[2] += dz * k;
    if (opts.face)
        faceDirection(self, dx, dz, opts.turnSpeed ?? 0, dt);
    return d - step;
}
/** Stop a dynamic body's horizontal motion (kinematic entities simply stay put). */
export function halt(env, self) {
    if (!self.dynamic)
        return;
    const v = env.velocityOf(self.id);
    vel[0] = 0;
    vel[1] = v ? v[1] : 0;
    vel[2] = 0;
    env.setVelocity(self.id, vel);
}

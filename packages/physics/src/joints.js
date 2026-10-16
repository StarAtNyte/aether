import { rapier } from './rapier';
import { distance, fmt, isFiniteVec, length, quatConjugate, quatMul, rotate, rotateInv } from './vec';
const ANCHOR_MISMATCH_M = 0.05;
const DEG = Math.PI / 180;
function bodyPose(b) {
    const t = b.translation();
    const r = b.rotation();
    return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
}
function v3(v) {
    return { x: v[0], y: v[1], z: v[2] };
}
function invalid(id, message, suggestion) {
    return { error: { severity: 'error', code: 'jointInvalid', entities: [id], message, ...(suggestion ? { suggestion } : {}) } };
}
/**
 * Create the joint of `self` described by `spec`. `target` is the resolved
 * other side or `'world'`. Invalid specs return a `jointInvalid` diagnostic
 * instead of throwing.
 */
export function createJoint(world, spec, self, target) {
    const R = rapier();
    if (!isFiniteVec(spec.anchor) || !isFiniteVec(spec.targetAnchor) || !isFiniteVec(spec.axis)) {
        return invalid(self.id, `${self.id}: joint anchor/axis must be finite numbers`);
    }
    const axisLen = length(spec.axis);
    if ((spec.type === 'revolute' || spec.type === 'prismatic') && axisLen < 1e-9) {
        return invalid(self.id, `${self.id}: ${spec.type} joint axis is zero`, 'set joint.axis to a direction such as [0, 1, 0]');
    }
    const axis1 = axisLen > 1e-9 ? [spec.axis[0] / axisLen, spec.axis[1] / axisLen, spec.axis[2] / axisLen] : [0, 1, 0];
    const s1 = bodyPose(self.body);
    const anchor1 = [spec.anchor[0] * self.scale[0], spec.anchor[1] * self.scale[1], spec.anchor[2] * self.scale[2]];
    const worldAnchor = rotate(s1.q, anchor1);
    worldAnchor[0] += s1.p[0];
    worldAnchor[1] += s1.p[1];
    worldAnchor[2] += s1.p[2];
    const autoTarget = spec.targetAnchor[0] === 0 && spec.targetAnchor[1] === 0 && spec.targetAnchor[2] === 0;
    const warnings = [];
    // Rapier measures joint coordinates (limits, motors) of body2 relative to body1,
    // so the target is body1 and this entity is body2.
    let targetBody;
    let anchorBody = null;
    let targetAnchor;
    let qT;
    if (target === 'world') {
        const at = autoTarget ? worldAnchor : spec.targetAnchor;
        anchorBody = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(at[0], at[1], at[2]).setRotation({ x: s1.q[0], y: s1.q[1], z: s1.q[2], w: s1.q[3] }));
        targetBody = anchorBody;
        targetAnchor = [0, 0, 0];
        qT = s1.q;
        if (!autoTarget)
            checkMismatch(self.id, 'world', worldAnchor, at, warnings);
    }
    else {
        if (target.body.handle === self.body.handle)
            return invalid(self.id, `${self.id}: joint targets itself`, 'set joint.target to another entity id or "world"');
        targetBody = target.body;
        const s2 = bodyPose(targetBody);
        qT = s2.q;
        if (autoTarget) {
            targetAnchor = rotateInv(s2.q, [worldAnchor[0] - s2.p[0], worldAnchor[1] - s2.p[1], worldAnchor[2] - s2.p[2]]);
        }
        else {
            targetAnchor = [spec.targetAnchor[0] * target.scale[0], spec.targetAnchor[1] * target.scale[1], spec.targetAnchor[2] * target.scale[2]];
            const w2 = rotate(s2.q, targetAnchor);
            checkMismatch(self.id, target.id, worldAnchor, [w2[0] + s2.p[0], w2[1] + s2.p[1], w2[2] + s2.p[2]], warnings, anchor2Suggestion(s2, worldAnchor, target.scale));
        }
    }
    // Orientation of this entity in the target's frame.
    const rel = quatMul(quatConjugate(qT), s1.q);
    const axisInTarget = rotate(rel, axis1);
    let data;
    switch (spec.type) {
        case 'fixed':
            data = R.JointData.fixed(v3(targetAnchor), { x: rel[0], y: rel[1], z: rel[2], w: rel[3] }, v3(anchor1), { x: 0, y: 0, z: 0, w: 1 });
            break;
        case 'spherical':
            data = R.JointData.spherical(v3(targetAnchor), v3(anchor1));
            break;
        case 'revolute':
            data = R.JointData.revoluteWithAxes(v3(targetAnchor), v3(anchor1), v3(axisInTarget), v3(axis1));
            break;
        case 'prismatic':
            data = R.JointData.prismatic(v3(targetAnchor), v3(anchor1), v3(axisInTarget));
            break;
    }
    const unit = spec.type === 'revolute' ? DEG : 1;
    let limits = null;
    if (spec.limits && (spec.type === 'revolute' || spec.type === 'prismatic')) {
        if (!isFiniteVec(spec.limits, 2)) {
            if (anchorBody)
                world.removeRigidBody(anchorBody);
            return invalid(self.id, `${self.id}: joint limits must be finite`);
        }
        limits = [Math.min(spec.limits[0], spec.limits[1]) * unit, Math.max(spec.limits[0], spec.limits[1]) * unit];
    }
    const joint = world.createImpulseJoint(data, targetBody, self.body, true);
    joint.setContactsEnabled(false);
    if (limits)
        joint.setLimits(limits[0], limits[1]);
    if (spec.motor && (spec.type === 'revolute' || spec.type === 'prismatic')) {
        const m = spec.motor;
        const unitJoint = joint;
        const vel = Number.isFinite(m.targetVelocity) ? m.targetVelocity * unit : 0;
        const damping = Number.isFinite(m.damping) ? m.damping : 10;
        if (m.targetPosition !== undefined && Number.isFinite(m.targetPosition)) {
            unitJoint.configureMotor(m.targetPosition * unit, vel, Number.isFinite(m.stiffness) ? m.stiffness : 0, damping);
        }
        else {
            unitJoint.configureMotorVelocity(vel, damping);
        }
        if (Number.isFinite(m.maxForce))
            unitJoint.setMotorMaxForce(m.maxForce);
    }
    else if (spec.motor) {
        warnings.push({ severity: 'warning', code: 'jointInvalid', entities: [self.id], message: `${self.id}: motors only apply to revolute/prismatic joints; motor ignored` });
    }
    return { joint, anchorBody, warnings };
}
function anchor2Suggestion(s2, worldAnchor, scale) {
    const local = rotateInv(s2.q, [worldAnchor[0] - s2.p[0], worldAnchor[1] - s2.p[1], worldAnchor[2] - s2.p[2]]);
    const unscaled = local.map((v, i) => fmt(v / (scale[i] || 1), 3));
    return `set joint.targetAnchor to [${unscaled.join(', ')}] (or [0, 0, 0] to attach at the current position)`;
}
function checkMismatch(id, targetId, a, b, out, suggestion) {
    const gap = distance(a, b);
    if (gap <= ANCHOR_MISMATCH_M)
        return;
    out.push({
        severity: 'warning',
        code: 'jointInvalid',
        entities: targetId === 'world' ? [id] : [id, targetId],
        message: `${id}: joint anchors are ${fmt(gap)}m apart; the bodies will snap together when simulation starts`,
        suggestion: suggestion ?? `set joint.targetAnchor to [${a.map((v) => fmt(v, 3)).join(', ')}] (world space) or [0, 0, 0]`,
    });
}

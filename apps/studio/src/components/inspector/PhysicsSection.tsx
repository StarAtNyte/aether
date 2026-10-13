/**
 * Physics and joint editing: body type, collider shape, mass / density,
 * friction, bounce, damping, gravity scale, CCD, sensor and rotation lock;
 * joints with type, target, anchors, axis, limits and motor. The selected
 * entity's joint is drawn in the viewport (anchor, axis, link).
 */
import { memo, type ReactElement } from 'react';
import { BodyType, ColliderKind, type Entity, type Json, type WorldDoc } from '@aether/core';
import { FieldRow, NumberField, SelectField, Section, Switch, Toggle, Vec3Field } from '../fields';
import { Icon } from '../Icon';

type Update = (set: Record<string, Json>, message: string) => void;

const BODY_OPTIONS = ['none', ...BodyType.options] as const;
type BodyOption = (typeof BODY_OPTIONS)[number];
const JOINT_TYPES = ['none', 'fixed', 'revolute', 'prismatic', 'spherical'] as const;
type JointOption = (typeof JOINT_TYPES)[number];

/** The physics section. */
export const PhysicsSection = memo(function PhysicsSection({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement {
  const p = e.physics;
  const name = e.name || e.id;
  return (
    <Section title="Physics">
      <FieldRow label="Body">
        <SelectField<BodyOption> label="Body type" value={p ? p.body : 'none'} options={BODY_OPTIONS} disabled={disabled} onChange={(v) => update({ physics: v === 'none' ? null : { body: v } }, v === 'none' ? `Remove ${name} physics` : `Make ${name} ${v}`)} />
      </FieldRow>
      {p && (
        <>
          <FieldRow label="Collider">
            <SelectField label="Collider shape" value={p.collider} options={ColliderKind.options} disabled={disabled} onChange={(v) => update({ physics: { collider: v } }, `${name} collider: ${v}`)} />
          </FieldRow>
          {p.body === 'dynamic' && (
            <>
              <FieldRow label="Mass (kg)">
                <NumberField label="Mass" value={p.mass ?? 1} min={0.001} step={0.5} disabled={disabled} onCommit={(n) => update({ physics: { mass: n } }, `Set ${name} mass`)} />
              </FieldRow>
              <FieldRow label="Gravity ×">
                <NumberField label="Gravity scale" value={p.gravityScale} min={-10} max={10} step={0.1} disabled={disabled} onCommit={(n) => update({ physics: { gravityScale: n } }, `Set ${name} gravity scale`)} />
              </FieldRow>
              <FieldRow label="Damping">
                <div className="vec2">
                  <NumberField label="Linear damping" value={p.linearDamping} min={0} step={0.05} disabled={disabled} onCommit={(n) => update({ physics: { linearDamping: n } }, `Set ${name} damping`)} />
                  <NumberField label="Angular damping" value={p.angularDamping} min={0} step={0.05} disabled={disabled} onCommit={(n) => update({ physics: { angularDamping: n } }, `Set ${name} spin damping`)} />
                </div>
              </FieldRow>
            </>
          )}
          <FieldRow label="Friction">
            <NumberField label="Friction" value={p.friction} min={0} max={5} step={0.05} disabled={disabled} onCommit={(n) => update({ physics: { friction: n } }, `Set ${name} friction`)} />
          </FieldRow>
          <FieldRow label="Bounce">
            <NumberField label="Restitution" value={p.restitution} min={0} max={1} step={0.05} disabled={disabled} onCommit={(n) => update({ physics: { restitution: n } }, `Set ${name} bounciness`)} />
          </FieldRow>
          <Toggle label="Sensor (trigger)" hint="Detects overlaps but does not collide" checked={p.sensor} disabled={disabled} onChange={(v) => update({ physics: { sensor: v } }, `Set ${name} sensor`)} />
          <Toggle label="Lock rotation" checked={p.lockRotation} disabled={disabled} onChange={(v) => update({ physics: { lockRotation: v } }, `Set ${name} rotation lock`)} />
          {p.body === 'dynamic' && <Toggle label="Continuous collision" hint="For fast, small objects" checked={p.ccd} disabled={disabled} onChange={(v) => update({ physics: { ccd: v } }, `Set ${name} CCD`)} />}
        </>
      )}
    </Section>
  );
});

/** The joint section (only shown for bodies). */
export const JointSection = memo(function JointSection({ e, world, update, disabled }: { e: Entity; world: WorldDoc; update: Update; disabled: boolean }): ReactElement | null {
  if (!e.physics) return null;
  const j = e.joint;
  const name = e.name || e.id;
  const targets = ['world', ...Object.keys(world.entities).filter((id) => id !== e.id && world.entities[id]?.physics).slice(0, 400)];
  return (
    <Section title="Joint" defaultOpen={!!j} icon={<Icon name="link" size={14} />}>
      <FieldRow label="Type">
        <SelectField<JointOption>
          label="Joint type"
          value={j ? j.type : 'none'}
          options={JOINT_TYPES}
          disabled={disabled}
          onChange={(v) => update({ joint: v === 'none' ? null : { type: v, target: j?.target ?? 'world' } }, v === 'none' ? `Remove ${name} joint` : `${name} ${v} joint`)}
        />
      </FieldRow>
      {j && (
        <>
          <FieldRow label="Attached to">
            <SelectField label="Joint target" raw value={j.target} options={targets.includes(j.target) ? targets : [j.target, ...targets]} disabled={disabled} onChange={(v) => update({ joint: { target: v } }, `Attach ${name} to ${v}`)} />
          </FieldRow>
          <Vec3Field label="Anchor" value={j.anchor} step={0.1} disabled={disabled} onCommit={(v) => update({ joint: { anchor: v } }, `Move ${name} joint anchor`)} />
          <Vec3Field label="Target anchor" value={j.targetAnchor} step={0.1} disabled={disabled} onCommit={(v) => update({ joint: { targetAnchor: v } }, `Move ${name} joint target anchor`)} />
          {(j.type === 'revolute' || j.type === 'prismatic') && (
            <>
              <Vec3Field label="Axis" value={j.axis} step={0.1} disabled={disabled} onCommit={(v) => update({ joint: { axis: v } }, `Set ${name} joint axis`)} />
              <FieldRow label="Limits">
                <div className="field-inline">
                  <Switch label="Limit motion" checked={!!j.limits} disabled={disabled} onChange={(on) => update({ joint: { limits: on ? (j.type === 'revolute' ? [-90, 90] : [-1, 1]) : null } }, `${on ? 'Limit' : 'Free'} ${name} joint`)} />
                  {j.limits && (
                    <div className="vec2">
                      <NumberField label="Lower limit" value={j.limits[0]} step={j.type === 'revolute' ? 5 : 0.1} disabled={disabled} onCommit={(n) => update({ joint: { limits: [Math.min(n, j.limits?.[1] ?? n), j.limits?.[1] ?? n] } }, `Set ${name} joint limits`)} />
                      <NumberField label="Upper limit" value={j.limits[1]} step={j.type === 'revolute' ? 5 : 0.1} disabled={disabled} onCommit={(n) => update({ joint: { limits: [j.limits?.[0] ?? n, Math.max(n, j.limits?.[0] ?? n)] } }, `Set ${name} joint limits`)} />
                    </div>
                  )}
                </div>
              </FieldRow>
              <FieldRow label="Motor">
                <div className="field-inline">
                  <Switch label="Motor" checked={!!j.motor} disabled={disabled} onChange={(on) => update({ joint: { motor: on ? { targetVelocity: j.type === 'revolute' ? 90 : 1 } : null } }, `${on ? 'Add' : 'Remove'} ${name} motor`)} />
                  {j.motor && (
                    <NumberField label={j.type === 'revolute' ? 'Motor speed (°/s)' : 'Motor speed (m/s)'} value={j.motor.targetVelocity} step={j.type === 'revolute' ? 10 : 0.1} disabled={disabled} onCommit={(n) => update({ joint: { motor: { targetVelocity: n } } }, `Set ${name} motor speed`)} />
                  )}
                </div>
              </FieldRow>
            </>
          )}
          <p className="section__note">The joint is drawn in the viewport while this object is selected.</p>
        </>
      )}
    </Section>
  );
});

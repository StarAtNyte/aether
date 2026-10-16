import { Group, Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { isVehicleModel, MAX_PITCH, MAX_ROLL, MAX_STEER, VehicleRig } from '../src/sync/vehicle-rig';

/** A model with the node names `scripts/assets/vehicles.ts` writes, wheel radius 0.3. */
function car(): { root: Group; entity: Object3D } {
  const root = new Group();
  const chassis = new Object3D();
  chassis.name = 'chassis';
  root.add(chassis, new Mesh());
  for (const n of ['fl', 'fr']) {
    const steer = new Object3D();
    steer.name = `steer_${n}`;
    steer.position.set(n === 'fl' ? -0.8 : 0.8, 0.3, -1.4);
    const wheel = new Object3D();
    wheel.name = `wheel_${n}`;
    steer.add(wheel);
    root.add(steer);
  }
  for (const n of ['rl', 'rr']) {
    const wheel = new Object3D();
    wheel.name = `wheel_${n}`;
    wheel.position.set(n === 'rl' ? -0.8 : 0.8, 0.3, 1.3);
    root.add(wheel);
  }
  const entity = new Group();
  entity.add(root);
  return { root, entity };
}

/** Drive the entity: `speed` m/s straight ahead (-Z) for `seconds`, turning `yawRate` rad/s. */
function drive(rig: VehicleRig, entity: Object3D, speed: number, yawRate: number, seconds: number): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    entity.rotation.y += yawRate * dt;
    entity.translateZ(-speed * dt);
    rig.update(dt);
  }
}

describe('vehicle rig', () => {
  it('recognises a modelled vehicle by its wheel nodes', () => {
    expect(isVehicleModel(car().root)).toBe(true);
    expect(isVehicleModel(new Group())).toBe(false);
  });

  it('refuses a model without four wheels', () => {
    const rig = new VehicleRig();
    const g = new Group();
    expect(rig.add('x', g, g)).toBe(false);
    expect(rig.size).toBe(0);
  });

  it('rolls the wheels by distance over radius (forward is -Z)', () => {
    const { root, entity } = car();
    const rig = new VehicleRig();
    expect(rig.add('c', root, entity)).toBe(true);
    drive(rig, entity, 6, 0, 1);
    const wheel = root.getObjectByName('wheel_rl') as Object3D;
    expect(wheel.rotation.x).toBeCloseTo(-(6 * 1) / 0.3, 0);
    expect(rig.speedOf('c')).toBeGreaterThan(4);
  });

  it('rolls backwards when reversing and stands still when parked', () => {
    const { root, entity } = car();
    const rig = new VehicleRig();
    rig.add('c', root, entity);
    drive(rig, entity, -3, 0, 0.5);
    expect((root.getObjectByName('wheel_fl') as Object3D).rotation.x).toBeGreaterThan(0);
    const before = (root.getObjectByName('wheel_fl') as Object3D).rotation.x;
    drive(rig, entity, 0, 0, 0.5);
    expect((root.getObjectByName('wheel_fl') as Object3D).rotation.x).toBeCloseTo(before, 3);
  });

  it('steers the front wheels into a turn, within the lock, and leaves the rear wheels straight', () => {
    const { root, entity } = car();
    const rig = new VehicleRig();
    rig.add('c', root, entity);
    drive(rig, entity, 8, 0.9, 1.5);
    const fl = root.getObjectByName('steer_fl') as Object3D;
    expect(fl.rotation.y).toBeGreaterThan(0.1);
    expect(fl.rotation.y).toBeLessThanOrEqual(MAX_STEER + 1e-9);
    expect((root.getObjectByName('steer_fr') as Object3D).rotation.y).toBeCloseTo(fl.rotation.y, 6);
    expect((root.getObjectByName('wheel_rl') as Object3D).rotation.y).toBe(0);
    // The body leans away from the turn (a left turn rolls to the right: negative about Z) and stays inside its limit.
    const chassis = root.getObjectByName('chassis') as Object3D;
    expect(chassis.rotation.z).toBeLessThan(0);
    expect(Math.abs(chassis.rotation.z)).toBeLessThanOrEqual(MAX_ROLL + 1e-9);
  });

  it('pitches the nose up under power and bounds the pitch', () => {
    const { root, entity } = car();
    const rig = new VehicleRig();
    rig.add('c', root, entity);
    rig.update(1 / 60);
    let peak = 0;
    for (let t = 0; t < 40; t++) {
      entity.translateZ(-(t * 0.05)); // accelerating
      rig.update(1 / 60);
      peak = Math.max(peak, (root.getObjectByName('chassis') as Object3D).rotation.x);
    }
    expect(peak).toBeGreaterThan(0.002);
    expect(peak).toBeLessThanOrEqual(MAX_PITCH + 1e-9);
  });

  it('ignores a teleport instead of spinning the wheels', () => {
    const { root, entity } = car();
    const rig = new VehicleRig();
    rig.add('c', root, entity);
    rig.update(1 / 60);
    entity.position.set(500, 0, 500);
    rig.update(1 / 60);
    expect(Math.abs((root.getObjectByName('wheel_fl') as Object3D).rotation.x)).toBeLessThan(0.01);
  });

  it('forgets removed vehicles', () => {
    const { root, entity } = car();
    const rig = new VehicleRig();
    rig.add('c', root, entity);
    rig.remove('c');
    expect(rig.size).toBe(0);
    expect(rig.update(1 / 60)).toBe(false);
  });
});

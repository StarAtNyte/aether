import { describe, expect, it } from 'vitest';
import { Group, Scene, type Light } from 'three';
import { HIDDEN_LAMP_LAYER, LampSlots } from '../src/sync/lamp-slots';
import { RoomLamp } from '../src/sync/room-lamp';

function lamp(parent: Group, x: number, intensity = 2): RoomLamp {
  const l = new RoomLamp(0xff5a48, intensity, 5, 2);
  l.position.set(x, 1, 0);
  parent.add(l);
  return l;
}

/** The lights a camera on layer 0 shades with (what the renderer keys every lit program on). */
function shaded(scene: Scene): Light[] {
  const out: Light[] = [];
  scene.traverseVisible((o) => {
    if ((o as Light).isLight === true && o.layers.isEnabled(0)) out.push(o as Light);
  });
  return out;
}

describe('lamp slots', () => {
  it('keeps the shaded light set unchanged while lamps come, go and switch off', () => {
    const scene = new Scene();
    const world = new Group();
    const slots = new LampSlots();
    scene.add(world, slots.group);
    const lights: Light[] = [];
    const a = lamp(world, 0);
    const b = lamp(world, 4);
    lights.push(a, b);
    // A template with a lamp (the world counts its template lamps): one spare slot.
    const template = new Group();
    template.visible = false;
    world.add(template);
    const t = lamp(template, 8);
    lights.push(t);
    slots.sync(lights, 1);
    scene.updateMatrixWorld(true);
    const before = shaded(scene).map((l) => l.id);
    expect(before).toHaveLength(3);
    expect(a.layers.mask).toBe(1 << HIDDEN_LAMP_LAYER);

    // A copy of the template spawns: no new light in the shaded set.
    const spawned = lamp(world, -3);
    lights.push(spawned);
    expect(slots.sync(lights, 1)).toBe(false);
    expect(shaded(scene).map((l) => l.id)).toEqual(before);
    const lit = shaded(scene).filter((l) => l.intensity > 0);
    expect(lit).toHaveLength(3);
    expect(lit.some((l) => l.position.x === -3)).toBe(true);

    // It is collected (removed), another lamp is switched off, another is hidden with its entity.
    spawned.removeFromParent();
    lights.splice(lights.indexOf(spawned), 1);
    b.intensity = 0;
    const holder = new Group();
    world.add(holder);
    holder.add(a);
    holder.visible = false;
    expect(slots.sync(lights, 1)).toBe(false);
    expect(shaded(scene).map((l) => l.id)).toEqual(before);
    expect(shaded(scene).every((l) => l.intensity === 0)).toBe(true);
  });

  it('copies colour, intensity, range and world position into the slot', () => {
    const scene = new Scene();
    const world = new Group();
    world.position.set(10, 0, 0);
    const slots = new LampSlots();
    scene.add(world, slots.group);
    const l = lamp(world, 2, 3.5);
    l.distance = 7;
    l.clip.min.set(0, 0, 0);
    l.clip.max.set(1, 1, 1);
    slots.sync([l]);
    scene.updateMatrixWorld(true);
    const s = shaded(scene)[0] as RoomLamp;
    expect(s).not.toBe(l);
    expect(s.intensity).toBe(3.5);
    expect(s.distance).toBe(7);
    expect(s.color.equals(l.color)).toBe(true);
    expect(s.getWorldPosition(s.position.clone()).x).toBeCloseTo(12);
    expect(s.clip.equals(l.clip)).toBe(true);
  });

  it('grows only when more lamps are lit at once than ever before, and leaves shadow casters and cut lamps alone', () => {
    const world = new Group();
    const slots = new LampSlots();
    const a = lamp(world, 0);
    const caster = lamp(world, 1);
    caster.castShadow = true;
    const cut = lamp(world, 2);
    cut.visible = false;
    cut.userData['cut'] = true;
    expect(slots.sync([a, caster, cut])).toBe(true);
    expect(slots.size).toBe(1);
    expect(caster.layers.isEnabled(0)).toBe(true);
    const b = lamp(world, 3);
    expect(slots.sync([a, b, caster, cut])).toBe(true);
    expect(slots.size).toBe(2);
    expect(slots.sync([b])).toBe(false);
    expect(slots.size).toBe(2);
    // The lamp keeps its slot while it stays lit.
    const at = [0, 1].find((i) => slots.owner(i) === b);
    expect(slots.sync([a, b])).toBe(false);
    expect(slots.owner(at!)).toBe(b);
  });
});

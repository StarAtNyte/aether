import { describe, expect, it } from 'vitest';
import { Group, Scene, type Light } from 'three';
import { HIDDEN_LAMP_LAYER, LampSet, LampSlots } from '../src/sync/lamp-slots';
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

const ids = (scene: Scene): number[] => shaded(scene).map((l) => l.id);

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
    expect(slots.sync(lights, 1)).toBe(true);
    const before = ids(scene);
    // One light shades every slotted lamp; the entity lamps are on a layer no camera draws.
    expect(before).toHaveLength(1);
    expect(shaded(scene)[0]).toBeInstanceOf(LampSet);
    expect(slots.size).toBe(3);
    expect(a.layers.mask).toBe(1 << HIDDEN_LAMP_LAYER);

    // A copy of the template spawns: no new light in the shaded set.
    const spawned = lamp(world, -3);
    lights.push(spawned);
    expect(slots.sync(lights, 1)).toBe(false);
    expect(ids(scene)).toEqual(before);
    expect(slots.light!.lit).toContain(spawned);

    // It is collected (removed), another lamp is switched off, another is hidden with its entity.
    spawned.removeFromParent();
    lights.splice(lights.indexOf(spawned), 1);
    b.intensity = 0;
    const holder = new Group();
    world.add(holder);
    holder.add(a);
    holder.visible = false;
    expect(slots.sync(lights, 1)).toBe(false);
    expect(ids(scene)).toEqual(before);
    expect(slots.light!.lit.filter((l) => l.intensity > 0)).toHaveLength(0);
  });

  it('gives a lamp turned down to zero its slot, so it lights later without changing the light set', () => {
    const scene = new Scene();
    const world = new Group();
    const slots = new LampSlots();
    scene.add(world, slots.group);
    // A world loaded in daylight: its lamps are at zero.
    const lights: Light[] = [lamp(world, 0, 0), lamp(world, 4, 0)];
    expect(slots.sync(lights)).toBe(true);
    expect(slots.size).toBe(2);
    const before = ids(scene);
    // Dusk: the lamps come on in the slots they hold.
    for (const l of lights) l.intensity = 3;
    expect(slots.sync(lights)).toBe(false);
    expect(ids(scene)).toEqual(before);
    expect(slots.light!.lit.filter((l) => l.intensity === 3)).toHaveLength(2);
  });

  it('grows only when more lamps are shown at once than ever before, and leaves shadow casters and cut lamps alone', () => {
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
    expect(slots.owner(0)).toBe(a);
    const b = lamp(world, 3);
    expect(slots.sync([a, b, caster, cut])).toBe(true);
    expect(slots.size).toBe(2);
    expect(slots.sync([b])).toBe(false);
    expect(slots.size).toBe(2);
    expect(slots.owner(0)).toBe(b);
    expect(slots.owner(1)).toBeNull();
  });
});

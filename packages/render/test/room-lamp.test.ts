import { describe, expect, it } from 'vitest';
import { Box3, PointLight, Vector3 } from 'three';
import { RoomLamp } from '../src/sync/room-lamp';
import { createEntityLight } from '../src/sync/lights';

describe('room lamps', () => {
  it('point lights of entities are room lamps (still point lights) without a clip', () => {
    const { light } = createEntityLight({ type: 'point', color: '#ffffff', intensity: 1, range: 6, angle: 30, castShadow: false });
    expect(light).toBeInstanceOf(RoomLamp);
    expect(light).toBeInstanceOf(PointLight);
    expect((light as RoomLamp).clip.isEmpty()).toBe(true);
  });

  it('takes a finite clip box, drops it on null, ignores non-finite boxes and copies it', () => {
    const l = new RoomLamp('#fff', 10, 6, 2);
    l.setClip(new Box3(new Vector3(0, 0, 0), new Vector3(4, 3, 5)));
    expect(l.clip.max.z).toBe(5);
    l.setClip(new Box3(new Vector3(Number.NaN, 0, 0), new Vector3(1, 1, 1)));
    expect(l.clip.max.z).toBe(5);
    const c = new RoomLamp().copy(l);
    expect(c.clip.equals(l.clip)).toBe(true);
    l.setClip(null);
    expect(l.clip.isEmpty()).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { Box3, PointLight, SpotLight, Vector3 } from 'three';
import { isConfinedLight, RoomLamp, RoomSpot } from '../src/sync/room-lamp';
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

  it('spot lights of entities are room spots (still spot lights) that take a clip and copy it with their profile', () => {
    const { light } = createEntityLight({ type: 'spot', color: '#ffffff', intensity: 1, range: 6, angle: 30, castShadow: false });
    expect(light).toBeInstanceOf(RoomSpot);
    expect(light).toBeInstanceOf(SpotLight);
    expect(isConfinedLight(light)).toBe(true);
    const s = light as RoomSpot;
    expect(s.clip.isEmpty()).toBe(true);
    expect(s.iesMap).toBeNull();
    s.setClip(new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2.8, 1)));
    s.setClip(new Box3(new Vector3(0, 0, 0), new Vector3(1, Number.POSITIVE_INFINITY, 1)));
    expect(s.clip.max.y).toBe(2.8);
    const c = new RoomSpot().copy(s);
    expect(c.clip.equals(s.clip)).toBe(true);
    expect(isConfinedLight(new PointLight())).toBe(false);
  });
});

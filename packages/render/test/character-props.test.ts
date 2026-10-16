/**
 * Character additions of the outdoor flagships: a backpack worn on the back (hands stay free), a canoe paddle, and the
 * `pose` field on the character spec.
 */
import { CharacterSpec } from '@aether/core';
import { lookFromText, resolveLook } from '@aether/assets';
import { Box3, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildProp } from '../src/characters/props';

describe('character props', () => {
  it('a backpack is worn on the back: mounted on the spine, not held, roughly shoulder-wide and a torso tall', () => {
    const prop = buildProp('backpack');
    expect(prop).not.toBeNull();
    expect(prop?.onBack).toBe(true);
    expect(prop?.twoHanded).toBe(false);
    const box = new Box3().setFromObject(prop!.group);
    const size = box.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(0.3);
    expect(size.x).toBeLessThan(0.55);
    expect(size.y).toBeGreaterThan(0.4);
    expect(size.y).toBeLessThan(0.9);
    expect(size.z).toBeLessThan(0.35);
    prop?.dispose();
  });

  it('a paddle is held in one hand and its blade hangs well below the grip', () => {
    const prop = buildProp('paddle');
    expect(prop).not.toBeNull();
    expect(prop?.onBack).toBeUndefined();
    expect(prop?.twoHanded).toBe(false);
    const box = new Box3().setFromObject(prop!.group);
    expect(box.min.y).toBeLessThan(-0.7);
    expect(box.max.y).toBeGreaterThan(0.6);
    expect(prop!.group.children.every((c) => c instanceof Mesh)).toBe(true);
    prop?.dispose();
  });

  it('the satchel is no longer a bare box: it has a rounded body', () => {
    const prop = buildProp('bag');
    expect(prop!.group.children.length).toBeGreaterThanOrEqual(4);
    prop?.dispose();
  });
});

describe('character spec additions', () => {
  it('accepts the new holds and a sit pose, and rejects other poses', () => {
    expect(CharacterSpec.safeParse({ hold: 'backpack' }).success).toBe(true);
    expect(CharacterSpec.safeParse({ hold: 'paddle', pose: 'sit' }).success).toBe(true);
    expect(CharacterSpec.safeParse({ pose: 'stand' }).success).toBe(true);
    expect(CharacterSpec.safeParse({ pose: 'dance' }).success).toBe(false);
  });

  it('a hold named in words resolves to the prop', () => {
    expect(lookFromText('a hiker with a rucksack')?.hold).toBe('backpack');
    expect(lookFromText('a woman with a paddle')?.hold).toBe('paddle');
  });

  it('the resolved look carries the hold', () => {
    expect(resolveLook({ hold: 'backpack', scale: 1 }, 'hiker').hold).toBe('backpack');
    expect(resolveLook({ hold: 'paddle', scale: 1 }, 'canoeist').hold).toBe('paddle');
  });
});

/**
 * A walkthrough replay walks inside the building: the view opens it (doll's house, storeys apart) instead of framing
 * the roof, and leaves alone a view the user chose.
 */
import { describe, expect, it } from 'vitest';
import { interiorViewFor } from '../src/engine/playtest/controller';
import { DEFAULT_ARCH_UI } from '../src/state/archUi';

const two = { ...DEFAULT_ARCH_UI, building: 'house', levels: [{ index: 0, name: 'Ground floor', height: 3 }, { index: 1, name: 'Upper floor', height: 3 }] };

describe('walkthrough replay view', () => {
  it('opens a two-storey house as a doll’s house with the storeys apart', () => {
    expect(interiorViewFor(two, 'walkthrough')).toEqual({ walls: 'cutaway', levelMode: 'exploded' });
  });
  it('a single storey only needs the cutaway', () => {
    expect(interiorViewFor({ ...two, levels: [two.levels[0]!] }, 'walkthrough')).toEqual({ walls: 'cutaway' });
  });
  it('leaves games, plan views, sections and views the user changed alone', () => {
    expect(interiorViewFor(two, 'game')).toBeNull();
    expect(interiorViewFor({ ...two, plan: true }, 'walkthrough')).toBeNull();
    expect(interiorViewFor({ ...two, section: 1.2 }, 'walkthrough')).toBeNull();
    expect(interiorViewFor({ ...two, walls: 'down' }, 'walkthrough')).toBeNull();
    expect(interiorViewFor({ ...two, building: null }, 'walkthrough')).toBeNull();
  });
});

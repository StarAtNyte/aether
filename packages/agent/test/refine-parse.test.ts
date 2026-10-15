import { describe, expect, it } from 'vitest';
import { parseEdit } from '../src/refine/parse';
import { parseRef } from '../src/refine/parse-ref';
import { adjustColor } from '../src/refine/adjust';
import { colorName, findColor } from '../src/refine/lexicon';

function first(text: string): ReturnType<typeof parseEdit>['commands'][number] {
  const r = parseEdit(text);
  expect(r.commands.length, `"${text}" parsed to nothing (${r.unparsed.join('|')})`).toBeGreaterThan(0);
  return r.commands[0] as ReturnType<typeof parseEdit>['commands'][number];
}

describe('colours', () => {
  it('reads shade words and compound names', () => {
    expect(findColor('make it dark green')?.text).toBe('dark green');
    expect(findColor('a deep forest green sofa')?.text).toContain('green');
    expect(findColor('#ff00aa please')?.hex).toBe('#ff00aa');
    expect(findColor('no colour here')).toBeNull();
  });

  it('dark is darker than plain, light is lighter', () => {
    const lum = (hex: string): number => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(findColor('dark green')!.hex)).toBeLessThan(lum(findColor('green')!.hex));
    expect(lum(findColor('light green')!.hex)).toBeGreaterThan(lum(findColor('green')!.hex));
  });

  it('names colours the way people say them', () => {
    expect(colorName('#1f4d36')).toBe('dark green');
    expect(colorName('#8a8d91')).toBe('grey');
    expect(colorName('#ffffff')).toBe('white');
  });

  it('adjusts relative to the current colour', () => {
    const base = '#3f7d4e';
    expect(adjustColor(base, 'darker', 0.3)).not.toBe(base);
    const l = (h: string): number => parseInt(h.slice(1, 3), 16);
    expect(l(adjustColor('#808080', 'lighter', 0.3))).toBeGreaterThan(0x80);
    expect(l(adjustColor('#808080', 'darker', 0.3))).toBeLessThan(0x80);
  });
});

describe('references', () => {
  it('splits ordinal, room and noun', () => {
    const r = parseRef('the second chair in the dining room');
    expect(r.noun).toBe('chair');
    expect(r.ordinal).toBe(2);
    expect(r.room?.adjectives).toContain('dining');
  });

  it('keeps a room possessive with its wall side', () => {
    const r = parseRef("the main bedroom's back wall");
    expect(r.noun).toBe('wall');
    expect(r.side).toBe('back');
    expect(r.room?.noun).toBe('bedroom');
    expect(r.room?.adjectives).toContain('main');
  });

  it('understands relations and pronouns', () => {
    expect(parseRef('the lamp left of the window').relation).toMatchObject({ rel: 'left of' });
    expect(parseRef('it').pronoun).toBe('it');
    expect(parseRef('the same').pronoun).toBe('same');
    expect(parseRef('the other bedroom').other).toBe(true);
  });

  it('does not treat material-like colour words as adjectives', () => {
    expect(parseRef('the coffee table').colorAdj).toBeUndefined();
    expect(parseRef('the red chair').colorAdj).toBeDefined();
  });

  it('reads plurals and the explicit all', () => {
    expect(parseRef('the chairs').all).toBe(true);
    expect(parseRef('the chairs').allWord).toBeUndefined();
    expect(parseRef('all the chairs').allWord).toBe(true);
  });
});

describe('commands', () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['make the sofa dark green velvet', 'paint', { look: { color: expect.any(String), material: 'velvet' } }],
    ['paint the walls white', 'paint', {}],
    ['make this red', 'paint', {}],
    ['swap the kitchen tiles to white subway tiles', 'paint', { look: { material: 'subway tiles' } }],
    ['wallpaper on the bedroom\'s back wall', 'paint', { look: { material: 'wallpaper' } }],
    ['change the floor to oak', 'paint', {}],
    ['make the sofa a bit darker', 'paint', { look: { adjust: { dir: 'darker' } } }],
    ['move the lamp a bit to the left', 'move', { direction: 'left' }],
    ['move the lamp 2 meters north', 'move', { direction: 'north', metres: 2 }],
    ['put the lamp next to the sofa', 'move', {}],
    ['rotate the chair 90 degrees', 'rotate', { degrees: 90 }],
    ['make that tree taller', 'scale', { axis: 'y' }],
    ['make the table 2 meters wide', 'resize', { dimension: 'width', value: 2 }],
    ['make the table round', 'shape', { word: 'round' }],
    ['remove the second chair', 'remove', {}],
    ['get rid of the rocks', 'remove', {}],
    ['add a rug under the coffee table', 'add', { noun: 'rug' }],
    ['add 3 crates', 'add', { noun: 'crate', count: 3 }],
    ['duplicate the lamp', 'duplicate', {}],
    ['rename the hero to Mira', 'rename', {}],
    ['make the coins spin faster', 'speed', {}],
    ['make the enemy slower', 'speed', {}],
    ['make the door open outwards', 'door', { outwards: true }],
    ['brighter lights in the hallway', 'light', {}],
    ['turn off the lights', 'light', { on: false }],
    ['hide the tv', 'visibility', { visible: false }],
    ['make the ball bouncy', 'physics', { what: 'bouncy' }],
    ['make Mira say hello there', 'dialogue', {}],
    ['make the forest denser', 'density', {}],
    ['turn the sky to sunset', 'env', {}],
    ['give me 90 seconds', 'game', { key: 'timeLimit', value: 90 }],
    ['undo that', 'undo', {}],
    ['do the same for the other bedroom', 'repeat', {}],
  ];
  for (const [text, op, fields] of cases) {
    it(`"${text}" → ${op}`, () => {
      const c = first(text);
      expect(c.op).toBe(op);
      expect(c).toMatchObject(fields);
    });
  }

  it('splits two edits in one message', () => {
    const r = parseEdit('make the first tent red and the second tent blue');
    expect(r.commands.map((c) => c.op)).toEqual(['paint', 'paint']);
  });

  it('flags questions and new-world requests, never as edits', () => {
    expect(parseEdit('what is in this scene?').question).toBe(true);
    expect(parseEdit('start over with a desert').newWorld).toBe(true);
    expect(parseEdit('thanks, that looks great').commands).toHaveLength(0);
  });

  it('leaves clauses it does not understand to the model', () => {
    const r = parseEdit('make the thing feel more whimsical');
    expect(r.commands).toHaveLength(0);
  });

  it('is safe on hostile input', () => {
    for (const text of ['a'.repeat(5000), 'make the ' + 'very '.repeat(400) + 'big', '((((((((((', '\u0000\u0001'.repeat(100), 'make ' + 'the '.repeat(300) + 'sofa red']) {
      const t0 = performance.now();
      expect(() => parseEdit(text)).not.toThrow();
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });
});

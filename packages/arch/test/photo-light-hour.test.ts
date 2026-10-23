import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveBuild, parseRoomDescription } from '../src/photo/index';
import { partKinds } from '../src/index';

const description = (light: Record<string, unknown>) => {
  const r = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json'), 'utf8')) as Record<string, unknown>;
  r['light'] = { from: 'west', warmth: 'warm', brightness: 0.6, note: '', ...light };
  const p = parseRoomDescription(r, partKinds());
  if (!p.ok) throw new Error(p.error);
  return p.value;
};

describe('the sky preset of a photo room agrees with its hour', () => {
  it('a golden afternoon is a sunset, not a dawn (the preset would clamp the sun into the east)', () => {
    const env = deriveBuild(description({ sky: 'dawn', timeOfDay: 18 })).environment;
    expect(env['sky']).toBe('sunset');
    expect(env['timeOfDay']).toBe(18);
  });
  it('a golden morning stays a dawn, and a sunset at night-side hours becomes one', () => {
    expect(deriveBuild(description({ sky: 'dawn', timeOfDay: 6.5 })).environment['sky']).toBe('dawn');
    expect(deriveBuild(description({ sky: 'sunset', timeOfDay: 6.5 })).environment['sky']).toBe('dawn');
    expect(deriveBuild(description({ sky: 'sunset', timeOfDay: 17.5 })).environment['sky']).toBe('sunset');
  });
});

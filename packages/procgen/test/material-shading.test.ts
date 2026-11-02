/** Generator materials carry `surface` layers and `shader` expressions through the sanitizer, validated. */
import { describe, expect, it } from 'vitest';
import { sanitizeMaterial } from '../src/material';

describe('generator material shading', () => {
  it('passes valid surface layers and expressions through', () => {
    const surface = { layers: [{ kind: 'moss', amount: 0.7, mask: { up: 0.6 } }, { kind: 'cracks', scale: 0.5 }], scale: 1.5 };
    const shader = { emissive: '#ff4000 * pow(1 - cells(p * 3), 4)', displace: '0.02 * sin(t + o.x * 4)' };
    const out = sanitizeMaterial({ preset: 'stone', surface, shader });
    expect(out.surface).toEqual(surface);
    expect(out.shader).toEqual(shader);
  });

  it('rejects bad layers and expressions with the path and the parser message', () => {
    expect(() => sanitizeMaterial({ surface: { layers: [{ kind: 'glitter' }] } })).toThrow(/material\.surface\.layers\.0\.kind/);
    expect(() => sanitizeMaterial({ shader: { color: 'base * glow' } })).toThrow(/material\.shader\.color: shader\.color: unknown name "glow"/);
    expect(() => sanitizeMaterial({ shader: { bump: 'p' } })).toThrow(/must be a float/);
  });

  it('drops unknown keys inside layers like everywhere else', () => {
    const out = sanitizeMaterial({ surface: { layers: [{ kind: 'tone', extra: 1 }] } });
    expect(out.surface).toEqual({ layers: [{ kind: 'tone' }] });
  });
});

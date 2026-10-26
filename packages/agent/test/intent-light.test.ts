import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { lightEvidenceText, pictureStats } from '../src/picture-stats';
import { lookPatches, lookText, TuneLookInput } from '../src/look-edit';

describe('lighting intent', () => {
  it('is stored in the look and shown back', () => {
    const w = createWorld({ name: 't' });
    const input = TuneLookInput.parse({ intent: { key: 'dim', text: 'dim cinema ambience, readable' } });
    const r = lookPatches(w, input);
    expect(r.patches).toHaveLength(1);
    expect(r.summary).toContain('look.intent');
    const op = r.patches[0] as unknown as { set: { look: { intent: { key: string } } } };
    expect(op.set.look.intent.key).toBe('dim');
    expect(lookText(w)).toContain('lighting intent: not stated');
  });
  it('measures the share of washed and crushed pixels', () => {
    const px = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 120, 120, 120, 255, 120, 120, 120, 255]);
    const s = pictureStats(px);
    expect(s?.washed).toBeCloseTo(0.25);
    expect(s?.crushed).toBeCloseTo(0.25);
    expect(lightEvidenceText([{ name: 'eye', stats: s! }], 'dim')).toContain('washed (near white) 25%');
    expect(lightEvidenceText([], null)).toBe('');
  });
});

describe('over-lit against the stated key', () => {
  const lit = { mean: 188, washed: 0.05, crushed: 0 };
  it('flags a dim intent with a bright picture and says to fix the light', () => {
    const t = lightEvidenceText([{ name: 'eye', stats: lit }], 'dim', 'dim');
    expect(t).toContain('OVER-LIT for a dim intent');
    expect(t).toContain('lamp');
  });
  it('flags nothing for a moderate intent at the same picture', () => {
    expect(lightEvidenceText([{ name: 'eye', stats: { ...lit, mean: 120 } }], 'moderate', 'moderate')).not.toContain('OVER-LIT');
    expect(lightEvidenceText([{ name: 'eye', stats: lit }], 'dim')).not.toContain('OVER-LIT');
  });
});

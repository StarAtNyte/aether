import { describe, expect, it } from 'vitest';
import { Environment } from '../src/schema';

describe('Environment.grade', () => {
  it('is optional, so every older document still parses and has no grade', () => {
    expect(Environment.parse({}).grade).toBeUndefined();
  });

  it('takes partial, bounded fields', () => {
    expect(Environment.parse({ grade: { temperature: 0.3 } }).grade).toEqual({ temperature: 0.3 });
    expect(Environment.safeParse({ grade: { temperature: 2 } }).success).toBe(false);
    expect(Environment.safeParse({ grade: { saturation: 0 } }).success).toBe(false);
    expect(Environment.safeParse({ grade: { exposureEv: 9 } }).success).toBe(false);
    expect(Environment.safeParse({ grade: { contrast: Number.NaN } }).success).toBe(false);
  });
});

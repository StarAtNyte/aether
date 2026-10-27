import { describe, expect, it } from 'vitest';
import { chooseForwardLights, FORWARD_LIGHTS, type BudgetLight } from '../src/sync/lights';

const light = (id: string, group: string, x: number, intensity = 1): BudgetLight => ({ id, group, position: [x, 3, 0], intensity });

describe('forward light budget', () => {
  it('keeps everything that fits', () => {
    const ls = [light('a', 'r1', 0), light('b', 'r1', 4)];
    expect([...chooseForwardLights(ls, 4)].sort()).toEqual(['a', 'b']);
  });
  it('lights every room before any room gets a second light', () => {
    const ls = [...Array.from({ length: 10 }, (_, i) => light(`big${i}`, 'hall', i * 2, 5)), light('s1', 'shop', 40), light('c1', 'cafe', 60)];
    const kept = chooseForwardLights(ls, 3);
    expect(kept.size).toBe(3);
    expect(kept.has('s1') && kept.has('c1')).toBe(true);
  });
  it('spreads picks inside a room instead of clustering them', () => {
    const ls = [light('l0', 'r', 0, 3), light('l1', 'r', 1), light('l2', 'r', 2), light('l9', 'r', 20)];
    const kept = chooseForwardLights(ls, 2);
    expect([...kept].sort()).toEqual(['l0', 'l9']);
  });
  it('is deterministic and never exceeds the cap', () => {
    const ls = Array.from({ length: 48 }, (_, i) => light(`x${i}`, `room${i % 7}`, i * 3));
    const a = [...chooseForwardLights(ls, 8)].sort(), b = [...chooseForwardLights([...ls].reverse(), 8)].sort();
    expect(a).toEqual(b);
    expect(a).toHaveLength(8);
  });
  it('leaves discrete GPUs uncapped in practice and caps the weak ones', () => {
    expect(FORWARD_LIGHTS.discrete).toBeGreaterThanOrEqual(48);
    expect(FORWARD_LIGHTS.software).toBeLessThan(FORWARD_LIGHTS.integrated);
  });
});
